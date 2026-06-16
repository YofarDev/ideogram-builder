# LoRA Support — Implementation Plan

## Decision Record

| # | Decision |
|---|---|
| Q1 | LoRA applies to **both** models (positive UNET + unconditional UNET). No CLIP lora (lora template wires CLIP directly). |
| Q2 | No manifest file. Library lives in browser localStorage. |
| Q3 | `input.loras` = separate generation param, not in `import_json`. |
| Q4 | Adopt lora template as new live base. Old `workflow_template.json` kept in repo, dormant. |
| Q5 | Prompt overrides = arbitrary `style_description` patch → auto-fill form fields, editable. |
| Q6 | Two strength sliders (positive / unconditional), default-seeded, UI-editable. |
| Q7 | Preset dropdown (Quality / Default / Turbo) replaces raw steps slider. |
| Q8 | Single-select now, array-capable data path (`input.loras` always array, ≤1 today). |
| Q9 | Dynamic HF paste — user pastes resolve URL; no curated/dynamic split. |
| Q10 | No network volume. Download-on-demand, warm-worker cache. |
| Q11 | User pastes full resolve URL themselves (option C). No HF API resolution. |
| Q12 | No manifest. Library = localStorage, persists across sessions. |
| Q13 | Pasted lora row: 2 sliders + optional override text fields. |
| Q14 | No Dockerfile lora bake. Handler downloads on demand. |
| Q15 | Filename from URL basename, sanitized; collision → auto-append `_2`. |
| Q16 | Public HF only v1; temp+atomic rename; 120s timeout; clear error on fail. |
| Q17 | Sever ResolutionSelector — inject width/height as literals into `98:27`/`98:28`. |
| Q18 | Base template stays in repo unused. Lora template = sole live template. |
| Q19 | localStorage schema fixed; kiki seeded with empty `source_url` (user fills after public upload). |
| Q20 | New `lora.js` module; overrides mutate form fields via event bus; snapshot/restore on deselect. |
| Q21 | Overwrite fields unconditionally; force ARTSTYLE mode when `art_style` override applies. |

---

## Backend — `runpod/handler.py`

`build_workflow(import_json, width, height, preset, seed, loras)` — full rewrite against lora template:

| Node | Field | Source |
|---|---|---|
| `98:27` | `value` | `width` |
| `98:28` | `value` | `height` |
| `188` | `value` | `import_json` |
| `160` | `seed` | `seed` |
| `98:156` | `choice` + `index` | preset → Quality=1 / Default=2 / Turbo=3 |
| `166` | `lora_1..n` | `{on:true, lora:filename, strength:positive}` per lora |
| `177` | `lora_1..n` | `{on:true, lora:filename, strength:unconditional}` per lora |

New pre-flight `ensure_loras(loras)` — for each, before queue:

1. Sanitize filename (basename + `[^A-Za-z0-9._-]` → `_`, collision → `_2`).
2. `os.path.exists(/comfyui/models/loras/<name>)`? skip.
3. Else download `source_url` → `<name>.tmp` (stream, 120s, follow redirects) → `os.replace` atomic.
4. Fail (403/timeout/empty url+missing) → return `{"error": ...}`.

`handler(job)` — read `preset`, `loras` from `job_input`; call `ensure_loras` then `build_workflow`.

## Backend — `runpod/Dockerfile`

- `RUN mkdir -p /comfyui/models/loras`
- `COPY runpod/workflow_template_lora.json /workflow_template.json` (handler path unchanged; old base stays in repo, not copied).
- No lora file COPY (download-on-demand).

> v1 gap: kiki ships with empty `source_url` + not baked → won't generate until uploaded publicly and URL edited in UI library.

## Frontend — `src/state.js`

- Add `loras: []` (array of selected, ≤1), `preset: 'Default'`.
- `steps` repurposed: kept for nothing — UI is preset control now.

## Frontend — new `src/lora.js`

- Owns lora panel DOM: library dropdown (from localStorage), "Add via URL" paste box, 2 strength sliders, override text fields, select/deselect, save-to-library.
- localStorage key `ideogram_loras`; first-run seed kiki entry.
- Emits `lora:selected { overrides }` and `lora:cleared`.
- Writes selection → `state.loras`.

## Frontend — `src/settings.js`

- Listen `lora:selected`: snapshot current values of override-target fields → apply overrides (overwrite) → if `art_style` in overrides, set `photoArtMode = ARTSTYLE` → emit `state:changed` → json-builder regenerates.
- Listen `lora:cleared`: restore snapshot.
- Steps radios → set `state.preset` ('Turbo'/'Default'/'Quality') instead of `state.steps`.

## Frontend — `src/runpod.js`

- `input`: send `preset` (not `steps`), `loras: state.loras.map(l => ({filename, source_url, strengths}))`.
- `import_json` already contains overrides (baked by json-builder via form).

## Frontend — `index.html` + `src/app.js`

- Lora panel markup (inside Generation panel-section, after Seed).
- Wire `lora.js` in `app.js`.

---

## Risk

Power Lora Loader with no active lora (`lora_1.on=false`, empty name) — may error or pass-through. rgthree designed for toggle-off pass-through, unverified here. Test first cold gen with no lora selected. If broken → fallback rewiring: when `loras` empty, bypass loader nodes (point `98:171.model` → `183`, `98:155.model_negative` → `187`).
