# Rapid preview — measured comparison

**Subsequent release decision:** the user visually accepted these results and requested permanent availability. [Rapid is now deployed to production](../2026-10-28-rapid-production.md) on the same CUDA 12.8 runtime. The numerical quality scores below remain screening evidence; no missing metric has been reclassified as measured.

Deployed source: `3047de1ec8c417e5b34621d1927c797643f567df` (`git-3047de1`). Branch: `feat/rapid-four-step-gui`. Preview app: `yofarcorp/ideogram-builder-rapid-preview`.

**108/108 measured images completed**, plus 36 separately recorded warmups. Rapid beat Turbo in 34/34 comparable steady pairs, with median paired saving **2.329 s (41.3%)**. It beat Fast in 34/34 pairs, saving **21.195 s (85.6%)**.

**Status: speed gate passed; quality acceptance remains incomplete. Rapid stays experimental in the preview. Production remains on baseline without Rapid.**

## Main comparison

Hardware: NVIDIA RTX PRO 6000 Blackwell Server Edition. Runtime: PyTorch 2.10.0+cu128, CUDA 12.8, comfy-kitchen 0.2.40. Profile `rapid-auto-int8-cu128`: INT8 DiT + W4A8 encoder, auto residency, automatic startup warmup and compilation off. Benchmark warmup requests are additional to the profile settings.

Twelve existing fixtures × seeds 101/202/303 × Rapid/Turbo/Fast, every image 1024×1024. Recipes: Rapid 4 steps/CFG 1/euler/rapid4; Turbo 8 steps/CFG 1/euler/dmd8; Fast 25 steps/CFG 2.5/er_sde/no adapter. These are different quality recipes, not a quality-equivalence claim.

| Preset | Measured / steady | Worker median (s) | Sampler median (s) | Positive encode median (s) | Sampled device peak (GiB) |
| --- | --- | --- | --- | --- | --- |
| Rapid | 36 / 34 | 3.500 | 2.103 | 0.819 | 12.596 |
| Turbo | 36 / 34 | 5.733 | 4.288 | 0.937 | 12.564 |
| Fast | 36 / 34 | 24.840 | 23.088 | 0.937 | 12.596 |

Primary timing is warm worker wall time, excluding Modal/GPU/server startup, HTTP, polling and image transfer. Node times are estimates from serial node transitions, not CUDA kernel profiling. Device memory is sampled every 0.5 s, device-wide, and can miss short peaks. No p95 or throughput claim.

Cold first-generation, switched and incomplete samples are excluded from steady comparisons; paired rows require the same fixture, seed and worker. All measured requests share worker `modal-f214ebaf306b-2`. Two switch samples per preset are retained separately:

| Preset | Switch samples | Switched worker median (s) |
| --- | --- | --- |
| Rapid | 2 | 6.650 |
| Turbo | 2 | 9.623 |
| Fast | 2 | 24.927 |

Every per-fixture row below retains the paired sample count. The first fixture has only one steady pair because the first request in each later preset block is a switch. The remaining fixtures have three.

| Fixture | Pairs vs Turbo | Rapid saving (ms) | Rapid saving (%) |
| --- | --- | --- | --- |
| poster_en_bold | 1 | 2919.0 | 45.4 |
| poster_zh_vertical | 3 | 871.0 | 14.8 |
| menu_bilingual_cafe | 3 | 4494.3 | 56.2 |
| small_numbers_gauge | 3 | 1980.6 | 36.3 |
| dense_json_dashboard | 3 | 2280.8 | 41.5 |
| multi_subject_street | 3 | 2550.8 | 43.8 |
| hands_closeup_craft | 3 | 2895.7 | 43.4 |
| illustration_storybook | 3 | 2732.8 | 38.3 |
| photo_natural_portrait | 3 | 2562.5 | 45.3 |
| photo_natural_landscape | 3 | 1819.2 | 36.4 |
| tiny_labels_panel | 3 | 2231.9 | 41.1 |
| long_prompt_stress | 3 | 979.1 | 18.1 |

## HTTP corroboration

Six additional measured requests, three paired seeds (1101/1202/1303), one English-poster fixture, Rapid/Turbo. Preset order alternates by seed; four unmeasured warmups absorb startup/switching. All pairs use the same serving worker. This CLI submit/poll check includes image transfer and one-second polling; it is not a browser GUI measurement or a broad latency distribution.

| Preset | Requests | HTTP median (s) | Worker median (s) |
| --- | --- | --- | --- |
| Rapid | 3 | 7.291 | 3.252 |
| Turbo | 3 | 9.742 | 5.070 |

Rapid was faster in all three HTTP pairs. Median **paired** saving: 1.698 s (16.2%). The difference between the two separate medians is a different statistic. The first Rapid warmup took 121.802 s including cold startup; it is excluded from these warm medians and preserved in `http-results.json`.

## Integrity and quality

- All 108 PNGs decode and are 1024²; one output per required matrix job, no duplicates or missing jobs.
- All 108 timings are complete; no execution errors or positive-encoder cache hits. Saved graphs match requested steps, CFG, sampler, scheduler, adapter and seed; returned metadata identifies the requested runtime profile. Chinese graph inputs contain raw UTF-8.
- All 36 warmups completed and are stored separately. Six measured switch requests remain outside the steady medians.
- Tests: **184 Python** and **393 frontend** passed. Full serving-path smoke at 8595cd8 passed same-worker Turbo→Rapid→Turbo→Rapid and oversize rejection. The only later runtime-source change, 3047de1, fixes benchmark warmup inputs; its HTTP check passed.
- Agent visual spot checks of seed-101 Rapid Chinese text, percentages, dashboard values and tiny serial labels appeared correct. This is not a scored human review of the full matrix.
- Tesseract 5.5.3 offline screening covers the 72 images with expected text. Whole-page and declared-text-box transcriptions, raw CER, model hashes and methods are retained. OCR misreads visible text, inserts CJK spacing, includes decorative text, and can truncate text in fixed crops; these are screening measurements, not accepted human transcription scores.

Automated screening scores are retained without treating them as accepted quality scores:

| OCR method | Rapid CER | Turbo CER | Fast CER |
| --- | --- | --- | --- |
| Whole page | 111.74% | 134.83% | 104.12% |
| Declared text regions | 32.81% | 27.93% | 27.93% |

The regional result flags a **4.87 percentage point** disadvantage for Rapid and cannot support a non-regression claim. Visual inspection of several largest differences found correct text that OCR missed: the seed-202 bakery sign, seed-202/303 English poster dates, and seed-202 Chinese headline. This demonstrates recognition/cropping errors in this screening method; it does not establish a passing whole-suite CER. The conflicting OCR methods require checked transcriptions before a quality decision. CER uses casefolding and collapsed whitespace, edit distance divided by reference characters; insertions can make it exceed 100%.

- Layout IoU is **unmeasured**: observed regions have not been annotated. Some fixture boxes extend beyond the normalized canvas (for example dashboard Churn), and the production-compatible compiler clamps them. No IoU is inferred from visual impressions or supplied target boxes.
- Text CER non-regression (≤1 percentage point), layout IoU (≤0.02 decline when measured), usable-image rate (≤5 percentage point decline), and faces/hands/naturalness acceptance remain pending. No production promotion is justified yet.

## Rejected attempt and correction

Run `run-20261028-082000-08348eae` was stopped with 52 committed measured records. Its warmup input used variant 5, which collided with all 12 Turbo seed-202 inputs. Those cached encodes would bias the comparison. None of that run is included in the accepted timing results.

Commit 3047de1 moves warmup inputs beyond the complete measured variant range (`seeds × configs + 1`: 10 versus measured 1…9). A regression test checks that all warmup and measured encoder inputs are disjoint while parsed layouts remain equal. The complete 108-image matrix was restarted; real cache records verify the fix. Rejected records remain available for audit.

## Artifacts and reproduction

- Accepted volume: `moss-bench:/run-20261028-083751-755837dd/` (108 images, exact workflows, runtime, JSONL and review sheet).
- [Modal run](https://modal.com/apps/yofarcorp/main/ap-zCdQtdLObhCaWOGyJIN3bs).
- [Local image comparison gallery](comparison.html), backed by original PNGs in `output/benchmarks/rapid-3047de1/`; the original analysis/OCR helpers also live in that output folder. Images are intentionally kept outside Git; `image-manifest.json` records their hashes.
- This directory retains raw measured/warmup records, pairing tables, runtime, OCR screening, HTTP evidence and a blank human review sheet. Raw output image paths refer to the recorded volume.
- Exact environment, immutable base image IDs, seeds and budget: `invocation.json`. The complete repeat command is in [the acceptance report](../2026-10-28-rapid-preview-acceptance.md). The 45-minute limit stops new submissions; it is not a hard billing cap.
- The deployed source stays 3047de1. Later documentation-only commits do not require a redeploy.

To fetch the saved artifacts into the ignored output folder and reproduce the integrity checks and paired tables from the repository root (Modal authentication required for download):

```sh
uv run --with modal==1.6.3 python docs/deploy/rapid-benchmark-2026-10-28/download.py
uv run --with pillow --with requests python docs/deploy/rapid-benchmark-2026-10-28/analyze.py output/benchmarks/rapid-3047de1/run-20261028-083751-755837dd
```

The analysis helper is intentionally specific to this recorded 12-fixture, three-seed matrix. It exits unsuccessfully on missing jobs, wrong recipes, cached positive encoding, missing images/workflows or incomplete timings. OCR screening methods and model identities are recorded in `ocr-metadata.json`; original OCR helpers remain in the local output folder.
