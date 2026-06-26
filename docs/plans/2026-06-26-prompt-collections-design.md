# Prompt Collections — Design

## Goal

Let users group saved prompts into named collections, then generate an entire
collection in one action using shared generation settings (canvas size, speed
preset, workflow, LoRAs, seed).

## Decisions (from brainstorm)

- **Entry = prompt JSON only.** Each collection item stores just `import_json`.
  Shared settings are taken from current editor state at generate time.
- **Persistence = localStorage** (matches the LoRA library pattern; no server
  changes).
- **Add sources:** Gallery cards, Editor (JSON header), and Paste-in-tab.
- **Generation flow:** reuse the existing queue. Results land in the Gallery
  as normal via `image:ready`.

## Architecture

One new module, one new event, one small queue export. No `state.js` changes —
collections are a user library that never feeds a generation snapshot, so the
data stays module-local (same shape as `lora.js`'s `activeIds`).

### New module: `src/collections.js`

Owns: localStorage data, the **Collections** tab DOM, CRUD, generation.
Follows `lora.js` pattern (owns DOM + data, wired in `app.js`, sibling comms
via events only).

### New event

| Event | Payload | Emitted by | Consumed by |
|-------|---------|-----------|-------------|
| `collection:add` | `{ importJson }` | gallery (card button), editor (JSON header button) | collections |

### Queue change

Add export `enqueueImportJson(importJson)` to `queue.js` — identical to
`enqueue()` but accepts a prebuilt prompt string, so collection prompts don't
clobber the editor's `json-output` textarea. Snapshot (size/preset/workflow/
LoRAs/seed) is still built from current state.

## Data model (localStorage)

```
ideogram_collections = [{ id, name, items: [{ id, importJson }] }]
ideogram_active_collection = <id>
```

## Collections tab UI

- **Header:** collection `<select>` (switch active) + `＋ New` + rename + delete.
- **Paste box:** textarea + "Add" → adds raw JSON to active collection.
- **Items list:** row shows derived label (from `high_level_description` or
  first box desc, else truncated JSON); click = load to editor; `×` = remove.
- **Footer:** `Generate Collection (N)` → enqueues all N via
  `enqueueImportJson`, switches to Editor tab so the queue panel shows,
  toasts "Queued N jobs".

## Add flow

All three sources emit `collection:add` and add to the **active collection**
(set in the Collections tab). collections.js toasts `"Added to '<name>'"` for
feedback; if no collection exists it toasts `"Create a collection first"`.

## Generation flow

`Generate Collection` → for each item: `enqueueImportJson(item.importJson)`
→ queue builds a snapshot from current state with that prompt → sequential
generation → `image:ready` → Gallery. Zero new generation code.

## Files touched

- `src/collections.js` — new
- `src/queue.js` — add `enqueueImportJson` export
- `src/gallery.js` — add per-card "Add to collection" button emitting event
- `src/app.js` — wire `initCollections`, new tab button, editor add button
- `index.html` — new tab button, new `tab-collections` panel, editor JSON
  header add button, CSS for collection rows
- `CLAUDE.md` — add module to Module Map + event to Event Catalog
