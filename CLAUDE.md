# Ideogram Builder — Architecture Guide

## Overview

Vanilla JS app for building Ideogram4 JSON image generation prompts. Canvas-based bounding box editor with color palettes, ComfyUI integration, and PNG metadata import.

**No build tools.** ES modules loaded via `<script type="module">`. Serve with `python3 server.py` (auto-loads LLM credentials from `~/.config/llm-credentials.json`).

## Project Structure

```
/                   — Frontend (vanilla JS app)
/runpod/            — RunPod Serverless backend (Docker image + handler)
```

## Architecture Rules

1. Each module imports only from `state.js`, `events.js`, or browser APIs — **never from sibling feature modules**
2. Cross-module communication goes through `events.js` emit/on only
3. No module touches another module's DOM elements (except app.js for button wiring)
4. Max ~150 LOC per file — split if approaching 200
5. State mutations centralized in `state.js`

## Module Map

| Module | Owns | Imports from |
|--------|------|-------------|
| `state.js` | All mutable state (boxes, palette, canvas dims, mode) | nothing |
| `events.js` | Pub/sub event bus | nothing |
| `canvas.js` | Canvas wrapper DOM, bounding boxes, pointer events, image overlay | state, events |
| `palette.js` | Color swatch DOM, add/remove colors | state, events |
| `json-builder.js` | JSON output textarea | state, events |
| `runpod.js` | RunPod serverless API calls: `runJob(snapshot)` submit + poll | nothing |
| `modal.js` | Modal serverless API calls: `runJob(snapshot)` submit + poll (mirrors runpod.js) | nothing |
| `backend.js` | Dispatcher — routes `runJob(snapshot)` to RunPod or Modal per `localStorage.ideogram_backend` | runpod, modal |
| `queue.js` | Generation queue — snapshot, enqueue, sequential worker, panel DOM | state, events, backend, toast |
| `png-import.js` | PNG metadata parsing, drag-drop, JSON load | state, events |
| `ai-enhancer.js` | Multi-provider LLM prompt enhancement (deepseek, google, openrouter, mimo) | events |
| `gallery.js` | Tab switching, history grid, thumbnail creation, localStorage | events |
| `settings.js` | Mode toggle, aspect ratio (persisted), box form fields | state, events |
| `layers.js` | Layer panel UI — list, reorder, visibility, lock | state, events, canvas (selectBox) |
| `lora.js` | LoRA library (localStorage), selection, override application | state, events |
| `collections.js` | Collections tab UI, localStorage CRUD, batch generation | events, queue (enqueueImportJson), toast |
| `app.js` | Button wiring, init orchestration | all modules |
| `session.js` | Session persistence — save/restore content + config + UI to `localStorage.ideogram_session` | state, events |

## Event Catalog

| Event | Payload | Emitted by | Consumed by |
|-------|---------|-----------|-------------|
| `box:selected` | `{ id }` or `null` | canvas | settings (form), palette (colors) |
| `canvas:reset` | none | canvas | json-builder (clear textarea) |
| `canvas:rebuild` | none | png-import | canvas (calls initCanvas) |
| `canvas:relayout` | none | app | canvas (calls resizeCanvas) |
| `image:ready` | `{ imageUrl }` | runpod, png-import | canvas (overlay image), gallery (save to history) |
| `runpod:loading` | none | runpod | (future: disable UI) |
| `runpod:done` | none | runpod | (future: re-enable UI) |
| `state:loaded` | `{ json }` | png-import, ai-enhancer | canvas (boxes), settings (form), palette (colors), layers (rebuild) |
| `layers:reordered` | none | layers | canvas (reapply z-index) |
| `box:visibility` | `{ id, visible }` | layers | canvas (hide/show DOM) |
| `box:lock` | `{ id, locked }` | layers | canvas (prevent interaction) |
| `box:desc` | `{ id }` | settings (recaption) | canvas (update label) |
| `collection:add` | `{ importJson }` | gallery (card button), editor (JSON header button) | collections (addItem) |


> **Queue note:** `queue.js` reuses `image:ready`, `runpod:loading`, and `runpod:done` — no new events. The Generate button now enqueues via `queue.enqueue()` instead of calling runpod directly.

## Editing Guide

- **Editing canvas interactions?** → `src/canvas.js` + `src/state.js`
- **Editing color palette?** → `src/palette.js` + `src/state.js`
- **Editing JSON output format?** → `src/json-builder.js`
- **Editing RunPod generation?** → `src/runpod.js`
- **Editing Modal generation?** → `src/modal.js`
- **Switching which backend a job uses?** → `src/backend.js` (reads `localStorage.ideogram_backend`)
- **Editing the generation queue?** → `src/queue.js`
- **Editing gallery/history?** → `src/gallery.js`
- **Editing form fields / mode toggle?** → `src/settings.js`
- **Editing layer panel?** → `src/layers.js`
- **Editing prompt collections?** → `src/collections.js` (+ `enqueueImportJson` in `src/queue.js`)
- **Editing PNG import logic?** → `src/png-import.js`
- **Adding a new button?** → Add ID in `index.html`, wire in `src/app.js`
- **Editing session persistence (save/restore on reload)?** → `src/session.js` (+ `initSession()` call after `initCanvas()` in `src/app.js`)
- **Adding a new event?** → Add to this catalog, emit from source, listen in target

## RunPod Backend (`runpod/`)

Serverless endpoint that runs Ideogram-4 via ComfyUI in a Docker container.

| File | Purpose |
|------|---------|
| `Dockerfile` | Custom image: ComfyUI (latest) + KJNodes + rgthree + Ideogram-4 models |
| `handler.py` | RunPod handler — accepts `import_json`, `width`, `height`, `preset`, `loras` → returns base64 images |
| `workflow_template_lora.json` | API-format ComfyUI workflow (lora-capable: rgthree Power Lora Loader, step presets). Live base, copied to `/workflow_template.json` in the image |
| `workflow_template.json` | Original 17-node workflow — dormant fallback, not copied into the image |
| `client.py` | CLI for sending requests to the RunPod endpoint |
| `modal_app.py` | Modal backend — reuses the Dockerfile image, hosts ComfyUI warm. Web proxy (`min_containers=1`) exposes two endpoints: `POST /generate` (spawns Comfy job, returns `call_id`) and `GET /status/{call_id}` (polls result). Token-authed via shared secret. |
| `example_prompt.json` | Sample prompt JSON for testing |

**Build:** Push a git tag (e.g. `v1.0.8`) → RunPod Container Builder rebuilds. Dockerfile path: `runpod/Dockerfile`, build context: repo root.

**API:** `POST /run` with `{ "input": { "import_json": "...", "width": 768, "height": 1152 } }` → returns `{ "output": { "images": [{ "filename", "type": "base64", "data" }] } }`

### Modal backend

Same ComfyUI image, hosted on Modal. Deploy: `modal deploy runpod/modal_app.py` (from repo root). Create the auth secret once: `modal secret create ideogram-builder AUTH_TOKEN=<value>`. GPU defaults to `T4` (16GB); set `IDEOGRAM_GPU=A10G` at deploy for the Classic dual-model workflow. UI toggle (RunPod/Modal) persists to `localStorage.ideogram_backend`; `src/backend.js` dispatches `runJob` accordingly.

**Architecture:** The web proxy (`min_containers=1`, always warm) splits generation into submit + poll to avoid gateway timeouts on long-running jobs: `POST /generate` spawns the Comfy job via `.spawn()` and returns `{"call_id": "..."}` immediately; `GET /status/{call_id}` uses `FunctionCall.from_id()` + `get(timeout=0)` to poll. `src/modal.js` mirrors runpod.js's submit+poll loop (3s cadence, 15min timeout).
