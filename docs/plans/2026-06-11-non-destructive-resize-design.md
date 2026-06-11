# Non-Destructive Canvas Resize

## Problem

Changing aspect ratio or 1M/2M size calls `clearBoxes()`, destroying all drawn boxes and resetting the canvas. The canvas image and all box work is lost.

## Design

Store box coordinates in normalized 0-1000 space internally (same format as JSON bbox). When canvas dimensions change, re-render DOM from the same normalized values using the new dimensions — no chained remapping, no error accumulation.

### Architecture

1. **Normalized box storage**: `box.x/y/w/h` stored as 0-1000 floats in state
2. **DOM rendering**: Convert normalized → pixels at render time using `state.canvas.width/height`
3. **Resize path**: New `resizeCanvas()` updates wrapper dimensions + scale, calls `renderBoxes()`, preserves overlay image
4. **Reset path**: Existing `initCanvas()` still clears everything (for reset button, initial load)

### File changes

**`canvas.js`**:
- Store normalized values on draw finalization (pointer up)
- `renderBoxes()` — convert normalized coords to pixel DOM positions
- `resizeCanvas()` — update wrapper dims + scale, call renderBoxes (no overlay clear, no canvas:reset)
- `canvas:rebuild` handler — check payload: if `{ oldWidth, oldHeight }` → resizeCanvas, else → initCanvas
- `state:loaded` handler — store bbox values directly (already 0-1000), render DOM via normalized→pixel

**`settings.js`**:
- `updateDimensions()` — capture old dims, pass `{ oldWidth, oldHeight }` payload when boxes exist

**`json-builder.js`**:
- DOM sync normalizes (divides by canvas dims)
- JSON output uses clamp() instead of norm() (values already 0-1000)

**`layers.js`**:
- Thumbnail divides by 1000 instead of `state.canvas.width/height`

### Key property

Box coordinates always relative to the canvas at creation/import time. Switching from 16:9 → 1:1 → 3:2 re-renders the same normalized values through each canvas size — no chained math, no drift.
