# MOSS inference optimization — rollout and validation runbook

Companion to the [implementation plan](2026-10-27-moss-inference-optimization-implementation.md)
and the [research findings](../research/2026-10-27-moss-inference-optimization.md).
This runbook covers what code cannot decide for us: everything that must be
measured on the actual Modal RTX PRO 6000 deployment before candidate presets
and profiles are promoted.

**Status (2026-10-27, after review fixes):** R01–R16 have code fixes and
CPU regression coverage. The candidate wheel set is pinned and wired into the
Modal build. Image build, real GPU dispatch, inference latency, quality, cache
reuse across Modal containers and GPU snapshot restore are **PENDING**.
The default remains the fallback-compatible baseline with the original presets.

Local verification:

```sh
uv run --with pytest --with requests --with websocket-client --with modal pytest runpod -q
npm test -- --reporter=dot
# CPU-only plan inspection; no GPU allocation or weight downloads:
python runpod/moss_benchmark.py --dry-run --profiles baseline --presets Fast --out /tmp/moss-plan
```

Internal benchmarks own their ComfyUI lifecycle, restarting it when the profile
changes. HTTP comparisons require separate deployments per profile and reject
any result whose `generation.runtime_profile` differs. A profile selects flags,
formats and graph behaviour; a **runtime build** selects installed wheels.
Changing profiles within one benchmark does not change the wheel set.

## Baseline record (Phase 0)

### Deployment identity — INCOMPLETE, needs the deploying account

The Modal CLI in the current environment (profile `yofarcorp`) lists no
`ideogram-builder` app (only an unrelated stopped `flux-lora-*` app), matching
the research note. Before any benchmark run, record from the account that
actually hosts the app:

```
modal profile current          # workspace / profile
modal app list                 # app id + state for ideogram-builder
modal app log ideogram-builder # startup logs: backends, fallback warnings
```

Then capture the runtime identity from inside the MOSS worker (also available
as the startup diagnostic and benchmark runtime artifact):

```sh
# Inside the running worker container:
curl --fail http://127.0.0.1:8188/moss/runtime
```

This endpoint runs inside ComfyUI, after its quantization policy, and includes a
forced CUDA INT8/convrot dispatch probe. A standalone `runtime_check.py --json`
inspects its own process and cannot prove the running server's backend state.
Startup also checks `/object_info` to confirm the native loaders list the
selected volume assets. `nvidia-smi` device peaks are sampled during internal
generation and labeled device-wide, rather than allocator or exact peaks.

Paste both into the `observed` block of `runpod/moss-runtime.lock.json` and
this file. **The deployment baseline is authoritative** if it differs from the
checkout; document the difference before changing either. Known open
hypothesis: the deployed torch build may be cu126, which would disable the
comfy-kitchen CUDA backend (`comfy/quant_ops.py` hard-gates at cu130) — the
startup diagnostic prints exactly this.

### Baseline images and timings — PENDING

Run an internal baseline using the current image configuration (for the actual
deployed endpoint, use the HTTP CLI with `--endpoint`):

```sh
modal run runpod/modal_app.py::moss_benchmark_main \
  --profiles baseline --presets Fast,Quality,Turbo --seeds 101,202,303,404,505
```

Keep fresh-container and warm observations separate (the runner records
`first_generation_in_worker` and `worker_instance_id`; the summary splits
workers automatically). Freeze this run's `results.jsonl` + `summary.md` as
the frozen baseline artifact for later comparisons.

## Validation order and gates

### Stage A — runtime reproducibility (plan Phase 2)

1. Capture a baseline run using `MOSS_RUNTIME_BUILD=baseline`. Keep its runtime
   JSON and images separate from every candidate run.
2. Build/deploy a separate candidate through the actual Modal image factory:

   ```sh
   MOSS_APP_NAME=moss-runtime-candidate MOSS_RUNTIME_BUILD=cu130 \
   MOSS_RUNTIME_PROFILE=resident-auto-int8 modal deploy runpod/modal_app.py
   ```

   This selects the official matched set `torch==2.11.0`,
   `torchvision==0.26.0`, `torchaudio==2.11.0` from the cu130 index. The
   [official PyTorch version table](https://pytorch.org/get-started/previous-versions/)
   documents the pairing. The Docker build runs imports and `pip check`, and
   saves `/moss-build-freeze.txt`. Startup requires the effective CUDA registry
   and real dispatch probe to pass; pinned does not mean GPU-validated.
3. Run the candidate with the same build selection, Fast/Quality/Turbo and
   unchanged seeds/fixtures. `modal run` creates its own execution containers;
   keep the environment prefix on each command:

   ```sh
   MOSS_APP_NAME=moss-runtime-candidate MOSS_RUNTIME_BUILD=cu130 \
   modal run runpod/modal_app.py::moss_benchmark_main \
     --profiles resident-auto-int8 --presets Fast,Quality,Turbo
   ```

4. Any ComfyUI upgrade must be a separate, commit-pinned build and comparison.
   The Modal factory currently keeps the existing ComfyUI commit; passing an
   argument to a standalone Docker build does not change a Modal deployment.

**Gate:** no unexplained kernel fallback; all three original presets work;
quality gates (below) pass vs the frozen baseline.

### Stage B — residency and precision (plan Phase 3)

```sh
# one variable at a time; never combine --highvram with --gpu-only
MOSS_RUNTIME_BUILD=cu130 modal run runpod/modal_app.py::moss_benchmark_main --profiles resident-auto-int8,resident-highvram-int8,resident-gpuonly-int8 --presets Fast
# then DiT precision at the winning residency, then encoder precision
MOSS_RUNTIME_BUILD=cu130 modal run runpod/modal_app.py::moss_benchmark_main --profiles dit-bf16-highvram-w4a8,dit-bf16-highvram-int8enc,dit-int8-highvram-bf16enc --presets Fast
# cross-check the runner-up combination; repeat with --cached-prompt for the
# text-encode-cached case; --loras-json accepts the production LoRA request array
```

Populate candidate weights first (CPU-only, explicit keys):

```sh
modal run runpod/modal_app.py::moss_populate_models --keys dit_bf16,enc_int8_convrot,enc_bf16
```

**Gate:** measured residency/precision combination with stable long-prompt and
LoRA behaviour and adequate VRAM headroom; runner-up + baseline retained.

### Stage C — Rapid and Draft3 (plan Phase 4)

```sh
modal run runpod/modal_app.py::moss_populate_models --keys adapter_rapid4,adapter_draft3,dit_rapid4_fp32
MOSS_RUNTIME_BUILD=cu130 modal run runpod/modal_app.py::moss_benchmark_main \
  --profiles resident-highvram-int8-adapters --presets Rapid,Turbo,Fast \
  --fixtures poster_en_bold,menu_bilingual_cafe,small_numbers_gauge,tiny_labels_panel --seeds 101,202,303
```

- Fine-text precision: compare Rapid on `bf16-adapters` (BF16 DiT + INT8
  encoder + Rapid LoRA), `resident-highvram-int8-adapters`, and a separate run
  of `rapid-fp32-reference --presets Rapid`. The FP32 asset is a complete
  diffusion checkpoint under `diffusion_models`; its profile bypasses the
  separate Rapid adapter. The format names identify source checkpoint formats;
  actual compute casting follows the pinned native loader and must be checked
  on the worker. Populate `dit_bf16,enc_int8_convrot` for these references.
- Area policy: `Rapid` steps are 4 (≤1 MP) / 6 (≤2 MP) / 8 (≤4 MP); `Draft3`
  3 steps ≤1 MP. Buckets are project policy — advertise a bucket only after it
  passes; unsupported sizes error out (never silently resized). Use explicit
  `--width 2048 --height 2048` to exercise the 4 MP bucket. Draft3 runs must
  select fixtures/overrides at or below 1 MP; oversized matrices fail before
  starting ComfyUI.
- Combinations: no-LoRA, one LoRA, multi-LoRA, consecutive preset switches.

**Gate:** Rapid passes text/layout criteria with a clear warm-latency gain vs
Turbo. Draft3 is explicitly preview-quality; it never replaces a final preset.
Promotion has two gates: set the winning profile's `status` to `validated`
AND add only accepted recipes to its `validated_presets` map, for example
`Rapid: 1` for the ≤1 MP bucket. Increase to 2 or 4 only after those buckets
pass. Do not add Draft3/Spectrum until their independent gates pass. Intersect
this list with `MOSS_ENABLED_PRESETS`; the proxy and browser respect the result.

### Stage D — Spectrum (plan Phase 5)

Compare on the winner profile: (1) Fast with original SLG 0–0.5, (2) Fast with
full SLG 0–1, no Spectrum (`FastFullSLG`, benchmark-only), (3) `FastSpectrum`;
plus Quality ± `QualitySpectrum`. Use an adapter-capable profile for this matrix.
Benchmark mode sets Spectrum `debug=true` — capture forecast/actual evaluation
counts from the worker log; zero forecasts is not an acceleration result.
Adaptive mode only after Manual is stable, as its own pinned profile.

**Gate:** acceleration visible in evaluation counts AND warm usable-image
latency, with the quality gates; if not, FastSpectrum/QualitySpectrum remain
unadvertised.

### Stage E — compilation and caches (plan Phase 6)

`compile-inductor-resident-int8` / `compile-cudagraphs-resident-int8` vs the
Stage-B winner, fixed 1024² first, then aspect switches and LoRA changes.
Record compile time, warm delta, recompiles, memory peak. Persistent caches
mount at `/moss-compile-cache`. Before the child starts, a namespace hashes
runtime/GPU capability, complete profile, model manifest and runtime lock.
Each worker compiles into its own local directory, copied from a completed
compatible generation when present. After the child stops, it publishes to a
unique immutable directory, writes `COMPLETE`, then commits the volume.
Concurrent workers never write the same compiler directory. The worker runtime
artifact records `compiler_cache.namespace` and `reused_from`; confirm reuse
and actual latency on a fresh container before counting savings. Compute
break-even: `additional startup cost / warm saving per request`. Spectrum +
compiler combination LAST.

**Gate:** session-level win, not just warm microbenchmark.

### Stage F — cold starts, warmup, snapshots (plans Phases 7–8)

Compare `MOSS_SCALEDOWN_SECONDS` 300/600/1200 at `min_containers=0` and one
always-warm worker (`MOSS_MIN_CONTAINERS=1`) over representative idle gaps.
`MOSS_WARMUP=true` selects an explicit `<profile>-warm` identity and runs an
enabled representative recipe after readiness. It moves init cost into startup;
compare complete submission-to-image time, including startup. Use an HTTP run
with `--no-warmup` to retain the first cold observation; internal Modal benchmark
latency measures the handler after startup and is not cold-start latency.
Snapshots (`MOSS_SNAPSHOT_MODE=gpu_experimental`)
are a bounded experiment: capture/restore, child-process liveness, post-restore
generation, randomness, volume updates; if the subprocess topology cannot be
restored reliably, record the result and leave snapshots off.

### Stage G — final evaluation and promotion (plan Phase 11)

Full suite: ≥12 fixtures × 3 paired seeds per shortlisted change, alternating
comparison order, ≥100 observations before any p95 claim. Human review of
photographic naturalness, text/numbers, faces/hands, layout fidelity. Usable
-image pass rate may drop ≤5 percentage points for quality-preserving changes.
Then follow the rollout sequence from the plan: freeze baseline → deploy
candidate backend → promote runtime/residency first, then presets → update the
client only after the backend serves them → smoke-test RunPod MOSS + Ideogram
paths after any shared-handler change → publish the final comparison.

## Quality gates (all image-producing stages)

| Check | Method | Threshold |
| --- | --- | --- |
| Text accuracy | OCR (expected_text per fixture) | CER increase ≤1 percentage point vs baseline |
| Layout adherence | IoU (expected_regions per fixture) | average decrease ≤0.02 |
| Visual | Human review incl. faces/hands | no material regression |
| Acceleration value | warm usable-image latency | ≥10% or ≥250 ms median improvement, above run-to-run noise |

## Rollback

Rollback is an endpoint/profile/image change — no session migration is ever
required:

- Client refreshes capabilities on backend/configuration changes. A failed
  refresh or RunPod switch resets to the original three; unadvertised presets
  are hidden, and a restored session selecting an unavailable preset keeps the
  saved recipe but requires a supported choice before submission.
- Server: redeploy with `MOSS_RUNTIME_PROFILE=baseline` (and the previous
  image tag) — the original three presets continue unchanged.
- Candidates stay disabled with their benchmark results recorded; a
  failed gate is a documented outcome, not a silent revert.

## Files promoted per outcome

| Outcome | Files to flip |
| --- | --- |
| Residency/precision winner | `runpod/moss_config.py` profile `status` (+ description), redeploy with `MOSS_RUNTIME_PROFILE=<winner>` |
| Rapid/Draft3 validated | winner profile `enabled_presets` technical support + `validated_presets` accepted MP limits; `status: "validated"` |
| Spectrum validated | add only passed `FastSpectrum`/`QualitySpectrum` to `validated_presets` |
| Compile wins | winner profile `compile_backend` field (declared profile, not an override) |
| Model/adapter/runtime change | new `manifest_id`/`lock_id` + relevant regression subset rerun |

An upstream update never silently replaces a benchmarked adapter or
dependency: changing `moss-models.json` or `moss-runtime.lock.json` revisions
creates a new profile/manifest identity and re-triggers the regression subset.

## Benchmark interpretation and artifacts

- `workflows/` contains the exact graphs returned by internal benchmark
  execution; `runtime/` contains child-process runtime identity. HTTP runs
  against ordinary deployments may lack these artifacts and leave them absent;
  they never substitute a client-host runtime or a reconstructed graph.
- Fresh-prompt runs vary trailing JSON whitespace across seeds to invalidate
  the CLIP node input cache without changing the parsed layout. Cached-prompt
  runs group consecutive seeds by fixture and warm every configuration/prompt.
  Always inspect observed `cache_state`; requested mode is not evidence of a
  cache hit. Negative conditioning may stay cached independently.
- Timing is serial WebSocket node-transition wall time, including scheduling
  and network effects, rather than CUDA kernel time. Reconnects/failed traces
  are incomplete. Summary medians exclude failed/incomplete samples and split
  fixture, resolution, worker, first-generation and observed cache state.
- Regression stopping compares first-three versus latest-three warm sampler
  medians within one matching cohort. Device memory sampling can miss brief
  peaks and includes every allocation visible to NVML.
- Warmups consume time but are excluded from measured results. `--max-jobs`
  bounds measured jobs; `--max-minutes` is a best-effort wall budget including
  startup/warmup. GPU operations, server startup and HTTP requests can exceed
  the remaining budget before control returns. Internal execution has an
  interrupt deadline; an HTTP polling timeout does not cancel the remote call.
- `--loras-json` supports no/one/multiple LoRA comparisons. Store the request
  array with results and keep sets fixed within a run. Separate runs with
  explicit `--width` and `--height` cover the intended resolution buckets.
- For HTTP multi-profile comparisons pass `--endpoints` with a JSON mapping
  from every requested profile to its separately configured endpoint. Passing
  a single endpoint with multiple profile labels is rejected.
- Pull completed artifacts with `modal volume get moss-bench <run-id> <local-dir>`.
  OCR CER, region IoU and human quality acceptance remain explicit evaluation
  gates using the stored images/fixture expectations; none is automatically
  inferred from timing or declared complete by the harness.
