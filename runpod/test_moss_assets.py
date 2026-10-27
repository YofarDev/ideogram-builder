"""Tests for runpod/moss_assets.py — manifest resolution, verification, populate."""
import json

import pytest

import moss_assets
from moss_assets import (
    AssetError,
    load_manifest,
    manifest_id,
    populate,
    required_asset_keys,
    resolve_adapter,
    resolve_asset,
    resolve_profile_assets,
    verify_sha256,
    write_extra_model_paths,
)
from moss_config import MOSS_PRESETS, resolve_profile


@pytest.fixture
def fake_roots(monkeypatch, tmp_path):
    baked = tmp_path / "comfyui" / "models"
    volume = tmp_path / "moss-models"
    monkeypatch.setattr(moss_assets, "COMFY_MODELS_ROOT", str(baked))
    monkeypatch.setattr(moss_assets, "MODELS_ROOT", str(volume))
    return baked, volume


def _touch(path, content=b"x"):
    from pathlib import Path
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


# --- manifest ----------------------------------------------------------------


def test_manifest_loads_with_pinned_revisions():
    manifest = load_manifest()
    assert manifest["manifest_id"].startswith("moss-models-")
    repos = {entry["repo"] for entry in manifest["assets"].values()}
    assert repos == {"Comfy-Org/MOSS-Image", "lodestones/MOSS-Image-SFT-8-steps-dmd",
                     "akhaliq/MOSS-Image-SFT-4-steps"}
    for entry in manifest["assets"].values():
        assert entry["revision"] and len(entry["revision"]) == 40
        assert entry["sha256"] and len(entry["sha256"]) == 64
        assert entry["license"] == "apache-2.0"


def test_manifest_id_exposed():
    assert manifest_id() == load_manifest()["manifest_id"]


def test_unknown_asset_key_is_readable_error():
    with pytest.raises(AssetError, match="Unknown asset key"):
        resolve_asset("dit_turbo_fantasy")


# --- resolution ----------------------------------------------------------------


def test_resolve_prefers_baked_then_volume(fake_roots):
    baked, volume = fake_roots
    # Touch the baked file first: resolution requires presence.
    baked_file = _touch(baked / "diffusion_models" / "moss_image_sft_int8_convrot.safetensors")
    path, workflow_ref, entry = resolve_asset("dit_int8_convrot")
    assert path == str(baked_file)
    assert workflow_ref == "moss_image_sft_int8_convrot.safetensors"

    # bf16 DiT only exists on the volume once populated.
    with pytest.raises(AssetError, match="not present"):
        resolve_asset("dit_bf16")
    volume_file = _touch(volume / "diffusion_models" / "moss_image_sft_bf16.safetensors")
    assert resolve_asset("dit_bf16")[0] == str(volume_file)


def test_adapter_resolution_uses_control_dir(fake_roots):
    baked, volume = fake_roots
    with pytest.raises(AssetError, match="adapter_rapid4"):
        resolve_adapter("rapid4")
    volume_file = _touch(volume / "loras" / "moss" / "control" / "moss_sft_4step_v2.0.safetensors")
    path, workflow_ref, _entry = resolve_adapter("rapid4")
    assert path == str(volume_file)
    assert workflow_ref == "moss/control/moss_sft_4step_v2.0.safetensors"
    with pytest.raises(AssetError, match="Unknown distillation adapter"):
        resolve_adapter("dmd16")


def test_hash_verification(fake_roots):
    import hashlib
    baked, _volume = fake_roots
    content = b"model bytes"
    path = _touch(baked / "vae" / "flux2-vae_small.safetensors", content)
    good = hashlib.sha256(content).hexdigest()
    verify_sha256(path, good)
    with pytest.raises(AssetError, match="sha256 mismatch"):
        verify_sha256(path, "0" * 64)


def test_resolve_profile_assets_for_baseline(fake_roots):
    baked, _ = fake_roots
    for rel in (
        "diffusion_models/moss_image_sft_int8_convrot.safetensors",
        "text_encoders/qwen3.5_9b_w4a8_gptq.safetensors",
        "vae/flux2-vae_small.safetensors",
        "loras/moss/control/moss_sft_dmd8.safetensors",
    ):
        _touch(baked / rel)
    assets = resolve_profile_assets(resolve_profile({}))
    assert assets == {
        "dit": "moss_image_sft_int8_convrot.safetensors",
        "encoder": "qwen3.5_9b_w4a8_gptq.safetensors",
        "vae": "flux2-vae_small.safetensors",
    }


def test_assert_profile_assets_fails_clearly_when_missing(fake_roots):
    from moss_assets import assert_profile_assets
    baseline_enabled = ("Fast", "Quality", "Turbo")
    with pytest.raises(AssetError) as exc:
        assert_profile_assets(resolve_profile({}), baseline_enabled)
    # Names the missing file and how to fix it.
    assert "moss_image_sft_int8_convrot.safetensors" in str(exc.value)
    assert "moss_populate_models" in str(exc.value) or "not present" in str(exc.value)


def test_required_asset_keys_cover_enabled_presets():
    baseline_keys = set(required_asset_keys(resolve_profile({}), ("Fast", "Quality", "Turbo")))
    assert baseline_keys == {"dit_int8_convrot", "enc_w4a8", "vae_small", "adapter_dmd8"}
    all_keys = set(required_asset_keys(
        resolve_profile({"MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters"}),
        MOSS_PRESETS.keys()))
    assert {"adapter_rapid4", "adapter_draft3", "dit_int8_convrot", "enc_w4a8"} <= all_keys


# --- extra model paths config ----------------------------------------------------


def test_extra_model_paths_yaml(tmp_path):
    dest = write_extra_model_paths(tmp_path / "cfg" / "extra_model_paths.yaml", models_root="/moss-models")
    text = (tmp_path / "cfg" / "extra_model_paths.yaml").read_text()
    assert "base_path: /moss-models" in text
    assert "loras/moss/control" not in text  # adapters resolve through the loras root


# --- populate (CPU maintenance path) ------------------------------------------------


def test_populate_downloads_selected_keys_and_verifies(fake_roots):
    _baked, volume = fake_roots
    content = b"adapter bytes"

    def fake_downloader(url, tmp_dest):
        from pathlib import Path
        assert "/resolve/2ded95c37a029360245926fe72e475e30039bbfb/" in url
        Path(tmp_dest).parent.mkdir(parents=True, exist_ok=True)
        Path(tmp_dest).write_bytes(content)

    import hashlib as _h
    # Patch the manifest entry's sha256 so verification matches local bytes.
    manifest_path = _baked.parent.parent / "manifest.json"
    manifest = json.loads(open(moss_assets.MANIFEST_PATH).read())
    manifest["assets"]["adapter_rapid4"]["sha256"] = _h.sha256(content).hexdigest()
    manifest_path.write_text(json.dumps(manifest))

    populated = populate(str(volume), {"adapter_rapid4"}, downloader=fake_downloader, path=str(manifest_path))
    assert populated == [str(volume / "loras" / "moss" / "control" / "moss_sft_4step_v2.0.safetensors")]
    assert (volume / "loras" / "moss" / "control" / "moss_sft_4step_v2.0.safetensors").read_bytes() == content


def test_populate_rejects_unknown_keys(fake_roots):
    _baked, volume = fake_roots
    with pytest.raises(AssetError, match="Unknown asset keys"):
        populate(str(volume), {"nope"}, downloader=lambda url, dest: None)


def test_populate_default_selects_volume_candidates_only(fake_roots):
    _baked, _volume = fake_roots
    manifest = load_manifest()
    default_keys = {k for k, e in manifest["assets"].items()
                    if e["container_path"].startswith("/moss-models")}
    assert default_keys == {"dit_bf16", "enc_int8_convrot", "enc_bf16",
                            "adapter_rapid4", "adapter_rapid4_fp32", "adapter_draft3"}
    assert "dit_int8_convrot" not in default_keys  # baseline is baked, never re-downloaded
