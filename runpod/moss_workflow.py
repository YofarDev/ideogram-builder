"""Pure MOSS workflow graph construction.

Builds the API-format ComfyUI graph from runpod/workflow_template_moss.json
without any I/O, GPU or network access: pass the parsed template dict in, get
a new dict back. Handler (runpod/handler.py) owns template loading, seed
resolution, LoRA downloads and asset presence checks; this module owns graph
topology only.

Model path (validated insertion order from the implementation plan):

    DiT loader -> distillation adapter (if any) -> user LoRAs -> SLG (if any)
    -> Spectrum (if any) -> explicit compilation (if validated) -> KSampler
    -> VAE decode -> save

Node IDs stay stable with the template: 1 DiT, 2 CLIP, 3 VAE, 4 distillation
adapter slot, 5 Power Lora Loader, 6 SLG, 7/8 text encode, 9 latent, 10
KSampler, 11 VAE decode, 12 save. New insertions get fresh IDs 13 (Spectrum)
and 14 (TorchCompileModel).
"""

import copy

from moss_config import (
    COMPILE_NODE_TYPE,
    SPECTRUM_MAX_CONSECUTIVE_FORECASTS,
    SPECTRUM_NODE_DEFAULTS,
    SPECTRUM_NODE_TYPE,
)

ADAPTER_NODE_ID = "4"
LORA_NODE_ID = "5"
SLG_NODE_ID = "6"
POSITIVE_NODE_ID = "7"
NEGATIVE_NODE_ID = "8"
LATENT_NODE_ID = "9"
KSAMPLER_NODE_ID = "10"
VAE_DECODE_NODE_ID = "11"
SAVE_NODE_ID = "12"
SPECTRUM_NODE_ID = "13"
COMPILE_NODE_ID = "14"

# Stage names used by comfy_metrics for observed-node interval mapping.
STAGE_BY_NODE = {
    POSITIVE_NODE_ID: "text_encode_positive",
    NEGATIVE_NODE_ID: "text_encode_negative",
    KSAMPLER_NODE_ID: "sampler",
    VAE_DECODE_NODE_ID: "vae_decode",
    SAVE_NODE_ID: "save_image",
}


class GraphValidationError(ValueError):
    """Graph references a node class or input the connected ComfyUI does not
    provide (checked against /object_info at request time)."""


def configure_loaders(wf, profile, assets):
    """Point the DiT/CLIP/VAE loaders at the profile's pinned assets. `assets`
    maps asset key -> workflow_ref filename (from moss_assets)."""
    wf["1"]["inputs"]["unet_name"] = assets["dit"]
    wf["2"]["inputs"]["clip_name"] = assets["encoder"]
    wf["2"]["inputs"]["type"] = "moss_image"
    wf["3"]["inputs"]["vae_name"] = assets["vae"]
    return wf


def configure_adapter(wf, preset, adapter_ref):
    """Configure the single control-adapter slot (node 4). Distillation
    adapters are mutually exclusive by construction: the slot hosts exactly one
    model-only LoRA at strength 1, ahead of user LoRAs."""
    if preset["adapter"]:
        wf[ADAPTER_NODE_ID] = {
            "inputs": {
                "lora_name": adapter_ref,
                "strength_model": 1.0,
                "model": ["1", 0],
            },
            "class_type": "LoraLoaderModelOnly",
        }
        wf[LORA_NODE_ID]["inputs"]["model"] = [ADAPTER_NODE_ID, 0]
    else:
        wf.pop(ADAPTER_NODE_ID, None)
        wf[LORA_NODE_ID]["inputs"]["model"] = ["1", 0]


def configure_sampler(wf, *, seed, steps, cfg, sampler, scheduler):
    ks = wf[KSAMPLER_NODE_ID]["inputs"]
    ks["seed"] = seed
    ks["steps"] = steps
    ks["cfg"] = cfg
    ks["sampler_name"] = sampler
    ks["scheduler"] = scheduler


def configure_slg(wf, slg):
    if slg is None:
        wf.pop(SLG_NODE_ID, None)
    else:
        wf.setdefault(SLG_NODE_ID, {
            "inputs": {"model": [LORA_NODE_ID, 0], "double_layers": "", "single_layers": "22"},
            "class_type": "SkipLayerGuidanceDiTSimple",
        })
        wf[SLG_NODE_ID]["inputs"]["start_percent"] = slg[0]
        wf[SLG_NODE_ID]["inputs"]["end_percent"] = slg[1]


def configure_spectrum(wf, *, sampler, debug=False):
    """Insert the Spectrum Manual node after SLG / user LoRAs, before compile.
    ER-SDE is limited to the documented maximum of one consecutive forecast."""
    inputs = dict(SPECTRUM_NODE_DEFAULTS)
    inputs["max_consecutive_forecasts"] = SPECTRUM_MAX_CONSECUTIVE_FORECASTS.get(sampler, 2)
    inputs["debug"] = bool(debug)
    wf[SPECTRUM_NODE_ID] = {"inputs": inputs, "class_type": SPECTRUM_NODE_TYPE}
    return SPECTRUM_NODE_ID


def configure_compile(wf, backend):
    """Insert TorchCompileModel with the profile's validated backend."""
    wf[COMPILE_NODE_ID] = {
        "inputs": {"model": None, "backend": backend},
        "class_type": COMPILE_NODE_TYPE,
    }
    return COMPILE_NODE_ID


def populate_user_loras(wf, loras):
    """Fill the Power Lora Loader node (same convention as handler)."""
    inputs = wf[LORA_NODE_ID]["inputs"]
    for key in list(inputs.keys()):
        if key.startswith("lora_"):
            del inputs[key]
    for i, lora in enumerate(loras or [], start=1):
        inputs[f"lora_{i}"] = {
            "on": True,
            "lora": lora["filename"],
            "strength": lora.get("strengths", {}).get("positive", 1.0),
        }
    if not loras:
        inputs["lora_1"] = {"on": False, "lora": "", "strength": 1.0}


def build_moss_workflow(template, *, preset_name, preset, prompt, negative,
                        width, height, seed, loras, profile, assets,
                        adapter_ref=None, spectrum_debug=False):
    """Build the complete workflow graph.

    template: parsed workflow_template_moss.json dict (deep-copied internally).
    preset:   moss_config.MOSS_PRESETS entry (already size-policy validated).
    seed:     already-resolved non-negative int (handler owns randomisation).
    profile:  moss_config.resolve_profile() result.
    assets:   {"dit": filename, "encoder": filename, "vae": filename}.
    adapter_ref: workflow_ref of the preset's distillation adapter (required
                 when preset["adapter"] is set; resolution is moss_assets' job).

    Returns (workflow_dict, info_dict). info carries the recipe actually
    executed and the node->stage map for metrics.
    """
    merged = profile.get("merged_adapter")
    if merged and merged != preset["adapter"]:
        raise ValueError("The merged diffusion model only supports its matching preset")
    if preset["adapter"] and not adapter_ref and not merged:
        raise ValueError(
            f"Preset '{preset_name}' needs a distillation adapter but no adapter asset was resolved"
        )

    wf = copy.deepcopy(template)
    configure_loaders(wf, profile, assets)
    configure_adapter(wf, {**preset, "adapter": None} if merged else preset, adapter_ref)
    populate_user_loras(wf, loras)
    configure_slg(wf, preset["slg"])
    configure_sampler(wf, seed=seed, steps=preset.get("effective_steps", preset["steps"]),
                      cfg=preset["cfg"], sampler=preset["sampler"], scheduler=preset["scheduler"])

    # Chain: adapter slot -> loras -> SLG -> Spectrum -> compile -> KSampler.
    # Everything upstream of the sampler converges on wf[LORA_NODE_ID] or the
    # last inserted accelerator node, so rewire the sampler input explicitly.
    head = LORA_NODE_ID
    if preset["slg"] is not None:
        wf[SLG_NODE_ID]["inputs"]["model"] = [head, 0]
        head = SLG_NODE_ID

    spectrum_enabled = bool(preset.get("spectrum"))
    if spectrum_enabled:
        wf[configure_spectrum(wf, sampler=preset["sampler"], debug=spectrum_debug)]["inputs"]["model"] = [head, 0]
        head = SPECTRUM_NODE_ID

    compile_backend = profile.get("compile_backend", "off")
    if compile_backend != "off":
        wf[configure_compile(wf, compile_backend)]["inputs"]["model"] = [head, 0]
        head = COMPILE_NODE_ID

    wf[KSAMPLER_NODE_ID]["inputs"]["model"] = [head, 0]

    wf[POSITIVE_NODE_ID]["inputs"]["text"] = prompt
    wf[NEGATIVE_NODE_ID]["inputs"]["text"] = negative
    wf[LATENT_NODE_ID]["inputs"]["width"] = width
    wf[LATENT_NODE_ID]["inputs"]["height"] = height
    wf[SAVE_NODE_ID]["inputs"]["filename_prefix"] = "moss"

    info = {
        "preset_id": preset_name,
        "preset_label": preset["label"],
        "effective_steps": wf[KSAMPLER_NODE_ID]["inputs"]["steps"],
        "cfg": preset["cfg"],
        "sampler": preset["sampler"],
        "scheduler": preset["scheduler"],
        "negative_guidance_active": preset["cfg"] > 1.0,
        "adapter": preset["adapter"],
        "adapter_ref": adapter_ref,
        "spectrum": spectrum_enabled,
        "compile_backend": compile_backend,
        "dit": assets["dit"],
        "encoder": assets["encoder"],
        "vae": assets["vae"],
        "node_stage_map": stage_map(wf),
    }
    return wf, info


def stage_map(wf):
    """Node-id -> metrics stage for the nodes actually present in the graph.
    Cached nodes are excluded from measured cost by comfy_metrics, never
    assumed zero."""
    return {nid: stage for nid, stage in STAGE_BY_NODE.items() if nid in wf}


def validate_accelerator_nodes(wf, object_info):
    """Request-time check for the optional accelerator nodes only (Spectrum,
    TorchCompileModel). Core template nodes are assumed present — the graph is
    validated by ComfyUI on queue; here we only guard the custom-node classes
    whose absence would otherwise surface as a confusing mid-run error."""
    required_classes = {
        SPECTRUM_NODE_ID: SPECTRUM_NODE_TYPE,
        COMPILE_NODE_ID: COMPILE_NODE_TYPE,
    }
    problems = []
    for nid, class_type in required_classes.items():
        if nid not in wf:
            continue  # not enabled for this request
        schema = object_info.get(class_type)
        if schema is None:
            problems.append(
                f"node {nid}: class '{class_type}' is not available on this ComfyUI — "
                f"the node package is missing or failed to load"
            )
            continue
        required = (schema.get("input") or {}).get("required") or {}
        for name, value in wf[nid].get("inputs", {}).items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[1], int):
                continue
            if required and name not in required:
                problems.append(f"node {nid} ({class_type}): input '{name}' not in schema")
    if problems:
        raise GraphValidationError(
            "Accelerator node schema mismatch:\n- " + "\n- ".join(problems)
        )


def validate_graph(wf, object_info):
    """Check every class_type and required input against /object_info's schema.
    Raises GraphValidationError listing all problems — missing custom nodes or
    mismatched inputs must fail explicitly before queuing, not at ComfyUI.
    object_info maps class_type -> {"input": {"required": {...}}, ...}.
    """
    problems = []
    for nid, node in wf.items():
        class_type = node.get("class_type")
        schema = object_info.get(class_type)
        if schema is None:
            problems.append(f"node {nid}: class '{class_type}' not available on this ComfyUI")
            continue
        required = (schema.get("input") or {}).get("required") or {}
        dynamic_inputs = class_type == "Power Lora Loader (rgthree)"  # lora_1..n slots
        for name, value in node.get("inputs", {}).items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[1], int):
                continue  # link
            if dynamic_inputs or name == "PowerLoraLoaderHeaderWidget":
                continue  # rgthree widget bookkeeping / dynamic slots
            if required and name not in required:
                problems.append(f"node {nid} ({class_type}): input '{name}' not in schema")
    if problems:
        raise GraphValidationError(
            "Workflow graph does not match the deployed ComfyUI schema:\n- " + "\n- ".join(problems)
        )


def build_warmup_workflow(template, *, profile, assets, adapter_ref=None,
                          width=1024, height=1024, seed=0):
    """Representative warmup graph used by the Modal lifecycle hook. Warms the
    profile's DiT/encoder/VAE, the distillation adapter and the configured
    compile bucket at the canonical 1024x1024 bucket. Output prefix 'warmup'
    lets the caller delete the artifacts afterwards. One warmup does NOT
    initialise every preset — shape/adapter switches still carry first-use cost.
    """
    preset = {
        "label": "warmup", "tier": "warmup", "steps": 4, "cfg": 1.0,
        "sampler": "euler", "scheduler": "simple", "slg": (0.0, 1.0),
        "adapter": "dmd8" if adapter_ref else None, "spectrum": False,
    }
    if adapter_ref:
        wf, _info = build_moss_workflow(
            template, preset_name="warmup", preset=preset, prompt="warmup",
            negative="", width=width, height=height, seed=seed, loras=[],
            profile=profile, assets=assets, adapter_ref=adapter_ref,
        )
    else:
        wf, _info = build_moss_workflow(
            template, preset_name="warmup", preset={**preset, "adapter": None},
            prompt="warmup", negative="", width=width, height=height, seed=seed,
            loras=[], profile=profile, assets=assets,
        )
    wf[SAVE_NODE_ID]["inputs"]["filename_prefix"] = "warmup/warmup"
    return wf
