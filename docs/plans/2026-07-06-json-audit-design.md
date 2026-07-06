# JSON Audit (image + JSON → suggestions) — Design

## Goal

After the Vision tab produces a JSON caption, let the user feed **the image plus
the current JSON** back into a vision model (local or cloud) and get a list of
**critique suggestions** they can accept or reject individually. Primary pain
point: complex images where the first pass missed objects; secondary: weak
descriptions, wrong style/background fields. Workflow: local VLM first pass →
relecture with a more powerful cloud VLM.

## Decisions (locked during brainstorm)

| Decision | Choice |
|----------|--------|
| Output shape | **Candidate list** — user accepts/rejects each. No silent full-JSON rewrite. |
| Candidate bbox source | **Cloud VLM emits bbox directly** in each `add_element` candidate. No SAM dependency for audit. |
| Audit scope | **Missing elements + everything** (existing element desc, style, background, high_level_description). |
| UI shape | **Right-side dock panel** in the Editor tab. Canvas stays interactive while reviewing. Modal rejected (blocks spatial judgement); inline ghosted boxes rejected (2× code, defer). |
| Apply mechanism | **Reuse `state:loaded`** after each accept — no new event types. Cost: canvas selection resets per accept. Acceptable. |
| Persistence | **None.** Audit is a transient review session; close panel = suggestions gone. Matches recaption behavior. |

## Architecture

### File layout

| Action | File | Purpose |
|--------|------|---------|
| new | `img-to-json/prompts/json_audit.txt` | System prompt: schema + rules for emitting suggestions |
| edit | `img-to-json/main.py` | Add `--audit-mode` flag + `--json-file` arg → routes to one-shot local VLM call that prints suggestions JSON |
| edit | `server.py` | New `POST /api/audit-json` handler; reuses `_cloud_vlm_chat` + `_run_pipeline_subprocess` |
| new | `src/audit.js` | Module: button wiring, panel DOM, suggestion rendering, accept/reject flow |
| edit | `src/app.js` | Import + call `initAudit()` alongside other modules |
| edit | `index.html` | "Audit JSON" button in editor toolbar; empty dock panel container |
| new | `src/__tests__/audit.test.js` | Render + accept/reject tests |
| **frozen** | `pipeline.py`, `pipeline_split.py`, `prompts/*` (existing), `steps/*`, `models/*` | Touched zero — audit is additive |

### Suggestion schema

Model returns `{ "suggestions": [...] }`. Three types cover the full scope:

```json
{
  "suggestions": [
    {
      "type": "add_element",
      "reason": "Wine glass on the right is not in the caption.",
      "element": {"name": "wine glass", "desc": "...", "has_text": false, "visible_text": null, "bbox": [y1, x1, y2, x2]}
    },
    {
      "type": "update_element",
      "index": 2,
      "reason": "Description is too vague.",
      "patch": {"desc": "the red ceramic mug, lower-left of the tray"}
    },
    {
      "type": "update_field",
      "field": "style.lighting",
      "reason": "Shadows are hard, not soft.",
      "value": "hard directional sunlight from upper left, strong shadows"
    }
  ]
}
```

- **`bbox` is yxyx** (matches canvas internal format; reused from existing vision paths via `to_yxyx`).
- **`update_field.field` uses dot-path** so `background`, `high_level_description`, and any `style.*` sub-field share one type. No per-field type explosion.
- **`update_element.patch`** can patch `desc` and/or `visible_text` in one suggestion.
- **No `remove_element` in v1** (YAGNI; can add later if duplicate-element detection becomes a real need).

### Backend

**Prompt** — `img-to-json/prompts/json_audit.txt`. System message: schema above + rules (only grounded changes, bboxes in yxyx, no hallucinated text, dot-path field names, return ONLY the JSON). User message: "Audit this caption against the image. Current JSON: <inline>"

**Endpoint** — `POST /api/audit-json`, body `{image, json, model, bbox_format}`.

Dispatch mirrors `/api/recaption-element`:

- **Cloud model (`provider::name`)**: reuse `_cloud_vlm_chat` (extracted during the cloud-split work). One call, parse, return `{suggestions: [...]}`. ~30 LOC handler.
- **Local model (`local`)**: subprocess `uv run main.py --audit-mode <img> --json-file <path> --bbox-format <fmt>`. New `--audit-mode` in `main.py` loads Qwen3-VL, runs ONE VLM call, prints suggestions JSON to stdout. Reuses `_run_pipeline_subprocess` for spawn/capture/cancel.

**Response shape**: `{suggestions: [...], warnings: [...]}`. No canonicalization (these are suggestions, not final JSON — verifier runs only when accepts rebuild the JSON client-side).

**Concurrency**: reuse the existing `/api/img-to-json/cancel` slot. One vision-family subprocess in flight at a time. Second concurrent request → 409.

### Frontend

**Module** — new `src/audit.js`. Imports from `state.js`, `events.js`, browser APIs only. Wired in `app.js`.

**UI** — Editor tab only.
- **"Audit JSON"** button in the editor toolbar. Disabled when no image loaded.
- Click → opens right-side dock panel (similar slot to layers panel).
- **Panel header**: vision-model `<select>` (reuses `populateLLMVisionModels` + local option, same shape as recaption), close button.
- **Panel body**: list of suggestion cards. Each card:
  - Type badge (Add / Update element / Update `<field>`)
  - Reason (italic)
  - For `update_*`: `current → proposed` plain-text diff (no syntax-highlighted diff — YAGNI)
  - **[Accept] [Reject]** buttons
- **Footer**: **[Accept all]**. Skip "Reject all" — closing the panel rejects the rest.

**State mutation on accept** — single path, no new event types:
1. Read current JSON from `#json-output`
2. Apply mutation in-memory:
   - `add_element` → push to `compositional_deconstruction.elements`
   - `update_element` → merge `patch` into `elements[index]`
   - `update_field` → walk dot-path, set value
3. Write updated JSON back to `#json-output`
4. Emit existing `state:loaded` with the new JSON → canvas/settings/palette/layers rebuild via existing listeners
5. Mark card as `applied` (gray out, button becomes "Applied ✓")

Reusing `state:loaded` = no new event types, no per-mutation handlers in other modules. Cost: canvas selection resets on each accept.

## Error handling / edge cases

- **Malformed suggestion** (missing field, bad bbox shape, unknown type) → drop client-side, toast "N suggestions skipped as malformed", keep valid ones. Never block the whole list.
- **Empty suggestions** → panel shows "No improvements found." empty state.
- **`update_element.index` out of bounds** (JSON edited since audit ran) → Accept button errors inline "Stale — re-run audit"; no crash.
- **`update_field` dot-path missing** → same inline "Stale" error.
- **Subprocess / cloud failure** → error toast with stderr/API detail; panel stays in empty state.
- **Concurrent audit requests** → server returns 409 (single `_vision_state` slot).

## Testing

- `src/__tests__/audit.test.js`:
  - Render panel from fixture suggestions, click Accept on each type, assert `#json-output` mutated correctly + `state:loaded` emitted
  - Malformed entries dropped with warning
  - Stale-index path errors inline, no crash
- **No new server tests** — `/api/audit-json` mirrors `/api/recaption-element` (also untested server-side). Don't add a test layer just for this.
- **No prompt tests** — text file.

## Out of scope (v1)

- Ghost-preview overlays for `add_element` candidates
- "Reject all" button
- Batch re-run / partial re-audit
- `remove_element` suggestion type
- Audit history / persistence
