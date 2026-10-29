# MOSS inference: additional Reddit research

Research date: October 29, 2026. Continuation of the initial guide. These are attributed reports, not locally reproduced benchmarks. Search-index comments sometimes exceed the replies exposed by the opened Reddit page. The search remains active; this file is a research ledger, not a claim of exhaustive coverage.

## New findings

### Targeted SFT banding correction

The author of [Vertical Banding in MOSS-Image experiments](https://www.reddit.com/r/StableDiffusion/comments/1x8jn4o/vertical_banding_in_mossimage_experiments/) describes reverting SFT layers 37–41 to Base, optionally adding layers 32–36. This is a specific intervention rather than a generic sharpening fix. Larger outputs may exhibit wider patterns instead of eliminating them.

The [maintainer's model card](https://huggingface.co/MATLOWAI/MOSS-Image-SFT-DeBand) includes workflows and openly limits its evidence to a small prompt/seed sample. Quality uses 25 steps; Balanced combines the main fix with a weak DMD adapter at 14 steps; Fast uses 10 steps. Its rapid-moss branch needs split-QKV weights: the maintainer warns that fused Comfy-Org weights in that branch can silently produce noise or black images. Preserve the complete matching workflow. This is not a claim that ordinary native LoRA workflows need split-QKV weights.

### Lower steps without Turbo

[Faster Moss gens for iterating](https://www.reddit.com/r/StableDiffusion/comments/1x9huio/faster_moss_gens_for_iterating_30s10s/) reports 27 seconds at 50 steps, 16 seconds at 30, and 11 seconds at 20 on the author's test images, with limited perceived quality changes. The discussion identifies a 4090 system. Useful as a prompt-drafting strategy; not evidence that every scene converges at 20 steps. An RTX 3090 commenter separately reports 15 steps, CFG 3, deis_2m_ode/res_2m_ode with beta57 at 2 MP, but this is a different configuration and should not be combined into the main benchmark.

### Apple Silicon: enhancement may be a bottleneck

[Does Moss run well on macs?](https://www.reddit.com/r/StableDiffusion/comments/1xatju0/does_moss_run_well_on_macs/) contains first-hand MPS/MLX reports and links to an Apple Silicon INT8 custom-node project. One node author advises disabling prompt upscaling because the default W4A8 encoder falls back to per-token dequantization on MPS. An M3 Pro/36 GB report gives 130–190 seconds at 1024 square and describes memory-management flags. A separate M5 report claims 15 seconds at 1 MP with a four-step adapter, but lacks equivalent detail. Do not infer an M2 timing from either report. Follow-up: inspect the Apple-specific repositories and distinguish prompt generation, encoding, and diffusion timings.

### Reference embeddings versus layout extraction

[Vision Text Encode](https://www.reddit.com/r/StableDiffusion/comments/1xbjxcr/mossimage_vision_text_encode_comfyui_node_workflow/) passes image embeddings through Qwen's vision tower into text conditioning. The author says this adds preprocessing rather than sampling compute. [Repository](https://github.com/ThetaCursed/ComfyUI-MOSSImageTextEncoder).

[Pose-control discussion](https://www.reddit.com/r/StableDiffusion/comments/1xgypjz/question_regarding_moss_image_and_pose_control/) links a separate tool that detects objects/text and constructs layout JSON from a reference. [Repository](https://github.com/leroy989/ComfyUI-MOSS-QwenVL-Layout). Its documentation says added-object boxes may require manual correction. These are different mechanisms; neither establishes exact pose or identity preservation.

### Editing workflow friction

[MOSS-Image-Edit-HQ v3](https://www.reddit.com/r/StableDiffusion/comments/1xdwo6o/mossimageedithq_v3_is_out/) includes reports of confusing workflow links, Load Model Patch errors, and poor multi-photo combinations. Capture exact files and node versions before claiming reproducibility. Follow-up: resolve the author's current canonical workflow and compare native support.

### Forge Neo is an available alternative frontend

[Extension announcement](https://www.reddit.com/r/StableDiffusion/comments/1x8jeo3/mossimage_extension_for_forge_neo/) claims Base/SFT, layout, img2img, and eight-step support. A user reports a clean-install failure; the maintainer later marks it fixed. [Repository](https://github.com/eduardoabreu81/moss-image-forge-neo). Follow-up: check release and issue details before calling it dependable.

### Four megapixels is not 4K

[MOSSing around in 4K](https://www.reddit.com/r/StableDiffusion/comments/1x8apux/mossing_around_in_4k/) explicitly corrects its title to 4 MP. The author reports SFT INT8, INT8 encoder, full FLUX.2 VAE, 50 steps, CFG 3, Euler, sgm_uniform/simple, approximately 55 seconds and 19.5 GB peak VRAM on a 5090. Keep the correction with any quoted benchmark.

## Corrections and evidence quality

- [Struggling with Moss](https://www.reddit.com/r/StableDiffusion/comments/1x9qdcb/struggling_with_moss/) includes a recommendation to substitute a Heretic encoder, followed by a reply identifying itself as Heretic's creator advising against using Heretic models as text encoders. Identity not independently authenticated. Do not conflate a prompt-rewriting model with an encoder replacement.
- The same discussion includes a concrete counterexample favoring BF16 SFT and encoder, er_sde/simple, 25 steps, CFG 4. Other users favor Base. Precision/model claims need matched tests.
- [Showcase comments](https://www.reddit.com/r/StableDiffusion/comments/1xd9o13/moss_image_showcase_mostly_photoreal_some_art/) report that putting blurry in the negative made skin more airbrushed. Negative terms are not universally beneficial.
- [ComfyUI release discussion](https://www.reddit.com/r/StableDiffusion/comments/1xh0m0c/comfyui_v0430_released/) and the [actual v0.43.0 release](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.43.0) identify MOSS RoPE scaling, color-depth control, edit-LoRA support, and lower peak memory. Initial-release claims about unavailable support can already be stale.
- The pose thread suggests a generic OpenPose/ControlNet approach without establishing MOSS-compatible weights. Do not promote that as a working MOSS recipe.

## Second continuation: deeper comments and new threads

### Developer answers now linked directly

- [Anime tagging answer](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/phackbe/): the developer explicitly says they do not use underscores and gives a character-name-plus-series example. World knowledge was supplied to the captioner to help identify characters. This upgrades the original guide's second-hand report to a direct developer statement.
- [Prompt-structure answer](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/ph949nr/): varied structures were used intentionally; the developer does not identify one best order. Do not turn a useful writing template into a claimed required syntax.
- [Captioning answer](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/ph92nv6/): the developer links the published caption pipeline for adaptation/training.
- [Editing answer](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/ph93a0m/): paired-data preparation is challenging for the small team; editing was being considered. This does not support a categorical claim that an official edit model will never be released.

### Multi-person binding, identity bleed, and panel consistency are separate tests

[12 different people in one photo](https://www.reddit.com/r/StableDiffusion/comments/1xev9ix/multiple_characters_testing_with_moss_image_12/) reports a roughly 1,300-token prompt, SFT with a four-step adapter, Euler/simple and 4 MP. The author explicitly has not tested character LoRAs. Replies report identity bleed from trained adapters and disagree about prose versus nested bounding boxes. Other replies criticize unnatural texture. One successful group image is not proof of exact counting or reliable multi-character identity.

[Same-image consistency](https://www.reddit.com/r/StableDiffusion/comments/1xax3y9/moss_and_sameimage_consistency/) concerns one character repeated in two panels, using Kromoss plus an eight-step adapter. The author clarifies that the failure is within one image, not across seeds. A reply suggesting generic seed variance therefore does not answer the question. The thread links an automatic-comic workflow for further investigation.

### Layout editor: standalone app versus Comfy node

[Visual layout editor discussion](https://www.reddit.com/r/StableDiffusion/comments/1xcnhoq/a_visual_layout_editor_workflow_for_mossimage/) links [moss-layout-studio](https://huggingface.co/spaces/Curry-Sawce/moss-layout-studio). The author's replies explicitly identify it as a standalone Python/Gradio app, not a ComfyUI custom node. It can export JSON without running generation. Hosted generation uses SFT and a four-step adapter; the author's local MLX experiments were not thoroughly compared with the hosted setup.

[JSON/bbox workflow discussion](https://www.reddit.com/r/StableDiffusion/comments/1x988ph/jsonbbox_wf_for_moss/) includes alternatives and an installation failure caused by the editor's folder/package layout. Follow-up: identify exact editor repositories and matching coordinate adapters rather than assume every JSON editor exports MOSS format.

[Auto BBox Prompter](https://www.reddit.com/r/StableDiffusion/comments/1xghqx5/auto_bbox_prompter_for_moss_using_qwenvl_or_any/) clarifies in comments that its source reference is not sent to MOSS: it supplies extracted text/layout only. This is distinct from visual-embedding conditioning and instruction editing.

### Native edit support resolves part of the old v3 workflow confusion

The [Edit-HQ model card](https://huggingface.co/akhaliq/MOSS-Image-Edit-HQ) now recommends armV5 over experimental armV6, noting regressions in the latter. Native ai-toolkit-format weights go in models/loras and use Text Encode MOSS-Image Edit with edit_format=ai-toolkit. Converted plugin-format files instead go in models/model_patches and use the matching plugin workflow. The card still has an armV6 filename in one native installation step despite the top-level armV5 recommendation: retain that documentation inconsistency as a caveat. Native examples recommend 50 steps, CFG 3, Euler and SLG layer 22. A separate eight-step speed recipe is documented. None of these workflows have been run locally in this research.

### Color/depth control: a concrete supported route, with bounded claims

The [adapter author's card](https://huggingface.co/darask0/MOSS-Image-color-depth-control) specifies flat-color region IDs and depth with near=white, preferably paired with regional prompts. For synthetic mannequins it recommends stopping both controls halfway through denoising; continuous control can reproduce mannequin surfaces. Fine fingers/face details remain model-generated. Evaluation covers only a handful of scenes and two seeds. This supports a control workflow, not generic OpenPose compatibility or precise skeletal control.

### Anatomy advice has counterexamples

[Better anatomy for moss image?](https://www.reddit.com/r/StableDiffusion/comments/1xacc6g/better_anatomy_for_moss_image/) includes a concrete SFT BF16/2 MP/50-step failure report. Replies suggest CFG around 5 and BF16 encoder, while another user reports fewer errors with an eight-step adapter at CFG 1–1.4 than with full sampling. Scheduling explanations are hypotheses. Do not promise that higher precision, more steps, or removing Turbo necessarily repairs anatomy.

### Dense subjects and hybrid pipelines

[100+ rats example](https://www.reddit.com/r/StableDiffusion/comments/1xcwlz7/moss_1024x1024_34_steps_moss_5b_1_step_flux_2_9b/) describes 34 MOSS steps plus one Flux step at 1024 square, CFG 8, about 20 seconds on a 5060 Ti 16 GB. This is a hybrid result; the title's counting/perfection claim is not a verified benchmark. The shared workflow remains to be inspected.

### Adjacent-subreddit leads (supplemental, not r/StableDiffusion evidence)

- [r/comfyui inpainting report](https://www.reddit.com/r/comfyui/comments/1xa9cf7/i_find_moss_model_to_be_incredible_at_inpainting/): the author advises describing target content rather than edit instructions, checking crop padding and mask feathering; both success and no-change failures are reported. This can inform a separate appendix, but should not inflate the r/StableDiffusion coverage claim.
- [October 20 roundup](https://www.reddit.com/r/comfyui/comments/1xarop9/a_quick_mossimage_news_roundup_20th_october_2026/): control-node visibility reportedly requires fully restarting Comfy after updating, not merely reconnecting the browser.
- [October 28 roundup](https://www.reddit.com/r/comfyui/comments/1xh1b7e/a_quick_mossimage_news_roundup_28th_october_2026/): emphasizes approximate rectangular layout recovery rather than pixel-perfect masks for comic translation.

### Retrieval limitations

Direct public Reddit JSON retrieval returned an HTML page rather than a usable comment listing; research continued through indexed public pages and direct comment permalinks. Searches scoped to the AMA's full path sometimes returned unrelated older threads; those results were rejected. Some opened pages expose fewer comments than indexed search results. Do not claim every reply has been read.

## Third continuation: quantization, adapters and failure reports

### AMD precision choice needs actual hardware measurements

The [5 GB versus 9 GB discussion](https://www.reddit.com/r/StableDiffusion/comments/1x96c4z/which_moss_image_should_i_get_the_5gb_or_9gb_one/) contains a [direct RX 7800 XT owner report](https://www.reddit.com/r/StableDiffusion/comments/1x96c4z/comment/phjl11t/) that INT8 is slower than BF16 in their setup. Another commenter reports BF16 only 15% slower than INT8 at 2 MP on a 9070 XT. Other users see small quality differences, while some value BF16 texture differences. These are configuration-dependent anecdotes; neither universal speed claims nor numerical quality percentages are established. One reply incorrectly calls the 3090 Ada: do not carry that architecture label into the guide.

The [iteration-speed thread](https://www.reddit.com/r/StableDiffusion/comments/1x9huio/faster_moss_gens_for_iterating_30s10s/) adds a named 9070 XT report: about 20 seconds at 25 steps and 39 seconds at 50 steps, INT8, approximately 1 MP. A later comment claims an INT8 implementation change reduced those to roughly 17/34 seconds. Backend and complete software configuration are not preserved, so these remain directional evidence.

### A second, much smaller destriping option

[1.9 MB SFT Destripe](https://www.reddit.com/r/StableDiffusion/comments/1x9pf60/fixed_the_vertical_colour_stripes_in_mossimage/) is an extracted adapter, distinct from MATLOWAI's larger layer-reversion fix. The author recommends LoraLoaderModelOnly, SFT only, no trigger words, strength 1 at 768 px and 1.5 at 1024 px. Claims include a held-out set of 12 test images and high similarity to unmodified SFT; this is the author's metric, not an independently reproduced guarantee. Several comments report success. [Model repository](https://huggingface.co/nynxz/MOSS-Image).

### Anti-blur is often depth-of-field control

[Blur / Anti-Blur slider](https://www.reddit.com/r/StableDiffusion/comments/1xg4kft/blur_antiblur_slider_lora_for_moss/) says negative weights clarify backgrounds and positive weights soften them. Replies characterize it as a depth-of-field slider and note an animal's pose can change too. Do not equate changed background focus with recovered fine detail or assume unchanged composition. Another author says they are comparing a separately trained version, but no completed comparison is established in the read comments.

### High-resolution adapter is specifically for Base

[MAX ULTRA hires announcement](https://www.reddit.com/r/StableDiffusion/comments/1xdcmku/lora_moss_image_max_ultra_hires_by_comfyui_team/) links a LoHa adapter for Comfy-Org Base, intended for generation at 4 MP and higher, trained on a mix of anime and photographs at approximately 3.5–10 MP. [Maintainer's repository](https://huggingface.co/comfyanonymous/MOSS_image_MAX_ULTRA_hires_lora_test). This is a distinct experimental route, not evidence that raising every stock workflow's resolution fixes duplication. The ghost-people thread includes a user saying a suggested high-resolution LoRA did not solve their case.

### More sampler evidence, with important confounds

[MOSS Image — samplers and schedulers](https://www.reddit.com/r/StableDiffusion/comments/1x86z9k/moss_image_samplers_and_schedulers/) reports SFT plus SFT eight-step adapter at 0.7, 1536 square and CFG around 3; the author's preferred combinations include dpmpp_sde/radiance_shift and dpmpp_2m_sde/radiance_shift. Replies challenge the comparison because multi-evaluation samplers cost more. The post also describes disabling a shift node in its particular mixed workflow; that is not a universal instruction to disable MOSS's recommended shift. Full step count is not clearly recorded in the main report.

### Named Turbo step count is not always the tested step count

[Variety of Tests](https://www.reddit.com/r/StableDiffusion/comments/1xg29si/moss_image_variety_of_tests/) uses a named three-step adapter but actually samples at 6–8 steps. The author identifies SFT in comments and shares [workflow JSON](https://files.catbox.moe/l2o1j2.json), plus style/detail adapter links. [Author's resource comment](https://www.reddit.com/r/StableDiffusion/comments/1xg29si/comment/19rp11098r18i/). Repetitive textures and hand failures are also reported. The linked three-step HF repository has no model card at inspection, so there is no verified general configuration recommendation from it.

[Four-step comparison](https://www.reddit.com/r/StableDiffusion/comments/1x9xs4c/krea_2_turbo_4_steps_w_my_4step_lora_vs_moss_sft/) uses an existing prompt set from Krea adapter development, compares against MOSS SFT plus AK's adapter, and links full images. Comments disagree about winners and note prompt-set bias. A commenter reports five steps, CFG 1.2–1.4, adapter 0.85 for a particular version. This is not interchangeable with other four-step adapters.

### Color casts and ghosting are not proven to have one cause

[Yellow/green cast troubleshooting](https://www.reddit.com/r/StableDiffusion/comments/1x8hbxp/moss_any_idea_what_this_is_and_why_it_is_happening/) reports partial improvement after replacing a correction adapter with DeBand. The author says toggling several other nodes did not help. Another user speculates about precision conflict without verification. Keep partial improvement distinct from a confirmed root cause.

[Ghost-people follow-ups](https://www.reddit.com/r/StableDiffusion/comments/1xg9n9d/moss_ghost_people/) identify that the author was using a bbox workflow without actually supplying boxes. They propose trying ordinary T2I, but no verified success is posted in the retrieved material. A high-resolution adapter failed for them; another commenter reports more steps helped a related outline artifact. The initial resolution explanation is still a hypothesis.

### A positive counterexample for sequential panels

[Comics and image sequences](https://www.reddit.com/r/StableDiffusion/comments/1xdnxkr/moss_can_natively_generate_comics_and_image/) reports SFT INT8 merged with a stripe fix, INT8 encoder, Kromoss DMD2 adapter at about 0.5, 12 steps and CFG 3–4. The author posts a panel-by-panel prose prompt. One commenter cannot reproduce the quality/style. This provides a counterexample to the same-image consistency failure, not a guaranteed consistency method. Separate-image identity and within-image narrative sequencing remain different evaluations.

### Superseded files and sampling previews

- [Official Comfy-Org weights announcement](https://www.reddit.com/r/StableDiffusion/comments/1x7m25o/official_comfyorg_mossimage_weights_are_now/) explicitly recommends replacing the author's earlier quick INT8 conversion with the official package. Launch-day benchmarks using earlier conversions should carry their provenance.
- [Fizgig follow-ups](https://www.reddit.com/r/StableDiffusion/comments/1xfu2d6/huge_shoutout_to_shootthesound_and_fizgig_i/) advise testing checkpoints in the actual inference workflow rather than judging only trainer previews. A different commenter reports success with AI Toolkit defaults at 2,000 steps, which counters claims that one trainer is universally necessary. Keep training material secondary to the inference guide.

## Fourth continuation: editing preservation and layout preparation

### Editing can change regions outside the intended edit

[MOSS Edit versus Fibo edit](https://www.reddit.com/r/StableDiffusion/comments/1xg526w/moss_image_edit_vs_fibo20edit/) compares Edit-HQ v5 plus experimental v6 grids. A commenter reports unrequested hat recoloring; another says Fibo performed better in their own test. The training-pair count quoted in replies is a secondary claim, not independently checked here. Capability, preservation, and licensing preferences should be evaluated separately.

[Eight-step editing comparison](https://www.reddit.com/r/StableDiffusion/comments/1xfedig/moss_image_edit_works_with_8_step_lora/) demonstrates that speed adapters can be stacked with an edit workflow, but comments criticize output quality. One commenter reports using Spectrum with 18 steps and no Turbo for editing. Their complete configuration is missing, so preserve this as an investigation lead rather than a reproducible preset.

### What image-conditioning users actually report

[Image-input experiment](https://www.reddit.com/r/StableDiffusion/comments/1xb2h1k/mossimage_accepts_image_inputs/) shares a workflow and reports multimodal conditioning with an eight-step adapter. Another user describes quirks followed by training helper adapters. [Two-method comparison](https://www.reddit.com/r/StableDiffusion/comments/1xc2dxn/comparing_both_moss_image_edit_methods/) uses separately trained adapters for the two reference/edit methods and reports about 15 seconds versus 45 seconds on their setup. Hardware and full settings are absent; do not generalize the ratio.

Deeper [Vision Text Encode comments](https://www.reddit.com/r/StableDiffusion/comments/1xbjxcr/mossimage_vision_text_encode_comfyui_node_workflow/) explicitly describe generation from scratch guided by pose, lighting, and scene in the reference. The author says one example used an empty text prompt. A user complains that too much of the existing scene transfers instead of just the character. These reports support a style/composition reference experiment, not identity-only transfer or exact editing.

### Reserve space for overlaid text by describing its surface

[Empty-region layout thread](https://www.reddit.com/r/StableDiffusion/comments/1xdmtsn/mossimage_has_anyone_gotten_reliable_empty/) asks about leaving smooth regions for labels added later. One reply suggests describing a matte surface or gradient wall, plus global negative-space language. There is no confirmed reproduction. The reply also proposes low-denoise cleanup or programmatic blur; the former is still model generation and should not be presented as guaranteeing an empty region. For strict label-area requirements, deterministic compositing must be evaluated separately.

### Prompt draft and compiled prompt are different artifacts

[MOSS Prompt Enhancer thread](https://www.reddit.com/r/StableDiffusion/comments/1x9eis6/comfyuimosspromptenhancer/) describes a local GGUF-driven node that drafts layout JSON then validates/compiles it with the official compiler. Its author's replies identify GGUF-only support in that release, despite another user's API-related anecdote.

The [current repository documentation](https://github.com/xb1n0ry/ComfyUI-MOSS-Prompt-Enhancer) differentiates DRAFT_JSON from RESPONSE: drafts can use top-left absolute xyxy coordinates, while compiled output uses centered yxyx. Connect RESPONSE to text encoding and keep the emitted canvas dimensions aligned. Validation checks schema/geometry, not image quality or adherence. Thus pasting a valid-looking draft directly into MOSS can still use the wrong coordinate convention.

### Prompt rewriting is not a drop-in encoder replacement

[Upsampler clarification thread](https://www.reddit.com/r/StableDiffusion/comments/1x9s4ey/uncensored_prompt_upsampler_for_moss_image/) explicitly distinguishes text generation from diffusion conditioning. The author says their replacement is unnecessary when prompt rewriting is disabled. Users also report extra unwanted content from rewriting. Keep the original prompt and generated prompt visible during A/B tests; do not attribute changes to the diffusion checkpoint when the prompt changed too.

### One failure report contains two confounds

[Kroma versus MOSS troubleshooting](https://www.reddit.com/r/StableDiffusion/comments/1x9g86d/kroma_vs_moss_is_it_just_me/) shows an imperative prompt asking for a description, with sound/history cues, while using an eight-step adapter at 50 sampling steps. Replies identify the prompt as a request to a language model and recommend concrete visible content. This does not establish a sole cause: the adapter settings and software version also vary. A commenter supplies a full non-Turbo SFT INT8 recipe at 30 steps/CFG 3.5/euler_ancestral-beta/2 MP and reports about 78 seconds on a laptop 5070 Ti.

### Design-sheet example is not a stock Base benchmark

[Design test](https://www.reddit.com/r/StableDiffusion/comments/1x9e1xt/moss_image_design_test_from_easy_to_difficult/) initially gives little configuration. In replies the author identifies SFT, Turbo, six steps, beta/er_sde, CFG 3.5, 2400x1792, and an advanced dual-guider arrangement. The questioner's stock Base setup is therefore not a matched comparison. The exact adapter and complete graph remain unverified.

### Additional failure categories for the eventual guide

The [35-prompt test](https://www.reddit.com/r/StableDiffusion/comments/1x7kc3o/mossimage_5b_apache_20_on_a_12_gb_rtx_3060_int8/) reports failures with negation and exact clock times, plus Turbo drift on lighting and some fine constraints. These are more specific than broad prompt-adherence praise. The early quantization/custom sampler caveats already recorded still apply.

Searches for outpainting did not yield a directly relevant r/StableDiffusion MOSS workflow in this pass. This is a search gap, not proof that no workflow exists.

## Fifth continuation: checkpoint versions and confirmed edit-node repair

### Serenity's own author describes both progress and remaining limits

[Initial Serenity release](https://www.reddit.com/r/StableDiffusion/comments/1x9vp27/moss_serenity_finetune/) identifies a Base-derived fine-tune, checkpoint/INT8/extracted-adapter options, and embedded example workflows. The author explicitly notes identity bleed between similar people and clarifies that early work primarily targeted faces, not fingers. A user reports beautification bias when applying the extracted adapter to SFT. Do not present a face-focused checkpoint as an anatomy fix.

[Serenity v6 follow-up](https://www.reddit.com/r/StableDiffusion/comments/1xgo9hf/moss_serenity_v6_210k_steps_now/) describes a later unfinished checkpoint. A user asks whether small/distant people improved over v3; the author says improvement depends on the person, with training balance still being adjusted. Another user still finds the output soft. Positive compatibility reports exist, but no complete settings are supplied. [Checkpoint repository](https://huggingface.co/malcolmrey/moss-serenity). Keep version numbers attached to every result.

### Solordz release has its own intended sampling regime

[Solordz MOSS Base release](https://www.reddit.com/r/StableDiffusion/comments/1xahyca/solordz_moss_base_versions/) reports 24 steps, CFG 2–3, er_sde/beta, without upscaling. In indexed replies, creators describe training multiple topic adapters and combining them; do not interpret the word fine-tuned as proof of a full-weight training method. Users report benefits from the gallery workflows but change several variables simultaneously, so they do not isolate checkpoint quality. Another user favors Base with a weak extracted SFT adapter for facial variety.

### Native-edit update provides a versioned configuration and a confirmed repair

[Edit-Native update](https://www.reddit.com/r/StableDiffusion/comments/1xem0d0/update_comfyuimossimageeditnative_now_supports/) reports 300+ author-run edits and replaces earlier strength-0.25 workflows: SFT, strength 1, layer-22 guidance, CFG 5 for chinoll and 3 for HQ. Matching edit_format matters. The node pack processes each reference at about 1 MP and follows image 1's output shape; this differs from other implementation paths, so do not mix their resizing assumptions. A rope_axes_dim AttributeError was acknowledged as an unintended master-only dependency, patched for 0.42+ releases, and confirmed fixed by the reporting user after updating/restarting. Other comments still report poor pose/identity preservation and overly dominant references.

### More Turbo releases do not establish automatic quality improvement

[Base DMD2 release discussion](https://www.reddit.com/r/StableDiffusion/comments/1xarnzg/mossimage_base_new_dmd2_lora_8_steps/) links lora_dmd2.safetensors. Replies criticize full-frame softness, strong bokeh and anatomy. The author supplies a sharp/deep-focus prompt as an alternative, without a controlled test establishing a cure. Record DMD versus DMD2 and exact filenames separately.

[SFT three-step announcement](https://www.reddit.com/r/StableDiffusion/comments/1xafnmf/mossimagesft_3_step_lora_is_out/) points to a three-step draft section within the four-step adapter repository. This is another reason repository names alone do not uniquely identify the intended recipe. The separate showcase that sampled a named three-step adapter at 6–8 steps remains distinct evidence.

[Smartphone Snapshot v14 announcement](https://www.reddit.com/r/StableDiffusion/comments/1xalo3h/mossimagebase_lora_release_smartphone_snapshot/) confirms the Base-targeted adapter used in some multi-LoRA realism recipes. The retrieved comments are aesthetic reactions, not reproducible independent benchmarks; treat it as a style option.

### Follow-up corrections matter more than isolated speed claims

[Fizgig praise-thread follow-ups](https://www.reddit.com/r/StableDiffusion/comments/1xfu2d6/huge_shoutout_to_shootthesound_and_fizgig_i/) retract an apparent 4x trainer-speed difference after identifying 1 MP versus 0.25 MP defaults. At equal training resolution the commenter reports similar speed. This is training evidence, but it illustrates why every inference comparison also needs equivalent resolution and settings.

## Sixth continuation: detail adapters and larger character renders

### Detail-LoRA strength can change the entire image

[RAW Upscale MOSS discussion](https://www.reddit.com/r/StableDiffusion/comments/1xbzfa1/moss_detailer_lora_built_with_lora_dataset_studio/) supplies a useful controlled baseline: SFT BF16, four-step-v2 adapter at strength 1 in every comparison, six actual steps, CFG 1, Euler/simple, denoise 1. The author says detail-adapter strength around 1 is restrained, whereas 3.5 can change composition, color and subject. A commenter reports adding detail with relatively preserved content at 0.7. These are T2I comparisons, not an actual resolution-upscale procedure despite the adapter name. Evaluate both texture improvement and scene drift.

### One larger-canvas character workflow with hardware context

[Fizgig MOSS success report](https://www.reddit.com/r/StableDiffusion/comments/1xb44x1/fizgig_moss_image_lora_training_success/) describes approximately 90 seconds on an RTX 3080 for a square 5.5 MP render: Base INT8 ConvRot, 9B INT8 encoder, full FLUX.2 VAE, skip layer 22, an eight-step speed adapter and character adapter each at strength 1, 12 sampling steps, CFG 1.5, res_multistep/simple and denoise 1. The exact eight-step file and exact dimensions are not recorded in this excerpt, so this is not yet a fully reproducible preset. Replies report both success and skepticism about likeness. A celebrity likeness example alone cannot establish learning of a previously unknown identity.

### Applying a Base-trained identity adapter to a derivative checkpoint

In [LoRA-merging discussion](https://www.reddit.com/r/StableDiffusion/comments/1xemtyh/the_amount_of_lora_merging_on_civitai_is_quite/), Serenity's author distinguishes a newly trained character adapter from identities already present in the fine-tune and reports better rendering when applying a Base-trained adapter on their fine-tune. They also advocate experimenting with multiple adapters for the same concept. This is an author's preference, not a controlled demonstration that stacking is always better; strength interactions and double-counting overlapping training changes remain open.

### Sparse evidence on high-resolution and RoPE follow-ups

New comments on the [MAX ULTRA thread](https://www.reddit.com/r/StableDiffusion/comments/1xdcmku/lora_moss_image_max_ultra_hires_by_comfyui_team/) include an isolated report of improvement at 2 MP. Questions about SFT compatibility and photographic quality do not have a demonstrated answer in the retrieved material. Searches for MOSS-specific RoPE settings and small-face benchmarks mostly returned already reviewed threads; no reproducible independent RoPE preset emerged in this pass. This is a documented search gap, not evidence that scaling is ineffective.

## Seventh continuation: typography counterexamples and early adapter changes

### First-impression replies include useful concrete typography tests

[Early impressions thread](https://www.reddit.com/r/StableDiffusion/comments/1x80yc2/mossimage_some_first_impressions/) uses Base plus Turbo, eight steps, CFG 1, Euler/simple. The author reports weak text results; a [reply](https://www.reddit.com/r/StableDiffusion/comments/1x80yc2/comment/ph948df/) reports good text with res_2s/simple, 2048x1152, CFG 3.5–4, 25 steps. Another [comment](https://www.reddit.com/r/StableDiffusion/comments/1x80yc2/comment/ph9e3oq/) supplies SFT INT8 plus DMD, eight steps, CFG 3.5, Euler/simple, testing an arched title and text wrapped around a sphere. These are separate configurations, not a controlled sampler comparison. A user also reports better hand details with BF16 text encoding, without a matched benchmark. The thread offers explicit test prompts, not proof of universally reliable typography.

### Negative impressions lack enough configuration to diagnose

[Negative first-impressions post](https://www.reddit.com/r/StableDiffusion/comments/1x9iqei/mossimage_some_first_impressions_this_is_bad/) reports poor quality-to-speed results after trying multiple versions at 25–50 steps, but supplies no full configuration or reproducible prompt set in the accessible body. Preserve the negative experience without inventing a workflow explanation or treating the ranking as a benchmark.

### Four-step v2 changed its intended sampling route

[Four-step v2 announcement](https://www.reddit.com/r/StableDiffusion/comments/1x98fsn/mossimagesft4steps_v2_is_out/) includes a question about switching from data-space DMD to Euler-native DMD; a reply attributes it to the upstream adapter's direction. This is historical context reinforcing that launch-day data-space instructions and later ordinary-Euler instructions describe different versions. Exact current instructions should still come from the adapter card, rather than a comment's explanation.

## Eighth continuation: paired DMD2 tests and early template crashes

### A paired Base/SFT DMD2 report isolates a workflow pair, not the checkpoint alone

[SFT plus its own DMD2 comparison](https://www.reddit.com/r/StableDiffusion/comments/1xb5fqe/mossimage_sft_new_dmd2_lora_for_sft_8_steps/) links the author's Base-DMD2 samples and says all parameters were kept the same except the model and adapter. The author reports sharper SFT output with less bokeh, but weaker preservation of an explicitly requested 1980s film texture. Because both checkpoint and adapter change together, attribute the difference to the complete pair. Do not conclude that SFT by itself always reduces blur or that either adapter generalizes identically to both checkpoints.

### Some launch-day failures were template crashes

[ComfyUI v0.42.1 discussion](https://www.reddit.com/r/StableDiffusion/comments/1x9ypq9/comfyui_v0421_released/) identifies the patch as correcting crashes in the MOSS template shortly after initial support. Preserve release provenance when interpreting old failure reports; this does not mean a later anatomy or blur failure is a software crash. The [initial INT8 thread](https://www.reddit.com/r/StableDiffusion/comments/1x7d340/mossimage_int8_comfyui/) also contains suggestions to try 12–16 steps with early Turbo adapters for adherence, but those comments lack a complete reproducible setup.

### Search saturation note

Broad searches on workflow fixes and sigma/scheduler details increasingly return the same tips, training, and hype discussions. Related-post navigation still exposes additional release comparisons. Continue prioritizing new first-hand evidence and direct comments over repeated paraphrases of existing advice.

## Ninth continuation: early Turbo strength disagreements

[Early SFT eight-step comparison](https://www.reddit.com/r/StableDiffusion/comments/1x8254a/moss_image_sft_8_steps_turbo_lora_test/) reports Euler/simple, eight steps, 1 MP, five seconds on a 4070 Super; the author found studio skin plasticky but preferred snapshot styling. [LodestoneRock's reply](https://www.reddit.com/r/StableDiffusion/comments/1x8254a/comment/ph98pi6/) recommends 0.6–0.8 for that specific `lora_latest` revision, describing excessive training. The [OP's counterexample](https://www.reddit.com/r/StableDiffusion/comments/1x8254a/comment/phabstw/) reports anatomical failures at those strengths and prefers 0.95. Preserve both: a historical filename called “latest” is insufficient version identification, and lower strength is not a universal anatomy fix.

In the same thread, a WanGP user reports SFT INT8 convrot with Turbo at 0.6 taking 52 seconds on an RTX 4060, versus minutes at 50 steps. Resolution and complete settings are absent; this is a within-user speed anecdote, not a GPU comparison. A suggested smaller Qwen encoder lacks a confirmed download or successful reproduction and should not enter the installation guide.

[Initial four-step announcement](https://www.reddit.com/r/StableDiffusion/comments/1x8fdmv/moss_image_4_step_turbo_lora/) and [initial eight-step announcement](https://www.reddit.com/r/StableDiffusion/comments/1x7l1h4/moss_8_step_turbo_lora/) add release provenance but no substantial reproducible inference findings in accessible comments. The former's request for editing predates later editing adapters; avoid presenting it as a current capability assessment.

## Tenth continuation: anatomy follow-up, face diversity, and noise-only output

### A same-seed CFG adjustment has an OP follow-up

[Anatomy troubleshooting](https://www.reddit.com/r/StableDiffusion/comments/1xacc6g/better_anatomy_for_moss_image/) starts with SFT BF16, 2 MP, 50 steps. The [original poster confirms](https://www.reddit.com/r/StableDiffusion/comments/1xacc6g/comment/phszejm/) that increasing CFG from 3.5 to 4.5–5 helped some defects on the same seed, while 1 MP looked softer and worse for them. Other replies disagree on whether Turbo improves or worsens anatomy; speculative explanations about schedules are not established causes. Treat CFG 4.5–5 as a bounded experiment for this non-Turbo setup, not a universal Turbo setting. A user praising a Solordz workflow explicitly cannot isolate whether checkpoint, adapter, negative prompt, or another setting caused improvement.

### Skin texture and facial diversity are different targets

[Realistic SFT people discussion](https://www.reddit.com/r/StableDiffusion/comments/1xdiqgo/make_mossimage_sft_looking_like_normal_people/) provides a complete hospital snapshot prompt, CFG 6 and 30 steps. It emphasizes scene lighting and skin texture; the author cautions that describing an imperfect grip can worsen hands. A commenter reports nine similar SFT faces and a [more varied KroMoss batch](https://www.reddit.com/r/StableDiffusion/comments/1xdiqgo/comment/19rjkdlcl5h8k/). This compares SFT plus Turbo against a Base-derived fine-tune, with incomplete adapter/version details, so it cannot isolate stock checkpoint effects. Guide implication: evaluate texture, face diversity, and anatomy separately. The thread also disputes CFG 6 and offers lower Turbo strengths without controlled tests.

### Noise-only output has a confirmed workflow repair

[Settings-help thread](https://www.reddit.com/r/StableDiffusion/comments/1x88x0t/moss_image_settings_help/) recommends moving from early custom loaders to native Comfy support. One [user confirms](https://www.reddit.com/r/StableDiffusion/comments/1x88x0t/comment/phavamq/) that deleting the ModelSamplingSD3 shift node restored images from noise. Exact workflow and software revision are missing: diagnose an incompatible sampling-node configuration rather than concluding that all MOSS shift nodes should be removed. Later workflows legitimately specify shift.

### Additional release evidence

[Original editing announcement](https://www.reddit.com/r/StableDiffusion/comments/1xclgg2/mossimageedit_lora/) links chinoll's adapter and Chenkin-x's plugin. A reply warns that this early implementation did not accept Comfy-format weights. This is historical loader compatibility, not a limitation of later native editing support. [Six-step detail showcase](https://www.reddit.com/r/StableDiffusion/comments/1xaakca/moss_image_sft_6_step_detail_test/) adds a positive seed-variety report but no full workflow; do not promote it into a reproducible recipe.

## Eleventh continuation: portable layouts, capture styles, and timing context

### Resolution-independent layout authoring

[BBox1000 author announcement](https://www.reddit.com/r/StableDiffusion/comments/1x7y0bn/title_made_a_comfyui_node_to_fix_mossimages/) introduces [ComfyUI-MOSS-BBox1000](https://github.com/b4ldur/ComfyUI-MOSS-BBox1000), converting a 0–1000 layout grid to native MOSS coordinates using the generation dimensions. The author reports trying multiple aspect ratios and suspected mismatched coordinates could produce white borders; no independent comments verify that cause. This is an authoring/conversion aid, not evidence that MOSS natively uses normalized boxes or guarantees exact placement. Changing aspect ratio also changes the pixel geometry, even when normalized composition stays similar.

### Capture-medium language is a deliberate style control

[Prompting-tips discussion](https://www.reddit.com/r/StableDiffusion/comments/1x8e3dd/moss_prompting_tips/) contains first-hand reports for GoPro-video framing and an era-specific photographic opening. Another user shares a long LLM rewriting template organized around capture medium, subject, action, clothing, setting, and lighting, plus noisy/soft amateur-camera characteristics. Treat that as a community style recipe rather than a privileged MOSS prompt syntax. Its deliberate blur, compression, and underexposure instructions conflict with an all-sharp target, so do not blindly combine it with anti-blur advice. No controlled comparison establishes its required order or length; the developer AMA remains the stronger evidence that no single prompt order is known best.

### A four-second headline is approximately one megapixel

[RTX 5060 speed thread](https://www.reddit.com/r/StableDiffusion/comments/1x8ms4i/moss_image_in_4_seconds_on_rtx5060/) identifies SFT plus the Lodestones eight-step adapter. The author clarifies 4.2 seconds at **1536×640**, or 0.983 MP; separately prefers 1.5 MP for quality/speed. Do not attach the four-second time to 1.5 MP or imply cold-start/end-to-end measurement: timing boundaries, encoder precision, and memory settings are unspecified. The suggested Base-first/SFT-second process is a proposal, not a demonstrated recipe. Comments also explain recovering embedded Comfy workflows from the original-size image rather than a Reddit preview; another user's initial preview download did not recover metadata.

## Twelfth continuation: mixed styles and additional adapter provenance

[First-time Comfy user report](https://www.reddit.com/r/StableDiffusion/comments/1x8wm25/first_time_using_comfyui_tried_moss/) demonstrates an explicitly anime foreground with a photographic city background using SFT BF16 at 2560×1440 on a 16 GB RTX 5080. The author supplies a long prompt and negative prompt, reports imperfect background lettering and interactions, and later links [workflow source](https://github.com/roorem10/ComfyUI-MOSS-Image-Workflow). Reported INT8 timing is about 30 seconds versus under two minutes BF16 at that resolution, but step count, encoder precision, timing boundaries, and matched workflow details are absent from accessible comments. Do not promote this into a precision benchmark. Launch-day stable-versus-development support issues are historical. Practical prompting evidence: explicitly assign different media to foreground and background rather than relying on a single global style label; this is one demonstrated scene, not a guarantee across seeds.

[Style adapter release](https://www.reddit.com/r/StableDiffusion/comments/1x8yw6y/mossimage_gens_with_loras/) identifies MOSS-specific ports of Grainscape, Canon, Lenovo, and NiceGirls from FortranUA. A user questions visible grain, reinforcing that aesthetic adapters can deliberately introduce texture that another user might diagnose as an artifact. The creator explicitly had not tried MOSS editing, so these samples do not establish edit compatibility. No complete strength/sampler recipe appears in accessible comments.

[HQ edit v5 announcement](https://www.reddit.com/r/StableDiffusion/comments/1xetvw6/mossimageedithq_v5/) contains the model link but no accessible user validation or settings. Record release provenance without treating an announcement alone as evidence of improved preservation. Additional related links remain available for investigation.

## Thirteenth continuation: baseline showcases and negative-prompt counterexamples

[Mostly photographic Base showcase](https://www.reddit.com/r/StableDiffusion/comments/1xd9o13/moss_image_showcase_mostly_photoreal_some_art/) specifies CFG 4, mostly 39 steps (some 42/50), fixed seed 11932, Euler/sa_solver/sa_solver_pece, sgm_uniform, shift 5, SLG off, 1.33–2 MP, roughly 2.5–4 minutes on RTX 3060. This is useful no-adapter context, not a sampler comparison or multi-seed reliability test. A commenter reports that a lone blur-related negative made portrait skin more generic and airbrushed; the author prefers alternatives addressing focus/background focus. Consequently, evaluate face texture and background focus separately rather than assuming every blur-negative improves realism. Another commenter remains dissatisfied even at 40–60 steps; higher step count is not a verified universal cure.

[Random Base showcase](https://www.reddit.com/r/StableDiffusion/comments/1xcpm1i/random_moss_image_5b_base_gens_no_lora_no_finetune/) mostly uses stock Base, 50 steps, CFG 3, 1.5 MP, with exceptions across images. The author warns some exports through Invoke lost metadata. Search-indexed later comments include a successful response to a Turbo recipe, but the accessible opened page omits that exchange. Do not attribute those Turbo settings to the no-LoRA showcase itself or use one configuration to explain every image.

[Old-camera-style troubleshooting](https://www.reddit.com/r/StableDiffusion/comments/1x8nzbw/why_am_i_getting_this_result_with_moss_base_ive/) offers a concrete suggested baseline: 50 steps, CFG about 3, denoise 1, SLG single layer 22 across the full interval, double layers blank. No OP confirmation is visible. A landmark-triggered vintage aesthetic and wrong VAE are suggestions, not verified causes; the dismissive replies add no diagnostic evidence.

[Early bounding-box help](https://www.reddit.com/r/StableDiffusion/comments/1x8lb92/how_do_i_use_bounding_boxes_with_moss/) points to the native Comfy pull-request workflow and reports an early Create Bounding Boxes dimension-input issue requiring manual sizes. No software version or current reproduction is available. Use it as historical evidence to check actual canvas dimensions when troubleshooting, not as a claim that current resolution-selector connections remain broken.

## Fourteenth continuation: an OP-confirmed change with precision confounds

[Plastic-skin troubleshooting](https://www.reddit.com/r/StableDiffusion/comments/1xbjdrh/help_i_only_get_plastic_skin_with_moss/) begins with stock 50-step inference, INT8 diffusion weights, W4A8 encoder and 4 MP portraits; higher CFG and er_sde did not solve the complaint. The OP later tries 1 MP and [reports a large change after switching both to SFT and BF16](https://www.reddit.com/r/StableDiffusion/comments/1xbjdrh/comment/19rfyt6z5cqf7/), with approximately tenfold longer time. This is a useful follow-through, but not a quantization A/B: checkpoint family, precision, resolution, CFG and possibly text encoding changed during troubleshooting. Do not state that INT8 caused plastic skin or that SFT is universally more realistic from this report. The user supplies a concrete Viking close-up prompt, making it a potential future local regression case. A reply recommending 160–200 steps has no supporting comparison and should not become baseline advice.

[Struggling-with-MOSS comments](https://www.reddit.com/r/StableDiffusion/comments/1x9qdcb/struggling_with_moss/) include a separate preference for SFT plus BF16 diffusion/encoder, er_sde/simple, CFG 4, 25 steps; the user still sees some plastic skin and warns prompt enhancement can alter developed prompts. This supports offering encoder precision as a controlled experiment, not promising BF16 will remove all defects. Existing reports of BF16 helping hands are anecdotes without published matched multi-seed tests. Keep encoder and diffusion precision as two independent variables in any guide test matrix.

## Fifteenth continuation: age-prompt comparisons and aesthetic evaluation

[Realism comparison discussion](https://www.reddit.com/r/StableDiffusion/comments/1x8ss37/does_mossimage_produce_more_realistic_image/) includes the same older-woman portrait prompt across SFT with/without Turbo and Base without Turbo. The tester prefers a particular early SFT Turbo at 0.5/12 steps and reports full-strength symmetry/diversity loss. Another user supplies Base INT8 plus Base Turbo strength 1, eight steps, CFG 1, Euler/simple, 2 MP: 11.4 seconds on 4060 Ti 16 GB. This is not a matched benchmark. The original tester subsequently acknowledges the separate Base adapter; their earlier SFT-only compatibility claim must not be generalized to all Turbo releases. The prompt's accumulated age-related descriptors also produced an older-looking subject than requested.

[Cinematic-texture showcase](https://www.reddit.com/r/StableDiffusion/comments/1xeyte4/moss_is_good/) has several users criticizing exaggerated freckles; the author clarifies the intended demonstration was grain and lens flares. No settings are supplied. Guide implication: evaluate a requested photographic effect separately from perceived realism; adding more skin imperfections alone is not a reliable realism criterion.

[No-adapter concept mash-up](https://www.reddit.com/r/StableDiffusion/comments/1x90e64/mossimage_no_loras_required/) shares a hybrid-creature prompt with garment lettering and an overhead reclining pose, but lacks complete generation settings. The author posts a requested follow-up variation. It supplies a concept-composition example, not proof of reliable hands, exact typography, or general adapter-free coverage. Camera terminology is corrected in comments, illustrating that a successful-looking style cue need not be technically accurate photography language.

## Sixteenth continuation: style-dependent SLG and encoder-role confusion

[Twenty-style anime showcase](https://www.reddit.com/r/StableDiffusion/comments/1xd5ypf/mossimagesft_anime_showcase_20_styles_tested_90s/) recommends SLG single layer 22 or 24 for lettering, mechanical linework and hard comic edges; bypassing SLG for retro cel, watercolor, gouache and soft pastel styles. The author shares [workflow JSON](https://pastebin.com/pbYftAEc) and offers image-specific configurations. This is a concrete style-dependent experiment to try, not proof that these layers universally control particular visual frequencies: that mechanistic explanation is the author's claim. No matched SLG-on/off prompt/seed grid or independent reproduction is visible. Keep both settings available rather than teaching SLG as an unconditional quality switch. Comments dispute consistency relative to other models without supplying controlled tests.

[Encoder-identification question](https://www.reddit.com/r/StableDiffusion/comments/1x9pfhz/which_one_is_the_official_mossimage_text_encoder/) explicitly confuses a Qwen3-VL-4B rewrite model with the Qwen3.5-9B text encoder. A reply identifies the latter and says enhancement is optional; no reproduction demonstrates 4B as a valid substitute. This is useful evidence for a guide diagram separating optional prompt rewriting from mandatory image conditioning, while obtaining exact filenames and loader compatibility from official documentation.

## Seventeenth continuation: broader comparison sets and wallpaper criticism

[192-prompt comparison](https://www.reddit.com/r/StableDiffusion/comments/1xfe5qy/moss_vs_kromoss_vs_krea_2_192_images_for_each/) links a complete gallery and specifies Base, SFT and KroMoss full at 50/Euler/CFG3/shift5, negative layer22, seed7; KroMoss DMD/DMD2 at eight steps/CFG1, unmerged. It reports 158 seconds full versus approximately 18.5 seconds accelerated, but the post omits hardware and resolution. The Krea timing/scoring methodology is questioned in comments. Use the gallery as a broad prompt-coverage resource, not a validated cross-model speed ranking or seed-diversity benchmark: one fixed seed per prompt does not measure variation across seeds. A commenter suggests typography challenges beyond short plain words, including named font styles and small caps; this is a proposed test extension, not demonstrated performance.

[Wallpaper-quality discussion](https://www.reddit.com/r/StableDiffusion/comments/1xgmzas/moss_quality_vs_krea_2_quality/) reports inadequate fine detail even after 50-step MOSS generation and a Qwen upscale, compared with a two-pass Krea process. The full workflows are missing, so preserve the complaint without a universal ranking. Replies distinguish intentional imperfect-camera aesthetics from crisp photographic detail and propose MOSS-to-Krea refinement, but supply no complete reproducible handoff workflow. One contributor repeats their previously recorded Base recipe (CFG4–5, 35–50 steps, above1.33MP); this is the same person's evidence, not independent corroboration.

Search note: date-filtered searches still return older posts and omit some replies visible in indexed snippets. Treat search dates as discovery aids; verify relevant content in the thread and retain uncertainty when the accessible page differs.

## Eighteenth continuation: pose comparisons and best-of-three selection

[Complex-pose comparison](https://www.reddit.com/r/StableDiffusion/comments/1x8wc5i/moss_and_krea2_with_complex_poses/) reports identical prompts/seeds, with MOSS occasionally preferred but generally less reliable by the author's assessment. Full workflow and aggregate success counts are absent. A commenter describes running 100 MOSS seeds for one prompt as a creative exploration workflow; that supports the usefulness of variation, not a low failure rate. Do not assume identical numeric seeds create matched initial noise or equivalent difficulty across different architectures.

[Simple-prompt comparison](https://www.reddit.com/r/StableDiffusion/comments/1x9oi6x/basic_workflow_simple_prompt_testing_krea2_vs/) explicitly selects the best of three seeds for each model/prompt. MOSS settings: 25 steps, CFG2.5, er_sde/simple; checkpoint variant and resolution are unspecified. The author reports duds alongside artistic strengths. A reader prefers MOSS's scene grain and directional lighting but notices misplaced objects and flare. Treat it as a curated aesthetic showcase with a disclosed selection rule, not first-try reliability evidence or a controlled sampler test.

[Transferred art-style prompts](https://www.reddit.com/r/StableDiffusion/comments/1x9f8gv/trying_krea2_art_styles_with_moss_image/) offers MOSS examples using a Krea-oriented style reference library. No exact inference recipe is supplied and a commenter reports the reference page unavailable at the time. Preserve portable prose style descriptions when available rather than making a guide depend on a third-party site's uptime or suggesting Krea-specific adapter compatibility.

## Nineteenth continuation: unresolved AMA failure reports

[Late black-image failure report](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/phirsqr/) specifies SFT BF16, no adapters, 50 steps, CFG3, Euler/simple, about1MP. The preview looks plausible until roughly85–90% of sampling, then turns black; Comfy reports success. The user says short Turbo runs work. No verified fix or cause is visible. Record when the preview fails as diagnostic evidence, but do not infer that successful Turbo excludes every VAE problem or proves a numerical-precision cause.

[Developer reply to latent-upscale duplication](https://www.reddit.com/r/StableDiffusion/comments/1x7zf1r/comment/phifbk6/) explicitly says the cause is not yet known. This supports keeping pixel-space decode/upscale/re-encode alternatives as community workarounds rather than presenting a proven explanation for latent duplication.

AMA search audit: the accessible thread contains no matches for RoPE or positional encoding; a claimed4K token context is a user's remark, not an answered developer specification. No new controlled encoder-precision answer was located. Avoid carrying an assumed developer answer forward in the search queue.

## Twentieth continuation: no-output graphs and recoverable official examples

[Workflow finishes without output](https://www.reddit.com/r/StableDiffusion/comments/1xfinpc/new_to_comfyui_mossimage_workflow_from_civitai/) describes an empty final-prompt preview and inactive queue in a downloaded graph. Replies suggest checking missing enhancer models, switches and output connections, then testing the native template with only required models. The OP only promises to investigate; there is no confirmed diagnosis. Do not repeat a comment's misleading “shortest route” explanation as Comfy execution semantics. Separate this no-execution symptom from a sampler that runs then emits black pixels.

[Official-example prompt request](https://www.reddit.com/r/StableDiffusion/comments/1xexx58/does_anyone_know_the_prompt_for_the_elden_ring/) points to a genuinely recoverable [parameters file](https://github.com/OpenMOSS/MOSS-Image/blob/main/assets/images/011/parameters.json). Verified file: Base, Euler, 50 steps, CFG3, shift5, seed42,1680×944, uncond skip26, separate slg_scale0, max_sequence_length4096. It supplies a detailed centered-yxyx layout for a game scene and HUD, including explicit text items. This is stronger reproducibility material than reconstructing a prompt from a showcase thumbnail. Do not confuse negative-branch layer skipping with the separately disabled SLG fields or infer that every example used layer22.

[MOSS Image Studio author post](https://www.reddit.com/r/StableDiffusion/comments/1xdw30e/i_hate_comfyuis_interface_so_i_vibecoded_a/) offers a browser interface backed by Comfy, with queueing, installed-model selection and workflow export. The author explicitly calls img2img experimental and reports only their own machine. It is an optional interface lead, not independent validation or a replacement image-editing model.

## Twenty-first continuation: older-GPU compute dtype and Forge Neo

[MOSS-GGUF FP16 dropdown report](https://www.reddit.com/r/StableDiffusion/comments/1x839d0/comfyuimossgguf_already_supports_fp16_it_was_just/) says an early RebelMossGGUFV4 loader exposed BF16/FP32 but its runtime also supported FP16. The author adds FP16 to the UI and reports roughly3× faster generation on RTX2070Super. Full timing/settings, source revision and independent MOSS reproduction are absent. This is a specific loader's compute-dtype anecdote, not an instruction to modify every current GGUF loader. Quantized weight storage and execution dtype are separate concerns. Do not repeat the author's blanket INT8-support claim for RTX20-series cards or treat a reply about Qwen2.1 speed as a MOSS measurement.

[Forge Neo extension announcement](https://www.reddit.com/r/StableDiffusion/comments/1x8jeo3/mossimage_extension_for_forge_neo/) links [moss-image-forge-neo](https://github.com/eduardoabreu81/moss-image-forge-neo) and advertises Base/SFT, layout, img2img, and eight-step adapters in regular tabs. The author explicitly says some detail and lettering remain better at50steps. No independent test comments are accessible, so preserve this as an optional implementation and author-reported tradeoff, not a verified capability matrix. The img2img claim alone does not establish instruction-editing or identity-preservation performance.

## Twenty-second continuation: a more explicit cross-model refinement recipe

Later search-indexed comments in [the tips thread](https://www.reddit.com/r/StableDiffusion/comments/1xe1nmu/a_few_tips_for_moss/) describe MOSS at1024 with dpmpp_sde/simple and CFG1.6, followed by VAE decode, Lanczos image scaling, re-encoding and Krea2 Turbo at Euler/simple, CFG1, four steps, denoise0.15, same text. Unlike earlier vague handoff suggestions, this identifies an image-space transfer rather than raw latent continuation. The scaling factor, first-pass steps and full model versions are missing. The opened thread's cached body omits this later comment, so no direct permalink was recovered. Label as an incomplete indexed community recipe; no independent reproduction or preservation guarantee. The explanation that noisy sampling improves later skin is the commenter's hypothesis. Use each stage's matching VAE and conditioning when implementing a cross-model test; this is implementation reasoning, not a quoted result.

Search also surfaced claims of12MP direct generation and16MP collapse with SFT+DMD. Those incomplete high-resolution experiments do not extend the recommended baseline beyond1–2MP, and no tile-specific MOSS workflow was established by this search.

## Twenty-third continuation: layout discoverability and hidden template text

[Box-prompting help hidden in a meme thread](https://www.reddit.com/r/StableDiffusion/comments/1xf3zz1/not_quite_what_i_was_looking_for/) supplies a small1024-square poster JSON with separate text/object items and explains centered yxyx coordinates. It also links [RunningOverGlowies/MOSS-BBox-Editor](https://github.com/RunningOverGlowies/MOSS-BBox-Editor), a single-file HTML editing tool, as a user's preferred alternative. A commenter warns about an existing prompt inside the template subgraph affecting generations; no exact node/version, reproduction or OP-confirmed fix is supplied. Guide troubleshooting implication: inspect final assembled conditioning and expanded subgraphs for leftover example content before blaming layout control. This is a diagnostic check, not an established universal template bug.

Additional search-indexed replies in the earlier prompting thread say its amateur-photo rewriting template is intended for multiple recent models, not MOSS specifically. Preserve it as generic style assistance. Current broad searches continue to return mostly already-reviewed posts; the meme-thread discovery shows why descriptive inference searches alone miss useful replies.

## Twenty-fourth continuation: enhancer integration and compile-error gaps

Search-indexed later replies in [the enhancer discussion](https://www.reddit.com/r/StableDiffusion/comments/1x9eis6/comfyuimosspromptenhancer/) include a positive Gemma4_31b llama-server experience, but the author separately says their node at that time only loads local GGUFs and cannot target an existing LAN server. Those statements do not establish native API support in the released node: the user's additional integration is unspecified. The cached opened page contains only earlier replies. Check current implementation before documenting deployment options; do not infer that an image encoder can replace this particular node's GGUF loader just because native Generate Text can rewrite prompts.

[Four-step v2 discussion](https://www.reddit.com/r/StableDiffusion/comments/1x98fsn/mossimagesft4steps_v2_is_out/) includes an unresolved report of Aimdo compile errors related to dynamic VRAM when trying v1. No traceback or fix is supplied. Preserve as a software/setup lead rather than attributing image-quality failures to compilation or recommending compile flags without evidence.

Searches on inference compilation and batch-size performance mainly returned training discussions or previously reviewed Spectrum reports. No new controlled MOSS inference batching/compile benchmark was established. Training batch speeds must not populate an inference-speed table.

## Twenty-fifth continuation: viewer sharpness and installed-version verification

Later indexed replies in [wallpaper-quality discussion](https://www.reddit.com/r/StableDiffusion/comments/1xgmzas/moss_quality_vs_krea_2_quality/) report that saved images appear sharper in an external viewer than inside Comfy; another user says they routinely double-check externally. No frontend version or controlled screenshot comparison is supplied, so this is not a verified universal Comfy bug. Practical guide check: judge the saved image at native scale before treating a scaled preview as evidence of lost diffusion detail.

[Missing moss_image loader option](https://www.reddit.com/r/StableDiffusion/comments/1x8mnbe/load_clip_has_no_moss_image_on_comfyui/) includes a user who fixed launch-day availability by updating, restarting and refreshing the browser. Later indexed follow-up reports a portable installation stuck on0.32.0 and success after installing0.42.1. Verify the running version, not merely that an updater reported success. The thread's advice to copy site-packages or try unrelated encoder types is not established as safe or correct. Runpod driver explanations remain individual unverified diagnoses.

[192-image comparison comments](https://www.reddit.com/r/StableDiffusion/comments/1xfe5qy/moss_vs_kromoss_vs_krea_2_192_images_for_each/) also contain a Windows/NVIDIA report of `Unsupported Flash Attention tensor strides` attributed by the user to the encoder/comfy-kitchen path. There is no traceback or confirmed repair in accessible indexed replies. Keep this separate from unsupported GGUF architecture tags, late black output and missing UI options; these are different symptoms with different evidence requirements.

## Twenty-sixth continuation: schedule controls may not affect every scheduler

[Surviving comments on a removed comparison post](https://www.reddit.com/r/StableDiffusion/comments/1xaq6ee/removed_by_moderator/) include a user reporting identical displayed curves for bong_tangent at shift1 and5, with an overlay link. This is a scheduler-specific observation without versioned source verification; it warns against assuming a visible shift control necessarily changes every sigma schedule. Another user reports SFT20–25steps, CFG3–6, er_sde/bong_tangent and1536px working well, but the shift5 field should not automatically be credited for that result.

The same thread suggests writing a dedicated lighting block with direction, time of day, highlight character and shadow depth. No OP-confirmed reproduction establishes a universal fix. A hex-color comprehension claim lacks measured output colors or a tolerance test: palette steering is not exact color calibration.

Color/spot searches mostly returned known VAE guidance, the recorded yellow-green artifact thread, and an unrelated checkpoint's white-dot problem. The latter is not MOSS evidence. No new verified MOSS border/spot repair emerged from this batch.

## Twenty-seventh continuation: partial SFT blend and reference limitations

Later indexed comments in [realistic-people discussion](https://www.reddit.com/r/StableDiffusion/comments/1xdiqgo/make_mossimage_sft_looking_like_normal_people/) include a user favoring Base plus Kijai's extracted SFT adapter at0.2. This gives a concrete low-strength blend to test; it is not a Turbo adapter recipe or a controlled diversity/quality comparison. Do not confuse an extracted SFT delta with SFT-trained speed adapters merely because both names contain SFT.

[Early image-input thread](https://www.reddit.com/r/StableDiffusion/comments/1xb2h1k/mossimage_accepts_image_inputs/) has a later report that increasing reference-token amount can improve similarity, while explicitly conceding it is insufficient for precise editing without additional training. The early reference mechanism and later edit adapters remain separate workflows; no universal image-strength setting follows from these comments.

A later indexed reply to [old-camera-style troubleshooting](https://www.reddit.com/r/StableDiffusion/comments/1x8nzbw/why_am_i_getting_this_result_with_moss_base_ive/) reports improvement from extending layer-skip start/end to0–1. This adds a positive follow-up to the previously unconfirmed suggestion, but the responder's full settings and identity as OP are not established. Preserve as independent anecdotal corroboration rather than an OP-confirmed repair.

## Twenty-eighth continuation: a non-human binding and typography probe

[Cat dance-floor test](https://www.reddit.com/r/StableDiffusion/comments/1x8xjhy/next_post_about_moss_image/) supplies a useful compact prompt: six named cat types ordered left-to-right, dancing in pairs, each with a corresponding paper label in Courier type. Original settings are SFT40steps, CFG3, Euler/sgm; a commenter reruns the prompt with eight-step Turbo at eight steps, CFG3.5, Euler/simple. The OP emphasizes paired grouping, font choice and contextual label binding when criticizing the accelerated result. Resolution, exact adapter and seed counts are absent. Use this as a future regression prompt separating counting, pairing, identity/order binding and typography, not proof of a measured Turbo failure rate. Indexed later replies mention12steps/CFG3.5 helping washed-out or anatomical results, but no exact adapter revision is established.

[Morgan Freeman showcase](https://www.reddit.com/r/StableDiffusion/comments/1xbay08/having_a_blast_with_moss/) confirms5–5.5MP direct generation and about90seconds on3080 10GB withINT8, linking the same author's previously recorded training/workflow post. This is additional context from the same experiment, not an independent hardware benchmark. Replies correctly question whether a known celebrity is a strong test of newly learned identity, even when the prompt uses a different trigger; pretrained familiarity remains a confound.

## Twenty-ninth continuation: RTX2060 cold/warm timings and Apple follow-up

Later indexed comments in [the SDXL comparison discussion](https://www.reddit.com/r/StableDiffusion/comments/1x8zukb/moss_is_the_new_sdxl/) give unusually explicit timing boundaries: RTX2060 power-limited to78%, i7-4770S,32GBDDR3,1080p widescreen,344.83seconds including model load, then320.85seconds with the model already loaded. Steps, precision and exact dimensions are absent; retain as two user-reported runs, not an isolated loading-cost measurement because the second prompt/image changed. The opened cached page omits those later comments, so there is no recovered direct permalink.

Later indexed replies in [the Mac thread](https://www.reddit.com/r/StableDiffusion/comments/1xatju0/does_moss_run_well_on_macs/) add a positive M5Pro16GB response to the linked custom-node optimization, without new timing/configuration. Other commenters recommend Valtz or Radiant Canvas without benchmarks. Do not upgrade those mentions into tested installation recommendations, or repeat a predicted M2 runtime as a measurement. The established M3Pro memory/offload report remains more informative than these unspecific speed endorsements.

## Thirtieth continuation: timing-unit confusion and unisolated sampler claims

[Early three-model comparison](https://www.reddit.com/r/StableDiffusion/comments/1x85fx8/t2i_moss_vs_flux3_klein_vs_krea2/) reports same prompt/seed and no adapters, while comments give MOSS1MP sampling speeds of1.11iterations/second on4060Ti16GB and1.23iterations/second on9070XT. Backend, precision and full settings are absent. A nearby Krea number is seconds/iteration, the inverse unit: normalize units before comparing anything. These early figures do not supersede later optimized measurements. The reported preference for1.5MP over1MP is anecdotal, with no published success counts.

New searches on sampler comparisons mostly return the already-recorded early Turbo grid and contradictory latent-sharpening replies. Claims assigning ethnicity or realism to a sampler lack diverse prompts, seeds and isolated variables; they should not become guide rules. Coffmeteor's Turbo is mentioned with15steps/CFG3/Euler/sgm_uniform in the tips comments, but no reproducible comparison was located. Treat it as another adapter lead requiring its own current card, not as interchangeable with four/eight-step distillations.

## Thirty-first continuation: identity tradeoffs and experimental alpha output

[Unwanted character-LoRA trait](https://www.reddit.com/r/StableDiffusion/comments/1xfu0eh/mossimage_character_lora_insists_on_generating/) contains an OP-confirmed inference tradeoff: reducing adapter strength reduced an unwanted appearance trait but also weakened likeness. The trait reportedly disappears with the adapter disabled, despite absent examples of that pose in the dataset. A commenter proposes fixed-prompt/seed strengths0/.25/.5/.75/1, repeated across seeds. This is a useful diagnostic sweep, not a proven training repair. Dataset-coverage explanations remain hypotheses.

[Character LoRAs discussion](https://www.reddit.com/r/StableDiffusion/comments/1x9jz3r/moss_character_loras/) has a follow-up preferring a2500-step checkpoint after extending training to3000, while others report plateaus/overfitting. One user successfully applies a Base-trained adapter to SFT. Another reports a trigger alone gives incorrect hair color and explicit appearance wording helps incompletely. Evaluate checkpoint, strength and prompt separately; none supplies a universal training length or compatibility guarantee. [Likeness discussion](https://www.reddit.com/r/StableDiffusion/comments/1xdrbzy/likeness_of_moss_character_loras/) contains conflicting visual assessments and similarity scores; no standardized percentage benchmark or universal score ceiling is established.

[Multi-character identity leakage](https://www.reddit.com/r/StableDiffusion/comments/1xdyvxd/moss_image_character_lora_keeps_applying_to_all/) reports a character adapter affecting all faces despite bounding boxes and prompt variations. A reply suggests training regularization/DOP; there is no confirmed fix. Layout conditioning should not be presented as regional adapter masking. A separate generation/edit pass per identity is a candidate workaround to test, not something demonstrated in this thread.

[Transparent-output announcement](https://www.reddit.com/r/StableDiffusion/comments/1xe1gse/i_trained_a_lora_that_makes_mossimage_output_real/) links an experimental alpha adapter. [Author model card](https://huggingface.co/paralaif/MOSS-Image-Alpha-LoRA) supplies workflow/custom RGBA VAE loader and save node. Use SFT, alpha LoRA1.0 (0.8 acceptable;0.6 can make subjects translucent), end prompt with `isolated on a transparent background`, describe the subject rather than a scene. Author settings: optional SFT DMD8steps/CFG1/er_sde/simple; alternatively28steps/CFG4;1024² or832×1216/1216×832. The normal VAE cannot deliver this alpha workflow; stock loader needs the supplied four-channel support. Known problems include halos, unwanted translucent dark clothing, inconsistent glass and weak amorphous effects; composition/pose can change. Gallery picks one seed from three. Released for non-commercial research/evaluation according to its card. Author-tested proof of concept, not independently validated here.

## Thirty-second continuation: follow-up comments qualify showcase recipes

[Design-test direct comment and replies](https://www.reddit.com/r/StableDiffusion/comments/1x9e1xt/comment/phkso31/) recover an important caveat to the earlier six-step recipe: a reader challenges use of the four-step adapter without its dataspace/time-embedding custom implementation. OP deliberately uses it as an ordinary LoRA and prefers six steps because four left background detail unfinished. This is an experimental departure from that historical adapter's prescribed loader, not a clean recipe for every current Turbo. Another commenter reports exaggerated facial expressions and OP agrees; no mitigation or controlled frequency is provided. The quality difference from the questioner's Base1MP setup cannot isolate quantization because model, adapter, resolution and sampling all differ.

[Same-image consistency direct comment](https://www.reddit.com/r/StableDiffusion/comments/1xax3y9/comment/19reb2aruijut/) adds a proposed sequential workflow: keep an accepted first panel, mask the second, then regenerate with the first visible; alternatively edit using a reference-capable model. OP only says they will try. Full-denoise masked generation alone does not establish that this MOSS graph actually conditions on visible image content; require an explicit reference/edit path and reproducible workflow before recommending it as a confirmed identity fix. The comment's causal account is speculation.

[Comic prompt-expansion comment](https://www.reddit.com/r/StableDiffusion/comments/1xatc20/comment/19re6vxnixzls/) suggests an LLM outline with panel positions, repeated character attributes, camera angles, concrete actions and page-level style anchors. The consistency OP says this helps but remains dissatisfied; no matched images or success rate. Useful prompt organization, not proof of reliable identity retention or a replacement for MOSS's native layout syntax. Avoid copying the full copyrighted system prompt; the structural summary is sufficient.

## Thirty-third continuation: editing-method comparison and film workflow provenance

[Two edit methods](https://www.reddit.com/r/StableDiffusion/comments/1xc2dxn/comparing_both_moss_image_edit_methods/) is a first-hand comparison by Sixhaunt: simple reference injection versus ai-toolkit's fuller edit conditioning, each with its own rank16 adapter trained on the same dataset for6000steps. Without adapters the author reports blended/overlaid inputs; trained versions improve editing. Reported inference times15s versus45s lack hardware, resolution and sampler details. Equal steps do not mean equal compute; author says the latter training also takes about3× longer. This supports keeping reference and edit adapter/conditioning formats matched, not declaring either method universally superior. It predates later HQ/native recipes.

[Film Looks announcement](https://www.reddit.com/r/StableDiffusion/comments/1xgaisr/moss_film_looks_pick_a_film_stock_and_a_lens_type/) links [Kreative Studio](https://github.com/Lo-res/ComfyUI-Kreative-Studio), whose current README identifies workflowv8: local prompt expansion plus optional face/hand repair, detail/upscaling, film grain and JPEG effects. These are processed workflow outputs, not raw model realism evidence. README lists ten node packs, recent ComfyUI/subgraphs, and testing on5060Ti16GB/32GBRAM. Experimental AerochromeIR LookE is discouraged; use prompt-based LookD, and avoid enabling both. One-command installer is explicitly untested by its author. No independent user validation was visible in the Reddit comments. Film/lens names remain aesthetic controls rather than measured optical/film simulations.

[Critical discussion](https://www.reddit.com/r/StableDiffusion/comments/1xdoqfm/was_the_moss_hype_a_psyop_or_am_i_missing/) contains sharply conflicting reports on likeness training, eight-step quality and prompt adherence. One user rejects eight-step quality loss; others favor seed variety, realism or layout controls. Configurations and paired outputs are insufficient to adjudicate. Do not translate votes, account-age accusations, or claimed order-of-magnitude adherence into evidence of model quality or coordinated promotion. This adds negative experience coverage without establishing a new best setting.

## Thirty-fourth continuation: framing conflicts and another no-Turbo recipe

[Framing discussion](https://www.reddit.com/r/StableDiffusion/comments/1x9qdcb/comment/phnoyhm/) describes contorted horizontal poses in tall canvases, especially when insisting on both head and feet. OP recognizes the failure pattern. Suggested experiments are a wider canvas, explicit near/far perspective, and removing descriptions of occluded/out-of-frame items. No successful OP rerun proves a fix; do not claim a model-wide spatial mechanism.

[Separate recipe](https://www.reddit.com/r/StableDiffusion/comments/1x9qdcb/comment/phnnsjx/) reports SFT INT8 convrot, matching INT8 encoder, small Flux2VAE, no Turbo,30steps/CFG3.5/euler_ancestral/beta, with anatomy negatives, across several seeds/resolutions. The author favors2MP but reports lower-resolution success. This is an alternative experiment, not evidence that sampler or negatives independently caused improvement; the replies dispute negative-prompt explanations without controlled tests. Do not transplant this CFG into unrelated distilled workflows.

## Thirty-fifth continuation: artwork adapter and catalogue lead

[Ultimate Digital Artwork announcement](https://www.reddit.com/r/StableDiffusion/comments/1xc5p3v/moss_image_lora_ultimate_digital_artwork/) reports an anime/digital-painting LoRA trained with structured bounding-box captions, while the author says ordinary natural-language prompts also work. Author warns the adapter can homogenize the look. No strength, sampler or reproducible artifact-rate comparison is supplied; visible replies are appreciation, not independent tests. Civitai model3014333/version3421450 was linked but inaccessible here, so exact current inference instructions remain unverified. Training-caption format does not establish a mandatory inference syntax.

[Style-library question](https://www.reddit.com/r/StableDiffusion/comments/1xby6e2/mossimage_stylescharacters_library/) receives a pointer to a [roundup in r/comfyui](https://old.reddit.com/r/comfyui/comments/1xbw1jj/a_quick_mossimage_news_roundup_21st_october_2026/). It identifies [MOSS-Image-Character-Catalog](https://github.com/ukr8b3g-cmyk/MOSS-Image-Character-Catalog): a reported33937character/221style offline catalogue with prompt-copying and favourites export. The roundup criticizes some style matches and missing film styles. Counts and coverage are secondary author claims pending repository inspection; catalogue existence is not evidence every named character/style works consistently. This is a concrete source of prompts for testing, with outside-subreddit provenance kept explicit.

Additional next leads recovered from related posts: Ultimate Digital Painting examples; Manga Alpha Image LoRA; simple Kodachrome LoRA; MAX ULTRA hires adapter; SFT3-step release. Inspect their actual instructions and comments before recommending.

## Thirty-sixth continuation: Kodachrome trigger behavior and draft-card contradictions

[Kodachrome author post](https://www.reddit.com/r/StableDiffusion/comments/1xf8o9o/moss_image_a_simple_kodachrome_lora/) reports Base-only, non-Turbo samples and recommends phrasing the trigger as `shot on Kodachrome film` to reduce literal lettering appearing in objects. The post stresses4×5sheet-film scans rather than35mm grain. [Current adapter card](https://huggingface.co/aoleg/MOSS-Image-Kodachrome) gives standard ComfyUI LoRA loading, strength1/CFG3/50steps/layer22guidance, tested on Base only; SFT behavior is unverified. It calls the checkpoint intermediate and contains grain/halation claims alongside wording that grain had not transferred, differing from the post's grain-free account. Treat color/sharpness as author-reported aesthetic effects; do not promise grain behavior, universal blur removal or exact film emulation. No independent Reddit test was visible.

[Current SFT few-step card](https://huggingface.co/akhaliq/MOSS-Image-SFT-4-steps) clarifies the distinct three-step draft file (`lora_3step.safetensors` or frozen3stepv1.0): strength1, SFT, Euler/simple, exactly3steps, CFG1. It explicitly cautions against other counts for that adapter. Historical data-space adapters remain separate. Documentation conflicts persist: one section calls two-step a failed experiment, while Quickstart still promotes it as draft; A100four-step timing appears as both~11s and~5.6s without an explained boundary. Do not compare these numbers as controlled benchmarks or copy the stale two-step instruction into the guide. Exact-file settings take precedence over the repository's four-step name or settings from other users' unnamed Turbo files.

MAX ULTRA hires and three-step Reddit announcements were revisited; visible comments add no independent quantitative validation. Their announcement provenance is already recorded above.

## Thirty-seventh continuation: manga alpha variant and artwork workflow follow-up

[Artwork showcase replies](https://www.reddit.com/r/StableDiffusion/comments/1xgjqq2/comment/19rqce2cjqtlu/) resolve the earlier UDA compatibility uncertainty: author specifies Base and the official ComfyUI MOSS workflow with one added LoRA loader. Exact strength, steps and complete uploaded graph remain absent; the promised later upload is not verified.

[Manga alpha announcement](https://www.reddit.com/r/StableDiffusion/comments/1xfonos/introducing_krea2mossimage_manga_alpha_image_lora/) links a separate [MOSS manga alpha card](https://huggingface.co/paralaif/MOSS-Manga-Alpha-Image-LoRA), distinct from the earlier39-image alpha proof of concept. Card settings: SFT INT8+SFT8stepDMD, manga adapter1,8steps/CFG3.5/er_sde/simple, layer22guidance0–50%,832×1216/1216×832/1024². Needs supplied four-channel RGBA VAE loader and save workflow; prompt ends with `isolated on a transparent background`. Author reports30single-seed outputs and valid alpha on Base/SFT/MossAD, with differing ink strength. Limitations include purple tint in translucent areas, ambiguous-gender drift, dense-black subjects and full scenes. Specify subject gender when relevant and avoid scene-heavy backgrounds. Its card declares Apache2.0, unlike the earlier alpha proof of concept's research-only release. These are author evaluations, not independent quality or licensing audits. The Krea/Kroma incompatibility mentioned in the announcement concerns the separate Krea adapter, not MOSS's Kromoss checkpoint.

## Thirty-eighth continuation: a second sharpness slider has opposite polarity

[Sharpness-slider thread](https://www.reddit.com/r/StableDiffusion/comments/1xg55p3/moss_sharpness_lora_blur_what_blur/) describes aoleg's separate Base-trained adapter: positive1 sharpens, negative1 blurs. This is the opposite sign convention from the previously recorded blur/anti-blur slider. A user sees no improvement with SFT+Turbo; author confirms those combinations were untested. Author explicitly distinguishes this from a depth-of-field-trained slider, despite retaining some bokeh examples in training. Keep filenames/authors attached to polarity advice.

The same thread adds an incomplete two-stage recipe: Base first, eight-step DMD2 only in second stage, Auryg sigma-locked sampler,40%handoff, reported `er_side` (likely er_sde, unconfirmed) and bong_tangent. First-stage step count remains unanswered. Do not turn40%handoff into denoise0.4 or claim this is a complete reproducible workflow. No controlled comparison isolates the speed adapter from the staged sampler.

[Detailer direct reply](https://www.reddit.com/r/StableDiffusion/comments/1xbzfa1/comment/19rgbr5lpgveo/) preserves the0.7strength independent report and a later user's warning that high strengths appear overcooked. Previously recorded eight-step editing and Studio threads were revisited without a new confirmed fix.

## Thirty-ninth continuation: merged realism checkpoint tradeoffs

[Jib Mix MOSS announcement](https://www.reddit.com/r/StableDiffusion/comments/1xdgxmy/jib_mix_moss_realistic_out_now_free/) identifies a specialized photo-style checkpoint with an eight-step adapter already merged. Author limits its strengths to single female subjects, explicitly excluding art/fantasy, and suggests five-step drafts when followed by upscaling. Do not add another Turbo by default to an already distilled merge; establish its exact workflow first. [Later comments](https://www.reddit.com/r/StableDiffusion/comments/1xdgxmy/comment/19rjfug0sju02/) criticize face homogenization and synthetic skin. These aesthetic reactions are useful counterevidence to calling every realism finetune an improvement, but guesses about its training-image source or the merged adapter causing the look are unverified. Download/workflow link is Civitai model3016339; full settings have not been recovered.

[JSON/BBox workflow replies](https://www.reddit.com/r/StableDiffusion/comments/1x988ph/jsonbbox_wf_for_moss/) include a user reporting Pixaroma's Flux3-labeled editor can feed JSON into MOSS-Image Layout Prompt. Treat this as a compatibility lead requiring schema/coordinate inspection, not proof that arbitrary Flux/Ideogram JSON is interchangeable. A separate user links their custom editor; there is no OP-confirmed result in the opened page.

New related-post leads: a100-plus-rat hybrid MOSS/Flux showcase and a later Fizgig8.8.1 training-technique announcement. Four-step Krea/MOSS comparison was revisited; it is already covered above.

## Fortieth continuation: trainer previews can hide inference differences

[Fizgig8.8.1 author update](https://www.reddit.com/r/StableDiffusion/comments/1xazk0f/fizgig_881_a_new_mossimage_training_technique/) adds an inference-relevant preview distinction: Base previews may optionally apply an SFT-like look without loading SFT itself. The author explicitly says this is approximate and recommends leaving Turbo off for previews; enlarged previews label Base/SFT/look/Turbo status. Thus a trainer sample and ComfyUI output may differ even at the same character checkpoint. Record preview mode and actual inference model/adapter stack before diagnosing failed likeness. Reports of improvement after updating ComfyUI are second-hand and no specific patch is identified. The new low-noise training schedule was tuned on limited datasets; it is training configuration, not a sampler recommendation.

The already-recorded hybrid rat showcase was revisited through [a direct comment page](https://www.reddit.com/r/StableDiffusion/comments/1xcwlz7/comment/19ri7ptiy5wyr/). No new stage-isolation or verified counting result appears. [Linked Civitai post](https://civitai.red/posts/31836590) loads a gallery shell but does not expose the workflow/prompt metadata in the retrieved text. Keep full graph inspection outstanding; do not invent a one-step Flux handoff procedure from the title.

New follow-up lead from the rat thread: “How do I make MOSS-Image-SFT (INT8) faster like8steps?” Inspect actual replies for missing adapter/setup details.

## Forty-first continuation: AMD speed troubleshooting has an unresolved OP follow-up

[RX6600 speed thread](https://www.reddit.com/r/StableDiffusion/comments/1xau496/how_do_i_make_mossimagesft_int8_faster_like_8/) reports ROCm/Comfy with sharply rising times approaching1MP. [Direct reply page](https://www.reddit.com/r/StableDiffusion/comments/1xau496/comment/19re9jrdvxycj/) recovers OP's later report: an eight-step adapter at10steps/strength0.8 still takes about300seconds. Thus simply recommending Turbo did not establish a successful repair. Exact adapter/precision/backend versions and memory behavior are missing; a memory threshold is plausible, not demonstrated.

A9070XT user reports~34seconds for50steps/1MP and under4seconds with eight-step Turbo; this counters NVIDIA-only compatibility claims but lacks full configuration. The proposed RDNA2-specific comfyui-rocm fork has no OP-confirmed test here. A3090 user's1.9second three-step experiment is followed by their admission they normally prefer8–12steps/higher resolution for quality. Their projected5090time is extrapolation, not measurement; another5090 user independently reports10–11seconds at1024²/50steps/CFG3. None forms a matched cross-GPU benchmark.

New follow-up leads: model-file-size question and SFTshowcasep2, surfaced on the direct-comment page.

## Forty-second continuation: custom AMD kernels qualify quantization advice

Later replies in [the model-size discussion](https://www.reddit.com/r/StableDiffusion/comments/1x96c4z/which_moss_image_should_i_get_the_5gb_or_9gb_one/) qualify the recorded7800XT owner's Q8/BF16 speed equivalence: they used a custom kernel and dynamic-VRAM changes, not a stock ComfyUI install. No published implementation was linked in that reply. Another7900XT/Linux user reports INT8 faster, while6900XT feedback contradicts a broad RDNA2 speedup claim. Hardware generation alone cannot select the fastest format without backend/kernel details. The discussion's claim that diffusion-model file size guarantees fitting in nominal VRAM ignores other runtime allocations; preserve measured workflow memory rather than infer fit from download size.

[MOSS→F3K upscale suggestion](https://www.reddit.com/r/StableDiffusion/comments/1xa6rbd/dont_sleep_on_the_moss_t2i_f3k_edit_upscale/) explicitly describes a general idea, not a supplied workflow: use a completed MOSS image as an edit input to a higher-resolution editor. No exact resolution, steps, edit prompt, identity-preservation test or independent comment validation is exposed. This is different from the34+1shared-latent hybrid and from ordinary resize/upscale nodes. Keep any resulting detail or preservation claims attributed to the whole two-model pipeline.

Revisited iteration-speed thread and SFTshowcasep2; existing notes already cover recovered speed data. No new controlled precision comparison emerged.

## Further search queue

1. Investigate direct reports of late-stage black output; no fix is established by the AMA. Positional encoding and encoder precision need separate sources; no corresponding answered AMA claim was found.
2. Find independent user results for color-depth control and RoPE scaling; establish exact settings and limitations.
3. Inspect editing v3 workflow and native edit support, including failures and fixes.
4. Investigate Apple-specific implementation reports; avoid extrapolated GPU timings.
5. Search dedicated negative-prompt, typography, multi-panel, counting, and layout troubleshooting posts.
6. Seek named AMD GPU, backend, and quantization details; generic AMD speed claims are not comparable.
7. Preserve direct comment permalinks when available and maintain separation between first-hand reports and speculative replies.
