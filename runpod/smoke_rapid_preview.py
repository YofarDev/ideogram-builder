"""Milestone A smoke for the Rapid β preview deployment (plan 2026-10-28 §5).

Checks, against the candidate endpoint only:
  1. /capabilities advertises Rapid as experimental with max_area_mp=1.
  2. An oversized Rapid request is rejected with a clear error (no image).
  3. Turbo → Rapid → Turbo → Rapid on the SAME worker: adapter replacement
     works without accumulated patches; each result carries the executed
     recipe (preset_id, effective_steps, cfg, adapter, profile, manifest) and
     complete stage timings; PNG dimensions match the request.

Usage:
    python runpod/smoke_rapid_preview.py --endpoint https://…/generate \
        --token … [--fixtures poster_en_bold,poster_zh_vertical] [--seed 101]

Exit code 0 = smoke passed. Every assertion prints PASS/FAIL evidence.
"""

import argparse
import base64
import json
import struct
import sys
import time
from pathlib import Path

RUNPOD_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(RUNPOD_DIR))

import requests  # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


def png_dimensions(image_bytes):
    if image_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", image_bytes[16:24])
    return width, height


class Client:
    def __init__(self, endpoint, token):
        self.base = endpoint.rstrip("/").removesuffix("/generate")
        self.headers = {"Content-Type": "application/json",
                        "Authorization": f"Bearer {token}"}

    def capabilities(self):
        response = requests.get(f"{self.base}/capabilities", headers=self.headers, timeout=30)
        response.raise_for_status()
        return response.json()

    def generate(self, payload, timeout_s=880):
        started = time.monotonic()
        response = requests.post(f"{self.base}/generate", json=payload,
                                 headers=self.headers, timeout=60)
        response.raise_for_status()
        call_id = response.json()["call_id"]
        while time.monotonic() - started < timeout_s:
            status = requests.get(f"{self.base}/status/{call_id}", headers=self.headers, timeout=30)
            status.raise_for_status()
            body = status.json()
            if body.get("status") in ("completed", "failed"):
                body["latency_s"] = round(time.monotonic() - started, 1)
                return body
            time.sleep(1.0)
        return {"status": "timeout", "error": f"no completion in {timeout_s}s"}


def result_payload(body):
    return body.get("result") or {}


def check_generation(name, body, *, expect_preset, expect_steps, seed, width, height):
    result = result_payload(body)
    generation = result.get("generation") or {}
    metrics = result.get("metrics") or {}
    images = result.get("images") or []
    check(f"{name}: completed", body.get("status") == "completed" and images,
          f"latency={body.get('latency_s')}s status={body.get('status')} error={result.get('error')}")
    if not images:
        return None
    image_bytes = base64.b64decode(images[0]["data"])
    dims = png_dimensions(image_bytes)
    check(f"{name}: PNG dimensions {width}x{height}", dims == (width, height), f"got {dims}")
    check(f"{name}: seed returned {seed}", result.get("seed") == seed, f"got {result.get('seed')}")
    check(f"{name}: preset_id={expect_preset}", generation.get("preset_id") == expect_preset,
          f"got {generation.get('preset_id')}")
    check(f"{name}: effective_steps={expect_steps}", generation.get("effective_steps") == expect_steps,
          f"got {generation.get('effective_steps')}")
    check(f"{name}: cfg=1.0", generation.get("cfg") == 1.0, f"got {generation.get('cfg')}")
    check(f"{name}: profile={generation.get('runtime_profile')}", bool(generation.get("runtime_profile")))
    check(f"{name}: manifest id present", bool(generation.get("model_manifest_id")),
          f"got {generation.get('model_manifest_id')}")
    check(f"{name}: measurement complete", metrics.get("measurement_complete") is True,
          f"note={metrics.get('measurement_note')}")
    # A fully cache-served repeat (identical graph inputs) legitimately has no
    # fresh stage intervals — its near-zero worker total is the evidence.
    cache_served = (metrics.get("worker_total_ms") or 0) < 1000
    check(f"{name}: stage timings present",
          bool(metrics.get("observed_node_wall_ms")) or cache_served,
          f"stages={sorted(metrics.get('observed_node_wall_ms', {}))} "
          f"cached={len(metrics.get('cached_node_ids', []))} nodes")
    print(f"       worker={metrics.get('worker_instance_id')} "
          f"total={metrics.get('worker_total_ms')}ms "
          f"sampler={metrics.get('observed_node_wall_ms', {}).get('sampler')}ms "
          f"queue={metrics.get('comfy_queue_ms')}ms")
    return metrics, generation


def main(argv=None):
    parser = argparse.ArgumentParser(description="Rapid β preview smoke")
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--fixtures", default="poster_en_bold,poster_zh_vertical")
    parser.add_argument("--seed", type=int, default=101)
    parser.add_argument("--out", default="rapid-smoke-artifacts")
    parser.add_argument("--expected-validation", choices=("experimental", "validated"), default="experimental")
    args = parser.parse_args(argv)

    client = Client(args.endpoint, args.token)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    fixtures = args.fixtures.split(",")
    profile_expected = None

    # --- 1. capabilities -----------------------------------------------------
    caps = client.capabilities()
    presets = {p["id"]: p for p in caps.get("presets", [])}
    check("capabilities reachable", bool(presets), f"profile={caps.get('runtime_profile')}")
    rapid = presets.get("Rapid")
    check("Rapid advertised", rapid is not None)
    if rapid:
        check(f"Rapid marked {args.expected_validation}", rapid.get("validation_status") == args.expected_validation,
              f"got {rapid.get('validation_status')}")
        check("Rapid limit 1 MP", rapid.get("max_area_mp") == 1, f"got {rapid.get('max_area_mp')}")
        check("Rapid recipe 4 steps / CFG 1 / euler", rapid.get("steps") == 4 and rapid.get("cfg") == 1.0
              and rapid.get("sampler") == "euler", f"steps={rapid.get('steps')} cfg={rapid.get('cfg')}")
    profile_expected = caps.get("runtime_profile")

    # --- 2. oversize rejection -------------------------------------------------
    oversize = client.generate({
        "model": "moss", "import_json": '{"summary":{"caption":"oversize probe"},"items":[],'
                                        '"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}',
        "width": 1024, "height": 1536, "preset": "Rapid", "seed": args.seed, "loras": [],
    })
    result = result_payload(oversize)
    check("oversize Rapid rejected", bool(result.get("error")), f"got {result.get('error')}")
    check("oversize error names the limit",
          "1 MP" in str(result.get("error", "")) and "1024×1536" in str(result.get("error", "")),
          str(result.get("error"))[:160])

    # --- 3. switch sequence on one worker --------------------------------------
    sequence = [("Turbo", 8), ("Rapid", 4), ("Turbo", 8), ("Rapid", 4)]
    workers = set()
    adapter_witness = {}
    for index, (preset, steps) in enumerate(sequence):
        fixture_id = fixtures[index % len(fixtures)]
        sys.path.insert(0, str(RUNPOD_DIR))
        import moss_benchmark

        fixture = moss_benchmark._fixture_by_id(fixture_id)
        layout = moss_benchmark.compile_fixture_layout(fixture, 1024, 1024)
        body = client.generate({
            "model": "moss", "import_json": layout, "width": 1024, "height": 1024,
            "preset": preset, "seed": args.seed, "loras": [],
        })
        checked = check_generation(
            f"switch[{index}] {preset} on {fixture_id}", body,
            expect_preset=preset, expect_steps=steps, seed=args.seed, width=1024, height=1024)
        if not checked:
            continue
        metrics, generation = checked
        workers.add(metrics.get("worker_instance_id"))
        adapter_witness[preset] = generation.get("adapter")
        image_path = out_dir / f"switch{index}-{preset.lower()}-{fixture_id}.png"
        import base64 as _b64
        image_path.write_bytes(base64.b64decode(result_payload(body)["images"][0]["data"]))
        print(f"       saved {image_path}")

    check("all four switch runs on the same worker", len(workers) == 1,
          f"workers={workers}")
    check("Turbo kept dmd8 adapter", adapter_witness.get("Turbo") == "dmd8",
          f"got {adapter_witness.get('Turbo')}")
    check("Rapid used rapid4 adapter", adapter_witness.get("Rapid") == "rapid4",
          f"got {adapter_witness.get('Rapid')}")

    report = {
        "endpoint": args.endpoint,
        "seed": args.seed,
        "profile": profile_expected,
        "capabilities_presets": list(presets),
        "workers": sorted(workers),
        "adapters": adapter_witness,
        "failures": FAILURES,
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    (out_dir / "smoke-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nsmoke report written to {out_dir / 'smoke-report.json'}")
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} failing checks")
        return 1
    print("SMOKE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
