"""Tests for runpod/moss_workflow.py — graph topology for every preset family."""
import json
from pathlib import Path

import pytest

import moss_config
import moss_workflow
from moss_config import (
    MOSS_PRESETS,
    PresetUnsupportedError,
    RUNTIME_PROFILES,
    resolve_profile,
)
from moss_workflow import (
    COMPILE_NODE_ID,
    KSAMPLER_NODE_ID,
    LORA_NODE_ID,
    SPECTRUM_NODE_ID,
    ADAPTER_NODE_ID,
    SLG_NODE_ID,
    GraphValidationError,
    build_moss_workflow,
    build_warmup_workflow,
    stage_map,
    validate_accelerator_nodes,
    validate_graph,
)

TEMPLATE = json.loads((Path(__file__).resolve().parent / "workflow_template_moss.json").read_text())

ASSETS = {"dit": "dit_test.safetensors", "encoder": "enc_test.safetensors", "vae": "vae_test.safetensors"}


def build(preset_name, *, profile=None, width=1024, height=1024, loras=None, **overrides):
    preset = dict(MOSS_PRESETS[preset_name])
    _preset, steps = moss_config.effective_preset(preset_name, width, height)
    preset["effective_steps"] = steps
    profile = profile or resolve_profile({"MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters"})
    adapter_ref = f"moss/control/{preset['adapter']}.safetensors" if preset["adapter"] else None
    kwargs = dict(
        template=TEMPLATE, preset_name=preset_name, preset=preset, prompt="P", negative="N",
        width=width, height=height, seed=5, loras=loras or [], profile=profile,
        assets=ASSETS, adapter_ref=adapter_ref,
    )
    kwargs.update(overrides)
    return build_moss_workflow(**kwargs)


def model_chain(wf):
    """MODEL link chain, walked upstream from the sampler and returned in
    feed-forward order (links point from consumer to producer)."""
    chain = [KSAMPLER_NODE_ID]
    while True:
        link = wf[chain[0]]["inputs"].get("model")
        if not isinstance(link, list):
            break
        chain.insert(0, link[0])
    return chain


# --- loader selection from profile assets ---------------------------------------


def test_loaders_point_at_profile_assets():
    wf, info = build("Fast")
    assert wf["1"]["inputs"]["unet_name"] == "dit_test.safetensors"
    assert wf["2"]["inputs"]["clip_name"] == "enc_test.safetensors"
    assert wf["2"]["inputs"]["type"] == "moss_image"
    assert wf["3"]["inputs"]["vae_name"] == "vae_test.safetensors"


def test_adapter_required_for_distilled_presets():
    with pytest.raises(ValueError, match="distillation adapter"):
        build("Rapid", adapter_ref=None)


# --- original preset wiring preserved -------------------------------------------


def test_fast_wiring():
    wf, info = build("Fast")
    assert ADAPTER_NODE_ID not in wf                      # no adapter
    assert wf[LORA_NODE_ID]["inputs"]["model"] == ["1", 0]
    assert wf[SLG_NODE_ID]["inputs"]["start_percent"] == 0.0
    assert wf[SLG_NODE_ID]["inputs"]["end_percent"] == 0.5
    assert model_chain(wf) == ["1", LORA_NODE_ID, SLG_NODE_ID, KSAMPLER_NODE_ID]
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == 25
    assert wf[KSAMPLER_NODE_ID]["inputs"]["cfg"] == 2.5
    assert wf[KSAMPLER_NODE_ID]["inputs"]["sampler_name"] == "er_sde"
    assert SPECTRUM_NODE_ID not in wf and COMPILE_NODE_ID not in wf
    assert info["negative_guidance_active"] is True


def test_turbo_wiring_keeps_dmd_adapter_and_drops_slg():
    wf, info = build("Turbo")
    assert wf[ADAPTER_NODE_ID]["class_type"] == "LoraLoaderModelOnly"
    assert wf[ADAPTER_NODE_ID]["inputs"]["lora_name"] == "moss/control/dmd8.safetensors"
    assert wf[ADAPTER_NODE_ID]["inputs"]["strength_model"] == 1.0
    assert SLG_NODE_ID not in wf
    assert model_chain(wf) == ["1", ADAPTER_NODE_ID, LORA_NODE_ID, KSAMPLER_NODE_ID]
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == 8
    assert wf[KSAMPLER_NODE_ID]["inputs"]["cfg"] == 1.0
    assert info["negative_guidance_active"] is False  # CFG 1 → negative inactive


def test_quality_wiring():
    wf, _ = build("Quality")
    assert wf[SLG_NODE_ID]["inputs"]["end_percent"] == 1.0
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == 50


# --- Rapid / Draft3 --------------------------------------------------------------


def test_rapid_wiring_four_steps_no_slg():
    wf, info = build("Rapid")
    assert wf[ADAPTER_NODE_ID]["inputs"]["lora_name"] == "moss/control/rapid4.safetensors"
    assert model_chain(wf) == ["1", ADAPTER_NODE_ID, LORA_NODE_ID, KSAMPLER_NODE_ID]
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == 4
    assert wf[KSAMPLER_NODE_ID]["inputs"]["cfg"] == 1.0
    assert wf[KSAMPLER_NODE_ID]["inputs"]["sampler_name"] == "euler"
    assert SLG_NODE_ID not in wf and SPECTRUM_NODE_ID not in wf


def test_rapid_exact_one_megapixel_graph_is_four_steps():
    """The v1 Rapid recipe: precisely 4 sampler steps at the 1 MP bucket."""
    wf, info = build("Rapid", width=1024, height=1024)
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == 4
    assert wf[KSAMPLER_NODE_ID]["inputs"]["cfg"] == 1.0
    assert wf[KSAMPLER_NODE_ID]["inputs"]["sampler_name"] == "euler"
    assert info["effective_steps"] == 4


@pytest.mark.parametrize("width,height,steps", [(1024, 1040, 6), (1536, 1024, 6),
                                               (2048, 1024, 6), (2048, 2048, 8)])
def test_rapid_hires_workflow_uses_resolved_steps(width, height, steps):
    wf, info = build("Rapid", width=width, height=height)
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == info["effective_steps"] == steps
    assert wf[KSAMPLER_NODE_ID]["inputs"]["cfg"] == 1
    assert wf[ADAPTER_NODE_ID]["inputs"]["lora_name"] == "moss/control/rapid4.safetensors"
    assert wf["9"]["inputs"]["width"] == width
    assert wf["9"]["inputs"]["height"] == height


def test_rapid_beyond_four_megapixels_rejected():
    with pytest.raises(PresetUnsupportedError):
        build("Rapid", width=4096, height=4096)
    with pytest.raises(PresetUnsupportedError):
        build("Rapid", width=2048, height=2064)


def test_draft3_three_steps_and_limit():
    wf, info = build("Draft3")
    assert wf[ADAPTER_NODE_ID]["inputs"]["lora_name"] == "moss/control/draft3.safetensors"
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == 3
    with pytest.raises(PresetUnsupportedError):
        build("Draft3", width=1024, height=1536)


def test_distillation_adapters_are_exclusive_by_construction():
    """Exactly one model-only LoRA adapter node can ever exist in the graph."""
    for preset_name in ("Turbo", "Rapid", "Draft3"):
        wf, _ = build(preset_name)
        adapter_nodes = [n for n in wf.values() if n.get("class_type") == "LoraLoaderModelOnly"]
        assert len(adapter_nodes) == 1, f"{preset_name} must carry exactly one adapter"


# --- Spectrum ---------------------------------------------------------------------


def test_spectrum_insertion_order_fast():
    """DiT → adapter(none) → LoRAs → SLG → Spectrum → KSampler."""
    wf, info = build("FastSpectrum")
    assert SPECTRUM_NODE_ID in wf
    spectrum = wf[SPECTRUM_NODE_ID]
    assert spectrum["class_type"] == moss_workflow.SPECTRUM_NODE_TYPE == "SpectrumMOSSImageManual"
    assert spectrum["inputs"]["warmup_steps"] == 8
    assert spectrum["inputs"]["tail_actual_steps"] == 1
    assert spectrum["inputs"]["cache_device"] == "main_device"
    # ER-SDE documented maximum: one consecutive forecast.
    assert spectrum["inputs"]["max_consecutive_forecasts"] == 1
    assert model_chain(wf) == ["1", LORA_NODE_ID, SLG_NODE_ID, SPECTRUM_NODE_ID, KSAMPLER_NODE_ID]
    assert info["spectrum"] is True
    # SLG range moved to full range per the Spectrum author recommendation.
    assert wf[SLG_NODE_ID]["inputs"]["end_percent"] == 1.0


def test_spectrum_euler_allows_two_consecutive_forecasts():
    wf, _ = build("QualitySpectrum")
    assert wf[SPECTRUM_NODE_ID]["inputs"]["max_consecutive_forecasts"] == 2


def test_spectrum_debug_flag_plumbed():
    wf, _ = build("FastSpectrum", spectrum_debug=True)
    assert wf[SPECTRUM_NODE_ID]["inputs"]["debug"] is True


def test_spectrum_never_on_few_step_presets():
    for preset_name in ("Turbo", "Rapid", "Draft3"):
        wf, info = build(preset_name)
        assert SPECTRUM_NODE_ID not in wf, f"{preset_name} must not carry Spectrum"
        assert info["spectrum"] is False


# --- compilation -------------------------------------------------------------------


def test_compile_node_inserted_with_profile_backend():
    profile = resolve_profile({"MOSS_RUNTIME_PROFILE": "compile-inductor-resident-int8"})
    wf, info = build("Fast", profile=profile)
    assert wf[COMPILE_NODE_ID]["class_type"] == "TorchCompileModel"
    assert wf[COMPILE_NODE_ID]["inputs"]["backend"] == "inductor"
    assert model_chain(wf) == ["1", LORA_NODE_ID, SLG_NODE_ID, COMPILE_NODE_ID, KSAMPLER_NODE_ID]
    assert info["compile_backend"] == "inductor"


def test_compile_off_leaves_graph_untouched():
    wf, info = build("Fast")
    assert COMPILE_NODE_ID not in wf and info["compile_backend"] == "off"


def test_compile_after_spectrum_when_combined():
    profile = resolve_profile({"MOSS_RUNTIME_PROFILE": "resident-highvram-int8-adapters"})
    profile = dict(profile, compile_backend="cudagraphs")
    wf, _ = build("FastSpectrum", profile=profile)
    chain = model_chain(wf)
    assert chain == ["1", LORA_NODE_ID, SLG_NODE_ID, SPECTRUM_NODE_ID, COMPILE_NODE_ID, KSAMPLER_NODE_ID]
    assert wf[COMPILE_NODE_ID]["inputs"]["backend"] == "cudagraphs"


# --- user LoRAs, seeds, prompt, dims -------------------------------------------------


def test_user_lora_population():
    loras = [{"filename": "user/moss/my.safetensors", "strengths": {"positive": 0.7}}]
    wf, _ = build("Fast", loras=loras)
    assert wf[LORA_NODE_ID]["inputs"]["lora_1"] == {
        "on": True, "lora": "user/moss/my.safetensors", "strength": 0.7,
    }


def test_no_loras_disables_slot():
    wf, _ = build("Fast")
    assert wf[LORA_NODE_ID]["inputs"]["lora_1"] == {"on": False, "lora": "", "strength": 1.0}


def test_prompt_negative_dims_seed():
    wf, _ = build("Fast", width=768, height=1536)
    assert wf["7"]["inputs"]["text"] == "P"
    assert wf["8"]["inputs"]["text"] == "N"
    assert wf["9"]["inputs"]["width"] == 768
    assert wf["9"]["inputs"]["height"] == 1536
    assert wf[KSAMPLER_NODE_ID]["inputs"]["seed"] == 5


def test_stage_map_reflects_present_nodes():
    wf, info = build("Fast")
    assert info["node_stage_map"] == {
        "7": "text_encode_positive", "8": "text_encode_negative",
        "10": "sampler", "11": "vae_decode", "12": "save_image",
    }
    wf_fast_spectrum, _ = build("FastSpectrum")
    assert stage_map(wf_fast_spectrum)["10"] == "sampler"


def test_template_not_mutated():
    before = json.dumps(TEMPLATE, sort_keys=True)
    build("FastSpectrum")
    assert json.dumps(TEMPLATE, sort_keys=True) == before


# --- schema validation ----------------------------------------------------------------


def _object_info_with(class_type, inputs):
    return {class_type: {"input": {"required": {name: None for name in inputs}}}}


def test_validate_accelerator_nodes_passes_when_present():
    wf, _ = build("FastSpectrum")
    # Schema mirrors the real v0.8.1 node: every input the graph sets must exist.
    info = _object_info_with("SpectrumMOSSImageManual", wf[SPECTRUM_NODE_ID]["inputs"].keys())
    validate_accelerator_nodes(wf, info)  # no raise


def test_validate_accelerator_nodes_missing_class():
    wf, _ = build("FastSpectrum")
    with pytest.raises(GraphValidationError, match="SpectrumMOSSImageManual"):
        validate_accelerator_nodes(wf, {})


def test_validate_accelerator_nodes_schema_mismatch():
    wf, _ = build("FastSpectrum")
    info = _object_info_with("SpectrumMOSSImageManual", ("model",))
    with pytest.raises(GraphValidationError, match="not in schema"):
        validate_accelerator_nodes(wf, info)


def test_validate_accelerator_nodes_skips_absent_nodes():
    wf, _ = build("Fast")
    validate_accelerator_nodes(wf, {})  # no accelerator nodes → no raise


def test_full_graph_validation_reports_all_problems():
    wf, _ = build("FastSpectrum")
    with pytest.raises(GraphValidationError) as exc:
        moss_workflow.validate_graph(wf, {})
    assert "SpectrumMOSSImageManual" in str(exc.value)


# --- warmup workflow ----------------------------------------------------------------


def test_warmup_workflow_marks_and_warms_adapter():
    profile = resolve_profile({})
    wf = build_warmup_workflow(TEMPLATE, profile=profile, assets=ASSETS,
                               adapter_ref="moss/control/dmd8.safetensors")
    assert wf["12"]["inputs"]["filename_prefix"] == "warmup/warmup"
    assert wf[ADAPTER_NODE_ID]["inputs"]["lora_name"] == "moss/control/dmd8.safetensors"
    assert wf[KSAMPLER_NODE_ID]["inputs"]["steps"] == 4  # cheap but representative


def test_warmup_without_adapter():
    wf = build_warmup_workflow(TEMPLATE, profile=resolve_profile({}), assets=ASSETS)
    assert ADAPTER_NODE_ID not in wf


# --- 2026-10-29 quality modes: SLG layer sets, negative blanking, upsampler ----


def test_poster_slg_layer_set_and_sampler():
    wf, info = build("Poster")
    assert wf["10"]["inputs"]["sampler_name"] == "res_multistep"
    assert wf["10"]["inputs"]["cfg"] == 3.75 and wf["10"]["inputs"]["steps"] == 25
    assert wf["6"]["inputs"]["single_layers"] == "22"
    assert wf["6"]["inputs"]["start_percent"] == 0.0 and wf["6"]["inputs"]["end_percent"] == 1.0
    assert info["sampler"] == "res_multistep"


def test_poster_slg_benchmark_control_uses_layer_set():
    wf, _info = build("PosterSLG22-24")
    assert wf["6"]["inputs"]["single_layers"] == "22,24"
    assert wf["10"]["inputs"]["sampler_name"] == "res_multistep"


def test_base_presets_keep_default_layer_twenty_two():
    wf, _info = build("Fast")
    assert wf["6"]["inputs"]["single_layers"] == "22"


def test_negative_blanket_at_cfg_one():
    """Rapid/Turbo/Draft3 run at CFG 1 where the negative branch contributes
    nothing — the text must be blanked so a long UI negative is never encoded,
    and the info block records the suppression."""
    for name in ("Turbo", "Rapid", "Draft3"):
        wf, info = build(name)
        assert wf["8"]["inputs"]["text"] == "", name
        assert info["negative_suppressed"] is True, name
    wf, info = build("Fast")
    assert wf["8"]["inputs"]["text"] == "N"
    assert info["negative_suppressed"] is False


UPSAMPLER_NODE_ID = "15"


def test_caption_upsampler_inserts_textgenerate():
    from moss_workflow import MOSS_UPSAMPLER_SYSTEM_PROMPT
    wf, info = build("Fast", enhance_prompt=True)
    node = wf[UPSAMPLER_NODE_ID]
    assert node["class_type"] == "TextGenerate"
    assert node["inputs"]["clip"] == ["2", 0]
    assert node["inputs"]["prompt"] == "P"
    assert node["inputs"]["max_length"] == 4096
    assert node["inputs"]["system_prompt"] == MOSS_UPSAMPLER_SYSTEM_PROMPT
    assert "prompt engineer for an image generation model" in node["inputs"]["system_prompt"]
    assert node["inputs"]["sampling_mode"] == "on"
    assert node["inputs"]["sampling_mode.temperature"] == 0.7
    assert node["inputs"]["sampling_mode.top_k"] == 64
    assert node["inputs"]["sampling_mode.seed"] == 5
    # The generated caption replaces the raw prompt at the positive encode.
    assert wf["7"]["inputs"]["text"] == [UPSAMPLER_NODE_ID, 0]
    # The negative encode stays a plain string.
    assert isinstance(wf["8"]["inputs"]["text"], str)
    assert info["prompt_upsampler"] is True


def test_caption_upsampler_off_by_default():
    wf, info = build("Fast")
    assert UPSAMPLER_NODE_ID not in wf
    assert wf["7"]["inputs"]["text"] == "P"
    assert info["prompt_upsampler"] is False


def test_caption_upsampler_available_for_rapid():
    wf, info = build("Rapid", enhance_prompt=True)
    assert wf[UPSAMPLER_NODE_ID]["class_type"] == "TextGenerate"
    assert wf["7"]["inputs"]["text"] == [UPSAMPLER_NODE_ID, 0]
    assert info["prompt_upsampler"] is True


def test_validate_graph_accepts_optional_inputs():
    """object_info schemas split required/optional; a node wiring an optional
    input (TextGenerate.system_prompt) must validate, not trip the required-only
    membership check."""
    object_info = json.loads((Path(__file__).parent / "fixtures/textgenerate-object-info.json").read_text())
    wf, _info = build("Fast", enhance_prompt=True)
    upsampler_only = {UPSAMPLER_NODE_ID: wf[UPSAMPLER_NODE_ID]}
    validate_graph(upsampler_only, object_info)  # must not raise
    # And an unknown name on that node still fails.
    bad = {UPSAMPLER_NODE_ID: {**wf[UPSAMPLER_NODE_ID],
                               "inputs": {**wf[UPSAMPLER_NODE_ID]["inputs"], "not_a_real_input": 1}}}
    with pytest.raises(GraphValidationError, match="not_a_real_input"):
        validate_graph(bad, object_info)


def test_validate_graph_rejects_nested_dynamic_combo_and_missing_children():
    object_info = json.loads((Path(__file__).parent / "fixtures/textgenerate-object-info.json").read_text())
    wf, _ = build("Fast", enhance_prompt=True)
    node = wf[UPSAMPLER_NODE_ID]
    node["inputs"]["sampling_mode"] = {"sampling_mode": "on", "seed": 5}
    with pytest.raises(GraphValidationError, match="must select a DynamicCombo option"):
        validate_graph({UPSAMPLER_NODE_ID: node}, object_info)
    node["inputs"]["sampling_mode"] = "on"
    del node["inputs"]["sampling_mode.seed"]
    with pytest.raises(GraphValidationError, match="sampling_mode.seed.*missing"):
        validate_graph({UPSAMPLER_NODE_ID: node}, object_info)


@pytest.mark.parametrize("prompt", [
    json.dumps({"summary": {"caption": "A fox"}, "items": [],
                "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}),
    json.dumps({"summary": {"caption": "A fox"}, "items": [],
                "bbox_coord_space": "abs", "bbox_format": "xyxy"}),
    '[{"bbox": [0, 0, 10, 10]}]',
])
def test_enhancer_rejects_structured_prompts_without_changing_layout(prompt):
    with pytest.raises(ValueError, match="plain captions only"):
        build("Fast", prompt=prompt, enhance_prompt=True)
    wf, info = build("Fast", prompt=prompt)
    assert wf["7"]["inputs"]["text"] == prompt
    assert info["prompt_upsampler"] is False
