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
6. `comfyui-template.js` is pure data — only imported by `comfyui.js`

## Module Map

| Module | Owns | Imports from |
|--------|------|-------------|
| `state.js` | All mutable state (boxes, palette, canvas dims, mode) | nothing |
| `events.js` | Pub/sub event bus | nothing |
| `canvas.js` | Canvas wrapper DOM, bounding boxes, pointer events | state, events |
| `palette.js` | Color swatch DOM, add/remove colors | state, events |
| `json-builder.js` | JSON output textarea | state, events |
| `comfyui.js` | ComfyUI API calls | state, events, comfyui-template |
| `comfyui-template.js` | Base64 workflow JSON constant | nothing |
| `png-import.js` | PNG metadata parsing, drag-drop, JSON load | state, events |
| `settings.js` | Mode toggle, sliders, box form fields | state, events |
| `app.js` | Button wiring, init orchestration | all modules |

## Event Catalog

| Event | Payload | Emitted by | Consumed by |
|-------|---------|-----------|-------------|
| `box:selected` | `{ id }` or `null` | canvas | settings (form), palette (colors) |
| `canvas:reset` | none | canvas | json-builder (clear textarea) |
| `canvas:rebuild` | none | png-import | canvas (calls initCanvas) |
| `image:ready` | `{ imageUrl }` | comfyui, png-import | canvas (background + image-view) |
| `state:loaded` | `{ json }` | png-import | canvas (boxes), settings (form), palette (colors) |

## Editing Guide

- **Editing canvas interactions?** → `src/canvas.js` + `src/state.js`
- **Editing color palette?** → `src/palette.js` + `src/state.js`
- **Editing JSON output format?** → `src/json-builder.js`
- **Editing ComfyUI workflow?** → `src/comfyui-template.js` + `src/comfyui.js`
- **Editing form fields / mode toggle?** → `src/settings.js`
- **Editing PNG import logic?** → `src/png-import.js`
- **Adding a new button?** → Add ID in `index.html`, wire in `src/app.js`
- **Adding a new event?** → Add to this catalog, emit from source, listen in target

## RunPod Backend (`runpod/`)

Serverless endpoint that runs Ideogram-4 via ComfyUI in a Docker container.

| File | Purpose |
|------|---------|
| `Dockerfile` | Custom image: ComfyUI (latest) + KJNodes + rgthree + Ideogram-4 models |
| `handler.py` | RunPod handler — accepts `import_json`, `width`, `height` → returns base64 images |
| `workflow_template.json` | API-format ComfyUI workflow (17 nodes, stripped UI-only nodes) |
| `client.py` | CLI for sending requests to the RunPod endpoint |
| `example_prompt.json` | Sample prompt JSON for testing |

**Build:** Push a git tag (e.g. `v1.0.8`) → RunPod Container Builder rebuilds. Dockerfile path: `runpod/Dockerfile`, build context: repo root.

**API:** `POST /run` with `{ "input": { "import_json": "...", "width": 768, "height": 1152 } }` → returns `{ "output": { "images": [{ "filename", "type": "base64", "data" }] } }`
