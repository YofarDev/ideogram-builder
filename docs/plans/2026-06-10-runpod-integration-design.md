# RunPod Integration + Canvas Overlay Design

## Goal

Replace local ComfyUI connection with RunPod serverless endpoint. Display generated images as a canvas overlay with opacity slider so bounding boxes render on top.

## Changes

### 1. New module: `src/runpod.js` (replaces `comfyui.js`)

- Fetches RunPod config (api_key, endpoint_id) from `/api/config`
- `generateImage()` reads `#json-output`, `state.canvas.width/height`, sends async `/run` request
- Polls `/status/{job_id}` every 3s until COMPLETED or FAILED
- On success: decodes base64 image from response, creates object URL, emits `image:ready` with `{ imageUrl }`
- Emits `runpod:loading` / `runpod:done` events for UI state

### 2. Canvas overlay (`canvas.js` changes)

- Add `<img id="canvas-overlay">` inside `#canvas-wrapper` (z-index below boxes, above grid)
- On `image:ready`: set overlay src instead of `backgroundImage` on wrapper
- Remove the old `#image-view` img handling
- Boxes get higher z-index than overlay

### 3. Opacity slider (in toolbar)

- Range input `#overlay-opacity` (0-100, default 80) in the toolbar
- Controls `#canvas-overlay` opacity via CSS
- Label shows current value

### 4. HTML changes (`index.html`)

- Remove generate section: seed slider, API URL input, `#image-view`
- Keep "Generate Image" button with loading state
- Add opacity slider to toolbar
- Add `<img id="canvas-overlay">` inside canvas wrapper

### 5. Server config (`server.py`)

- Read `runpod_api_key` and `runpod_endpoint_id` from `~/.config/llm-credentials.json`
- Serve via existing `/api/config` endpoint

### 6. Cleanup

- Delete `src/comfyui-template.js`
- Delete `src/comfyui.js`
- Update `src/app.js`: import `runpod.js` instead of `comfyui.js`
- Update `CLAUDE.md`: module map, event catalog

## Event changes

| Event | Change |
|-------|--------|
| `image:ready` | No change — canvas overlay handler replaces old background handler |
| `runpod:loading` | NEW — emitted when generation starts |
| `runpod:done` | NEW — emitted when generation finishes (success or fail) |

## RunPod API flow

```
POST https://api.runpod.ai/v2/{endpoint_id}/run
  Authorization: Bearer {api_key}
  { "input": { "import_json": "...", "width": 768, "height": 1152 } }
  → { "id": "job_id" }

GET https://api.runpod.ai/v2/{endpoint_id}/status/{job_id}
  → { "status": "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" }
  → COMPLETED: { "output": { "images": [{ "data": "base64...", "type": "base64" }] } }
```
