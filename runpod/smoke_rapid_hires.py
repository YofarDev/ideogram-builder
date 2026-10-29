"""Bounded Rapid resolution smoke using the configured Modal token privately.

    python runpod/smoke_rapid_hires.py --endpoint https://…/generate --out output/rapid-hires

Saves images and executed recipes; never writes credentials or base64 to logs.
"""
import argparse
import base64
import json
from datetime import datetime, timezone
from pathlib import Path

from moss_benchmark import _fixture_by_id, compile_fixture_layout
from smoke_rapid_preview import Client, FAILURES, check, check_generation, result_payload


PROFILE = "rapid-hires-auto-int8-cu128"
CAPTION = (
    "A red fox standing alone in fresh snow in a quiet pine forest at dawn. "
    "The fox has vivid orange fur, black legs, a white chest and a bushy tail, "
    "and looks toward the camera. Snow-covered branches frame the scene, "
    "with soft golden light from the left and a misty blue background. "
    "Natural wildlife photography with realistic fur and gentle depth of field."
)


def adapter_switch_worker(records):
    """Witness a resident adapter replacement without requiring sticky routing
    for unrelated requests on an autoscaling production deployment."""
    for previous, current in zip(records, records[1:]):
        before, after = previous.get("generation") or {}, current.get("generation") or {}
        worker = (previous.get("metrics") or {}).get("worker_instance_id")
        if (worker and worker == (current.get("metrics") or {}).get("worker_instance_id")
                and before.get("adapter") == "dmd8" and after.get("adapter") == "rapid4"
                and previous.get("status") == current.get("status") == "completed"):
            return worker
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", help="Defaults to the configured production endpoint")
    parser.add_argument("--out", required=True)
    parser.add_argument("--expected-validation", choices=("experimental", "validated"), default="experimental")
    parser.add_argument("--seed", type=int, default=20261029)
    args = parser.parse_args(argv)
    credentials = json.loads((Path.home() / ".config/llm-credentials.json").read_text())["modal"]
    client = Client(args.endpoint or credentials["endpoint_url"], credentials["auth_token"])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    FAILURES.clear()
    caps = client.capabilities()
    (out / "capabilities.json").write_text(json.dumps(caps, indent=2) + "\n")
    rapid = next((p for p in caps.get("presets", []) if p["id"] == "Rapid"), {})
    check("high-resolution profile", caps.get("runtime_profile") == PROFILE)
    check("Rapid up to 4 MP", rapid.get("max_area_mp") == 4)
    check("matching restriction", caps.get("restrictions", {}).get("rapid_max_area_mp") == 4)
    check("validation status", rapid.get("validation_status") == args.expected_validation)
    if FAILURES:
        return 1

    print("Checking oversize rejection", flush=True)
    oversize = client.generate(dict(model="moss", import_json=CAPTION, width=2048, height=2064,
                                    preset="Rapid", seed=args.seed, loras=[]))
    error = str(result_payload(oversize).get("error", ""))
    check("above 4 MP rejected without image", bool(error) and not result_payload(oversize).get("images"), error)
    if FAILURES:
        return 1

    sequence = [
        ("rapid-1mp-layout", "Rapid", 1024, 1024, 4, "poster_en_bold"),
        ("rapid-1.5mp-layout", "Rapid", 1024, 1536, 6, "poster_en_bold"),
        ("rapid-2mp-caption", "Rapid", 2048, 1024, 6, None),
        ("rapid-4mp-layout", "Rapid", 2048, 2048, 8, "poster_en_bold"),
        ("rapid-4mp-caption", "Rapid", 2048, 2048, 8, None),
        ("turbo-after-hires", "Turbo", 1024, 1024, 8, "poster_zh_vertical"),
        ("rapid-after-turbo", "Rapid", 1024, 1024, 4, "poster_zh_vertical"),
    ]
    records = []
    for name, preset, width, height, steps, fixture_id in sequence:
        prompt = compile_fixture_layout(_fixture_by_id(fixture_id), width, height) if fixture_id else CAPTION
        print(f"Generating {name}: {width}x{height}, {steps} steps", flush=True)
        body = client.generate(dict(model="moss", import_json=prompt, width=width, height=height,
                                    preset=preset, seed=args.seed, loras=[]))
        result = result_payload(body)
        checked = check_generation(name, body, expect_preset=preset, expect_steps=steps,
                                   seed=args.seed, width=width, height=height)
        if checked:
            metrics, generation = checked
            check(f"{name}: correct profile", generation.get("runtime_profile") == PROFILE)
            check(f"{name}: adapter", generation.get("adapter") == ("rapid4" if preset == "Rapid" else "dmd8"))
            (out / f"{name}.png").write_bytes(base64.b64decode(result["images"][0]["data"]))
        record = {"name": name, "width": width, "height": height, "prompt": prompt,
                  "status": body.get("status"), "latency_s": body.get("latency_s"),
                  "seed": result.get("seed"), "error": result.get("error") or body.get("error"),
                  "generation": result.get("generation"), "metrics": result.get("metrics")}
        records.append(record)
        (out / f"{name}.json").write_text(json.dumps(record, indent=2) + "\n")
        if FAILURES:
            break

    workers = {r.get("metrics", {}).get("worker_instance_id") for r in records if r.get("metrics")}
    check("all generations completed", len(records) == len(sequence) and all(r["status"] == "completed" for r in records))
    switch_worker = adapter_switch_worker(records)
    check("Turbo → Rapid adapter switch witnessed on one worker", bool(switch_worker), str(switch_worker))
    report = {"recorded_at": datetime.now(timezone.utc).isoformat(), "profile": PROFILE,
              "endpoint": client.base, "oversize_error": error, "runs": records,
              "workers": sorted(w for w in workers if w), "adapter_switch_worker": switch_worker,
              "failures": list(FAILURES)}
    (out / "smoke-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("SMOKE FAILED" if FAILURES else "SMOKE PASSED", flush=True)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    raise SystemExit(main())
