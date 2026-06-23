# Color Copy/Paste — Design

**Date:** 2026-06-23
**Status:** Approved

## Goal

Let users copy a color (hex) from any swatch to the system clipboard and paste/type it into the global palette or any box's palette — across boxes, canvases, and other apps. Also provides a reliable fallback for the native `<input type="color">` picker, whose drag is unreliable in some browser/OS setups.

## Non-goals

- Custom color picker UI (the native picker stays).
- Inter-app color sync beyond the OS clipboard.
- Reordering palettes (already handled elsewhere).

## Approach

System clipboard (`navigator.clipboard`). Two orthogonal additions to `palette.js`; no change to existing remove-on-click or to state/events.

### 1. Copy — right-click on swatch

`contextmenu` event on each swatch → `preventDefault()` + `navigator.clipboard.writeText(hex)` → toast `Copied #XXXXXX`. Left-click still removes (unchanged). Right-click is the conventional copy gesture and zero-disruption.

### 2. Hex text field next to each picker

Add a small `<input type="text">` (`#global-hex-input`, `#box-hex-input`) next to each native picker. `addColor(type)` resolves the hex as:

1. If the text field is non-empty → use it (validate, normalize).
2. Else → fall back to the native picker's `.value` (current behavior).

Normalization: strip leading `#`/whitespace, uppercase, require `/^[0-9A-F]{6}$/`. Reject otherwise with a toast `Invalid hex`. Routing still goes through the existing `addColor` paths so the 16-cap (global) and 5-cap (box) and duplicate-dedup rules still apply unchanged.

## Files

| File | Change |
|------|--------|
| `src/palette.js` | Right-click copy handler in `renderColors`; read hex field first in `addColor`; clipboard helpers + toasts |
| `index.html` | Two new `<input type="text">` hex fields (+ sr-only labels) inside the existing `.color-input-row` for global and box palettes |

State, events, and all other modules untouched. Reuses existing `addColor()`, `showToast()`.

## Failure modes

- `navigator.clipboard` undefined (older browser) → toast `Clipboard not available`.
- `writeText` rejects (permission denied) → toast `Couldn't copy`.
- Hex field empty + native picker used → existing behavior (unchanged).
- Hex field has invalid text → toast `Invalid hex`, no insertion.
- Paste into the field with a non-hex clipboard content → user sees their pasted text; Add Color rejects with `Invalid hex`. (No silent corruption.)

## Out-of-scope note: native picker drag bug

User reports the native `<input type="color">` picker circle won't drag. Investigation confirms the app never writes to the picker's `.value` nor listens to its `input`/`change` events, so app code cannot reset the circle. This is a Chrome/macOS native-picker issue (external display, accessibility, or Chrome-version related), not fixable from app code. The hex text field added here doubles as a reliable workaround.
