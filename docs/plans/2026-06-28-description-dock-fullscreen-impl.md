# Prominent Description Dock (Fullscreen) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** In fullscreen drawing mode, surface the selected layer's object description as a large, bottom-centered, always-readable textarea docked over the canvas.

**Architecture:** Relocate the existing `#box-desc` element (keep its ID) out of the right rail's `#box-panel` into a new `.desc-dock` container that is a direct child of `.main-content`. All existing `settings.js` bindings (input listener, `box:selected` populate, recaption writeback) keep working unchanged because the element ID is preserved. Dock visibility is CSS-gated on `.main-content.draw-fullscreen` plus a JS-toggled `.show` class mirroring box selection. No build tools, no test runner — verification is manual via browser reload + DevTools.

**Tech Stack:** Vanilla JS (ES modules), inline CSS in `index.html`, served by `python3 server.py`.

**Design doc:** `docs/plans/2026-06-28-description-dock-fullscreen-design.md`

---

## Reference: exact anchors in the current code

- `index.html:3086-3089` — the `#box-desc` `.input-group` block inside `#box-panel > .panel-body` (to be removed/relocated).
- `index.html:3125` — closing `</div>` of `.fullscreen-rail`.
- `index.html:3126` — closing `</div>` of `.main-content` (insert the dock just before this line).
- `index.html:2549-2594` — the existing `/* Fullscreen drawing mode */` CSS block (add dock styles right after, before the `/* Generate modal */` comment at line 2596).
- `settings.js:153-170` — the `on('box:selected', …)` handler (extend it to toggle the dock + set label/color + autofocus).
- `settings.js:63` — input listener on `['box-mode','box-text','box-desc']` (unchanged — still targets `#box-desc`).
- `settings.js:296` — recaption writeback `document.getElementById('box-desc').value = box.desc` (unchanged — still targets `#box-desc`).

---

## Task 1: Relocate `#box-desc` and add the `.desc-dock` markup

**Files:**
- Modify: `index.html` (remove the description `.input-group` from `#box-panel`; add `.desc-dock` before `.main-content` closes).

**Step 1: Remove the description block from the rail panel**

In `index.html`, find this block inside `#box-panel` (around lines 3086-3089):

```html
                    <div class="input-group">
                        <label for="box-desc">Description</label>
                        <textarea id="box-desc" rows="5" placeholder="Describe this element"></textarea>
                    </div>
```

Delete the entire block (all four lines). The Description field will now live only in the dock.

**Step 2: Add the `.desc-dock` element as a child of `.main-content`**

Immediately **before** the line that closes `.main-content` (the `</div>` at line 3126, which sits right after `.fullscreen-rail`'s closing `</div>` at line 3125), insert:

```html
        <!-- FULLSCREEN-ONLY: prominent description editor for the selected box -->
        <div class="desc-dock" id="desc-dock" aria-hidden="true">
            <div class="desc-dock-inner">
                <div class="desc-dock-head">
                    <span class="layer-color-dot" id="desc-dock-dot" aria-hidden="true"></span>
                    <span class="desc-dock-label" id="desc-dock-label">Object</span>
                </div>
                <label class="sr-only" for="box-desc">Description</label>
                <textarea id="box-desc" placeholder="Describe this element…"></textarea>
            </div>
        </div>
```

Note: there is now exactly **one** `#box-desc` in the document (inside the dock). Verify there are no leftover duplicates.

**Step 3: Verify the markup is correct (manual)**

Run: `python3 server.py` (in a terminal), then open the app in the browser.

In DevTools → Console, run:

```js
document.querySelectorAll('#box-desc').length   // expect: 1
document.getElementById('desc-dock')             // expect: <div class="desc-dock" …>
document.getElementById('box-desc').closest('.main-content') !== null  // expect: true
```

Expected: all three resolve as shown, no console errors. The dock is invisible for now (no CSS yet).

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat(editor): relocate #box-desc into .desc-dock container (fullscreen)"
```

---

## Task 2: Style the `.desc-dock` (positioning, visibility, sizing)

**Files:**
- Modify: `index.html` — add a CSS block immediately after the existing fullscreen rules (after line 2594, before the `/* Generate modal */` comment at line 2596).

**Step 1: Add the dock CSS**

Insert exactly:

```css
        /* Prominent description dock — fullscreen-only, shown when a box is selected (.show) */
        .desc-dock {
            display: none;
            position: absolute;
            left: 12px;
            right: 360px;          /* clear the 340px fullscreen-rail + gaps */
            bottom: 12px;
            z-index: 60;           /* above canvas, below modals (z-index: 100) */
            justify-content: center;
            pointer-events: none;  /* outer strip lets canvas clicks pass through */
        }

        .main-content.draw-fullscreen .desc-dock.show {
            display: flex;
            animation: desc-dock-rise 0.18s ease-out;
        }

        @keyframes desc-dock-rise {
            from { transform: translateY(12px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
        }

        .desc-dock-inner {
            pointer-events: auto;
            width: 100%;
            max-width: 760px;
            background: oklch(21.5% 0.008 65 / 0.92);
            border: 1px solid var(--hairline-strong);
            border-radius: var(--radius);
            box-shadow: var(--shadow-strong);
            backdrop-filter: blur(6px);
            padding: 12px 16px 14px;
        }

        .desc-dock-head {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .desc-dock-label {
            font-family: var(--font-display);
            font-size: 13px;
            color: var(--accent);
            letter-spacing: 0.02em;
        }

        .desc-dock textarea {
            width: 100%;
            min-height: 110px;
            font-family: var(--font-body);
            font-size: 15px;
            line-height: 1.55;
            color: var(--text);
            background: var(--surface-2);
            border: 1px solid var(--border-strong);
            border-radius: var(--radius-sm);
            padding: 10px 12px;
            outline: none;
            resize: vertical;
            transition: border-color 0.2s;
        }

        .desc-dock textarea:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-dim);
        }

        .desc-dock textarea::placeholder {
            color: var(--text-dim);
            font-style: italic;
        }
```

Key points:
- `.desc-dock` is `display:none` by default. It only becomes `display:flex` under `.main-content.draw-fullscreen .desc-dock.show`.
- `position:absolute` anchors it to `.main-content` (which is `position:fixed` in fullscreen). `left/right/bottom` span the canvas-column area, clearing the 340px rail.
- `pointer-events:none` on the outer + `auto` on `.desc-dock-inner` means clicks on the canvas beside the dock are not blocked.

**Step 2: Verify styling is inert for now (manual)**

Reload the app. Confirm: no visual change yet (dock has no `.show` class). Console: no errors.

**Step 3: Commit**

```bash
git add index.html
git commit -m "style(editor): add .desc-dock CSS (fullscreen bottom-center, show-gated)"
```

---

## Task 3: Wire dock visibility, label, and autofocus in `settings.js`

**Files:**
- Modify: `src/settings.js:153-170` — the `on('box:selected', …)` handler.

**Step 1: Extend the `box:selected` handler**

Find the existing handler (lines 153-170):

```js
  on('box:selected', ({ id }) => {
    const boxPanel = document.getElementById('box-panel');
    if (id) {
      const box = state.boxes.find(b => b.id === id);
      if (!box) return;
      boxPanel.style.display = 'block';
      document.getElementById('box-mode').value = box.mode;
      document.getElementById('box-text').value = box.text;
      document.getElementById('box-desc').value = box.desc;
      document.getElementById('text-input-group').style.display = box.mode === 'text' ? 'block' : 'none';
      populateGeometry(box);
      const swatch = document.getElementById('box-color-swatch');
      if (swatch) swatch.style.background = box.color || 'var(--accent)';
      document.getElementById('recaption-group').style.display = state.imageDataUrl ? 'block' : 'none';
    } else {
      boxPanel.style.display = 'none';
    }
  });
```

Replace it with (added: `descDock` toggle, header label + dot, fullscreen autofocus; plus dock hide on deselect):

```js
  on('box:selected', ({ id }) => {
    const boxPanel = document.getElementById('box-panel');
    const descDock = document.getElementById('desc-dock');
    const isFullscreen = document.querySelector('.main-content').classList.contains('draw-fullscreen');
    if (id) {
      const box = state.boxes.find(b => b.id === id);
      if (!box) return;
      boxPanel.style.display = 'block';
      document.getElementById('box-mode').value = box.mode;
      document.getElementById('box-text').value = box.text;
      document.getElementById('box-desc').value = box.desc;
      document.getElementById('text-input-group').style.display = box.mode === 'text' ? 'block' : 'none';
      populateGeometry(box);
      const swatch = document.getElementById('box-color-swatch');
      if (swatch) swatch.style.background = box.color || 'var(--accent)';
      document.getElementById('recaption-group').style.display = state.imageDataUrl ? 'block' : 'none';

      if (descDock) {
        descDock.classList.add('show');
        descDock.setAttribute('aria-hidden', 'false');
        const idx = state.boxes.indexOf(box);
        const labelEl = document.getElementById('desc-dock-label');
        const dotEl = document.getElementById('desc-dock-dot');
        if (labelEl) labelEl.textContent = box.mode === 'text' ? `Text ${idx + 1}` : `Object ${idx + 1}`;
        if (dotEl) dotEl.style.background = box.color || 'var(--accent)';
        if (isFullscreen) document.getElementById('box-desc').focus();
      }
    } else {
      boxPanel.style.display = 'none';
      if (descDock) {
        descDock.classList.remove('show');
        descDock.setAttribute('aria-hidden', 'true');
      }
    }
  });
```

> ⚠️ The `box-desc` input listener (settings.js:63) and the recaption writeback (settings.js:296) are **unchanged** — they still target `#box-desc`, now in the dock.

**Step 2: Verify no syntax errors**

Run in repo root:

```bash
node --check src/settings.js
```

Expected: no output (exit 0). If `node` is unavailable, load the app and check the Console for module parse errors.

**Step 3: Commit**

```bash
git add src/settings.js
git commit -m "feat(editor): show/hide + label + autofocus for description dock on box select"
```

---

## Task 4: End-to-end manual verification

**Files:** none (verification only).

**Step 1: Reload and exercise the flow**

Run `python3 server.py`, open the app. For each step, confirm expected behavior; if anything fails, fix before proceeding.

1. **Normal (non-fullscreen) editor:** layout looks identical to before. Draw a box → select it → confirm the right-rail `#box-panel` appears but has **no Description field** (it's now in the dock), and the dock is **not visible** (we're not in fullscreen). ✅
2. **Enter fullscreen** (maximize icon). Draw or select a box. Confirm:
   - The `.desc-dock` appears at the **bottom-center** of the canvas area, large and readable, lifted above the canvas.
   - The dock header shows the correct label (`Object N` for obj mode, `Text N` for text mode) and the box's identity color dot.
   - The textarea is **auto-focused** (caret blinking).
   - The right rail `#box-panel` no longer shows a Description field.
3. **Edit the description** in the dock. Confirm the JSON output (Prompt JSON panel) updates live (the existing `input` → `state:changed` → json-builder path still works). ✅
4. **Switch between two boxes.** Confirm the dock stays visible, the label/dot/value update to the newly selected box, and focus moves to the textarea. ✅
5. **Deselect** (click empty canvas). Confirm the dock **disappears** and `#box-panel` hides. ✅
6. **Recaption** (needs an image loaded): run recaption from the rail. Confirm the dock textarea updates with the new description (`settings.js:296` writeback still targets `#box-desc`). ✅
7. **Exit fullscreen.** Confirm the dock disappears immediately (CSS gating) and normal layout is intact. ✅
8. **Canvas interaction beside the dock:** in fullscreen with a box selected, click/drag on the canvas area to the left/right of the dock — confirm it still works (pointer-events:none on the outer strip). ✅
9. **DevTools Console:** no errors or warnings throughout.

**Step 2: Final commit (if any fixes were applied)**

```bash
git status
# if changes:
git add -A
git commit -m "fix(editor): description dock verification adjustments"
```

---

## Out of scope (do not implement)

- Normal (non-fullscreen) editor changes.
- Exposing element type / text content in the dock.
- Unit tests (project has no test runner; this is a DOM/CSS feature verified manually).
