# Style Presets + Split Override — Design

## Goal

Let users save/reuse named **style presets** (aesthetics / lighting / medium / photo-or-art + mode). Pickable in two places:

- **Editor** — apply-once fill of the style fields (quick-start template).
- **Vision → Split** — override: the scene VLM call **skips style entirely** (faster, simpler prompt) and the preset's style is substituted into the final JSON.

## Preset model

```json
{ "id": "<uuid>", "name": "<label>",
  "mode": "photo" | "art_style",
  "aesthetics": "...", "lighting": "...", "medium": "...", "photo_art": "..." }
```

`photo_art` holds the camera/lens value (photo mode) or art-style text (art mode) — matches how the editor's `#art_style` field already doubles for both via the mode radio (`json-builder.js:150`). No `color_palette` (the palette system owns that).

## Storage

`localStorage.ideogram_style_presets` = JSON array. CRUD lives in a new `src/style-presets.js`, mirroring the `lora.js` library pattern.

## Module: `src/style-presets.js`

Owns the library (localStorage CRUD) + the editor preset row UI. Applying emits `style-preset:applied { preset }`. `settings.js` listens → fills the 4 style fields + sets photo/art mode (reuses its existing field-setting; same event-driven pattern as `lora:selected`). **Apply-once, no restore** (per user decision — no snapshot machinery).

## Editor UI

Near the existing style fields: a `<select>` (None + preset names) that applies on change, a "Save current as preset" button (captures current field values + prompts for name), and "Delete" for the selected. Edit = delete + re-save — minimal CRUD, no modal.

## Vision UI (split-only)

A "Style preset" `<select>` in the vision toolbar, shown only when Pipeline = Split (same visibility pattern as the pipeline dropdown). Picking a preset is the override trigger. On Process, `vision.js` adds `style_override: { mode, aesthetics, lighting, medium, photo_art }` to the request body. No selection → VLM does style as today.

## Backend (split-only)

- `server.py`: when `style_override` present, write it to a temp JSON file, pass `--style-override <path>` to `main.py` (avoids shell-escaping style text).
- `main.py`: add `--style-override <path>` arg; read JSON; pass `style_override=` to `pipeline_split.run` (ignored by baseline).
- `pipeline_split.run`: accepts `style_override=None`. When set → scene call uses a new trimmed prompt `prompts/scene_analysis_no_style.txt` (description + background only); the override is mapped to the `style` dict and merged in place of VLM style. When unset → unchanged.
- New prompt `scene_analysis_no_style.txt` = `scene_analysis.txt` minus the style block.

`build_json` reads `style["medium"]` to branch photo vs art, so the override's `medium` must be set correctly by the user (e.g. `"photograph"` for photo presets).

## Frozen baseline

`pipeline.py`, `prompts/global_analysis.txt`, everything under `steps/` untouched. The override affects the split path only.

## Note on the speed win

Style is ~4 short fields, so the raw token/time saving is modest. The bigger expected win is a simpler scene prompt that lets the model focus on `high_level_description` + `background`. Worth doing either way since it also unlocks reusable presets.

## Out of scope

- `color_palette` in presets (palette system owns it).
- Override on current/external pipeline (split-only feature).
- Preset import/export (YAGNI).
