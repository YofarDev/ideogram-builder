"""Tests for the MOSS-Image branch of runpod/handler.py — no GPU needed.

Run: uv run --with pytest --with requests --with websocket-client pytest runpod
"""
import json
import sys
import types
from pathlib import Path

import pytest

RUNPOD_DIR = Path(__file__).resolve().parent

# handler.py imports runpod at module level; stub it (and its rp_upload submodule)
# so the module imports on a dev machine without the GPU dependencies.
_runpod = types.ModuleType("runpod")
_runpod.serverless = types.ModuleType("runpod.serverless")
_runpod.serverless.start = lambda cfg: None
_utils = types.ModuleType("runpod.serverless.utils")
_rp_upload = types.ModuleType("runpod.serverless.utils.rp_upload")
_rp_upload.upload_image = lambda *a, **k: ""
_utils.rp_upload = _rp_upload
_runpod.serverless.utils = _utils
sys.modules.setdefault("runpod", _runpod)
sys.modules.setdefault("runpod.serverless", _runpod.serverless)
sys.modules.setdefault("runpod.serverless.utils", _utils)
sys.modules.setdefault("runpod.serverless.utils.rp_upload", _rp_upload)

import handler  # noqa: E402

REPO_TEMPLATES = {
    "turbo": str(RUNPOD_DIR / "workflow_template_lora_turbo.json"),
    "v1": str(RUNPOD_DIR / "workflow_template_lora.json"),
    "moss": str(RUNPOD_DIR / "workflow_template_moss.json"),
}


@pytest.fixture(autouse=True)
def repo_templates(monkeypatch):
    """Point the template paths at the repo files and reset the lazy cache."""
    for key, path in REPO_TEMPLATES.items():
        monkeypatch.setitem(handler.WORKFLOW_TEMPLATES, key, path)
    monkeypatch.setattr(handler, "_TEMPLATES", {})


def build_moss(**overrides):
    kwargs = dict(prompt="P", negative="N", width=1024, height=768,
                  preset="Fast", seed=5, loras=[])
    kwargs.update(overrides)
    return handler._build_workflow_moss(**kwargs)


# --- MOSS preset wiring ------------------------------------------------------


def test_moss_fast_preset_wiring():
    wf = build_moss(preset="Fast")
    assert "4" not in wf                       # DMD LoRA bypassed
    assert wf["5"]["inputs"]["model"] == ["1", 0]
    assert wf["6"]["inputs"]["start_percent"] == 0.0
    assert wf["6"]["inputs"]["end_percent"] == 0.5
    assert wf["10"]["inputs"]["model"] == ["6", 0]
    assert wf["10"]["inputs"]["steps"] == 25
    assert wf["10"]["inputs"]["cfg"] == 2.5
    assert wf["10"]["inputs"]["sampler_name"] == "er_sde"
    assert wf["10"]["inputs"]["scheduler"] == "simple"
    assert wf["10"]["inputs"]["seed"] == 5


def test_moss_turbo_preset_wiring():
    wf = build_moss(preset="Turbo")
    assert "4" in wf                           # DMD LoRA kept
    assert wf["5"]["inputs"]["model"] == ["4", 0]
    assert "6" not in wf                       # no layer-skip guidance
    assert wf["10"]["inputs"]["model"] == ["5", 0]
    assert wf["10"]["inputs"]["steps"] == 8
    assert wf["10"]["inputs"]["cfg"] == 1.0
    assert wf["10"]["inputs"]["sampler_name"] == "euler"


def test_moss_quality_preset_wiring():
    wf = build_moss(preset="Quality")
    assert "4" not in wf
    assert wf["6"]["inputs"]["end_percent"] == 1.0
    assert wf["10"]["inputs"]["steps"] == 50
    assert wf["10"]["inputs"]["cfg"] == 3.0


def test_moss_prompt_negative_and_dims():
    wf = build_moss(prompt='{"summary":{}}', negative="", width=768, height=1536)
    assert wf["7"]["inputs"]["text"] == '{"summary":{}}'
    assert wf["8"]["inputs"]["text"] == ""
    assert wf["9"]["inputs"]["width"] == 768
    assert wf["9"]["inputs"]["height"] == 1536


def test_moss_lora_population():
    loras = [{"filename": "user/moss/my.safetensors", "strengths": {"positive": 0.7}}]
    wf = build_moss(loras=loras)
    inputs = wf["5"]["inputs"]
    assert inputs["lora_1"] == {"on": True, "lora": "user/moss/my.safetensors", "strength": 0.7}
    assert inputs["model"] == (["4", 0] if "4" in wf else ["1", 0])


def test_moss_no_loras_disables_slot():
    wf = build_moss()
    assert wf["5"]["inputs"]["lora_1"] == {"on": False, "lora": "", "strength": 1.0}


# --- Seed handling ------------------------------------------------------------


def test_moss_seed_randomised_when_missing():
    seeds = {build_moss(seed=None)["10"]["inputs"]["seed"] for _ in range(3)}
    assert len(seeds) == 3
    assert all(0 <= s <= handler.SEED_MAX for s in seeds)


def test_moss_seed_randomised_when_negative():
    seeds = {build_moss(seed=-1)["10"]["inputs"]["seed"] for _ in range(3)}
    assert len(seeds) == 3


def test_moss_seed_passthrough():
    assert build_moss(seed=123)["10"]["inputs"]["seed"] == 123


@pytest.mark.parametrize("workflow_key", ["turbo", "v1"])
@pytest.mark.parametrize("seed", [None, -1])
def test_ideogram_seed_randomised(workflow_key, seed):
    # Before the fix, "random" jobs reused the template's hard-coded seed
    template_seed = load_repo_template(workflow_key)["160"]["inputs"]["seed"]
    seeds = {handler.build_workflow(workflow_key, "PJ", 768, 1152, "Default", seed, [], 0.8)["160"]["inputs"]["seed"]
             for _ in range(3)}
    assert len(seeds) == 3
    assert template_seed not in seeds
    assert all(0 <= s <= handler.SEED_MAX for s in seeds)


@pytest.mark.parametrize("workflow_key", ["turbo", "v1"])
def test_ideogram_seed_passthrough(workflow_key):
    wf = handler.build_workflow(workflow_key, "PJ", 768, 1152, "Default", 0, [], 0.8)
    assert wf["160"]["inputs"]["seed"] == 0


# --- handler() input validation -----------------------------------------------


def run_handler(**input_data):
    return handler.handler({"input": input_data, "id": "test"})


def test_handler_rejects_non_multiple_of_16():
    result = run_handler(model="moss", import_json="x", width=100, height=1024)
    assert "multiples of 16" in result["error"]


def test_handler_rejects_unknown_moss_preset():
    result = run_handler(model="moss", import_json="x", preset="Bogus")
    # With the moss helper modules present, the request gate is
    # moss_config.validate_request_preset (enablement before unknown-name).
    assert "Bogus" in result["error"]
    assert "not enabled" in result["error"] or "Unknown MOSS preset" in result["error"]


def test_handler_rejects_candidate_preset_on_baseline_profile():
    result = run_handler(model="moss", import_json="x", preset="Rapid", width=1024, height=1024)
    assert "not enabled" in result["error"]
    assert "Fast, Quality, Turbo" in result["error"]


def test_handler_rejects_unknown_model():
    assert run_handler(model="foo", import_json="x") == {"error": "Unknown model 'foo'"}


def test_handler_16_check_precedes_server_contact(monkeypatch):
    # width 100 fails validation before check_server would block for minutes
    def boom(url, retries=0, delay=50):
        raise AssertionError("check_server must not be reached")

    monkeypatch.setattr(handler, "check_server", boom)
    result = run_handler(model="moss", import_json="x", width=100, height=1024)
    assert "multiples of 16" in result["error"]


# --- Ideogram path unchanged ---------------------------------------------------


def load_repo_template(key):
    with open(REPO_TEMPLATES[key]) as f:
        return json.load(f)


def test_ideogram_turbo_workflow_unchanged():
    """Snapshot: lazy template loading reproduces the pre-refactor turbo output."""
    wf = handler.build_workflow("turbo", "PJ", 768, 1152, "Quality", 42, [], 0.9)
    expected = load_repo_template("turbo")
    expected["98:27"]["inputs"]["value"] = 768
    expected["98:28"]["inputs"]["value"] = 1152
    expected["160"]["inputs"]["seed"] = 42
    expected["98:156"]["inputs"]["choice"] = "Quality"
    expected["98:156"]["inputs"]["index"] = 1
    expected["98:167"]["inputs"]["text"] = "PJ"
    expected["183"]["inputs"]["strength_model"] = 0.9
    expected["186"]["inputs"]["lora_1"] = {"on": False, "lora": "", "strength": 1.0}
    assert wf == expected


def test_ideogram_v1_workflow_unchanged():
    wf = handler.build_workflow("v1", "PJ", 512, 512, "Default", 7,
                                [{"filename": "a.safetensors", "strengths": {"positive": 0.5, "unconditional": 0.25}}], 0.8)
    expected = load_repo_template("v1")
    expected["98:27"]["inputs"]["value"] = 512
    expected["98:28"]["inputs"]["value"] = 512
    expected["188"]["inputs"]["value"] = "PJ"
    expected["160"]["inputs"]["seed"] = 7
    expected["98:156"]["inputs"]["choice"] = "Default"
    expected["98:156"]["inputs"]["index"] = 2
    expected["166"]["inputs"]["lora_1"] = {"on": True, "lora": "a.safetensors", "strength": 0.5}
    expected["177"]["inputs"]["lora_1"] = {"on": True, "lora": "a.safetensors", "strength": 0.25}
    assert wf == expected


def test_build_workflow_rejects_template_not_shipped():
    with pytest.raises(ValueError, match="not available on this worker"):
        handler.build_workflow("moss", "PJ", 1024, 1024, "Default", None, [], 0.8)


def test_load_template_missing_file():
    handler.WORKFLOW_TEMPLATES["moss"] = "/nonexistent.json"
    handler._TEMPLATES.clear()
    with pytest.raises(ValueError, match="not available on this worker"):
        handler._load_template("moss")


def test_load_template_returns_independent_copies():
    a = handler._load_template("moss")
    a["10"]["inputs"]["seed"] = 999
    b = handler._load_template("moss")
    assert b["10"]["inputs"]["seed"] == 0


# --- LoRA download: sub-paths + HF_TOKEN ---------------------------------------


class FakeResponse:
    def __init__(self, status_code=200, chunks=(b"data",)):
        self.status_code = status_code
        self._chunks = chunks

    def iter_content(self, chunk_size):
        yield from self._chunks

    def raise_for_status(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


@pytest.fixture
def fake_requests(monkeypatch):
    calls = []

    def get(url, **kwargs):
        calls.append((url, kwargs))
        return FakeResponse()

    fake = types.SimpleNamespace(get=get, Timeout=TimeoutError, RequestException=Exception)
    monkeypatch.setattr(handler, "requests", fake)
    return calls


def test_download_lora_subpath_and_hf_token(monkeypatch, tmp_path, fake_requests):
    monkeypatch.setattr(handler, "LORAS_DIR", str(tmp_path))
    monkeypatch.setenv("HF_TOKEN", "hf_secret")
    dest = handler._download_lora(
        "https://huggingface.co/user/repo/resolve/main/lora.safetensors",
        "user/moss/lora.safetensors",
    )
    assert dest == str(tmp_path / "user" / "moss" / "lora.safetensors")
    assert (tmp_path / "user" / "moss" / "lora.safetensors").read_bytes() == b"data"
    _, kwargs = fake_requests[0]
    assert kwargs["headers"]["Authorization"] == "Bearer hf_secret"


def test_download_lora_no_token_for_other_hosts(monkeypatch, tmp_path, fake_requests):
    monkeypatch.setattr(handler, "LORAS_DIR", str(tmp_path))
    monkeypatch.setenv("HF_TOKEN", "hf_secret")
    handler._download_lora("https://example.com/x.safetensors", "flat.safetensors")
    assert "headers" not in fake_requests[0][1] or not fake_requests[0][1]["headers"]


def test_download_lora_403_mentions_hf_token(monkeypatch, tmp_path):
    monkeypatch.setattr(handler, "LORAS_DIR", str(tmp_path))

    def get(url, **kwargs):
        return FakeResponse(status_code=403)

    monkeypatch.setattr(handler, "requests", types.SimpleNamespace(
        get=get, Timeout=TimeoutError, RequestException=Exception))
    with pytest.raises(ValueError, match="HF_TOKEN"):
        handler._download_lora("https://huggingface.co/user/repo/resolve/main/lora.safetensors", "a.safetensors")


def test_ensure_loras_resolves_subpath(monkeypatch, tmp_path):
    monkeypatch.setattr(handler, "LORAS_DIR", str(tmp_path))
    downloads = []

    def fake_download(source_url, filename):
        downloads.append((source_url, filename))
        (tmp_path / "user" / "moss").mkdir(parents=True, exist_ok=True)
        (tmp_path / "user" / "moss" / "x.safetensors").write_bytes(b"x")

    monkeypatch.setattr(handler, "_download_lora", fake_download)
    resolved = handler.ensure_loras(
        [{"filename": "user/moss/x.safetensors",
          "source_url": "https://huggingface.co/user/repo/resolve/main/x.safetensors",
          "strengths": {"positive": 1.0}}])
    assert resolved == [{"filename": "user/moss/x.safetensors", "strengths": {"positive": 1.0}}]
    assert downloads == [("https://huggingface.co/user/repo/resolve/main/x.safetensors", "user/moss/x.safetensors")]


def test_ensure_loras_accepts_symlinked_subdir(monkeypatch, tmp_path):
    """Modal mounts the LoRA volume at LORAS_DIR/user via symlink; filenames
    under it must pass the containment check (realpath would reject them)."""
    monkeypatch.setattr(handler, "LORAS_DIR", str(tmp_path / "loras"))
    volume_root = tmp_path / "volume"
    (volume_root / "moss").mkdir(parents=True)
    (volume_root / "moss" / "x.safetensors").write_bytes(b"x")
    loras = tmp_path / "loras"
    loras.mkdir()
    loras.joinpath("user").symlink_to(volume_root, target_is_directory=True)

    resolved = handler.ensure_loras(
        [{"filename": "user/moss/x.safetensors",
          "source_url": None,
          "strengths": {"positive": 1.0}}])
    assert resolved == [{"filename": "user/moss/x.safetensors", "strengths": {"positive": 1.0}}]


def test_ensure_loras_rejects_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(handler, "LORAS_DIR", str(tmp_path))
    with pytest.raises(ValueError, match="Unsafe lora filename"):
        handler.ensure_loras(
            [{"filename": "../escape.safetensors",
              "source_url": "https://example.com/x.safetensors",
              "strengths": {"positive": 1.0}}])


# --- module-backed moss flow: metrics, metadata, seed --------------------------


class FakeWS:
    def __init__(self, messages):
        self.messages = list(messages)
        self.connected = True
        self.closed = False

    def connect(self, url, timeout=None):
        pass

    def recv(self):
        if not self.messages:
            raise AssertionError("websocket loop should have exited on completion")
        message = self.messages.pop(0)
        if isinstance(message, Exception):
            raise message
        return json.dumps(message)

    def close(self):
        self.closed = True


DONE = {"type": "executing", "data": {"node": None, "prompt_id": "pid1"}}


def metric_messages(prompt_id="pid1", sampler_ms=3.0):
    return [
        {"type": "execution_start", "data": {"prompt_id": prompt_id}},
        {"type": "executing", "data": {"node": "10", "prompt_id": prompt_id}},
        {"type": "executed", "data": {"node": "10", "prompt_id": prompt_id, "cumulative": sampler_ms}},
        DONE,
    ]


HISTORY = {"pid1": {"outputs": {"12": {"images": [
    {"filename": "moss_00001_.png", "subfolder": "", "type": "output"}]}}}}


@pytest.fixture
def moss_flow(monkeypatch, tmp_path):
    """Fake ComfyUI server + asset roots so the full moss path runs locally."""
    import moss_assets

    baked = tmp_path / "comfy" / "models"
    for rel in ("diffusion_models/moss_image_sft_int8_convrot.safetensors",
                "text_encoders/qwen3.5_9b_w4a8_gptq.safetensors",
                "vae/flux2-vae_small.safetensors",
                "loras/moss/control/moss_sft_dmd8.safetensors"):
        p = baked / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    # Candidate adapters live on the benchmark volume once populated.
    volume = tmp_path / "moss-models" / "loras" / "moss" / "control"
    for name in ("moss_sft_4step_v2.0.safetensors", "moss_sft_3step_v1.0.safetensors"):
        p = volume / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    monkeypatch.setattr(moss_assets, "COMFY_MODELS_ROOT", str(baked))
    monkeypatch.setattr(moss_assets, "MODELS_ROOT", str(tmp_path / "moss-models"))

    monkeypatch.setattr(handler, "check_server", lambda *a, **k: True)
    monkeypatch.setattr(handler, "queue_workflow", lambda wf, cid: {"prompt_id": "pid1"})
    monkeypatch.setattr(handler, "get_history", lambda pid: HISTORY)
    monkeypatch.setattr(handler, "get_image_data", lambda *a: b"PNGDATA")
    monkeypatch.setattr(handler, "_get_object_info", lambda: None)
    monkeypatch.delenv("BUCKET_ENDPOINT_URL", raising=False)
    monkeypatch.setattr(handler, "_MOSS_JOBS_IN_WORKER", 0, raising=False)
    return monkeypatch


def _wire_ws(monkeypatch, messages):
    import types as _types
    fake_module = _types.SimpleNamespace(
        WebSocket=lambda: FakeWS(messages),
        WebSocketTimeoutException=type("T", (Exception,), {}),
        WebSocketConnectionClosedException=type("C", (Exception,), {}),
        enableTrace=lambda *_: None,
    )
    monkeypatch.setattr(handler, "websocket", fake_module)


def test_moss_flow_returns_metrics_and_generation(moss_flow, monkeypatch):
    _wire_ws(monkeypatch, metric_messages())
    result = run_handler(model="moss", import_json="P", preset="Fast", seed=42,
                         width=1024, height=1024)
    assert "error" not in result
    assert result["seed"] == 42
    assert result["images"][0]["type"] == "base64"

    generation = result["generation"]
    assert generation["preset_id"] == "Fast"
    assert generation["runtime_profile"] == "baseline"
    assert generation["effective_steps"] == 25
    assert generation["cfg"] == 2.5
    assert generation["negative_guidance_active"] is True
    assert generation["first_generation_in_worker"] is True
    assert generation["model_manifest_id"].startswith("moss-models-")

    metrics = result["metrics"]
    assert metrics["measurement_complete"] is True
    # Real-clock intervals: presence and completeness are asserted here; exact
    # timing maths are covered in test_comfy_metrics with a fake clock.
    assert "sampler" in metrics["observed_node_wall_ms"]
    assert metrics["comfy_queue_ms"] is not None
    assert metrics["worker_instance_id"]
    assert metrics["prompt_id"] == "pid1"

    # Second job in the same worker process is no longer the first generation.
    result2 = run_handler(model="moss", import_json="P", preset="Fast", seed=43,
                          width=1024, height=1024)
    assert result2["generation"]["first_generation_in_worker"] is False


def test_moss_flow_turbo_records_negative_guidance_inactive(moss_flow, monkeypatch):
    _wire_ws(monkeypatch, metric_messages())
    result = run_handler(model="moss", import_json="P", preset="Turbo", seed=1,
                         width=1024, height=1024)
    assert result["generation"]["negative_guidance_active"] is False
    assert result["generation"]["adapter"] == "dmd8"


def test_moss_flow_rapid_unsupported_size_is_actionable(moss_flow, monkeypatch):
    monkeypatch.setenv("MOSS_RUNTIME_PROFILE", "rapid-auto-int8-cu128")
    monkeypatch.setenv("MOSS_EXPERIMENTAL_PRESETS", "Rapid")  # experimental opt-in advertises it
    _wire_ws(monkeypatch, metric_messages())
    result = run_handler(model="moss", import_json="P", preset="Rapid",
                         width=1024, height=1024)
    # The v1 recipe: exactly 4 steps at ≤1 MP; anything larger is rejected with
    # the requested area and the supported limit — no silent resize.
    assert "error" not in result
    assert result["generation"]["effective_steps"] == 4
    assert result["generation"]["adapter"] == "rapid4"
    result = run_handler(model="moss", import_json="P", preset="Rapid",
                         width=1024, height=1040)
    assert "supports up to 1 MP" in result["error"]
    assert "1024×1040" in result["error"]
    result = run_handler(model="moss", import_json="P", preset="Rapid",
                         width=4096, height=4096)
    assert "above the limit" in result["error"]
    # Without the experimental opt-in the same preset is not advertised at all.
    monkeypatch.delenv("MOSS_EXPERIMENTAL_PRESETS")
    result = run_handler(model="moss", import_json="P", preset="Rapid",
                         width=1024, height=1024)
    assert "not advertised" in result["error"]


def test_moss_flow_keeps_partial_metrics_on_execution_error(moss_flow, monkeypatch):
    messages = [
        {"type": "executing", "data": {"node": "10", "prompt_id": "pid1"}},
        {"type": "execution_error",
         "data": {"node_id": "10", "prompt_id": "pid1", "exception_message": "OOM"}},
    ]
    _wire_ws(monkeypatch, messages)
    result = run_handler(model="moss", import_json="P", preset="Fast", seed=9,
                         width=1024, height=1024)
    # The run keeps whatever it produced plus the error, and the partial metrics
    # say so — the timings are explicitly labelled incomplete.
    assert any("OOM" in e for e in result.get("errors", []))
    assert result["metrics"]["measurement_complete"] is False
    assert "OOM" in result["metrics"]["measurement_note"]
    assert result["generation"]["preset_id"] == "Fast"


def test_moss_flow_fallback_legacy_builder_without_modules(moss_flow, monkeypatch):
    """The Ideogram image ships no moss modules: legacy builder still works and
    results stay free of new keys."""
    monkeypatch.setattr(handler, "_load_moss_modules", lambda: None)
    messages = [
        {"type": "executing", "data": {"node": None, "prompt_id": "pid1"}},
    ]
    _wire_ws(monkeypatch, messages)
    result = run_handler(model="moss", import_json="P", preset="Fast", seed=5,
                         width=1024, height=1024)
    assert result["seed"] == 5
    assert result["images"][0]["type"] == "base64"
    assert "metrics" not in result and "generation" not in result


def test_moss_flow_metrics_disabled_by_env(moss_flow, monkeypatch):
    monkeypatch.setenv("MOSS_METRICS", "off")
    _wire_ws(monkeypatch, metric_messages())
    result = run_handler(model="moss", import_json="P", preset="Fast", seed=3,
                         width=1024, height=1024)
    assert "metrics" not in result
    # The executed recipe is reproducibility metadata, not telemetry — it stays
    # even when metrics collection is off.
    assert result["generation"]["preset_id"] == "Fast"


def test_moss_flow_reconnect_marks_metrics_incomplete(moss_flow, monkeypatch):
    """A mid-run websocket drop marks open intervals unavailable — the numbers
    that survived are labelled incomplete, not silently totalled."""
    import types as _types
    import websocket as real_ws

    messages = [
        {"type": "executing", "data": {"node": "10", "prompt_id": "pid1"}},
        {"type": "executed", "data": {"node": "10", "prompt_id": "pid1"}},
        DONE,
    ]
    opened = {"count": 0}

    class ReconnectWS:
        def __init__(self):
            opened["count"] += 1
            self.connected = True

        def connect(self, url, timeout=None):
            pass

        def recv(self):
            if opened["count"] == 1:
                raise real_ws.WebSocketConnectionClosedException()
            return json.dumps(messages.pop(0))

        def close(self):
            self.connected = False

    fake = _types.SimpleNamespace(
        WebSocket=ReconnectWS,
        WebSocketTimeoutException=real_ws.WebSocketTimeoutException,
        WebSocketConnectionClosedException=real_ws.WebSocketConnectionClosedException,
    )
    monkeypatch.setattr(handler, "websocket", fake)
    result = run_handler(model="moss", import_json="P", preset="Fast", seed=8,
                         width=1024, height=1024)
    assert "error" not in result
    assert result["metrics"]["measurement_complete"] is False
    assert "reconnected" in result["metrics"]["measurement_note"]
    # The sampler interval that completed before the drop is still reported.
    assert result["metrics"]["observed_node_wall_ms"].get("sampler") is not None

