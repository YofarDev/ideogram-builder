# Turbotime LoRA by Default + v20 Workflow Adoption

**Date:** 2026-06-19
**Status:** Approved

## Goal

Make the ostris `ideogram_4_turbotime_v1` LoRA active on every generation, adopt the single-model `ideogramV4Workflow_v20.json` as the live base (it drops the unconditional/dual-model setup), lower step counts to 2/4/8, and add a fallback toggle to re-enable the old workflow.

## Context

- `runpod/workflow_template_lora.json` is the current live API-format base. Uses dual `DiffusionModelLoaderKJ` (main + unconditional) + `DualModelGuider`. Step presets embedded `mu/std/num_steps`.
- **REVISED (2026-06-19):** The user found a cleaner workflow and exported it directly in **API format** as `runpod/workflow_template_lora_turbo.json`. This replaces the earlier UI-format `ideogramV4Workflow_v20.json` plan. No manual ComfyUI export step needed — file is ready.
  - Topology: single `UNETLoader` (165) → `LoraLoaderModelOnly` (183, turbotime, `strength_model`) → `Power Lora Loader` (186, user lora slot) → `ModelSamplingAuraFlow` (98:171) → `CFGGuider` (98:185). No unconditional model. Uses `CFGGuider` (not `DualModelGuider`).
  - **Preset table (node 98:147) already ships 8/4/2** (`Quality.num_steps=8, Default=4, Turbo=2`) with mu/std. The existing frontend preset system works unchanged — no handler step injection needed.
  - Prompt target: `CLIPTextEncode` (98:167) `text` field, directly (no PrimitiveStringMultiline intermediary).
  - Turbotime LoRA path: `ideogram4\control\ideogram_4_turbotime_v1.safetensors`.
- Fallback: `workflow_template_lora.json` (old dual-model) kept as engine=v1 option.

## Design

### 1. Workflow swap — turbo workflow becomes the new base
- `runpod/workflow_template_lora_turbo.json` (API format, ready) is the new live base, copied to `/workflow_template_turbo.json` in the Docker image.
- `workflow_template_lora.json` kept as fallback, copied to `/workflow_template_lora.json`.
- Default active workflow = turbo (v20).
- **No manual ComfyUI export needed** (file already committed by user).

### 2. Turbotime — always active by default, strength user-adjustable
- Node 183 (`LoraLoaderModelOnly`) is baked into the turbo workflow and always applied for every turbo-mode job. The frontend cannot disable it but **can adjust its strength**.
- Dockerfile downloads the LoRA into the path node 183 references:
  ```
  RUN mkdir -p /comfyui/models/loras/ideogram4/control && \
      wget -q -O /comfyui/models/loras/ideogram4/control/ideogram_4_turbotime_v1.safetensors \
      https://huggingface.co/ostris/ideogram_4_turbotime_lora/resolve/main/ideogram_4_turbotime_v1.safetensors
  ```
- **Turbo Strength slider** (new): dedicated control in Global Settings → Generation, directly under the Engine toggle. Range 0–2, step 0.05, **default 0.8** (lowered from 1.0 — user reports better results). Persisted in localStorage as `ideogram_turbo_strength`. **Disabled/greyed when engine=v1** (turbotime only exists in turbo workflow).
- Sent to backend as `turbo_strength` (float). Handler injects into node 183 `strength_model` only when workflow=turbo.

### 3. Optional second LoRA (kiki) — verifies "coupled with another lora"
- Node 186 (`Power Lora Loader`, rgthree) is the user-lora slot, chained after turbotime: `165 → 183(turbotime) → 186(kiki) → 98:171`.
- Handler populates node 186 from `state.loras` using the **same `_populate_lora_loader` helper** as the old workflow (lora_1..n slots, positive strength). Single model means only ONE loader (no unconditional loader).
- This reuses the proven Power Lora Loader pattern and lets us verify the turbotime+kiki combination.

### 4. Steps — preset table already correct (no handler change)
- The turbo workflow's node `98:147` already ships `{Quality:8, Default:4, Turbo:2}` with mu/std. The existing `98:156` CustomCombo + `98:147` JsonExtractString machinery drives `BasicScheduler` (98:172) automatically.
- Handler only sets `98:156` choice/index from preset — **identical to old workflow**. No step injection.
- Frontend radio display values updated 12/20/48 → 2/4/8 (already done in Tasks 1-5).

### 5. Prompt path
- Handler injects the client-built `import_json` into node `98:167` (`CLIPTextEncode`) `text` field directly. No intermediary PrimitiveStringMultiline node in the turbo workflow.
- This preserves the existing client-side JSON construction — no change to `json-builder.js`, `palette.js`, `canvas.js`, or the import_json schema.

### 6. Handler `build_workflow` dispatch
| Purpose | v1 fallback node | turbo node |
|---------|------------------|------------|
| import_json prompt | 188 (`.value`) | 98:167 (`.text`) |
| Width / Height | 98:27 / 98:28 | 98:27 / 98:28 (same) |
| Seed | 160 | 160 (same) |
| Preset (choice/index) | 98:156 | 98:156 (same) |
| User lora (kiki) | 166 + 177 (two loaders) | 186 (single Power Lora Loader) |
| Turbotime strength | n/a | 183 (`strength_model`) |

Shared node IDs (98:27, 98:28, 160, 98:156) make the dispatch compact; only prompt target, lora loader count, and turbotime differ.

### 7. Hide the Uncond slider
- v20 has no unconditional model, so the LoRA "Uncond" strength slider is meaningless.
- Remove the `#lora-unconditional` slider + label from `index.html` (lines ~2099-2102).
- `lora.js`: drop `unconditional` handling — `useSelected` sends only `{ filename, source_url, strengths:{ positive } }`. `updateEntry` only handles `positive`. `loadConfigIntoPanel` no longer touches the uncond field.
- Note: the kiki seed in `lora.js` keeps `strengths.unconditional` in its object for backward-compat with the old workflow fallback; the old `build_workflow_v1` still reads it. Frontend just stops *editing* it.

### 8. Workflow fallback toggle (UI)
- New `state.workflow` field, default `'v20'`, alternative `'v1'` (old dual-model lora workflow).
- Persisted in localStorage as `ideogram_workflow` (mirrors the `ideogram_aspect_ratio` pattern).
- UI: a small radio/toggle in the Global Settings → Generation section, labeled **"Engine: Turbo (v20) / Standard (v1)"**. Defaults to Turbo.
- `runpod.js`: sends `workflow: state.workflow` in the job input.
- `handler.py`:
  - Loads both templates at startup (`/workflow_template_v20.json`, `/workflow_template_lora.json`) into a dict.
  - `build_workflow` dispatches to `build_workflow_v20` or `build_workflow_v1` based on `workflow` param.
  - v1 path is the existing code unchanged (dual Power Lora Loaders, mu/std presets). v20 path is the new code.
- When `v1` is selected, turbotime is NOT applied (it's v20-specific); the Uncond slider also becomes relevant again but is hidden in UI — acceptable trade-off for a fallback mode.

## Open items / verification (live endpoint)
1. Turbotime + kiki combination renders well (the reason for the dedicated second-loader node design).
2. BasicScheduler at 2/4/8 steps produces good results with turbotime.
3. The v20 API-format export has correct widget names for node injection (the main reason we chose manual export over a converter script).

## Out of scope
- Removing the old workflow files entirely (kept as fallback).
- Migrating existing gallery history items (format unchanged).
- AI enhancer changes (unaffected).
