# Find more — free-text instruction — Design

## Goal

Let the user steer the Vision tab's "Find more items" call with a free-text
instruction (e.g. "find missing people", "look for background text"), matching
the workflow they got working manually in the Gemini web UI: image + current
JSON + a one-line instruction. Also fix a reveal bug — Find more is currently
only shown after a successful Process Image call, so it never appears for
images/JSON loaded any other way (PNG import, gallery, session restore).

## Decisions (locked during brainstorm)

| Decision | Choice |
|----------|--------|
| Scope | **Augment the existing Find more button.** No new mode, no new control. Empty instruction = byte-identical to today. |
| Instruction power | **Steer search only.** Instruction refocuses *what new items* to look for. Result still appends new elements (SAM localizes boxes). No full-JSON rewrite, no modify-existing. |
| Reveal bug | **Show Find more + instruction input whenever an image preview AND non-empty `#vision-json` exist**, regardless of how they got there. |
| Local-model support | **Cloud-only for v1.** `img-to-json/main.py` has no `--more-instruction` flag; local path keeps default behavior. `ponytail:` comment marks the upgrade path. |
| Persistence | **None.** Instruction is a throwaway per-call knob, not saved to session. |

## Architecture

### File layout

| Action | File | Purpose |
|--------|------|---------|
| edit | `index.html` | Add `#vision-instruction` text input in `.vision-actions`; minimal CSS |
| edit | `src/vision.js` | New `updateFindMoreVisibility()` helper; send `instruction` in find-more body |
| edit | `server.py` | `_handle_vision_more`: read `instruction`, inject into cloud user message |
| edit | `src/__tests__/vision.test.js` | Cover instruction-in-body + reveal-helper logic |
| **frozen** | `img-to-json/*`, all prompts, all other modules | Untouched |

### Frontend — `index.html` + `src/vision.js`

**Input.** Single-line text input placed inside `.vision-actions` (index.html:3380-3384), before the Find more button:

```html
<input id="vision-instruction" type="text"
       class="vision-instruction-input"
       placeholder="e.g. find missing people · look for background text">
```

Placeholder doubles as discoverability — no separate label needed.

**Reveal helper.** Extract `updateFindMoreVisibility()`:

```
visible = previewImg has a src AND #vision-json has non-empty trimmed value
toggle #btn-vision-find-more and #vision-instruction display accordingly
```

Called from: `processImage()` success (replaces the inline reveal at vision.js:339), `state:loaded` listener, `input`/`paste` on `#vision-json`, and the existing `image:ready` handler. One source of truth replaces the fragile single-call-site reveal.

**Send.** In `findMore()` (vision.js:364), read `document.getElementById('vision-instruction').value.trim()` and add to the POST body as `instruction` (omit key when empty so empty path is byte-identical).

### Backend — `server.py` `_handle_vision_more` (line 374)

Read `instruction = body.get("instruction", "").strip()`.

**Cloud path** (line 467-471): today the user message ends with the fixed sentence
*"Find ADDITIONAL distinct instances NOT in the list above. Return only NEW
items, or {\"objects\": []} if nothing new remains."*

When `instruction` is non-empty, replace that sentence with the user's text,
keeping the same trailing constraint ("Return only NEW items, or
{\"objects\": []} if nothing new remains.") so the response shape is
unchanged. Empty `instruction` → current message verbatim.

**Local path** (line 417): no change. `// ponytail: local path ignores
custom instruction; add --more-instruction to img-to-json/main.py if a local
user needs it.`

Response shape (`{new_elements, total}`) is unchanged — dedup + append flow
in `vision.js:398-425` is untouched.

## Error handling / edge cases

- **Empty instruction** → identical to today (no key sent, no message change).
- **Instruction that asks for a modify/rewrite** (e.g. "shorten descriptions") → model still returns new objects only (system prompt constrains it); append flow may produce nothing useful. Out of scope for v1; user picked steer-search-only.
- **Instruction that names a category with zero matches** → model returns `{"objects": []}` → existing "No new items found · likely complete" path (vision.js:400).
- **Very long instruction** → sent as-is; no truncation. Cloud VLMs handle multi-KB user messages fine.

## Testing

`src/__tests__/vision.test.js` additions:
- `findMore()` includes `instruction: "find missing people"` in the POST body when input is non-empty.
- `findMore()` omits `instruction` when input empty (byte-identical request shape).
- `updateFindMoreVisibility()` shows button+input when `#vision-json` non-empty + preview has src; hides when JSON empty.

No new server tests — `_handle_vision_more` mirrors the untested cloud path; the change is a string interpolation.

## Out of scope (v1)

- Local-model custom instruction (needs `main.py` flag).
- Multi-turn conversation / instruction history.
- Replace-JSON / revise modes.
- Persisting instruction text in session.js.
- Quick-action chips (presets like "find people" / "find text").
