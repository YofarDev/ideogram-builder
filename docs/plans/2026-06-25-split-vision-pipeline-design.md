# Split Vision Pipeline — Design

## Goal

Add a second image→JSON workflow alongside the existing one, switchable via a UI
toggle, so the two can be A/B compared for output quality. Both produce the
**exact same Ideogram4 JSON schema**; only the method differs.

### Guiding principle (validated by SAM3 docs)

> **VLM = discovery + caption. SAM3 = localization. The VLM never emits coordinates.**

SAM3 (`mlx-community/sam3.1-bf16`, already wired in `models/sam_loader.py`) is a
promptable concept segmenter: text phrase in, masks + boxes out. It cannot,
however, discover *what* is in an image — you must hand it a phrase. So the VLM's
irreducible job is open-vocabulary concept discovery and captioning; SAM3 owns
localization. The current baseline asks the VLM for bboxes too (used as fallback
when SAM misses); the split workflow removes that, since SAM3's boxes are
strictly better than a 4B VLM guessing coordinates.

## Decisions (locked during brainstorm)

| Decision | Choice |
|----------|--------|
| VLM call structure | **Two sequential calls**: scene, then objects |
| Style placement | In the scene call |
| SAM-miss handling | **Drop the element entirely** (every element is guaranteed spatial) |
| Comparison UI | Toggle; run one pipeline at a time |
| Implementation shape | **Separate pipeline module + new prompts** (baseline frozen) |

## Architecture

### File layout

| Action | File | Purpose |
|--------|------|---------|
| new | `img-to-json/pipeline_split.py` | New `run()` orchestrating scene call → object call → SAM → drop-misses → build_json |
| new | `img-to-json/prompts/scene_analysis.txt` | Call 1 prompt (scene-level fields only) |
| new | `img-to-json/prompts/object_listing.txt` | Call 2 prompt (SAM-friendly object list, no bboxes) |
| edit | `img-to-json/main.py` | Add `--split` CLI flag → routes to `pipeline_split.run` |
| edit | `server.py` | Read `pipeline` from request body; append `--split` to subprocess |
| edit | `src/vision.js` | Pipeline dropdown; send `pipeline` field; hide `--no-sam` when split |
| edit | `index.html` | Pipeline `<select>` in vision toolbar |
| **frozen** | `pipeline.py`, `prompts/global_analysis.txt`, `steps/*`, `models/*`, `utils/*`, `steps/json_builder.py` | Baseline + shared steps untouched — editing these invalidates the comparison |

### Reuse contract

`steps/json_builder.build_json(palette, analysis, detections, element_palettes)`
is **reused unchanged**. Split assembles the same intermediate shapes before
calling it, so output formatting is identical and the comparison is purely about
content quality:

- `analysis` = scene-call output merged with object-call output. `analysis.objects[i].bbox`
  is absent/`None` for all entries (VLM emits no coordinates).
- `detections` = SAM results, filtered to drop misses, **index-aligned** with
  `analysis.objects`.

Per-element palettes cropped from SAM bboxes via `utils.palette.extract_palette_from_region`,
fed into the `element_palettes` dict — identical to current behavior.

## The two VLM calls

### Call 1 — scene (`scene_analysis.txt`)

Returns exactly:

```json
{
  "high_level_description": "<1-2 sentences, subjects + setting + counts, no style/gesture>",
  "background": "<detailed background environment>",
  "style": {
    "medium": "<photograph|illustration|graphic_design|3d_render|painting>",
    "aesthetics": "<comma-separated keywords>",
    "lighting": "<lighting description>",
    "photo_or_art": "<camera/lens if photo; art style otherwise>"
  }
}
```

The `style` sub-shape mirrors `global_analysis.txt` so `build_json`'s
photo-vs-art branch works unchanged. No `objects` key, no bboxes.

### Call 2 — objects (`object_listing.txt`)

Returns a list, each entry:

```json
{ "name": "<singular concrete noun phrase>", "desc": "<30-60 words>",
  "has_text": false, "visible_text": null }
```

**No `bbox` field.** Call 2's purpose is *concept discovery for SAM3* — generate
the noun phrases SAM will ground, plus descriptions. Prompt rules lifted from
`global_analysis.txt` (desc guidelines, text handling, specificity/no-hedge) so
element quality matches the baseline, plus SAM-groundability constraints:

- `name` = singular concrete noun SAM3 can segment ("wine glass", "dog"), never
  plurals or group nouns ("crowd", "flowers")
- one distinct visual region per entry; no sub-parts ("person's hand" → segment
  "person")
- merge scattered/dense groups into one entry (moves the existing group-skip
  heuristic upstream into the prompt)
- keep text-element rules (literal `visible_text`, placement-only `desc`)

## SAM + drop-on-miss

Reuse `steps/sam_detection.sam_detect(image_padded, names, vlm_bboxes=None)`
unchanged. Two judgment calls:

- **`vlm_bboxes=None`** makes multi-instance proximity matching degenerate
  (order-based). Acceptable: two same-name objects + two SAM boxes → index-order
  assignment; one SAM box → second object dropped. Cheaper than a new module,
  and `_center(None)→None` / `_distance→inf` prevent crashes.
- **Drop in `pipeline_split`, not `build_json`:** filter `analysis.objects` and
  `detections` in lockstep, keeping only `det["bbox"] is not None`, *then* call
  `build_json`. Keeps `build_json` generic (it would otherwise emit bbox-less
  elements, which the drop-on-miss decision forbids).

`low_memory` mode unloads Qwen between call 2 and SAM (same gc + metal cache
clear as today, now placed after the object call).

## Debug artifacts

Same `utils/debug_logger.DebugLogger` (no-op when disabled). Timestamped dir,
surfaced as a link via the existing `[debug_dir]` stderr marker. Subdirs:

```
01_preprocess/   result.json, image_padded.png
02_scene/        system_prompt.txt, user_message.txt, raw_response.txt, parsed.json
03_objects/      system_prompt.txt, user_message.txt, raw_response.txt, parsed.json
04_sam/          input_image_padded.png, detection_<name>.json (per unique name),
                 sam_boxes.png (kept boxes, colored),
                 dropped_elements.json   ← {name, desc, reason} for every SAM miss
05_palettes/     <name>_crop.png, <name>_palette.json
05_final/        caption.json
```

`dropped_elements.json` is the key experiment instrument — it shows whether
drop-on-miss trims noise or loses real content. The baseline already draws all
SAM boxes; split adds the explicit drops ledger.

## Server wiring

`POST /api/img-to-json` body gains `pipeline` (`"current"` default | `"split"`).
When `model == "local"` and `pipeline == "split"`, append `--split` to the
`uv run main.py` cmd. Canonicalize/verify/debug-dir surfacing reused unchanged.

`--no-sam` is **incompatible with split** (SAM mandatory — dropping misses is
the premise). Frontend hides the `--no-sam` checkbox when Split is selected; if
the flag arrives anyway, split forces SAM on and ignores it.

## Frontend

Pipeline `<select>` in the vision toolbar next to the model selector:

- Only visible when a **local** model is selected (external providers = single-shot,
  no SAM, split doesn't apply).
- Selecting **Split** hides `--no-sam` (mandatory SAM); keeps `--low-memory` + `--debug`.
- Persisted to `localStorage.vision_pipeline` (matches existing persistence pattern).
- Sends `pipeline` in POST body.

**Response shape is identical**, so the existing load-into-editor flow
(`emit state:loaded`, canvas rebuild, aspect-ratio pick) is reused untouched.

## Out of scope

- External-provider split (no SAM available remotely — single-shot stays).
- SAM3 "segment everything" + per-mask captioning (heavier and worse for
  image→prompt; promptable discovery via VLM is the right fit).
- Any change to the baseline pipeline or `global_analysis.txt` (would invalidate
  the comparison).
