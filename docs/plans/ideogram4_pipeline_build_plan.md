# Build Plan: Image → Ideogram4 JSON Pipeline

## Overview

A local CLI tool that takes an image as input and outputs a structured JSON caption
ready to be fed to Ideogram4. The pipeline chains two local MLX models:

1. **Qwen3-VL-4B-Instruct-8bit** — semantic understanding (objects, style, background)
2. **SAM 3.1 (mlx-community/sam3.1-bf16)** — precise bounding box extraction per object

---

## Project Structure

```
ideogram4-captioner/
├── main.py                  # CLI entry point
├── pipeline.py              # Orchestrator: runs steps 1–4 in order
├── steps/
│   ├── preprocess.py        # Step 1: resize, palette extraction
│   ├── qwen_analysis.py     # Step 2: Qwen3-VL full-image analysis
│   ├── sam_detection.py     # Step 3: SAM bounding box extraction
│   └── json_builder.py      # Step 4: assemble + validate Ideogram4 JSON
├── models/
│   ├── qwen_loader.py       # Lazy loader for Qwen3-VL via mlx-vlm
│   └── sam_loader.py        # Lazy loader: Sam3Predictor + Sam31Processor via mlx-vlm
├── utils/
│   ├── bbox.py              # Coordinate helpers (pixel → 0-1000 space)
│   ├── palette.py           # Dominant color extraction → uppercase hex
│   └── caption_verifier.py  # Port/wrapper of Ideogram4's CaptionVerifier
├── prompts/
│   ├── global_analysis.txt  # System + user prompt for full-image Qwen3-VL call
│   └── object_detail.txt    # Per-object crop prompt (unused in Option A)
├── requirements.txt
└── README.md
```

---

## Dependencies

```
mlx
mlx-vlm>=0.4.3       # Both Qwen3-VL and SAM 3.1 inference on Apple Silicon
Pillow               # Image loading, resizing, cropping
numpy
colorthief           # Dominant palette extraction
```

> Both models are accessed via `mlx-vlm` (version 0.4.3+). No separate SAM
> installation needed — `mlx-community/sam3.1-bf16` is loaded via
> `mlx_vlm.utils.load_model` exactly like any other mlx-vlm model.

---

## Step-by-Step Implementation

---

### Step 1 — `steps/preprocess.py`

**Goal:** Normalize the input image to a known canvas size and extract the global
color palette.

**Inputs:** Raw image path (any format Pillow supports)

**Outputs:**
- `image_1000: PIL.Image` — image resized to 1000×1000 (used for bbox normalization)
- `image_orig: PIL.Image` — original image (used for Qwen3-VL; better quality)
- `palette: list[str]` — up to 16 dominant colors as uppercase `#RRGGBB` strings

**Implementation notes:**

- Resize to 1000×1000 using `Image.LANCZOS`. Do NOT crop — use letterboxing
  (`ImageOps.pad`) so the aspect ratio is preserved and bbox coordinates stay valid.
  Record the padding offsets so bbox coordinates can be correctly mapped back later.
- For palette extraction, use `colorthief.ColorThief` with `color_count=16`.
  Convert each RGB tuple to `"#%02X%02X%02X"` (uppercase, mandatory for Ideogram4).
- Expose a dataclass `PreprocessResult(image_orig, image_padded, palette, pad_offsets)`.

---

### Step 2 — `steps/qwen_analysis.py`

**Goal:** Use Qwen3-VL to understand the full image semantically. This is the
"brain" step — it produces all textual content for the JSON except the bboxes.

**Inputs:** `image_orig` (PIL.Image)

**Outputs:** A structured dict:
```python
{
  "high_level_description": str,
  "style": {
    "medium": str,           # "photograph" | "illustration" | "graphic_design" | ...
    "aesthetics": str,       # comma-separated adjectives
    "lighting": str,
    "photo_or_art": str,     # value for "photo" or "art_style" key
  },
  "background": str,
  "objects": [
    {
      "name": str,           # short label used to query SAM (e.g. "red bicycle")
      "desc": str,           # detailed description for Ideogram4 "desc" field
      "has_text": bool,      # true if the object contains visible text
      "visible_text": str,   # the actual text string if has_text is True
    },
    ...
  ]
}
```

**Implementation notes:**

- Load Qwen3-VL once via `mlx_vlm.load()` at module level (lazy, cached).
- Use `mlx_vlm.generate()` with the image and a carefully crafted prompt
  (see `prompts/global_analysis.txt`).
- Ask the model to respond **only in JSON** — no preamble, no markdown fences.
  Strip any ` ```json ` wrapper before `json.loads()`.
- The prompt must explicitly instruct the model on key ordering and field names
  so the output maps cleanly to the Ideogram4 schema.
- If `json.loads()` fails, implement a simple retry (up to 2 attempts) with a
  stricter prompt: "Return ONLY a raw JSON object. No text before or after."

**`prompts/global_analysis.txt`:**
```
You are an expert image captioner for a generative image model.
Analyze the image and return ONLY a JSON object with this exact structure:

{
  "high_level_description": "<1-2 sentence summary of the whole image>",
  "style": {
    "medium": "<photograph|illustration|graphic_design|3d_render|painting>",
    "aesthetics": "<3 adjectives describing the visual feel>",
    "lighting": "<lighting description>",
    "photo_or_art": "<if photograph: camera/lens/depth-of-field details. If not: art style description>"
  },
  "background": "<detailed description of the background environment>",
  "objects": [
    {
      "name": "<short 1-3 word label>",
      "desc": "<detailed description: appearance, color, texture, expression, state>",
      "has_text": <true|false>,
      "visible_text": "<exact text string if has_text is true, else null>"
    }
  ]
}

List ALL distinct objects and subjects visible in the image, from most prominent to least.
Include text elements (signs, labels, logos) as separate objects with has_text: true.
Return ONLY the JSON object. No explanation, no markdown.
```

---

### Step 3 — `steps/sam_detection.py`

**Goal:** For each object name from Step 2, query SAM to get a precise bounding box
in the 0–1000 coordinate space.

**Inputs:**
- `image_padded: PIL.Image` — the 1000×1000 padded image
- `object_names: list[str]` — short labels from Step 2

**Outputs:**
```python
list[dict]  # [{name: str, bbox: [y_min, x_min, y_max, x_max]}, ...]
```
Bboxes are in 0–1000 integer space (Ideogram4 format). Objects for which SAM
returns no result above the score threshold are returned with `bbox: None`.

**Confirmed API** (`mlx-community/sam3.1-bf16` via `mlx-vlm>=0.4.3`):
```python
from mlx_vlm.utils import load_model, get_model_path
from mlx_vlm.models.sam3.generate import Sam3Predictor
from mlx_vlm.models.sam3_1.processing_sam3_1 import Sam31Processor

model_path = get_model_path("mlx-community/sam3.1-bf16")
model = load_model(model_path)
processor = Sam31Processor.from_pretrained(str(model_path))
predictor = Sam3Predictor(model, processor, score_threshold=0.3)

result = predictor.predict(image, text_prompt="a dog")
# result.boxes  → (N, 4) float, xyxy pixel coordinates
# result.masks  → (N, H, W) binary
# result.scores → (N,) float
```

**Implementation notes:**

- Load model + predictor once (lazy, cached via `models/sam_loader.py`). Both
  Qwen3-VL and SAM are loaded through `mlx-vlm` — consider loading them
  sequentially to avoid peak memory pressure if RAM is tight.
- Loop over `object_names`, calling `predictor.predict(image, text_prompt=name)`
  once per object. SAM 3.1 does not accept a batch of text prompts in one call.
- When `result.scores` is empty (no detection), set `bbox = None` and log a warning.
- When multiple masks are returned (N > 1), take the one with the highest score:
  `best = result.boxes[result.scores.argmax()]`.
- **Coordinate conversion** — SAM returns `xyxy` (x1, y1, x2, y2) in pixel space
  on the 1000×1000 padded image. Ideogram4 expects `[y_min, x_min, y_max, x_max]`.
  The conversion is: `[y1, x1, y2, x2]` with values clipped to `[0, 1000]`
  (they are already in pixel space on the 1000-wide canvas, so no additional
  scaling needed — just round to int).

**`utils/bbox.py`:**
```python
def xyxy_to_ideogram(box_xyxy: list[float]) -> list[int]:
    """SAM xyxy (x1,y1,x2,y2) → Ideogram4 [y_min, x_min, y_max, x_max], clipped to 0-1000."""
    x1, y1, x2, y2 = box_xyxy
    return [
        max(0, min(1000, round(y1))),
        max(0, min(1000, round(x1))),
        max(0, min(1000, round(y2))),
        max(0, min(1000, round(x2))),
    ]

def mask_to_bbox_ideogram(mask: np.ndarray) -> list[int]:
    """Fallback: binary mask (H×W bool) → Ideogram4 [y_min, x_min, y_max, x_max]."""
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    y_min, y_max = np.where(rows)[0][[0, -1]]
    x_min, x_max = np.where(cols)[0][[0, -1]]
    return [int(y_min), int(x_min), int(y_max), int(x_max)]
```

---

### Step 4 — `steps/json_builder.py`

**Goal:** Merge all outputs from Steps 1–3 into a valid Ideogram4 JSON caption,
enforce key ordering, and serialize correctly.

**Inputs:**
- `palette: list[str]` — from Step 1
- `analysis: dict` — from Step 2
- `detections: list[dict]` — from Step 3 (name + bbox)

**Output:** `str` — the final JSON string, serialized with `separators=(",", ":")`

**Implementation notes:**

- Build the dict **in the exact key order** specified by the Ideogram4 schema.
  Use regular `dict` (Python 3.7+ preserves insertion order).
- For `style_description`: use key `"photo"` if `medium == "photograph"`,
  else use `"art_style"`.
- For each element in `elements`:
  - Match `analysis.objects[i]` with `detections[i]` by name.
  - If `bbox` is not None, include it; otherwise omit the key entirely.
  - If `has_text` is True: build a `"text"` element with key order
    `type → bbox → text → desc`.
  - Otherwise: build an `"obj"` element with key order `type → bbox → desc`.
- Serialize with:
  ```python
  json.dumps(caption, separators=(",", ":"), ensure_ascii=False)
  ```
- Run `CaptionVerifier` (see `utils/caption_verifier.py`) and print any warnings
  to stderr without blocking the output.

**Key order reference:**
```python
caption = {
    "high_level_description": ...,
    "style_description": {
        "aesthetics": ...,
        "lighting": ...,
        "photo": ...,        # XOR "art_style"
        "medium": ...,
        "color_palette": [...],
    },
    "compositional_deconstruction": {
        "background": ...,
        "elements": [
            # obj:  {"type", "bbox", "desc"}
            # text: {"type", "bbox", "text", "desc"}
        ],
    },
}
```

---

### Step 5 — `pipeline.py` (Orchestrator)

```python
def run(image_path: str, output_path: str | None = None, verbose: bool = False):
    # Step 1
    pre = preprocess(image_path)

    # Step 2
    analysis = qwen_analyze(pre.image_orig, verbose=verbose)

    # Step 3
    object_names = [obj["name"] for obj in analysis["objects"]]
    detections = sam_detect(pre.image_padded, object_names, verbose=verbose)

    # Step 4
    caption_json = build_json(pre.palette, analysis, detections)

    if output_path:
        Path(output_path).write_text(caption_json)
    else:
        print(caption_json)
```

---

### Step 6 — `main.py` (CLI)

Use `argparse` (no extra dependency):

```
python main.py <image_path> [--output out.json] [--verbose] [--no-sam] [--low-memory]
```

Flags:
- `--output` — write JSON to file instead of stdout
- `--verbose` — print intermediate outputs (Qwen3-VL raw response, SAM detections)
- `--no-sam` — skip SAM entirely; elements are included without `bbox` (useful for testing)
- `--low-memory` — unload Qwen3-VL from memory before loading SAM (slower but safe on 16GB)

---

## Error Handling Strategy

| Failure point | Behavior |
|---|---|
| Qwen3-VL JSON parse fails | Retry once with stricter prompt; if still fails, raise with raw output |
| SAM finds no detection for an object (`result.scores` empty) | Log warning, include element without `bbox` field |
| SAM returns multiple detections (N > 1) | Keep highest-scoring box: `result.boxes[result.scores.argmax()]` |
| SAM model load fails | Abort with clear message pointing to `mlx-vlm>=0.4.3` requirement |
| Image unreadable | Raise early with clear message before any model is loaded |
| `color_palette` hex not uppercase | `palette.py` enforces uppercase at extraction time |
| OOM during dual-model inference | Catch `mlx` memory error, suggest `--low-memory` flag |

---

## Testing Approach

- `tests/test_bbox.py` — unit tests for `mask_to_bbox` and `pixel_to_1000`
- `tests/test_json_builder.py` — assert key ordering, correct `photo`/`art_style`
  selection, `text` vs `obj` element type, bbox omitted when None
- `tests/test_pipeline_mock.py` — mock both models, run full pipeline end-to-end,
  validate output against `CaptionVerifier`
- Manual test with the F1 image from the Ideogram4 docs (known ground truth JSON)

---

## Open Questions for Implementation

1. ~~**SAM MLX API surface**~~ — **Resolved.** `Sam3Predictor.predict(image, text_prompt=str)`
   returns `result.boxes` (xyxy), `result.masks`, `result.scores`. One call per object.
   Convert xyxy → Ideogram4 yxyx format via `xyxy_to_ideogram()` in `utils/bbox.py`.
2. ~~**Qwen3-VL bbox estimates**~~ — **Not needed.** SAM text prompts are reliable enough;
   `bbox: None` fallback (element without bbox) is sufficient when SAM misses an object.
3. **Object count limit** — Ideogram4 examples have 5–15 elements. Consider capping
   at ~20 to avoid prompt length issues with Qwen3-VL on the analysis step. Also note
   that each object triggers one SAM inference call — cap helps with latency too.
4. **Text detection quality** — Qwen3-VL may miss small text. Optionally add a
   dedicated OCR pass (e.g. `easyocr` or `pytesseract`) for images known to have text.
5. **Memory management** — Both Qwen3-VL and SAM are loaded via mlx-vlm and will
   sit in unified memory simultaneously (~4B + ~873M params). On 16GB machines,
   load SAM only after Qwen3-VL inference is complete, or offer a `--low-memory`
   flag that unloads Qwen3-VL before loading SAM.
