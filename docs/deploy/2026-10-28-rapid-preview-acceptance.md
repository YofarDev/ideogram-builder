# Rapid β preview — historical Milestone A acceptance report

**Release update:** the user subsequently approved permanent Rapid. It is now deployed to production without experimental opt-in; see [the production release report](2026-10-28-rapid-production.md). The preview and benchmark status below describe their recorded point in time.

Date: 2026-10-28. Plan: [2026-10-28-moss-rapid-four-step-gui.md](../plans/2026-10-28-moss-rapid-four-step-gui.md).

## Deployment

| Field | Value |
| --- | --- |
| Workspace / app | `yofarcorp` / `ideogram-builder-rapid-preview` (candidate; production `ideogram-builder` untouched) |
| Endpoint | `https://yofarcorp--ideogram-builder-rapid-preview-web-app.us-east.modal.run/generate` |
| Runtime profile | `rapid-auto-int8-cu128` (candidate): INT8 convrot DiT + W4A8 encoder, auto residency, no compile/warmup, eager kernels tolerated |
| Experimental opt-in | `MOSS_EXPERIMENTAL_PRESETS=Rapid` |
| Image reuse | MOSS `im-C6CYVuLZL3PDP7CmANZGPp` + 15-file source overlay; Ideogram `im-jAh6cs2wwMnYugf5Zhz6Qs` + 3-file overlay — no weights rebuild |
| Adapter | `adapter_rapid4` = akhaliq `moss_image_sft_4step_v2.0.safetensors` @ `2ded95c3…`, SHA-256 verified, populated on the `moss-models` volume via the CPU maintenance entrypoint |
| Rollback | `preview_rollback_endpoint_url` in `~/.config/llm-credentials.json`; production app unchanged |

Deployment manifest: [deployment manifest JSON](2026-10-28-ideogram-builder-rapid-preview.json). It records the deployed source revision separately from later documentation commits.

## Current review fixes and measured comparison

The review fixes were committed and deployed at `8595cd8`, with a fresh full
same-worker switching and oversize-rejection smoke passing. A live benchmark
then caught a warmup/input-key collision. Commit `3047de1` fixes it and adds a
regression test; that source is pushed and deployed as `git-3047de1` using the
cached images. **184 Python + 393 frontend tests passed.**

The restarted comparison completed **108/108 measured images plus 36 warmups**.
The final audit found no missing jobs, execution errors, positive-encoder cache
hits, invalid PNGs or incorrect recipes. All images are 1024².

| Preset | Warm steady worker median |
| --- | --- |
| Rapid | 3.500 s |
| Turbo | 5.733 s |
| Fast | 24.840 s |

Rapid was faster in all 34 comparable steady pairs against each baseline:
median paired savings **41.3% / 2.329 s versus Turbo**, **85.6% / 21.195 s versus
Fast**. A separate three-pair English-poster HTTP check saved a median paired
**16.2% / 1.698 s**, including polling/image transfer. Worker medians exclude
HTTP and cold startup; switched requests are reported separately.

[Full benchmark evidence and quality limits](rapid-benchmark-2026-10-28/README.md)
include raw JSONL, pair tables, runtime, image hashes, OCR screening and the
human review sheet. Images/workflows persist on `moss-bench` under
`run-20261028-083751-755837dd`; the local comparison gallery is
`output/benchmarks/rapid-3047de1/comparison.html`.

**Speed gate passed; quality acceptance remains pending.** Regional OCR flags a
possible text regression, but checks of several worst differences show OCR
recognition errors on visibly correct text. Checked transcriptions, observed
region annotations and usability/visual review are still required. Rapid stays
experimental on the preview; production remains unchanged.

## Milestone A evidence — initial smoke (PASSED)

These historical bring-up checks from `runpod/smoke_rapid_preview.py` passed; artifacts in
[rapid-smoke-artifacts/](rapid-smoke-artifacts/) (images + `smoke-report.json`):

- **Capabilities**: Rapid advertised with `validation_status="experimental"`,
  `max_area_mp=1`, recipe 4 steps / CFG 1 / euler. Fast/Quality/Turbo unchanged.
- **Oversize rejection**: Rapid at 1024×1536 rejected with
  `"Preset 'Rapid' supports up to 1 MP; requested 1024×1536 (1.50 MP) is above the limit…"`.
- **Same-worker switching** (worker `modal-05947005c122-2`, unique per-process id):
  Turbo (8 steps, `dmd8`) → Rapid (4 steps, `rapid4`) → Turbo → Rapid with the
  correct adapter on every result and no cross-contamination; fully cached
  repeats of identical requests returned in ~1.4 s without corruption.
- **Visual inspection** (not just PNG-byte existence):
  - English poster (Rapid, seed 101): `DESIGN SUMMIT 2026` / `OCT 27 · 09:00` exact; layout adhered.
  - Chinese poster (Rapid, seed 202): `春茶上新` / `明前龙井限量发售` exact; seal placed correctly.
- **First-use latency observations** (single seeds, not a benchmark): Rapid
  worker total 2.5–3.3 s (sampler ≈2.3 s) vs Turbo 4.8–25 s depending on cache
  state, on the same worker.

### Bug found and fixed during smoke

The first Chinese-poster renders (Turbo **and** Rapid) were garbled
digit/character mixtures. Root cause was **not** the adapter: the benchmark
fixture compiler used `json.dumps` with `ensure_ascii=True`, so the encoder
received literal `\uXXXX` escape text (the GUI's `JSON.stringify` sends raw
UTF-8). Fixed in `moss_benchmark.compile_fixture_layout` +
`ensure_ascii=False`, regression test added
(`test_fixture_compilation_keeps_cjk_as_raw_utf8_like_the_ui`), preview
redeployed, and both presets then rendered the Chinese text exactly. The
pre-fix images are preserved in the artifacts for the record
(`switch1-rapid-poster_zh_vertical.png`, `cross-turbo-poster_zh_vertical.png`).

## Status against the plan

| Milestone | Status |
| --- | --- |
| **A — working experimental Rapid in the GUI** | **Reached.** The preview endpoint advertises Rapid β; the local GUI is pointed at it (`llm-credentials.json` now selects the preview URL with the production URL retained for rollback). Select model MOSS → preset Rapid β (≤1 MP canvas) and generate; queue/gallery metadata records the executed recipe. |
| **B — validated production availability** | 108-image comparison completed; speed gate passed. Checked CER/IoU/usability quality evidence and §7 promotion remain pending. Rapid remains experimental and absent from the production endpoint. |

## Reproducing the comparison and remaining Milestone B work

1. **Completed comparison.** Reproduce through the preview app (fixtures × 3 paired seeds ×
   Rapid/Turbo/Fast = 108 measured images, ≤45 min submission budget):

   ```sh
   MOSS_APP_NAME=ideogram-builder-rapid-preview \
   MOSS_RUNTIME_PROFILE=rapid-auto-int8-cu128 \
   MOSS_RUNTIME_BUILD=baseline MOSS_EXPERIMENTAL_PRESETS=Rapid \
   MOSS_CACHED_IMAGE_ID=im-C6CYVuLZL3PDP7CmANZGPp \
   IDEOGRAM_CACHED_IMAGE_ID=im-jAh6cs2wwMnYugf5Zhz6Qs \
   modal run --env main runpod/modal_app.py::moss_benchmark_main \
     --profiles rapid-auto-int8-cu128 --presets Rapid,Turbo,Fast \
     --seeds 101,202,303 --width 1024 --height 1024 \
     --max-jobs 108 --max-minutes 45
   ```

   The profile, three seeds, image IDs and budget are deliberate. Omitting
   them selects the baseline/five-seed defaults or rebuilds heavy images.
   Warmups are additional generations, persisted in `warmups.jsonl`; the
   45-minute limit stops new submissions and is not a hard billing deadline.
   Use the recorded graphs/runtime and review sheet for acceptance evidence.
2. Manual review of the review sheet; OCR CER and IoU where annotated.
3. Promotion gates from the plan; if fine-text regressions appear, evaluate the
   BF16 DiT reference profile (`bf16-adapters`) with its own truthful gates.
4. §7: flip `validated_presets["Rapid"]=1` on the winning profile, redeploy
   production, verify `/capabilities` + one real GUI generation + regression
   smoke of an existing preset; restore the production URL.
