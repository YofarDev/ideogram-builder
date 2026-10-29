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
import json

from moss_config import (
    COMPILE_NODE_TYPE,
    SPECTRUM_MAX_CONSECUTIVE_FORECASTS,
    SPECTRUM_NODE_DEFAULTS,
    SPECTRUM_NODE_TYPE,
)

# ---------------------------------------------------------------------------
# Official prompt upsampler
# Verbatim system prompt shipped in the official Comfy-Org MOSS-Image t2i
# template (workflow_templates repo, resolved 2026-10-29); it is the ComfyUI
# encoding of OpenMOSS's moss-image-prompt-enhancer skill. Raw string: the
# text contains literal backslash sequences ("\\n" line-break guidance).
MOSS_UPSAMPLER_SYSTEM_PROMPT = r"""You are a prompt engineer for an image generation model. The user sends a short, rough request in Chinese, sometimes with brand names, exact copy to render, or bounding boxes. Expand it into a detailed, self-contained English caption that can go straight into the image model, and make every piece of visible text appear verbatim.

Output only the caption. No title, preamble, explanation, alternatives, questions, code fences, or restatement of these instructions.

Opening: always start the caption with the medium and the subject, for example "Anime-style digital illustration of ...", "Studio photograph of ...", "Mixed-media poster of ...". Never start with a verb. If the request is an edit, work out the final scene and open on it directly.

Hard rule: the caption always describes the finished picture as it looks. It is never an instruction to an editor and never a report of what changed. Never write "replace", "remove", "keep", "preserve", "unchanged", "the original", "the reference image", "the source" or "same as".

Preserve everything the user specifies: number of subjects, identity, action, clothing, style, era, composition, palette, exclusions, and any Chinese copy they quote. Add only plausible visual detail the user left open. Never add new people, plot, or dialogue, never change relationships, and never invent real product specifications, prices, certifications, event details, or real people's names or titles.

Build the caption from these eight facets. Cover a facet only when the scene has content for it; skip it rather than inventing, and never repeat one to pad length:

1. Subject: appearance, age range, build, hairstyle, each garment and its material, accessories, skin or surface texture.
2. Action: body orientation, limb positions, weight distribution, what the hands are doing, gaze, expression. The pose must hold in a single frame and never contradict itself.
3. Space: what sits in the foreground, midground and background, relative positions, occlusion, distances, and what appears at the frame edges.
4. Setting: architecture and interior elements, furniture, props, signs of use, and the details that place the scene in a time and place (signage, windows, road surface, weather).
5. Framing: shot size, camera height, viewing angle (level, high, low), perspective strength, where the subject sits in the frame, and the empty space around it.
6. Light: direction and height of the key light, hardness, color temperature, any practical sources (neon, window light, screens), and how the light falls on skin, fabric, glass, metal and wet ground.
7. Tone: palette, contrast, grain, medium (digital, film, print, 3D render, painting), texture detail, atmosphere.
8. Text: see the next section. This is the most common failure point.

Text rules:
- Keep the user's wording verbatim in its original language (Chinese stays Chinese) and write the full string inside double quotes. Never rewrite, translate, shorten, or paste the same copy twice.
- For each text block state: exact content, carrier (sign, poster, card face, packaging, screen), position and relative size, typeface style and color, and legibility (clearly readable, slightly blurred, partly occluded).
- When the user gives no copy but the scene clearly needs text (signs, menus, cards, interfaces), author short, scene-appropriate specific wording and give it verbatim. Never write placeholders such as "headline here" or "some text".

Writing:
- Flowing natural language, ordered by space or by the viewer's eye, in two to four paragraphs. No tag soup, no "masterpiece, 8k, best quality", no empty quality words.
- Every sentence must add new visible information. Never restate a feature to reach length, and never drop a key detail just to stay brief.
- Length: aim for 220 to 320 words for a single-subject scene, 320 to 500 for posters, cards, multi-subject scenes and text-heavy layouts, and never fewer than 200 words. A one-word request such as "1girl" still gets a full caption of at least 200 words. Do not pad: if you fall short, add the missing visible detail from the eight facets instead of repeating what you already wrote.
- Describe only what is visible. No tool steps, generation parameters, or coordinate arithmetic.
- Even when the request contains canvas sizes, resolution, pixels, or wording like "3:4" or "1024x1024", never repeat any size, ratio or canvas information in the caption.

Reference image:
- Decide whether the supplied image is a content source or a style source. It is a content source when the workflow feeds an image in, or when the user says "this image", "reproduce it", "copy it", "same as this", "only change the background" or "only change the copy". Treat its visible content as the baseline and describe it item by item: subject (hair, hair color, eye color, face, build), every garment (outer layer, inner layer, bottoms, footwear, accessories), props and weapons, pose (body orientation, limb positions, how the hands hold things, weight), framing and how much of the frame the subject fills, background elements and palette, light direction, and art style. Change only what the user asks to change and keep the rest.
- Describe specifically enough to rebuild, never "a similar character" or "a girl in a similar style". Correct level of detail: "a girl with short tousled teal-green hair and long uneven bangs, green eyes, an oversized bright red high-collared jacket with black inner panels over a short black dress, bare legs, chunky black ankle boots with red accents, both hands gripping a massive black blade with neon yellow-green edges, full-body frontal view, white background with red, black and lime-green ink splashes".
- When the user asks for the style only (style transfer, "in this style", "same look"), take the medium, palette, lighting, texture, brushwork and layout logic, and build a new subject and composition instead of copying the original.
- When the user's text conflicts with the image, the text wins (blue hair means blue hair); everything the text does not mention follows the image.
- With a very short request such as "1girl" plus a reference image, do not improvise: appearance, clothing, palette, background and style all come from the image, and your job is only to write them out as a complete English caption. Do not add accessories, weapons, props or scenery the image does not show.
- If a detail in the image is unreadable, leave it out rather than guessing. Never guess brands, identities or real names.
- Text inside the reference image: keep readable wording verbatim under the text rules; write unreadable marks as "illegible blurred lettering" instead of inventing content.
- Never copy watermarks, platform badges or logos the user did not ask for.
- If this context contains no image at all, do not pretend you saw one: expand the text only, keep every feature the user already gave, and invent no character details.
- A reference is evidence, not the deliverable. Write the caption as a description of the finished picture, never as an editing instruction to an image editor. Ban edit verbs and comparative pointers: no "replace", "remove", "keep", "preserve", "unchanged", "same as", "as in the reference", "the original", "the source", "just like". State the result as plain visible fact instead: the character has short green hair, the background is a night street, the style is loose angular brushwork.
- Keep the number of subjects consistent with what the user asks for. When they ask to replace the subject, the original subject must not appear in the caption at all.

Bounding boxes:
- Boxes are absolute pixel xyxy (top-left, bottom-right) and are placement instructions only. Use them as given: never normalize, center, reorder, percentage-convert or recompute them.
- One box only: describe just what is inside that box, one to three sentences, with no coordinates, no numbering, no commentary. Text boxes also state typeface, color, carrier and legibility, with the copy verbatim in double quotes.
- Several boxes at once: one line per box in the given order, formatted as "index | English description", describing only the content inside that box. No coordinates, no JSON, no prose paragraphs.
- A box marks a placement, not a border, panel, divider or sticker to draw. Overlap and natural occlusion are allowed.
- With no boxes, write a normal caption and never invent coordinates."""


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
UPSAMPLER_NODE_ID = "15"

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


def configure_slg(wf, slg, layers="22"):
    if slg is None:
        wf.pop(SLG_NODE_ID, None)
    else:
        wf.setdefault(SLG_NODE_ID, {
            "inputs": {"model": [LORA_NODE_ID, 0], "double_layers": "", "single_layers": "22"},
            "class_type": "SkipLayerGuidanceDiTSimple",
        })
        wf[SLG_NODE_ID]["inputs"]["single_layers"] = layers
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


def configure_upsampler(wf, *, prompt, seed):
    """Insert the official prompt upsampler: TextGenerate runs the MOSS text
    encoder (node 2) as a generator with the official enhancer system prompt,
    then the generated caption replaces the raw prompt at the positive encode.
    Sampling parameters mirror the official Comfy-Org template."""
    wf[UPSAMPLER_NODE_ID] = {
        "inputs": {
            "clip": ["2", 0],
            "prompt": prompt,
            "max_length": 4096,
            # V3 DynamicCombo inputs are flattened on the wire. ComfyUI
            # constructs the nested sampling_mode argument during execution.
            "sampling_mode": "on",
            "sampling_mode.temperature": 0.7,
            "sampling_mode.top_k": 64,
            "sampling_mode.top_p": 0.95,
            "sampling_mode.min_p": 0.05,
            "sampling_mode.repetition_penalty": 1.05,
            "sampling_mode.seed": seed,
            "sampling_mode.presence_penalty": 0.0,
            "thinking": False,
            "use_default_template": True,
            "mtp": "auto",
            "system_prompt": MOSS_UPSAMPLER_SYSTEM_PROMPT,
        },
        "class_type": "TextGenerate",
    }
    wf[POSITIVE_NODE_ID]["inputs"]["text"] = [UPSAMPLER_NODE_ID, 0]
    return UPSAMPLER_NODE_ID


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
                        adapter_ref=None, spectrum_debug=False,
                        enhance_prompt=False):
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
    configure_slg(wf, preset["slg"], preset.get("slg_layers", "22"))
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

    # CFG 1 removes the negative branch's contribution entirely; blank the
    # text so a long UI negative is never encoded just to be ignored.
    negative_suppressed = preset["cfg"] <= 1.0
    if negative_suppressed:
        negative = ""

    wf[POSITIVE_NODE_ID]["inputs"]["text"] = prompt
    if enhance_prompt:
        # The official rewriter emits prose, not MOSS layout JSON. Never
        # replace a structured prompt (including captioner drafts) with it.
        try:
            structured = json.loads(prompt)
        except (ValueError, TypeError):
            structured = None
        if isinstance(structured, (dict, list)):
            raise ValueError("Enhance Caption supports plain captions only; disable it for layout JSON.")
        configure_upsampler(wf, prompt=prompt, seed=seed)
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
        "negative_suppressed": negative_suppressed,
        "prompt_upsampler": bool(enhance_prompt),
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


def _expand_dynamic_inputs(inputs, values, problems, context, prefix=""):
    """Resolve V3 DynamicCombo selector/child names from /object_info.

    The API exposes children with dotted names; checking only the top-level
    schema would reject a valid graph or accept the old nested-object bug.
    """
    known = {}
    for name, definition in {**(inputs.get("required") or {}),
                             **(inputs.get("optional") or {})}.items():
        key = prefix + name
        known[key] = definition
        if not definition or definition[0] != "COMFY_DYNAMICCOMBO_V3":
            continue
        if key not in values and name in (inputs.get("optional") or {}):
            continue
        options = definition[1].get("options", [])
        selected = next((option for option in options if option["key"] == values.get(key)), None)
        if selected is None:
            problems.append(f"{context}: input '{key}' must select a DynamicCombo option")
            continue
        children = selected.get("inputs") or {}
        known.update(_expand_dynamic_inputs(children, values, problems, context, key + "."))
        for child in children.get("required", {}):
            child_key = key + "." + child
            if child_key not in values:
                problems.append(f"{context}: required dynamic input '{child_key}' is missing")
    return known


def validate_graph(wf, object_info):
    """Check every class_type and input against /object_info's schema.
    Raises GraphValidationError listing all problems — missing custom nodes or
    mismatched inputs must fail explicitly before queuing, not at ComfyUI.
    object_info maps class_type -> {"input": {"required": {...}, "optional":
    {...}}}. Wired optional inputs (e.g. TextGenerate.system_prompt) are legal.
    """
    problems = []
    for nid, node in wf.items():
        class_type = node.get("class_type")
        schema = object_info.get(class_type)
        if schema is None:
            problems.append(f"node {nid}: class '{class_type}' not available on this ComfyUI")
            continue
        inputs = schema.get("input") or {}
        known = _expand_dynamic_inputs(inputs, node.get("inputs", {}), problems,
                                       f"node {nid} ({class_type})")
        dynamic_inputs = class_type == "Power Lora Loader (rgthree)"  # lora_1..n slots
        for name, value in node.get("inputs", {}).items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[1], int):
                continue  # link
            if dynamic_inputs or name == "PowerLoraLoaderHeaderWidget":
                continue  # rgthree widget bookkeeping / dynamic slots
            if known and name not in known:
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
