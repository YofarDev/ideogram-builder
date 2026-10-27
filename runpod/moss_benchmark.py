"""Reproducible MOSS benchmark runner.

Runs the production request path (HTTP against the Modal proxy, or in-process
against handler.py inside the GPU container) across fixture x seed x
(profile, preset) matrices, records JSONL results and a Markdown comparison.

Guards: concurrency is one; a warmup job precedes measured runs; runs stop
early on repeated errors, OOM or a clear regression; progress is appended to
results.jsonl immediately so an interrupted run keeps everything observed.
Base64 image bodies are stored under images/ and excluded from the JSONL.

CLI (CPU side):
    python moss_benchmark.py --endpoint https://... --token ... \
        --profiles baseline,resident-highvram-int8 --presets Fast \
        --seeds 101,202,303,404,505 --out bench-out [--dry-run]

Internal (inside the MOSS image, wired as a Modal entrypoint):
    from moss_benchmark import run_benchmark; run_benchmark(mode="internal", ...)
"""

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

RUNPOD_DIR = Path(__file__).resolve().parent
FIXTURES_PATH = RUNPOD_DIR / "benchmarks" / "moss" / "fixtures.json"

DEFAULT_SEEDS = [101, 202, 303, 404, 505]
CONSECUTIVE_ERROR_STOP = 3
DEFAULT_REGRESSION_STOP_PCT = 50  # stop when warm median degrades this much vs best-so-far


# ---------------------------------------------------------------------------
# Fixtures — compiled with the exact buildMossLayout maths (src/prompt-moss.js)
# ---------------------------------------------------------------------------

def load_fixtures(path=None, ids=None, categories=None):
    data = json.loads(Path(path or FIXTURES_PATH).read_text())
    fixtures = data["fixtures"]
    if ids:
        wanted = set(ids)
        fixtures = [f for f in fixtures if f["id"] in wanted]
    if categories:
        wanted = set(categories)
        fixtures = [f for f in fixtures if f["category"] in wanted]
    known = {f["id"] for f in fixtures}
    if ids:
        missing = wanted - known
        if missing:
            raise ValueError(f"Unknown fixture ids: {', '.join(sorted(missing))}")
    return fixtures


def compile_fixture_layout(fixture, width, height):
    """Fixture boxes -> MOSS layout JSON string, byte-compatible with the UI's
    compile path (abs_centralized yxyx, top-layer-first items)."""
    import math

    hw, hh = width // 2, height // 2
    clamp = lambda v, lo, hi: max(lo, min(hi, v))  # noqa: E731
    items = []
    for box in reversed(fixture["boxes"]):  # top layer first, same as the editor
        bx = box["box"]  # [x, y, w, h] in 0-1000
        y1 = clamp(int(bx[1] * height / 1000) - hh, -hh, hh)
        x1 = clamp(int(bx[0] * width / 1000) - hw, -hw, hw)
        y2 = clamp(math.ceil((bx[1] + bx[3]) * height / 1000) - hh, -hh, hh)
        x2 = clamp(math.ceil((bx[0] + bx[2]) * width / 1000) - hw, -hw, hw)
        if y1 >= y2 or x1 >= x2:
            continue
        label = box["mode"]
        item = {"label": label, "caption": box["desc"]}
        if label == "text":
            item["text"] = box.get("text", "")
        item["bbox"] = [y1, x1, y2, x2]
        if box.get("tags"):
            item["tags"] = box["tags"]
        if box.get("colors"):
            item["palette"] = box["colors"]
        items.append(item)
    summary = {}
    if fixture.get("meta"):
        summary["meta"] = fixture["meta"]
    if fixture.get("canvas"):
        summary["canvas"] = fixture["canvas"]
    summary["caption"] = fixture["caption"]
    if fixture.get("palette"):
        summary["palette"] = fixture["palette"]
    layout = {
        "summary": summary,
        "items": items,
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    return json.dumps(layout)


def build_jobs(fixtures, seeds, configs, cached_prompt=False):
    """One job per (config, fixture, seed). cached_prompt=True repeats the same
    fixture text across measured runs so text-encode caching engages after the
    first run; the default rotates prompts (new-prompt case). Seeds always
    vary so the complete image result is never cached."""
    jobs = []
    for config in configs:
        for seed_index, seed in enumerate(seeds):
            fixture = fixtures[seed_index % len(fixtures)] if cached_prompt else fixtures
            chosen = [fixture] if cached_prompt else fixtures
            for f in chosen:
                width, height = f["dims"]
                jobs.append({
                    "config": config,
                    "fixture_id": f["id"],
                    "seed": seed,
                    "width": width,
                    "height": height,
                    "case": "cached-prompt" if cached_prompt else "new-prompt",
                })
    return jobs


# ---------------------------------------------------------------------------
# Execution backends
# ---------------------------------------------------------------------------

def _payload(job):
    fixture = _fixture_by_id(job["fixture_id"])
    return {
        "model": "moss",
        "import_json": compile_fixture_layout(fixture, job["width"], job["height"]),
        "width": job["width"],
        "height": job["height"],
        "preset": job["config"]["preset"],
        "negative_prompt": "",
        "seed": job["seed"],
        "loras": [],
    }


_FIXTURES_BY_ID = {}


def _fixture_by_id(fixture_id):
    if not _FIXTURES_BY_ID:
        for f in load_fixtures():
            _FIXTURES_BY_ID[f["id"]] = f
    return _FIXTURES_BY_ID[fixture_id]


def _dump_effective_workflows(configs, out_dir):
    """Rebuild each config's effective graph deterministically (same builder the
    worker uses) so artifacts carry the exact recipe, not a transcript."""
    try:
        import moss_assets
        import moss_workflow
        from moss_config import MOSS_PRESETS, RUNTIME_PROFILES

        template = json.loads((RUNPOD_DIR / "workflow_template_moss.json").read_text())
        for config in configs:
            profile = RUNTIME_PROFILES[config["profile"]]
            assets = moss_assets.resolve_profile_assets(profile)
            preset = dict(MOSS_PRESETS[config["preset"]])
            preset.setdefault("effective_steps", preset["steps"])
            adapter_ref = None
            if preset.get("adapter"):
                adapter_ref = moss_assets.resolve_adapter(preset["adapter"])[1]
            wf, _info = moss_workflow.build_moss_workflow(
                template, preset_name=config["preset"], preset=preset, prompt="[benchmark]",
                negative="", width=1024, height=1024, seed=0, loras=[], profile=profile,
                assets=assets, adapter_ref=adapter_ref)
            (Path(out_dir) / "workflows" / f"{config['profile']}-{config['preset']}.json").write_text(
                json.dumps(wf, indent=1))
    except Exception as e:  # noqa: BLE001 — artifacts are best-effort, never block a run
        print(f"[benchmark] effective-workflow capture skipped: {e}")


def _dump_runtime_manifest(profiles, out_dir):
    """Runtime identity per profile when runtime_check can inspect this host;
    on a CPU dev machine it records what it can and marks the rest unknown."""
    try:
        import runtime_check
        for pid in profiles:
            data = runtime_check.collect()
            data["profile"] = pid
            (Path(out_dir) / "runtime" / f"{pid}.json").write_text(json.dumps(data, indent=1, default=str))
    except Exception as e:  # noqa: BLE001
        print(f"[benchmark] runtime manifest capture skipped: {e}")


def run_http(job, endpoint, token, timeout_s=900):
    import requests

    base = endpoint.rstrip("/")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    submit_started = time.monotonic()
    resp = requests.post(f"{base}/generate", json=_payload(job), headers=headers, timeout=60)
    resp.raise_for_status()
    call_id = resp.json()["call_id"]
    deadline = submit_started + timeout_s
    while time.monotonic() < deadline:
        status = requests.get(f"{base}/status/{call_id}", headers=headers, timeout=30)
        status.raise_for_status()
        body = status.json()
        if body.get("status") in ("completed", "failed"):
            break
        time.sleep(1.0)
    else:
        return {"status": "timeout", "error": f"no completion within {timeout_s}s"}
    body["latency_ms"] = round((time.monotonic() - submit_started) * 1000, 1)
    return body


def run_internal(job, timeout_s=None):
    sys.path.insert(0, str(RUNPOD_DIR))
    import handler  # noqa: import inside the GPU container only

    started = time.monotonic()
    result = handler.handler({"input": _payload(job), "id": f"bench-{job['seed']}-{job['fixture_id']}"})
    return {
        "status": "failed" if result.get("error") else "completed",
        "result": result,
        "latency_ms": round((time.monotonic() - started) * 1000, 1),
    }


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def _extract_images(result_body, images_dir, job_tag):
    result = result_body.get("result") or {}
    images = result.get("images") or (result.get("output") or {}).get("images") or []
    saved = []
    for idx, img in enumerate(images):
        if img.get("type") == "base64":
            import base64
            ext = Path(img.get("filename") or "out.png").suffix or ".png"
            path = Path(images_dir) / f"{job_tag}_{idx}{ext}"
            path.write_bytes(base64.b64decode(img["data"]))
            saved.append(str(path))
        elif img.get("type") == "s3_url":
            saved.append(img["data"])
    return saved


def run_benchmark(*, mode="http", endpoint=None, token=None, profiles=("baseline",),
                  presets=("Fast",), fixture_ids=None, categories=None, seeds=None,
                  cached_prompt=False, out_dir="bench-out", warmup=True,
                  max_jobs=None, max_minutes=None, dry_run=False,
                  regression_stop_pct=DEFAULT_REGRESSION_STOP_PCT, save_images=True):
    """Execute the matrix and write artifacts. Returns the summary dict."""
    import moss_config

    seeds = list(seeds or DEFAULT_SEEDS)
    fixtures = load_fixtures(ids=fixture_ids, categories=categories)
    configs = [{"profile": p, "preset": s} for p in profiles for s in presets]
    jobs = build_jobs(fixtures, seeds, configs, cached_prompt=cached_prompt)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "images").mkdir(exist_ok=True)
    (out / "workflows").mkdir(exist_ok=True)
    (out / "runtime").mkdir(exist_ok=True)

    _dump_effective_workflows(configs, out)
    _dump_runtime_manifest(profiles, out)

    if dry_run:
        lines = [f"DRY RUN — {len(jobs)} jobs across {len(configs)} configs, {len(fixtures)} fixtures"]
        for config in configs:
            from moss_config import RUNTIME_PROFILES
            profile = RUNTIME_PROFILES[config["profile"]]
            try:
                import moss_assets
                assets = moss_assets.required_asset_keys(profile, [config["preset"]])
            except Exception as e:  # noqa: BLE001 — dry run must list, not crash
                assets = f"asset check failed: {e}"
            lines.append(f"  profile={config['profile']} preset={config['preset']} assets={assets}")
        for job in jobs[:40]:
            lines.append(f"    {job['config']['profile']}/{job['config']['preset']} "
                         f"{job['fixture_id']} seed={job['seed']} {job['width']}x{job['height']} [{job['case']}]")
        if len(jobs) > 40:
            lines.append(f"    … and {len(jobs) - 40} more")
        report = "\n".join(lines)
        print(report)
        return {"dry_run": True, "jobs": len(jobs), "report": report}

    results_path = out / "results.jsonl"
    started = time.monotonic()
    executed = 0
    consecutive_errors = 0
    best_warm_median = {}   # (profile, preset) -> best median sampler ms so far
    warm_counts = {}        # (profile, preset) -> warm completed samples
    stop_reason = None
    runner = run_http if mode == "http" else run_internal

    # Per-config warmup: one unrecorded job so container/model caches exist.
    if warmup:
        warm_job = dict(jobs[0])
        warm_job["seed"] = (warm_job["seed"] + 999_983) % (2 ** 31)  # never collides
        print(f"[warmup] {warm_job['config']['profile']}/{warm_job['config']['preset']} "
              f"{warm_job['fixture_id']} …")
        try:
            runner(warm_job, endpoint=endpoint, token=token) if mode == "http" else runner(warm_job)
        except Exception as e:  # noqa: BLE001
            print(f"[warmup] failed (continuing): {e}")

    for job in jobs:
        if max_jobs is not None and executed >= max_jobs:
            stop_reason = "max_jobs reached"
            break
        if max_minutes is not None and (time.monotonic() - started) > max_minutes * 60:
            stop_reason = "max_minutes reached"
            break

        tag = f"{job['config']['profile']}-{job['config']['preset']}-{job['fixture_id']}-{job['seed']}"
        print(f"[run] {tag} [{job['case']}] …")
        try:
            body = runner(job, endpoint=endpoint, token=token) if mode == "http" else runner(job)
        except Exception as e:  # noqa: BLE001
            body = {"status": "error", "error": str(e)}

        executed += 1
        result = body.get("result") or {}
        error = body.get("error") or result.get("error")
        record = {
            "profile": job["config"]["profile"],
            "preset": job["config"]["preset"],
            "fixture_id": job["fixture_id"],
            "seed": job["seed"],
            "width": job["width"],
            "height": job["height"],
            "case": job["case"],
            "status": body.get("status"),
            "error": error,
            "latency_ms": body.get("latency_ms"),
            "metrics": result.get("metrics"),
            "generation": result.get("generation"),
            "seed_returned": result.get("seed"),
            "recorded_at": time.time(),
        }
        if save_images and body.get("status") == "completed":
            record["image_files"] = _extract_images(body, out / "images", tag)

        with open(results_path, "a") as f:
            f.write(json.dumps(record) + "\n")
            f.flush()
            os.fsync(f.fileno())

        if body.get("status") == "completed":
            consecutive_errors = 0
        else:
            consecutive_errors += 1
            if consecutive_errors >= CONSECUTIVE_ERROR_STOP:
                stop_reason = f"{CONSECUTIVE_ERROR_STOP} consecutive failures"
                break
            if error and "out of memory" in str(error).lower():
                stop_reason = "GPU OOM"
                break

        # Regression guard on warm sampler medians within this run: after 3+
        # warm samples for a config, stop if the median clearly regressed.
        if record["status"] == "completed" and not (record.get("generation") or {}).get("first_generation_in_worker"):
            sampler_ms = (record.get("metrics") or {}).get("observed_node_wall_ms", {}).get("sampler")
            if sampler_ms:
                key = (record["profile"], record["preset"])
                warm_counts[key] = warm_counts.get(key, 0) + 1
                best = best_warm_median.get(key)
                if best is None or sampler_ms < best:
                    best_warm_median[key] = sampler_ms
                    best = sampler_ms
                if warm_counts[key] >= 3:
                    recent = [
                        (r.get("metrics") or {}).get("observed_node_wall_ms", {}).get("sampler")
                        for r in _read_jsonl(results_path)
                        if (r["profile"], r["preset"]) == key
                        and r["status"] == "completed"
                        and not (r.get("generation") or {}).get("first_generation_in_worker")
                    ]
                    recent = [v for v in recent if v]
                    if recent:
                        median = statistics.median(recent)
                        if median > best * (1 + regression_stop_pct / 100):
                            stop_reason = (f"regression: {key} median {median:.0f}ms vs best "
                                           f"{best:.0f}ms (> {regression_stop_pct:.0f}%)")
                            break

    summary = summarize(results_path)
    summary["stop_reason"] = stop_reason or "completed all jobs"
    summary_text = render_summary(summary)
    (out / "summary.md").write_text(summary_text)
    print(summary_text)
    return summary


def _read_jsonl(path):
    records = []
    path = Path(path)
    if not path.exists():
        return records
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # torn final line from an interrupted run
    return records


def summarize(results_path):
    """Median/mean/spread per (profile, preset, case), split by worker when the
    scheduler hopped mid-run (worker ids recorded from server metrics)."""
    records = _read_jsonl(results_path)
    groups = {}
    for r in records:
        worker = (r.get("metrics") or {}).get("worker_instance_id") or "unknown"
        groups.setdefault((r["profile"], r["preset"], r["case"], worker), []).append(r)

    rows = []
    workers_per_config = {}
    for (profile, preset, case, worker), rs in sorted(groups.items()):
        key = (profile, preset, case)
        workers_per_config.setdefault(key, set()).add(worker)
        total = [r.get("metrics", {}).get("worker_total_ms") for r in rs if r.get("metrics")]
        total = [v for v in total if v is not None]
        sampler = [(r.get("metrics") or {}).get("observed_node_wall_ms", {}).get("sampler") for r in rs]
        sampler = [v for v in sampler if v]
        row = {
            "profile": profile, "preset": preset, "case": case, "worker": worker,
            "n": len(rs),
            "completed": sum(1 for r in rs if r["status"] == "completed"),
            "worker_total_ms_median": round(statistics.median(total), 1) if total else None,
            "worker_total_ms_mean": round(statistics.fmean(total), 1) if total else None,
            "sampler_ms_median": round(statistics.median(sampler), 1) if sampler else None,
            "latency_ms_median": round(statistics.median([r["latency_ms"] for r in rs if r.get("latency_ms")]), 1)
            if any(r.get("latency_ms") for r in rs) else None,
            "first_gen_in_worker": sum(1 for r in rs if (r.get("generation") or {}).get("first_generation_in_worker")),
        }
        rows.append(row)
    split_keys = [f"{k[0]}/{k[1]}/{k[2]}" for k, w in workers_per_config.items() if len(w) > 1]
    return {"rows": rows, "worker_split_configs": sorted(set(split_keys)), "total_records": len(records)}


def render_summary(summary):
    lines = ["# MOSS benchmark summary", ""]
    if summary.get("worker_split_configs"):
        lines.append(f"NOTE: multiple workers observed for {', '.join(summary['worker_split_configs'])} — "
                     f"compare rows per worker, not across them.")
        lines.append("")
    header = "| profile | preset | case | worker | n | ok | worker_total med (ms) | sampler med (ms) | latency med (ms) | first-in-worker |"
    lines += [header, "|---|---|---|---|---|---|---|---|---|---|"]
    for row in summary["rows"]:
        lines.append(
            f"| {row['profile']} | {row['preset']} | {row['case']} | {row['worker']} | {row['n']} "
            f"| {row['completed']} | {row['worker_total_ms_median']} | {row['sampler_ms_median']} "
            f"| {row['latency_ms_median']} | {row['first_gen_in_worker']} |")
    lines += ["", f"records: {summary['total_records']}; stop: {summary.get('stop_reason')}"]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="MOSS benchmark runner")
    parser.add_argument("--mode", choices=["http", "internal"], default="http")
    parser.add_argument("--endpoint", default=os.environ.get("MOSS_BENCH_ENDPOINT"))
    parser.add_argument("--token", default=os.environ.get("MOSS_BENCH_TOKEN"))
    parser.add_argument("--profiles", default="baseline")
    parser.add_argument("--presets", default="Fast")
    parser.add_argument("--fixtures", default="", help="Comma-separated fixture ids")
    parser.add_argument("--categories", default="", help="Comma-separated fixture categories")
    parser.add_argument("--seeds", default=",".join(map(str, DEFAULT_SEEDS)))
    parser.add_argument("--cached-prompt", action="store_true", help="Repeat one fixture (text-encode cache case)")
    parser.add_argument("--out", default="bench-out")
    parser.add_argument("--no-warmup", action="store_true")
    parser.add_argument("--max-jobs", type=int, default=None)
    parser.add_argument("--max-minutes", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--regression-stop-pct", type=float, default=DEFAULT_REGRESSION_STOP_PCT)
    args = parser.parse_args(argv)

    if args.mode == "http" and not args.endpoint:
        parser.error("--endpoint (or MOSS_BENCH_ENDPOINT) is required in http mode")

    run_benchmark(
        mode=args.mode,
        endpoint=args.endpoint,
        token=args.token,
        profiles=[p.strip() for p in args.profiles.split(",") if p.strip()],
        presets=[p.strip() for p in args.presets.split(",") if p.strip()],
        fixture_ids=[f.strip() for f in args.fixtures.split(",") if f.strip()] or None,
        categories=[c.strip() for c in args.categories.split(",") if c.strip()] or None,
        seeds=[int(s) for s in args.seeds.split(",") if s.strip()],
        cached_prompt=args.cached_prompt,
        out_dir=args.out,
        warmup=not args.no_warmup,
        max_jobs=args.max_jobs,
        max_minutes=args.max_minutes,
        dry_run=args.dry_run,
        regression_stop_pct=args.regression_stop_pct,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
