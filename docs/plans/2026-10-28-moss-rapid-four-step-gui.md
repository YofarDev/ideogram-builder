# Rapid β: four-step MOSS generation in the GUI

Date: 2026-10-28. Starting revision: `4c9f537`.

Goal: make **Modal → MOSS → Rapid β** a working four-step choice in the
existing GUI, initially at **≤1,048,576 pixels**, with explicit experimental
status until its quality and performance have been evaluated.

This is an implementation plan. Writing it does not enable Rapid, change the
local endpoint, download weights, or start GPU jobs.

## Starting evidence

Already implemented:

- `Rapid` preset: Euler / simple, four steps at ≤1 MP, CFG 1, no SLG, one
  `rapid4` adapter before user LoRAs. The workflow builder already supports it.
- Pinned v2.0 adapter, revision and SHA-256 in `runpod/moss-models.json`;
  approximately 1.19 GB, populated onto the `moss-models` volume.
- Candidate model paths registered before startup and checked against the
  running ComfyUI loader choices.
- Hidden Rapid radio control and capability-aware frontend selection.
- Benchmark execution, images, exact graphs, runtime artifacts and stage timings.

Confirmed deployment:

- Workspace `yofarcorp`, app `ideogram-builder`, RTX PRO 6000 Blackwell 96 GB.
- Active endpoint: `https://yofarcorp--ideogram-builder-web-app.us-east.modal.run/generate`.
- A fresh authenticated capabilities check still lists only Fast, Quality and Turbo.
- Last real runtime: Python 3.12.3; Torch 2.10.0+cu128; ComfyUI
  `7cebca52227c63b4180ceed448cbd7ad22903b6d`; CUDA kitchen backend disabled by
  ComfyUI's policy. The eager path successfully generated a Turbo image.
- Last smoke: one 1024² Turbo image, seed 101; 37.6 s submission-to-result,
  17.98 s worker total and 6.73 s observed sampler wall time. This is one
  first-use observation, not a benchmark or a Rapid performance estimate.

Gaps that matter for this rollout:

1. Existing Rapid-capable profiles also select high-VRAM residency and require
   CUDA 13. None enables Rapid on the current baseline configuration alone.
2. Unvalidated presets are intentionally hidden by capabilities. There is no
   explicit experimental-preview advertisement path.
3. The existing Rapid area policy increases to six/eight steps at larger sizes.
   V1 needs its own hard 1 MP limit, independent of promotion status.
4. GUI submission checks preset availability but not its advertised pixel limit.
5. Live telemetry reported `worker_instance_id="modal"`; that is not a unique
   worker identity for cross-container comparisons.
6. Worker Dockerfiles share a context containing runtime sources. A small
   source change can invalidate heavy image builds; the last full deploy took
   2,810.7 s. Reuse existing immutable images and overlay the changed runtime.

## Decisions for v1

| Setting | Decision |
| --- | --- |
| GUI label | Rapid β; description: “4 steps · experimental · up to 1 MP” |
| Sampling | Exactly 4 steps, CFG 1, Euler / simple |
| Adapter | Pinned `moss_image_sft_4step_v2.0.safetensors`, strength 1.0 |
| Maximum area | 1,048,576 pixels; existing multiple-of-16 dimension rule |
| First runtime | Current CUDA 12.8 baseline software and auto memory mode |
| First model formats | Existing INT8 convrot DiT + W4A8 encoder |
| First exposure | Authenticated candidate app, explicit experimental opt-in |
| Promotion | Per-preset, only the tested 1 MP bucket |
| Unsupported canvas | Clear error; keep the selected recipe and dimensions |
| Other experiments | No Draft, Spectrum, compilation, snapshots or CUDA upgrade in this change |

The INT8 combination is an experiment. The author's documented reference uses a
BF16 base and INT8 encoder; the model card also warns that ordinary LoRA casting
can affect fine text and supplies a merged FP32 checkpoint. Test the existing
formats first to isolate the recipe change, then use a reference configuration
if precision or adapter compatibility is questionable. Do not assume halving
steps halves complete request latency.

Pinned source, checked during planning:
[author model card](https://huggingface.co/akhaliq/MOSS-Image-SFT-4-steps/blob/2ded95c37a029360245926fe72e475e30039bbfb/README.md).

## 1. Make candidate deployment reuse the existing weights

Files: `runpod/modal_app.py`, worker image definitions, `.dockerignore`,
`runpod/test_modal_moss_lifecycle.py`.

- [ ] Separate immutable model/runtime-dependency images from the small source
  overlay. Use Modal's `Image.from_id(...)` with `add_local_file(..., copy=True)`
  for the changed Python modules, templates, manifests and custom node.
- [ ] Record workspace, source revision, image IDs, ComfyUI/model pins and build
  selection in a non-secret deployment manifest. Verify IDs exist in `yofarcorp`;
  do not hard-code workspace-specific IDs into ordinary source defaults.
- [ ] The previous build recorded MOSS image `im-C6CYVuLZL3PDP7CmANZGPp` before
  deployment env layering, and Ideogram image `im-jAh6cs2wwMnYugf5Zhz6Qs`.
  Verify their provenance before reuse. Their old runtime files must be
  overwritten by the complete new overlay, not allowed to shadow it.
- [ ] Apply a separate narrow source allow-list to each worker. MOSS-only
  changes must not invalidate the Ideogram weight image. Shared handler changes
  must be overlaid on both workers when needed.
- [ ] Propagate frozen image/profile selection to GPU containers and CPU proxy
  imports. Keep a reproducible full-build path for dependency/model changes;
  fail clearly when a requested cached image is unavailable.
- [ ] Test COPY/overlay coverage, private-file exclusion and matching effective
  configuration in the proxy, parent handler and ComfyUI child.

Done when: a source-only candidate deploy reuses the verified model images,
includes the new sources, and performs no multi-GB baseline model downloads.

## 2. Define a Rapid-only candidate profile and a real 1 MP limit

Files: `runpod/moss_config.py`, `runpod/moss_workflow.py`,
`runpod/handler.py`, related configuration/workflow tests.

- [ ] Add an immutable profile, suggested ID `rapid-auto-int8-cu128`, with the
  current baseline formats/residency, no compilation or startup warmup, and
  technical support for Fast, Quality, Turbo and Rapid only.
- [ ] Mark it candidate. Explicitly tolerate the already-observed eager kernel
  path for this profile, as baseline does. Preserve the CUDA 13 gate on every
  existing accelerated profile; never report this candidate as accelerated.
- [ ] Add per-preset technical area limits, including `Rapid: 1`, separate from
  `validated_presets`. Enforce the limit for preview and benchmark requests too.
  Larger-resolution Rapid trials require a separate declared profile later.
- [ ] Keep the baseline profile and the three existing sampling recipes intact.
- [ ] Verify graph topology: one Rapid adapter, strength 1, no DMD8 stacking,
  no SLG, four actual sampler steps. Keep metadata consistent with execution.
- [ ] Cover exact 1 MP, a smaller rectangular canvas, just over the area limit,
  invalid dimensions, unknown/disabled presets and repeated preset switches.

Done when: the production baseline still advertises its original three
presets, while the candidate can execute a precisely defined four-step recipe.

## 3. Populate and verify only the required Rapid asset

Files: `runpod/moss_assets.py`, manifest and maintenance entrypoint.

- [ ] Use the CPU maintenance entrypoint with `--keys adapter_rapid4` only.
  Preserve the pinned revision and SHA-256; never use floating `main` or
  download model files inside an image-generation request.
- [ ] Verify the file hash after population and commit the volume.
- [ ] Start the candidate with the dedicated extra-path config; confirm
  `LoraLoaderModelOnly` lists `moss/control/moss_sft_4step_v2.0.safetensors`.
- [ ] Confirm actual loading has no unexplained missing projection/LoRA keys.
  A completed four-step image without the adapter applied is a failed test.
- [ ] Ensure missing/corrupt assets fail with the exact asset name and recovery
  command rather than returning an apparently successful unadapted image.

Recovery branch: if quantized-base patching fails or fine text degrades, test
BF16 DiT + INT8 encoder on a separately named reference profile, with its own
truthful CUDA 12.8 fallback requirements. Populate those two weights only then.
Use the merged FP32 DiT for targeted text/numeric comparisons when necessary;
verify actual loaded/compute dtype before calling it an FP32 precision test.
It is a complete diffusion checkpoint and must bypass the separate Rapid LoRA.
A reference-format winner requires a new explicit profile and a repeated smoke.

Done when: the exact pinned adapter is visible and demonstrably applied.

## 4. Make a working experimental Rapid option visible in the GUI

Files: `runpod/moss_config.py`, `runpod/modal_app.py`, `src/moss-presets.js`,
`src/settings-moss.js`, `src/queue.js`, `index.html`, frontend tests.

- [ ] Add an explicit experimental allow-list, e.g.
  `MOSS_EXPERIMENTAL_PRESETS=Rapid`, default empty. Parse/validate it and freeze
  it into both GPU and proxy environments.
- [ ] Advertise the intersection of technical support, enabled presets and
  either validated recipes or explicit experimental opt-in. Mark experimental
  entries with an additive `validation_status="experimental"` and
  `max_area_mp=1`; do not pretend they passed `validated_presets`.
- [ ] Keep validated advertisement behavior backward compatible. Use the same
  availability calculation for server request validation and capabilities;
  internal benchmark mode can explicitly execute technical candidates.
- [ ] Reveal the existing Rapid control when advertised. Display its four-step,
  experimental and 1 MP constraints; remove the unproven “fastest final-quality”
  wording from local fallback copy.
- [ ] Validate the actual submitted preset/dimensions against capabilities at
  enqueue/dispatch, not unrelated current editor state. On oversize requests,
  show the requested area and supported limit; do not resize or switch preset.
- [ ] Keep availability synchronized on canvas/backend/config changes. Preserve
  saved Rapid recipes when switching to an unsupported endpoint, but block
  submission until the user selects a supported option.
- [ ] Cover Modal → RunPod transitions, stale capabilities, absent capability
  endpoints, restored sessions and gallery metadata, and queue snapshots whose
  canvas differs from the currently edited canvas.

**Milestone A:** on the candidate endpoint, the user can select
**Modal → MOSS → Rapid β**, generate a real four-step image, and understand
that quality validation is ongoing. The production endpoint remains unchanged.

## 5. Run a bounded smoke before a large comparison

Deployment: authenticated `ideogram-builder-rapid-preview` app in `yofarcorp`,
RTX PRO 6000, minimum GPU containers zero, snapshots/compile/warmup off.

- [ ] Run Rapid and Turbo on English poster, Chinese poster and small-numbers
  fixtures at 1024² with seed 101: six measured images, with warmups recorded
  separately. Stop on an OOM or repeated failures; initial wall budget 10 min.
- [ ] Verify image dimensions, seed, `preset_id=Rapid`, `effective_steps=4`,
  CFG 1, correct profile/manifest/adapter and complete stage timing traces.
- [ ] Exercise Turbo → Rapid → Turbo → Rapid on the same worker. Inspect
  graphs/logs to verify adapter replacement and absence of accumulated patches.
- [ ] Test an oversized request: clear rejection and no queued ComfyUI prompt.
- [ ] Check API authentication, candidate capabilities and the actual GUI
  radio/queue/result flow. Visually inspect the output instead of treating the
  existence of PNG bytes as quality evidence.
- [ ] After smoke passes, temporarily point the local GUI at the preview app
  for the user's experimental testing; retain the production URL for rollback.

Done when: Milestone A is demonstrated through the GUI, not just dry-run output.

## 6. Measure whether Rapid earns promotion

Files: `runpod/moss_benchmark.py`, `runpod/moss_benchmark_worker.py`,
`runpod/comfy_metrics.py`, `runpod/handler.py`, runtime identity and tests.

Measurement fixes before comparing:

- [ ] Generate a unique worker-instance ID at actual server startup. Keep it
  stable across that worker's jobs and change it on a real worker restart.
  Do not group different Modal workers under the hostname string `modal`.
- [ ] Capture package versions using installed distribution metadata when a
  module lacks `__version__`; the live kitchen version currently says unknown.
- [ ] Persist warmup/first-use observations separately rather than discarding
  their cost. Record actual image/profile identity, source revision and assets.
- [ ] Counterbalance preset order across seeds, retain same-preset steady-state
  runs, and report preset-switch costs separately. Compare paired workloads;
  never compare one preset's cold request with another's warmed request.
- [ ] In fresh-prompt runs, use a unique encoder-node input key per measured
  request, including across presets, while preserving the parsed JSON layout.
  Verify the positive encoder really executed. In cached-prompt runs, keep its
  input identical, warm the prompt, and verify actual positive-node cache hits.

Main comparison:

1. Twelve existing fixtures × three paired seeds × Rapid/Turbo/Fast =
   **108 measured images**. Override every fixture to 1024² so the v1 Rapid
   limit is respected; normalize layouts using the existing fixture compiler.
2. Separate warmups from those 108 and include them in the run's job/time
   estimate. Stop submitting new jobs after 45 minutes; existing timeout and
   interrupt behavior can overrun this budget and must not be called a hard
   billing cap.
3. Compare warm worker total, sampler, encoding, decode, HTTP completion delay,
   sampled device-wide VRAM, failures and visible usable-image rate.
4. If representative of usage, run the cached-prompt case for Rapid/Turbo:
   another 72 measured images. Keep it separate from new-prompt statistics.
5. Validate no/one/multiple representative user LoRAs and rectangular shapes
   under 1 MP. These are additional compatibility observations, not folded into
   the main fixed-size latency median.

Quality evidence: save a review sheet beside run artifacts with expected text,
observed transcription, numeric errors, layout and faces/hands/naturalness.
Compute character error rate from actual OCR or manual transcriptions. Compute
region IoU only when observed regions were actually annotated; otherwise mark
it unmeasured. Do not infer either score from generation success or an LLM's
unstructured impression. Any external OCR dependency needs a recorded version.

Promotion gates, proposed defaults:

- No unexplained adapter-key loss, corruption, OOM or preset-switch leakage.
- At least 10% **and** 250 ms lower paired warm worker-total median than Turbo,
  consistently across repeated samples; retain per-fixture results so one easy
  prompt cannot hide a regression. This is a rollout target, not a promised gain.
- Text CER increase ≤1 percentage point; layout IoU decrease ≤0.02 when
  measured; usable-image pass-rate decrease ≤5 percentage points; no material
  visual regression on important text/numbers or faces/hands.
- Missing quality evidence means experimental status remains. No p95 claim
  from this small suite. If the gain disappears in complete request latency,
  report that outcome rather than presenting sampler-only savings as the win.

## 7. Promote, deploy and prove the production GUI path

- [ ] If the gates pass, mark the exact winning profile validated and add only
  `Rapid: 1` to its `validated_presets`. Remove the preview-only experimental
  opt-in for that recipe. Other candidates remain hidden.
- [ ] Deploy the winning image/profile to `ideogram-builder`; keep the original
  Fast/Quality/Turbo sampling behavior and retain baseline for rollback. If a
  precision-reference profile wins, assess those existing presets on it before
  serving them; use a separate Rapid worker/route if they cannot retain their
  original behavior.
- [ ] Restore/update the local production URL as needed and refresh capabilities.
- [ ] Verify production `/capabilities` includes Rapid with the correct limit,
  then generate one Rapid image from the real GUI. Verify the saved gallery
  recipe and restore it; also run one existing preset as a regression smoke.
- [ ] Save the result in a dated acceptance report: deployed commit/image/profile,
  artifact location, exact GUI label, pixel limit, measured latency/quality,
  remaining caveats and baseline rollback command. Commit/push implementation
  and report; confirm deployment corresponds to the intended code revision.

Rollback: deploy the retained baseline image/profile, disable experimental
advertisement and restore the known production endpoint. Candidate controls
must disappear after capability refresh; saved recipes remain intact. Leave
failed candidates and their artifacts available for investigation.

**Milestone B / definition of done:** Rapid is selectable in the production
GUI, returns a verified four-step image at supported sizes, and has recorded
speed/quality evidence. A deployed code change with Rapid still hidden is not
a completed implementation of this plan.

## Suggested implementation commits

1. Reuse immutable model images and isolate small runtime overlays.
2. Add the baseline-compatible Rapid profile, strict 1 MP gate and graph tests.
3. Add explicit experimental capabilities and GUI dimension/queue guards.
4. Fix benchmark identity/cache controls and capture acceptance artifacts.
5. Promote only the winning recipe, deploy, and document GUI verification.

Existing broader optimization plan remains a separate workstream. CUDA 13,
residency changes, larger Rapid buckets and other accelerators can be evaluated
later against the same four-step recipe, one change at a time.
