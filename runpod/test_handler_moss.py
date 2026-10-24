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
    assert all(0 <= s <= 2**53 - 1 for s in seeds)


def test_moss_seed_randomised_when_negative():
    seeds = {build_moss(seed=-1)["10"]["inputs"]["seed"] for _ in range(3)}
    assert len(seeds) == 3


def test_moss_seed_passthrough():
    assert build_moss(seed=123)["10"]["inputs"]["seed"] == 123


# --- handler() input validation -----------------------------------------------


def run_handler(**input_data):
    return handler.handler({"input": input_data, "id": "test"})


def test_handler_rejects_non_multiple_of_16():
    result = run_handler(model="moss", import_json="x", width=100, height=1024)
    assert "multiples of 16" in result["error"]


def test_handler_rejects_unknown_moss_preset():
    result = run_handler(model="moss", import_json="x", preset="Bogus")
    assert result["error"] == "Unknown MOSS preset 'Bogus'"


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
    wf = handler.build_workflow("v1", "PJ", 512, 512, "Default", None,
                                [{"filename": "a.safetensors", "strengths": {"positive": 0.5, "unconditional": 0.25}}], 0.8)
    expected = load_repo_template("v1")
    expected["98:27"]["inputs"]["value"] = 512
    expected["98:28"]["inputs"]["value"] = 512
    expected["188"]["inputs"]["value"] = "PJ"
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
