# MOSS-Image inference: early community guide

Guide date: October 29, 2026. Sources: r/StableDiffusion threads and comments (plus clearly-marked r/comfyui leads), the official OpenMOSS documentation, adapter model cards, and the developer AMA. Everything below is **attributed community reporting, not locally reproduced benchmarks**, unless marked otherwise. Reddit's accessible pages sometimes expose fewer replies than its search index; this is a broad survey, not an exhaustive comment archive.

The raw evidence ledger with per-thread notes and confound analysis is kept alongside: [`2026-10-29-moss-reddit-research-ledger.md`](./2026-10-29-moss-reddit-research-ledger.md). Project-specific deployment research (this repo's Modal/RunPod workflow) is in [`2026-10-27-moss-inference-optimization.md`](./2026-10-27-moss-inference-optimization.md).

**Summary judgment.** MOSS's early strength is its range: unusual compositions, varied people, and strong responses to detailed prompts. Its recurring weaknesses are blur, inconsistent anatomy, and large changes between seeds. Most useful advice is about controlling that range — and making sure the workflow is actually compatible before blaming the model.

## 1. The checkpoint family

| Checkpoint | Useful starting point for | Reported tradeoff |
|---|---|---|
| **MOSS-Image-Base** | Natural photography, unusual subjects, exploration | More variability and occasional failures |
| **MOSS-Image-SFT** | General generation, a more finished aesthetic | Some users find its look more constrained |
| **Kromoss** | Alternative aesthetic; used in DMD/DMD2-accelerated comparisons | Depends on exact checkpoint + adapter versions |
| **Serenity** (v1–v6) | Face-focused improvement on Base | Author-stated identity bleed between similar people; primarily faces, not fingers; v6 still unfinished ([release](https://www.reddit.com/r/StableDiffusion/comments/1x9vp27/moss_serenity_finetune/), [v6](https://www.reddit.com/r/StableDiffusion/comments/1xgo9hf/moss_serenity_v6_210k_steps_now/), [repo](https://huggingface.co/malcolmrey/moss-serenity)) |
| **Solordz Moss Base** | Gallery workflows with topic adapters | Own regime: 24 steps, CFG 2–3, `er_sde`/`beta`, no upscaling ([release](https://www.reddit.com/r/StableDiffusion/comments/1xahyca/solordz_moss_base_versions/)) |
| **Jib Mix MOSS** | Single female subjects, photo style | 8-step adapter already merged — do not stack another Turbo by default; criticized for face homogenization ([release](https://www.reddit.com/r/StableDiffusion/comments/1xdgxmy/jib_mix_moss_realistic_out_now_free/)) |

The [developer AMA](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/hey_guys_im_one_of_the_core_developers_of/) gives the nuanced answer on Base vs SFT: SFT generally recommended for everyday use; Base can look more photorealistic; the developer personally prefers Base. Compare both on your own prompts before committing.

Beware confounded comparisons: the [realistic-people thread](https://www.reddit.com/r/StableDiffusion/comments/1xdiqgo/make_mossimage_sft_looking_like_normal_people/) compares stock SFT **with a Turbo LoRA** against a Kromoss setup — that cannot isolate what SFT alone changes. The same thread yields a concrete blend lead: Base + Kijai's extracted SFT adapter at **0.2**.

Launch-day provenance matters: [official Comfy-Org weights](https://www.reddit.com/r/StableDiffusion/comments/1x7m25o/official_comfyorg_mossimage_weights_are_now/) replaced early unofficial INT8 conversions; benchmarks using early conversions should carry that provenance.

## 2. Setup: native ComfyUI, files, and frontends

Start with an updated ComfyUI and the complete native MOSS template. Published components ([Comfy-Org model page](https://huggingface.co/Comfy-Org/MOSS-Image), [official repo](https://github.com/OpenMOSS/MOSS-Image)):

| Component | Options |
|---|---|
| Diffusion model | Base or SFT; BF16 or INT8 ConvRot |
| Text encoder | Qwen3.5-9B: BF16, INT8 ConvRot, or W4A8 GPTQ |
| VAE | `flux2-vae_small.safetensors` (original release default) or full FLUX.2 VAE |
| Workflows | Separate text-to-image and layout examples |

Setup findings with the clearest evidence:

- **Plugin and native workflows are not interchangeable.** The developer explicitly warned that combining the plugin workflow with native checkpoint loading can produce incorrect output. The [OpenMOSS integration guide](https://github.com/OpenMOSS/MOSS-Image/blob/main/comfyui/README.md) warns plugin and native timestep conventions differ.
- **The small VAE is deliberate.** The developer says the original release uses the smaller decoder to reduce certain artifacts and spots ([AMA](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/hey_guys_im_one_of_the_core_developers_of/)). The full FLUX.2 VAE appears in community 4 MP recipes anyway ([example](https://www.reddit.com/r/StableDiffusion/comments/1x8apux/mossing_around_in_4k/)).
- **Verify the running version.** A missing `moss_image` loader option was fixed by updating + restarting + refreshing; a portable install stuck on 0.32.0 succeeded after installing 0.42.1 ([thread](https://www.reddit.com/r/StableDiffusion/comments/1x8mnbe/load_clip_has_no_moss_image_on_comfyui/)). ComfyUI **0.42.1** fixed MOSS template crashes; **0.43.0** added MOSS RoPE scaling, color-depth control, edit-LoRA support and lower peak memory ([discussion](https://www.reddit.com/r/StableDiffusion/comments/1xh0m0c/comfyui_v0430_released/), [release](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.43.0)). Old failure reports may describe since-fixed software.
- **Don't confuse the two Qwens.** A Qwen3-VL-4B prompt-rewriting model is not the Qwen3.5-9B text encoder; enhancement is optional ([thread](https://www.reddit.com/r/StableDiffusion/comments/1x9pfhz/which_one_is_the_official_mossimage_text_encoder/)).

Alternative frontends (author-reported, not independently validated): [Forge Neo extension](https://www.reddit.com/r/StableDiffusion/comments/1x8jeo3/mossimage_extension_for_forge_neo/) ([repo](https://github.com/eduardoabreu81/moss-image-forge-neo)) with Base/SFT, layout, img2img, 8-step support — author notes detail/lettering still better at 50 steps; [MOSS Image Studio](https://www.reddit.com/r/StableDiffusion/comments/1xdw30e/i_hate_comfyuis_interface_so_i_vibecoded_a/), a browser UI over Comfy with experimental img2img.

## 3. Baseline recipes and resolution

Official Base reference ([USERGUIDE](https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md)): **50 steps, CFG 3 (suggested range 3–6; long prompts may need less), shift 5, Euler, 1–2 MP, dimensions in multiples of 16, unconditioned-branch skip layer 22.** Standard SLG and uncond-branch skipping are distinct options — preserve the template's intended configuration.

A verified official example file exists: [Elden Ring parameters.json](https://github.com/OpenMOSS/MOSS-Image/blob/main/assets/images/011/parameters.json) — Base, Euler, 50 steps, CFG 3, shift 5, seed 42, 1680×944, uncond skip 26, separate `slg_scale 0`, `max_sequence_length 4096`, plus a detailed centered-yxyx layout with explicit text items. Stronger reproducibility material than reconstructing prompts from showcase thumbnails. Do not confuse negative-branch layer skipping with the separately disabled SLG fields.

Community no-adapter showcases: [photographic Base at CFG 4, mostly 39 steps, `sa_solver`/`sa_solver_pece`, `sgm_uniform`, shift 5, SLG off, 1.33–2 MP, ~2.5–4 min on RTX 3060](https://www.reddit.com/r/StableDiffusion/comments/1xd9o13/moss_image_showcase_mostly_photoreal_some_art/); [random Base at 50 steps, CFG 3, 1.5 MP](https://www.reddit.com/r/StableDiffusion/comments/1xcpm1i/random_moss_image_5b_base_gens_no_lora_no_finetune/); a suggested [troubleshooting baseline: 50 steps, CFG ~3, denoise 1, SLG single layer 22 over 0–1](https://www.reddit.com/r/StableDiffusion/comments/1x8nzbw/why_am_i_getting_this_result_with_moss_base_ive/).

Resolution guidance:

| Dimensions | Approximate pixels |
|---|---:|
| 1024 × 1024 | 1.05 MP |
| 1024 × 1536 | 1.57 MP |
| 1152 × 1728 | 1.99 MP |
| 1408 × 1408 | 1.98 MP |

- Several users report better stability/detail at **1.5 MP+** than ~1 MP, particularly with Turbo; others report Turbo losing detail regardless ([early comparison](https://www.reddit.com/r/StableDiffusion/comments/1x85fx8/t2i_moss_vs_flux3_klein_vs_krea2/)).
- Suggested progression: 1 MP for diagnosis, 1.5–2 MP once composition works. **2 MP ≠ 2048×2048** (that's 4.19 MP). A "4K" showcase was actually [4 MP](https://www.reddit.com/r/StableDiffusion/comments/1x8apux/mossing_around_in_4k/) — keep the correction attached to any quoted benchmark (that one: SFT INT8, INT8 encoder, full FLUX.2 VAE, 50 steps, CFG 3, Euler, ~55 s, 19.5 GB peak on a 5090).
- Extreme direct generation is experimental: reports up to 5–5.5 MP working ([3080, ~90 s, INT8](https://www.reddit.com/r/StableDiffusion/comments/1xbay08/having_a_blast_with_moss/)), claims of 12 MP success and 16 MP collapse with SFT+DMD — none extends the recommended 1–2 MP baseline.

## 4. Few-step (Turbo/DMD) acceleration

**Rule: use the adapter card's exact instructions; repository names alone don't identify the recipe.**

Key adapters and their current documented settings:

- **Lodestones Base 8-step DMD** ([card](https://huggingface.co/lodestones/MOSS-Image-Base-8-steps-dmd)): stock Base, `lora.safetensors` at strength **1**, Euler, **shift 5, CFG 1, 4–8 steps**. The repo's separate data-space implementation has extra precision requirements and is deprecated — don't mix launch-day data-space posts with the current ordinary-LoRA route. Historical strength debate for one revision: [0.6–0.8 recommended](https://www.reddit.com/r/StableDiffusion/comments/1x8254a/comment/ph98pi6/) vs [OP preferring 0.95](https://www.reddit.com/r/StableDiffusion/comments/1x8254a/comment/phabstw/) — keep filenames attached.
- **SFT 4-step v2** ([announcement](https://www.reddit.com/r/StableDiffusion/comments/1x98fsn/mossimagesft4steps_v2_is_out/)): switched from data-space DMD to Euler-native DMD. Launch-day data-space instructions and later ordinary-Euler instructions describe **different versions**. Current card guidance ([card](https://huggingface.co/akhaliq/MOSS-Image-SFT-4-steps)): strength 1, SFT, Euler/simple, exactly 3 steps, CFG 1 for the distinct 3-step draft file (`lora_3step.safetensors`); the card's own two-step section contradicts its Quickstart — don't copy the stale two-step instruction.
- **DMD2 releases**: [Base DMD2](https://www.reddit.com/r/StableDiffusion/comments/1xarnzg/mossimage_base_new_dmd2_lora_8_steps/) criticized for full-frame softness/bokeh; [SFT's own DMD2](https://www.reddit.com/r/StableDiffusion/comments/1xb5fqe/mossimage_sft_new_dmd2_lora_for_sft_8_steps/) reported sharper with less bokeh but weaker preservation of a requested 1980s film texture — checkpoint and adapter change together, so attribute differences to the **pair**.
- A named "three-step" showcase actually sampled at [6–8 steps](https://www.reddit.com/r/StableDiffusion/comments/1xg29si/moss_image_variety_of_tests/) — named step count ≠ tested step count.
- Other leads without verified cards: Coffmeteor Turbo (15 steps/CFG 3/Euler/`sgm_uniform` mentioned in [tips](https://www.reddit.com/r/StableDiffusion/comments/1xe1nmu/a_few_tips_for_moss/)); already-distilled merges (Jib Mix) where adding another Turbo is wrong.

Community experiments **after** reproducing the intended setup (from the [tips thread](https://www.reddit.com/r/StableDiffusion/comments/1xe1nmu/a_few_tips_for_moss/)): strength toward 0.7; CFG toward 1.5–1.7; alternate samplers. With CFG 1 the negative branch contributes nothing — a long negative prompt is not an adjustment in that configuration.

Steps can also just be reduced without Turbo: [27 s @ 50 → 16 s @ 30 → 11 s @ 20 steps](https://www.reddit.com/r/StableDiffusion/comments/1x9huio/faster_moss_gens_for_iterating_30s10s/) on a 4090, with limited perceived quality change — a prompt-drafting strategy, not a convergence guarantee. Early launch-day suggestions of 12–16 steps with first-gen Turbo adapters ([thread](https://www.reddit.com/r/StableDiffusion/comments/1x7d340/mossimage_int8_comfyui/)) lack complete setups.

Multi-LoRA realism recipe (version-dependent, reproduce from source before modifying): [Solordz Base INT8 v10 + two Lodestones Base Turbo versions at 1 and 0.5 + smartphone-style LoRA at 0.5, 12 steps, Euler/simple, 1.5 MP](https://www.reddit.com/r/StableDiffusion/comments/1xf5i17/moss_turbo_without_the_blur_for_realism/). The Smartphone Snapshot series is Base-targeted ([v14 announcement](https://www.reddit.com/r/StableDiffusion/comments/1xalo3h/mossimagebase_lora_release_smartphone_snapshot/)).

## 5. Other speed routes

- **Spectrum** ([repo](https://github.com/Rkkss/ComfyUI-Spectrum-MOSS), [thread](https://www.reddit.com/r/StableDiffusion/comments/1xaby5q/moss_image_speed_boost_with_spectrum_moss_node/)): adaptive forecasting, experimental. First-hand report: SFT INT8, 50 steps, CFG 3, no Turbo, SLG bypassed, RTX 5070 12 GB — 29.3→12.7 s at 1024², 81→34.4 s at 1536², similar detail with some lighting/shading change. Others report no gain or unsatisfactory results. Repo recommends limiting consecutive forecasts with `er_sde`; partial SLG ranges reduce forecasting opportunities. Test **without Turbo first**.
- **Hybrid MOSS+Flux**: [34 MOSS steps + 1 Flux step at 1024², CFG 8, ~20 s on a 5060 Ti 16 GB](https://www.reddit.com/r/StableDiffusion/comments/1xcwlz7/moss_1024x1024_34_steps_moss_5b_1_step_flux_2_9b/) for dense scenes — a hybrid result, not a verified counting benchmark; workflow graph not fully inspected.
- **Compile/batching**: no controlled MOSS inference compile or batch benchmark surfaced; training batch speeds must not populate an inference-speed table. Aimdo compile errors with dynamic VRAM remain an unresolved lead ([v1 report](https://www.reddit.com/r/StableDiffusion/comments/1x98fsn/mossimagesft4steps_v2_is_out/)).

## 6. Precision and quantization

Treat **diffusion precision** and **encoder precision** as two independent variables.

- INT8 vs BF16 is configuration-dependent. A [7800 XT owner](https://www.reddit.com/r/StableDiffusion/comments/1x96c4z/comment/phjl11t/) found INT8 slower than BF16 (later clarified: custom kernel + dynamic VRAM, not stock ComfyUI); a 9070 XT user reported BF16 only 15% slower at 2 MP; others see small quality differences or prefer BF16 texture. File size does not guarantee VRAM fit — runtime allocations matter ([model-size thread](https://www.reddit.com/r/StableDiffusion/comments/1x96c4z/which_moss_image_should_i_get_the_5gb_or_9gb_one/)).
- The [plastic-skin thread](https://www.reddit.com/r/StableDiffusion/comments/1xbjdrh/help_i_only_get_plastic_skin_with_moss/) is often cited for precision, but the OP changed checkpoint family, precision, resolution and CFG together — not a quantization A/B. Keep it as "precision is a controlled experiment worth running," not proof INT8 causes plastic skin.
- Independent positive anecdotes (no matched multi-seed tests): BF16 text encoding reported to help hands and typography; [SFT BF16 + BF16 encoder, `er_sde`/simple, 25 steps, CFG 4](https://www.reddit.com/r/StableDiffusion/comments/1x9qdcb/struggling_with_moss/) preferred by one user who still saw some plastic skin and warns prompt enhancement alters developed prompts.
- GGUF: `Unexpected architecture type: 'moss_image'` traces to the custom loader's architecture support, not ComfyUI core ([thread](https://www.reddit.com/r/StableDiffusion/comments/1x9bzfn/unexpected_architecture_type_in_gguf_file_moss/)). One loader exposed FP16 compute dtype with a [~3× speedup report on RTX 2070 Super](https://www.reddit.com/r/StableDiffusion/comments/1x839d0/comfyuimossgguf_already_supports_fp16_it_was_just/) — quantized storage and execution dtype are separate concerns; specific loader anecdote only.
- Rapid-moss branch warning (DeBand maintainer): fused Comfy-Org weights in that branch can silently produce noise/black images; split-QKV weights required there. Not a general native-LoRA requirement.

## 7. Prompting

**Describe concrete, visible information**: subject and defining appearance; action and body orientation; camera position and framing; relationships between people and objects; background and lighting; medium and focus. Users reporting [excessive seed variation](https://www.reddit.com/r/StableDiffusion/comments/1x91z0p/moss_variation_is_crazy/) were advised to replace ambiguous mood language with specific visual instructions.

Starter prompt shape:

```text
Documentary photography inside a bicycle repair shop.
An adult mechanic in a dark green work shirt stands beside a
red bicycle mounted on a repair stand. Both hands hold one
wheel at waist height. Eye-level medium-wide view.
Tools hang on the wall behind the mechanic, with spare tires
stacked beside the doorway. Daylight enters from the left.
Neutral colors, clear focus across the mechanic and workbench.
```

Direct developer answers (AMA permalinks):
- [Anime tagging](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/phackbe/): no underscores; character name + series; world knowledge was supplied to the captioner for character identification.
- [Prompt structure](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/ph949nr/): varied structures were intentional; no single best order. Don't teach a required syntax.
- [Captioning](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/ph92nv6/): the published caption pipeline is linked for adaptation/training.

Style wording:
- **Realism vs polish**: snapshot contexts (phone, GoPro, old digicam, direct flash, decade-specific photography) work well; drop "masterpiece/8k" polish for ordinary scenes ([thread](https://www.reddit.com/r/StableDiffusion/comments/1x8e3dd/moss_prompting_tips/)). But those cues pull toward softness — "amateur" and shallow-focus language has stronger effects than expected ([blur discussion](https://www.reddit.com/r/StableDiffusion/comments/1xbtjiy/has_anyone_overcome_mosss_love_of_cartoons_and/)). Deliberate grain/blur and all-sharp targets conflict; don't combine the amateur template with anti-blur advice blindly.
- **"RAW photography, candid" vs "photograph"**: [popular tip](https://www.reddit.com/r/StableDiffusion/comments/1xbjdz4/simple_moss_t2i_advice_against_blur/) with improved lighting/clarity reports, but a [direct counterexample](https://www.reddit.com/r/StableDiffusion/comments/1xcklp4/combating_moss_image_blur_by_sharpening_latents/) says composition changed without fixing blur. A/B it across seeds.
- **Capture medium is a style control**: era-specific film openings, GoPro framing etc. from [first-hand reports](https://www.reddit.com/r/StableDiffusion/comments/1x8e3dd/moss_prompting_tips/). The long LLM rewriting template circulating there targets multiple recent models, not MOSS specifically.
- **Mixed media works per-region**: an [anime foreground + photographic background demo](https://www.reddit.com/r/StableDiffusion/comments/1x8wm25/first_time_using_comfyui_tried_moss/) (SFT BF16, 2560×1440) — assign media explicitly to foreground/background rather than one global style label.
- **Prompt rewriting is separate from conditioning**: the [upsampler thread](https://www.reddit.com/r/StableDiffusion/comments/1x9s4ey/uncensored_prompt_upsampler_for_moss_image/) distinguishes text generation from diffusion conditioning; users report unwanted extra content from rewriting; and it's unnecessary when rewriting is disabled. Keep original and generated prompts visible during A/B tests. Do not treat a prompt-rewriting model (e.g. Heretic) as an encoder replacement — [Heretic's creator advises against that use](https://www.reddit.com/r/StableDiffusion/comments/1x9qdcb/struggling_with_moss/).
- **Known prompt-side failures** (from the [35-prompt test](https://www.reddit.com/r/StableDiffusion/comments/1x7kc3o/mossimage_5b_apache_20_on_a_12_gb_rtx_3060_int8/)): negation ("no X") and exact clock times; Turbo drift on lighting and fine constraints. An imperative prompt phrased at a language model produced confusion in [Kroma vs MOSS](https://www.reddit.com/r/StableDiffusion/comments/1x9g86d/kroma_vs_moss_is_it_just_me/) — write visible content, not instructions.
- **Imperfect grips**: describing a flawed grip can worsen hands ([realistic-people thread](https://www.reddit.com/r/StableDiffusion/comments/1xdiqgo/make_mossimage_sft_looking_like_normal_people/)).
- **Framing conflicts**: horizontal full-body poses forced into tall canvases fail; widen the canvas, state near/far perspective, drop descriptions of occluded/out-of-frame items ([framing thread](https://www.reddit.com/r/StableDiffusion/comments/1x9qdcb/comment/phnoyhm/)).
- A compact regression prompt for counting/binding/typography: the [six named cats, ordered pairs, Courier paper labels test](https://www.reddit.com/r/StableDiffusion/comments/1x8xjhy/next_post_about_moss_image/).

Negative prompts: no universal win. Putting "blurry" in the negative made portrait skin more airbrushed/generic in one showcase; the author prefers focus/background-focus wording instead. Evaluate face texture and background focus separately ([showcase](https://www.reddit.com/r/StableDiffusion/comments/1xd9o13/moss_image_showcase_mostly_photoreal_some_art/)).

## 8. Layout and typography

Official format ([USERGUIDE](https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md)): `summary`, `items`, bounding boxes; **center-origin absolute pixels, ordered `[y_min, x_min, y_max, y_max]`** (centered yxyx) — not normalized 0–1000. Match generation dimensions to the layout; state desired text and line breaks explicitly.

- **Draft vs compiled prompts are different artifacts.** The [Prompt Enhancer node](https://www.reddit.com/r/StableDiffusion/comments/1x9eis6/comfyuimosspromptenhancer/) ([repo](https://github.com/xb1n0ry/ComfyUI-MOSS-Prompt-Enhancer)) drafts layout JSON with an LLM (local GGUF in that release), then validates/compiles with the official compiler. Drafts can use top-left absolute xyxy; compiled output uses centered yxyx — connect RESPONSE (not DRAFT_JSON) to text encoding, and keep canvas dimensions aligned. Schema validation ≠ image quality. GGUF-only in that release; a llama-server anecdote is a user's own integration.
- **Editors**: [moss-layout-studio](https://huggingface.co/spaces/Curry-Sawce/moss-layout-studio) (standalone Gradio app, not a Comfy node; exports JSON without generating) from the [layout-editor thread](https://www.reddit.com/r/StableDiffusion/comments/1xcnhoq/a_visual_layout_editor_workflow_for_mossimage/); single-file HTML [MOSS-BBox-Editor](https://github.com/RunningOverGlowies/MOSS-BBox-Editor) from a [meme-thread rescue](https://www.reddit.com/r/StableDiffusion/comments/1xf3zz1/not_quite_what_i_was_looking_for/); [ComfyUI-MOSS-BBox1000](https://github.com/b4ldur/ComfyUI-MOSS-BBox1000) converts a 0–1000 grid to native coordinates across aspect ratios. A Flux3-labeled editor feeding MOSS Layout Prompt is a compatibility lead, not verified interchange.
- **Reference-to-layout extraction**: [ComfyUI-MOSS-QwenVL-Layout](https://github.com/leroy989/ComfyUI-MOSS-QwenVL-Layout) detects objects/text and builds layout JSON; added-object boxes may need manual correction ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xgypjz/question_regarding_moss_image_and_pose_control/)). The [Auto BBox Prompter](https://www.reddit.com/r/StableDiffusion/comments/1xghqx5/auto_bbox_prompter_for_moss_using_qwenvl_or_any/) sends extracted text/layout only — the reference image is not sent to MOSS.
- **Hidden template text**: check the final assembled conditioning and expanded subgraphs for leftover example prompts before blaming layout control ([source](https://www.reddit.com/r/StableDiffusion/comments/1xf3zz1/not_quite_what_i_was_looking_for/)).
- **Typography evidence**: good text reported with [res_2s/simple, 2048×1152, CFG 3.5–4, 25 steps](https://www.reddit.com/r/StableDiffusion/comments/1x80yc2/comment/ph948df/); arched/spherical text tests at [SFT INT8 + DMD, 8 steps, CFG 3.5](https://www.reddit.com/r/StableDiffusion/comments/1x80yc2/comment/ph9e3oq/); BF16 text encoding reported to help hands/text. Proposed (not demonstrated) extensions: named fonts, small caps.
- **Empty regions for labels**: describe a matte surface/gradient wall + global negative-space language; low-denoise cleanup is still model generation — deterministic compositing is a separate evaluation ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xdmtsn/mossimage_has_anyone_gotten_reliable_empty/)).

## 9. Editing and image conditioning

Editing matured quickly; keep versions attached.

- **MOSS-Image-Edit-HQ** ([card](https://huggingface.co/akhaliq/MOSS-Image-Edit-HQ)): now recommends **armV5 over experimental armV6** (regressions in v6; one install step still names v6 — documented inconsistency). Native ai-toolkit-format weights → `models/loras` + `Text Encode MOSS-Image Edit` with `edit_format=ai-toolkit`; converted plugin-format files → `models/model_patches` + matching plugin workflow. Native examples: 50 steps, CFG 3, Euler, SLG layer 22; separate 8-step speed recipe exists.
- **Native edit node** ([update](https://www.reddit.com/r/StableDiffusion/comments/1xem0d0/update_comfyuimossimageeditnative_now_supports/)): 300+ author-run edits; replaces strength-0.25 workflows with **SFT, strength 1, layer-22 guidance, CFG 5 (chinoll format) / 3 (HQ)**; matching `edit_format` matters; references processed at ~1 MP, output follows image 1's shape. A `rope_axes_dim` AttributeError was a master-only dependency, patched for 0.42+ and confirmed fixed. Reports of poor pose/identity preservation and dominant references persist.
- **Edit-HQ v3** had confusing workflow links, Load Model Patch errors, poor multi-photo combos ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xdwo6o/mossimageedithq_v3_is_out/)) — historical.
- **Two conditioning methods compared** ([first-hand](https://www.reddit.com/r/StableDiffusion/comments/1xc2dxn/comparing_both_moss_image_edit_methods/)): simple reference injection vs ai-toolkit edit conditioning, each with its own rank-16 adapter trained 6000 steps on the same dataset. Without adapters, inputs blend/overlay rather than edit. ~15 s vs ~45 s reported (hardware/resolution unstated). Keep reference mechanism, adapter, and conditioning format matched.
- **Edits can change unrequested regions**: hat recolor reported in [MOSS vs Fibo](https://www.reddit.com/r/StableDiffusion/comments/1xg526w/moss_image_edit_vs_fibo20edit/); 8-step editing stacks but quality criticized ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xfedig/moss_image_edit_works_with_8_step_lora/)).
- **Vision Text Encode** ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xbjxcr/mossimage_vision_text_encode_comfyui_node_workflow/), [repo](https://github.com/ThetaCursed/ComfyUI-MOSSImageTextEncoder)): passes image embeddings through Qwen's vision tower into text conditioning — adds preprocessing, not sampling compute. Reports describe from-scratch generation guided by pose/lighting/scene (one example with an empty text prompt); too much of the source scene can transfer. A style/composition reference experiment, not identity transfer. More reference tokens improved similarity but not precise editing ([follow-up](https://www.reddit.com/r/StableDiffusion/comments/1xb2h1k/mossimage_accepts_image_inputs/)).
- **MOSS→editor upscale**: using a finished MOSS image as edit input to a higher-res editor (e.g. F3K) is a general idea without a supplied workflow; replies to one such experiment report changed expressions and smeared detail ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xa6rbd/dont_sleep_on_the_moss_t2i_f3k_edit_upscale/)).
- **Inpainting** (r/comfyui, supplemental): describe target content rather than edit instructions; check crop padding and mask feathering; both successes and no-change failures reported ([thread](https://www.reddit.com/r/comfyui/comments/1xa9cf7/i_find_moss_model_to_be_incredible_at_inpainting/)).
- Developer context: [paired-data preparation is hard for the small team](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/ph93a0m/); early editing was community-built.

## 10. Control and utility adapters

- **Vertical banding / stripes**: two distinct fixes. (1) [SFT layer-reversion DeBand](https://huggingface.co/MATLOWAI/MOSS-Image-SFT-DeBand) — revert SFT layers 37–41 to Base (optionally add 32–36); Quality 25 steps / Balanced 14 / Fast 10; split-QKV weights required in its rapid-moss branch ([source thread](https://www.reddit.com/r/StableDiffusion/comments/1x8jn4o/vertical_banding_in_mossimage_experiments/)). (2) [1.9 MB extracted destripe adapter](https://www.reddit.com/r/StableDiffusion/comments/1x9pf60/fixed_the_vertical_colour_stripes_in_mossimage/) ([repo](https://huggingface.co/nynxz/MOSS-Image)) — LoraLoaderModelOnly, SFT only, no triggers, strength 1 at 768 px / 1.5 at 1024 px; author's 12-image held-out metric. Larger outputs may show wider patterns instead of elimination.
- **Color/depth control**: [adapter card](https://huggingface.co/darask0/MOSS-Image-color-depth-control) — flat-color region IDs + depth (near=white), preferably with regional prompts; stop both controls halfway through denoising for synthetic mannequins; fine face/finger detail remains model-generated; validated on a handful of scenes/two seeds. A concrete supported route — not generic OpenPose compatibility (ComfyUI 0.43.0 shipped RoPE scaling and color-depth support natively).
- **Sharpness/blur sliders — opposite polarities, keep authors attached**: [blur/anti-blur slider](https://www.reddit.com/r/StableDiffusion/comments/1xg4kft/blur_antiblur_slider_lora_for_moss/) (negative = clarify background; effectively depth-of-field control, pose can change) vs [aoleg's sharpness slider](https://www.reddit.com/r/StableDiffusion/comments/1xg55p3/moss_sharpness_lora_blur_what_blur/) (positive 1 sharpens; untested with SFT+Turbo).
- **Detail LoRAs**: [RAW Upscale MOSS detailer](https://www.reddit.com/r/StableDiffusion/comments/1xbzfa1/moss_detailer_lora_built_with_lora_dataset_studio/) — controlled baseline (SFT BF16, 4-step-v2 @ 1, 6 steps, CFG 1, Euler/simple): strength ~1 restrained, 3.5 changes composition/color/subject, 0.7 adds detail with content preserved; high strengths look overcooked. T2I texture comparisons, not an upscale procedure.
- **Hires**: [MAX ULTRA hires LoHa](https://huggingface.co/comfyanonymous/MOSS_image_MAX_ULTRA_hires_lora_test) ([announcement](https://www.reddit.com/r/StableDiffusion/comments/1xdcmku/lora_moss_image_max_ultra_hires_by_comfyui_team/)) — **Base-specific**, for ≥4 MP generation, trained ~3.5–10 MP mixed anime/photo. Did not solve one ghost-people case; SFT compatibility unanswered.
- **Transparent output**: [Alpha LoRA](https://huggingface.co/paralaif/MOSS-Image-Alpha-LoRA) (research-only) — SFT, alpha LoRA 1.0 (0.8 ok; 0.6 → translucent subjects), prompt ends `isolated on a transparent background`, requires supplied 4-channel RGBA VAE loader; known halos/translucent dark clothing; picks best of 3 seeds. [Manga alpha variant](https://huggingface.co/paralaif/MOSS-Manga-Alpha-Image-LoRA) (Apache-2.0) — SFT INT8 + 8-step DMD, adapter 1, 8 steps/CFG 3.5/`er_sde`/simple, layer-22 guidance 0–50%; specify gender; purple tint in translucent areas reported. Both author-tested proofs of concept.
- **Style adapters**: MOSS ports of Grainscape/Canon/Lenovo/NiceGirls ([announcement](https://www.reddit.com/r/StableDiffusion/comments/1x8yw6y/mossimage_gens_with_loras/)) — grain may be deliberate; untested for editing. [Kodachrome](https://huggingface.co/aoleg/MOSS-Image-Kodachrome) ([post](https://www.reddit.com/r/StableDiffusion/comments/1xf8o9o/moss_image_a_simple_kodachrome_lora/)) — Base-only, strength 1/CFG 3/50 steps/layer-22; phrase trigger as `shot on Kodachrome film` to avoid literal lettering; card contradicts the post on grain; SFT unverified. [Ultimate Digital Artwork](https://www.reddit.com/r/StableDiffusion/comments/1xc5p3v/moss_image_lora_ultimate_digital_artwork/) — bbox-captioned training but ordinary prompts work; can homogenize look; Base + official workflow ([clarified](https://www.reddit.com/r/StableDiffusion/comments/1xgjqq2/comment/19rqce2cjqtlu/)). [Kreative Studio film looks](https://github.com/Lo-res/ComfyUI-Kreative-Studio) — full processed pipeline (prompt expansion, face/hand repair, grain/JPEG), not raw-model realism evidence; don't enable AerochromeIR LookE and prompt-based LookD together; installer untested by author.
- **Prompt libraries**: [MOSS-Image-Character-Catalog](https://github.com/ukr8b3g-cmyk/MOSS-Image-Character-Catalog) (~33.9k characters / 221 styles, offline; counts are author claims) surfaced via an [r/comfyui roundup](https://old.reddit.com/r/comfyui/comments/1xbw0jj/a_quick_mossimage_news_roundup_21st_october_2026/).

## 11. Character LoRAs at inference

- **Strength tradeoff, OP-confirmed**: reducing adapter strength reduced an unwanted trait but also weakened likeness; trait vanished with the adapter off. Proposed diagnostic sweep: fixed prompt/seed at strengths 0/0.25/0.5/0.75/1, repeated across seeds ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xfu0eh/mossimage_character_lora_insists_on_generating/)).
- **Training length**: preference for a 2500-step checkpoint after extending to 3000; others report plateaus/overfitting; AI Toolkit defaults at 2000 steps worked for one user — no universal length ([discussion](https://www.reddit.com/r/StableDiffusion/comments/1x9jz3r/moss_character_loras/)).
- **Cross-checkpoint application**: a Base-trained identity adapter applied on Serenity (a Base fine-tune) reportedly renders better than relying on identities baked into the fine-tune; author's preference, not a controlled demo ([merging discussion](https://www.reddit.com/r/StableDiffusion/comments/1xemtyh/the_amount_of_lora_merging_on_civitai_is_quite/)). One user successfully applied a Base-trained adapter to SFT.
- **Multi-character leakage**: a character adapter applying to all faces despite bounding boxes — layout conditioning is not regional adapter masking; no confirmed fix; per-identity generation/edit passes are a candidate workaround ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xdyvxd/moss_image_character_lora_keeps_applying_to_all/)).
- **Triggers**: a trigger alone gave wrong hair color; explicit appearance wording helps incompletely ([discussion](https://www.reddit.com/r/StableDiffusion/comments/1x9jz3r/moss_character_loras/)). A celebrity likeness is a weak test of newly-learned identity ([Morgan Freeman showcase](https://www.reddit.com/r/StableDiffusion/comments/1xbay08/having_a_blast_with_moss/)).
- **Trainer previews ≠ inference**: Fizgig 8.8.1 previews can apply an SFT-like look to Base without loading SFT; leave Turbo off for previews; record preview mode before diagnosing failed likeness ([update](https://www.reddit.com/r/StableDiffusion/comments/1xazk0f/fizgig_881_a_new_mossimage_training_technique/)). Test checkpoints in the actual inference workflow, not trainer previews. A claimed 4× trainer speed difference was retracted (1 MP vs 0.25 MP defaults) — equalize resolution in any comparison.
- **Multi-person binding**: a [12-person photo](https://www.reddit.com/r/StableDiffusion/comments/1xev9ix/multiple_characters_testing_with_moss_image_12/) used ~1300 tokens, SFT + 4-step adapter, Euler/simple, 4 MP; identity bleed and prose-vs-bbox disagreements in replies; character LoRAs untested by the author. One success is not a counting/identity guarantee.
- **Sequential panels**: native comic-style sequencing reported ([SFT INT8 + stripe fix, Kromoss DMD2 @ 0.5, 12 steps, CFG 3–4, panel-by-panel prose](https://www.reddit.com/r/StableDiffusion/comments/1xdnxkr/moss_can_natively_generate_comics_and_image/)); but a [same-image consistency failure](https://www.reddit.com/r/StableDiffusion/comments/1xax3y9/moss_and_sameimage_consistency/) (Kromoss + 8-step, one character across two panels) shows within-image identity remains unreliable. A proposed fix — keep panel 1, mask panel 2, regenerate with panel 1 visible — requires an explicit reference/edit path to count as conditioning ([comment](https://www.reddit.com/r/StableDiffusion/comments/1xax3y9/comment/19reb2aruijut/)). LLM panel-outline prompting helps organization, not proven identity retention.

## 12. Artifact and failure troubleshooting

Diagnostic ladder for blur: (1) remove accidental softness cues; (2) compare without Turbo; (3) larger canvas; (4) one guidance/sampling change; (5) only then sharpening LoRAs.

| Symptom | First useful check | Evidence |
|---|---|---|
| Noise / broken geometry | Restore a complete compatible template; one fix was **removing the `ModelSamplingSD3` shift node** (restored images from noise) — diagnose incompatible sampling nodes, don't blanket-remove shift | [thread](https://www.reddit.com/r/StableDiffusion/comments/1x88x0t/moss_image_settings_help/) |
| Broken output with CFG > 1 | Negative-conditioning wiring; **`Conditioning Zero Out`** identified as a cause — replace with encoded empty negative prompt; invisible at CFG 1 | [diagnosis](https://www.reddit.com/r/StableDiffusion/comments/1x9oljx/help_with_moss/) |
| GGUF architecture error | Custom loader's MOSS support, not ComfyUI core | [thread](https://www.reddit.com/r/StableDiffusion/comments/1x9bzfn/unexpected_architecture_type_in_gguf_file_moss/) |
| Ghost/duplicate subjects | The reported case used a bbox workflow **without supplying boxes**; try ordinary T2I; simpler composition; less extreme canvas; hires LoRA didn't help; more steps helped a related outline artifact | [thread](https://www.reddit.com/r/StableDiffusion/comments/1xg9n9d/moss_ghost_people/) |
| Vertical banding/stripes | Checkpoint + VAE choice; DeBand layer reversion or the 1.9 MB destripe adapter (§10) | [thread](https://www.reddit.com/r/StableDiffusion/comments/1x8jn4o/vertical_banding_in_mossimage_experiments/) |
| Yellow/green cast | Partial improvement replacing a correction adapter with DeBand; cause unconfirmed | [thread](https://www.reddit.com/r/StableDiffusion/comments/1x8hbxp/moss_any_idea_what_this_is_and_why_it_is_happening/) |
| Late black output (preview plausible until ~85–90%, then black; Comfy reports success) | Unresolved in AMA; short Turbo runs reportedly work; don't infer a VAE/precision cause | [report](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/phirsqr/) |
| Latent-upscale duplication | Developer: cause not yet known — pixel-space decode/upscale/re-encode as community workaround | [reply](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/phifbk6/) |
| Anatomy errors | CFG 3.5 → 4.5–5 helped one OP on the same seed (non-Turbo); 8-step adapter at CFG 1–1.4 reported fewer errors than full sampling by another; BF16 encoder anecdote; counterexamples exist for each — treat as bounded experiments, not cures | [thread](https://www.reddit.com/r/StableDiffusion/comments/1xacc6g/better_anatomy_for_moss_image/) |
| Plastic skin | Confounded reports; run precision as a controlled experiment (§6) | [thread](https://www.reddit.com/r/StableDiffusion/comments/1xbjdrh/help_i_only_get_plastic_skin_with_moss/) |
| Workflow finishes, no output | Check missing enhancer models, switches, output connections; test the native template with only required models; distinct from sampling-then-black | [thread](https://www.reddit.com/r/StableDiffusion/comments/1xfinpc/new_to_comfyui_mossimage_workflow_from_civitai/) |
| `Unsupported Flash Attention tensor strides` | Reported on Windows/NVIDIA, attributed by the user to encoder/comfy-kitchen path; no confirmed repair | [comments](https://www.reddit.com/r/StableDiffusion/comments/1xfe5qy/moss_vs_kromoss_vs_krea_2_192_images_for_each/) |
| Images look soft in Comfy | Judge the saved file at native scale in an external viewer before diagnosing lost detail | [comments](https://www.reddit.com/r/StableDiffusion/comments/1xgmzas/moss_quality_vs_krea_2_quality/) |
| Lost sharpness after 50+ steps | Higher step count is not a universal cure; one user dissatisfied even at 40–60 steps | [showcase](https://www.reddit.com/r/StableDiffusion/comments/1xd9o13/moss_image_showcase_mostly_photoreal_some_art/) |

Also recorded: recover embedded Comfy workflows from the **original-size** image, not Reddit previews ([explanation](https://www.reddit.com/r/StableDiffusion/comments/1x8ms4i/moss_image_in_4_seconds_on_rtx5060/)); a scheduler-specific observation that `bong_tangent` displayed identical curves at shift 1 and 5 — a visible shift control doesn't necessarily change every sigma schedule ([removed-post comments](https://www.reddit.com/r/StableDiffusion/comments/1xaq6ee/removed_by_moderator/)); r/comfyui reports control nodes needing a full Comfy restart after update ([roundup](https://www.reddit.com/r/comfyui/comments/1xarop9/a_quick_mossimage_news_roundup_20th_october_2026/)).

## 13. Hardware reports (all single-user, configuration-dependent)

Principles: record model precision, encoder precision, resolution, CFG, acceleration, and whether prompt encoding is included before comparing speeds. Never compare `iterations/second` with `seconds/iteration` ([unit confusion seen here](https://www.reddit.com/r/StableDiffusion/comments/1x85fx8/t2i_moss_vs_flux3_klein_vs_krea2/)). Cold/warm boundaries change numbers ([RTX 2060 example: 344.8 s including model load → 320.9 s warm](https://www.reddit.com/r/StableDiffusion/comments/1x8zukb/moss_is_the_new_sdxl/)).

NVIDIA:

| GPU | Configuration | Report |
|---|---|---|
| RTX 5090 | 1024², 50 steps, CFG 3 | 10–11 s (independent of a 3090 user's extrapolated claim) |
| RTX 5090 | 4 MP, SFT INT8, INT8 encoder, full FLUX.2 VAE, 50 steps | ~55 s, 19.5 GB peak |
| RTX 4090 | 50/30/20 steps | 27 / 16 / 11 s |
| RTX 4070 Super | SFT + 8-step Turbo, 1 MP | 5 s |
| RTX 5060 | SFT + Lodestones 8-step, 1536×640 (0.98 MP) | 4.2 s (author prefers 1.5 MP for quality) |
| RTX 5070 12 GB | SFT INT8, 50 steps, no Turbo | 29.3 s @ 1024²; 81 s @ 1536² (12.7 / 34.4 s with Spectrum) |
| RTX 5060 Ti 16 GB | 34 MOSS + 1 Flux step, 1024² | ~20 s |
| RTX 4060 | SFT INT8 convrot + Turbo @ 0.6 (WanGP) | 52 s (resolution unstated) |
| 4060 Ti 16 GB | Base INT8 + Base Turbo 1, 8 steps, CFG 1, 2 MP | 11.4 s; also 1.11 it/s @ 1 MP (4060 Ti) vs 1.23 it/s (9070 XT) early reports |
| RTX 3080 10 GB | INT8, 5.5 MP, 8-step + character adapter, 12 steps | ~90 s |
| RTX 3060 12 GB | INT8, 50 steps | ~137 s @ 1 MP; 230 s @ 1.6 MP; 340 s @ 2.1 MP; ~9.7 GB peak |
| RTX 3060 6 GB | ~0.5 MP, ~40 steps | 50–70 s |
| RTX 3050 laptop 4 GB | optimized low-VRAM, cached prompt, few-step | ~62 s (new prompts slower) |
| Laptop 5070 Ti | SFT INT8, 30 steps, CFG 3.5, `euler_ancestral`/`beta`, 2 MP | ~78 s |
| RTX 2060 (78% power) | 1080p-class output | 344.8 s cold / 320.9 s warm |
| RTX 2070 Super | GGUF loader FP16 compute dtype | ~3× faster (loader-specific) |

AMD: 9070 XT — INT8 ~20 s @ 25 steps / ~39 s @ 50 steps @ ~1 MP (later INT8 change ~17/34 s); BF16 within 15% at 2 MP; <4 s with 8-step Turbo; ~34 s @ 50 steps/1 MP. RX 7800 XT — INT8 slower than BF16 **with custom kernel + dynamic VRAM** (stock installs may differ). RX 6600 (ROCm) — 8-step adapter @ 10 steps still ~300 s, unresolved. 6900 XT feedback contradicts a broad RDNA2 speedup claim. Hardware generation alone cannot select the fastest format without backend/kernel details.

Apple Silicon: M3 Pro 36 GB — 130–190 s at 1024² with memory-management flags; disable prompt upscaling because W4A8 encoder falls back to per-token dequantization on MPS; an Apple INT8 custom-node project exists ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xatju0/does_moss_run_well_on_macs/)). A separate M5 claim of 15 s @ 1 MP with a 4-step adapter lacks detail; M5 Pro 16 GB positive response to the optimization node. Do not extrapolate M2 timings.

## 14. Cross-model pipelines

- **MOSS → Krea 2 refinement** (indexed community recipe, incomplete): MOSS @ 1024, `dpmpp_sde`/simple, CFG 1.6 → VAE decode → Lanczos upscale → re-encode → Krea2 Turbo, Euler/simple, CFG 1, 4 steps, denoise 0.15, same text. Image-space transfer, not latent continuation; scaling factor and versions missing. Use each stage's matching VAE and conditioning.
- **Wallpaper-grade detail**: one user found MOSS @ 50 steps + Qwen upscale insufficient vs a two-pass Krea process; workflows missing — preserve the complaint without a ranking ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xgmzas/moss_quality_vs_krea_2_quality/)).
- **192-prompt comparison** ([thread](https://www.reddit.com/r/StableDiffusion/comments/1xfe5qy/moss_vs_kromoss_vs_krea_2_192_images_for_each/)): Base, SFT and Kromoss full at 50/Euler/CFG 3/shift 5, negative layer 22, seed 7; Kromoss DMD/DMD2 at 8 steps/CFG 1 unmerged; 158 s full vs ~18.5 s accelerated (hardware/resolution unstated; methodology questioned in comments). A prompt-coverage gallery, not a validated ranking — one fixed seed per prompt doesn't measure seed diversity.
- Other comparisons: [MOSS vs Flux3 Klein vs Krea 2](https://www.reddit.com/r/StableDiffusion/comments/1x85fx8/t2i_moss_vs_flux3_klein_vs_krea2/) (early), [complex poses](https://www.reddit.com/r/StableDiffusion/comments/1x8wc5i/moss_and_krea2_with_complex_poses/) (MOSS occasionally preferred, generally less reliable per author), [best-of-three simple prompts](https://www.reddit.com/r/StableDiffusion/comments/1x9oi6x/basic_workflow_simple_prompt_testing_krea2_vs/) (curated selection, disclosed), [transferred Krea art styles](https://www.reddit.com/r/StableDiffusion/comments/1x9f8gv/trying_krea2_art_styles_with_moss_image/), [4-step Krea vs MOSS SFT](https://www.reddit.com/r/StableDiffusion/comments/1x9xs4c/krea_2_turbo_4_steps_w_my_4step_lora_vs_moss_sft/) (prompt-set bias noted). None is a matched benchmark.

## 15. Running your own evaluation

1. Choose six prompts: portrait, full body, two-person interaction, environment, illustration, text/layout.
2. Run four seeds each with one complete stock workflow.
3. Compare Base and SFT.
4. Add the matching Turbo adapter using its published settings.
5. Compare at approximately equal elapsed time.
6. Test Spectrum separately if full sampling is too slow.
7. Save workflow JSON, exact filenames, prompts, dimensions, timings.

Score **composition, anatomy, text accuracy, sharpness, diversity, and usable-image rate** separately. One exceptional seed cannot tell you how dependable a workflow is. Equalize resolution and settings before attributing differences (the retracted 4× trainer-speed claim came from a 1 MP vs 0.25 MP default mismatch). Keep encoder and diffusion precision as two independent variables.

## 16. Open questions (documented search gaps, not negative results)

1. Late-stage black output — no established fix or cause (AMA report outstanding).
2. Latent-upscale duplication — developer says cause unknown.
3. Independent results for color-depth control and RoPE scaling at scale.
4. Outpainting — no directly relevant r/StableDiffusion MOSS workflow found in this pass.
5. Apple Silicon end-to-end timings with full configurations; M2 extrapolations remain predictions.
6. Named AMD backend/kernel details for reproducible quantization speed claims.
7. Compile/batching inference benchmarks (training numbers don't transfer).
8. Multi-character identity binding — layout conditioning is not regional adapter masking; no confirmed fix.

## Evidence rules used throughout

- Every claim keeps its thread, author role (OP-confirmed vs reply), and configuration attached.
- Paired reports that change multiple variables are recorded as confounded, not as causal evidence.
- Announcement posts are provenance, not validation; model cards override post comments where they conflict.
- Search-index snippets that the opened page doesn't expose are marked as indexed-only.
- Trainer previews, cached-prompt timings, and extrapolated hardware numbers are labeled as such.
