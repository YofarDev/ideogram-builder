# Fullscreen Drawing Mode — Design

## Goal

Add an immersive, toggle-driven fullscreen drawing workspace on the Editor tab. When active,
only the tools relevant to drawing remain visible — canvas setup, overlay opacity, the Layers
panel, and the Box Properties panel — while the generation/settings chrome (AI Prompt, Generate,
Prompt JSON, Global Settings) is hidden and the canvas is enlarged to use the viewport.

## Non-goals

- No new tabs. This is a mode on the existing Editor tab, not a fourth tab.
- No changes to box drawing/dragging/resizing logic (`src/canvas.js` interaction code).
- No persistence of the fullscreen preference across reloads (starts in normal mode).

## Interaction model

A maximize toggle on the Editor tab.

- **Enter:** a maximize icon button in `.editor-toolbar` adds the `draw-fullscreen` class to
  `#tab-editor`. The editor becomes a fixed full-viewport overlay that also covers the brand +
  Gallery/Vision tabs.
- **Exit:** an "Exit" button (visible only in fullscreen) in the top bar, or the **Esc** key.

No existing keybinding uses Esc, so there is no conflict.

## DOM changes (index.html, IDs preserved)

- Wrap the generation-only blocks (`.ai-section`, `.action-row`, `.json-section`) in
  `<div class="gen-only">` so they can be hidden as a group.
- Add `id="global-settings-panel"` to the "Global Settings" panel (Layers and Box Properties
  already have `#layers-panel` and `#box-panel`).
- Add two buttons to `.editor-toolbar`:
  - `#btn-enter-fullscreen` — maximize icon.
  - `#btn-exit-fullscreen` — shown only via CSS when `#tab-editor.draw-fullscreen` is active.

## Layout (pure CSS, driven by `#tab-editor.draw-fullscreen`)

The existing two-column structure (left = canvas column, right = 340px `right-col`) already maps
to the chosen "top bar + right rail":

- `#tab-editor.draw-fullscreen` → `position: fixed; inset: 0; z-index: 50; overflow: auto;
  background: var(--bg);` (covers the brand + tabs).
- `.draw-fullscreen .gen-only` → `display: none;`
- `.draw-fullscreen #global-settings-panel` → `display: none;`
- `.draw-fullscreen .main-content` → `flex: 1; min-height: 0;` so the canvas column grows.
- `.editor-toolbar` remains the top bar (full width), now holding aspect/size/dims/overlay/reset
  + the exit button.
- `right-col` keeps its 340px and shows only Layers + Box Properties. Box Properties' existing
  "hidden until a box is selected" behavior carries over unchanged.

No DOM nodes are moved or duplicated; this is purely a class-driven CSS reflow, so module-level
event wiring (which is all ID/parent based in `app.js`) stays intact.

## Canvas rescaling

`src/canvas.js:resizeCanvas` currently uses a hardcoded `height > 800` cap for the display scale.
Generalize it:

- Add `state.canvas.maxDisplayHeight` (default `800`).
- `resizeCanvas` reads `state.canvas.maxDisplayHeight` instead of the `800` literal.
- On entering fullscreen, set `maxDisplayHeight` to `window.innerHeight − topbar − padding`; on
  exit, restore `800`.
- Recompute via a new **`canvas:relayout`** event emitted by `app.js` and listened in `canvas.js`
  (keeps with the "modules communicate via events only" rule). Also re-emit on `window resize`
  while in fullscreen.

This change benefits normal mode too (no behavior change at the default 800).

## State + wiring

- Add `state.ui = { drawFullscreen: false }` to `src/state.js` (centralized mutations).
- `src/app.js` wires:
  - `#btn-enter-fullscreen` / `#btn-exit-fullscreen` / Esc → toggle `.draw-fullscreen` on
    `#tab-editor`, flip `state.ui.drawFullscreen`, set/restore `maxDisplayHeight`, emit
    `canvas:relayout`.
  - A `window` `resize` listener that re-emits `canvas:relayout` only while fullscreen.

No other module needs to know about fullscreen mode; the class + relayout event cover everything.

## Edge cases

- Box Properties stays `display: none` until a box is selected (unchanged CSS).
- Drawing / dragging / resizing must remain accurate after relayout — they read
  `state.canvas.scale` and `getBoundingClientRect()` per interaction (`src/canvas.js:181-294`), so
  recomputing scale is sufficient.
- Gallery/Vision tabs are covered by the fixed overlay and therefore unreachable while fullscreen;
  they are reachable again once exited.
- `prefers-reduced-motion` is already globally handled (transitions collapse).
- Narrow screens: the existing `@media (max-width: 900px)` rule stacks the columns; fullscreen
  inherits that fallback.

## Testing

No JS test framework in the repo. Verify manually:

1. Enter via the maximize button; exit via the Exit button and via Esc.
2. Canvas visibly enlarges on enter and shrinks back on exit.
3. Draw a new box, drag, resize, and corner-resize after relayout — coordinates stay correct.
4. Select a box → Box Properties appears in the rail; edit fields apply.
5. Layers reorder / visibility / lock work while fullscreen.
6. Overlay image + opacity slider work.
7. Resize the browser window while fullscreen → canvas relayouts.
8. While fullscreen, Gallery/Vision tabs are covered; after exit, they are reachable and the
   normal Editor layout is restored.
