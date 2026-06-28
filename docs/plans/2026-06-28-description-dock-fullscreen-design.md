# Prominent Description Dock (Fullscreen) — Design

**Date:** 2026-06-28
**Status:** Approved

## Problem

In fullscreen drawing mode, editing a selected layer's object description is the
primary task, yet the description textarea (`#box-desc`, `rows="5"`) is a small
field buried among many inside the right-side `.fullscreen-rail` `#box-panel`
(340px wide). It is hard to read and edit comfortably.

Note: the `#box-panel` (and therefore `#box-desc`) lives in `.fullscreen-rail`,
which is `display:none` everywhere except fullscreen — so the description is
effectively **fullscreen-only** already.

## Goal

When a layer is selected in fullscreen, surface its description as a large,
prominent, bottom-centered editor — the clear focal point of the view.

## Decisions (from brainstorming)

- **Placement:** Bottom-center floating dock, spanning the width of the canvas
  column (clears the 340px right rail), centered textarea within.
- **Scope of fields:** Description only. Other fields (element type, text,
  geometry, color, recaption) stay in the right rail.
- **Rail field:** The description textarea is **relocated** out of the rail's
  `#box-panel` into the dock — single source of truth, no duplication, no sync.
- **Modes:** Fullscreen only. Normal editor layout unchanged.

## Approach

**Relocate the existing `#box-desc` element** (keep its ID) into a new
`.desc-dock` container, so every existing binding in `settings.js` keeps
working without JS rewrites:

- `settings.js` input listener on `box-desc` (line ~63) → updates `box.desc`.
- `on('box:selected')` populate (line ~161) → `document.getElementById('box-desc').value = box.desc`.
- Recaption writeback (line ~296) → sets `#box-desc`.value.

## Design

### DOM

- Add `.desc-dock` as a child of `.center-col` (the canvas column), placed after
  `#tab-editor`. Contains:
  - A header row: layer color dot + "Object N" label (identifies the selected box).
  - The relocated `#box-desc` `<textarea>` (remove it from `#box-panel`).
- Remove the Description `.input-group` from `#box-panel` in `index.html`.

### CSS

- `.desc-dock` default: `display:none`.
- `.main-content.draw-fullscreen .desc-dock` → `display:block` (fullscreen gate).
- Pinned to the bottom of the canvas column: `position:absolute` (center-col is
  positioned) or a flex layout, with `left`/`right` offsets that clear the rail
  width (340px) + gaps; centered inner content with `max-width` ~680px.
- Surface background (`--surface`), hairline border, accent focus ring on the
  textarea, soft shadow + subtle backdrop blur so it lifts above the canvas.
- Large, readable textarea: ~16px font, comfortable line-height,
  `min-height` ~120px, `resize: vertical`.

### Visibility (runtime)

- Dock shown only when fullscreen **and** a box is selected. The fullscreen half
  is CSS; the selection half mirrors the existing `#box-panel` show/hide in
  `settings.js`'s `on('box:selected')` handler (one-line addition: toggle the
  dock's display alongside `boxPanel.style.display`).
- Hidden on deselect / `canvas:reset` (same handler's `else` branch).

### Behavior

- On box selection in fullscreen, the textarea auto-focuses (description is the
  focal task). Non-fullscreen is unaffected.
- Edits flow unchanged: `#box-desc` `input` → `box.desc` → `state:changed`.
- Recaption writeback still targets `#box-desc` (now in the dock). ✓
- The dock header label + color dot update on `box:selected` (read from the
  selected box's color + index).

### Right rail (`#box-panel`) after change

Keeps: Element Type, Text Content, Position & Size, Identity color, Box palette,
Recaption. Loses: the description textarea.

## Out of scope

- Normal (non-fullscreen) editor.
- Exposing element type / text content in the prominent dock.
