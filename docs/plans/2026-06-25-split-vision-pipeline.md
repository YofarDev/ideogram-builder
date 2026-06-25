# Split Vision Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a second image→JSON workflow ("Split") alongside the existing one, switchable via a UI toggle, where a VLM does concept discovery + captioning across two calls and SAM3 does all localization. Both produce identical Ideogram4 JSON for A/B comparison.

**Architecture:** New `pipeline_split.py` orchestrates scene-call → object-call → SAM → drop-misses → `build_json` (reused unchanged). Baseline `pipeline.py` + `global_analysis.txt` are frozen. New prompts split the scene fields from the SAM-groundable object list. `main.py` gains `--split`; `server.py` passes it through; `src/vision.js` gets a Pipeline dropdown.

**Tech Stack:** Python (mlx_vlm Qwen3-VL-4B, MLX SAM3.1, PIL), vanilla JS frontend, stdlib HTTP server. Tests: pytest (pure-logic only, matching `img-to-json/tests/` convention — no model mocking).

**Design doc:** `docs/plans/2026-06-25-split-vision-pipeline-design.md`

---

## Conventions for the implementer

- **Run Python via `uv`.** Tests/pipeline run as `uv run --directory img-to-json ...` (matches `server.py` invocation). Never `python`/`pip` directly.
- **Baseline is frozen.** Do NOT edit `pipeline.py`, `prompts/global_analysis.txt`, `steps/local_vlm_analysis.py`, `steps/json_builder.py`, `steps/sam_detection.py`, `steps/preprocess.py`, `models/*`, `utils/*`. Read-only imports from these are fine and encouraged (DRY).
- **Reuse, don't duplicate, pure helpers:** import `_unpad_bbox`, `_bbox_to_pixels`, `_draw_bboxes` from `pipeline`; import `_parse_json` from `steps.local_vlm_analysis`; reuse `extract_palette_from_region` from `utils.palette`, `build_json` from `steps.json_builder`, `sam_detect` from `steps.sam_detection`, `preprocess` from `steps.preprocess`, `get_local_vlm` from `models.local_vlm_loader`, `get_sam_predictor` from `models.sam_loader`.
- **No comments unless a `ponytail:` shortcut is being marked** (per repo convention).
- **Commit per task** with `type: ...` messages matching repo style (`feat:`, `test:`, `docs:`).

---

## Task 1: Scene-analysis prompt

**Files:**
- Create: `img-to-json/prompts/scene_analysis.txt`

**Step 1: Write the prompt**

This is call 1 of the split workflow — scene-level fields only, no objects, no bboxes. Derived from `prompts/global_analysis.txt`, keeping the `style` sub-shape identical (so `build_json`'s photo-vs-art branch works unchanged).

```
You are an expert image captioner for Ideogram 4. Analyze the image and return ONLY a JSON object describing the scene as a whole. Do NOT list individual objects or elements — another pass handles those.

{
  "high_level_description": "<1-2 sentence summary naming only the subject(s), setting, and object counts — no style, atmosphere, gestures, or expressions>",
  "background": "<detailed description of the background environment>",
  "style": {
    "medium": "<photograph|illustration|graphic_design|3d_render|painting>",
    "aesthetics": "<comma-separated aesthetic keywords, e.g. 'moody, cinematic, desaturated' or 'warm, playful, vibrant'>",
    "lighting": "<lighting description>",
    "photo_or_art": "<if photograph: camera/lens/depth-of-field details. If not: art style description>"
  }
}

NOTE: `high_level_description` must state ONLY the main subject(s), the setting, and object counts — e.g. 'Three people at a dining table with plates and wine glasses.' It must NOT include gestures, poses, facial expressions, or emotions; those belong exclusively in individual element descriptions.

### Specificity — commit to one value

Banned hedge phrasings: "things like", "such as", "e.g.", "for example", "or similar", "various (as a qualifier)", "could include", "might be", "some kind of". Replace with concrete nouns, counts, colors, materials.

Banned alternative listings: "oak or walnut", "cream or ivory". Pick ONE and commit.

Banned implied/suggested hedges: "implied", "suggested", "hinted", "barely visible", "possibly", "perhaps". If it's in the scene, describe it concretely.

### style.photo_or_art

If medium is "photograph": give camera/lens/depth-of-field details.
Otherwise: give the art style description.
Exactly one applies — never blend photograph camera details into a non-photograph medium.

Return ONLY the JSON object. No explanation, no markdown.
```

**Step 2: Commit**

```bash
git add img-to-json/prompts/scene_analysis.txt
git commit -m "feat: add scene-analysis prompt for split vision pipeline"
```

---

## Task 2: Object-listing prompt

**Files:**
- Create: `img-to-json/prompts/object_listing.txt`

**Step 1: Write the prompt**

Call 2 — concept discovery for SAM3. Each entry's `name` is the noun phrase handed to SAM3's text-prompted segmentation, so names must be individually segmentable. No `bbox` field at all.

```
You are an expert image captioner for Ideogram 4. List the individual objects and text elements in the image. Your output drives a separate segmentation model (SAM3) that finds each item by name, so every name MUST be a concrete noun phrase SAM3 can ground to a single visual region.

Return ONLY a JSON object: { "objects": [ ... ] }

Each object entry:
{
  "name": "<singular concrete noun phrase SAM3 can segment, 1-3 words>",
  "desc": "<detailed 30-60 word description>",
  "has_text": <true|false>,
  "visible_text": "<exact text string if has_text is true, else null>"
}

### SAM-groundability rules for `name`

The `name` is passed verbatim to a text-prompted segmenter. To be segmentable:
- Use SINGULAR concrete nouns: "dog", "wine glass", "wooden chair". Never plurals or group nouns: "crowd", "people", "flowers", "trees".
- One name = one distinct visual region. Do not split a single subject into sub-parts (no "person's hand", "person's face" — use "person").
- For dense or scattered groups (a field of flowers, a crowd, scattered debris), emit ONE entry with a collective-free name describing the whole region (e.g. "flower field") and describe the scatter in `desc`.
- Avoid abstract nouns SAM3 cannot ground ("foreground interest", "negative space", "atmosphere") — those belong in the scene pass, not here.
- If a recognized entity has a proper name (brand, product), prefer the generic segmentable noun in `name` ("sneaker") and put the brand in `desc`.

### Element selection

An element earns its own entry only when it occupies a distinct region AND adds a fact not already covered by another element's `desc`. Aim for 3-15 spatially distinct elements. Cover foreground, midground, and background regions.

### Element desc guidelines

Each desc is 30-60 words. Identity first, then attributes:
- People: skin tone, hair, visible garments, expression, pose, distinguishing features
- Objects: shape, material, color, markings, distinct parts

Detailed, vivid descriptions. Include observable properties not generic impressions.

NOTE: text elements are exempt from the 30-60 word target and the "identity first" rule — their "desc" is style/placement only (see TEXT handling) and never restates the characters stored in "visible_text".

### Specificity — commit to one value

Banned hedge phrasings: "things like", "such as", "e.g.", "for example", "or similar", "various (as a qualifier)", "could include", "might be", "some kind of". Replace with concrete nouns, counts, colors, materials.

Banned alternative listings: "oak or walnut", "cream or ivory". Pick ONE and commit.

Banned implied/suggested hedges: "implied", "suggested", "hinted", "barely visible", "possibly", "perhaps". If it's in the scene, describe it concretely.

### TEXT handling

For in-image text elements:
- "name" must be the literal text content (e.g. "STOP", "Chapter 5", "2024"), or "Text" if unreadable
- "visible_text" field holds literal characters verbatim — preserve diacritics, capitalization. This is the ONLY field that stores the characters themselves.
- "desc" for a text element must describe ONLY the visual treatment and placement — font family/weight, color, size qualifier, whether it is a logo/stylized graphic, and where it sits relative to neighbors. It must NEVER quote, paraphrase, or reference the literal characters. Banned clauses: "reads '...'", "says '...'", "contains the word '...'", "the text '...'", "reading '...'", "spelled '...'".
- Text-element "desc" is shorter (10-25 words) and does NOT need to hit the 30-60 word object target — do not pad it.
- Include: signs, labels, badges, brand names, numbers, titles
- Use separate objects for visually distinct text blocks

### Pop culture references

When you see a brand, product, public figure, fictional character, or franchise, use the explicit name in the relevant element desc — not a generic stand-in.

Return ONLY the JSON object. No explanation, no markdown.
```

**Step 2: Commit**

```bash
git add img-to-json/prompts/object_listing.txt
git commit -m "feat: add SAM-groundable object-listing prompt for split vision pipeline"
```

---

## Task 3: Pure helpers in `pipeline_split.py` (TDD)

These are the only testable-without-models pieces: the drop-on-miss filter (aligned index filtering + dropped-element ledger) and the scene/object merge into `build_json`'s expected `analysis` shape.

**Files:**
- Create: `img-to-json/pipeline_split.py` (helpers only this task; orchestration in Task 4)
- Test: `img-to-json/tests/test_pipeline_split.py`

**Step 1: Write the failing tests**

`img-to-json/tests/test_pipeline_split.py`:

```python
import json

from pipeline_split import _filter_localized, _assemble_analysis
from steps.json_builder import build_json

_SCENE = {
    "high_level_description": "A cat on a mat.",
    "background": "Wooden floor with a woven rug.",
    "style": {
        "medium": "photograph",
        "aesthetics": "warm, cozy",
        "lighting": "soft window light",
        "photo_or_art": "50mm f/2.8",
    },
}

_OBJECTS = [
    {"name": "orange cat", "desc": "A fluffy orange tabby.", "has_text": False, "visible_text": None},
    {"name": "food bowl", "desc": "A ceramic bowl.", "has_text": True, "visible_text": "CAT"},
    {"name": "toy mouse", "desc": "A felt mouse toy.", "has_text": False, "visible_text": None},
]


def test_filter_keeps_localized():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
        {"name": "toy mouse", "bbox": None},
    ]
    kept_objs, kept_dets, dropped = _filter_localized(_OBJECTS, detections)
    assert len(kept_objs) == 2
    assert len(kept_dets) == 2
    assert kept_objs[0]["name"] == "orange cat"
    assert kept_dets[1]["bbox"] == [500, 600, 700, 800]


def test_filter_drops_misses_with_ledger():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": None},
        {"name": "toy mouse", "bbox": None},
    ]
    _, _, dropped = _filter_localized(_OBJECTS, detections)
    assert len(dropped) == 2
    assert dropped[0] == {"name": "food bowl", "desc": "A ceramic bowl.", "reason": "sam_no_detection"}
    assert dropped[1]["name"] == "toy mouse"


def test_filter_handles_shorter_detections():
    # SAM returned fewer entries than objects (defensive alignment)
    detections = [{"name": "orange cat", "bbox": [100, 200, 400, 500]}]
    kept_objs, kept_dets, dropped = _filter_localized(_OBJECTS, detections)
    assert len(kept_objs) == 1
    # zip stops at shorter; remaining objects are not seen — caller must align full-length
    # (sam_detect always returns full-length with None fills, so this is belt-and-suspenders)
    assert len(dropped) == 0


def test_assemble_merges_scene_and_objects():
    analysis = _assemble_analysis(_SCENE, _OBJECTS)
    assert analysis["high_level_description"] == "A cat on a mat."
    assert analysis["background"] == "Wooden floor with a woven rug."
    assert analysis["style"]["medium"] == "photograph"
    assert len(analysis["objects"]) == 3
    assert "bbox" not in analysis["objects"][0]


def test_assemble_feeds_build_json():
    # Reuse contract: split's assembled analysis must satisfy build_json unchanged.
    analysis = _assemble_analysis(_SCENE, _OBJECTS[:2])
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(["#FF6600"], analysis, detections)
    parsed = json.loads(result)
    assert parsed["high_level_description"] == "A cat on a mat."
    assert "photo" in parsed["style_description"]
    elements = parsed["compositional_deconstruction"]["elements"]
    assert elements[1]["type"] == "text"
    assert elements[1]["text"] == "CAT"
```

**Step 2: Run to verify failure**

```bash
uv run --directory img-to-json pytest tests/test_pipeline_split.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline_split'`.

**Step 3: Write the helpers**

`img-to-json/pipeline_split.py` (top of file — orchestration `run()` added in Task 4):

```python
import json
import logging
from pathlib import Path

from PIL import Image

from steps.preprocess import preprocess
from steps.local_vlm_analysis import _parse_json
from steps.sam_detection import sam_detect
from steps.json_builder import build_json
from utils.palette import extract_palette_from_region

# ponytail: reuse baseline geometry helpers verbatim (baseline frozen for A/B validity)
from pipeline import _unpad_bbox, _bbox_to_pixels, _draw_bboxes

logger = logging.getLogger(__name__)

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def _filter_localized(objects, detections):
    """Drop objects SAM failed to localize.

    Returns (kept_objects, kept_detections, dropped_ledger). Each ledger entry
    is {name, desc, reason} for one dropped object.
    """
    kept_objects, kept_dets, dropped = [], [], []
    for obj, det in zip(objects, detections):
        bbox = det.get("bbox") if det else None
        if bbox is not None:
            kept_objects.append(obj)
            kept_dets.append(det)
        else:
            dropped.append({
                "name": obj.get("name", ""),
                "desc": obj.get("desc", ""),
                "reason": "sam_no_detection",
            })
    return kept_objects, kept_dets, dropped


def _assemble_analysis(scene, objects):
    """Merge scene call + object call into the analysis shape build_json expects."""
    return {
        "high_level_description": scene["high_level_description"],
        "background": scene["background"],
        "style": scene["style"],
        "objects": objects,
    }
```

**Step 4: Run to verify pass**

```bash
uv run --directory img-to-json pytest tests/test_pipeline_split.py -v
```
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add img-to-json/pipeline_split.py img-to-json/tests/test_pipeline_split.py
git commit -m "test: pure helpers for split pipeline (filter localized, assemble analysis)"
```

---

## Task 4: VLM calls + orchestration `run()`

No unit tests here (model-dependent — matches project convention of no model mocking). Verified manually in Task 8.

**Files:**
- Modify: `img-to-json/pipeline_split.py` (append orchestration)

**Step 1: Append the two VLM call helpers + `run()`**

Append to `img-to-json/pipeline_split.py`:

```python
from mlx_vlm import generate
from mlx_vlm.prompt_utils import apply_chat_template

from models.local_vlm_loader import get_local_vlm
from models.sam_loader import get_sam_predictor


def _vlm_call(image, system_prompt, user_text, debug, debug_subdir):
    """One VLM generation with markdown-fence JSON parsing + single retry. Returns parsed dict."""
    model, processor = get_local_vlm()
    config = model.config
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]
    prompt = apply_chat_template(processor, config, messages, num_images=1)

    if debug and debug.enabled:
        debug.save_text(f"{debug_subdir}/system_prompt.txt", system_prompt)
        debug.save_text(f"{debug_subdir}/user_message.txt", user_text)

    retry_text = (
        "Return ONLY a raw JSON object. No text before or after. "
        "Do not wrap in markdown code fences."
    )
    for attempt in range(2):
        result = generate(model, processor, prompt, image=image, max_tokens=4096)
        response = result.text
        if debug and debug.enabled:
            debug.save_text(f"{debug_subdir}/raw_response_attempt_{attempt + 1}.txt", response)
        parsed = _parse_json(response)
        if parsed is not None:
            if debug and debug.enabled:
                debug.save_json(f"{debug_subdir}/parsed.json", parsed)
            return parsed
        user_text = retry_text
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]
        prompt = apply_chat_template(processor, config, messages, num_images=1)

    raise RuntimeError(f"VLM failed to return valid JSON after 2 attempts.\nRaw output:\n{result.text}")


def run(
    image_path: str,
    output_path: str | None = None,
    verbose: bool = False,
    low_memory: bool = False,
    debug=None,
):
    pre = preprocess(image_path)
    if verbose:
        logger.info("Split step 1 — preprocess: palette=%d colors", len(pre.palette))
    if debug and debug.enabled:
        debug.save_json("01_preprocess/result.json", {
            "palette": pre.palette,
            "pad_offsets": list(pre.pad_offsets),
            "orig_size": list(pre.image_orig.size),
        })
        debug.save_image("01_preprocess/image_padded.png", pre.image_padded)

    scene_prompt = (_PROMPT_DIR / "scene_analysis.txt").read_text().strip()
    scene = _vlm_call(pre.image_orig, scene_prompt, "Analyze this image and return the JSON.", debug, "02_scene")
    if verbose:
        logger.info("Split step 2a — scene call done")

    object_prompt = (_PROMPT_DIR / "object_listing.txt").read_text().strip()
    raw_objects = _vlm_call(pre.image_orig, object_prompt, "List the individual objects in this image and return the JSON.", debug, "03_objects")
    objects = raw_objects.get("objects", [])
    if verbose:
        logger.info("Split step 2b — object call: %d objects", len(objects))

    # low_memory: unload Qwen before SAM (mirrors baseline gc + metal clear)
    if low_memory:
        import gc
        from models.local_vlm_loader import get_local_vlm
        del get_local_vlm  # ponytail: drop reference; loader caches on next SAM-free path
        gc.collect()
        import mlx.core
        mlx.core.metal.clear_cache()

    names = [o.get("name", "") for o in objects]
    detections = sam_detect(pre.image_padded, names, vlm_bboxes=None, verbose=verbose, debug=debug)
    for det in detections:
        if det.get("bbox") is not None:
            det["bbox"] = _unpad_bbox(det["bbox"], pre.pad_offsets, pre.image_orig.size)

    kept_objects, kept_detections, dropped = _filter_localized(objects, detections)
    if verbose:
        logger.info("Split step 3 — SAM: %d/%d localized", len(kept_objects), len(objects))

    if debug and debug.enabled:
        debug.save_json("04_sam/detections_all.json", [
            {"name": d.get("name"), "bbox": d.get("bbox")} for d in detections
        ])
        debug.save_json("04_sam/dropped_elements.json", dropped)
        sam_boxes = [d.get("bbox") for d in kept_detections]
        sam_labels = [o.get("name", "") for o in kept_objects]
        debug.save_image("04_sam/sam_boxes.png", _draw_bboxes(pre.image_orig, sam_boxes, sam_labels))

    # Per-element palettes (mirrors baseline loop)
    ow, oh = pre.image_orig.size
    element_palettes = {}
    for obj, det in zip(kept_objects, kept_detections):
        bbox = det.get("bbox")
        if bbox is None:
            continue
        px1, py1, px2, py2 = _bbox_to_pixels(bbox, ow, oh)
        if px2 > px1 and py2 > py1:
            try:
                region = pre.image_orig.crop((px1, py1, px2, py2))
                element_palettes[obj["name"]] = extract_palette_from_region(region, color_count=5)
                if debug and debug.enabled:
                    safe = obj["name"].replace(" ", "_").replace("/", "_")
                    debug.save_image(f"05_palettes/{safe}_crop.png", region)
                    debug.save_json(f"05_palettes/{safe}_palette.json", {"palette": element_palettes[obj["name"]]})
            except Exception as e:
                if verbose:
                    logger.warning("Per-element palette failed for '%s': %s", obj["name"], e)

    analysis = _assemble_analysis(scene, kept_objects)
    caption_json = build_json(pre.palette, analysis, kept_detections, element_palettes=element_palettes)

    if debug and debug.enabled:
        debug.save_text("05_final/caption.json", caption_json)

    if output_path:
        Path(output_path).write_text(caption_json, encoding="utf-8")
    else:
        print(caption_json)
```

**Note on the `low_memory` block:** the baseline unloads the cached VLM via gc + `mlx.core.metal.clear_cache()`. The `del get_local_vlm` line above is a best-effort reference drop; the real memory reclaim is the `gc.collect()` + metal cache clear (identical to baseline). If memory pressure remains on a 16GB machine, the `--low-memory` flag is the user's signal to close other apps. Do not over-engineer a model-unload API — baseline doesn't either.

**Step 2: Sanity-check it imports**

```bash
uv run --directory img-to-json python -c "import pipeline_split; print('ok')"
```
Expected: prints `ok` (this does NOT load the models — they load lazily inside functions).

**Step 3: Commit**

```bash
git add img-to-json/pipeline_split.py
git commit -m "feat: split pipeline run() — scene+object VLM calls, SAM, drop-on-miss"
```

---

## Task 5: `--split` flag in `main.py`

**Files:**
- Modify: `img-to-json/main.py`

**Step 1: Add the flag + routing**

`main.py` currently does `from pipeline import run` unconditionally, then `run(...)`. Change to: add `--split` argparse arg, route the import + call.

Add to the argparse block (after `--debug`):

```python
    parser.add_argument(
        "--split",
        action="store_true",
        help="Use the split pipeline (two VLM calls + SAM-only localization)",
    )
```

Replace the `from pipeline import run` / `run(...)` block with:

```python
    if args.split:
        from pipeline_split import run
    else:
        from pipeline import run

    run(
        image_path=args.image_path,
        output_path=args.output,
        verbose=args.verbose,
        no_sam=args.no_sam if not args.split else True,
        low_memory=args.low_memory,
        debug=debug_logger,
    )
```

**Important:** `pipeline_split.run` has no `no_sam` parameter (SAM is mandatory in split). The `no_sam=... if not args.split else True` passes a value to baseline only; for split, `args.no_sam` is simply ignored because `pipeline_split.run` doesn't accept it. Wait — that would raise `TypeError` for unexpected kwarg. Fix: pass `no_sam` only to baseline.

Corrected routing:

```python
    kwargs = dict(
        image_path=args.image_path,
        output_path=args.output,
        verbose=args.verbose,
        low_memory=args.low_memory,
        debug=debug_logger,
    )
    if args.split:
        from pipeline_split import run
    else:
        from pipeline import run
        kwargs["no_sam"] = args.no_sam

    run(**kwargs)
```

**Step 2: Verify CLI help renders**

```bash
uv run --directory img-to-json python main.py --help
```
Expected: help text includes `--split`.

**Step 3: Commit**

```bash
git add img-to-json/main.py
git commit -m "feat: route --split flag to pipeline_split in main.py"
```

---

## Task 6: `pipeline` field in `server.py`

**Files:**
- Modify: `server.py` (the `/api/img-to-json` handler, around line 358-393)

**Step 1: Read the `pipeline` field and append `--split`**

In the handler, after `debug_flag = body.get("debug", False)` add:

```python
            pipeline = body.get("pipeline", "current")
```

In the `cmd = [...]` construction block, after the `--debug` conditional append, add:

```python
                    if pipeline == "split":
                        cmd.append("--split")
```

(Place it inside the same `if model == "local":` branch — split is local-only. The `--no-sam` flag may still be appended for split, but `main.py` ignores it when `--split` is set per Task 5. That's fine — harmless.)

**Step 2: Manual verify the server still boots**

```bash
uv run python server.py &
sleep 2
curl -s http://localhost:8080/api/config | head -c 200
kill %1
```
Expected: server prints the port line and curl returns config JSON (no crash from the edit).

**Step 3: Commit**

```bash
git add server.py
git commit -m "feat: pass pipeline=split through /api/img-to-json to subprocess"
```

---

## Task 7: Frontend — Pipeline dropdown

**Files:**
- Modify: `index.html` (vision toolbar, around line 2534-2538)
- Modify: `src/vision.js` (around lines 188-196 where the POST body is built)

**Step 1: Add the dropdown markup in `index.html`**

In the `.vision-toolbar` div (the one containing the model `<select id="vision-model">`), add a second labeled select right after the model select and before the config gear button:

```html
                        <span class="vision-toolbar-label" id="vision-pipeline-label" style="display:none;">Pipeline</span>
                        <label class="sr-only" for="vision-pipeline">Pipeline</label>
                        <select id="vision-pipeline" class="ai-model-select" style="display:none;">
                            <option value="current">Current</option>
                            <option value="split">Split</option>
                        </select>
```

(Inline `display:none` defaults — shown only for local models in JS, matching how the model dropdown's local-options behave.)

**Step 2: Wire it in `src/vision.js`**

Near the top of `initVision()`, after the `visionModelSelect` declaration, add:

```javascript
  const pipelineSelect = document.getElementById('vision-pipeline');
  const pipelineLabel = document.getElementById('vision-pipeline-label');
  const noSamCheckbox = document.getElementById('vision-no-sam');
  // Restore persisted selection
  const savedPipeline = localStorage.getItem('vision_pipeline');
  if (savedPipeline && pipelineSelect) pipelineSelect.value = savedPipeline;
```

Inside the existing `visionModelSelect.addEventListener('change', ...)` (which currently toggles `vision-options` visibility for local), extend it to also show/hide the pipeline dropdown and hide `--no-sam` when split is selected. Replace that listener's body with:

```javascript
  function updatePipelineVisibility() {
    const isLocal = visionModelSelect.value === 'local';
    const isSplit = pipelineSelect?.value === 'split';
    if (pipelineLabel) pipelineLabel.style.display = isLocal ? '' : 'none';
    if (pipelineSelect) pipelineSelect.style.display = isLocal ? '' : 'none';
    if (visionOptions) visionOptions.style.display = isLocal ? 'flex' : 'none';
    // Split requires SAM — hide the --no-sam option when split is selected
    const noSamRow = noSamCheckbox?.closest('.vision-option');
    if (noSamRow) noSamRow.style.display = isLocal && !isSplit ? '' : 'none';
  }
  visionModelSelect.addEventListener('change', updatePipelineVisibility);
  pipelineSelect?.addEventListener('change', () => {
    localStorage.setItem('vision_pipeline', pipelineSelect.value);
    updatePipelineVisibility();
  });
  updatePipelineVisibility();
```

Then in `processImage()` where the POST body is built (the `const body = { image: downscaled, model: selectedModel };` block), add the pipeline field for local:

```javascript
      if (selectedModel === 'local') {
        body.pipeline = pipelineSelect?.value || 'current';
        body.no_sam = document.getElementById('vision-no-sam')?.checked || false;
        body.low_memory = document.getElementById('vision-low-memory')?.checked || false;
        body.debug = document.getElementById('vision-debug')?.checked || false;
      }
```

**Step 3: Manual verify in browser**

```bash
uv run python server.py
```
Open http://localhost:8080, go to Vision tab. Verify:
- Pipeline dropdown hidden until a local model is selected.
- Selecting "Split" hides the "Skip SAM" checkbox.
- Reloading the page remembers the Split choice (localStorage).
- The model dropdown's local options (`--low-memory`, `--debug`) still show for local.

**Step 4: Commit**

```bash
git add index.html src/vision.js
git commit -m "feat: pipeline dropdown in vision tab (current vs split)"
```

---

## Task 8: End-to-end manual verification

This is the experiment itself — run a real image through both pipelines and confirm identical schema + visible behavioral differences.

**Step 1: Prepare a test image**

Use any real photo in the repo, e.g. drop one into `img-to-json/debug/test_input.jpg` (gitignored dir).

**Step 2: Run baseline (current) from CLI**

```bash
uv run --directory img-to-json python main.py img-to-json/debug/test_input.jpg --debug -v 2>baseline.err | tee baseline.json
```
Expected: prints caption JSON to stdout; `baseline.err` has `[debug_dir]...`. Note the debug dir path.

**Step 3: Run split from CLI**

```bash
uv run --directory img-to-json python main.py img-to-json/debug/test_input.jpg --split --debug -v 2>split.err | tee split.json
```
Expected: prints caption JSON. `split.err` has `[debug_dir]...`.

**Step 4: Inspect split debug artifacts**

Open the split debug dir. Confirm presence of:
- `02_scene/parsed.json` (scene only — no `objects` key)
- `03_objects/parsed.json` (object list — no `bbox` fields)
- `04_sam/dropped_elements.json` (the misses ledger — may be `[]` if SAM found everything)
- `04_sam/sam_boxes.png` (kept boxes drawn)
- `05_final/caption.json`

**Step 5: Schema parity check**

Confirm both `baseline.json` and `split.json` have identical top-level key order: `high_level_description`, `style_description`, `compositional_deconstruction`. Confirm every element in `split.json` HAS a `bbox` (drop-on-miss guarantee — no bbox-less elements should exist).

**Step 6: UI end-to-end**

```bash
uv run python server.py
```
- Vision tab, local model, Pipeline = Split, check Debug.
- Drop the same image, Process.
- Confirm: status shows debug link; editor loads with boxes overlaid; JSON textarea populated.
- Flip to Current, re-process same image, compare JSON in the textarea.

**Step 7: Final commit (if any verification caught a fix)**

Only commit if Steps 1-6 required edits. Otherwise no commit — verification is read-only.

---

## Done criteria

- `pytest tests/` (all, including new `test_pipeline_split.py`) passes.
- `--split` CLI run produces schema-identical JSON to baseline; every split element has a bbox.
- Split debug dir contains `dropped_elements.json`.
- UI dropdown switches pipelines, persists choice, hides `--no-sam` for split.
- Baseline files (`pipeline.py`, `global_analysis.txt`, all `steps/`, `models/`, `utils/`) unchanged — verify with `git diff -- pipeline.py img-to-json/pipeline.py img-to-json/prompts/global_analysis.txt img-to-json/steps img-to-json/models img-to-json/utils` (should be empty).
