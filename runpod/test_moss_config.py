"""Tests for runpod/moss_config.py — presets, profiles, size policy, capabilities."""
import pytest

import moss_config
from moss_config import (
    BASE_PRESET_IDS,
    CANDIDATE_PRESET_IDS,
    MOSS_PRESETS,
    ProfileError,
    PresetUnsupportedError,
    capabilities,
    deployment_settings,
    effective_preset,
    advertised_presets,
    generation_metadata,
    resolve_enabled_presets,
    resolve_experimental_presets,
    resolve_profile,
    validate_request_preset,
)


# --- preset table invariants (compatibility contract) --------------------------


def test_base_presets_keep_sampling_semantics():
    """Frozen contract: Fast/Quality/Turbo must not drift."""
    assert MOSS_PRESETS["Fast"] == {
        "steps": 25, "cfg": 2.5, "sampler": "er_sde", "scheduler": "simple",
        "slg": (0.0, 0.5), "adapter": None, "spectrum": False,
        "label": "Fast", "tier": "final", "blurb": MOSS_PRESETS["Fast"]["blurb"],
    }
    assert MOSS_PRESETS["Quality"]["slg"] == (0.0, 1.0)
    assert MOSS_PRESETS["Quality"]["steps"] == 50 and MOSS_PRESETS["Quality"]["cfg"] == 3.0
    assert MOSS_PRESETS["Turbo"]["steps"] == 8 and MOSS_PRESETS["Turbo"]["cfg"] == 1.0
    assert MOSS_PRESETS["Turbo"]["adapter"] == "dmd8" and MOSS_PRESETS["Turbo"]["slg"] is None


def test_candidate_presets_are_additive():
    assert set(BASE_PRESET_IDS).isdisjoint(CANDIDATE_PRESET_IDS)
    assert MOSS_PRESETS["Rapid"]["adapter"] == "rapid4"
    assert MOSS_PRESETS["Draft3"]["adapter"] == "draft3"
    # Spectrum presets keep their base sampler/step counts, full SLG range.
    assert MOSS_PRESETS["FastSpectrum"]["steps"] == MOSS_PRESETS["Fast"]["steps"]
    assert MOSS_PRESETS["FastSpectrum"]["sampler"] == MOSS_PRESETS["Fast"]["sampler"]
    assert MOSS_PRESETS["FastSpectrum"]["slg"] == (0.0, 1.0)
    assert MOSS_PRESETS["QualitySpectrum"]["slg"] == (0.0, 1.0)
    # Turbo/Rapid/Draft3 must never get Spectrum (plan: default-off).
    for pid in ("Turbo", "Rapid", "Draft3"):
        assert MOSS_PRESETS[pid]["spectrum"] is False


# --- profile resolution --------------------------------------------------------


def test_default_profile_is_validated_baseline():
    profile = resolve_profile({})
    assert profile["profile_id"] == "baseline"
    assert profile["status"] == "validated"
    assert profile["memory_mode"] == "auto"
    assert profile["dit_format"] == "int8_convrot"
    assert profile["encoder_format"] == "w4a8"
    assert profile["compile_backend"] == "off"


def test_overrides_resolve_to_declared_profile_wholesale():
    profile = resolve_profile({"MOSS_MEMORY_MODE": "highvram"})
    # Canonical identity: the override matched resident-highvram-int8, so that
    # is the recorded profile — never "baseline" behaving differently.
    assert profile["profile_id"] == "resident-highvram-int8"


def test_undocumented_combination_rejected():
    with pytest.raises(ProfileError, match="undocumented profile"):
        resolve_profile({"MOSS_MEMORY_MODE": "gpu_only", "MOSS_DIT_FORMAT": "bf16"})


def test_unknown_profile_and_bad_values_rejected():
    with pytest.raises(ProfileError, match="Unknown MOSS_RUNTIME_PROFILE"):
        resolve_profile({"MOSS_RUNTIME_PROFILE": "scrap-heap"})
    with pytest.raises(ProfileError, match="MOSS_MEMORY_MODE"):
        resolve_profile({"MOSS_MEMORY_MODE": "turbo_ram"})
    with pytest.raises(ProfileError, match="MOSS_COMPILE_BACKEND"):
        resolve_profile({"MOSS_COMPILE_BACKEND": "tensorrt"})


def test_warmup_override_requires_declared_variant():
    warmed = resolve_profile({"MOSS_WARMUP": "true"})
    assert warmed["profile_id"] == "baseline-warm"
    assert warmed["warmup"] is True
    assert resolve_profile({"MOSS_WARMUP": "false"})["profile_id"] == "baseline"


def test_quantized_profiles_require_cuda13_bf16_does_not():
    assert resolve_profile({})["requires_cuda13"] is False
    assert resolve_profile({"MOSS_RUNTIME_PROFILE": "resident-auto-int8"})["requires_cuda13"] is True
    bf16 = resolve_profile({"MOSS_RUNTIME_PROFILE": "dit-bf16-highvram-w4a8"})
    assert bf16["requires_cuda13"] is True  # w4a8 encoder keeps the requirement
    from moss_config import RUNTIME_PROFILES
    assert RUNTIME_PROFILES["dit-bf16-highvram-w4a8"]["encoder_format"] == "w4a8"


# --- preset enablement and size policy -----------------------------------------


def test_baseline_does_not_enable_candidate_presets():
    profile, enabled = resolve_enabled_presets({})
    assert enabled == BASE_PRESET_IDS


def test_adapters_profile_enables_candidates_technically():
    profile, enabled = resolve_enabled_presets({"MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters"})
    assert set(CANDIDATE_PRESET_IDS) <= set(enabled)


def test_enabled_presets_env_is_an_intersection():
    _profile, enabled = resolve_enabled_presets({
        "MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters",
        "MOSS_ENABLED_PRESETS": "Fast,Rapid",
    })
    assert enabled == ("Fast", "Rapid")
    with pytest.raises(ProfileError, match="unknown presets"):
        resolve_enabled_presets({"MOSS_ENABLED_PRESETS": "Fast,Jetpack"})


def test_validate_request_preset_rejects_candidates_on_baseline():
    with pytest.raises(PresetUnsupportedError, match="not enabled"):
        validate_request_preset("Rapid", 1024, 1024, {})


def test_validate_request_preset_returns_effective_steps():
    profile, preset, steps = validate_request_preset("Fast", 768, 1152, {})
    assert steps == 25 and preset["cfg"] == 2.5


def test_rapid_v1_hard_one_megapixel_limit():
    """v1 Rapid: exactly 4 steps with a hard technical 1 MP limit — the old
    6/8-step area ladder is unreachable without a separately declared profile."""
    assert effective_preset("Rapid", 1024, 1024)[1] == 4
    assert effective_preset("Rapid", 768, 1024)[1] == 4          # 0.75 MP
    assert effective_preset("Rapid", 512, 512)[1] == 4
    with pytest.raises(PresetUnsupportedError, match="above the limit"):
        effective_preset("Rapid", 1024, 1040)                    # 1,064,960 px — just over
    with pytest.raises(PresetUnsupportedError):
        effective_preset("Rapid", 1536, 1024)                    # 1.5 MP
    with pytest.raises(PresetUnsupportedError):
        effective_preset("Rapid", 2048, 2048)                    # 4 MP


def test_rapid_technical_limit_holds_for_every_profile():
    """The technical limit applies to production, preview and benchmark paths
    alike; a declared profile may LOWER it via preset_area_limits, never raise it."""
    for pid in ("rapid-auto-int8-cu128", "resident-highvram-int8-adapters"):
        profile = resolve_profile({"MOSS_RUNTIME_PROFILE": pid})
        with pytest.raises(PresetUnsupportedError):
            effective_preset("Rapid", 2048, 2048, profile=profile)
    lowered = dict(resolve_profile({}), preset_area_limits={"Rapid": 0.5})
    with pytest.raises(PresetUnsupportedError, match="0.5 MP"):
        effective_preset("Rapid", 1024, 1024, profile=lowered)
    assert effective_preset("Rapid", 512, 512, profile=lowered)[1] == 4


def test_draft3_one_megapixel_limit():
    assert effective_preset("Draft3", 1024, 1024)[1] == 3
    assert effective_preset("Draft3", 768, 1152)[1] == 3  # 0.75 MP
    with pytest.raises(PresetUnsupportedError, match="Draft β"):
        effective_preset("Draft3", 1024, 1536)  # 1.5 MP


def test_unsupported_size_message_is_actionable():
    with pytest.raises(PresetUnsupportedError) as exc:
        effective_preset("Draft3", 2048, 2048)
    message = str(exc.value)
    assert "supports up to 1 MP" in message
    assert "2048×2048 (4.00 MP)" in message
    assert "reduce the canvas size" in message.lower()


# --- capabilities ---------------------------------------------------------------


def test_capabilities_only_advertise_validated_profile_presets():
    baseline_caps = capabilities(resolve_profile({}), model_manifest_id="m1")
    assert [p["id"] for p in baseline_caps["presets"]] == list(BASE_PRESET_IDS)
    assert baseline_caps["runtime_profile"] == "baseline"
    assert baseline_caps["restrictions"]["draft3_max_area_mp"] == 1

    candidate = resolve_profile({"MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters"})
    # Candidate status: even though Rapid is technically enabled, it is not
    # advertised until the profile is promoted (status flip).
    assert advertised_presets(candidate) == list(BASE_PRESET_IDS)


def test_rapid_advertisement_requires_validated_or_experimental():
    import copy
    from moss_config import RUNTIME_PROFILES

    # Promoted: Rapid validated at its 1 MP bucket → validated advertisement.
    promoted = copy.deepcopy(RUNTIME_PROFILES["resident-highvram-int8-adapters"])
    promoted["status"] = "validated"
    promoted["validated_presets"].update(Rapid=1)
    caps = capabilities(promoted)
    by_id = {p["id"]: p for p in caps["presets"]}
    assert by_id["Rapid"]["validation_status"] == "validated"
    assert by_id["Rapid"]["max_area_mp"] == 1

    # Experimental opt-in: advertised but explicitly NOT validated, technical limit only.
    candidate = copy.deepcopy(RUNTIME_PROFILES["rapid-auto-int8-cu128"])
    caps = capabilities(candidate, experimental=("Rapid",))
    by_id = {p["id"]: p for p in caps["presets"]}
    assert [p["validation_status"] for p in caps["presets"] if p["id"] == "Rapid"] == ["experimental"]
    assert by_id["Rapid"]["max_area_mp"] == 1
    assert by_id["Rapid"]["steps"] == 4 and by_id["Rapid"]["cfg"] == 1.0
    # Without the opt-in the candidate stays hidden even though technically supported.
    assert "Rapid" not in {p["id"] for p in capabilities(candidate)["presets"]}
    # Unknown experimental names are rejected at parse time.
    with pytest.raises(ProfileError, match="unknown presets"):
        resolve_experimental_presets({"MOSS_EXPERIMENTAL_PRESETS": "Rapid,Jetpack"})


def test_validate_request_preset_uses_availability_calculation():
    """HTTP gate = same advertisement calculation as capabilities; benchmark
    mode may execute technical candidates; the technical 1 MP limit applies to
    both paths."""
    env = {"MOSS_RUNTIME_PROFILE": "rapid-auto-int8-cu128"}

    # No experimental opt-in → Rapid rejected over the request API…
    with pytest.raises(PresetUnsupportedError, match="not advertised"):
        validate_request_preset("Rapid", 1024, 1024, dict(env))
    # …but executable in benchmark mode…
    profile, preset, steps = validate_request_preset(
        "Rapid", 1024, 1024, {**env, "MOSS_BENCHMARK_MODE": "true"})
    assert steps == 4 and preset["adapter"] == "rapid4"
    # …and the technical 1 MP limit holds even in benchmark mode.
    with pytest.raises(PresetUnsupportedError, match="above the limit"):
        validate_request_preset("Rapid", 2048, 2048, {**env, "MOSS_BENCHMARK_MODE": "true"})

    # With the explicit opt-in the same request is served normally.
    profile, preset, steps = validate_request_preset(
        "Rapid", 1024, 1024, {**env, "MOSS_EXPERIMENTAL_PRESETS": "Rapid"})
    assert steps == 4

    # Baseline production behaviour unchanged: base presets validated, candidates hidden.
    profile, preset, steps = validate_request_preset("Fast", 1024, 1024, {})
    assert steps == 25
    with pytest.raises(PresetUnsupportedError, match="not enabled"):
        validate_request_preset("Rapid", 1024, 1024, {})


# --- metadata and deployment settings -------------------------------------------


def test_generation_metadata_records_negative_guidance_semantics():
    meta = generation_metadata(
        resolve_profile({}), MOSS_PRESETS["Turbo"], 8,
        model_manifest_id="m1", first_generation_in_worker=True,
    )
    assert meta["negative_guidance_active"] is False  # CFG 1: negative inactive
    assert meta["cfg"] == 1.0 and meta["adapter"] == "dmd8"
    assert meta["first_generation_in_worker"] is True
    fast_meta = generation_metadata(
        resolve_profile({}), MOSS_PRESETS["Fast"], 25,
        model_manifest_id="m1", first_generation_in_worker=False,
    )
    assert fast_meta["negative_guidance_active"] is True
    assert fast_meta["spectrum"] is False


def test_deployment_settings_defaults_and_validation():
    settings = deployment_settings({})
    assert settings == {
        "min_containers": 0, "scaledown_seconds": 300, "snapshot_mode": "off",
    }
    assert deployment_settings({
        "MOSS_MIN_CONTAINERS": "1", "MOSS_SCALEDOWN_SECONDS": "1200",
        "MOSS_SNAPSHOT_MODE": "gpu_experimental",
    }) == {
        "min_containers": 1, "scaledown_seconds": 1200, "snapshot_mode": "gpu_experimental",
    }
    with pytest.raises(ProfileError):
        deployment_settings({"MOSS_SCALEDOWN_SECONDS": "999"})
    with pytest.raises(ProfileError):
        deployment_settings({"MOSS_SNAPSHOT_MODE": "always"})
    with pytest.raises(ProfileError):
        deployment_settings({"MOSS_MIN_CONTAINERS": "4"})
