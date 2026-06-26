# Collections Redesign — Design

**Date:** 2026-06-26
**Status:** Approved
**Supersedes:** `2026-06-26-prompt-collections-design.md` (original build) — keeps the same data model and localStorage keys; reworks the UI/UX surface and adds export/import + per-item actions.

## Motivation

The Collections tab works but reads as an afterthought next to the app's
warm-dark editorial theme: a flat text list, a cluttered toolbar (select +
name + 3 buttons + count), paste-to-add, and a sticky generate button. Items
store raw JSON and render as a single truncated line, so every prompt looks
identical. This redesign makes collections a first-class surface: rich
preview cards, decluttered navigation, per-item detail + actions, and
export/import for backup/sharing.

## Visual direction

Cohesion over novelty — match the existing language: DM Serif Display titles,
DM Sans body, warm gold `--accent`, oklch surfaces, hairline borders. Subtle
hover lifts, gold active states, chip-based navigation.

## Layout

### Header zone (declutters the current toolbar)
- **Collection chips row** — horizontal scrollable chips, one per collection;
  active = gold fill. `+ New` chip pinned at the end. Replaces the `<select>`.
- **Collection header** — big DM Serif title, **click to edit inline**
  (becomes an input; Enter/blur saves). Replaces the Rename button. Meta line
  below: `{n} prompts · {aspect} · last edited {rel-time}`.
- **Header actions** (small icon buttons, right-aligned): **Import**,
  **Export**, **Delete** (confirm). Replaces the New/Rename/Delete pile.

### Card grid
Responsive `repeat(auto-fill, minmax(190px, 1fr))`. Each card:
- **Preview canvas** (top, square) — rendered live from the item's boxes. Each
  element drawn as a translucent fill using its `color_palette[0]` (fallback
  `--accent`) + 1px border, with its index number. Different compositions read
  as visibly different cards. Crisp via `devicePixelRatio`.
- **Body** — title (`high_level_description`, 2-line clamp), then meta chips:
  box count, mode, palette swatch dots.
- **Hover** — lift + gold border glow + reveal a chevron.

### Inline expand (per-item detail)
Click a card → it expands to **full grid width** (`grid-column: 1/-1`),
reflowing the grid cleanly:
- Left: larger preview. Right: full high_level_description, style fields
  (aesthetics / lighting / medium / art_style / photo), background, and a full
  element list (index, type chip, desc, bbox %, palette).
- **Action row**: `[Generate this one]` `[Load into Editor]` `[Duplicate]` `[Remove]`.
- Click card or chevron again to collapse. Only one expanded at a time.

### Sticky footer
`Generate Collection (N)` CTA remains, disabled when empty.

## Per-item actions

| Action | Implementation |
|--------|----------------|
| Generate this one | `enqueueImportJson(item.importJson)` + toast + switch to Editor tab (mirrors `generateCollection`). |
| Load into Editor | `emit('state:loaded', { json })` — existing path: `canvas.js:410` rebuilds boxes, settings fills form, palette/layers update. + switch to Editor tab. |
| Duplicate | clone item with new id, insert after source, re-render. |
| Remove | existing `removeItem`. |

## Export / Import (new)

- **Export** — `{ name, exportedAt, items:[{importJson}] }` → download
  `<slug>.json` (Blob + `a.click`, pure client, no backend).
- **Import** — hidden `<input type=file accept=.json>`; on change → parse →
  `createCollection(name)` + push items → set active. Errors → toast.

## Preview rendering (technical crux)

`renderPreview(canvas, importJson, size)`:
1. Parse JSON; read `compositional_deconstruction.elements`.
2. For each element, `bbox = [y1, x1, y2, x2]` (same convention as
   `canvas.js:418` and `json-builder.js:129`). Defensive min/max per axis.
3. Draw rect scaled to the canvas (0–1000 space → px), fill = `palette[0]` @
   ~35% alpha + gold-tinted stroke; index label top-left.
4. Parse failure / no elements → placeholder ("no layout").
5. Set canvas attrs to `size * devicePixelRatio`, scale ctx for crispness.

Square previews (1:1) — neutral and predictable; the prompt JSON carries no
dimensions, so aspect detection is out of scope.

## Data model

- **No schema change required.** Previews are derived from `importJson` at
  render — no stored thumbnails (YAGNI).
- Add optional `createdAt` on new collections for the meta line; old
  collections omit it (guarded).
- localStorage keys unchanged: `ideogram_collections`, `ideogram_active_collection`.

## Files touched

- `index.html` — replace `#collection-container` markup + rewrite the
  Collections CSS block.
- `src/collections.js` — rewrite `render()`/`bind()`, add preview renderer,
  expand state, export/import, per-item actions. Target ≤ ~180 LOC. Add `emit`
  import from `events.js`.
- **No new events** — reuses `state:loaded`, `collection:add`,
  `enqueueImportJson`. Event catalog unchanged.

## Out of scope (YAGNI)

Drag-reorder, search/filter, duplicate-collection, tags, thumbnail caching,
multi-select. Each layers on later without rework.
