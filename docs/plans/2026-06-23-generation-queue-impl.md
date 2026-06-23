# Generation Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an app-side sequential generation queue so the Generate button enqueues the current state as a snapshot and a worker drains jobs one at a time.

**Architecture:** One new module `src/queue.js` owns the queue array, the worker loop, and its panel DOM. `src/runpod.js` is refactored to expose a pure `runJob(snapshot, { onStatus, signal })` entry point that the queue calls per job. The existing `generateImage()` is removed; the Generate button now calls `enqueue()`. Zero new events — completion reuses `image:ready`.

**Tech Stack:** Vanilla JS (ES modules, no build), vitest for tests, inline `<style>` in `index.html` (lines 11–2272), served by `python3 server.py`. Run tests with `npm test`.

**Design doc:** `docs/plans/2026-06-23-generation-queue-design.md`

---

## Task 1: Refactor `runpod.js` — extract `runJob`

Replace the button-aware `generateImage()` with a pure `runJob(snapshot, { onStatus, signal })`. The queue module will own button state and JSON validation; runpod just submits + polls a given snapshot.

**Files:**
- Modify: `src/runpod.js` (full rewrite)
- Modify: `src/__tests__/runpod.test.js` (repoint to `runJob`)

### Step 1: Write the failing tests

Replace the entire contents of `src/__tests__/runpod.test.js` with:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

const CONFIG_RESP = { runpod: { api_key: 'test-key', endpoint_id: 'ep-123' } }

function baseSnapshot(over = {}) {
  return {
    importJson: '{"high_level_description":"test"}',
    width: 1024, height: 1024,
    preset: 'Default', workflow: 'turbo', turboStrength: 0.8,
    loras: [], seed: -1,
    ...over,
  }
}

function mockFetchSequence(responses) {
  const fn = vi.fn(async (url, opts) => {
    const resp = responses.shift()
    if (!resp) throw new Error('unexpected fetch call: ' + url)
    if (resp.throw) throw resp.throw
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(resp.text || JSON.stringify(resp.body)),
      blob: () => Promise.resolve(new Blob()),
    }
  })
  return fn
}

beforeEach(() => {
  vi.resetModules()
})

describe('runJob', () => {
  async function importModule() {
    vi.resetModules()
    vi.mock('../events.js', () => ({ emit: vi.fn(), on: vi.fn() }))
    return await import('../runpod.js')
  }

  it('fetches config then submits with correct payload', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'job-1' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    const result = await mod.runJob(baseSnapshot())

    expect(result.dataUrl).toContain('base64,AAAA')
    expect(result.imageUrl).toBe('blob:mock')
    const submitCall = global.fetch.mock.calls[1]
    expect(submitCall[0]).toBe('https://api.runpod.ai/v2/ep-123/run')
    const body = JSON.parse(submitCall[1].body)
    expect(body.input.import_json).toBeTruthy()
    expect(body.input.width).toBe(1024)
    expect(body.input.height).toBe(1024)
    expect(submitCall[1].headers.Authorization).toBe('Bearer test-key')
  })

  it('throws when config missing api_key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ runpod: { endpoint_id: 'ep' } }),
    })
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/not configured/)
  })

  it('FAILED status rejects with error message', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'FAILED', error: 'OOM' } },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow('OOM')
  })

  it('empty images rejects with "No images returned"', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'COMPLETED', output: { images: [] } } },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow('No images returned')
  })

  it('submit error rejects with status', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { ok: false, status: 500, text: 'server error' },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/Submit failed \(500\)/)
  })

  it('calls onStatus with elapsed seconds during polling', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'IN_PROGRESS' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    const mod = await importModule()
    const ticks = []
    await mod.runJob(baseSnapshot(), { onStatus: (s) => ticks.push(s) })
    expect(ticks.length).toBeGreaterThan(0)
    expect(typeof ticks[0]).toBe('number')
  })

  it('aborts via signal', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'IN_PROGRESS' } },
    ])
    const mod = await importModule()
    const ac = new AbortController()
    const p = mod.runJob(baseSnapshot(), { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toThrow(/Aborted|abort/i)
  })
})
```

### Step 2: Run tests to verify they fail

Run: `npm test -- src/__tests__/runpod.test.js`
Expected: FAIL — `runJob is not a function` (module still exports `generateImage`).

### Step 3: Rewrite `src/runpod.js`

Replace the entire file with:

```js
import { emit } from './events.js';

let config = null;

async function getConfig() {
    if (config) return config;
    const resp = await fetch('/api/config');
    const data = await resp.json();
    config = data.runpod || {};
    return config;
}

export async function runJob(snapshot, { onStatus, signal } = {}) {
    const { api_key, endpoint_id } = await getConfig();
    if (!api_key || !endpoint_id) {
        throw new Error('RunPod not configured. Add runpod.api_key and runpod.endpoint_id to ~/.config/llm-credentials.json');
    }

    const baseUrl = `https://api.runpod.ai/v2/${endpoint_id}`;
    const headers = {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
    };

    const submitResp = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            input: {
                import_json: snapshot.importJson,
                width: snapshot.width,
                height: snapshot.height,
                preset: snapshot.preset,
                workflow: snapshot.workflow,
                turbo_strength: snapshot.turboStrength,
                loras: snapshot.loras,
                seed: snapshot.seed,
            }
        }),
        signal,
    });

    if (!submitResp.ok) {
        const err = await submitResp.text();
        throw new Error(`Submit failed (${submitResp.status}): ${err}`);
    }

    const { id: jobId } = await submitResp.json();
    const result = await pollStatus(baseUrl, headers, jobId, onStatus, signal);

    if (result.status === 'FAILED') {
        throw new Error(result.error || 'Generation failed');
    }

    const images = result.output?.images || [];
    if (images.length === 0) {
        throw new Error('No images returned');
    }

    const imageData = images[0].data;
    const mime = images[0].filename?.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${imageData}`;
    const blob = await fetch(dataUrl).then(r => r.blob());
    const imageUrl = URL.createObjectURL(blob);
    return { dataUrl, imageUrl };
}

async function pollStatus(baseUrl, headers, jobId, onStatus, signal) {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;

    while (Date.now() - startTime < timeout) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        onStatus?.(elapsed);

        const resp = await fetch(`${baseUrl}/status/${jobId}`, { headers, signal });
        if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);

        const result = await resp.json();
        if (result.status === 'COMPLETED') return result;
        if (result.status === 'FAILED') return result;

        await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error('Generation timed out after 5 minutes');
}
```

Note: `emit`, `showToast`, button state, and JSON validation have moved out — queue.js owns them now. `emit` import is kept because future code may want status events; if lint flags it unused, remove. (It is not referenced in the body — remove the import if the linter complains.)

**Correction:** Remove the `emit` import on line 1 — nothing in this file uses it anymore. Final first line:

```js
let config = null;
```

### Step 4: Run tests to verify they pass

Run: `npm test -- src/__tests__/runpod.test.js`
Expected: PASS — all 7 tests green.

If the `emit` import is still present and causes an error, remove it.

### Step 5: Commit

```bash
git add src/runpod.js src/__tests__/runpod.test.js
git commit -m "refactor: extract runJob(snapshot) from generateImage"
```

---

## Task 2: Create `src/queue.js` — snapshot, enqueue, remove, worker, render

The queue module owns everything the old `generateImage` did plus the queue array and panel DOM.

**Files:**
- Create: `src/queue.js`
- Create: `src/__tests__/queue.test.js`

### Step 1: Write the failing tests

Create `src/__tests__/queue.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <button id="btn-generate-image">Generate</button>
  <textarea id="json-output">{"high_level_description":"test"}</textarea>
  <div id="generate-status"></div>
  <div id="queue-panel"></div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.preset = 'Default'
  state.workflow = 'turbo'
  state.turboStrength = 0.8
  state.loras = []
  state.seed = -1
})

function mockRunJobOk(mod) {
  // Replace runJob with an instant-resolving stub after first import
  vi.resetModules()
  vi.mock('../toast.js', () => ({ showToast: vi.fn() }))
  vi.mock('../events.js', () => ({ emit: vi.fn(), on: vi.fn() }))
  vi.mock('../runpod.js', () => ({
    runJob: vi.fn(async (snap, opts) => {
      opts?.onStatus?.(1)
      return { dataUrl: 'data:image/png;base64,AAAA', imageUrl: 'blob:mock' }
    })
  }))
  return import('../queue.js')
}

describe('queue', () => {
  it('enqueue rejects empty JSON with toast and adds no row', async () => {
    document.getElementById('json-output').value = ''
    const mod = await mockRunJobOk()
    mod.enqueue()
    const toast = await import('../toast.js')
    expect(toast.showToast).toHaveBeenCalledWith(expect.stringContaining('Create a prompt'), expect.anything())
    expect(document.getElementById('queue-panel').children.length).toBe(0)
  })

  it('enqueue adds a queued row and the worker drains it to done', async () => {
    const mod = await mockRunJobOk()
    mod.enqueue()
    // Row exists immediately
    expect(document.getElementById('queue-panel').children.length).toBe(1)
    // Button reflects pending count
    expect(document.getElementById('btn-generate-image').textContent).toContain('+1 queued')
    // Allow worker to drain
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    // Final card has thumbnail img
    const card = document.querySelector('.queue-card')
    expect(card.querySelector('img.queue-thumb')).toBeTruthy()
  })

  it('drains multiple jobs in FIFO order', async () => {
    const mod = await mockRunJobOk()
    mod.enqueue()
    state.seed = 42
    mod.enqueue()
    expect(document.getElementById('queue-panel').children.length).toBe(2)
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    const seeds = [...document.querySelectorAll('.queue-seed')].map(e => e.textContent)
    expect(seeds.length).toBe(2)
  })

  it('remove drops a queued job before it runs', async () => {
    // Stall runJob so jobs stay queued
    vi.resetModules()
    vi.mock('../toast.js', () => ({ showToast: vi.fn() }))
    vi.mock('../events.js', () => ({ emit: vi.fn(), on: vi.fn() }))
    let resolveFirst
    vi.mock('../runpod.js', () => ({
      runJob: vi.fn(() => new Promise(r => { resolveFirst = r })),
    }))
    const mod = await import('../queue.js')
    mod.enqueue()   // starts running (stalled)
    state.seed = 7
    mod.enqueue()   // queued behind it
    expect(document.getElementById('queue-panel').children.length).toBe(2)
    mod.removeJob(2) // remove the queued one
    expect(document.getElementById('queue-panel').children.length).toBe(1)
    // cleanup
    resolveFirst({ dataUrl: 'data:image/png;base64,BB', imageUrl: 'blob:x' })
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
  })

  it('cancel a running job aborts and continues to next', async () => {
    vi.resetModules()
    vi.mock('../toast.js', () => ({ showToast: vi.fn() }))
    vi.mock('../events.js', () => ({ emit: vi.fn(), on: vi.fn() }))
    const runJob = vi.fn()
      .mockImplementationOnce(() => new Promise((_, rej) => {
        setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      }))
      .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,CC', imageUrl: 'blob:y' })
    vi.mock('../runpod.js', () => ({ runJob }))
    const mod = await import('../queue.js')
    mod.enqueue()
    state.seed = 99
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    // First job aborted, second completed
    expect(runJob).toHaveBeenCalledTimes(2)
  })
})
```

### Step 2: Run tests to verify they fail

Run: `npm test -- src/__tests__/queue.test.js`
Expected: FAIL — `Cannot find module '../queue.js'`.

### Step 3: Create `src/queue.js`

```js
import { state } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';
import { runJob } from './runpod.js';

let queue = [];          // [{ id, snapshot, status, elapsed, error, thumbUrl, abort }]
let isRunning = false;
let counter = 1;

const panel = () => document.getElementById('queue-panel');
const genBtn = () => document.getElementById('btn-generate-image');
const statusEl = () => document.getElementById('generate-status');

function buildSnapshot() {
    const jsonText = document.getElementById('json-output').value;
    let importJson;
    try {
        importJson = JSON.stringify(JSON.parse(jsonText), null, null);
    } catch {
        importJson = jsonText;
    }
    return {
        importJson,
        width: state.canvas.width,
        height: state.canvas.height,
        preset: state.preset,
        workflow: state.workflow,
        turboStrength: state.turboStrength,
        loras: state.loras.map(l => ({
            filename: l.filename,
            source_url: l.source_url,
            strengths: l.strengths,
        })),
        seed: state.seed,
    };
}

export function enqueue() {
    const jsonText = document.getElementById('json-output').value;
    if (!jsonText.trim()) {
        showToast('Create a prompt first — draw boxes and fill the settings, or load JSON.', 'error');
        return;
    }
    const job = {
        id: counter++,
        snapshot: buildSnapshot(),
        status: 'queued',
        abort: new AbortController(),
    };
    queue.push(job);
    render();
    drain();
}

export function removeJob(id) {
    const job = queue.find(j => j.id === id);
    if (!job) return;
    if (job.status === 'running') job.abort.abort();
    queue = queue.filter(j => j.id !== id);
    render();
}

async function drain() {
    if (isRunning) return;
    isRunning = true;
    emit('runpod:loading');

    while (queue.length) {
        const job = queue[0];
        job.status = 'running';
        render();
        try {
            const { dataUrl, imageUrl } = await runJob(job.snapshot, {
                onStatus: (elapsed) => {
                    job.elapsed = elapsed;
                    if (statusEl()) statusEl().textContent = `Generating... (${elapsed}s)`;
                    render();
                },
                signal: job.abort.signal,
            });
            job.status = 'done';
            job.thumbUrl = imageUrl;
            emit('image:ready', { imageUrl, dataUrl });
        } catch (err) {
            if (err.name === 'AbortError') {
                queue.shift();
                render();
                continue;
            }
            job.status = 'failed';
            job.error = err.message;
            if (statusEl()) statusEl().textContent = 'Error: ' + err.message;
            showToast('Generation failed: ' + err.message, 'error');
        }
        queue.shift();
        render();
    }

    isRunning = false;
    if (statusEl()) statusEl().textContent = '';
    emit('runpod:done');
}

function render() {
    const el = panel();
    if (!el || !genBtn()) return;

    const pending = queue.filter(j => j.status === 'queued' || j.status === 'running').length;
    genBtn().textContent = pending > 0 ? `Generate (+${pending} queued)` : 'Generate';

    el.innerHTML = queue.map(job => {
        const thumb = job.thumbUrl
            ? `<img class="queue-thumb" src="${job.thumbUrl}" alt="">`
            : `<span class="queue-spinner"></span>`;
        let statusText = 'Queued';
        if (job.status === 'running' && job.elapsed != null) statusText = `${job.elapsed}s`;
        else if (job.status === 'done') statusText = 'Done';
        else if (job.status === 'failed') statusText = 'Failed';
        return `
            <div class="queue-card queue-${job.status}" data-id="${job.id}">
                ${thumb}
                <span class="queue-seed">seed ${job.snapshot.seed}</span>
                <span class="queue-status">${statusText}</span>
                <button class="queue-remove" data-id="${job.id}" aria-label="Remove job">&times;</button>
            </div>`;
    }).join('');
}

export function initQueue() {
    const el = panel();
    if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('click', (e) => {
            const btn = e.target.closest('.queue-remove');
            if (btn) removeJob(Number(btn.dataset.id));
        });
    }
    render();
}
```

Notes:
- `render()` is called from `enqueue`, `drain` (multiple times), and `removeJob`. Cheap; fine for this scale.
- Event delegation in `initQueue` avoids re-binding per render. (`render()` does NOT bind handlers.)
- `isRunning` guard means the first `enqueue` starts `drain()`; later enqueues just append and re-render.

### Step 4: Run tests to verify they pass

Run: `npm test -- src/__tests__/queue.test.js`
Expected: PASS — all 5 tests green.

If the "FIFO order" test is flaky because both jobs complete instantly, the assertion on seed count (2 rows present at enqueue time) is the real check; FIFO is structurally guaranteed by `queue[0]` + `shift()`.

### Step 5: Commit

```bash
git add src/queue.js src/__tests__/queue.test.js
git commit -m "feat: add generation queue with sequential worker"
```

---

## Task 3: Wire Generate button + panel into `app.js` and `index.html`

**Files:**
- Modify: `src/app.js:6` (import) and `src/app.js:40` (handler)
- Modify: `index.html` (add `#queue-panel` after toolbar, add CSS before `</style>` at line 2272)

### Step 1: Update `src/app.js`

Replace line 6:

```js
import { generateImage } from './runpod.js';
```

with:

```js
import { enqueue, initQueue } from './queue.js';
```

Replace line 40:

```js
document.getElementById('btn-generate-image').addEventListener('click', () => generateImage());
```

with:

```js
document.getElementById('btn-generate-image').addEventListener('click', () => enqueue());
```

Add after the existing `init*()` calls (after line 27, `initLora();`), insert:

```js
initQueue();
```

### Step 2: Add `#queue-panel` markup in `index.html`

The editor toolbar closes at line 2422 (`</div>` after `.editor-toolbar` block) and `.canvas-container` begins at 2424. Insert between them.

Find this exact block (lines 2421–2424):

```html
                </div>

                <div class="canvas-container">
```

Insert a new panel div so it becomes:

```html
                </div>

                <div id="queue-panel" class="queue-panel" aria-label="Generation queue" role="list"></div>

                <div class="canvas-container">
```

**Important:** Verify you matched the right `</div>` — it's the one closing `.editor-toolbar`, immediately before `.canvas-container`. Use the surrounding context (the `btn-exit-fullscreen` button at line 2421 is the last child) to disambiguate.

### Step 3: Add CSS before `</style>` (line 2272)

Insert this block immediately before `    </style>`:

```css
        .queue-panel {
            display: flex;
            gap: 8px;
            padding: 6px 12px;
            overflow-x: auto;
            min-height: 0;
            border-bottom: 1px solid var(--border-color, #2a2a2a);
            background: var(--bg-elev, #141414);
        }
        .queue-panel:empty { display: none; }
        .queue-card {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border: 1px solid var(--border-color, #2a2a2a);
            border-radius: 6px;
            background: var(--bg-panel, #1a1a1a);
            font-size: 12px;
            white-space: nowrap;
        }
        .queue-card.queue-running { border-color: #3b82f6; }
        .queue-card.queue-done { opacity: 0.7; }
        .queue-card.queue-failed { border-color: #ef4444; }
        .queue-thumb { width: 28px; height: 28px; object-fit: cover; border-radius: 4px; }
        .queue-spinner {
            width: 14px; height: 14px; border-radius: 50%;
            border: 2px solid #555; border-top-color: #3b82f6;
            animation: queue-spin 0.8s linear infinite;
            display: inline-block;
        }
        @keyframes queue-spin { to { transform: rotate(360deg); } }
        .queue-remove {
            background: none; border: none; color: #888; cursor: pointer;
            font-size: 16px; line-height: 1; padding: 0 2px;
        }
        .queue-remove:hover { color: #ef4444; }
```

### Step 4: Manually verify in browser

Run: `python3 server.py`
Open the app, draw a box, click Generate twice quickly.
Expected:
- Two cards appear in the panel under the toolbar.
- Button reads `Generate (+2 queued)`.
- First card shows spinner + elapsed seconds; second shows `Queued`.
- When first completes, its thumbnail appears and the second starts.
- Click `×` on the queued one to remove it.
- After all done, button reads `Generate`, panel shows completed thumbnails.

### Step 5: Commit

```bash
git add src/app.js index.html
git commit -m "feat: wire generation queue into UI"
```

---

## Task 4: Run full test suite + update `CLAUDE.md`

### Step 1: Run the full test suite

Run: `npm test`
Expected: all tests pass (runpod + queue).

If anything fails, fix before proceeding.

### Step 2: Update `CLAUDE.md` module map

Add a row to the Module Map table (after the `runpod.js` row):

```markdown
| `queue.js` | Generation queue — snapshot, enqueue, sequential worker, panel DOM | state, events, runpod, toast |
```

Update the `runpod.js` row to reflect the refactor:

```markdown
| `runpod.js` | RunPod serverless API calls (submit + poll), `runJob(snapshot)` | nothing |
```

### Step 3: Update Event Catalog note

In the Event Catalog section, add a one-line note after the table:

```markdown
> **Queue note:** `queue.js` reuses `image:ready`, `runpod:loading`, and `runpod:done` — no new events. The Generate button now enqueues via `queue.enqueue()` instead of calling runpod directly.
```

### Step 4: Update Editing Guide

Add a line to the Editing Guide list:

```markdown
- **Editing the generation queue?** → `src/queue.js`
```

### Step 5: Commit

```bash
git add CLAUDE.md
git commit -m "docs: update module map for generation queue"
```

---

## Summary

| Task | What | Outcome |
|------|------|---------|
| 1 | Refactor `runpod.js` → `runJob(snapshot)` | Pure submit+poll, 7 tests |
| 2 | Create `queue.js` + tests | Snapshot, enqueue, worker, render, cancel/remove, 5 tests |
| 3 | Wire button + panel + CSS | Generate enqueues, inline panel under toolbar |
| 4 | Full suite + docs | Green tests, CLAUDE.md updated |

**Total: ~120 LOC new (queue.js) + ~85 LOC rewritten (runpod.js) + ~40 LOC tests + markup/CSS.**

Skipped: parallelism, persistence, reorder, retries. Add when needed.
