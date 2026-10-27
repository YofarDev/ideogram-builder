# MOSS inference optimization — rollout and validation runbook

Companion to the [implementation plan](2026-10-27-moss-inference-optimization-implementation.md)
and the [research findings](../research/2026-10-27-moss-inference-optimization.md).
This runbook covers what code cannot decide for us: everything that must be
measured on the actual Modal RTX PRO 6000 deployment before candidate presets
and profiles are promoted.

**Status (2026-10-27):** all code, configuration, fixtures, benchmarks and
tests are implemented and green locally. Every GPU-dependent gate below is
PENDING — no candidate preset is advertised until its gate passes on the real
deployment. The shipped default behaviour is unchanged: baseline profile,
original three presets, no Spectrum, no compile, no warmup.

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
as the startup diagnostic / `runtime_check.py`):

```python
python /runtime_check.py --json     # torch CUDA build, comfy-kitchen backends,
                                    # ComfyUI/rgthree/Spectrum revisions, GPU name/capability
```

Paste both into the `observed` block of `runpod/moss-runtime.lock.json` and
this file. **The deployment baseline is authoritative** if it differs from the
checkout; document the difference before changing either. Known open
hypothesis: the deployed torch build may be cu126, which would disable the
comfy-kitchen CUDA backend (`comfy/quant_ops.py` hard-gates at cu130) — the
startup diagnostic prints exactly this.

### Baseline images and timings — PENDING

Run the benchmark against the current deployment with unchanged settings:

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

1. Build the candidate runtime image (defaults unchanged):
   `docker build -f runpod/Dockerfile.moss -t moss-candidate .` — verify with
   `pip check`, import checks, and `python /runtime_check.py --check-accelerated`.
2. Deploy candidate under a NEW app name, benchmark Fast/Quality/Turbo with
   precision and sampler settings unchanged.
3. Only after A passes, test a separately pinned ComfyUI v0.43.0 build:
   `--build-arg COMFY_REVISION=v0.43.0` — record memory/compat effects
   independently; never credit the dependency upgrade with runtime gains.

**Gate:** no unexplained kernel fallback; all three original presets work;
quality gates (below) pass vs the frozen baseline.

### Stage B — residency and precision (plan Phase 3)

```sh
# one variable at a time; never combine --highvram with --gpu-only
modal run runpod/modal_app.py::moss_benchmark_main --profiles resident-auto-int8,resident-highvram-int8,resident-gpuonly-int8 --presets Fast
# then DiT precision at the winning residency, then encoder precision
modal run runpod/modal_app.py::moss_benchmark_main --profiles dit-bf16-highvram-w4a8,dit-bf16-highvram-int8enc,dit-int8-highvram-bf16enc --presets Fast
# cross-check the runner-up combination; repeat with --cached-prompt for the
# text-encode-cached case and with a representative user-LoRA set attached
```

Populate candidate weights first (CPU-only, explicit keys):

```sh
modal run runpod/modal_app.py::moss_populate_models --keys dit_bf16,enc_int8_convrot,enc_bf16
```

**Gate:** measured residency/precision combination with stable long-prompt and
LoRA behaviour and adequate VRAM headroom; runner-up + baseline retained.

### Stage C — Rapid and Draft3 (plan Phase 4)

```sh
modal run runpod/modal_app.py::moss_populate_models --keys adapter_rapid4,adapter_draft3,adapter_rapid4_fp32
modal run runpod/modal_app.py::moss_benchmark_main \
  --profiles resident-highvram-int8-adapters --presets Rapid,Turbo,Fast \
  --fixtures poster_en_bold,menu_bilingual_cafe,small_numbers_gauge,tiny_labels_panel --seeds 101,202,303
```

- Fine-text precision: compare the merged BF16 adapter against the FP32
  reference (`adapter_rapid4_fp32`) on the tiny-text fixtures; do not accept
  the merged variant on faith.
- Area policy: `Rapid` steps are 4 (≤1 MP) / 6 (≤2 MP) / 8 (≤4 MP); `Draft3`
  3 steps ≤1 MP. Buckets are project policy — advertise a bucket only after it
  passes; unsupported sizes error out (never silently resized).
- Combinations: no-LoRA, one LoRA, multi-LoRA, consecutive preset switches.

**Gate:** Rapid passes text/layout criteria with a clear warm-latency gain vs
Turbo. Draft3 is explicitly preview-quality; it never replaces a final preset.
Promotion = flip `resident-highvram-int8-adapters` (or the winner profile) to
`status: "validated"` in `runpod/moss_config.py`; `/capabilities` and the UI
pills follow automatically on the next deploy.

### Stage D — Spectrum (plan Phase 5)

Compare on the winner profile: (1) Fast with original SLG 0–0.5, (2) Fast with
full SLG 0–1, no Spectrum, (3) `FastSpectrum`; plus Quality ± `QualitySpectrum`.
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
already mount at `/moss-compile-cache` (namespaced by torch/Triton/profile via
env); verify reuse on a fresh container before counting savings. Compute
break-even: `additional startup cost / warm saving per request`. Spectrum +
compiler combination LAST.

**Gate:** session-level win, not just warm microbenchmark.

### Stage F — cold starts, warmup, snapshots (plans Phases 7–8)

Compare `MOSS_SCALEDOWN_SECONDS` 300/600/1200 at `min_containers=0` and one
always-warm worker (`MOSS_MIN_CONTAINERS=1`) over representative idle gaps.
`MOSS_WARMUP=true` moves (not removes) init cost — compare complete
submission-to-image time. Snapshots (`MOSS_SNAPSHOT_MODE=gpu_experimental`)
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

- Client keeps serving the last-known capability list; unadvertised presets
  are hidden, and a restored session selecting an unavailable preset keeps the
  saved recipe but requires a supported choice before submission.
- Server: redeploy with `MOSS_RUNTIME_PROFILE=baseline` (and the previous
  image tag) — the original three presets continue unchanged.
- Candidate candidates stay disabled with their benchmark results recorded; a
  failed gate is a documented outcome, not a silent revert.

## Files promoted per outcome

| Outcome | Files to flip |
| --- | --- |
| Residency/precision winner | `runpod/moss_config.py` profile `status` (+ description), redeploy with `MOSS_RUNTIME_PROFILE=<winner>` |
| Rapid/Draft3 validated | winner profile `enabled_presets` += candidates; `status: "validated"` |
| Spectrum validated | same mechanism (`FastSpectrum`/`QualitySpectrum`) |
| Compile wins | winner profile `compile_backend` field (declared profile, not an override) |
| Model/adapter/runtime change | new `manifest_id`/`lock_id` + relevant regression subset rerun |

An upstream update never silently replaces a benchmarked adapter or
dependency: changing `moss-models.json` or `moss-runtime.lock.json` revisions
creates a new profile/manifest identity and re-triggers the regression subset.
