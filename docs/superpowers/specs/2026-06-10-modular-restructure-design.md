# Ideogram Builder — Modular Restructure Design

**Date**: 2026-06-10
**Status**: Approved
**Goal**: Restructure single 883-line `index.html` into modular, LLM-agent-safe vanilla JS architecture.

## Constraints

- Zero build tools — must open directly in browser (or trivial static server)
- Vanilla HTML/CSS/JS only — no frameworks, no npm
- ES modules for encapsulation (`<script type="module">`)
- Git-tracked for history

## Architecture: Flat Module-per-Concern

### File Structure

```
ideogram-builder/
├── index.html              — HTML structure + CSS (no JS inline)
├── src/
│   ├── app.js              — Entry: imports all modules, calls init()
│   ├── state.js            — Central state + mutation helpers
│   ├── events.js           — Pub/sub event bus
│   ├── canvas.js           — Canvas init, box draw/drag/resize/select
│   ├── palette.js          — Color add/remove/render (global + per-box)
│   ├── json-builder.js     — Generate Ideogram4 JSON from state
│   ├── comfyui.js          — ComfyUI API: send prompt, poll results
│   ├── comfyui-template.js — Base64 workflow template (extracted constant)
│   ├── png-import.js       — PNG tEXt chunk parsing + state reconstruction
│   └── settings.js         — Photo/art mode toggle, slider bindings
├── CLAUDE.md               — Architecture rules for LLM sessions
└── docs/
    └── superpowers/specs/  — This design doc
```

### Module Dependency Graph

```
state.js ← (all modules read/write state)
events.js ← (all modules use pub/sub)

app.js
  ├── imports state, events
  ├── imports canvas
  ├── imports palette
  ├── imports json-builder
  ├── imports comfyui
  ├── imports png-import
  └── imports settings

No module imports another feature module directly.
Cross-module communication via events.js only.
```

### Module Responsibility Map

| Module | Owns | Depends on | Emits | Listens to |
|--------|------|-----------|-------|-----------|
| **state.js** | All mutable state (boxes, palette, canvas dims, mode, selected box) | nothing | nothing | nothing |
| **events.js** | Pub/sub registry | nothing | nothing | nothing |
| **canvas.js** | `#canvas-wrapper` DOM, bounding box elements | state, events | `box:created`, `box:updated`, `box:deleted`, `box:selected` | `state:loaded` |
| **palette.js** | Color swatch DOM (`.color-list`, `.swatch`) | state, events | `palette:changed` | `box:selected`, `state:loaded` |
| **json-builder.js** | `#json-output` textarea | state | nothing | nothing (called on button click) |
| **comfyui.js** | API calls, `#image-view` display | state, events | `image:generated` | nothing (called on button click) |
| **comfyui-template.js** | Base64 workflow JSON constant | nothing | nothing | nothing (pure data export) |
| **png-import.js** | PNG tEXt chunk parsing, drag-drop handler | state, events | `state:loaded` | nothing (called on file drop) |
| **settings.js** | Photo/art mode toggle, width/height/seed sliders | state, events | nothing | `state:loaded` |
| **app.js** | Module wiring, `init()` orchestration | all modules | nothing | nothing |

### Event Catalog

| Event | Payload | Emitted by | Consumed by |
|-------|---------|-----------|-------------|
| `box:created` | `{ id, x, y, w, h }` | canvas | (future use) |
| `box:updated` | `{ id }` | canvas | (future use) |
| `box:deleted` | `{ id }` | canvas | (future use) |
| `box:selected` | `{ id }` or `null` | canvas | palette (render box colors), settings (show/hide panel) |
| `palette:changed` | `{ type: 'global' \| 'box' }` | palette | (future use) |
| `state:loaded` | `{ json, boxes, params }` | png-import | canvas (recreate boxes), palette (render colors), settings (restore form) |
| `image:generated` | `{ imageUrl }` | comfyui | canvas (set background) |

## State Management

Single source of truth in `state.js`. Plain object + exported helper functions.

```js
export const state = {
  canvas: { width: 1024, height: 1024, scale: 1 },
  boxes: [],
  globalPalette: [],
  selectedBoxId: null,
  boxCounter: 0,
  photoArtMode: 'art_style',
};

export function getBox(id) { ... }
export function addBox(box) { ... }
export function removeBox(id) { ... }
export function updateBox(id, props) { ... }
export function selectBox(id) { ... }
export function addColorToPalette(type, hex) { ... }
export function removeColorFromPalette(type, hex) { ... }
```

## Event Bus

Tiny pub/sub in `events.js`:

```js
const listeners = {};
export function on(event, fn) { (listeners[event] ??= []).push(fn); }
export function emit(event, data) { (listeners[event] ?? []).forEach(fn => fn(data)); }
```

## Architecture Rules (for CLAUDE.md)

1. Each module imports only from `state.js`, `events.js`, or browser APIs — never from sibling feature modules
2. Cross-module communication goes through `events.js` emit/on only
3. No module touches another module's DOM elements
4. Max ~150 LOC per file — split if approaching 200
5. State mutations go through `state.js` helper functions, not direct property assignment from other modules
6. The `comfyui-template.js` base64 constant is pure data — never import it from anywhere except `comfyui.js`

## CLAUDE.md Contents

The project root `CLAUDE.md` will contain:
1. Architecture rules (the 6 rules above)
2. Module map (the table above)
3. Editing guide ("editing canvas? → `src/canvas.js` + `src/state.js` only")
4. Event catalog (all events, payloads, who emits, who listens)
5. File size limit (flag files approaching 200 LOC)

## Migration Strategy

1. Init git repo, commit current `index.html` as baseline
2. Extract CSS into `<style>` block in `index.html` (stays there — no separate CSS file needed for this scale)
3. Create `src/` directory with all 10 module files
4. Replace inline `<script>` with `<script type="module" src="src/app.js">`
5. Move code from `index.html` into modules, following the responsibility map
6. Test: open in browser, verify all functionality works
7. Write `CLAUDE.md`
8. Commit restructured code

## Success Criteria

- All current functionality works identically
- No global variables (all state in `state.js`)
- No function exceeds 50 LOC
- No file exceeds 150 LOC
- LLM can edit one module without breaking others
- CLAUDE.md provides enough context for a new LLM session to make safe edits
