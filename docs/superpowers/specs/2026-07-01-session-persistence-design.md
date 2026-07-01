# Ideogram Builder — Session Persistence Design

**Date**: 2026-07-01
**Status**: Approved
**Goal**: Persist all settings, toggles, dropdowns, prompt content, boxes, and UI state across browser sessions so reopening the app restores exactly where the user left off.

## Scope

Three categories of state persist (user-approved: "Everything"):

1. **Config knobs** — size tier (1M/1.5M/2M), steps preset (Fast/Default/Quality), Photo/Art mode, seed, model selections (AI enhance, vision, recaption). Some knobs already persist (`ideogram_workflow`, `ideogram_backend`, `ideogram_aspect_ratio`, `ideogram_turbo_strength`).
2. **Prompt content** — the canonical `json-output` (high-level description, background, aesthetics, lighting, medium, art_style), drawn boxes/layout, and global color palette.
3. **Transient UI** — active tab (Editor/Prompt/Vision/Collections/Gallery), fullscreen drawing mode, preview toggle.

## Approach: Hybrid session module

New `src/session.js` owns a **single versioned blob** under `localStorage.ideogram_session`. It reuses the existing, well-tested `state:loaded` restore path for content, and adds the missing knobs/UI in one coherent debounced module. Already-proven per-key persistence is left untouched to avoid churn on working code.

Rejected alternatives:
- **Per-control keys** (one `localStorage.setItem` per missing control): content (boxes + text) doesn't fit a granular pattern; no debouncing; proliferates ~10 keys.
- **Migrate everything into one blob**: cleanest end-state but risks breaking proven persistence (workflow/backend/aspect/etc.) for no functional gain.

## Storage shape

```jsonc
{
  "version": 1,
  "content": "<json-output string or null>",   // canonical prompt JSON: text + boxes + palette
  "config": {
    "size": "1" | "1.5" | "2",                 // resolution tier
    "steps": "Turbo" | "Default" | "Quality",  // maps to state.preset
    "mode": "photo" | "art_style",             // photoArtMode
    "seed": <number>,
    "aspectRatio": "WxH",                       // mirrored read of ideogram_aspect_ratio on restore
    "aiModel": "<provider::model>",
    "visionModel": "<provider::model | local>",
    "recaptionModel": "<provider::model | local>"
  },
  "ui": {
    "tab": "editor" | "prompt" | "vision" | "collections" | "gallery",
    "fullscreen": <boolean>,
    "preview": <boolean>
  }
}
```

`globalPalette` is **not** stored separately — it lives inside `content` (`style_description.color_palette`) and is restored by `palette.js`'s existing `state:loaded` listener.

## Module contract

| | |
|---|---|
| **Owns** | Read/write/restore of `ideogram_session` blob |
| **Imports from** | `state.js`, `events.js`, browser APIs (DOM, localStorage) — never sibling feature modules |
| **Listens to** | `state:changed` (debounced save), `state:loaded`, `canvas:reset` (wipe content) |
| **Emits** | `state:loaded` (content restore) — an existing event |
| **No new events** | UI restore uses synthetic DOM `.click()` / `change` dispatch, reusing existing handlers |

## Save

- Trigger: `state:changed`, **debounced 400ms**. Reads `content` (from `#json-output`), `config` (including `aspectRatio` from `#aspect-ratio`, so the blob is self-contained for restore), and `ui` from the DOM and writes the blob.
- Final flush on `pagehide` and `visibilitychange` → `hidden`, to capture UI edits (tab/fullscreen/preview) that don't emit `state:changed`.
- The legacy `ideogram_aspect_ratio` key keeps being written by `settings.js` (untouched); session.js ignores it on save and only uses it as a one-time fallback on restore (so existing users keep their ratio after deploy).
- All reads pull from the **live DOM** (always current; avoids stale `state`).
- `try/catch` on write: quota errors must not throw into the app.

## Restore

Runs at the **end of `app.js` init, after `initCanvas()`** (boxes require correct canvas dimensions). Order is critical:

1. **Dimensions first** — set `#aspect-ratio` (from `config.aspectRatio`, falling back to the existing `ideogram_aspect_ratio` key) and `.size-btn[data-size]` active state, then dispatch `change` so `settings.js` `updateDimensions` sizes the canvas.
2. **Content** — set `#json-output` from `content`, then `emit('state:loaded', { json })`. Existing consumers rebuild boxes (canvas), fill form fields (settings), restore palette (palette), rebuild layers.
3. **Other config** — set mode radios, `#seed-input`, and model selects directly on the DOM (no event dispatch → avoids `state:changed` cascade / regenerate). Mode is applied last so the user's most recent toggle wins over any mode implied by content.
4. **UI** — synthetic `.click()` on the saved `.tab-btn[data-tab]`, `#btn-enter-fullscreen` (if fullscreen), `#btn-preview` (if preview). Reuses existing handlers in `gallery.js` / `app.js`.

### Async model selects

`#ai-model`, `#vision-model`, `#recaption-model` populate asynchronously via `fetch('/api/config')` in their respective modules, so options don't exist at restore time. session.js uses a small helper: set the value; if the `<option>` isn't present yet, attach a one-shot `MutationObserver` (childList) that applies the value when options appear, with a 10s self-detach timeout. Fully self-contained — no edits to `ai-enhancer.js` / `vision.js` / `settings.js`.

## Reset behavior

On `canvas:reset` (emitted by canvas reset, consumed here too): wipe **only** `content` from the blob (set to `null`), keep `config` + `ui`, save immediately. Result: "Reset Canvas" clears the prompt/boxes/palette but preserves the user's workflow, backend, size, steps, mode, seed, models, tab, and UI prefs.

## Exclusions (deliberate)

- **Overlay reference image** (`state.imageDataUrl`): not persisted. It is a multi-MB base64 that risks localStorage quota, and it is **already durably stored in the Gallery/history tab**. Boxes/text/palette/config/UI all persist; only the live canvas overlay is not re-shown on reload.
- **No churn on existing keys**: `ideogram_workflow`, `ideogram_backend`, `ideogram_turbo_strength`, `ideogram_aspect_ratio`, `ideogram_collections`(+active), `ideogram_style_presets`, `ideogram_lora_collapsed`, `vision_pipeline`, `vision_bbox_format` remain on their own keys, saved by their existing modules. session.js *reads* `ideogram_aspect_ratio` during restore but never rewrites these.

## Robustness

- `try/catch` on blob parse at load → corrupt/missing data falls back to defaults (no restore, clean start).
- `version` field supports future migrations (bump + transform on load).
- Write failures (quota / private mode) are swallowed and logged; the app continues to work in-memory.

## Event catalog impact

No additions. session.js consumes only existing events (`state:changed`, `state:loaded`, `canvas:reset`). UI restore dispatches DOM events, not bus events.

## Files touched

| File | Change |
|------|--------|
| `src/session.js` | **New** — save/restore/wipe logic (~120 LOC) |
| `src/app.js` | Import `initSession`; call it **after `initCanvas()`** |
| `CLAUDE.md` | Add `session.js` row to module map; note it consumes `state:changed`/`state:loaded`/`canvas:reset` |

No other modules change. No HTML changes. No new dependencies.
