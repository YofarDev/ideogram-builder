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
6. Pure helpers (`prompt-*.js`, `escape-html.js`) have no DOM/state access and may be imported by any module. Same-feature split files (`json-builder-moss.js`, `settings-box.js`, `gallery-meta.js`, …) may import each other

## Module Map

| Module | Owns | Imports from |
|--------|------|-------------|
| `state.js` | All mutable state (boxes + tags, palette, canvas dims, mode, `model`, `moss` promptMode/preset) + `syncBoxesFromDOM()` | nothing |
| `events.js` | Pub/sub event bus | nothing |
| `canvas.js` | Canvas wrapper DOM, bounding boxes, pointer events, image overlay | state, events |
| `canvas-pointer.js` | Bounded pointer gestures, cancellation, capture and commit lifecycle | state, events, canvas-core, toast |
| `palette.js` | Color swatch DOM, add/remove colors | state, events |
| `json-builder.js` | JSON pane dispatcher: format-detecting apply (Ideogram/MOSS/draft/caption + auto model switch), Ideogram output, format chip | state, events, toast, prompt-convert, json-builder-moss |
| `prompt-draft.js` | Preserve manual JSON-pane drafts separately from the generated editor prompt; draft indicator, revert and session capture | events |
| `json-builder-moss.js` | MOSS layout/caption output + MOSS apply path (split of json-builder) | state, events, toast, prompt-moss |
| `json-convert.js` | `#btn-convert-json` (⇄ in the JSON header): converts the pane's prompt Ideogram ↔ MOSS and applies it via `prompt:apply` (overwrites the target model's fields) | state, events, toast, prompt-convert |
| `model.js` | Workspace switch (`#model-toggle`, Ideogram/MOSS), `model:set`/`model:changed` events, persistence | state, events |
| `runpod.js` | RunPod serverless API calls: `runJob(snapshot)` submit + poll; moss → `runpod.endpoints.moss` | nothing |
| `settings-box.js` | Box Properties form: type toggle (obj/text/character), text/desc/tags, X/Y/W/H (split of settings) | state, events |
| `settings-moss.js` | MOSS fieldset: prompt format, caption/meta/canvas/negative, D4 seeding on model switch | state, events, toast, prompt-convert |
| `prompt-moss.js` | Pure MOSS layout helpers: buildMossLayout/compileMoss/parseMoss/predicates (ComfyUI-matching maths) | nothing |
| `prompt-convert.js` | Pure format detection, Ideogram↔MOSS global converters, full-document `ideogramToMoss` / `mossToIdeogram` | prompt-moss |
| `lora-library.js` | LoRA library data: per-model built-ins + user entries in localStorage | nothing |
| `lora-panel.js` | LoRA popover chrome: open/close (outside click, Escape), search box → callbacks (split of lora) | nothing |
| `lora-cards.js` | Pure HTML templates for LoRA popover cards (split of lora) | escape-html |
| `lora-add.js` | "+ Add" LoRA form: URL or file upload (XHR progress) → `lora:added` | state, events, toast |
| `gallery-meta.js` | Gallery card meta restore (model-first, MOSS preset/negative/prompt-mode) | state, events, lora |
| `session-moss.js` | MOSS session capture/restore (model, moss inputs, prompt mode, preset) | state, events |
| `session-workspace.js` | Session canvas dimensions, boxes, palette and layer selection independent of prompt format | state, events |
| `reference-image.js` | Local image-reference validation and lazy image loading for recaptioning | state |
| `collections-io.js` | Collection file export/import with complete validation and variable/reference round trips | toast, collections-data, collections-records |
| `collections-records.js` | Collection record validation, legacy normalization, prompt summaries and model detection | prompt-convert |
| `collections-detail.js` | Accessible collection detail, variable and prompt-edit form templates | collections-data, collections-drafts, escape-html |
| `collections-drafts.js` | In-memory prompt drafts tied to live collection items; saved recipes stay unchanged until Save | nothing |
| `collections-edit.js` | Prompt validation/save/cancel and collection rename lifecycle | collections-data, collections-drafts, events, toast |
| `collections-interactions.js` | Collection tab keys, disclosure/action focus, input bindings and prompt-edit shortcuts | collections-data, collections-drafts, events |
| `ai-enhancer-moss.js` | MOSS prompts for the AI enhancer (layout draft / caption) + result validation | events, prompt-moss |
| `vision-moss.js` | Vision result → `moss` payload conversion (ideogramGlobalsToMoss) | prompt-convert |
| `modal.js` | Modal serverless API calls: `runJob(snapshot)` submit + poll (mirrors runpod.js) | nothing |
| `backend.js` | Dispatcher — routes `runJob(snapshot)` to RunPod or Modal per `localStorage.ideogram_backend` | runpod, modal |
| `queue.js` | Generation queue — enqueue, sequential worker, cancel and retry | state, events, backend, toast, queue-panel, queue-snapshot |
| `queue-panel.js` | Persistent queue rows, visible failure recovery, keyboard focus through progress and removal | DOM only |
| `queue-snapshot.js` | Capture immutable prompt/settings recipes and server-resolved generation metadata | state, DOM |
| `png-import.js` | PNG metadata parsing, drag-drop; per-node prompt detection (Ideogram/MOSS) → `prompt:apply` | state, events, toast, prompt-convert |
| `ai-enhancer.js` | Multi-provider LLM prompt enhancement (deepseek, google, openrouter, mimo); MOSS mode delegates to ai-enhancer-moss | state, events, ai-enhancer-moss |
| `gallery.js` | On-demand history loading, search/model filters, paging, image save/delete and editor loading | events, state, gallery-cards, gallery-meta, tabs |
| `gallery-cards.js` | Safe gallery card DOM, searchable descriptions and thumbnail/original-image links | prompt-convert |
| `tabs.js` | Workspace/Assist tab selection, ARIA state, roving focus and keyboard navigation | events |
| `settings.js` | Mode toggle, aspect ratio (persisted), box form fields, toolbar generation params (seed, engine, turbo strength, backend) | state, events |
| `layers.js` | Layer panel UI — list, reorder, visibility, lock | state, events, canvas (selectBox) |
| `layer-row.js` | Persistent layer controls, keyboard selection/reordering, drag-and-drop | state, events, layer-thumbnail |
| `layer-thumbnail.js` | Bounded image crops cached per live layer row | DOM only |
| `lora.js` | LoRA toolbar popover (`#btn-lora` → `#lora-panel`): active stack + strength, searchable per-model library, user-entry delete, restore | state, events, toast, lora-library, lora-cards, lora-panel |
| `collections.js` | Collections actions: per-model items, batch generate with each item's model, load-to-editor | events, state, toast, collections-data, collections-ui, collections-io |
| `app.js` | Button wiring, init orchestration | all modules |
| `session.js` | Session persistence — save/restore content + config + UI (+ MOSS via session-moss) to `localStorage.ideogram_session` | events, prompt-convert, session-moss |

## Event Catalog

| Event | Payload | Emitted by | Consumed by |
|-------|---------|-----------|-------------|
| `box:selected` | `{ id }` or `null` | canvas | settings (form), palette (colors) |
| `workspace:restore` | `{ boxes, palette, selectedIndex }` — validated session editing details | session-workspace | canvas, palette |
| `preview:changed` | `{ enabled }` | canvas-core | session |
| `loras:changed` | none — persist the active adapter stack and strengths | lora | session |
| `prompt:draft-changed` | none — persist manual prompt edits | prompt-draft | session |
| `prompt:draft-restore` | `{ text }` — restore raw draft after editor state | session | json-builder |
| `prompt:prepare` | mutable `{ ok }` — apply an editor draft before the generation snapshot | queue | json-builder |
| `image:saved` | `{ imageUrl, dataUrl }` — match an on-disk output to the current reference | gallery | canvas, session |
| `overlay:changed` | none — persist reference opacity | canvas | session |
| `canvas:reset` | none | canvas | json-builder (clear textarea) |
| `canvas:rebuild` | none | png-import | canvas (calls initCanvas) |
| `canvas:relayout` | none | app | canvas (calls resizeCanvas) |
| `image:ready` | `{ imageUrl }` | runpod, png-import | canvas (overlay image), gallery (save to history) |
| `runpod:loading` | none | runpod | (future: disable UI) |
| `runpod:done` | none | runpod | (future: re-enable UI) |
| `state:loaded` | `{ json, moss? }` — `moss` payload `{caption, meta, canvas, palette, negative?}` fills the MOSS inputs | png-import, json-builder (apply), gallery, session, vision (+ `moss` in MOSS mode), collections | canvas (boxes + tags), settings (Ideogram form), settings-moss (MOSS inputs), palette (colors), layers (rebuild) |
| `layers:reordered` | none | layers | canvas (reapply z-index) |
| `box:visibility` | `{ id, visible }` | layers | canvas (hide/show DOM) |
| `box:lock` | `{ id, locked }` | layers | canvas (prevent interaction) |
| `box:desc` | `{ id }` | settings (recaption) | canvas (update label) |
| `collection:add` | `{ importJson, imageUrl?, model? }` | gallery (card button), editor (JSON header button) | collections (addItem with model) |
| `model:set` | `{ model, seed? }` — request a switch; `seed: false` suppresses D4 field seeding (paste-driven switches) | json-builder, gallery-meta, session-moss, png-import (via prompt:apply), collections | model |
| `model:changed` | `{ model, previous, seed }` | model | settings (4M→2M), settings-box (type toggle re-render), settings-moss (D4 seeding), json-builder (regenerate), lora (per-model filter) |
| `prompt:apply` | `{ raw, quiet? }` — shared apply path (format detection + model switch + boxes); `quiet` skips the "Switched to …" toast | json-builder (own button), gallery (loadItem), session (applyContent), png-import, collections (loadItemToEditor), ai-enhancer-moss, json-convert (quiet) | json-builder |
| `lora:added` | `{ entry }` | lora-add | lora (library insert) |
| `vision:find-more-results` | `{ elements }` | vision (Find missing) | audit (render as add_element cards) |


> **Queue note:** `queue.js` reuses `image:ready`, `runpod:loading`, and `runpod:done` — no new events. The Generate button now enqueues via `queue.enqueue()` instead of calling runpod directly. `queue:enqueue` payloads carry `{ importJson, model }` (collections pass each item's model); generation meta carries `model`, `negativePrompt`, `promptFormat`, `mossPreset`.

## Editing Guide

- **Editing canvas interactions?** → `src/canvas.js` + `src/state.js`
- **Editing color palette?** → `src/palette.js` + `src/state.js`
- **Editing JSON output format?** → `src/json-builder.js`
- **Editing Ideogram ↔ MOSS conversion?** → `src/prompt-convert.js` (mapping) + `src/json-convert.js` (button)
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

Serverless endpoints that run Ideogram-4 or MOSS-Image via ComfyUI in Docker containers. Jobs carry `model`: absent/`"ideogram"` → Ideogram-4 workflow, `"moss"` → MOSS workflow (presets Turbo/Fast/Quality resolved server-side; `negative_prompt` and multiples-of-16 dimensions).

| File | Purpose |
|------|---------|
| `Dockerfile` | Ideogram-4 image: ComfyUI (latest) + KJNodes + rgthree + Ideogram-4 models |
| `Dockerfile.moss` | MOSS-Image image: ComfyUI (pinned ≥ MOSS merge) + rgthree + MOSS models + DMD LoRA. Second RunPod endpoint, same repo |
| `handler.py` | Shared RunPod handler — accepts `model`, `import_json`, `width`, `height`, `preset`, `negative_prompt`, `loras` → returns base64 images + used `seed` |
| `workflow_template_lora.json` | API-format ComfyUI workflow (lora-capable: rgthree Power Lora Loader, step presets). Live base, copied to `/workflow_template.json` in the image |
| `workflow_template.json` | Original 17-node workflow — dormant fallback, not copied into the image |
| `workflow_template_moss.json` | MOSS-Image workflow (UNET/CLIP/VAE loaders, DMD LoRA, SLG, KSampler), copied into the MOSS image only |
| `client.py` | CLI for sending requests to a RunPod endpoint (`--model`, `--preset`, `--negative`, `--prompt`) |
| `modal_app.py` | Modal backend — hosts both images (Comfy, ComfyMoss) behind one web proxy. `POST /generate` (spawns job, returns `call_id`, routes on `payload.model`) and `GET /status/{call_id}` (polls result). Token-authed via shared secret. |
| `example_prompt.json` | Sample Ideogram prompt JSON for testing |
| `example_moss_layout.json` | Sample MOSS layout JSON for testing |

**Build:** Push a git tag (e.g. `v1.0.8`) → RunPod Container Builder rebuilds. Dockerfile path: `runpod/Dockerfile`, build context: repo root. The MOSS endpoint (`runpod/Dockerfile.moss`, same context) is created manually as a second serverless endpoint.

**API:** `POST /run` with `{ "input": { "import_json": "...", "width": 768, "height": 1152 } }` → returns `{ "output": { "images": [{ "filename", "type": "base64", "data" }], "seed": <int> } }`

### Modal backend

Both ComfyUI images hosted on Modal, one proxy app. Deploy: `modal deploy runpod/modal_app.py` (from repo root). Create the auth secret once: `modal secret create ideogram-builder AUTH_TOKEN=<value>` (+ `HF_TOKEN=<value>` for private-repo LoRA downloads). GPU defaults to `RTX-PRO-6000`; set `IDEOGRAM_GPU=...` at deploy to change. The proxy routes `{"model": "moss"}` requests to the `ComfyMoss` class, everything else to `Comfy`. User LoRAs live in the `ideogram-loras` Modal Volume mounted at `/comfyui/models/loras/user` on both classes (reloaded per job). UI toggle (RunPod/Modal) persists to `localStorage.ideogram_backend`; `src/backend.js` dispatches `runJob` accordingly.

**Architecture:** The web proxy (`min_containers=1`, always warm) splits generation into submit + poll to avoid gateway timeouts on long-running jobs: `POST /generate` spawns the Comfy job via `.spawn()` and returns `{"call_id": "..."}` immediately; `GET /status/{call_id}` uses `FunctionCall.from_id()` + `get(timeout=0)` to poll. `src/modal.js` mirrors runpod.js's submit+poll loop (3s cadence, 15min timeout).
