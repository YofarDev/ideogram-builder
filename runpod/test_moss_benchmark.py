"""Tests for runpod/moss_benchmark.py — job matrix, artifacts, guards."""
import json

import pytest

import moss_benchmark
from moss_benchmark import build_jobs, compile_fixture_layout, load_fixtures, run_benchmark, summarize


# --- fixture compilation (must match src/prompt-moss.js buildMossLayout) --------


def test_compile_layout_matches_editor_maths():
    fixture = {
        "caption": "test", "meta": ["poster"], "canvas": "single", "palette": ["#101C3D"],
        "boxes": [
            {"mode": "text", "desc": "d1", "text": "TITLE", "box": [60, 60, 880, 180]},
            {"mode": "object", "desc": "d2", "box": [280, 420, 440, 440], "colors": ["#FF6B57"]},
        ],
    }
    layout = json.loads(compile_fixture_layout(fixture, 1024, 1024))
    assert layout["bbox_coord_space"] == "abs_centralized"
    assert layout["bbox_format"] == "yxyx"
    assert layout["summary"] == {"meta": ["poster"], "canvas": "single",
                                 "caption": "test", "palette": ["#101C3D"]}
    # Top-layer-first items (reverse of the box list), y-first centralized bbox,
    # floor/ceil rounding — byte-compatible with src/prompt-moss.js.
    assert layout["items"][0]["bbox"] == [-82, -226, 369, 226]      # object box
    assert layout["items"][0]["palette"] == ["#FF6B57"]
    assert layout["items"][1]["bbox"] == [-451, -451, -266, 451]    # text box
    assert layout["items"][1]["text"] == "TITLE"


def test_fixture_library_loads_and_is_complete():
    fixtures = load_fixtures()
    assert len(fixtures) >= 12  # Phase 11: at least twelve prompts
    categories = {f["category"] for f in fixtures}
    assert {"poster_english", "poster_chinese", "menu_bilingual", "small_numbers",
            "dense_layout", "multi_subject", "hands", "illustration",
            "photo_natural", "tiny_text", "long_prompt"} <= categories
    for f in fixtures:
        assert f["expected_text"] is not None and "expected_regions" in f
        assert len(f["dims"]) == 2


def test_unknown_fixture_id_fails_fast():
    with pytest.raises(ValueError, match="Unknown fixture ids"):
        load_fixtures(ids=["nope"])


# --- job matrix ------------------------------------------------------------------


def test_build_jobs_matrix_and_seed_variation():
    fixtures = load_fixtures(ids=["poster_en_bold", "poster_zh_vertical"])
    configs = [{"profile": "baseline", "preset": "Fast"},
               {"profile": "baseline", "preset": "Turbo"}]
    jobs = build_jobs(fixtures, [1, 2, 3], configs)
    assert len(jobs) == 2 * 3 * 2  # configs × seeds × fixtures
    assert all(j["case"] == "new-prompt" for j in jobs)
    assert {j["seed"] for j in jobs} == {1, 2, 3}  # seeds vary → image result never cached


def test_build_jobs_cached_prompt_case():
    fixtures = load_fixtures(ids=["poster_en_bold"])
    configs = [{"profile": "baseline", "preset": "Fast"}]
    jobs = build_jobs(fixtures, [1, 2, 3], configs, cached_prompt=True)
    assert len(jobs) == 3
    assert all(j["case"] == "cached-prompt" for j in jobs)
    assert {j["fixture_id"] for j in jobs} == {"poster_en_bold"}  # same text


# --- summarize / worker split ------------------------------------------------------


def _record(profile, preset, worker, sampler_ms, total_ms, status="completed", first=False):
    return {
        "profile": profile, "preset": preset, "fixture_id": "f", "seed": 1,
        "width": 1024, "height": 1024, "case": "new-prompt", "status": status,
        "error": None, "latency_ms": total_ms + 5,
        "metrics": {"worker_instance_id": worker, "worker_total_ms": total_ms,
                    "observed_node_wall_ms": {"sampler": sampler_ms}, "measurement_complete": True},
        "generation": {"first_generation_in_worker": first},
        "seed_returned": 1, "recorded_at": 0,
    }


def test_summarize_medians_and_worker_split(tmp_path):
    results = tmp_path / "results.jsonl"
    rows = [
        _record("baseline", "Fast", "w1", 1000, 3000),
        _record("baseline", "Fast", "w1", 1200, 3200),
        _record("baseline", "Fast", "w2", 2000, 4000),  # scheduler hopped
    ]
    results.write_text("\n".join(json.dumps(r) for r in rows))
    summary = summarize(results)
    assert summary["total_records"] == 3
    assert summary["worker_split_configs"] == ["baseline/Fast/new-prompt"]
    workers = {row["worker"]: row for row in summary["rows"]}
    assert workers["w1"]["sampler_ms_median"] == 1100.0
    assert workers["w2"]["sampler_ms_median"] == 2000.0


def test_summarize_tolerates_torn_lines(tmp_path):
    results = tmp_path / "results.jsonl"
    results.write_text(json.dumps(_record("baseline", "Fast", "w1", 1000, 3000)) + '\n{"torn')
    summary = summarize(results)
    assert summary["total_records"] == 1


# --- runner loop ---------------------------------------------------------------------


class FakeRunner:
    """Scripted in-process runner: returns canned bodies, counts calls."""

    def __init__(self, bodies):
        self.bodies = list(bodies)
        self.calls = []

    def __call__(self, job, endpoint=None, token=None, timeout_s=None):
        self.calls.append(job)
        body = self.bodies.pop(0)
        if isinstance(body, Exception):
            raise body
        return body


def _ok_body(profile="baseline", sampler=1000, first=False):
    return {
        "status": "completed",
        "latency_ms": 4200.0,
        "result": {
            "images": [{"filename": "out.png", "type": "base64", "data": "QUFB"}],
            "seed": 7,
            "metrics": {
                "worker_instance_id": "w1", "worker_total_ms": sampler + 500,
                "observed_node_wall_ms": {"sampler": sampler},
                "prompt_id": "pid", "measurement_complete": True,
            },
            "generation": {"first_generation_in_worker": first, "runtime_profile": profile},
        },
    }


def test_run_benchmark_writes_artifacts_without_base64(tmp_path, monkeypatch):
    out = tmp_path / "out"
    runner = FakeRunner([_ok_body(first=True), _ok_body(), _ok_body(sampler=1100)])
    monkeypatch.setattr(moss_benchmark, "run_internal", runner)
    summary = run_benchmark(mode="internal", profiles=["baseline"], presets=["Fast"],
                            fixture_ids=["poster_en_bold"], seeds=[1, 2, 3],
                            out_dir=str(out), warmup=False, save_images=True)
    results = (out / "results.jsonl").read_text()
    assert "QUFB" not in results  # base64 bodies excluded from timing records
    records = [json.loads(line) for line in results.splitlines()]
    assert len(records) == 3
    assert records[0]["generation"]["first_generation_in_worker"] is True
    assert records[1]["metrics"]["observed_node_wall_ms"]["sampler"] == 1000.0
    assert (out / "images" / "out.png").exists() or any((out / "images").iterdir())
    assert (out / "summary.md").exists()
    assert sum(row["n"] for row in summary["rows"]) == 3
    assert len(summary["rows"]) == 2  # cold and warm cohorts stay separate


def test_run_benchmark_warmup_not_recorded(tmp_path, monkeypatch):
    out = tmp_path / "out"
    runner = FakeRunner([_ok_body(), _ok_body(sampler=1000)])
    monkeypatch.setattr(moss_benchmark, "run_internal", runner)
    run_benchmark(mode="internal", profiles=["baseline"], presets=["Fast"],
                  fixture_ids=["poster_en_bold"], seeds=[1], out_dir=str(out),
                  warmup=True, save_images=False, max_jobs=1)
    assert len(runner.calls) == 2  # warmup + 1 measured
    results = [json.loads(l) for l in (out / "results.jsonl").read_text().splitlines()]
    assert len(results) == 1
    # Warmup seed never collides with measured seeds.
    assert runner.calls[0]["seed"] != runner.calls[1]["seed"]


def test_fresh_warmup_encoder_input_never_collides_with_measured_matrix(tmp_path):
    runner = FakeRunner([_ok_body() for _ in range(12)])
    run_benchmark(mode="internal", runner=runner,
                  profiles=["baseline"], presets=["Fast", "Turbo", "Quality"],
                  fixture_ids=["poster_en_bold"], seeds=[101, 202, 303],
                  out_dir=str(tmp_path), save_images=False)
    warm = [moss_benchmark._payload(j)["import_json"] for j in runner.calls if j["seed"] == 304]
    measured = [moss_benchmark._payload(j)["import_json"] for j in runner.calls if j["seed"] != 304]
    assert len(warm) == 3 and len(measured) == 9
    assert len(set(measured)) == 9
    assert set(warm).isdisjoint(measured)
    assert all(json.loads(value) == json.loads(measured[0]) for value in warm + measured)


def test_run_benchmark_stops_on_repeated_errors(tmp_path, monkeypatch):
    out = tmp_path / "out"
    runner = FakeRunner([{"status": "failed", "error": "boom"}] * 5)
    monkeypatch.setattr(moss_benchmark, "run_internal", runner)
    summary = run_benchmark(mode="internal", profiles=["baseline"], presets=["Fast"],
                            fixture_ids=["poster_en_bold"], seeds=[1, 2, 3, 4, 5],
                            out_dir=str(out), warmup=False, save_images=False)
    assert summary["stop_reason"] and "consecutive" in summary["stop_reason"]
    assert len(runner.calls) == 3  # stops after CONSECUTIVE_ERROR_STOP


def test_run_benchmark_stops_on_oom(tmp_path, monkeypatch):
    out = tmp_path / "out"
    runner = FakeRunner([
        {"status": "failed", "error": "CUDA out of memory"},
        {"status": "failed", "error": "CUDA out of memory"},
    ])
    monkeypatch.setattr(moss_benchmark, "run_internal", runner)
    summary = run_benchmark(mode="internal", profiles=["baseline"], presets=["Fast"],
                            fixture_ids=["poster_en_bold"], seeds=[1, 2],
                            out_dir=str(out), warmup=False, save_images=False)
    assert summary["stop_reason"] == "GPU OOM"


def test_run_benchmark_regression_guard(tmp_path, monkeypatch):
    """The guard is median-based, so it triggers when a REGRESSION BECOMES THE
    NORM (≥half of recent warm samples), not on a single outlier spike."""
    out = tmp_path / "out"
    bodies = [_ok_body(first=True),
              _ok_body(sampler=1000), _ok_body(sampler=1000), _ok_body(sampler=1000),
              _ok_body(sampler=5000), _ok_body(sampler=5000), _ok_body(sampler=5000)]
    runner = FakeRunner(bodies)
    monkeypatch.setattr(moss_benchmark, "run_internal", runner)
    summary = run_benchmark(mode="internal", profiles=["baseline"], presets=["Fast"],
                            fixture_ids=["poster_en_bold"], seeds=[1, 2, 3, 4, 5, 6, 7],
                            out_dir=str(out), warmup=False, save_images=False,
                            regression_stop_pct=50)
    assert summary["stop_reason"] and "regression" in summary["stop_reason"]


def test_run_benchmark_max_jobs(tmp_path, monkeypatch):
    out = tmp_path / "out"
    runner = FakeRunner([_ok_body()] * 20)
    monkeypatch.setattr(moss_benchmark, "run_internal", runner)
    summary = run_benchmark(mode="internal", profiles=["baseline"], presets=["Fast"],
                            fixture_ids=["poster_en_bold"], seeds=[1, 2, 3, 4, 5],
                            out_dir=str(out), warmup=False, save_images=False, max_jobs=2)
    assert len(runner.calls) == 2
    assert summary["stop_reason"] == "max_jobs reached"


def test_run_benchmark_dry_run_touches_no_gpu(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("dry run must not execute jobs")

    monkeypatch.setattr(moss_benchmark, "run_internal", boom)
    summary = run_benchmark(mode="internal", profiles=["baseline"], presets=["Fast"],
                            fixture_ids=["poster_en_bold"], seeds=[1, 2, 3],
                            out_dir=str(tmp_path / "out"), dry_run=True)
    assert summary["dry_run"] is True and summary["jobs"] == 3
    assert "baseline" in summary["report"]
