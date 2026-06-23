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
| `queue.js` | Generation queue — snapshot, enqueue, sequential worker, panel DOM | state, events, runpod, toast |
| `png-import.js` | PNG metadata parsing, drag-drop, JSON load | state, events |
| `ai-enhancer.js` | Multi-provider LLM prompt enhancement (deepseek, google, openrouter, mimo) | events |
| `gallery.js` | Tab switching, history grid, thumbnail creation, localStorage | events |
| `settings.js` | Mode toggle, aspect ratio (persisted), box form fields | state, events |
| `layers.js` | Layer panel UI — list, reorder, visibility, lock | state, events, canvas (selectBox) |
| `lora.js` | LoRA library (localStorage), selection, override application | state, events |
| `app.js` | Button wiring, init orchestration | all modules |

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
| `lora:selected` | `{ overrides }` | lora | settings (snapshot form + apply overrides) |
| `lora:cleared` | none | lora | settings (restore snapshot) |

> **Queue note:** `queue.js` reuses `image:ready`, `runpod:loading`, and `runpod:done` — no new events. The Generate button now enqueues via `queue.enqueue()` instead of calling runpod directly.

## Editing Guide

- **Editing canvas interactions?** → `src/canvas.js` + `src/state.js`
- **Editing color palette?** → `src/palette.js` + `src/state.js`
- **Editing JSON output format?** → `src/json-builder.js`
- **Editing RunPod generation?** → `src/runpod.js`
- **Editing the generation queue?** → `src/queue.js`
- **Editing gallery/history?** → `src/gallery.js`
- **Editing form fields / mode toggle?** → `src/settings.js`
- **Editing layer panel?** → `src/layers.js`
- **Editing PNG import logic?** → `src/png-import.js`
- **Adding a new button?** → Add ID in `index.html`, wire in `src/app.js`
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
| `example_prompt.json` | Sample prompt JSON for testing |

**Build:** Push a git tag (e.g. `v1.0.8`) → RunPod Container Builder rebuilds. Dockerfile path: `runpod/Dockerfile`, build context: repo root.

**API:** `POST /run` with `{ "input": { "import_json": "...", "width": 768, "height": 1152 } }` → returns `{ "output": { "images": [{ "filename", "type": "base64", "data" }] } }`
