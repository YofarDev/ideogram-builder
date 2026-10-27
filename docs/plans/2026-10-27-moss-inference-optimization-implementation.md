# MOSS inference optimization implementation plan

Date: 27 October 2026

Target: native ComfyUI on Modal, NVIDIA RTX PRO 6000 with 96 GB VRAM.

Status: implementation plan. No application changes or deployment are performed by this document.

Research: [MOSS inference optimization findings](../research/2026-10-27-moss-inference-optimization.md).

## Outcome and approach

Reduce time from Generate to a usable image while preserving text accuracy, layout control, existing sessions and user LoRAs. Implement each promising optimization as a measurable option. Promote configurations after comparing them on the actual Modal GPU.

The work covers runtime/kernel verification, reproducible benchmarks, GPU residency, DiT/text-encoder precision, four-step and three-step adapters, Spectrum, compilation and persistent caches, cold starts, optional snapshots, result polling, metadata, regression checks and rollout.

Published speedups are reference evidence. They are not performance commitments for this deployment, and their factors must not be multiplied together.

## Existing behavior to preserve

| API preset | Steps / CFG | Sampler / scheduler | Guidance / adapter |
| --- | --- | --- | --- |
| `Fast` | 25 / 2.5 | er_sde / simple | Layer 22 simple SLG, 0–0.5 |
| `Quality` | 50 / 3 | euler / simple | Layer 22 simple SLG, 0–1 |
| `Turbo` | 8 / 1 | euler / simple | lodestones DMD at strength 1; no SLG |

These names retain their sampling semantics. New presets are additive. Fast remains the initial UI default. Runtime changes that alter numeric behavior are recorded in result metadata.

MOSS worker settings must be separate from the shared Ideogram worker: GPU selection, launch arguments, memory policy, models, warmup and snapshots. Keep the shared request/response shape compatible with both Modal and RunPod. New presets initially target the optimized Modal deployment; old RunPod endpoints continue to advertise/support only their existing presets.

## Design decisions

### Separate deployment choices from generation choices

Deployment configuration controls installed dependencies, model files, residency, compilation and container lifetime. A generation request selects an advertised preset and supplies the current prompt, dimensions, seed and user LoRAs.

Use small, validated server-side configurations rather than adding all runtime experiments to the image-generation UI. Add a benchmark-only profile selector to the benchmark entrypoint, not unrestricted loader filenames or launch arguments to the public generation payload.

Proposed deployment settings:

| Setting | Initial behavior | Candidate values |
| --- | --- | --- |
| `MOSS_GPU` | Existing GPU setting as fallback | RTX-PRO-6000 |
| `MOSS_RUNTIME_PROFILE` | `baseline` until validated | Named, immutable profile IDs |
| `MOSS_MEMORY_MODE` | `auto` | auto, highvram, gpu_only |
| `MOSS_DIT_FORMAT` | int8_convrot | int8_convrot, bf16 |
| `MOSS_ENCODER_FORMAT` | w4a8 | w4a8, int8_convrot, bf16 |
| `MOSS_COMPILE_BACKEND` | off | off, inductor, cudagraphs |
| `MOSS_WARMUP` | false | false, true |
| `MOSS_MIN_CONTAINERS` | 0 | 0 or 1 initially |
| `MOSS_SCALEDOWN_SECONDS` | 300 | 300, 600, 1200 for comparison |
| `MOSS_SNAPSHOT_MODE` | off | off, gpu_experimental |

Validate combinations once at startup. Use an explicit mapping from format names to pinned model assets. A named profile captures the complete effective configuration; do not permit conflicting overrides to produce an undocumented profile.

### Keep reproducible assets and a simple model graph

Create a model/dependency manifest with repository revision, filenames, content hashes, license identifiers and intended role for each asset. Pin the existing eight-step adapter too: its current download follows a mutable `main` revision.

Use the present graph as the starting point, with small Python helpers for optional adapters, guidance and acceleration. Avoid copying an entire workflow JSON for every combination. Keep input/output node IDs stable where practical for telemetry, and maintain an explicit node-to-stage map.

Proposed model path:

`DiT loader → distillation adapter, if any → user LoRAs → SLG, if any → Spectrum, if any → explicit compilation, if validated → KSampler → VAE decode → save`

This is the initial insertion order to validate. Compilation and Spectrum must pass independent tests before their combination is exposed; the order is not assumed compatible merely because every node accepts a MODEL.

## Phase 0 — Locate the deployment and capture a baseline

**Deliverables:** a deployment identity record, runtime manifest and baseline images/timings.

- [ ] Resolve the correct Modal profile, workspace, environment, app and deployed revision. The previous read-only lookup could not find `ideogram-builder` in the current CLI environment. Inspect existing app/configuration metadata before requesting missing information.
- [ ] Record the current image/build identifier and keep a recoverable baseline deployment configuration.
- [ ] Inside the MOSS ComfyUI process environment, capture Python, torch, `torch.version.cuda`, torchvision, torchaudio if installed, Triton, comfy-kitchen, ComfyUI commit, rgthree revision, GPU name/capability and driver version.
- [ ] Retain ComfyUI startup logs showing enabled backends and fallback warnings. `nvidia-smi` alone cannot establish the CUDA build used by torch.
- [ ] Run current Fast, Quality and Turbo with fixed fixtures and seeds; separate a fresh-container request from warm requests.
- [ ] Record actual host CPU/RAM allocations and GPU memory use. Treat the current package/runtime mismatch as a hypothesis until the deployed process confirms it.

The deployment baseline is authoritative if it differs from the checkout. Document the difference before changing either.

## Phase 1 — Add useful timing and benchmark infrastructure

**Files:** `runpod/handler.py`, `runpod/modal_app.py`; new `runpod/comfy_metrics.py`, `runpod/moss_benchmark.py`, `runpod/benchmarks/moss/fixtures.json`, and benchmark tests.

### Timing contract

- [ ] Use monotonic clocks for durations within each process. Give every result a request ID, ComfyUI prompt ID, worker-instance ID, profile ID and first-generation-in-worker flag.
- [ ] Capture handler validation/LoRA preparation, ComfyUI queue wait, observed node execution intervals, history/image fetch and response encoding.
- [ ] Map text encoding, KSampler, VAE decode and SaveImage to their observed node intervals. Retain separate loader intervals where emitted.
- [ ] Consume `execution_cached` events. Mark reused nodes as cached; do not claim their cost was measured as zero. Filter all events by the correct prompt ID.
- [ ] Treat WebSocket-derived intervals as observed wall-clock estimates, not CUDA-kernel timings. After a reconnect, mark incomplete intervals unavailable instead of fabricating durations.
- [ ] Sample GPU memory through NVML for benchmark runs. Label device/process sampled peaks correctly. Collect allocator peaks only through instrumentation inside the ComfyUI GPU process; the parent Modal process cannot report a child's torch allocator peak.
- [ ] Use a short profiler run only when stage timings cannot explain a bottleneck. Synchronization/profiler overhead stays outside normal production measurements.
- [ ] Retain partial metrics for failed jobs without allowing metrics collection to break successful image generation.

Add optional response fields alongside existing `images` and `seed`:

```json
{
  "metrics": {
    "schema_version": 1,
    "worker_total_ms": 0,
    "comfy_queue_ms": null,
    "observed_node_wall_ms": {},
    "cached_node_ids": [],
    "measurement_complete": true
  },
  "generation": {
    "runtime_profile": "baseline",
    "preset": "Turbo",
    "effective_steps": 8,
    "cfg": 1,
    "sampler": "euler",
    "scheduler": "simple",
    "model_manifest_id": "resolved-manifest-id",
    "first_generation_in_worker": false
  }
}
```

Numbers above illustrate the schema, not measurements. Missing measurements use `null` or absent fields. Attach runtime details once per profile/worker in benchmark artifacts rather than repeating a large package listing with every image.

Record Modal submission-to-worker delays separately through available platform invocation timestamps. If an accurate queue duration is unavailable, report submit-to-result latency and worker time independently. Do not subtract clocks on different machines and present the remainder as exact queue time.

### Benchmark runner

- [ ] Support authenticated Modal HTTP runs and an internal Modal entrypoint calling the same MOSS workflow builder. Reuse the production image and request path wherever possible.
- [ ] Accept profile, preset, fixture IDs, seed list, resolutions, output folder and request/time limits. Include a dry-run that lists jobs and assets before GPU work.
- [ ] Save JSONL results, a summarized Markdown comparison, generated images and effective workflow/runtime manifests. Exclude base64 image bodies from timing summaries.
- [ ] Keep concurrency at one initially. Verify repeated jobs use the intended worker ID; split results when Modal schedules a different worker.
- [ ] Distinguish new-prompt, cached-prompt and fresh-worker cases. Use changing seeds to avoid caching the complete image result.
- [ ] Start with three representative fixtures × five seeds per screened configuration, plus a warmup. Shortlist before running the full quality suite.
- [ ] Add maximum jobs and elapsed-time controls; stop a run early on repeated errors, OOM or a clear performance regression. Save progress on interruption.

Fixtures cover English posters, Chinese text, bilingual menus, small numbers, dense JSON layouts, multiple subjects, hands, illustrations and natural photos. Supply expected text and boxes for relevant fixtures. Use actual layout JSON and the project's coordinate conventions.

**Gate:** produce a repeatable baseline with interpretable stage timings and cached-node handling before assessing optimization gains.

## Phase 2 — Make the accelerated runtime reproducible

**Files:** `runpod/Dockerfile.moss`; new `runpod/moss-runtime.lock.json`, runtime-check helper and asset manifest; MOSS startup in `runpod/modal_app.py`.

- [ ] Build a separate candidate runtime with a stable cu130-or-newer PyTorch wheel set compatible with Python 3.12, the pinned ComfyUI and comfy-kitchen. Resolve and freeze exact package versions as part of this phase; do not use floating production installs.
- [ ] Install a matched torch/torchvision/torchaudio set where applicable. Check dependency consistency with `pip check`, import checks and a real GPU execution.
- [ ] If replacing wheels within the current base leaves incompatible compiled extensions, use a CUDA 13 worker base and explicitly preserve the required RunPod startup contract. Decide from import/kernel checks, not the CUDA label on the image.
- [ ] Start with the existing ComfyUI commit to isolate runtime effects. Pin rgthree and required kernel packages as well.
- [ ] Confirm the actual enabled comfy-kitchen CUDA path, model load and representative quantized operations. A backend listed as installed is insufficient evidence that the relevant operations used it.
- [ ] Test the opt-in Triton backend as a separate profile if needed. Do not enable every experimental `--fast` option.
- [ ] Add a startup diagnostic mode and a readable failure for an optimized profile that cannot meet its declared runtime requirements. Keep an explicitly named baseline/fallback profile available for comparison.
- [ ] Compare current Fast, Quality and Turbo without changing precision or sampler settings.

Only after this comparison, test a separately pinned ComfyUI v0.43.0 candidate. Record its memory and compatibility effects independently; do not credit an unrelated dependency upgrade with all runtime gains.

**Gate:** no unexplained kernel fallback, all three original presets work, and text/layout quality passes the infrastructure-change criteria below.

## Phase 3 — Benchmark residency and model precision

**Files:** MOSS worker configuration in `runpod/modal_app.py`; workflow loader selection; new `runpod/moss_assets.py`, `runpod/moss-models.json`, and optional `runpod/extra_model_paths.moss.yaml`.

- [ ] Add BF16 DiT and INT8/BF16 encoder candidates to the pinned asset manifest. Keep the current small VAE fixed initially.
- [ ] Put optional benchmark model files on a dedicated Modal weights volume mounted outside the user-LoRA directory, such as `/moss-models`. Load its paths through ComfyUI's extra-model-path configuration. Preserve the current user-LoRA volume mount.
- [ ] Populate the volume with a CPU-only maintenance entrypoint, verify content hashes, and make generation startup fail clearly when a requested asset is absent. Avoid downloading large candidates during a user request.
- [ ] Keep the initial production asset set small. Once a profile wins, package only its required assets or select a documented pre-populated volume pack.
- [ ] Compare `auto`, `--highvram`, and `--gpu-only` independently using the existing quantized models. Never combine the mutually exclusive residency flags.
- [ ] With the selected memory policy, compare INT8 and BF16 DiT while keeping encoder/VAE constant.
- [ ] With the selected DiT, compare W4A8, INT8 and BF16 encoders on uncached short and long prompts. Include a small cross-check of the runner-up combination to catch format/residency interactions.
- [ ] Use profiler evidence to investigate transfers or low utilization. Change CPU/RAM resources only if loading, encoding or serialization is constrained, and record the resource change as another profile.
- [ ] Verify a typical user-LoRA configuration fits with adequate VRAM headroom. Do not select a profile based only on a no-LoRA image.

**Gate:** select a measured residency/precision combination with stable long-prompt and LoRA behavior. Retain the runner-up and baseline for later adapter comparisons.

## Phase 4 — Add separate Rapid and Draft presets

**Files:** MOSS preset/workflow helpers, Docker/asset manifest, `runpod/test_handler_moss.py`; frontend and metadata work in Phase 10.

Use API IDs `Rapid` and `Draft3`. Keep `Turbo` as the existing eight-step preset. Initial UI labels are `Rapid β` and `Draft β`; step counts appear in their description/result metadata.

- [ ] Pin the Euler-native akhaliq four-step release and its exact LoRA file/revision. Import its documented BF16 configuration as the first reference implementation.
- [ ] Add a separate control-adapter slot before user LoRAs. Never stack the four-step and eight-step distillation adapters.
- [ ] Configure Rapid with CFG 1, Euler/simple, no SLG, adapter strength 1. Preserve the default native shift convention.
- [ ] Initially support Rapid at up to 1024×1024 total pixels with four steps. Validate a proposed area-based high-resolution policy of six steps up to roughly two megapixels and eight steps up to four megapixels. These boundaries are a project policy to test, not a universal guarantee from the adapter author.
- [ ] Advertise higher-resolution Rapid support only after that resolution bucket passes. Before then, return an actionable unsupported-size error; do not silently resize a layout.
- [ ] Add the separately trained three-step adapter as Draft3 with exactly three steps and a one-megapixel initial limit. Do not obtain Draft3 by simply running the four-step LoRA for three steps.
- [ ] Test fine-text precision against the author's documented loader and FP32 reference where necessary. Do not assume a BF16-merged or INT8 version preserves adapter deltas.
- [ ] Compare Rapid against current Turbo and Fast; use Quality as an additional visual reference. Compare Draft3 against Rapid.
- [ ] Test no user LoRA, one user LoRA and a typical multi-LoRA combination, including consecutive requests switching presets. Record unsupported combinations honestly.
- [ ] Ignore neither negative-prompt semantics nor effective settings: CFG-1 results should record that negative guidance was inactive. Retain cached conditioning behavior; consider removing redundant negative encoding only if timing shows a material cost and equivalence is demonstrated.

**Gate:** Rapid passes text/layout criteria and improves usable-image latency. Draft remains an explicitly lower-quality preview option if it passes its own review; it does not replace a final-quality preset.

## Phase 5 — Add Spectrum to the longer presets

**Files:** pinned Spectrum install in `runpod/Dockerfile.moss`; workflow helpers and tests.

- [ ] Pin ComfyUI-Spectrum-MOSS v0.8.1 to its resolved commit and include its version/license in the dependency manifest.
- [ ] Add API presets `FastSpectrum` and `QualitySpectrum`, displayed as `Fast+ β` and `Quality+ β` only after validation. Their sampler and step counts remain aligned with Fast and Quality respectively.
- [ ] Start with the Manual node for a reproducible policy: eight warmup steps, one actual tail step, GPU-resident cache and the release's remaining conservative defaults. For ER-SDE, set the documented maximum of one consecutive forecast.
- [ ] Compare three Fast cases: original SLG range without Spectrum; full SLG range without Spectrum; full SLG range with Spectrum. This isolates the guidance change from feature forecasting.
- [ ] Compare Quality with and without Spectrum at its existing full SLG range.
- [ ] Capture forecast/actual evaluation counts from the extension's debug output in benchmark mode. An installed node with zero forecasts is not an acceleration result.
- [ ] Check node schema through `/object_info` and validate the built graph before queuing a job. Missing nodes or mismatched inputs produce an explicit capability/configuration error.
- [ ] Test fixed-seed text, box adherence, faces/hands, user LoRAs, alternating presets and error recovery. Ensure forecast state cannot leak across generations.
- [ ] Evaluate Adaptive mode only after a stable Manual result. Give it a separate benchmark profile and pin all its settings.

Do not enable Spectrum by default on Turbo, Rapid or Draft3. Any reduced-warmup few-step experiment remains internal until there is measured extra speed and acceptable quality.

**Gate:** acceleration is visible in actual evaluation counts and warm usable-image latency, with the appropriate quality checks passing.

## Phase 6 — Test explicit compilation and persistent caches

**Files:** optional compile insertion in workflow helpers; Modal cache-volume and environment configuration.

- [ ] Record the behavior of the existing native Comfy compiler first. Label comparison profiles accurately.
- [ ] Use the built-in TorchCompileModel node to compare off/current behavior, Inductor and CUDA-graphs backends independently on a proven residency/model configuration.
- [ ] Start with fixed 1024×1024 inputs and no user LoRA. Then test long prompts, supported aspect ratios, model/preset switching and user-LoRA changes.
- [ ] Record initial compile time, warm latency, recompile events, memory peak and failed captures. Exclude compilation from warm inference numbers, but include it in cold-start/session economics.
- [ ] Mount a dedicated compiler cache volume. Namespace caches by GPU architecture, torch/Triton versions, ComfyUI/profile identity and relevant model/adapter configuration. Set `TORCHINDUCTOR_CACHE_DIR` and the installed Triton version's supported cache directory.
- [ ] Verify cache reuse on a new container. Coordinate population so concurrent fresh workers do not corrupt/shared-write an incomplete cache; commit completed artifacts through the volume lifecycle.
- [ ] Compute break-even requests per container: `additional startup cost / warm saving per request`. Retain compilation only where the expected session length exceeds break-even.
- [ ] Test Spectrum plus the winning compiler backend last. If graph breaks, captures or numerical behavior are unreliable, advertise them as separate validated alternatives.

**Gate:** demonstrate an improvement across realistic sessions, including recompilation and cold cost, before making compilation part of the default runtime profile.

## Phase 7 — Improve cold starts and warm-worker policy

**Files:** MOSS-specific startup/lifetime settings in `runpod/modal_app.py`; benchmark cold-run mode.

- [ ] Separate HTTP readiness from model readiness. Add an optional representative warmup workflow in the MOSS lifecycle hook after ComfyUI is reachable.
- [ ] Warm the intended model/adapter and supported compilation bucket. Mark warmup jobs separately, remove their temporary outputs, and keep them out of user history/gallery.
- [ ] Avoid claiming that one warmup initializes every preset. Additional model/adapter/shape switches can still have first-use cost.
- [ ] Compare five-minute, ten-minute and twenty-minute idle windows at `min_containers=0`; compare a single always-warm MOSS worker as an explicit low-latency profile.
- [ ] Use representative idle gaps and session lengths to compare total user wait and billable idle time. Keep warm-worker provisioning scoped to MOSS.
- [ ] Record fresh-worker cold latency, first request in a reused-but-unwarmed process, and steady-state latency as distinct cases.
- [ ] Keep one request executing per ComfyUI process during these experiments. Throughput/concurrency tuning is a later concern if queue wait becomes dominant.

**Gate:** select a documented session/idle-cost policy. Warming models in startup moves initialization time; compare complete submission-to-image time before claiming a cold-start improvement.

## Phase 8 — Evaluate snapshots as a bounded experiment

**Files:** a separate experimental MOSS worker profile in `runpod/modal_app.py`; snapshot smoke tests/runbook.

- [ ] Enable the installed Modal SDK's GPU snapshot option only in the experimental profile, with initialization/warmup in a snapshot-enabled lifecycle hook.
- [ ] First test this actual subprocess-based ComfyUI topology: capture, restore, child-process liveness, localhost API responsiveness and successful new generation.
- [ ] Test randomness after restore, unique request IDs, fresh WebSocket connections, user-LoRA volume updates and compiler-cache compatibility.
- [ ] Compare several fresh restores against ordinary starts. Separate import/JIT savings from storage/weight-loading time.
- [ ] If the subprocess topology cannot be restored reliably, record the result and leave snapshots disabled. Any move to in-process Comfy execution is a separately scoped architecture change, not an assumed prerequisite for this optimization project.

**Gate:** snapshots ship only if repeated restore/generation cycles pass and cold latency improves. This work follows [Modal's current snapshot requirements](https://modal.com/docs/guide/memory-snapshots); the feature is experimental and is not expected to fix storage-bound loading.

## Phase 9 — Remove avoidable result-delivery delay

**Files:** `src/modal.js`, `src/__tests__/modal.test.js`.

The current `pollStatus()` waits three seconds before every status request, including the first. A fast GPU result can finish before the browser even checks once.

- [ ] Poll once immediately after receiving the call ID.
- [ ] Use a bounded initial schedule such as 250 ms, 500 ms, then 1-second intervals through ten seconds; back off to 2 seconds for long jobs. Measure request volume and completion-detection lag before finalizing intervals.
- [ ] Make waits abortable and release abort listeners/timers. Preserve the fifteen-minute overall timeout and the separate one-second elapsed-time display.
- [ ] Carry optional server metrics and generation metadata through the backend result without breaking existing `{dataUrl, imageUrl}` consumers.
- [ ] Report client submit-to-image latency separately from server execution time. Completion polling is a transport improvement, not an inference speedup.
- [ ] Use fake-timer tests for immediate completion, pending-to-complete, late completion, timeout, abort during wait/fetch, auth errors and completed responses containing a handler error.

**Gate:** a result completed within the first two seconds is displayed without a mandatory three-second wait. Target less than one second median completion-detection overhead for fast warm jobs, subject to measured HTTP latency.

## Phase 10 — Expose supported presets and preserve reproducibility

**Files:** `index.html`, `src/settings.js`, `src/state.js`, `src/modal.js`, `src/queue.js`, `src/session-moss.js`, `src/gallery-meta.js`; new `src/moss-presets.js`; related tests. Update `runpod/client.py` help and `runpod/README.md`.

- [ ] Add a small preset-description module and a lightweight authenticated Modal `/capabilities` response listing validated preset IDs and resolution/LoRA restrictions.
- [ ] Serve capabilities from deployment/build configuration without invoking the GPU worker. Fetching settings must not start a GPU container.
- [ ] When capabilities are absent, display the original three presets. Advertise candidate presets only when that endpoint's deployed assets and validation status support them.
- [ ] Show concise labels and practical guidance: Rapid for faster iterations, Draft for previews, Fast+/Quality+ for evaluated acceleration. Keep CUDA, compiler and cache controls out of the generation form.
- [ ] Preserve the selected preset in queued snapshots, sessions and gallery metadata. Add effective steps, sampler, guidance/acceleration settings and manifest/profile IDs from the result.
- [ ] Use the server-resolved seed in saved metadata when available. The current queue stores the submitted seed, which can remain `-1` after random generation; this must be corrected to reproduce benchmarks and gallery outputs.
- [ ] Restore older sessions with their existing behavior. If a saved candidate preset is unavailable on the current backend, show an explicit availability message and require selection of a supported preset before submission; avoid silently changing the image recipe.
- [ ] Keep backend response additions optional. New Modal metadata must not break old RunPod results or Ideogram requests.
- [ ] Test preset persistence, queue snapshots, server seed propagation, backend changes, capabilities failure and gallery/session restore.

**Gate:** the UI accurately reflects deployment support and saved images record the recipe actually executed.

## Phase 11 — Final evaluation and rollout

### Acceptance criteria

These are proposed project gates to implement, not existing guarantees:

| Change type | Comparison | Acceptance |
| --- | --- | --- |
| Runtime/residency/precision | Same original preset and fixtures | No new execution failures; OCR character error rate increase ≤1 percentage point; average layout IoU decrease ≤0.02; no material visual regression |
| Spectrum/compiler | Matched settings plus separate SLG control | Same quality gates; median warm usable-image time improves by at least 10% or 250 ms and exceeds observed run-to-run noise |
| Rapid | Current Turbo, with Fast/Quality references | Text/layout gates plus visual review; clear warm-latency gain; no unsupported-resolution promotion |
| Draft3 | Rapid | Explicitly rated as preview quality; useful latency improvement and no widespread duplicated/blurred subjects |
| Warmup/cache/snapshots | Complete fresh-worker/session path | Lower measured user wait or better session economics; repeatable startup/restore behavior |
| Polling | Same completed server results | Lower result-detection lag with bounded polling volume and passing abort/timeout checks |

Use a full suite of at least twelve prompts × three paired seeds for shortlisted changes, covering supported resolution buckets. Human review includes photographic naturalness, text/numbers, faces/hands and layout fidelity. Target no more than a five-percentage-point decrease in the usable-image pass rate for changes advertised as preserving quality. Treat small-sample scores as directional, and expand borderline cases before promotion.

Use median and spread for screening. Collect at least 100 appropriately separated observations before presenting p95 improvements; do not infer tail behavior from five runs. Keep cold and warm observations in separate populations. Recheck comparisons in alternating order to reduce bias from cache state or changing GPU load.

### Rollout sequence

- [ ] Freeze the baseline image, profile, capability set and representative outputs.
- [ ] Build/deploy a separate MOSS candidate app/profile and validate it through the benchmark entrypoint and a manually selected test endpoint.
- [ ] Promote runtime/residency improvements first, then validated additive presets. Deploy the updated backend before exposing its new presets in the client.
- [ ] Run one full browser flow for each exposed preset: generate, view/save, restore gallery metadata, and regenerate with a fixed seed.
- [ ] Smoke-test existing MOSS on RunPod and existing Ideogram behavior after shared-handler/client changes.
- [ ] Keep rollback as an endpoint/profile/image change with the previous capability list. No session migration should be required.
- [ ] Publish a final comparison recording selected defaults, rejected candidates, warm/cold latency, quality scores, model/runtime identities and session cost implications.

Changes to model files, adapter revisions or runtime packages create a new profile/manifest ID and trigger the relevant regression subset. An upstream update never silently replaces a benchmarked adapter or dependency.

## File and responsibility map

| File or directory | Responsibility |
| --- | --- |
| `runpod/Dockerfile.moss` | Pinned runtime, dependencies, installed optimization nodes and packaged assets |
| `runpod/modal_app.py` | MOSS deployment settings, lifecycle, capabilities, optional volumes/snapshots |
| `runpod/handler.py` | Existing API orchestration; delegate MOSS construction and optional metrics |
| `runpod/moss_config.py` | Validated runtime profile and preset definitions |
| `runpod/moss_workflow.py` | Pure graph construction, optional adapter/SLG/Spectrum/compile insertion |
| `runpod/moss_assets.py` | Manifest resolution and asset checks; maintenance population entrypoint |
| `runpod/moss-models.json` | Pinned model/adapter revisions and hashes |
| `runpod/moss-runtime.lock.json` | Resolved software revisions and runtime identity |
| `runpod/comfy_metrics.py` | Prompt-scoped event aggregation and measurement provenance |
| `runpod/moss_benchmark.py` | Reproducible runs, limits, artifacts and comparisons |
| `runpod/benchmarks/moss/` | Versioned fixtures and evaluation expectations |
| `src/moss-presets.js` | Preset descriptions and capability-aware selection helpers |
| `src/modal.js` | Polling, HTTP delivery timing and optional result metadata |
| `src/queue.js` | Queue snapshot integrity and effective result metadata |
| `src/session-moss.js`, `src/gallery-meta.js` | Preset persistence and availability-aware restore |

Keep the new backend helpers importable in CPU-only tests. If helpers are packaged only in the MOSS image, load them lazily from the MOSS branch of the shared handler; the Ideogram image must not fail because a MOSS-only module is absent. Update Docker COPY instructions for every module that the selected image needs.

## Verification work

Add focused Python tests for profile validation, graph connections, distillation exclusivity, supported-size policies, SLG controls, node-schema validation, cached/event timing, reconnect/error handling and metadata compatibility. Keep GPU performance and quality checks in the separate benchmark suite.

Extend the existing Vitest suites for Modal, queue, gallery/session restore and settings. Test behavior and compatibility rather than duplicating preset dictionaries in assertions.

Commands to run during implementation:

```sh
uv run --with pytest --with requests --with websocket-client pytest runpod
npm test
```

Run dependency/import checks in the built GPU image, then targeted GPU smoke/benchmark cases for each completed phase. Do not repeatedly run a full expensive GPU matrix after documentation-only edits.

## Suggested implementation slices

| Slice | Work | Depends on |
| --- | --- | --- |
| 1 | Deployment discovery, telemetry, fixtures and baseline runner | None |
| 2 | Runtime pinning, accelerated-kernel checks and optional Comfy update comparison | 1 |
| 3 | Model assets, MOSS profile configuration, residency/precision selection | 2 |
| 4 | Rapid and Draft3 graph support with resolution/quality checks | 3 |
| 5 | Spectrum graph support and matched-guidance comparisons | 3 |
| 6 | Compiler experiments and persistent caches | 3; combine with 4/5 only after independent validation |
| 7 | MOSS warmup/lifetime policy and optional snapshot experiment | 3, 6 where applicable |
| 8 | Faster polling, capabilities, metadata and preset UI | Metadata contract from 1; exposed presets from 4/5 |
| 9 | Final quality/performance comparison, deployment and rollback runbook | All selected candidates |

These are sequentially reviewable work slices, not a requirement to use parallel agents.

## Recommendations intentionally kept as investigation outcomes

Keep the established attention backend as a control. A Sage/Flash attention candidate can be benchmarked after the runtime is sound, but requires its own text/color quality comparison. Do not enable it solely for an advertised speedup.

GGUF/extra-low-bit weights, TensorRT/Nunchaku, generic cache nodes and a SGLang/vLLM migration do not currently have enough demonstrated benefit for this workflow/GPU to justify implementation in the core sequence. Record any new validated MOSS recipe and reopen those routes only if the measured bottleneck remains unsolved. The same applies to multi-GPU serving and larger batches: investigate them only if throughput/queue wait, rather than single-image inference, becomes the target.

The project is complete when all recommended experiments have documented outcomes, selected configurations meet the gates, the UI exposes their actual capabilities, and the deployment has a tested rollback. A candidate that fails its gate remains disabled with its result recorded.
