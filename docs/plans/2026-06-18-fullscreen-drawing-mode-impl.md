# Fullscreen Drawing Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toggle-driven fullscreen drawing workspace on the Editor tab that hides generation/settings chrome and enlarges the canvas.

**Architecture:** Pure CSS reflow driven by a `draw-fullscreen` class on `#tab-editor` (no DOM moves, no duplicated nodes). Canvas display scale is generalized to read `state.canvas.maxDisplayHeight`, recomputed on enter/exit/resize via a new `canvas:relayout` event. Toggle wiring lives in `app.js`.

**Tech Stack:** Vanilla JS (ES modules, no build), inline `<style>` in `index.html`, served by `python3 server.py`.

**Testing note:** This repo has no JS test framework and no build step (see `CLAUDE.md`). Introducing one is out of scope. Each task therefore verifies via running the app (`python3 server.py`) and a short manual check. Where useful, a `node --check` syntax sanity step is included.

---

### Task 1: Add state for fullscreen + canvas display-height cap

**Files:**
- Modify: `src/state.js:6-16`

**Step 1: Add `ui` and `maxDisplayHeight` fields**

In `src/state.js`, replace the `state` object literal:

```js
export const state = {
  canvas: { width: 1024, height: 1024, scale: 1, maxDisplayHeight: 800 },
  boxes: [],
  globalPalette: [],
  selectedBoxId: null,
  boxCounter: 0,
  photoArtMode: MODE_ARTSTYLE,
  preset: 'Default',
  loras: [],
  seed: -1,
  ui: { drawFullscreen: false },
};
```

**Step 2: Syntax check**

Run: `node --check src/state.js`
Expected: no output (success).

**Step 3: Commit**

```bash
git add src/state.js
git commit -m "feat(state): add canvas.maxDisplayHeight and ui.drawFullscreen"
```

---

### Task 2: Generalize canvas scale cap + add relayout listener

**Files:**
- Modify: `src/canvas.js:79-95` (resizeCanvas), `src/canvas.js:97-129` (initCanvas), `src/canvas.js:306-345` (initCanvasEvents listeners)

**Step 1: Replace the hardcoded `800` in `resizeCanvas`**

In `src/canvas.js`, inside `resizeCanvas()` replace this line:

```js
  state.canvas.scale = height > 800 ? 800 / height : 1;
```

with:

```js
  const maxH = state.canvas.maxDisplayHeight ?? 800;
  state.canvas.scale = height > maxH ? maxH / height : 1;
```

(There are two identical lines — one in `resizeCanvas` ~line 87, one in `initCanvas` ~line 105. Replace **both** with the same two lines.)

**Step 2: Add a `canvas:relayout` listener**

In `initCanvasEvents()`, next to the existing `on('canvas:rebuild', …)` listener (around `src/canvas.js:308`), add:

```js
  on('canvas:relayout', () => resizeCanvas());
```

`on` and `state` are already imported at the top of the file — no new imports.

**Step 3: Syntax check**

Run: `node --check src/canvas.js`
Expected: no output (success).

**Step 4: Verify nothing broke (normal mode unchanged)**

Run: `python3 server.py`, open the app, draw a box. Confirm the canvas still scales as before (no visual change at default `maxDisplayHeight = 800`).

**Step 5: Commit**

```bash
git add src/canvas.js
git commit -m "feat(canvas): scale by state.canvas.maxDisplayHeight; handle canvas:relayout"
```

---

### Task 3: DOM grouping + button hooks

**Files:**
- Modify: `index.html` (editor markup, ~lines 1800-2095)

**Step 1: Give the editor toolbar an id and add fullscreen buttons**

In `index.html`, change the opening tag of the editor toolbar:

```html
                <div class="editor-toolbar">
```

to:

```html
                <div class="editor-toolbar" id="editor-toolbar">
```

Find the Reset button and the closing `</div>` of `.editor-toolbar`:

```html
                    <button id="btn-reset" class="btn btn-secondary">Reset Canvas</button>
                </div>
```

Replace with (adds a spacer + the two toggle buttons):

```html
                    <button id="btn-reset" class="btn btn-secondary">Reset Canvas</button>
                    <button id="btn-enter-fullscreen" class="icon-btn" aria-label="Enter fullscreen drawing mode" title="Fullscreen drawing mode">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                    </button>
                    <button id="btn-exit-fullscreen" class="btn btn-secondary">Exit Fullscreen</button>
                </div>
```

**Step 2: Wrap the generation-only blocks in `.gen-only`**

Find these three sibling blocks inside `#tab-editor` (the `.ai-section`, the `.action-row` with the Generate button, and the `.json-section`). They currently sit between the editor toolbar and the end of `#tab-editor`. Wrap them so the structure becomes:

```html
                <div class="gen-only">
                    <div class="ai-section">
                        ... (unchanged) ...
                    </div>

                    <div class="action-row" style="position:relative;">
                        ... (unchanged) ...
                    </div>

                    <div class="json-section">
                        ... (unchanged) ...
                    </div>
                </div>
```

Do **not** wrap `.canvas-container` — it must stay outside `.gen-only` so it remains visible in fullscreen.

**Step 3: Add an id to the Global Settings panel**

Find the Global Settings panel opening tag (the `.panel` whose header says "Global Settings"):

```html
            <div class="panel">
                <div class="panel-header">
                    <h3>Global Settings</h3>
                </div>
```

Replace the outer `<div class="panel">` with:

```html
            <div class="panel" id="global-settings-panel">
```

**Step 4: Verify the page still renders**

Reload the app. Normal Editor layout must look identical to before. Open DevTools → Console: confirm no errors and that `document.getElementById('btn-enter-fullscreen')`, `btn-exit-fullscreen`, `global-settings-panel`, and `editor-toolbar` all resolve.

**Step 5: Commit**

```bash
git add index.html
git commit -m "feat(html): group gen-only blocks, id panels, add fullscreen toggle buttons"
```

---

### Task 4: Fullscreen CSS

**Files:**
- Modify: `index.html` `<style>` block (append before the closing `</style>`, ~line 1785)

**Step 1: Append the fullscreen rules**

Add this CSS just before the `</style>` tag (after the existing `@media (prefers-reduced-motion: reduce)` block):

```css
        /* Fullscreen drawing mode — toggled via #tab-editor.draw-fullscreen */
        #btn-exit-fullscreen { display: none; }

        #tab-editor.draw-fullscreen {
            position: fixed;
            inset: 0;
            z-index: 50;
            overflow: auto;
            background: var(--bg);
            display: flex;
            flex-direction: column;
            padding: 12px;
            gap: 12px;
            box-sizing: border-box;
        }

        #tab-editor.draw-fullscreen .editor-toolbar {
            margin-bottom: 0;
            flex-shrink: 0;
        }

        #tab-editor.draw-fullscreen .gen-only,
        #tab-editor.draw-fullscreen #global-settings-panel {
            display: none;
        }

        #tab-editor.draw-fullscreen #btn-enter-fullscreen { display: none; }
        #tab-editor.draw-fullscreen #btn-exit-fullscreen { display: inline-flex; }

        #tab-editor.draw-fullscreen .main-content {
            flex: 1;
            min-height: 0;
            align-items: stretch;
        }

        #tab-editor.draw-fullscreen .left-col {
            flex: 1;
            min-width: 0;
            min-height: 0;
        }

        #tab-editor.draw-fullscreen .canvas-container {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
```

**Step 2: Smoke-test the CSS in isolation**

In DevTools Console, run:

```js
document.getElementById('tab-editor').classList.add('draw-fullscreen');
```

Expected: Editor goes fixed/full-viewport; AI Prompt, Generate, JSON, and Global Settings vanish; canvas + Layers + Box Properties remain. The exit button is visible, enter button hidden.

Then:

```js
document.getElementById('tab-editor').classList.remove('draw-fullscreen');
```

Expected: normal layout restored.

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat(css): draw-fullscreen layout (top bar + right rail, hide gen/settings)"
```

---

### Task 5: Wire the toggle (buttons, Esc, resize, relayout)

**Files:**
- Modify: `src/app.js`

**Step 1: Add the `emit` import**

In `src/app.js`, add to the existing imports near the top:

```js
import { emit } from './events.js';
```

**Step 2: Add the fullscreen helpers + wiring**

Append the following at the end of `src/app.js` (after `initCanvas();`). `state` is already imported on line 44.

```js
// --- Fullscreen drawing mode ---
function applyFullscreenHeight() {
  const topbar = document.getElementById('editor-toolbar');
  const overhead = (topbar ? topbar.offsetHeight : 52) + 96; // toolbar + paddings + gaps + margin
  state.canvas.maxDisplayHeight = Math.max(400, window.innerHeight - overhead);
}

function setFullscreen(on) {
  state.ui.drawFullscreen = on;
  document.getElementById('tab-editor').classList.toggle('draw-fullscreen', on);
  if (on) {
    applyFullscreenHeight();
  } else {
    state.canvas.maxDisplayHeight = 800;
  }
  emit('canvas:relayout');
}

document.getElementById('btn-enter-fullscreen').addEventListener('click', () => setFullscreen(true));
document.getElementById('btn-exit-fullscreen').addEventListener('click', () => setFullscreen(false));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.ui.drawFullscreen) setFullscreen(false);
});

window.addEventListener('resize', () => {
  if (!state.ui.drawFullscreen) return;
  applyFullscreenHeight();
  emit('canvas:relayout');
});
```

**Step 3: Syntax check**

Run: `node --check src/app.js`
Expected: no output (success).

**Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat(app): wire fullscreen toggle (buttons, Esc, resize, canvas:relayout)"
```

---

### Task 6: Manual verification checklist

Run `python3 server.py` and verify each item in the browser:

**Files:** none (verification only)

- [ ] Click the maximize icon in the editor toolbar → editor covers the full viewport (brand + Gallery/Vision tabs hidden).
- [ ] In fullscreen: AI Prompt, Generate, Prompt JSON, and Global Settings are hidden; canvas, Layers, Box Properties, aspect/size/dims/overlay/reset remain.
- [ ] Canvas is visibly larger than in normal mode.
- [ ] Draw a **new** box by click-dragging → it appears at the correct pointer location.
- [ ] Drag a box, use the bottom-right resize handle, and use a corner handle → all track the pointer accurately (no offset).
- [ ] Select a box → Box Properties appears in the right rail; editing Description/Text/Element Type/Colors applies.
- [ ] Layers panel: reorder (drag), toggle visibility, toggle lock → all work while fullscreen.
- [ ] Overlay image (load via gallery item or Vision) + opacity slider work in fullscreen.
- [ ] Press **Esc** → exits to normal layout.
- [ ] Click **Exit Fullscreen** button → exits to normal layout.
- [ ] While fullscreen, resize the browser window → canvas relayouts to fit.
- [ ] After exit, normal Editor layout is fully restored and Gallery/Vision tabs are reachable.
- [ ] `prefers-reduced-motion` users: toggling does not animate (covered by the global reduce rule).

If any coordinate/drag offset appears after relayout, confirm `state.canvas.scale` is being recomputed (DevTools: `import('./src/state.js').then(m => console.log(m.state.canvas.scale))` via the module graph, or add a temporary `console.log` in `resizeCanvas`).

---

## Rollback

All changes are isolated to: `src/state.js`, `src/canvas.js`, `src/app.js`, and `index.html`. To revert:

```bash
git revert <commit-sha>   # per-task commits allow selective revert
```
