# Vision Tab Rework — Design

## Goal

After an image loads in the Vision tab, repurpose the left column (currently static info text) for the JSON textarea, so the full workflow fits without scrolling.

## Layout

### Before image loaded (unchanged)

```
┌───────────────────────┬───────────────────────────┐
│  Info text             │  Dropzone                  │
│  (heading + subtitle)  │  (click/browse)            │
│  Format tags           │                            │
│  Options (checkboxes)  │                            │
└───────────────────────┴───────────────────────────┘
```

### After image loaded (new)

```
┌───────────────────────┬───────────────────────────┐
│  JSON textarea         │  Image preview (compact)   │
│  (editable, flex: 1)   │                           │
│                        │  [Process / Load Editor]  │
│  Options (checkboxes)  │  ── Audit ──              │
│                        │  [model ▾] [Run] [All]    │
│                        │  Suggestions cards         │
└───────────────────────┴───────────────────────────┘
```

### Key changes

| Element | Before | After |
|---------|--------|-------|
| `.vision-info` | Always shows heading + subtitle | Hidden when preview is visible; JSON textarea appears instead |
| `.vision-upload` | Image + JSON + audit stacked | Image + audit only (JSON moved to left col) |
| `#vision-json` | Inside `.vision-audit` | Moves to a new container in left column |
| Options checkboxes | In `.vision-info` | Stay at bottom of left column (below JSON) |

### Data flow unchanged

- Vision processing populates both `#json-output` (editor) and `#vision-json` (vision tab)
- Audit reads from `#vision-json`, writes back to both on accept
- Everything else (model select, pipeline, preview, process) untouched

## CSS changes

- `.vision-info` gets `display: none` when preview is visible (CSS sibling selector, same pattern as `.vision-audit`)
- New `.vision-left-content` flex column replaces `.vision-info` content — shows JSON textarea + options
- `.vision-json-input` moves from inside audit section to this new left-column container
- `.vision-upload` no longer contains the JSON textarea — audit section shrinks to controls + cards only
- Audit section border/margin adjusted (no longer needs its own textarea)

## Files touched

| File | Change |
|------|--------|
| `index.html` | Move `#vision-json` from `.vision-audit` to new container in left column; add CSS for visibility swap |
| `audit.js` | Remove `#vision-json` from audit DOM (it's now in left column); no JS change needed — just reads by ID |
| `vision.js` | Already sets `#vision-json.value` by ID — works regardless of where element is in DOM |
