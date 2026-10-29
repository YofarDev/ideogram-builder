"""Tests for runpod/moss_config.py — presets, profiles, size policy, capabilities."""
import pytest

import moss_config
from moss_config import (
    BASE_PRESET_IDS,
    BENCHMARK_PRESET_IDS,
    CANDIDATE_PRESET_IDS,
    MOSS_PRESETS,
    RUNTIME_PROFILES,
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


@pytest.mark.parametrize("width,height,steps", [
    (512, 512, 4), (768, 1024, 4), (1024, 1024, 4),
    (1024, 1040, 6), (1536, 1024, 6), (2048, 1024, 6),
    (2064, 1024, 8), (2048, 2048, 8),
])
def test_rapid_area_step_boundaries(width, height, steps):
    assert effective_preset("Rapid", width, height)[1] == steps
    assert moss_config.steps_for_area("rapid", width, height) == steps


def test_rapid_technical_limit_holds_for_every_profile():
    """The technical limit applies to production, preview and benchmark paths
    alike; a declared profile may LOWER it via preset_area_limits, never raise it."""
    for pid in ("rapid-auto-int8-cu128", "resident-highvram-int8-adapters"):
        profile = resolve_profile({"MOSS_RUNTIME_PROFILE": pid})
        with pytest.raises(PresetUnsupportedError):
            effective_preset("Rapid", 2048, 2064, profile=profile)
    legacy = resolve_profile({"MOSS_RUNTIME_PROFILE": "rapid-auto-int8-cu128"})
    with pytest.raises(PresetUnsupportedError, match="1 MP"):
        effective_preset("Rapid", 1536, 1024, profile=legacy)
    lowered = dict(resolve_profile({}), preset_area_limits={"Rapid": 0.5})
    with pytest.raises(PresetUnsupportedError, match="0.5 MP"):
        effective_preset("Rapid", 1024, 1024, profile=lowered)
    assert effective_preset("Rapid", 512, 512, profile=lowered)[1] == 4
    raised = dict(legacy, preset_area_limits={"Rapid": 8})
    with pytest.raises(PresetUnsupportedError, match="4 MP"):
        effective_preset("Rapid", 4096, 2048, profile=raised)
    with pytest.raises(PresetUnsupportedError, match="4 MP"):
        moss_config.steps_for_area("rapid", 2048, 2064)


def test_hires_permanent_capabilities_and_requests_agree():
    env = {"MOSS_RUNTIME_PROFILE": "rapid-hires-auto-int8-cu128"}
    profile = resolve_profile(env)
    caps = capabilities(profile, experimental=())
    rapid = next(p for p in caps["presets"] if p["id"] == "Rapid")
    assert rapid["max_area_mp"] == caps["restrictions"]["rapid_max_area_mp"] == 4
    assert rapid["validation_status"] == "validated"
    assert "6 steps" in rapid["blurb"] and "8 steps" in rapid["blurb"]
    for width, height, expected in ((1024, 1024, 4), (1536, 1024, 6), (2048, 2048, 8)):
        _, preset, steps = validate_request_preset("Rapid", width, height, env)
        assert steps == expected and preset["adapter"] == "rapid4"
    with pytest.raises(PresetUnsupportedError, match="4 MP"):
        validate_request_preset("Rapid", 2048, 2064, env)


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


def test_permanent_rapid_needs_no_experimental_opt_in():
    env = {"MOSS_RUNTIME_PROFILE": "rapid-auto-int8-cu128"}
    profile, enabled = resolve_enabled_presets(env)
    caps = capabilities(profile, enabled=enabled, experimental=())
    assert caps["status"] == "validated"
    by_id = {p["id"]: p for p in caps["presets"]}
    assert set(by_id) == set(BASE_PRESET_IDS) | {"Rapid"}
    assert by_id["Rapid"]["validation_status"] == "validated"
    assert by_id["Rapid"]["label"] == "Rapid"
    assert by_id["Rapid"]["max_area_mp"] == 1
    assert "experimental" not in by_id["Rapid"]["blurb"]
    _, preset, steps = validate_request_preset("Rapid", 1024, 1024, env)
    assert steps == 4 and preset["adapter"] == "rapid4"
    with pytest.raises(PresetUnsupportedError, match="above the limit"):
        validate_request_preset("Rapid", 1024, 1536, env)
    for pid in BASE_PRESET_IDS:
        assert effective_preset(pid, 1024, 1024, profile=profile) == effective_preset(pid, 1024, 1024)


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
    candidate["status"] = "candidate"
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
    env = {"MOSS_RUNTIME_PROFILE": "rapid-auto-int8-cu128-warm"}

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


# --- 2026-10-29 quality modes: Poster / Quality30 / vae_full profile ------------
# Sources: docs/research/2026-10-29-moss-inference-guide.md §4/§8 (Reddit
# typography recipes: res-family sampler, CFG 3.5–4, SLG layer 22/24; the
# 30-step iteration-speed report) and §3 (4 MP recipe uses the full FLUX.2 VAE).


def test_poster_candidate_recipe():
    """Poster β — typography-tuned candidate from the good-text reports:
    res_multistep/simple (ComfyUI's res-family; the report's 'res_2s' is not
    a ComfyUI sampler name), CFG 3.75 inside the reported 3.5–4 band, 25
    steps, SLG layer 22 over the full range."""
    assert "Poster" in CANDIDATE_PRESET_IDS
    p = MOSS_PRESETS["Poster"]
    assert p["steps"] == 25 and p["cfg"] == 3.75
    assert p["sampler"] == "res_multistep" and p["scheduler"] == "simple"
    assert p["slg"] == (0.0, 1.0) and p["slg_layers"] == "22"
    assert p["adapter"] is None and p["spectrum"] is False
    assert p["tier"] == "final"


def test_poster_slg_layer_set_benchmark_control():
    """PosterSLG22-24 isolates the community lettering claim (layer sets 22
    vs 22+24) from the rest of the Poster recipe."""
    assert "PosterSLG22-24" in BENCHMARK_PRESET_IDS
    ctrl = MOSS_PRESETS["PosterSLG22-24"]
    base = MOSS_PRESETS["Poster"]
    assert ctrl["slg_layers"] == "22,24"
    for key in ("steps", "cfg", "sampler", "scheduler", "slg", "adapter"):
        assert ctrl[key] == base[key]


def test_base_presets_have_no_slg_layers_override():
    """The frozen Fast/Quality/Turbo dicts stay byte-identical; layer '22'
    remains the builder default when slg_layers is absent."""
    for pid in BASE_PRESET_IDS:
        assert "slg_layers" not in MOSS_PRESETS[pid]


def test_quality30_candidate_recipe():
    """Quality30 β — Quality's recipe at 30 steps (community report: limited
    perceived quality loss from 50 → 30)."""
    assert "Quality30" in CANDIDATE_PRESET_IDS
    p = MOSS_PRESETS["Quality30"]
    q = MOSS_PRESETS["Quality"]
    assert p["steps"] == 30
    for key in ("cfg", "sampler", "scheduler", "slg", "adapter", "spectrum"):
        assert p[key] == q[key]
    assert p["tier"] == "final"


def test_rapid_hires_vae_full_profile():
    """rapid-hires-vae-full: the shipped 4/6/8-step Rapid policy on the cu128
    INT8 baseline with the full FLUX.2 VAE (the community 4 MP recipe's
    decoder). Candidate until visually validated; warm twin auto-declared."""
    prof = RUNTIME_PROFILES["rapid-hires-vae-full-auto-int8-cu128"]
    assert prof["status"] == "candidate"
    assert prof["vae_asset"] == "vae_full"
    assert prof["dit_format"] == "int8_convrot" and prof["encoder_format"] == "w4a8"
    assert prof["preset_area_limits"] == {"Rapid": 4}
    assert set(prof["enabled_presets"]) == set(BASE_PRESET_IDS + ("Rapid",))
    warm = RUNTIME_PROFILES["rapid-hires-vae-full-auto-int8-cu128-warm"]
    assert warm["warmup"] is True and warm["vae_asset"] == "vae_full"
    # Baseline profiles stay on the small VAE.
    assert RUNTIME_PROFILES["baseline"]["vae_asset"] == "vae_small"


def test_candidate_profile_advertises_new_presets_via_experimental_opt_in():
    """Poster/Quality30 ride the existing candidate-preset machinery: enabled
    on an adapter profile, advertised only with explicit experimental opt-in."""
    env = {"MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters",
           "MOSS_EXPERIMENTAL_PRESETS": "Poster,Quality30"}
    profile, enabled = moss_config.resolve_enabled_presets(env)
    assert "Poster" in enabled and "Quality30" in enabled
    ids = [p["id"] for p in moss_config.capabilities(profile, experimental=("Poster", "Quality30"))["presets"]]
    assert "Poster" in ids and "Quality30" in ids
    # Without the opt-in they are enabled but not advertised.
    plain = moss_config.capabilities(profile)["presets"]
    assert "Poster" not in [p["id"] for p in plain]


def test_documented_quality_mode_trial_preserves_runtime_and_accepts_candidates():
    env = {"MOSS_RUNTIME_PROFILE": "rapid-hires-quality-modes-auto-int8-cu128",
           "MOSS_EXPERIMENTAL_PRESETS": "Rapid,Poster,Quality30"}
    profile, enabled = resolve_enabled_presets(env)
    caps = capabilities(profile, enabled=enabled, experimental=resolve_experimental_presets(env))
    assert {p["id"] for p in caps["presets"]} == set(BASE_PRESET_IDS) | {"Rapid", "Poster", "Quality30"}
    assert all(p["validation_status"] == "experimental" for p in caps["presets"] if p["id"] in CANDIDATE_PRESET_IDS)
    production = RUNTIME_PROFILES["rapid-hires-auto-int8-cu128"]
    for key in ("memory_mode", "dit_format", "encoder_format", "compile_backend", "requires_cuda13", "vae_asset"):
        assert profile[key] == production[key]
    for name, steps in (("Poster", 25), ("Quality30", 30), ("Rapid", 4)):
        assert validate_request_preset(name, 1024, 1024, env)[2] == steps
    assert "Poster" not in [p["id"] for p in capabilities(profile, experimental=())["presets"]]
    benchmark = {**env, "MOSS_BENCHMARK_MODE": "true"}
    assert validate_request_preset("PosterSLG22-24", 1024, 1024, benchmark)[2] == 25


def test_documented_full_vae_trial_requires_explicit_rapid_opt_in():
    env = {"MOSS_RUNTIME_PROFILE": "rapid-hires-vae-full-auto-int8-cu128",
           "MOSS_EXPERIMENTAL_PRESETS": "Rapid"}
    profile, enabled = resolve_enabled_presets(env)
    caps = capabilities(profile, enabled=enabled, experimental=resolve_experimental_presets(env))
    rapid = next(p for p in caps["presets"] if p["id"] == "Rapid")
    assert rapid["validation_status"] == "experimental" and rapid["max_area_mp"] == 4
    assert validate_request_preset("Rapid", 2048, 2048, env)[2] == 8


def test_poster_slg_benchmark_control_only_in_benchmark_mode():
    env = {"MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters",
           "MOSS_BENCHMARK_MODE": "true"}
    _profile, enabled = moss_config.resolve_enabled_presets(env)
    assert "PosterSLG22-24" in enabled
    env2 = {k: v for k, v in env.items() if k != "MOSS_BENCHMARK_MODE"}
    _p2, enabled2 = moss_config.resolve_enabled_presets(env2)
    assert "PosterSLG22-24" not in enabled2


def test_generation_metadata_records_negative_suppression():
    """CFG-1 presets never use the negative branch; metadata must say so."""
    turbo = MOSS_PRESETS["Turbo"]
    meta = moss_config.generation_metadata(
        RUNTIME_PROFILES["baseline"], turbo, 8, first_generation_in_worker=True)
    assert meta["negative_prompt_suppressed"] is True
    fast_meta = moss_config.generation_metadata(
        RUNTIME_PROFILES["baseline"], MOSS_PRESETS["Fast"], 25,
        first_generation_in_worker=True)
    assert fast_meta["negative_prompt_suppressed"] is False
