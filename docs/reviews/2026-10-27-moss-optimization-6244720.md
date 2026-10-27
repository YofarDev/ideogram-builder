# Implementation review: MOSS inference optimization

Reviewed commit: `6244720`, branch `feat/moss-inference-optimization`, against parent `7c03e4a`.

Reviewed the implementation notes, implementation plan, rollout runbook, changed backend/frontend code and relevant tests. The checkout was clean before review. Application code was not modified during this review.

## Assessment

The module boundaries and additive API fields are sensible, but this branch is not ready to deploy or to produce trustworthy optimization comparisons. Seven high-priority issues affect baseline startup, configuration propagation, candidate model loading, benchmark execution, and measurement correctness. Additional issues affect the optional features and capability lifecycle.

Deferring image-quality acceptance to the actual GPU is reasonable. The failures below are implementation defects that can be demonstrated without that GPU; they are separate from the pending quality/performance gates.

## Verification performed

- Python suite: `uv run --with pytest --with requests --with websocket-client pytest runpod -q` — **129 passed**.
- Frontend suite: `npm test -- --reporter=dot` — **375 passed**, 34 test files.
- Imported the Modal module using the installed Modal 1.3.0.post1 SDK without deploying or starting a worker.
- Exercised the real profile resolver/runtime gate, benchmark payload builder and metrics collector with small CPU-only reproductions.
- Exercised the actual frontend modules in a Node VM with jsdom to reproduce capability state across backend changes.
- Checked the pinned ComfyUI execution/model-path code, comfy-kitchen v0.2.40 registry shape, and Modal snapshot documentation.

No model downloads, GPU generation or deployments were performed. Existing tests passing is confirmed; the stated inference performance remains unverified.

## High-priority findings

### R01 — [P1] The baseline profile is rejected on its intended fallback runtime

**Location:** `runpod/moss_config.py:227–232`; enforcement in `runpod/runtime_check.py:96–118`, called from `runpod/modal_app.py:275`.

The baseline omits `requires_cuda13=False`, so `_profile()` derives `True` from its INT8/W4A8 formats. The enforcement function does not exempt the baseline, despite its docstring saying it does. Consequently, a cu126 worker fails startup even with the default profile and an unchanged Docker build.

Reproduction with the actual configuration:

```python
p = moss_config.resolve_profile({})
assert p["profile_id"] == "baseline"
assert p["requires_cuda13"] is True
runtime_check.enforce_profile_requirements(p, {"torch_version_cuda": "12.6"})
# RuntimeError: Profile 'baseline' requires PyTorch built against CUDA 13.0+
```

The existing baseline test hand-constructs a dictionary with `requires_cuda13=False`, so it does not exercise this defect. Explicitly preserve the fallback baseline and test enforcement against `resolve_profile({})`; require the accelerated path only for the corresponding candidate profiles.

### R02 — [P1] Deployment configuration is not installed in the GPU worker environment

**Location:** `runpod/modal_app.py:389–398`; compare the proxy's `env=_MOSS_ENV` at line 454.

The MOSS GPU class receives no `env=_MOSS_ENV`, and the image is not extended with those environment values. `comfy_env()` supplies them only to the ComfyUI subprocess. Generation runs `handler.handler()` in the parent Modal process, where the handler resolves its profile from `os.environ`.

A deploy selecting a candidate can therefore launch child flags for one profile while the parent handler resolves the baseline and rejects Rapid or selects the wrong loaders. Module-level settings read during remote import also lack the intended deployment variables. The proxy receiving the values does not propagate them to a separate GPU class.

Local reproduction of the split: a worker configured as `resident-highvram-int8` gives its child that profile, while resolving a parent environment without those variables returns `baseline`. `_moss_cls_kwargs.get("env")` is `None`.

Pass the same frozen configuration to the GPU class/image and verify that worker lifecycle, handler metadata, and `/capabilities` agree. Add a deployment-configuration test that represents remote import rather than assuming the developer shell's environment exists in every container.

### R03 — [P1] Candidate model paths are registered after ComfyUI has already started

**Location:** `runpod/modal_app.py:282–290`.

`post_ready()` creates `extra_model_paths.yaml` only after the HTTP server is reachable. The [pinned ComfyUI startup code](https://github.com/Comfy-Org/ComfyUI/blob/7cebca52227c63b4180ceed448cbd7ad22903b6d/main.py#L137) reads this configuration during initialization; writing the file afterward does not register new paths in the running process. The existence guard also prevents adding the MOSS volume when another config already exists.

The asset resolver can find BF16 weights or new adapters under `/moss-models`, but native loaders still cannot select those files, causing prompt validation/loading failures.

Write a dedicated extra-path file before `Popen` and supply it through `--extra-model-paths-config`, preserving any existing configuration. Verify the running server's `/object_info` loader choices include a populated candidate.

### R04 — [P1] The Modal benchmark function never starts its local ComfyUI server

**Location:** `runpod/modal_app.py:565–581`.

`moss_benchmark_run` is a separate Modal Function container, not a method on the initialized MOSS class. It calls `run_benchmark(mode="internal")`, which calls `handler.handler()` against `127.0.0.1:8188`. Nothing in this function starts ComfyUI, runs the worker lifecycle, or waits for model readiness. Allocating a GPU and selecting the image does not initialize the worker class.

The documented benchmark command therefore cannot generate images in this container and eventually reports an unreachable ComfyUI server. Run benchmark jobs through an initialized worker or explicitly manage startup/shutdown around an internal server. Add an integration test asserting readiness precedes the first handler call.

### R05 — [P1] Benchmark profiles change report labels without changing execution

**Location:** `runpod/moss_benchmark.py:217–226`, with record labeling at lines 330–332.

Neither executor applies `job["config"]["profile"]`. Internal mode calls the existing handler environment; HTTP mode sends every profile to the same endpoint with an identical request. Residency flags require a process configured for that profile, so changing only a reporting dictionary cannot benchmark them.

Two jobs differing only in `baseline` versus `resident-highvram-int8` produce identical payloads. Results are nevertheless labeled with the requested profile, and the runner never checks the server's `generation.runtime_profile`. The separately dumped workflows can describe a configuration that never executed.

Create a real profile-to-worker/endpoint mapping, initialize each profile's process, and reject results whose executed profile does not match the requested one. Derive recorded runtime manifests from that worker, not the client host.

### R06 — [P1] Core stage timings depend on completion events ComfyUI does not emit

**Location:** `runpod/comfy_metrics.py:64–73`.

Intervals open on `executing` and close only on `executed`. In the [pinned executor](https://github.com/Comfy-Org/ComfyUI/blob/7cebca52227c63b4180ceed448cbd7ad22903b6d/execution.py), `executed` is conditional on a node producing UI output. Ordinary text-encoder, sampler and decode nodes do not provide that UI completion event.

Replaying a normal serial sequence—encode starts, sampler starts, decode starts, SaveImage starts/finishes, graph finishes—records only SaveImage and returns `measurement_complete=False`. Sampler timings and the regression guard are therefore absent in the real path. Tests inject an `executed` event for every core node, masking the mismatch.

Use actual execution instrumentation, or derive explicitly labeled serial estimates from supported transitions with appropriate cache/subgraph handling. Test with traces matching the pinned server. Also start the total worker timer at handler entry: the current collector is created after validation, LoRA preparation and schema fetching, so `worker_total_ms` excludes those costs.

### R07 — [P1] Disabled/unavailable CUDA backends are reported as accelerated

**Location:** `runpod/runtime_check.py:87–93`.

The code expects a string or boolean CUDA state. The [pinned comfy-kitchen registry](https://github.com/Comfy-Org/comfy-kitchen/blob/v0.2.40/comfy_kitchen/registry.py#L105) returns a dictionary with `available`, `disabled`, `unavailable_reason` and `capabilities`. A dictionary containing `available=False, disabled=True` passes the present check and reports success.

Reproduction:

```python
accelerated_backend_enabled({
    "comfy_kitchen_backends": {"cuda": {"available": False, "disabled": True}}
})[0]
# True
```

Read the nested fields and test realistic available/disabled/unavailable responses. Collect the effective registry state inside the actual ComfyUI process after `comfy.quant_ops` applies its policy; the current startup diagnostic imports the package in the parent process, which can have different registry state. Confirm dispatch with a representative operation before marking the runtime gate passed.

## Additional correctness findings

### R08 — [P2] Capabilities are stale after backend changes

**Location:** `src/settings-moss.js:75–79`, initialization at line 118.

Capabilities are requested only at initialization. The backend change handler in `src/settings.js` updates localStorage but does not refresh them. `applyPresetCapabilities()` also returns without clearing capabilities or hiding candidates when RunPod is selected, or when a new capabilities request fails.

Reproduced both directions: loading on RunPod then switching to Modal makes no capabilities request; after explicitly loading Rapid support from Modal, switching to RunPod leaves Rapid available and visible. The queue gate uses that stale global list and permits an unsupported RunPod request.

Refresh on backend/configuration changes, clear unsupported-backend state, and guard against an older asynchronous response overwriting the currently selected backend. Add tests spanning the actual settings-change lifecycle.

### R09 — [P2] The documented warmup option cannot be enabled

**Location:** `runpod/moss_config.py:338–352`.

Every declared profile has `warmup=False`, while changing `MOSS_WARMUP` is explicitly rejected. `resolve_profile({"MOSS_WARMUP":"true"})` always raises an undocumented-profile error. None of the advertised startup-warmup experiments can run through the supplied configuration.

Declare warmed variants with reproducible identities, or model warmup as a supported lifecycle setting with metadata. Test a successful enabled path, not only rejection of unknown combinations.

### R10 — [P2] The GPU snapshot profile enables CPU snapshots only

**Location:** `runpod/modal_app.py:426–437`.

The class sets `enable_memory_snapshot=True` but omits `experimental_options={"enable_gpu_snapshot": True}`. [Modal documents both settings](https://modal.com/docs/guide/memory-snapshots) for GPU state capture. Its `snap=True` hook starts CUDA-dependent ComfyUI initialization, which is incompatible with ordinary CPU-only snapshot initialization.

Add the actual GPU snapshot option before testing the subprocess topology. Also avoid provisioning the unrouted ordinary class with `min_containers=1` when snapshot mode is selected; currently both classes share the same minimum.

### R11 — [P2] Explicit profile selection can resolve to another profile

**Location:** `runpod/moss_config.py:353–368`.

`_match_declared_profile()` ignores profile identity, status and runtime requirements and returns the first numerically matching entry. The baseline and `resident-auto-int8` share the compared fields, so explicitly selecting the latter returns `baseline` and its validated status.

Preserve the selected identity when there are no overrides, and require unique, complete identity criteria for override resolution. The runtime/build identity must distinguish a fallback baseline from an accelerated candidate even when their loader and residency settings match.

### R12 — [P2] The cached-prompt benchmark rotates its prompt

**Location:** `runpod/moss_benchmark.py:107–110`.

With multiple fixtures, `cached_prompt=True` chooses `fixtures[seed_index % len(fixtures)]`. The first requests use different text; normal consecutive runs therefore miss the intended text-encoder cache. The existing test supplies exactly one fixture and cannot reveal this.

Group consecutive varying-seed jobs by one fixed prompt, warm each prompt/configuration before measuring, and confirm the encoder node was actually cached. Warmup currently runs once for the entire matrix despite its per-config comment.

### R13 — [P2] The documented BF16/FP32 adapter reference cannot be selected

**Location:** `runpod/moss_config.py:283–288`; `runpod/moss-models.json:143–155`.

Only the INT8-DiT adapter profile enables Rapid/Draft3. None of the BF16 profiles enables them, so the planned documented BF16 reference combination is rejected by the request gate.

Additionally, the 20 GB merged FP32 DiT is classified and populated as a distillation LoRA under `loras/moss/control`. The [author's model card](https://huggingface.co/akhaliq/MOSS-Image-SFT-4-steps) identifies that file as a full diffusion-model replacement. No profile or selector actually uses it as the DiT. Loading it through a normal LoRA slot would not perform the intended reference comparison.

Add an explicit BF16 reference profile and classify the merged FP32 checkpoint as a diffusion model, with its separate adapter disabled. Exercise the complete loader selection in tests before instructing the operator to compare these references.

### R14 — [P2] Advertised capabilities ignore the deployment preset allow-list

**Location:** `runpod/modal_app.py:511–513`.

The endpoint calls `resolve_profile()` and advertises its entire preset list rather than using `resolve_enabled_presets()`. For `MOSS_ENABLED_PRESETS=Fast`, the handler accepts only Fast while capabilities advertises Fast, Quality and Turbo. The browser then unconditionally unions in all three base presets as well (`src/moss-presets.js:37–44`).

Use the effective enabled list on both sides, falling back to the original three only when no capabilities are available. Promotion should also be tracked per preset/resolution bucket: the runbook's Stage-C profile status flip currently exposes Draft3 and both Spectrum presets along with Rapid before their later gates necessarily pass.

### R15 — [P2] Benchmark summaries mix incomparable samples

**Location:** `runpod/moss_benchmark.py:420–442`.

Groups omit resolution/fixture and cold-versus-warm status, and timing arrays include failed records whenever they contain timings. The supplied fixtures range from 1152×768 to 1024×1536. The displayed medians can therefore combine different pixel workloads, first-use compilation/loading and partial failures.

The regression guard similarly compares different fixture sizes against the fastest single sample for the whole profile/preset. A slower, larger image can trigger a false regression stop.

Split comparable cohorts by workload/resolution and initialization/cache state; exclude failures and incomplete measurements from successful latency statistics. Report failures separately. Compare regression against a matched baseline cohort, rather than the fastest sample across changing inputs.

### R16 — [P2] Compiler cache namespacing is claimed but never implemented

**Location:** `runpod/modal_app.py:235–246`.

Both compile profiles return the same fixed `/moss-compile-cache/inductor` and `/moss-compile-cache/triton` paths. A comment promises a runtime subdirectory computed in `post_ready`, but that code does not exist. There is also no implemented population coordination corresponding to the docstring's concurrent-writer guarantee.

Create the cache namespace before starting the child process using actual compatible runtime/GPU/model/profile identity, and define cache publication/reuse behavior. Test distinct profiles/runtimes and fresh-worker reuse. PyTorch's internal cache keys do not make the separately promised artifact identity/population protocol implemented.

## Frontend review scores

Scores apply to the frontend changes in this commit, not an audit of the entire historical application.

| Dimension | Grade | Notes |
| --- | --- | --- |
| File/folder structure | Good | Preset descriptions and transport logic have identifiable modules. |
| HTML quality | Good | Added preset controls retain associated labels and radio-group semantics. |
| CSS quality | Good | Candidate hiding includes an explicit hidden-label rule and reuses existing styling. |
| JavaScript quality | Needs work | Capability state is not synchronized with backend changes and failure paths. |
| Debuggability/scalability | Needs work | Local fixtures cover individual functions but miss deployment/event/lifecycle contracts. |

The immediate polling schedule, abort-listener cleanup, server-seed propagation, additive response fields and pure graph builder are useful foundations. Retain them while fixing integration behavior.

## Implementation-plan coverage and next steps

The branch contains scaffolding for the twelve phases, but it does not yet provide the operational implementation described in the notes. In addition to the findings above:

- The accelerated wheel set remains unresolved, and Modal's image factory does not pass the new Torch build arguments; a standalone Docker candidate build is not automatically the image used by `modal deploy`.
- NVML sampling, the independent full-SLG Fast control, actual benchmark Spectrum-debug activation, measured compile-cache reuse and image quality evaluation remain missing or manual. For example, the builder accepts `spectrum_debug`, but the handler never sets it from benchmark execution, despite the runbook claiming benchmark mode enables it.
- CPU-local `runtime_check.collect()` output is not a deployed GPU runtime manifest, especially for HTTP benchmark runs.

Prioritize R01–R07 before spending GPU time. Add small integration tests for actual profile/environment propagation, worker readiness, populated-model visibility, real ComfyUI event traces and executed-profile verification. Then fix backend capability transitions and the optional feature paths, update the runbook to working commands, and proceed with GPU quality/performance acceptance.

There is no need to broadly refactor the UI or replace the existing module structure to address these findings.

## Fix follow-up (2026-10-27)

The findings above describe reviewed commit `6244720`. Subsequent working-tree
fixes address all sixteen; this section records implementation status without
rewriting the original evidence.

| Finding | Implemented correction |
| --- | --- |
| R01 | Real baseline explicitly tolerates fallback CUDA; candidate gate stays strict. |
| R02 | Frozen canonical env installed in the GPU image/class and parent handler as well as child/proxy. |
| R03 | Dedicated paths config written before `Popen`, passed explicitly; running loader choices verified through `/object_info`. |
| R04 | Benchmark entrypoint owns startup/readiness/shutdown of its local ComfyUI process. |
| R05 | Profiles restart real workers; HTTP comparisons require endpoint mappings; executed identities checked and worker artifacts captured. |
| R06 | Serial transition wall estimates close core intervals without invented `executed` events; total starts at handler entry. |
| R07 | Nested backend fields checked; policy/forced dispatch checked inside actual ComfyUI through `/moss/runtime`. |
| R08 | Backend/config events refresh/reset controls and queue availability; abort and request identity protect against stale responses. |
| R09 | Explicit warmed variants resolve successfully and retain their identities. |
| R10 | GPU snapshot flag enabled; unrouted ordinary class minimum is zero. |
| R11 | Explicit profile identity preserved; ambiguous overrides fail clearly. |
| R12 | Cached runs group varying seeds by fixed prompt and warm each prompt/config; observed cache state is recorded. |
| R13 | BF16 adapter reference enabled; FP32 checkpoint is a DiT with its separate distillation adapter bypassed. |
| R14 | Effective allowlist is authoritative; promotion uses per-recipe MP limits, independently of profile status. |
| R15 | Comparable cohorts split by fixture, size, worker, first-use and cache state; failed/partial traces excluded; matched median regression guard. |
| R16 | Prelaunch cache namespace includes profile/software/GPU/models; local writers publish immutable complete generations for reuse. |

Also wired the matched cu130 wheel set into Modal builds, added the independent
`FastFullSLG` benchmark control, enabled Spectrum debug during benchmarks, added
sampled NVML device memory, and exposed LoRA/resolution benchmark inputs. The
rollout runbook now distinguishes actual execution artifacts from absent HTTP
artifacts and lists the remaining GPU acceptance work.

Regression tests cover real profile resolution, realistic event/registry
shapes, loader visibility, lifecycle ordering and parent/child configuration,
executed-profile checks, multiple cached fixtures, independent promotion,
cache publication/reuse, wrapped handler failures, and real backend radio
changes plus stale-request races. Modal decorator configuration is checked
using the real SDK without deploying or allocating GPUs.

**Still pending:** Docker image build, actual CUDA smoke, Modal snapshot
capture/restore, fresh-container compiler cache reuse, latency comparisons and
OCR/layout/human quality acceptance on the RTX PRO 6000. These require real
execution evidence; no inference speedup or quality acceptance is claimed.

Final local verification: **155 Python tests passed**, including real Modal SDK
configuration/lifecycle tests; **381 frontend tests passed**; `git diff --check`
passed. No deployment, GPU generation or model download was performed.
