# Editor Layout Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the Editor tab from a vertical two-column layout (canvas shares a column with AI prompt + JSON, forcing scroll) into a three-column layout (Global Settings left / canvas center / JSON right), move AI Prompt + Generate into a modal dialog, relocate Layers + Box Properties into fullscreen-only, and surface a Turbo/Classic workflow toggle in the top toolbar.

**Architecture:** Pure DOM reorganization of a vanilla-JS app. IDs are preserved everywhere so the event-bus + `getElementById` wiring in the modules keeps working unchanged. The events catalog (`src/events.js`) and the RunPod backend contract are untouched. No new modules.

**Tech Stack:** Vanilla JS ES modules, inline CSS in `index.html` (OKLCH dark theme). Verification = `npm test` (vitest, pure-logic regression gate) + manual browser checks. There is no DOM test framework, so UI changes are verified by serving with `python3 server.py` and clicking through.

**Design doc:** `docs/plans/2026-06-19-editor-redesign-design.md` (read this for the "why").

---

## Key reference facts (do not re-discover)

- All UI markup is in `/home/yofardev/Dev/ideogram-builder/index.html` (2261 lines). CSS is inline in `<style>` (lines 11–1907). Body markup is lines 1909–2259.
- The editor toolbar (`.editor-toolbar#editor-toolbar`) is at `index.html:1921-1949`.
- The AI section (`.ai-section.gen-only`) is at `index.html:1950-1965`.
- The Generate row (`.action-row.gen-only`) is at `index.html:1971-1974`.
- The JSON section (`.json-section.gen-only`) is at `index.html:1976-1990`.
- The right column (`.right-col`) holding Settings + Layers + Box is at `index.html:2067-2252`.
- Fullscreen JS lives in `src/app.js:50-79`. Workflow/engine JS lives in `src/settings.js:73-113`.
- The `gen-only` class = "hidden in fullscreen" (CSS at `index.html:1881-1883`).
- Existing test suite: run `npm test` after every task. Tests cover pure logic only (ai-enhancer, runpod, png-import, json-builder, events, state) — they must stay green because module code keeps using the same element IDs (just relocated in the DOM).
- Serve locally with `python3 server.py` (auto-loads `~/.config/llm-credentials.json`).

---

## Task 1: Add Turbo/Classic workflow toggle to the top toolbar

This is the highest-value, lowest-risk change the user explicitly asked for. We add a segmented control to the top toolbar and remove the buried "Engine" pill group from Global Settings. Standalone-coherent.

**Files:**
- Modify: `index.html` (toolbar markup ~line 1916, remove Engine pill ~lines 2086-2094)
- Modify: `index.html` CSS (add `.workflow-toggle` styles near the pill-group styles)
- Modify: `src/settings.js:73-113` (swap engine-radio handler for workflow-radio handler)

**Step 1: Add the workflow toggle to the toolbar**

In `index.html`, find the toolbar block (lines 1911-1916):

```html
    <header class="toolbar">
        <div class="toolbar-brand">Ideogram <em>Builder</em></div>
        <button class="tab-btn active" data-tab="editor" role="tab" aria-selected="true" aria-controls="tab-editor" id="tab-btn-editor">Editor</button>
        <button class="tab-btn" data-tab="gallery" role="tab" aria-selected="false" aria-controls="tab-gallery" id="tab-btn-gallery">Gallery</button>
        <button class="tab-btn" data-tab="vision" role="tab" aria-selected="false" aria-controls="tab-vision" id="tab-btn-vision">Vision</button>
    </header>
```

Replace with (adds a spacer + workflow segmented control on the right):

```html
    <header class="toolbar">
        <div class="toolbar-brand">Ideogram <em>Builder</em></div>
        <button class="tab-btn active" data-tab="editor" role="tab" aria-selected="true" aria-controls="tab-editor" id="tab-btn-editor">Editor</button>
        <button class="tab-btn" data-tab="gallery" role="tab" aria-selected="false" aria-controls="tab-gallery" id="tab-btn-gallery">Gallery</button>
        <button class="tab-btn" data-tab="vision" role="tab" aria-selected="false" aria-controls="tab-vision" id="tab-btn-vision">Vision</button>
        <div class="toolbar-spacer"></div>
        <div class="workflow-toggle pill-group" id="workflow-toggle" role="radiogroup" aria-label="Workflow engine">
            <input type="radio" id="workflow-turbo" name="workflow" value="turbo" checked>
            <label for="workflow-turbo" class="pill-label">Turbo</label>
            <input type="radio" id="workflow-classic" name="workflow" value="v1">
            <label for="workflow-classic" class="pill-label">Classic</label>
        </div>
    </header>
```

**Step 2: Add CSS for the workflow toggle**

The existing `.pill-group` / `.pill-label` styles already do the segmented look. We only need to constrain the toggle's size and hide it on Gallery/Vision tabs. In `index.html`, find the gallery/vision hide rule (lines 1501-1509):

```css
        .main-content.gallery-active .right-col,
        .main-content.vision-active .right-col {
            display: none;
        }

        .main-content.gallery-active .left-col,
        .main-content.vision-active .left-col {
            max-width: 100%;
        }
```

Replace with (adds the toggle-hide rule; the `.left-col` rule is left intact for now — it is removed in Task 2):

```css
        .main-content.gallery-active .right-col,
        .main-content.vision-active .right-col {
            display: none;
        }

        .main-content.gallery-active .left-col,
        .main-content.vision-active .left-col {
            max-width: 100%;
        }

        body.gallery-active .workflow-toggle,
        body.vision-active .workflow-toggle {
            display: none;
        }
```

Note: check that `gallery.js` adds the `gallery-active`/`vision-active` classes to the `<body>` (not just `.main-content`). If it adds them to `.main-content` only, add a parallel line `.main-content.gallery-active .workflow-toggle, .main-content.vision-active .workflow-toggle { display: none; }`. Verify by grepping `gallery-active` in `src/gallery.js`.

**Step 3: Remove the Engine pill group from Global Settings**

In `index.html`, find the Engine input-group (lines 2086-2094):

```html
                        <div class="input-group">
                            <span style="display:block;font-size:12px;font-weight:500;color:var(--text-label);margin-bottom:5px;">Engine</span>
                            <div class="pill-group" role="radiogroup" aria-label="Engine">
                                <input type="radio" id="engine_v20" name="engine" value="turbo" checked>
                                <label for="engine_v20" class="pill-label">Turbo</label>
                                <input type="radio" id="engine_v1" name="engine" value="v1">
                                <label for="engine_v1" class="pill-label">Standard</label>
                            </div>
                        </div>
```

Delete this entire block (the toolbar toggle now owns this function).

**Step 4: Rewire the handler in `src/settings.js`**

In `src/settings.js`, find the engine block (lines 73-84):

```js
  // Engine / workflow selection — v20 (turbotime) vs v1 (dual-model fallback)
  const savedEngine = localStorage.getItem('ideogram_workflow');
  if (savedEngine === 'v1') {
    document.getElementById('engine_v1').checked = true;
    state.workflow = 'v1';
  }
  document.querySelectorAll('input[name="engine"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.workflow = radio.value;
      localStorage.setItem('ideogram_workflow', radio.value);
    });
  });
```

Replace with:

```js
  // Workflow engine — Turbo (turbotime) vs Classic (v1 dual-model). Toggle lives in the top toolbar.
  const savedWorkflow = localStorage.getItem('ideogram_workflow');
  if (savedWorkflow === 'v1') {
    document.getElementById('workflow-classic').checked = true;
    state.workflow = 'v1';
  }
  document.querySelectorAll('input[name="workflow"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.workflow = radio.value;
      localStorage.setItem('ideogram_workflow', radio.value);
      syncTurboStrengthDisabled();
    });
  });
```

Then find the turbo-strength re-sync block (lines 103-113):

```js
  // Enable/disable turbo strength slider when engine toggle changes
  function syncTurboStrengthDisabled() {
    const slider = document.getElementById('turbo-strength');
    if (!slider) return;
    slider.disabled = state.workflow !== 'turbo';
  }
  syncTurboStrengthDisabled();
  // Re-sync whenever engine changes
  document.querySelectorAll('input[name="engine"]').forEach(radio => {
    radio.addEventListener('change', syncTurboStrengthDisabled);
  });
```

Replace with (keep the function + initial call; remove the engine-radio re-sync since the workflow handler now calls it directly):

```js
  // Enable/disable turbo strength slider based on current workflow
  function syncTurboStrengthDisabled() {
    const slider = document.getElementById('turbo-strength');
    if (!slider) return;
    slider.disabled = state.workflow !== 'turbo';
  }
  syncTurboStrengthDisabled();
```

**Step 5: Verify**

Run: `npm test`
Expected: all tests pass (no logic changed).

Serve and verify manually:
- `python3 server.py` → open the app.
- The toolbar shows `Turbo | Classic` on the right. Turbo is selected by default.
- Click Classic → the Turbo Strength slider in Global Settings becomes disabled.
- Click Turbo → slider re-enables.
- Reload → the choice persists.
- Switch to Gallery/Vision → the toggle disappears; back to Editor → it reappears.

**Step 6: Commit**

```bash
git add index.html src/settings.js
git commit -m "feat: move Turbo/Classic workflow toggle to the top toolbar"
```

---

## Task 2: Three-column layout restructure

The big structural change. Global Settings moves to a left sidebar, JSON moves to a right sidebar, Editor/Gallery/Vision occupy the center column, and Layers + Box Properties move into a fullscreen-only rail. After this task: normal view is three columns with no scrolling; fullscreen shows canvas + Layers + Box.

**Files:**
- Modify: `index.html` body markup (lines 1918-2253) — wholesale restructure
- Modify: `index.html` CSS — layout section (289-322), gallery/vision hide (1501-1509), fullscreen (1851-1906), responsive (1820-1835)

**Step 1: Restructure the body markup**

Replace the entire `<div class="main-content"> ... </div>` block (lines 1918-2253) with the restructured version below. NOTE: the inner content of each panel (Global Settings fields, Layers list, Box Properties fields) is unchanged — only the wrapping columns change. Read the existing blocks and drop them into the new wrappers; do not rewrite the field markup.

The new structure:

```html
    <div class="main-content">
        <!-- LEFT: Global Settings -->
        <div class="left-sidebar">
            <div class="panel" id="global-settings-panel">
                <!-- EXISTING Global Settings panel markup (header + body with Generation/Composition/Style/Color fieldsets) GOES HERE VERBATIM -->
                <!-- The Engine pill group was already removed in Task 1 -->
            </div>
        </div>

        <!-- CENTER: Editor / Gallery / Vision -->
        <div class="center-col">
            <div class="tab-content active" id="tab-editor" role="tabpanel" aria-labelledby="tab-btn-editor">
                <div class="editor-toolbar" id="editor-toolbar">
                    <!-- EXISTING editor-toolbar content GOES HERE VERBATIM (aspect, size, dim-display, opacity-group, toolbar-spacer, btn-reset, btn-enter-fullscreen, btn-exit-fullscreen) -->
                    <!-- PLUS add the Generate button before btn-enter-fullscreen: -->
                    <button id="btn-open-generate" class="btn btn-primary gen-only" type="button" style="margin-left:auto;">Generate</button>
                </div>
                <div class="ai-section gen-only">
                    <!-- EXISTING ai-section markup GOES HERE VERBATIM (will be moved to modal in Task 3; leave in place for now) -->
                </div>
                <div class="canvas-container">
                    <div id="canvas-wrapper" role="img" aria-label="Bounding box editor canvas. Draw boxes by click-dragging; edit their properties in fullscreen mode."><img id="canvas-overlay" alt=""></div>
                </div>
                <div class="action-row gen-only" style="position:relative;">
                    <!-- EXISTING action-row markup (btn-generate-image + generate-status) GOES HERE VERBATIM (moved to modal in Task 3) -->
                </div>
            </div>

            <div class="tab-content" id="tab-gallery" role="tabpanel" aria-labelledby="tab-btn-gallery">
                <!-- EXISTING gallery tab markup GOES HERE VERBATIM -->
            </div>

            <div class="tab-content" id="tab-vision" role="tabpanel" aria-labelledby="tab-btn-vision">
                <!-- EXISTING vision tab markup GOES HERE VERBATIM -->
            </div>
        </div>

        <!-- RIGHT: JSON output -->
        <div class="right-sidebar">
            <div class="json-section">
                <!-- EXISTING json-section markup (json-header with Load/Copy + json-output textarea) GOES HERE VERBATIM, but REMOVE the gen-only class from this json-section div -->
            </div>
        </div>

        <!-- FULLSCREEN-ONLY: Layers + Box Properties -->
        <div class="fullscreen-rail">
            <div class="panel" id="layers-panel">
                <!-- EXISTING layers-panel markup GOES HERE VERBATIM -->
            </div>
            <div class="panel" id="box-panel" style="display: none;">
                <!-- EXISTING box-panel markup GOES HERE VERBATIM -->
            </div>
        </div>
    </div>
```

Implementation guidance for the executor: this is a cut-and-paste of existing blocks into new column wrappers. The JSON section moves OUT of `#tab-editor` into `.right-sidebar`; remove the `gen-only` class from it so it shows in normal view (it is hidden in fullscreen via the sidebar hide rule instead). The `#canvas-wrapper` aria-label changes to mention fullscreen for box editing (optional, minor). Layers + Box move OUT of `.right-col` into `.fullscreen-rail`.

**Step 2: Replace the layout CSS**

In `index.html`, find the layout section (lines 289-322):

```css
        /* Main layout */
        .main-content {
            display: flex;
            gap: 16px;
            align-items: flex-start;
            flex: 1;
        }

        .left-col {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 0;
        }

        .right-col {
            width: 340px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        /* Canvas container */
        .canvas-container {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 16px;
            overflow: hidden;
            min-height: 200px;
            line-height: 0;
        }
```

Replace with:

```css
        /* Main layout — three columns: settings | canvas | json */
        .main-content {
            display: flex;
            gap: 16px;
            align-items: stretch;
            flex: 1;
            min-height: 0;
        }

        .left-sidebar {
            width: 300px;
            flex-shrink: 0;
            overflow-y: auto;
        }

        .center-col {
            flex: 1;
            min-width: 0;
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .right-sidebar {
            width: 340px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-height: 0;
        }

        .fullscreen-rail {
            display: none;
            flex-direction: column;
            gap: 12px;
        }

        /* Editor tab fills the center column as a flex column */
        #tab-editor {
            flex: 1;
            min-height: 0;
            display: none;
            flex-direction: column;
            gap: 12px;
        }

        #tab-editor.active {
            display: flex;
        }

        /* Canvas container */
        .canvas-container {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 16px;
            overflow: hidden;
            min-height: 200px;
            line-height: 0;
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
```

Note: `#tab-editor.active` uses an ID selector which outranks the `.tab-content.active { display:block }` rule, so the editor becomes a flex column while gallery/vision keep `display:block`. The editor-toolbar's existing `margin-bottom:12px` (CSS line 1520) is now redundant with the column gap — remove it: change `.editor-toolbar { ... margin-bottom: 12px; }` to drop that line.

**Step 3: Update the gallery/vision hide rules**

In `index.html`, find (now updated in Task 1, lines ~1501-1517):

```css
        .main-content.gallery-active .right-col,
        .main-content.vision-active .right-col {
            display: none;
        }

        .main-content.gallery-active .left-col,
        .main-content.vision-active .left-col {
            max-width: 100%;
        }
```

Replace with (new class names; the workflow-toggle body rule from Task 1 stays):

```css
        .main-content.gallery-active .left-sidebar,
        .main-content.vision-active .left-sidebar,
        .main-content.gallery-active .right-sidebar,
        .main-content.vision-active .right-sidebar {
            display: none;
        }
```

**Step 4: Replace the fullscreen CSS**

In `index.html`, find the fullscreen block (lines 1851-1906):

```css
        /* Fullscreen drawing mode — toggled via .main-content.draw-fullscreen */
        #btn-exit-fullscreen { display: none; }

        .main-content.draw-fullscreen {
            position: fixed;
            inset: 0;
            z-index: 50;
            overflow: hidden;
            background: var(--bg);
            display: flex;
            gap: 12px;
            padding: 12px;
            align-items: stretch;
        }

        .main-content.draw-fullscreen .left-col {
            flex: 1;
            min-width: 0;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }

        .main-content.draw-fullscreen #tab-editor {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }

        .main-content.draw-fullscreen .gen-only {
            display: none;
        }

        .main-content.draw-fullscreen #global-settings-panel {
            display: none;
        }

        .main-content.draw-fullscreen .right-col {
            width: 340px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
        }

        .main-content.draw-fullscreen .canvas-container {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .main-content.draw-fullscreen #btn-enter-fullscreen { display: none; }
        .main-content.draw-fullscreen #btn-exit-fullscreen { display: inline-flex; }
```

Replace with:

```css
        /* Fullscreen drawing mode — toggled via .main-content.draw-fullscreen */
        #btn-exit-fullscreen { display: none; }

        .main-content.draw-fullscreen {
            position: fixed;
            inset: 0;
            z-index: 50;
            overflow: hidden;
            background: var(--bg);
            display: flex;
            gap: 12px;
            padding: 12px;
            align-items: stretch;
        }

        /* In fullscreen: hide both sidebars; the center column + fullscreen-rail remain */
        .main-content.draw-fullscreen .left-sidebar,
        .main-content.draw-fullscreen .right-sidebar {
            display: none;
        }

        .main-content.draw-fullscreen .center-col {
            flex: 1;
            min-width: 0;
        }

        /* The Generate button + AI section + generate row are hidden (gen-only) */
        .main-content.draw-fullscreen .gen-only {
            display: none;
        }

        /* Layers + Box Properties appear in the fullscreen rail */
        .main-content.draw-fullscreen .fullscreen-rail {
            display: flex;
            width: 340px;
            flex-shrink: 0;
            overflow-y: auto;
        }

        .main-content.draw-fullscreen .canvas-container {
            flex: 1;
            min-height: 0;
        }

        .main-content.draw-fullscreen #btn-enter-fullscreen { display: none; }
        .main-content.draw-fullscreen #btn-exit-fullscreen { display: inline-flex; }
```

Note: `#tab-editor` already has `display:flex; flex:1` from Step 2's base rule, so the old fullscreen-specific `#tab-editor` override is no longer needed. `#global-settings-panel` no longer needs an explicit hide because the whole `.left-sidebar` is hidden.

**Step 5: Update the responsive rules**

In `index.html`, find (lines 1820-1835):

```css
        /* Responsive */
        @media (max-width: 900px) {
            .main-content {
                flex-direction: column;
            }
            .right-col {
                width: 100%;
            }
            .toolbar {
                flex-wrap: wrap;
                gap: 12px;
            }
            .toolbar-section {
                flex-wrap: wrap;
            }
        }
```

Replace `.right-col` reference with the new sidebar class names:

```css
        /* Responsive */
        @media (max-width: 900px) {
            .main-content {
                flex-direction: column;
            }
            .left-sidebar, .right-sidebar {
                width: 100%;
            }
            .toolbar {
                flex-wrap: wrap;
                gap: 12px;
            }
            .toolbar-section {
                flex-wrap: wrap;
            }
        }
```

**Step 6: Verify**

Run: `npm test`
Expected: all tests pass.

Serve and verify manually:
- `python3 server.py` → open the app on the Editor tab.
- Three columns visible: Global Settings (left, ~300px), canvas (center, fills), JSON (right, 340px). **No page scrolling** to reach the canvas.
- The editor toolbar sits above the canvas with a "Generate" button (it does nothing yet — wired in Task 3).
- JSON textarea is on the right and updates as you change settings.
- Layers panel and Box Properties are NOT visible in normal view.
- Click the fullscreen button → canvas maximizes; Layers + Box Properties appear on the right; left settings + right JSON + Generate button are hidden. Exit button + Esc both work.
- Draw a box in normal view → no panel appears (intended).
- Enter fullscreen, select/draw a box → Box Properties appears; Layers reorder/visibility/lock work.
- Switch to Gallery/Vision → both sidebars hide, content fills the center; the workflow toggle hides (Task 1). Back to Editor → three columns return.
- Resize narrower than 900px → columns stack vertically.

**Step 7: Commit**

```bash
git add index.html
git commit -m "refactor: three-column editor layout (settings | canvas | json)"
```

---

## Task 3: Move AI Prompt + Generate into a modal dialog

The AI section (model select, prompt textarea, enhance) and the Generate row move from the editor column into a centered modal, opened by the Generate button added in Task 2.

**Files:**
- Modify: `index.html` (remove `.ai-section` and `.action-row` from `#tab-editor`; add modal markup as a sibling of `.main-content`)
- Modify: `index.html` CSS (add modal styles)
- Modify: `src/app.js` (wire modal open/close + Esc + backdrop; the existing `#btn-generate-image` and `#btn-config` handlers keep working since IDs move with the markup)

**Step 1: Remove the AI section and Generate row from the editor column**

In `index.html`, inside `#tab-editor`, delete these two blocks (now relocated to the modal):

The `.ai-section.gen-only` block (was lines 1950-1965):
```html
                <div class="ai-section gen-only">
                    ...ai-header, ai-prompt textarea, ai-actions...
                </div>
```

And the `.action-row.gen-only` block (was lines 1971-1974):
```html
                <div class="action-row gen-only" style="position:relative;">
                    <button id="btn-generate-image" class="btn btn-primary btn-generate">Generate Image</button>
                    <span id="generate-status" class="generate-status" role="status" aria-live="polite"></span>
                </div>
```

**Step 2: Add the modal markup**

In `index.html`, immediately BEFORE the `<div class="toast-container" id="toast-container"></div>` line, add:

```html
    <div id="generate-modal" class="modal-overlay" hidden>
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="generate-modal-title">
            <div class="modal-header">
                <h3 id="generate-modal-title">Generate</h3>
                <button id="btn-close-generate" type="button" class="icon-btn" aria-label="Close" title="Close (Esc)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="ai-header">
                <span class="ai-label">AI Prompt</span>
                <label class="sr-only" for="ai-model">AI model</label>
                <select id="ai-model" class="ai-model-select">
                    <option value="">Loading...</option>
                </select>
                <button id="btn-config" class="icon-btn" aria-label="Open credentials file" title="Open credentials file"><span aria-hidden="true">&#9881;</span></button>
            </div>
            <label class="sr-only" for="ai-prompt">AI prompt</label>
            <textarea id="ai-prompt" rows="6" placeholder="Describe the image you want to create... e.g. 'A serene mountain lake at sunset with pine trees framing the shore, golden light reflecting on water'"></textarea>
            <div class="ai-actions">
                <button id="btn-ai-enhance" class="btn btn-primary">AI Enhance</button>
                <span id="ai-status" class="ai-status" role="status" aria-live="polite"></span>
            </div>
            <div class="modal-actions">
                <button id="btn-generate-image" class="btn btn-primary btn-generate">Generate Image</button>
                <span id="generate-status" class="generate-status" role="status" aria-live="polite"></span>
            </div>
        </div>
    </div>
```

Note: the IDs `ai-model`, `btn-config`, `ai-prompt`, `btn-ai-enhance`, `ai-status`, `btn-generate-image`, `generate-status` are preserved — the existing handlers in `src/ai-enhancer.js` and `src/app.js:40,42` keep working unchanged.

**Step 3: Add modal CSS**

In `index.html`, add this block right after the fullscreen CSS block (before `</style>`):

```css
        /* Generate modal */
        .modal-overlay {
            position: fixed;
            inset: 0;
            z-index: 100;
            background: oklch(14.5% 0.012 60 / 0.72);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .modal-overlay[hidden] {
            display: none;
        }

        .modal-card {
            background: var(--surface);
            border: 1px solid var(--border-strong);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            width: min(620px, 100%);
            max-height: 90vh;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 14px;
            padding: 20px;
        }

        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .modal-header h3 {
            margin: 0;
            font-family: var(--font-display);
            font-size: 18px;
            color: var(--accent);
        }

        .modal-card .ai-header { margin: 0; }
        .modal-card textarea { resize: vertical; }
        .modal-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }
```

**Step 4: Wire the modal open/close in `src/app.js`**

In `src/app.js`, find the button-wiring block (lines 40-42):

```js
document.getElementById('btn-generate-image').addEventListener('click', () => generateImage());
document.getElementById('btn-delete-box').addEventListener('click', () => deleteSelectedBox());
document.getElementById('btn-config').addEventListener('click', () => fetch('/api/open-config'));
```

After these lines, add the modal logic:

```js
// --- Generate modal ---
const generateModal = document.getElementById('generate-modal');
function openGenerateModal() { generateModal.hidden = false; document.getElementById('ai-prompt').focus(); }
function closeGenerateModal() { generateModal.hidden = true; }
document.getElementById('btn-open-generate').addEventListener('click', openGenerateModal);
document.getElementById('btn-close-generate').addEventListener('click', closeGenerateModal);
generateModal.addEventListener('click', (e) => { if (e.target === generateModal) closeGenerateModal(); });
```

Then find the Escape handler (lines 71-73):

```js
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.ui.drawFullscreen) setFullscreen(false);
});
```

Replace with (also closes the modal; modal takes priority over nothing since they're mutually exclusive — Generate is hidden in fullscreen):

```js
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!generateModal.hidden) closeGenerateModal();
  else if (state.ui.drawFullscreen) setFullscreen(false);
});
```

**Step 5: Verify**

Run: `npm test`
Expected: all tests pass.

Serve and verify manually:
- Click "Generate" in the editor toolbar → modal opens, focus lands on the prompt textarea.
- Model select loads (or shows "Loading..." then providers). The gear icon opens the credentials file.
- "AI Enhance" works and fills the textarea.
- "Generate Image" submits; on success the modal closes and the image overlays the canvas (existing `image:ready` flow).
- Close via the X button, via Esc, and via clicking the backdrop — all dismiss without generating.
- The Generate button is hidden in fullscreen (it carries `gen-only`).

**Step 6: Commit**

```bash
git add index.html src/app.js
git commit -m "feat: move AI prompt + generate into a modal dialog"
```

---

## Task 4: Full final verification + cleanup

No new features — a verification and polish pass to catch anything broken by the reorganization.

**Files:** possibly `index.html` (minor CSS tweaks), `docs/plans/2026-06-19-editor-redesign-design.md` (mark done).

**Step 1: Full manual click-through**

Serve with `python3 server.py` and verify every flow:

1. Editor tab: three columns, no scroll, canvas centered and fills height.
2. Workflow toggle in toolbar: Turbo↔Classic switches state, persists across reload, disables Turbo Strength slider when Classic.
3. Generate modal: opens, enhances, generates, closes on success / Esc / backdrop / X.
4. Draw boxes in normal view: no panel shows (intended). Boxes are still created (visible on canvas).
5. Enter fullscreen: canvas maximizes, Layers + Box Properties show on right, sidebars + Generate hidden. Select a box → Box Properties appears; edit fields apply; Layers reorder/visibility/lock work.
6. Exit fullscreen (button + Esc): three-column layout restored.
7. Switch to Gallery → sidebars + workflow toggle hidden, gallery fills center, history shows. Switch to Vision → same. Back to Editor → restored.
8. Drag-drop a PNG onto the canvas (PNG import) → state loads, boxes appear.
9. Resize browser < 900px → columns stack vertically, canvas keeps a usable height.
10. Check the browser console for any errors (e.g., a `getElementById` returning null because an ID moved or was mistyped).

**Step 2: Fix any console errors or visual glitches found in Step 1**

Common things to watch for:
- An element ID referenced by a module no longer exists (typo during the move) → console shows `Cannot read properties of null`. Fix the ID in `index.html`.
- The JSON textarea not updating → confirm `#json-output` exists in `.right-sidebar`.
- Turbo Strength slider not disabling → confirm `syncTurboStrengthDisabled` is called and `state.workflow` flips.
- `gallery.js` class names: if Gallery/Vision don't hide the sidebars, check whether `gallery-active`/`vision-active` are applied to `<body>` or `.main-content` and align the CSS selectors.

**Step 3: Run the full test suite one more time**

Run: `npm test`
Expected: all tests pass.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: polish editor redesign — verification fixes"
```
(Skip this commit if Step 2 found nothing to fix.)

---

## Notes for the executor

- **Do not** touch `src/state.js`, `src/events.js`, `src/runpod.js`, `src/canvas.js` (interaction code), `src/palette.js`, `src/png-import.js`, `src/gallery.js`, `src/lora.js`, `src/layers.js`, `src/json-builder.js`, `src/ai-enhancer.js`, `src/vision.js`, or anything under `runpod/`. These modules use `getElementById` which finds elements regardless of where they live in the DOM, so relocating markup does not require code changes in them.
- **Exception:** `src/settings.js` (Task 1) and `src/app.js` (Task 3) are the only JS files that change.
- The design intentionally makes Layers + Box Properties inaccessible in normal view. Selecting a box in normal view fires `box:selected` (still consumed by palette/settings form sync) but reveals no panel. This is the approved simplification — do not "fix" it by re-adding the panels to normal view.
- If `gallery.js` applies `gallery-active`/`vision-active` to `<body>` rather than `.main-content`, the Task 1 workflow-toggle hide rule using `body.gallery-active` works as written; otherwise align it.
