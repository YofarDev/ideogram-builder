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
        --profiles baseline --presets Fast \
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
DEFAULT_REGRESSION_STOP_PCT = 50  # matched first-three vs latest-three warm medians


# ---------------------------------------------------------------------------
# Fixtures — compiled with the exact buildMossLayout maths (src/prompt-moss.js)
# ---------------------------------------------------------------------------

def load_fixtures(path=None, ids=None, categories=None):
    data = json.loads(Path(path or FIXTURES_PATH).read_text())
    fixtures = data["fixtures"]
    if ids and set(ids) - {f["id"] for f in fixtures}:
        raise ValueError(f"Unknown fixture ids: {sorted(set(ids) - {f['id'] for f in fixtures})}")
    if ids:
        wanted = set(ids)
        fixtures = [f for f in fixtures if f["id"] in wanted]
    if categories:
        wanted = set(categories)
        fixtures = [f for f in fixtures if f["category"] in wanted]
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
    # ensure_ascii=False matches the UI's JSON.stringify: CJK text reaches the
    # encoder as real UTF-8, not \uXXXX escapes the model would render as
    # garbled digit/character mixtures.
    return json.dumps(layout, ensure_ascii=False)


def build_jobs(fixtures, seeds, configs, cached_prompt=False):
    """One job per (config, fixture, seed), ordered seed-major with a rotating
    config offset per seed: counterbalanced so no preset systematically runs
    first (cache/GPU-drift bias) while same-preset steady-state repeats remain
    within each config block. Preset-switch costs are reported separately via
    the `switched` flag computed at execution time.

    prompt_variant is unique per (config, seed) — trailing JSON whitespace is
    ignored by the parser (parsed layout preserved) but changes the encoder
    node's input hash, so the positive encoder really executes for every
    measured request, including across presets sharing a fixture+seed.
    cached_prompt runs keep the input identical (variant 0) so warm prompts
    demonstrate real cache hits."""
    jobs = []
    if cached_prompt:
        # Cache-hit case: keep each (config, fixture) prompt grouped so warm
        # prompts demonstrate real text-encode cache hits across repeated seeds.
        for config in configs:
            for f in fixtures:
                for seed in seeds:
                    width, height = f["dims"]
                    jobs.append({"config": config, "config_index": configs.index(config),
                                 "fixture_id": f["id"], "seed": seed,
                                 "width": width, "height": height,
                                 "case": "cached-prompt", "prompt_variant": 0})
        return jobs
    # Fresh-prompt comparison: seed-major with a rotating config offset per
    # seed (counterbalanced preset order), each measured request a unique
    # encoder input via prompt_variant.
    for seed_index, seed in enumerate(seeds):
        rotated = configs[seed_index % len(configs):] + configs[:seed_index % len(configs)]
        for config in rotated:
            for f in fixtures:
                width, height = f["dims"]
                jobs.append({
                    "config": config, "config_index": configs.index(config),
                    "fixture_id": f["id"], "seed": seed,
                    "width": width, "height": height,
                    "case": "new-prompt",
                    "prompt_variant": 1 + configs.index(config) + seed_index * len(configs),
                })
    return jobs


# ---------------------------------------------------------------------------
# Execution backends
# ---------------------------------------------------------------------------

def _payload(job):
    fixture = _fixture_by_id(job["fixture_id"])
    return {
        "model": "moss",
        "import_json": compile_fixture_layout(fixture, job["width"], job["height"]) + " " * job.get("prompt_variant", 0),
        "width": job["width"],
        "height": job["height"],
        "preset": job["config"]["preset"],
        "negative_prompt": "",
        "seed": job["seed"],
        "loras": job.get("loras", []),
    }


_FIXTURES_BY_ID = {}


def _fixture_by_id(fixture_id):
    if not _FIXTURES_BY_ID:
        for f in load_fixtures():
            _FIXTURES_BY_ID[f["id"]] = f
    return _FIXTURES_BY_ID[fixture_id]


def run_http(job, endpoint, token, timeout_s=900):
    import requests

    base = endpoint.rstrip("/").removesuffix("/generate")
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

    from moss_config import resolve_profile
    actual = resolve_profile()["profile_id"]
    if actual != job["config"]["profile"]:
        raise RuntimeError(f"Requested {job['config']['profile']}, running {actual}; use BenchmarkWorkers to change profiles")
    started = time.monotonic()
    os.environ["MOSS_BENCHMARK_MODE"] = "true"
    os.environ["MOSS_METRICS"] = "on"
    os.environ["MOSS_BENCHMARK_DEADLINE"] = str(started + (timeout_s or 900))
    from moss_memory import MemorySampler
    with MemorySampler() as memory:
        handler_started = time.monotonic()
        result = handler.handler({"input": _payload(job), "id": f"bench-{job['seed']}-{job['fixture_id']}"})
        handler_latency_ms = round((time.monotonic() - handler_started) * 1000, 1)
    result.setdefault("benchmark", {})["memory"] = memory.result()
    return {
        "status": "failed" if result.get("error") else "completed",
        "result": result,
        "latency_ms": handler_latency_ms,
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
                  regression_stop_pct=DEFAULT_REGRESSION_STOP_PCT, save_images=True, runner=None, endpoints=None,
                  loras=None, width=None, height=None, ocr=False):
    """Execute the matrix and write artifacts. Returns the summary dict."""
    import moss_config

    if mode not in ("http", "internal"):
        raise ValueError("mode must be http or internal")
    if (width is None) != (height is None):
        raise ValueError("Provide both width and height")
    if width is not None and any(isinstance(v, bool) or not isinstance(v, int) or v <= 0 or v % 16 for v in (width, height)):
        raise ValueError("Dimensions must be positive integers divisible by 16")
    seeds = list(DEFAULT_SEEDS if seeds is None else seeds)
    if not seeds or len(seeds) != len(set(seeds)):
        raise ValueError("Provide nonempty distinct seeds so image results cannot be cached")
    fixtures = load_fixtures(ids=fixture_ids, categories=categories)
    configs = [{"profile": p, "preset": s} for p in profiles for s in presets]
    if not fixtures or not configs:
        raise ValueError("Select at least one fixture, profile and preset")
    for config in configs:
        profile = moss_config.resolve_profile({"MOSS_RUNTIME_PROFILE": config["profile"]})
        supported = profile["enabled_presets"] + (moss_config.BENCHMARK_PRESET_IDS if "Fast" in profile["enabled_presets"] else ())
        if config["preset"] not in supported:
            raise ValueError(f"{config['preset']} is unsupported by {config['profile']}")
        for fixture in fixtures:
            moss_config.effective_preset(config["preset"], *( (width, height) if width is not None else fixture["dims"] ))
    jobs = build_jobs(fixtures, seeds, configs, cached_prompt=cached_prompt)
    for job in jobs:
        job["loras"] = loras or []
        if width is not None:
            job.update(width=width, height=height)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "images").mkdir(exist_ok=True)
    (out / "workflows").mkdir(exist_ok=True)
    (out / "runtime").mkdir(exist_ok=True)

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

    if mode == "http" and endpoints and set(profiles) - set(endpoints):
        raise ValueError("Endpoint map must include every requested profile")
    if mode == "http" and len(profiles) > 1 and not endpoints and runner is None:
        raise ValueError("Multiple HTTP profiles require a profile-to-endpoint map of isolated deployments")
    results_path = out / "results.jsonl"
    warmups_path = out / "warmups.jsonl"
    if results_path.exists() or warmups_path.exists():
        raise ValueError("Output already contains results; use a fresh run directory")
    started = time.monotonic()
    executed = 0
    consecutive_errors = 0
    warm_samples = {}
    warmed = set()
    stop_reason = None
    last_executed_config = None
    last_executed_worker = None
    observed_workers = {}
    execute = runner or (run_http if mode == "http" else run_internal)

    def run(job):
        nonlocal last_executed_config, last_executed_worker
        remaining = 900 if max_minutes is None else min(900, max_minutes * 60 - (time.monotonic() - started))
        if remaining <= 0:
            return {"status": "timeout", "error": "max_minutes reached"}
        kwargs = {"timeout_s": remaining}
        if mode == "http":
            kwargs.update(endpoint=(endpoints or {}).get(job['config']['profile'], endpoint), token=token)
        current_config = (job["config"]["profile"], job["config"]["preset"])
        switched = last_executed_config is not None and last_executed_config != current_config
        last_executed_config = current_config
        body = execute(job, **kwargs)
        result = body.get("result") or {}
        worker = (result.get("metrics") or {}).get("worker_instance_id")
        if worker:
            # A fresh server is startup cost, not an in-residence preset switch.
            if last_executed_worker is not None and worker != last_executed_worker:
                switched = False
            previous_worker = observed_workers.get(current_config[0])
            if previous_worker is not None and worker != previous_worker:
                warmed.difference_update(key for key in tuple(warmed) if key[0] == current_config[0])
            observed_workers[current_config[0]] = worker
        last_executed_worker = worker
        body["_benchmark_switched"] = switched
        if result.get("error") or result.get("errors"):
            body["status"] = "failed"
            body["error"] = result.get("error") or str(result["errors"])
        if body.get("status") == "completed":
            actual = (result.get("generation") or {}).get("runtime_profile")
            if actual != job['config']['profile']:
                return {"status": "failed", "error": f"Profile mismatch: requested {job['config']['profile']}, executed {actual}"}
            artifacts = result.get("benchmark") or {}
            if artifacts.get("workflow"):
                tag = f"{job['config']['profile']}-{job['config']['preset']}-{job['fixture_id']}-{job['seed']}"
                (out / "workflows" / f"{tag}.json").write_text(json.dumps(artifacts['workflow'], indent=2))
            if artifacts.get("runtime"):
                (out / "runtime" / f"{job['config']['profile']}.json").write_text(json.dumps(artifacts['runtime'], indent=2))
        return body

    for job in jobs:
        if max_jobs is not None and executed >= max_jobs:
            stop_reason = "max_jobs reached"
            break
        if max_minutes is not None and (time.monotonic() - started) > max_minutes * 60:
            stop_reason = "max_minutes reached"
            break

        # Internal profile changes replace ComfyUI before execution. Its old
        # prompt/shape warmups cannot be reused when that profile is revisited.
        if mode == "internal" and last_executed_config is not None and last_executed_config[0] != job['config']['profile']:
            warmed.difference_update(key for key in tuple(warmed) if key[0] == job['config']['profile'])
        warm_key = (job['config']['profile'], job['config']['preset'], job['fixture_id'], job['width'], job['height'])
        if warmup and warm_key not in warmed:
            warm_job = dict(job)
            warm_job['seed'] = max(seeds) + 1
            if not cached_prompt:
                warm_job['prompt_variant'] = len(seeds) + 2
            print(f"[warmup] {warm_key}")
            try:
                warm_body = run(warm_job)
                if warm_body.get('status') != 'completed':
                    raise RuntimeError(warm_body.get('error') or 'warmup failed')
            except Exception as error:
                stop_reason = f"warmup failed: {error}"
                break
            warmed.add(warm_key)
            # First-use cost is evidence too — persisted separately from the
            # measured population, never silently discarded.
            warm_result = warm_body.get("result") or {}
            with open(warmups_path, "a") as f:
                f.write(json.dumps({
                    "profile": job["config"]["profile"], "preset": job["config"]["preset"],
                    "fixture_id": job["fixture_id"], "width": job["width"], "height": job["height"],
                    "seed": warm_job["seed"], "status": warm_body.get("status"),
                    "switched": warm_body.get("_benchmark_switched", False),
                    "latency_ms": warm_body.get("latency_ms"),
                    "metrics": warm_result.get("metrics"),
                    "generation": warm_result.get("generation"),
                    "recorded_at": time.time(),
                }) + "\n")
        tag = f"{job['config']['profile']}-{job['config']['preset']}-{job['fixture_id']}-{job['seed']}"
        print(f"[run] {tag} [{job['case']}] …")
        try:
            body = run(job)
        except Exception as e:  # noqa: BLE001
            body = {"status": "error", "error": str(e)}
        switched = body.get("_benchmark_switched", False)

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
            "switched": switched,
            "status": body.get("status"),
            "error": error,
            "latency_ms": body.get("latency_ms"),
            "metrics": result.get("metrics"),
            "cache_state": cache_state(result.get("metrics") or {}),
            "memory": (result.get("benchmark") or {}).get("memory"),
            "generation": result.get("generation"),
            "loras": job.get("loras", []),
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

        # Compare three-sample medians only within the same fixture, dimensions,
        # cache state and worker, excluding cold, failed and incomplete samples.
        if eligible(record) and not (record.get("generation") or {}).get("first_generation_in_worker"):
            sampler = record["metrics"].get("observed_node_wall_ms", {}).get("sampler")
            if sampler:
                key = cohort(record)
                samples = warm_samples.setdefault(key, [])
                samples.append(sampler)
                if len(samples) >= 6:
                    reference, recent = statistics.median(samples[:3]), statistics.median(samples[-3:])
                    if recent > reference * (1 + regression_stop_pct / 100):
                        stop_reason = f"regression: {key} recent median {recent:.0f}ms vs reference {reference:.0f}ms"
                        break

    records = _read_jsonl(results_path)
    review = write_review_sheet(out, records, ocr=ocr)
    summary = summarize(results_path)
    summary["stop_reason"] = stop_reason or "completed all jobs"
    summary["switched_jobs"] = sum(1 for r in records if r.get("switched"))
    summary["review_sheet"] = str(review)
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


def cache_state(metrics):
    text = {node for node, stage in metrics.get("node_stage_map", {}).items() if stage.startswith("text_encode")}
    if not text:
        return "unknown"
    cached = set(metrics.get("cached_node_ids", []))
    if text <= cached:
        return "cached"
    observed = metrics.get("observed_node_wall_ms", {})
    return "uncached" if any(stage.startswith("text_encode") for stage in observed) else "unknown"


def eligible(record):
    return record.get("status") == "completed" and not record.get("error") and (record.get("metrics") or {}).get("measurement_complete") is True


def cohort(r):
    return (r['profile'], r['preset'], r['fixture_id'], r['width'], r['height'], r['case'],
            (r.get('metrics') or {}).get('worker_instance_id', 'unknown'),
            bool((r.get('generation') or {}).get('first_generation_in_worker')),
            r.get('cache_state', 'unknown'), bool(r.get('switched', False)))


def summarize(results_path):
    """Comparable cohorts only. Failures/partial timings remain counted, excluded from medians."""
    records = _read_jsonl(results_path)
    groups, workers = {}, {}
    for record in records:
        groups.setdefault(cohort(record), []).append(record)
        key = (record['profile'], record['preset'], record['case'])
        workers.setdefault(key, set()).add((record.get('metrics') or {}).get('worker_instance_id', 'unknown'))
    rows = []
    for key, rs in sorted(groups.items()):
        profile, preset, fixture, width, height, case, worker, cold, cached, switched = key
        valid = [r for r in rs if eligible(r)]
        def median(values):
            values = [v for v in values if v is not None]
            return round(statistics.median(values), 1) if values else None
        total = [(r.get('metrics') or {}).get('worker_total_ms') for r in valid]
        rows.append({
            'profile': profile, 'preset': preset, 'fixture': fixture, 'width': width, 'height': height,
            'case': case, 'worker': worker, 'cold': cold, 'cache_state': cached, 'switched': switched,
            'n': len(rs), 'completed': sum(r.get('status') == 'completed' for r in rs),
            'valid_timings': len(valid), 'first_gen_in_worker': sum(bool((r.get('generation') or {}).get('first_generation_in_worker')) for r in rs),
            'worker_total_ms_median': median(total),
            'worker_total_ms_mean': round(statistics.fmean(v for v in total if v is not None), 1) if any(v is not None for v in total) else None,
            'sampler_ms_median': median([(r.get('metrics') or {}).get('observed_node_wall_ms', {}).get('sampler') for r in valid]),
            'latency_ms_median': median([r.get('latency_ms') for r in valid]),
        })
    return {'rows': rows, 'worker_split_configs': sorted('/'.join(k) for k, w in workers.items() if len(w) > 1), 'total_records': len(records)}


def render_summary(summary):
    lines = ["# MOSS benchmark summary", ""]
    if summary.get("worker_split_configs"):
        lines.append(f"NOTE: multiple workers observed for {', '.join(summary['worker_split_configs'])} — "
                     f"compare rows per worker, not across them.")
        lines.append("")
    header = "| profile | preset | fixture / size | case / cache / cold / switched | worker | n | ok / valid | worker_total med (ms) | sampler med (ms) | latency med (ms) | first-in-worker |"
    lines += [header, "|---|---|---|---|---|---|---|---|---|---|---|"]
    for row in summary["rows"]:
        lines.append(
            f"| {row['profile']} | {row['preset']} | {row['fixture']} {row['width']}×{row['height']} | {row['case']} / {row['cache_state']} / {row['cold']} / {row['switched']} | {row['worker']} | {row['n']} "
            f"| {row['completed']} / {row['valid_timings']} | {row['worker_total_ms_median']} | {row['sampler_ms_median']} "
            f"| {row['latency_ms_median']} | {row['first_gen_in_worker']} |")
    lines += ["", f"records: {summary['total_records']}; stop: {summary.get('stop_reason')}"]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Quality evidence: review sheet, optional OCR transcription and CER
# ---------------------------------------------------------------------------

def _levenshtein(a, b):
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def character_error_rate(expected, observed):
    """CER in [0, ∞) against the fixture's expected string, normalized
    (casefold, whitespace collapsed). Empty observations count as deletions;
    returns None when the reference is empty."""
    normalize = lambda s: " ".join((s or "").casefold().split())  # noqa: E731
    expected, observed = normalize(expected), normalize(observed)
    if not expected:
        return None
    return _levenshtein(expected, observed) / len(expected)


def _ocr_transcriber():
    """Optional OCR: only used when the dependency is installed AND requested;
    the exact package + version is recorded with every transcription so scores
    are attributable. No silent fallbacks."""
    try:
        from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415
        import importlib.metadata

        version = importlib.metadata.version("rapidocr_onnxruntime")
    except Exception:
        return None
    engine = RapidOCR()

    def transcribe(image_path):
        result, _elapsed = engine(str(image_path))
        text = " ".join((line[1] or "") for line in (result or []))
        return text.strip()

    return transcribe, version


def write_review_sheet(out_dir, records, ocr=False):
    """Human review sheet beside the run artifacts: per completed measured
    image, the expected text, a blank observed column, and — when OCR was
    enabled and available — a machine transcription with CER. Presence of PNG
    bytes is never treated as quality evidence; unmeasured stays unmeasured."""
    out_dir = Path(out_dir)
    ocr_entry = _ocr_transcriber() if ocr else None
    ocr_info = {"enabled": ocr, "available": bool(ocr_entry)}
    if ocr_entry:
        ocr_info["package"] = "rapidocr_onnxruntime"
        ocr_info["version"] = ocr_entry[1]
    elif ocr:
        ocr_info["note"] = "rapidocr_onnxruntime not installed — transcription left for manual review"

    fixtures = _FIXTURES_BY_ID or {}
    lines = [
        "# MOSS quality review sheet",
        "",
        f"- OCR: {ocr_info}",
        "- Transcribe observed text manually where OCR is unavailable; numeric errors column is for digit substitutions.",
        "",
        "| image | profile | preset | fixture | seed | expected text | observed | numeric errors | faces/hands | naturalness | CER |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    ocr_records = []
    for record in records:
        if record.get("status") != "completed":
            continue
        fixture = fixtures.get(record["fixture_id"]) or {}
        expected = " · ".join(fixture.get("expected_text", [])) or "—"
        image_path = (record.get("image_files") or ["—"])[0]
        observed, cer = "", ""
        if ocr_entry and record.get("image_files"):
            try:
                observed = ocr_entry[0](image_path)
                # Score all required text in fixture reading order. Choosing
                # the best individual label rewards omission of other labels.
                reference = " ".join(fixture.get("expected_text", []))
                score = character_error_rate(reference, observed)
                cer = f"{score:.3f}" if score is not None else "n/a"
                ocr_records.append({"image": str(image_path), "expected": reference,
                                    "observed": observed, "cer": score})
            except Exception as error:  # noqa: BLE001 — OCR must never fail the sheet
                observed = f"OCR error: {error}"
        lines.append(
            f"| {Path(str(image_path)).name} | {record['profile']} | {record['preset']} "
            f"| {record['fixture_id']} | {record['seed']} | {expected} | {observed or ' '} "
            f"| | | | {cer or ' '} |")
    sheet = out_dir / "review-sheet.md"
    sheet.write_text("\n".join(lines) + "\n")
    if ocr_records:
        with open(out_dir / "ocr.jsonl", "w") as f:
            for entry in ocr_records:
                f.write(json.dumps(entry) + "\n")
    return sheet


def main(argv=None):
    parser = argparse.ArgumentParser(description="MOSS benchmark runner")
    parser.add_argument("--mode", choices=["http", "internal"], default="http")
    parser.add_argument("--endpoint", default=os.environ.get("MOSS_BENCH_ENDPOINT"))
    parser.add_argument("--endpoints", help="JSON profile-to-endpoint map; separate deployments for HTTP comparisons")
    parser.add_argument("--token", default=os.environ.get("MOSS_BENCH_TOKEN"))
    parser.add_argument("--profiles", default="baseline")
    parser.add_argument("--presets", default="Fast")
    parser.add_argument("--loras-json", default="[]", help="LoRA request array; same format as production")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
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
    parser.add_argument("--ocr", action="store_true",
                        help="Transcribe saved images with rapidocr_onnxruntime (version recorded) and compute CER")
    args = parser.parse_args(argv)

    if args.mode == "http" and not (args.endpoint or args.endpoints) and not args.dry_run:
        parser.error("--endpoint (or MOSS_BENCH_ENDPOINT) is required in http mode")

    run_benchmark(
        mode=args.mode,
        endpoint=args.endpoint,
        endpoints=json.loads(args.endpoints) if args.endpoints else None,
        token=args.token,
        loras=json.loads(args.loras_json), width=args.width, height=args.height,
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
        ocr=args.ocr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
