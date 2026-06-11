# Vision Tab — Design

## Goal

Add a "Vision" tab where users upload an image and get an Ideogram4 prompt JSON via the
`img-to-json` pipeline (Qwen3-VL + SAM on Apple Silicon). Once the JSON is ready, overlay it
on the image in the Editor — same UX as loading an item from the gallery.

## Architecture

### New tab: "Vision"

Third tab in the tab-bar, after Editor and Gallery.

Tab content contains:
- A drop zone for image upload (click-to-browse or drag-drop)
- Preview of the selected image
- "Process Image" button (enabled only when an image is loaded)
- Status text showing "Processing…" or errors

### New module: `src/vision.js`

Owns all Vision tab DOM. Follows the architecture rule: imports only from `state.js` and
`events.js` + browser APIs.

Responsibilities:
1. File selection / drag-drop handling in the Vision tab
2. Displaying image preview
3. Calling `POST /api/img-to-json` with base64 image data
4. On success: populate `json-output`, emit `image:ready` + `state:loaded`, switch to Editor
5. On error: show toast, stay on Vision tab

### Backend endpoint: `POST /api/img-to-json`

Added to `server.py`. Accepts `{ "image": "<base64 data URL>" }`.

Flow:
1. Decode base64, write to temp file
2. Run `uv run --directory img-to-json python main.py <temp_path>` (subprocess, 120s timeout)
3. Capture stdout (the JSON output)
4. Return `{ "json": <parsed JSON> }`
5. Clean up temp file

### Data flow

1. User drops/picks an image in Vision tab
2. vision.js shows preview, enables "Process" button
3. User clicks "Process Image"
4. vision.js POSTs base64-encoded image to `/api/img-to-json`
5. Server runs pipeline, returns JSON
6. vision.js:
   - Writes JSON to `#json-output` textarea
   - Emits `image:ready` with `imageUrl` (the uploaded image converted to object URL)
   - Emits `state:loaded` with parsed JSON
   - Switches to Editor tab
7. Canvas shows image overlay + bounding boxes (existing handlers in canvas.js)

### No new events required

Reuses existing `image:ready` and `state:loaded` events.

### app.js changes

- Import `initVision` from vision.js
- Call it during init
- No new button wiring (vision.js handles its own DOM via event delegation)

## Files changed

| File | Change |
|------|--------|
| `index.html` | Add Vision tab button + tab-content with dropzone |
| `src/vision.js` | New module — all Vision tab logic |
| `src/app.js` | Import + call initVision |
| `server.py` | Add `POST /api/img-to-json` endpoint |

## Error handling

- Invalid / missing image → show toast error
- Pipeline failure (non-zero exit) → show toast with stderr
- Timeout (>120s) → show toast timeout error
- Invalid JSON returned → show toast parse error
