# Template prompts (token substitution)

## Problem

For LoRA character/style work, the same composition prompt gets reused with only the character name(s) and "type" (man/woman/person) swapped. The name appears in several places (high_level_description + multiple element descs), so retyping it everywhere each run is tedious.

## Solution

Reuse **Collections**. Any collection prompt containing `{{token}}` placeholders becomes a template automatically — no new tab, storage, or authoring UI. The user already writes prompts gender-neutral with a `{{type_name}}` slot, so no pronoun-fixing logic is needed.

## Flow

1. Expand a card whose prompt contains `{{tokens}}` → expanded detail shows one labeled text input per unique token.
2. Type the value once per token.
3. Click **Load into Editor** (or **Generate this one**) → app reads the inputs, global-replaces every `{{token}}` across the *entire* raw JSON string (so one name fills every box), then proceeds exactly as today (`state:loaded` / `enqueueImportJson`).
4. In the editor, pick the existing style preset + LoRA + Generate as normal.

## Decisions

- Syntax: `{{token}}` (token chars: word, `_`, `-`).
- Style is **not** a template concern — handled by the existing style-preset dropdown after load.
- Empty value → token replaced with empty string (removed).
- Both card actions substitute tokens first. Prompts without tokens behave exactly as before (zero behavior change).

## Implementation

- `src/collections.js`:
  - `extractTokens(importJson)` — regex `/{{\s*([\w-]+)\s*}}/g` over the raw string, unique list preserving order.
  - `renderDetail` — if tokens exist, render a token-inputs block (one labeled input per token) reusing `.input-group` styles.
  - `resolveTokens(itemId, importJson)` — at action time, read the expanded card's inputs from the DOM and substitute. No persisted state (read DOM on click → no re-render/focus issues).
  - `generateItem` / `loadItemToEditor` — resolve tokens first, then call existing logic.
- `index.html` — small CSS for the token row (`.coll-tokens`).

~50 LOC across 2 files. Backwards compatible.
