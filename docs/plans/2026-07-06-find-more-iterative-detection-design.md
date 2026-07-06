# Find-more iterative detection — design

## Problem
Dense images (e.g. 40 people) get only a few bounding boxes. Two root causes:

1. `object_listing.txt` caps coverage ("Aim for 3-20 elements").
2. `sam_detection.py` keeps only top-N boxes per name, where N = how many times the VLM emitted that name (`count = name_counts[name]`). If the VLM lists "person" 5 times, SAM discards the other 35.

So the VLM's listing count is the hard ceiling on boxes.

## Approach (chosen)
**Interactive, user-steered iterative detection.** After the first process, the user clicks
"Find more". One detection round runs, **seeded with the items already found** so the VLM
returns only NEW instances. New boxes merge in. The user repeats until satisfied or a round
returns nothing new.

Why this over alternatives:
- **Tiled detection** — more reliable for extreme density but hard merge (NMS across tiles,
  people straddling borders) and N× cost. Bigger build. Deferred.
- **Class-census prompt** — VLMs can't count past ~10-15 reliably. Rejected.

Both local (Qwen) and cloud (VLM API) paths get it.

## Flow
1. `POST /api/img-to-json` → first caption (unchanged).
2. User clicks **Find more** → `POST /api/img-to-json/more` with current image + current JSON.
3. Backend: one "find more" VLM round seeded with existing item descs → new objects → SAM
   localizes them → build_json → extract `elements` → **dedup** vs existing by IoU → return
   `{new_elements, total}`.
4. Frontend appends `new_elements` to `compositional_deconstruction.elements`, re-emits
   `state:loaded` (canvas re-renders), shows `+N new · M total`.
5. Repeat. Empty round → "Likely complete", button dims.

## Backend
`_handle_vision_more(body)` in `server.py`, route `/api/img-to-json/more`.

- **Seed** = `[{desc}]` extracted from existing JSON elements.
- **Scene override** reconstructed from existing JSON (only `elements` are used from output;
  scene is placeholder).
- **Local path**: subprocess `main.py --split --scene-file <scene> --objects-more <seed>`
  → pipeline_split runs the more-prompt VLM call seeded with the list, then SAM + build.
- **Cloud path**: `_cloud_vlm_chat` with `object_listing_more.txt` (seed in user message)
  → new objects → subprocess `main.py --split --scene-file <scene> --objects-file <new>`
  (existing mechanism) for SAM + build.
- Both output a caption; `_handle_vision_more` extracts
  `compositional_deconstruction.elements`, then `dedup_new(new, existing, iou=0.5)` drops
  any new element whose box IoU-overlaps an existing one. Cross-name overlaps are kept (IoU
  threshold is high enough that only near-duplicates drop).

## Files
| File | Change |
|---|---|
| `img-to-json/prompts/object_listing_more.txt` | NEW — "find additional instances not in this list" |
| `img-to-json/utils/dedup.py` | NEW — `dedup_new(new, existing, iou=0.5)` |
| `img-to-json/main.py` | `--objects-more <seed-file>` flag (split branch) |
| `img-to-json/pipeline_split.py` | `objects_more` param → more-prompt VLM call |
| `server.py` | `_handle_vision_more` + `/api/img-to-json/more` route; import dedup |
| `src/vision.js` | Find-more button, /more call, merge, loop status |
| `index.html` | `#btn-vision-find-more` button + styles |

## Non-goals (MVP)
- No tiling, no SAM "segment everything", no auto-convergence.
- First-pass prompt stays capped; "Find more" is the depth lever.
- SAM top-N-per-name unchanged. If dedup eats too many results in practice, the upgrade is
  "SAM returns all detections + exclude-existing matching" — `ponytail:` note in code.

## Element schema note
Final caption elements have `{type, desc, bbox, [text], [color_palette]}` — **no `name`**.
So dedup is IoU-only (no name). The more-prompt seed uses `desc` only. Both are sufficient
because the VLM is instructed not to repeat, and IoU>0.5 catches residual duplicates.
