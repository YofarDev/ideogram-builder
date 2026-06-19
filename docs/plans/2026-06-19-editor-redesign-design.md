# Editor Layout Redesign — Design

## Goal

Reorganize the Editor tab from a vertical two-column layout (where the canvas shares a column
with AI prompt + JSON output and forces scrolling) into a **three-column layout** with the canvas
maximized in the center. Move the AI Prompt + Generate workflow into a modal dialog, relocate
Layers and Box Properties into the fullscreen drawing mode exclusively, and surface the
Turbo/Classic workflow toggle in the top toolbar for one-click switching.

No visual restyle — the existing OKLCH darkroom theme, DM Serif Display + DM Sans typography, and
gold accent are preserved. This is a structural reorganization.

## Non-goals

- No new tabs. Editor/Gallery/Vision remain the only top-level tabs.
- No restyle of the visual tokens (colors, fonts, radii, shadows).
- No changes to box drawing/dragging/resizing interaction logic (`src/canvas.js`).
- No changes to RunPod API contract or backend (`runpod/handler.py`) — the `workflow` field and
  turbo/v1 split already exist; this redesign only changes the UI affordance.
- No changes to the events catalog (`src/events.js`) — the event bus stays as-is.
- No new modules — the reorganization is handled by DOM relocation + listener retargeting in
  existing modules.
- No persistence changes for the workflow preference (already in localStorage).

## Layout — Normal Editor View (three columns)

```
┌─────────────────────────────────────────────────────────────────┐
│ TOP TOOLBAR: [Brand] [Editor|Gallery|Vision]      [Turbo|Classic]│
├──────────────┬────────────────────────────────────┬──────────────┤
│ LEFT SIDEBAR │ CENTER (canvas)                    │ RIGHT SIDEBAR│
│              │ ┌────────────────────────────────┐ │              │
│  GLOBAL      │ │ aspect│1M/2M│dims│reset│ fs │ GENERATE │       │ │
│  SETTINGS    │ ├────────────────────────────────┤ │  JSON        │
│              │ │                                │ │  OUTPUT      │
│  • Generation│ │                                │ │              │
│    - Speed   │ │           CANVAS               │ │  [Load][Copy]│
│    - Turbo α │ │        (no scroll)             │ │              │
│    - LoRA    │ │                                │ │ ┌──────────┐ │
│    - Seed    │ │                                │ │ │ textarea │ │
│  • Composition│ │                                │ │ │          │ │
│  • Style     │ │                                │ │ │          │ │
│  • Color     │ └────────────────────────────────┘ │ └──────────┘ │
│   palette    │                                    │              │
└──────────────┴────────────────────────────────────┴──────────────┘
```

- **Left sidebar (fixed width):** the existing Global Settings panel, unchanged contents
  (Generation: Speed / Engine pills / Turbo Strength / LoRA / Seed; Composition; Style; Color
  palette). The Engine pill group is **removed** here because its job is taken over by the
  toolbar toggle.
- **Center column (flex: 1):** a slim sub-toolbar (aspect ratio, 1M/2M size, dimension readout,
  overlay opacity, reset, enter-fullscreen) followed by a Generate button, then the canvas
  wrapper fills the rest of the height. No AI prompt textarea, no JSON output in this column.
- **Right sidebar (fixed width):** the Prompt JSON section — header with Load/Copy icon buttons
  + the `#json-output` textarea. Stretches to match column height.
- **Top toolbar:** gains the `Turbo | Classic` segmented control on the right edge, visible only
  on the Editor tab.
- **No Layers panel, no Box Properties panel** in normal view — they live in fullscreen only.

All three columns fit the viewport height; the canvas no longer requires scrolling to reach.

## Layout — Fullscreen Drawing View (refined)

```
┌─────────────────────────────────────────────────────────────────┐
│ [Exit fullscreen]                                    [Turbo|Classic]│
├──────────────────────────────────────────────────┬──────────────┤
│                                                  │  LAYERS       │
│                                                  │  ┌──────────┐ │
│                                                  │  │ layer list│ │
│                                                  │  └──────────┘ │
│           MAXIMIZED CANVAS                       │               │
│                                                  │  BOX PROPERTIES│
│                                                  │  (text, desc,  │
│                                                  │   geom, colors,│
│                                                  │   delete)      │
└──────────────────────────────────────────────────┴──────────────┘
```

- Fullscreen enters via the sub-toolbar's fullscreen button; exits via the Exit button or Esc
  (existing behavior in `src/app.js`).
- While fullscreen: both sidebars (left settings + right JSON) and the sub-toolbar are hidden;
  only the maximized canvas + the right rail (Layers + Box Properties) remain. The Turbo/Classic
  toolbar toggle stays visible.
- The "draw boxes, then edit them" workflow happens here, same as today.

## AI Prompt + Generate — Modal Dialog

Opened from the Generate button in the canvas sub-toolbar. A centered overlay with backdrop,
containing:

- Model select + config gear (relocated from the `.ai-section`).
- Prompt textarea (`#ai-prompt`).
- AI Enhance button + status text.
- Generate button + status text. On successful generation → image overlays canvas (existing
  `image:ready` event), modal closes.

Esc closes the modal without generating. Clicking the backdrop dismisses it. No persistence of
modal contents is needed beyond what `ai-enhancer.js` already does.

## Turbo / Classic Workflow Toggle

A segmented control `Turbo | Classic` in the top toolbar (Editor tab only). Replaces the buried
"Engine" pill group in Global Settings.

- **Turbo** → `state.workflow = 'turbo'`; enables the Turbo Strength slider in the left sidebar;
  uses the single-LoRA path (`_build_workflow_turbo` in `runpod/handler.py`).
- **Classic** → `state.workflow = 'v1'`; disables the Turbo Strength slider; uses the dual-LoRA
  path (`_build_workflow_v1`).
- Persisted to `localStorage['ideogram_workflow']` (existing behavior preserved).
- Rationale: turbo doesn't combine well with multiple LoRAs, so a prominent toggle lets you flip
  between the two workflows instantly without diving into Global Settings.

The LoRA selection UI stays available in both modes (left sidebar). The toggle changes which
backend workflow template is used, not which LoRAs are loaded.

## DOM changes (index.html)

IDs are preserved wherever possible so module-level event wiring survives. Structural changes:

1. **Top toolbar** — add a `<div class="workflow-toggle pill-group">` with two buttons
   (`#workflow-turbo`, `#workflow-classic`) on the right edge. Hide it when Gallery or Vision is
   active (extend the existing `.gallery-active` / `.vision-active` body classes).
2. **Center column** (`#tab-editor`):
   - Move the `.editor-toolbar` here (it's already here). Add a `#btn-generate` button at the
     right edge (replaces the old Generate row). Remove the overlay-opacity slider if it's
     fullscreen-only (it currently is — keep that behavior).
   - Keep `.canvas-container` / `#canvas-wrapper` / `#canvas-overlay` here.
   - **Remove** the `.ai-section.gen-only` and `.action-row.gen-only` and `.json-section.gen-only`
     blocks from this column. Move their IDs into the modal and right sidebar respectively.
3. **Left sidebar** (`div.left-col` is replaced by a new `div.left-sidebar`): contains only
   `#global-settings-panel`. The Engine pill group inside it is removed (toolbar toggle takes
     over). Layers panel and Box Properties panel are **moved out** of this column.
4. **Right sidebar** (`div.right-col` → `div.right-sidebar`): contains the JSON section
   (`#json-output` + Load/Copy buttons). Previously held Settings + Layers + Box; now only JSON.
5. **Generate modal** — new `<div id="generate-modal" class="modal-overlay" hidden>` sibling of
   `.main-content`, containing the AI prompt section (model select, gear, textarea, enhance,
   generate, status).
6. **Fullscreen container** — Layers panel (`#layers-panel`) and Box Properties panel
   (`#box-panel`) move into a new `div.fullscreen-rail` that is only visible inside the
   `#tab-editor.draw-fullscreen` overlay. The current `right-col` rail becomes this rail.

The high-level body becomes:

```
<header class="toolbar">
  brand + tabs + workflow toggle
</header>
<div class="main-content">
  <div class="left-sidebar">#global-settings-panel</div>
  <div class="center-col">
    #tab-editor
      .editor-toolbar (canvas controls + Generate)
      .canvas-container
  </div>
  <div class="right-sidebar">json-section</div>
</div>
<div id="generate-modal" class="modal-overlay" hidden>...</div>
<div class="toast-container">...</div>
```

Gallery and Vision tabs relocate: they previously lived in `left-col` alongside `#tab-editor`;
they now occupy the center column area when active (their existing `.gallery-active` /
`.vision-active` CSS rules hide the sidebars, so this is mostly a parent swap).

## CSS changes (inline `<style>`)

- Replace `.main-content` two-column flex with three-column:
  `.main-content { display:flex; gap:16px; align-items:stretch; flex:1; min-height:0; }`
  `.left-sidebar { width: 300px; flex-shrink: 0; overflow-y:auto; }`
  `.center-col { flex:1; min-width:0; display:flex; flex-direction:column; gap:12px; min-height:0; }`
  `.right-sidebar { width: 340px; flex-shrink:0; display:flex; flex-direction:column; gap:12px; }`
- `.canvas-container` gets `flex:1; min-height:0` so the canvas fills remaining height.
- New `.modal-overlay` styles: fixed, inset 0, backdrop blur, centered card, `hidden` attribute
  hides it, Esc/backdrop dismiss handled in JS.
- New `.workflow-toggle` segmented control in toolbar (reuse `.pill-group` pattern).
- Update `.main-content.draw-fullscreen` rules: now hides `.left-sidebar` and `.right-sidebar`
  and the `.editor-toolbar` (except the exit button); keeps the fullscreen rail visible.
- Responsive (`@media max-width: 900px`): stack the three columns vertically; canvas gets a
  min-height.

## Module impact

| Module | Change |
|--------|--------|
| `index.html` | Major DOM restructure (above). |
| CSS (inline) | Three-column layout; modal; toolbar toggle; updated fullscreen rules. |
| `src/app.js` | Wire Generate modal open/close + Esc/backdrop; update `setFullscreen` to hide the new sidebars; move the generate button handler to open the modal. |
| `src/settings.js` | Remove the in-panel Engine pill handler; add a new toolbar `#workflow-turbo` / `#workflow-classic` handler that sets `state.workflow`, persists, and toggles the Turbo Strength slider's disabled state. |
| `src/layers.js` | Its render target (`#layers-list`) moves into the fullscreen rail; no code change beyond what the DOM move implies (IDs preserved). |
| `src/canvas.js` | Sub-toolbar wiring unchanged (buttons keep their IDs); canvas sizing reads the new container. |
| `src/json-builder.js` | `#json-output` textarea moves to the right sidebar; listeners retarget automatically since they use `getElementById`. |
| `src/ai-enhancer.js` | Model select + prompt textarea move into the modal; enhance logic unchanged; the Generate button inside the modal triggers the same `runpod` submit path. |

No changes to `state.js`, `events.js`, `runpod.js`, `palette.js`, `png-import.js`, `gallery.js`,
`lora.js`, `toast.js`, `vision.js`, or the `runpod/` backend.

## Edge cases

- **Workflow toggle visibility:** hidden on Gallery/Vision tabs via existing body classes. When
  switching back to Editor, it reappears and reflects `state.workflow`.
- **Turbo Strength slider:** disabled state must update when the toolbar toggle changes, not just
  on page load. The new handler in `settings.js` mirrors the existing disable logic.
- **Generate modal + fullscreen:** opening the Generate modal while in fullscreen should either be
  blocked (Generate button is hidden in fullscreen) or close fullscreen first. Simplest: the
  Generate button lives in the sub-toolbar, which is hidden in fullscreen, so it can't be opened
  from there. Document this constraint.
- **Gallery/Vision tabs:** previously shared `left-col` with Editor. Their CSS rules hide
  sidebars via body classes, so moving them into the center column area works without logic
  changes; they just need their container changed in HTML.
- **Box Properties in normal view:** currently appears in the right rail when a box is selected.
  After redesign, selecting a box in normal view does nothing visible (no panel) — the user must
  enter fullscreen to edit it. This is the intended simplification. The `box:selected` event still
  fires (used by palette + settings form sync), just no panel reveals.
- **Responsive:** on narrow screens the three columns stack vertically; the canvas gets a
  sensible min-height; the Generate modal goes full-width.
- **`prefers-reduced-motion`:** existing global rule disables transitions; modal open/close
  should also respect this (no fade animation).

## Testing

No JS test framework changes needed (existing vitest tests cover pure logic in `ai-enhancer`,
`runpod`, `png-import`, `json-builder`, `events`, `state`). Verify manually:

1. Load the Editor tab — three columns render with canvas centered and no scrolling.
2. Click Turbo/Classic in the toolbar — `state.workflow` updates, Turbo Strength slider
   enables/disables, reload preserves the choice.
3. Click Generate — modal opens with prompt textarea; Enhance works; Generate submits and the
   modal closes on success; image overlays canvas.
4. Close modal via Esc / backdrop click — no generation triggered.
5. Draw a box in normal view — no panel appears (intended).
6. Enter fullscreen — canvas maximizes, Layers + Box Properties panels appear on the right,
   sidebars + sub-toolbar + Generate button hidden, toolbar toggle still visible.
7. In fullscreen, select a box → Box Properties appears; edit fields apply; Layers reorder /
   visibility / lock work.
8. Exit fullscreen (button + Esc) — normal three-column layout restored.
9. Switch to Gallery/Vision tabs — sidebars + workflow toggle hidden, tab content fills the
   center; switch back to Editor — three columns restored.
10. Resize browser narrower than 900px — columns stack, canvas keeps a usable height.
11. Run `npm test` — all existing tests still pass.
