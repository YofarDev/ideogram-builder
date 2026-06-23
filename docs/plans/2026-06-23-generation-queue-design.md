# Generation Queue Design

## Goal

Queue multiple image generations on the app side. Generate button enqueues the current state as a snapshot; a sequential worker processes jobs one at a time. Users keep editing while jobs run, see per-job status inline, and can cancel/remove jobs.

## Decisions

- **Use case**: generic — variations, batch different prompts, keep-working-while-generating.
- **Concurrency**: sequential (one job at a time). Avoids RunPod rate limits and cold-start pile-up.
- **Persistence**: in-memory only. Page refresh clears the queue.
- **Input**: snapshot at enqueue time. Canvas edits after enqueue don't leak into queued jobs.
- **UI**: inline panel under the Generate button, always visible.
- **Controls**: cancel running job, remove queued job. No reorder.
- **Generate button**: always enqueues. No separate "run now" path.

## Architecture

One new module `src/queue.js` owns the queue array, the worker loop, and its panel DOM. `runpod.js` is refactored to expose a pure `runJob(snapshot, { onStatus, signal })` entry point that the queue calls per job. The existing `generateImage()` entry point is removed — the button now calls `enqueue()`.

### Data flow

```
[Generate button] → snapshot state → push {id, snapshot, status:'queued'}
                                     → render row in #queue-panel
                                     ↓
                   worker loop (guarded by isRunning):
                     while queue not empty:
                       shift job → runJob(snapshot, { onStatus, signal })
                         onStatus(elapsed) → update row text
                         AbortController per job (cancel)
                       on success → attach thumb, emit image:ready
                       on error  → mark row failed, continue
```

### Snapshot

Plain object captured at enqueue:

```js
{
  importJson,        // from #json-output, minified
  width, height,     // state.canvas.width / height
  preset, workflow,  // state.preset, state.workflow
  turboStrength,     // state.turboStrength
  loras,             // state.loras mapped to {filename, source_url, strengths}
  seed,              // state.seed
}
```

### Worker

- `isRunning` boolean guard prevents double-start.
- `drain()`: while queue non-empty, shift one job, await `runJob`.
- On start: set row status, disable Generate button, show elapsed.
- On each poll tick from `runJob`'s `onStatus` callback: update that row's elapsed text and the `#generate-status` span.
- On done: attach thumbnail (`<img>` from the result `dataUrl`), fire `image:ready` (reuses existing — canvas overlay + gallery history unchanged), start next.
- On error: mark row failed (red), keep going to next job.

### Events

**Zero new events.** Queue owns its panel DOM directly. Completion reuses the existing `image:ready` event, so canvas overlay and gallery history work unchanged. `runpod:loading` / `runpod:done` still fire around the active job.

## UI

New `<div id="queue-panel">` between the editor toolbar and `.canvas-container`. Compact horizontal strip of cards; scrollable if many. Each card:

- Thumbnail `<img>` (once completed) or spinner otherwise.
- Seed value.
- Status text (`Queued`, `Generating (12s)`, `Failed: …`).
- `[×]` button: cancels if running (AbortController), removes if queued/done/failed.

Generate button label becomes `Generate (+N queued)` when queue non-empty; plain `Generate` when empty. `#generate-status` continues to show the active job's elapsed.

## Error handling

- Snapshot fails (empty/invalid JSON) → reject enqueue with toast, no row added.
- RunPod config missing (`api_key` / `endpoint_id`) → reject enqueue, no row.
- Job submit/poll fails → row turns red with error message, queue continues to next.
- Abort running job → row removed (cancel), queue continues.
- Page refresh → entire queue lost (in-memory by design).

## Testing

- `src/__tests__/runpod.test.js`: repoint from `generateImage` to `runJob(snapshot)` — same coverage (submit ok/bad, poll completed/failed, abort, button state) over the new entry point.
- `src/__tests__/queue.test.js` (new): enqueue adds row; worker drains in FIFO order; cancel removes running job and continues; remove drops a queued job; empty JSON rejects enqueue.

Run via existing test runner (see README / package.json).

## Files touched

| File | Change |
|------|--------|
| `src/queue.js` | NEW — queue array, worker, panel DOM, snapshot, enqueue/cancel/remove |
| `src/runpod.js` | Extract `runJob(snapshot, { onStatus, signal })`; delete `generateImage` |
| `src/app.js` | Repoint `#btn-generate-image` handler to `enqueue()`; init queue panel |
| `index.html` | Add `<div id="queue-panel">`; adjust Generate button label hook |
| `src/__tests__/runpod.test.js` | Repoint tests to `runJob` |
| `src/__tests__/queue.test.js` | NEW — queue behavior |
| `CLAUDE.md` | Module map: add `queue.js`; event catalog: note image:ready reuse |

## Out of scope

- Parallelism / configurable concurrency.
- Persistence across refresh.
- Reorder / drag-and-drop.
- Retries on failure.
- Queueing from the gallery (re-enqueue from history).
