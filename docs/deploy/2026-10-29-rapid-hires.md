# Rapid through 4 MP

Production `yofarcorp/ideogram-builder` now uses `rapid-hires-auto-int8-cu128`, deployed with tag `rapid-hires-20261029`. Reload the local editor to fetch the new capabilities. [Deployment manifest and source checksums](2026-10-29-rapid-hires.json).

| Actual pixel area | Rapid steps | Verified dimensions |
| --- | --- | --- |
| ≤1,048,576 pixels (1 MP) | 4 | 1024×1024 |
| >1 MP through 2 MP | 6 | 1024×1536, 2048×1024 |
| >2 MP through 4 MP | 8 | 2048×2048 |

The policy uses actual area, independently of the toolbar tier name. For example, the existing **2M** toolbar button makes a 2048×2048 square, which is 4 MP and runs eight steps. Requests above 4 MP are rejected without resizing the prompt or switching presets. Draft3 retains its 1 MP limit.

The [adapter author's resolution guidance](https://huggingface.co/akhaliq/MOSS-Image-SFT-4-steps) recommends six to eight steps for larger images. This release keeps the pinned v2.0 adapter, strength 1, CFG 1, Euler/simple, INT8 DiT, W4A8 encoder, small VAE, CUDA 12.8, auto residency, and compilation off. Fast, Quality, and Turbo sampling settings are unchanged. Model weights and dependency images were reused.

## Evidence

- **203 backend tests**, **493 frontend tests** passed. After adding `cache: no-store` to capability requests, all 54 affected backend-caller/queue/capability lifecycle frontend tests passed again.
- The preview deployment completed seven image requests: Rapid at 1, 1.5, 2, and 4 MP (both layout and caption at 4 MP), followed by Turbo and Rapid. Dimensions, resolved step counts, seeds, adapter identity, runtime profile, and complete timing metadata matched. All seven ran on one worker. [Preview report](../../output/rapid-hires-preview-20261029/smoke-report.json).
- Production repeated all seven requests successfully and rejected 2048×2064 (4.03 MP). The production capability response advertises `max_area_mp=4` and the 4/6/8-step policy. [Production report](../../output/rapid-hires-production-20261029/smoke-report.json), [capabilities](../../output/rapid-hires-production-20261029/capabilities.json).
- Concurrent editor verification caused production to use two workers. The first harness incorrectly required all seven requests to use one worker. Its [original report](../../output/rapid-hires-production-20261029/smoke-report-original-topology-check.json) is retained. The corrected check verifies an actual Turbo (`dmd8`) → Rapid (`rapid4`) replacement on the same worker; the recorded production results provide that witness. Unit tests reject a cross-worker pair as evidence of a resident switch.
- The real editor accepted a plain caption at 2048×2048 and saved an image whose metadata records `Rapid`, eight steps, `rapid4`, and the new production profile. [Saved metadata](../../output/img_20261029_073603_643941.png.meta.json), [editor screenshot](../../output/rapid-hires-production-20261029/gui-2048.jpg).
- Visual inspection of the preview's 4 MP poster found readable “DESIGN SUMMIT 2026” and “OCT 27 · 09:00”. Its 4 MP fox photograph showed one intact subject with no obvious grid tiling or washed-out haze. This is a bounded smoke and visual check, not a formal CER/IoU benchmark or a quality guarantee across prompts and user LoRAs.

Images and detailed execution metadata are retained under the ignored `output/rapid-hires-{preview,production}-20261029/` folders. The production GUI image is also available in the normal gallery. Source was deployed from the uncommitted workspace; the manifest records the base revision and hashes rather than claiming a clean Git release.

## Rollback

The old `rapid-auto-int8-cu128` profile still explicitly limits Rapid to 1 MP, including benchmark requests. To restore that configuration with the current sources:

```sh
MOSS_APP_NAME=ideogram-builder MOSS_RUNTIME_PROFILE=rapid-auto-int8-cu128 \
MOSS_RUNTIME_BUILD=baseline MOSS_EXPERIMENTAL_PRESETS= \
MOSS_CACHED_IMAGE_ID=im-C6CYVuLZL3PDP7CmANZGPp \
IDEOGRAM_CACHED_IMAGE_ID=im-jAh6cs2wwMnYugf5Zhz6Qs \
modal deploy runpod/modal_app.py --env main
```

No credential or endpoint URL change is required. The broader `baseline` profile remains available if Rapid must be disabled entirely.
