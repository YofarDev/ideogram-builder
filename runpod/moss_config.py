"""MOSS runtime profiles, preset definitions and deployment settings.

CPU-only module: no GPU, ComfyUI or network imports. Shared by the MOSS image
(runpod/Dockerfile.moss), the Modal proxy capabilities endpoint and the tests.

Design (docs/plans/2026-10-27-moss-inference-optimization-implementation.md):
separate deployment choices from generation choices. A generation request only
picks an advertised preset plus prompt/dimensions/seed/LoRAs; everything that
changes numeric behaviour (formats, residency, compilation, warmup) is captured
by a *named, immutable* runtime profile. Partial env overrides are only accepted
when the resulting configuration matches another declared profile exactly, so
undocumented combinations cannot be served by accident.
"""

import copy
import os

# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------
# Sampling semantics of the three shipped presets are frozen (they are the
# compatibility contract with saved sessions and old RunPod endpoints).
# Candidate presets are additive and initially only advertised by validated,
# optimized profiles — see advertised_presets()/capabilities().

BASE_PRESET_IDS = ("Fast", "Quality", "Turbo")
CANDIDATE_PRESET_IDS = ("Rapid", "Draft3", "FastSpectrum", "QualitySpectrum")

MOSS_PRESETS = {
    "Fast": {
        "steps": 25, "cfg": 2.5, "sampler": "er_sde", "scheduler": "simple",
        "slg": (0.0, 0.5), "adapter": None, "spectrum": False,
        "label": "Fast", "tier": "final",
        "blurb": "25 steps, balanced quality/speed",
    },
    "Quality": {
        "steps": 50, "cfg": 3.0, "sampler": "euler", "scheduler": "simple",
        "slg": (0.0, 1.0), "adapter": None, "spectrum": False,
        "label": "Quality", "tier": "final",
        "blurb": "50 steps, maximum quality",
    },
    "Turbo": {
        "steps": 8, "cfg": 1.0, "sampler": "euler", "scheduler": "simple",
        "slg": None, "adapter": "dmd8", "spectrum": False,
        "label": "Turbo β", "tier": "final",
        "blurb": "8 steps, DMD distillation",
    },
    # Rapid — akhaliq four-step adapter, v2.0 Euler-native release, strength 1,
    # euler/simple, CFG 1, no SLG. v1 carries a hard technical 1 MP limit
    # (max_area_mp): exactly four steps, never the six/eight-step ladder — those
    # larger buckets stay unreachable until a separately declared profile lifts
    # the limit. Quality is explicitly unvalidated: experimental until measured.
    "Rapid": {
        "steps": 4, "cfg": 1.0, "sampler": "euler", "scheduler": "simple",
        "slg": None, "adapter": "rapid4", "spectrum": False,
        "label": "Rapid", "tier": "final",
        "blurb": "4 steps · up to 1 MP",
        "steps_policy": "rapid",
        "max_area_mp": 1,
    },
    # Draft β — the separately trained three-step adapter. Never run the
    # four-step LoRA for three steps instead.
    "Draft3": {
        "steps": 3, "cfg": 1.0, "sampler": "euler", "scheduler": "simple",
        "slg": None, "adapter": "draft3", "spectrum": False,
        "label": "Draft β", "tier": "preview",
        "blurb": "3 steps, 1024² max — preview quality",
        "steps_policy": "draft3",
        "max_area_mp": 1,
    },
    # Spectrum presets keep their base preset's sampler/steps; FastSpectrum
    # moves to the full SLG range (the Spectrum author recommends 0–1 because a
    # partial range forces forecast-history rebuilds). The SLG change is
    # benchmarked separately from Spectrum itself.
    "FastSpectrum": {
        "steps": 25, "cfg": 2.5, "sampler": "er_sde", "scheduler": "simple",
        "slg": (0.0, 1.0), "adapter": None, "spectrum": True,
        "label": "Fast+ β", "tier": "final",
        "blurb": "Fast with feature forecasting acceleration",
    },
    "QualitySpectrum": {
        "steps": 50, "cfg": 3.0, "sampler": "euler", "scheduler": "simple",
        "slg": (0.0, 1.0), "adapter": None, "spectrum": True,
        "label": "Quality+ β", "tier": "final",
        "blurb": "Quality with feature forecasting acceleration",
    },
}

# Benchmark-only SLG control isolates the range change from Spectrum itself.
BENCHMARK_PRESET_IDS = ("FastFullSLG",)
MOSS_PRESETS["FastFullSLG"] = {**MOSS_PRESETS["Fast"], "slg": (0.0, 1.0), "label": "Fast full SLG control"}

# Distillation adapters are mutually exclusive: the control-adapter slot hosts
# exactly one adapter, and Rapid/Draft3 must never stack with Turbo's DMD8.
DISTILLATION_ADAPTERS = ("dmd8", "rapid4", "draft3")

# Spectrum manual node (ComfyUI-Spectrum-MOSS v0.8.1, commit d3f7e243...).
# Conservative policy per the plan: 8 warmup steps, 1 actual tail step,
# GPU-resident history (main_device), release defaults otherwise. For ER-SDE
# the documented maximum of ONE consecutive forecast is enforced.
SPECTRUM_NODE_TYPE = "SpectrumMOSSImageManual"
SPECTRUM_NODE_DEFAULTS = {
    "warmup_steps": 8,
    "tail_actual_steps": 1,
    "window_size": 2.0,
    "flex_window": 0.75,
    "history_points": 8,
    "chebyshev_degree": 4,
    "ridge_lambda": 0.1,
    "blend_weight": 0.5,
    "cache_device": "main_device",
    "force_actual_on_control": True,
    "debug": False,
    "warn_unverified_sampler": True,
}
SPECTRUM_MAX_CONSECUTIVE_FORECASTS = {"er_sde": 1, "euler": 2}

# TorchCompileModel (pinned ComfyUI commit 7cebca52...): backend options are
# exactly ["inductor", "cudagraphs"]; validated against /object_info at runtime.
COMPILE_NODE_TYPE = "TorchCompileModel"

# ---------------------------------------------------------------------------
# Resolution policy (Phase 4 area buckets — project policy to validate)
# ---------------------------------------------------------------------------

MP = 1024 * 1024  # one megapixel, in pixels


class ProfileError(ValueError):
    """Deployment configuration is invalid or produces an undocumented profile."""


class PresetUnsupportedError(ValueError):
    """Requested preset/size is not supported by the active profile; message is
    written to be shown to a user verbatim (actionable, not a stack trace)."""


def preset_area_limit(preset_name, profile=None):
    """Hard technical area limit (MP) for a preset: the profile may only lower
    it via its declared preset_area_limits — lifting the Rapid limit beyond its
    technical value requires a NEW preset/profile declaration, never an env
    override. Enforced for production AND benchmark requests alike."""
    preset = MOSS_PRESETS.get(preset_name) or {}
    technical = preset.get("max_area_mp")
    if profile is not None:
        declared = (profile.get("preset_area_limits") or {}).get(preset_name)
        if declared is not None:
            return min(declared, technical) if technical is not None else declared
    return technical


def steps_for_area(policy, width, height):
    """Effective step count for an area-based preset policy.

    rapid: exactly 4 steps at ≤1 MP (the v1 hard limit; the 6/8-step buckets
    below stay unreachable until a declared profile lifts preset_area_limits).
    draft3: 3 steps ≤1 MP. Raises PresetUnsupportedError beyond the supported
    area with an actionable message — never silently resizes a layout.
    """
    pixels = width * height
    if policy == "rapid":
        if pixels <= 1 * MP:
            return 4
        # Larger buckets (6 steps ≤2 MP, 8 steps ≤4 MP) exist only for a future
        # declared profile that lifts preset_area_limits; the hard technical
        # limit enforced in effective_preset makes this branch unreachable today.
        limit = "2 MP" if pixels <= 2 * MP else "4 MP"
    elif policy == "draft3":
        if pixels <= 1 * MP:
            return 3
        limit = "1 MP"
    else:
        return None
    raise PresetUnsupportedError(
        f"{preset_label_for_policy(policy)} supports up to {limit}; "
        f"requested {width}x{height} ({pixels / MP:.2f} MP) is above the enabled area. "
        f"Reduce the canvas size or use Fast/Quality/Turbo."
    )


def preset_label_for_policy(policy):
    return {"rapid": "Rapid β", "draft3": "Draft β"}.get(policy, policy)


def effective_preset(preset_name, width, height, *, profile=None):
    """Returns (preset_definition, effective_steps). Enforces the preset's hard
    technical area limit (profile may lower it), then the area-step policy.
    Raises PresetUnsupportedError with an actionable message."""
    preset = MOSS_PRESETS.get(preset_name)
    if preset is None:
        raise PresetUnsupportedError(f"Unknown MOSS preset '{preset_name}'")
    limit = preset_area_limit(preset_name, profile)
    if limit is not None and width * height > limit * MP:
        raise PresetUnsupportedError(
            f"{preset['label']} supports up to {limit} MP ({int((limit * MP) ** 0.5)}×{int((limit * MP) ** 0.5)} "
            f"or equivalent area); requested {width}×{height} ({width * height / MP:.2f} MP) is above the limit. "
            f"Keep the selected recipe and reduce the canvas size."
        )
    steps = preset["steps"]
    policy = preset.get("steps_policy")
    if policy:
        steps = steps_for_area(policy, width, height)
    return preset, steps


# ---------------------------------------------------------------------------
# Runtime profiles
# ---------------------------------------------------------------------------

MEMORY_MODES = ("auto", "highvram", "gpu_only")
COMPILE_BACKENDS = ("off", "inductor", "cudagraphs")
DIT_FORMATS = ("int8_convrot", "bf16", "rapid4_fp32")
ENCODER_FORMATS = ("w4a8", "int8_convrot", "bf16")

ASSET_BY_FORMAT = {
    "dit": {"int8_convrot": "dit_int8_convrot", "bf16": "dit_bf16", "rapid4_fp32": "dit_rapid4_fp32"},
    "encoder": {"w4a8": "enc_w4a8", "int8_convrot": "enc_int8_convrot", "bf16": "enc_bf16"},
}


def _profile(profile_id, *, description, status, memory_mode, dit_format,
             encoder_format, compile_backend="off", warmup=False,
             requires_cuda13=None, enabled_presets=BASE_PRESET_IDS,
             merged_adapter=None, validated_presets=None):
    if memory_mode not in MEMORY_MODES:
        raise ProfileError(f"profile {profile_id}: bad memory_mode")
    if dit_format not in DIT_FORMATS or encoder_format not in ENCODER_FORMATS:
        raise ProfileError(f"profile {profile_id}: bad format")
    if compile_backend not in COMPILE_BACKENDS:
        raise ProfileError(f"profile {profile_id}: bad compile backend")
    # Quantized formats dispatch through comfy-kitchen, whose CUDA backend is
    # hard-disabled below cu130 (comfy/quant_ops.py at the pinned commit).
    # bf16 has no such requirement — do not enforce the gate for it.
    if requires_cuda13 is None:
        requires_cuda13 = "int8" in dit_format or encoder_format in ("w4a8", "int8_convrot")
    return {
        "profile_id": profile_id,
        "description": description,
        "status": status,  # "validated" | "candidate"
        "memory_mode": memory_mode,
        "dit_format": dit_format,
        "encoder_format": encoder_format,
        "compile_backend": compile_backend,
        "warmup": bool(warmup),
        "requires_cuda13": bool(requires_cuda13),
        "enabled_presets": tuple(enabled_presets),
        "vae_asset": "vae_small",
        "merged_adapter": merged_adapter,
        # Validation is per recipe and resolution, independently of whether a
        # runtime profile has passed its infrastructure gate. Values are MP.
        "validated_presets": {
            **{pid: None for pid in enabled_presets if pid in BASE_PRESET_IDS},
            **(validated_presets or {}),
        },
    }


# Named, immutable profile IDs capturing complete effective configurations.
# Baseline is retained for rollback; the measured Rapid profile is promoted
# following user visual acceptance. Other candidates remain unpromoted.
RUNTIME_PROFILES = {
    "baseline": _profile(
        "baseline",
        description="Current production behaviour: INT8 DiT + W4A8 encoder, auto residency, no compile.",
        status="validated",
        memory_mode="auto", dit_format="int8_convrot", encoder_format="w4a8",
        requires_cuda13=False,
    ),
    "rapid-auto-int8-cu128": _profile(
        "rapid-auto-int8-cu128",
        description="Production Rapid on the measured cu128 baseline: INT8 DiT + W4A8 encoder, "
                    "auto residency, eager kernels tolerated (as baseline), no compile, no warmup. "
                    "User-accepted Rapid at ≤1 MP plus the three existing recipes unchanged.",
        status="validated",
        memory_mode="auto", dit_format="int8_convrot", encoder_format="w4a8",
        requires_cuda13=False,
        enabled_presets=BASE_PRESET_IDS + ("Rapid",),
        validated_presets={"Rapid": 1},
    ),
    "resident-auto-int8": _profile(
        "resident-auto-int8",
        description="Baseline formats with verified cu130+ accelerated kernels, auto residency.",
        status="candidate",
        memory_mode="auto", dit_format="int8_convrot", encoder_format="w4a8",
    ),
    "resident-highvram-int8": _profile(
        "resident-highvram-int8",
        description="INT8 DiT + W4A8 encoder pinned in VRAM (--highvram).",
        status="candidate",
        memory_mode="highvram", dit_format="int8_convrot", encoder_format="w4a8",
    ),
    "resident-gpuonly-int8": _profile(
        "resident-gpuonly-int8",
        description="INT8 DiT + W4A8 encoder, everything resident (--gpu-only).",
        status="candidate",
        memory_mode="gpu_only", dit_format="int8_convrot", encoder_format="w4a8",
    ),
    "dit-bf16-highvram-w4a8": _profile(
        "dit-bf16-highvram-w4a8",
        description="BF16 DiT with W4A8 encoder, highvram residency.",
        status="candidate",
        memory_mode="highvram", dit_format="bf16", encoder_format="w4a8",
    ),
    "dit-bf16-highvram-int8enc": _profile(
        "dit-bf16-highvram-int8enc",
        description="BF16 DiT with INT8 convrot encoder (akhaliq reference combination), highvram.",
        status="candidate",
        memory_mode="highvram", dit_format="bf16", encoder_format="int8_convrot",
    ),
    "dit-int8-highvram-bf16enc": _profile(
        "dit-int8-highvram-bf16enc",
        description="INT8 DiT with BF16 encoder, highvram residency.",
        status="candidate",
        memory_mode="highvram", dit_format="int8_convrot", encoder_format="bf16",
    ),
    "compile-inductor-resident-int8": _profile(
        "compile-inductor-resident-int8",
        description="Inductor compilation on the residency/precision winner placeholder (INT8/highvram).",
        status="candidate",
        memory_mode="highvram", dit_format="int8_convrot", encoder_format="w4a8",
        compile_backend="inductor",
    ),
    "compile-cudagraphs-resident-int8": _profile(
        "compile-cudagraphs-resident-int8",
        description="CUDA-graphs compilation on the residency/precision winner placeholder (INT8/highvram).",
        status="candidate",
        memory_mode="highvram", dit_format="int8_convrot", encoder_format="w4a8",
        compile_backend="cudagraphs",
    ),
    "resident-highvram-int8-adapters": _profile(
        "resident-highvram-int8-adapters",
        description="Residency winner extended with Rapid/Draft3/Spectrum candidate presets.",
        status="candidate",
        memory_mode="highvram", dit_format="int8_convrot", encoder_format="w4a8",
        enabled_presets=BASE_PRESET_IDS + CANDIDATE_PRESET_IDS,
    ),
}

RUNTIME_PROFILES["bf16-adapters"] = _profile(
    "bf16-adapters", description="Documented BF16 DiT / INT8 encoder adapter reference.",
    status="candidate", memory_mode="highvram", dit_format="bf16",
    encoder_format="int8_convrot", enabled_presets=BASE_PRESET_IDS + CANDIDATE_PRESET_IDS,
)
RUNTIME_PROFILES["rapid-fp32-reference"] = _profile(
    "rapid-fp32-reference", description="Merged FP32 Rapid DiT; no separate distillation LoRA.",
    status="candidate", memory_mode="highvram", dit_format="rapid4_fp32",
    encoder_format="int8_convrot", enabled_presets=("Rapid",), merged_adapter="rapid4",
)
# Explicit identities make enabled warmup usable and reproducible for every
# supported format/residency combination, without changing their numerics.
for _pid, _base in list(RUNTIME_PROFILES.items()):
    _warmed = copy.deepcopy(_base)
    _warmed.update(profile_id=_pid + "-warm", warmup=True, status="candidate")
    RUNTIME_PROFILES[_pid + "-warm"] = _warmed

PROFILE_ENV_FIELDS = {
    "MOSS_MEMORY_MODE": "memory_mode",
    "MOSS_DIT_FORMAT": "dit_format",
    "MOSS_ENCODER_FORMAT": "encoder_format",
    "MOSS_COMPILE_BACKEND": "compile_backend",
}

PROFILE_ENV_CHOICES = {
    "MOSS_MEMORY_MODE": MEMORY_MODES,
    "MOSS_DIT_FORMAT": DIT_FORMATS,
    "MOSS_ENCODER_FORMAT": ENCODER_FORMATS,
    "MOSS_COMPILE_BACKEND": COMPILE_BACKENDS,
}

def resolve_profile(env=None):
    """Resolve the effective runtime profile from environment variables.

    MOSS_RUNTIME_PROFILE selects a declared profile; MOSS_MEMORY_MODE /
    MOSS_DIT_FORMAT / MOSS_ENCODER_FORMAT / MOSS_COMPILE_BACKEND /
    MOSS_WARMUP may adjust it — but only when the result matches another
    declared profile exactly, otherwise ProfileError. Unknown values are
    rejected outright. Returns a fresh dict.
    """
    env = os.environ if env is None else env
    profile_id = env.get("MOSS_RUNTIME_PROFILE", "baseline")
    if profile_id not in RUNTIME_PROFILES:
        raise ProfileError(
            f"Unknown MOSS_RUNTIME_PROFILE '{profile_id}'. "
            f"Declared profiles: {', '.join(sorted(RUNTIME_PROFILES))}"
        )
    profile = copy.deepcopy(RUNTIME_PROFILES[profile_id])

    for var, field in PROFILE_ENV_FIELDS.items():
        raw = env.get(var)
        if raw is None or raw == "":
            continue
        raw = raw.strip().lower()
        if raw not in PROFILE_ENV_CHOICES[var]:
            raise ProfileError(
                f"{var}='{raw}' is invalid. Valid values: {', '.join(PROFILE_ENV_CHOICES[var])}"
            )
        profile[field] = raw

    warm_raw = env.get("MOSS_WARMUP", "").strip().lower()
    if warm_raw:
        if warm_raw not in ("true", "false"):
            raise ProfileError(f"MOSS_WARMUP='{warm_raw}' is invalid. Valid values: true, false")
        profile["warmup"] = warm_raw == "true"

    # The effective configuration must still be a declared profile. This is
    # what keeps partial overrides from inventing undocumented combinations —
    # the returned profile is the declared one wholesale, so metadata always
    # records a canonical profile_id even when overrides were used to select it.
    identity = profile_id.removesuffix("-warm") + ("-warm" if profile["warmup"] else "")
    preferred = RUNTIME_PROFILES[identity]
    match = _match_declared_profile(profile, preferred=preferred)
    if match is None:
        raise ProfileError(
            f"Environment overrides on '{profile_id}' produce an undocumented profile "
            f"({profile['memory_mode']}/{profile['dit_format']}/{profile['encoder_format']}/"
            f"compile={profile['compile_backend']}). "
            f"Use a declared MOSS_RUNTIME_PROFILE or add the validated combination to RUNTIME_PROFILES."
        )
    return copy.deepcopy(match)


def _match_declared_profile(profile, preferred=None):
    keys = ("memory_mode", "dit_format", "encoder_format", "compile_backend", "warmup", "enabled_presets", "merged_adapter")
    matches = [p for p in RUNTIME_PROFILES.values() if all(profile[k] == p[k] for k in keys)]
    if preferred is not None and preferred in matches:
        return preferred
    if len(matches) > 1:
        raise ProfileError("Ambiguous runtime overrides; select an explicit MOSS_RUNTIME_PROFILE")
    return matches[0] if matches else None


def resolve_enabled_presets(env=None):
    """Presets the handler will accept: profile technical support ∩ env allow-list.
    Advertisement to clients is narrower — see advertised_presets()."""
    env = os.environ if env is None else env
    profile = resolve_profile(env)
    enabled = set(profile["enabled_presets"])
    if env.get("MOSS_BENCHMARK_MODE") == "true" and "Fast" in enabled:
        enabled.update(BENCHMARK_PRESET_IDS)
    raw = (env.get("MOSS_ENABLED_PRESETS") or "").strip()
    if raw:
        allowed = {p.strip() for p in raw.split(",") if p.strip()}
        unknown = allowed - set(MOSS_PRESETS)
        if unknown:
            raise ProfileError(f"MOSS_ENABLED_PRESETS names unknown presets: {', '.join(sorted(unknown))}")
        enabled &= allowed
    return profile, tuple(p for p in (BASE_PRESET_IDS + CANDIDATE_PRESET_IDS + BENCHMARK_PRESET_IDS) if p in enabled)


def resolve_experimental_presets(env=None):
    """Explicit experimental-preview allow-list (plan 2026-10-28 §4), e.g.
    MOSS_EXPERIMENTAL_PRESETS=Rapid. Default empty: unvalidated presets stay
    hidden until a per-preset validation gate passes. Parsed/validated here and
    frozen into both the GPU container and the CPU proxy environment."""
    env = os.environ if env is None else env
    raw = (env.get("MOSS_EXPERIMENTAL_PRESETS") or "").strip()
    if not raw:
        return ()
    wanted = tuple(dict.fromkeys(p.strip() for p in raw.split(",") if p.strip()))
    unknown = [p for p in wanted if p not in MOSS_PRESETS]
    if unknown:
        raise ProfileError(
            f"MOSS_EXPERIMENTAL_PRESETS names unknown presets: {', '.join(unknown)}. "
            f"Known: {', '.join(sorted(MOSS_PRESETS))}"
        )
    return wanted


def advertised_presets(profile, enabled=None, experimental=()):
    """Presets shown to clients AND accepted over the request API: technical
    support ∩ (validated recipes ∪ explicit experimental opt-in). Experimental
    entries carry their own unvalidated status and area limit — they are never
    presented as validated. Benchmark mode bypasses advertisement entirely so
    technical candidates can be measured before promotion."""
    allowed = set(profile["enabled_presets"] if enabled is None else enabled)
    validated = profile.get("validated_presets", {})
    experimental = set(experimental)
    result = []
    for pid in profile["enabled_presets"]:
        if pid not in allowed:
            continue
        if pid in validated and (pid in BASE_PRESET_IDS or profile.get("status") == "validated"):
            result.append(pid)
        elif pid in experimental:
            result.append(pid)
    return result


def validate_request_preset(preset_name, width, height, env=None):
    """Full server-side gate for a generation request. Returns (profile, preset,
    effective_steps). Raises PresetUnsupportedError with an actionable message.
    Uses the same availability calculation as capabilities(): validated recipes
    plus explicit experimental opt-in; benchmark mode may execute technical
    candidates. The per-preset technical area limit applies to ALL paths."""
    env = os.environ if env is None else env
    benchmark_mode = env.get("MOSS_BENCHMARK_MODE") == "true"
    profile, enabled = resolve_enabled_presets(env)
    advertised = advertised_presets(profile, enabled, resolve_experimental_presets(env))
    if preset_name not in enabled:
        raise PresetUnsupportedError(
            f"Preset '{preset_name}' is not enabled on this deployment "
            f"(profile '{profile['profile_id']}'). Available: {', '.join(enabled)}"
        )
    if preset_name not in advertised and not benchmark_mode:
        raise PresetUnsupportedError(
            f"Preset '{preset_name}' is not advertised on this deployment "
            f"(profile '{profile['profile_id']}'). Available: {', '.join(advertised)}"
        )
    limit = preset_area_limit(preset_name, profile)
    if limit is not None and width * height > limit * MP:
        raise PresetUnsupportedError(
            f"Preset '{preset_name}' supports up to {limit} MP; requested "
            f"{width}×{height} ({width * height / MP:.2f} MP) is above the limit. "
            f"Keep the selected recipe and reduce the canvas size."
        )
    validated_limit = profile.get("validated_presets", {}).get(preset_name)
    is_validated = preset_name in BASE_PRESET_IDS or profile.get("status") == "validated"
    if is_validated and validated_limit is not None and width * height > validated_limit * MP and not benchmark_mode:
        raise PresetUnsupportedError(f"Preset '{preset_name}' is validated only up to {validated_limit} MP on this deployment")
    preset, steps = effective_preset(preset_name, width, height, profile=profile)
    return profile, preset, steps


# ---------------------------------------------------------------------------
# Capabilities (served by the Modal proxy; never starts a GPU container)
# ---------------------------------------------------------------------------

def capabilities(profile, model_manifest_id=None, enabled=None, experimental=None):
    """Advertised preset list. Validated recipes carry
    validation_status="validated" with their validated area limit; experimental
    opt-ins carry validation_status="experimental" with the technical limit —
    they must never look like validated recipes."""
    if experimental is None:
        experimental = resolve_experimental_presets()
    presets = []
    for pid in advertised_presets(profile, enabled, experimental):
        preset = MOSS_PRESETS[pid]
        is_experimental = pid not in profile.get("validated_presets", {}) or not (
            pid in BASE_PRESET_IDS or profile.get("status") == "validated")
        limit = preset_area_limit(pid, profile)
        if not is_experimental:
            validated_limit = profile.get("validated_presets", {}).get(pid)
            if validated_limit is not None:
                limit = min(limit, validated_limit) if limit is not None else validated_limit
        entry = {
            "id": pid,
            "label": preset["label"],
            "tier": preset["tier"],
            "blurb": preset["blurb"],
            "steps": preset["steps"],
            "cfg": preset["cfg"],
            "sampler": preset["sampler"],
            "scheduler": preset["scheduler"],
            "validation_status": "experimental" if is_experimental else "validated",
            "max_area_mp": limit,
        }
        if preset.get("steps_policy"):
            entry["steps_policy"] = preset["steps_policy"]
        presets.append(entry)
    return {
        "schema_version": 1,
        "runtime_profile": profile["profile_id"],
        "status": profile.get("status"),
        "model_manifest_id": model_manifest_id,
        "presets": presets,
        "restrictions": {
            "width_height_multiple": 16,
            "rapid_max_area_mp": 1,
            "draft3_max_area_mp": 1,
            "lora_directory": "user/",
        },
    }


def generation_metadata(profile, preset, effective_steps, *, preset_id="",
                       model_manifest_id=None, first_generation_in_worker,
                       spectrum_enabled=None, compile_backend=None, adapter=None):
    """The `generation` block attached to results (schema v1). Records the
    recipe actually executed — numeric-behaviour changes must land here."""
    spectrum_enabled = preset["spectrum"] if spectrum_enabled is None else spectrum_enabled
    compile_backend = profile["compile_backend"] if compile_backend is None else compile_backend
    adapter = preset["adapter"] if adapter is None else adapter
    return {
        "schema_version": 1,
        "runtime_profile": profile["profile_id"],
        "preset": preset.get("label", ""),
        "preset_id": preset_id,
        "effective_steps": effective_steps,
        "cfg": preset["cfg"],
        "sampler": preset["sampler"],
        "scheduler": preset["scheduler"],
        "negative_guidance_active": preset["cfg"] > 1.0,
        "adapter": adapter,
        "spectrum": bool(spectrum_enabled),
        "compile_backend": compile_backend,
        "memory_mode": profile["memory_mode"],
        "dit_format": profile["dit_format"],
        "encoder_format": profile["encoder_format"],
        "warmup": profile["warmup"],
        "slg": preset["slg"],
        "merged_adapter": profile.get("merged_adapter"),
        "model_manifest_id": model_manifest_id,
        "first_generation_in_worker": bool(first_generation_in_worker),
    }


def deployment_settings(env=None):
    """Deployment-only knobs that do not change generation numerics (worker
    lifetime/topology). Kept separate from the runtime profile."""
    env = os.environ if env is None else env

    def _int(var, default, allowed):
        raw = (env.get(var) or "").strip()
        if not raw:
            return default
        try:
            value = int(raw)
        except ValueError:
            raise ProfileError(f"{var}='{raw}' is not an integer") from None
        if value not in allowed:
            raise ProfileError(f"{var}={value} is invalid. Valid values: {', '.join(map(str, allowed))}")
        return value

    snapshot = (env.get("MOSS_SNAPSHOT_MODE") or "off").strip().lower()
    if snapshot not in ("off", "gpu_experimental"):
        raise ProfileError(f"MOSS_SNAPSHOT_MODE='{snapshot}' is invalid. Valid values: off, gpu_experimental")

    return {
        "min_containers": _int("MOSS_MIN_CONTAINERS", 0, (0, 1)),
        "scaledown_seconds": _int("MOSS_SCALEDOWN_SECONDS", 300, (300, 600, 1200)),
        "snapshot_mode": snapshot,
    }
