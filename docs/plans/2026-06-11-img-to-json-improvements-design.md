# img-to-json Pipeline Improvements

## Problem

The image-to-JSON pipeline (local Qwen3-VL + SAM 3.1, external vision API) has several
correctness and quality issues relative to the Ideogram 4 prompting schema:

1. **Key-order bug** in `img-to-json/steps/json_builder.py` — `photo`/`art_style` appended after
   `color_palette` instead of before it.
2. **Duplicate object-name collision** — detection matching uses name as dict key.
3. **Verifier is too weak** — no key-order check, hex format, bbox sanity, palette limits.
4. **Verifier warnings dropped** — stderr only surfaces on subprocess failure.
5. **Prompt quality gap** — `global_analysis.txt` lacks specificity/element-count guidance
   that `vision_analysis.txt` has.
6. **No bbox fallback** from Qwen when SAM misses.
7. **Palette always 16 colors** — too many, dilutes color steering.
8. **No per-element palette** — doc supports up to 5 per element.
9. **`aspect_ratio` in vision prompt** — unused dead field.
10. **External path has no normalization/verification** — no clamping, key reorder, or warnings.
11. **First-run model download exceeds 120s timeout.**
12. **`response_format: json_object` not universal** — need fallback.
13. **No client-side image downscale** before upload.
14. **Pretty-printed JSON sent to RunPod** — training used compact format.

## Changes

### Phase 1 — Correctness
- Fix key order in `json_builder.py`
- Fix `text: null` fallback in `json_builder.py`
- Fix duplicate name matching to use index-based matching
- Drop `aspect_ratio` from `vision_analysis.txt`
- Minify JSON sent to RunPod at generation time

### Phase 2 — Shared normalization + verification
- Strengthen `caption_verifier.py` (key order, hex case, bbox sanity, palette limits)
- Add server-side `canonicalize_caption()` that reorders keys, clamps bboxes, uppercases hex
- Apply canonicalization + verification to both local and external paths
- Return warnings to frontend as toast

### Phase 3 — Quality
- Port specificity/element-count/desc guidance into `global_analysis.txt`
- Add Qwen VL bbox fallback for SAM misses
- Reduce default palette to 8 colors
- Add per-element palette extraction (crop bbox from original image)

### Phase 4 — Robustness
- Expose `--no-sam`, `--low-memory` flags via API
- Add `response_format` fallback for non-compliant providers
- Client-side image downscale before POST
- Handle first-run model download gracefully (extend timeout, emit status)

## Architecture

No new modules. Changes are isolated to:
- `img-to-json/steps/json_builder.py`
- `img-to-json/steps/qwen_analysis.py` (prompt swap)
- `img-to-json/utils/caption_verifier.py`
- `img-to-json/utils/palette.py`
- `img-to-json/prompts/global_analysis.txt`
- `img-to-json/prompts/vision_analysis.txt`
- `server.py`
- `src/vision.js`
- `src/json-builder.js`
