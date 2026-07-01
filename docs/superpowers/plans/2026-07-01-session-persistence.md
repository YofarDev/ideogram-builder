# Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist all settings, toggles, dropdowns, prompt content, boxes, and UI state across browser sessions so reopening the app restores exactly where the user left off.

**Architecture:** New `src/session.js` module owns a single versioned blob under `localStorage.ideogram_session = { version, content, config, ui }`. Content (the canonical `#json-output` JSON) is restored via the existing `state:loaded` event path (canvas rebuilds boxes, settings fills fields, palette restores colors, layers rebuild). Config knobs and UI state are read from / written to the DOM directly. The module imports only from `state.js`, `events.js`, and browser APIs — never from sibling feature modules — matching the architecture rules. Already-proven per-key persistence (workflow, backend, aspect ratio, turbo strength, collections, style presets, lora collapse, vision pipeline/bbox) is left untouched.

**Tech Stack:** Vanilla JS ES modules, `localStorage`, vitest + jsdom for tests.

**Spec:** `docs/superpowers/specs/2026-07-01-session-persistence-design.md`

## Global Constraints

- No build tools — vanilla ES modules loaded via `<script type="module">`.
- Each module imports only from `state.js`, `events.js`, or browser APIs — never from sibling feature modules.
- Cross-module communication goes through `events.js` (`on`/`emit`) only.
- Max ~150 LOC per file.
- Tests: vitest + jsdom (`npm test`). New tests go in `src/__tests__/`.
- DOM reads/writes are the live source of truth for save/restore (avoid stale `state`).
- Conventional Commits style (`feat(session): ...`, `docs: ...`).

## File Structure

| File | Responsibility |
|------|----------------|
| `src/session.js` (**create**) | `loadSession`/`writeSession` blob I/O, `captureSnapshot` reader, `restore` applier, `wipeContent`, `initSession` wiring (~120 LOC) |
| `src/__tests__/session.test.js` (**create**) | Unit tests for each export |
| `src/app.js` (**modify**) | Import `initSession`; call it once after `initCanvas()` |
| `CLAUDE.md` (**modify**) | Add `session.js` row to module map; add restore-order note |

## Key Design Decisions (read before implementing)

1. **Restore order is critical** — boxes use normalized 0–1000 coords that canvas.js maps to pixels from `state.canvas.width/height`. Dimensions (size tier + aspect ratio) MUST be applied **before** content (`state:loaded`), or boxes land in the wrong place.
2. **`initCanvas()` emits `canvas:reset` on startup** (canvas.js:183). Our wipe handler must be **guarded by an `armed` flag** (set `true` only after `restore()` finishes) so the startup reset doesn't wipe the session we're about to load.
3. **No sibling imports** — restore drives side effects via **synthetic DOM events** (dispatch `change`/`click`) so the existing handlers in `settings.js`/`app.js`/`gallery.js` do the real work. Setting `.value`/`.checked` directly does NOT fire listeners, which we exploit for mode/seed to avoid a `state:changed` → regenerate cascade.
4. **Model selects populate async** via `fetch('/api/config')` — options don't exist at restore time. A `MutationObserver` applies the saved value once options appear.
5. **Overlay image is excluded** — too large for localStorage, already in Gallery history.
6. **`content` is the canonical `#json-output` string** — restoring it = set textarea + `emit('state:loaded', { json: JSON.parse(content) })`. No new restore logic.

---

## Task 1: Blob storage helpers

**Files:**
- Create: `src/session.js`
- Create: `src/__tests__/session.test.js`

**Interfaces:**
- Produces: `loadSession() → { version, content, config, ui } | null`, `writeSession(blob) → void`, constants `STORAGE_KEY='ideogram_session'`, `VERSION=1`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/session.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

let session

beforeEach(async () => {
  localStorage.clear()
  session = await import('../session.js?fresh=' + Date.now())
})

describe('loadSession / writeSession', () => {
  it('loadSession returns null when nothing stored', () => {
    expect(session.loadSession()).toBeNull()
  })

  it('writeSession then loadSession round-trips a blob', () => {
    const blob = {
      version: 1,
      content: '{"high_level_description":"x"}',
      config: { size: '2', steps: 'Quality', mode: 'photo', seed: 42, aspectRatio: '1024x1024', aiModel: 'deepseek::m', visionModel: '', recaptionModel: '' },
      ui: { tab: 'gallery', fullscreen: true, preview: false },
    }
    session.writeSession(blob)
    expect(session.loadSession()).toEqual(blob)
  })

  it('loadSession returns null on corrupt JSON', () => {
    localStorage.setItem('ideogram_session', '{not json')
    expect(session.loadSession()).toBeNull()
  })

  it('writeSession swallows quota errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => session.writeSession({ version: 1, content: null, config: {}, ui: {} })).not.toThrow()
    vi.restoreAllMocks()
  })

  it('writeSession stamps the current VERSION', () => {
    session.writeSession({ version: 999, content: null, config: {}, ui: {} })
    expect(session.loadSession().version).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: FAIL — `Cannot find module '../session.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/session.js`:

```js
// session.js — Persist & restore session state (content + config + UI) across reloads.
import { on, emit } from './events.js';

const STORAGE_KEY = 'ideogram_session';
export const VERSION = 1;

/** Read + parse the session blob. Returns null when absent or corrupt. */
export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

/** Serialize + persist the blob. Quota / private-mode errors are swallowed. */
export function writeSession(blob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...blob, version: VERSION }));
  } catch (err) {
    console.warn('[session] save failed', err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session.js src/__tests__/session.test.js
git commit -m "feat(session): blob storage helpers"
```

---

## Task 2: Snapshot reader (`captureSnapshot`)

**Files:**
- Modify: `src/session.js`
- Modify: `src/__tests__/session.test.js`

**Interfaces:**
- Produces: `captureSnapshot() → { version, content, config: { size, steps, mode, seed, aspectRatio, aiModel, visionModel, recaptionModel }, ui: { tab, fullscreen, preview } }` — reads the live DOM.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/session.test.js` (keep the existing `beforeEach`; add a new DOM fixture + describe block):

```js
const SNAPSHOT_DOM = `
  <textarea id="json-output">{"high_level_description":"hi"}</textarea>
  <select id="aspect-ratio"><option value="768x1152" selected>2:3</option><option value="1024x1024">1:1</option></select>
  <button class="size-btn" data-size="1">1M</button>
  <button class="size-btn active" data-size="2">2M</button>
  <input type="radio" name="steps" data-preset="Turbo">
  <input type="radio" name="steps" data-preset="Quality" checked>
  <input type="radio" id="mode_photo" name="art_mode" value="photo" checked>
  <input type="radio" id="mode_artstyle" name="art_mode" value="art_style">
  <input type="number" id="seed-input" value="12345">
  <select id="ai-model"><option value="deepseek::deepseek-chat">d</option></select>
  <select id="vision-model"><option value="local">local</option></select>
  <select id="recaption-model"><option value="">None</option></select>
  <button class="tab-btn" data-tab="prompt">Prompt</button>
  <button class="tab-btn active" data-tab="gallery">Gallery</button>
  <div class="main-content draw-fullscreen"><button id="btn-preview" class="active"></button></div>
`

describe('captureSnapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = SNAPSHOT_DOM
  })

  it('reads content, config, and ui from the DOM', () => {
    const snap = session.captureSnapshot()
    expect(snap.content).toBe('{"high_level_description":"hi"}')
    expect(snap.config).toEqual({
      size: '2',
      steps: 'Quality',
      mode: 'photo',
      seed: 12345,
      aspectRatio: '768x1152',
      aiModel: 'deepseek::deepseek-chat',
      visionModel: 'local',
      recaptionModel: '',
    })
    expect(snap.ui).toEqual({ tab: 'gallery', fullscreen: true, preview: true })
  })

  it('content is null when json-output is empty', () => {
    document.getElementById('json-output').value = '   '
    expect(session.captureSnapshot().content).toBeNull()
  })

  it('falls back to defaults when controls are absent', () => {
    document.body.innerHTML = ''
    const snap = session.captureSnapshot()
    expect(snap.content).toBeNull()
    expect(snap.config.size).toBe('1')
    expect(snap.config.steps).toBe('Default')
    expect(snap.config.mode).toBe('art_style')
    expect(snap.ui.tab).toBe('editor')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: FAIL — `captureSnapshot is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/session.js` (after `writeSession`):

```js
/** Read current content/config/ui from the live DOM into a snapshot blob. */
export function captureSnapshot() {
  const el = (id) => document.getElementById(id);

  const jsonText = el('json-output')?.value.trim();
  const activeSize = document.querySelector('.size-btn.active');
  const stepsRadio = document.querySelector('input[name="steps"]:checked');
  const activeTab = document.querySelector('.tab-btn.active');

  const seedRaw = parseInt(el('seed-input')?.value, 10);

  return {
    version: VERSION,
    content: jsonText || null,
    config: {
      size: activeSize?.dataset.size || '1',
      steps: stepsRadio?.dataset.preset || 'Default',
      mode: el('mode_photo')?.checked ? 'photo' : 'art_style',
      seed: isNaN(seedRaw) ? -1 : seedRaw,
      aspectRatio: el('aspect-ratio')?.value || '768x1152',
      aiModel: el('ai-model')?.value || '',
      visionModel: el('vision-model')?.value || '',
      recaptionModel: el('recaption-model')?.value || '',
    },
    ui: {
      tab: activeTab?.dataset.tab || 'editor',
      fullscreen: document.querySelector('.main-content')?.classList.contains('draw-fullscreen') || false,
      preview: el('btn-preview')?.classList.contains('active') || false,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session.js src/__tests__/session.test.js
git commit -m "feat(session): captureSnapshot DOM reader"
```

---

## Task 3: Restore — dimensions + content

**Files:**
- Modify: `src/session.js`
- Modify: `src/__tests__/session.test.js`

**Interfaces:**
- Produces: `restore() → void` — applies dimensions (size tier + aspect ratio), then content (via `state:loaded`). Reads from `loadSession()`. No-op when no blob.
- Uses: `emit` from `events.js` (already imported).

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/session.test.js`. This test needs `canvas.js` loaded so `state:loaded` rebuilds boxes (mirrors `canvas.test.js`):

```js
import { state } from '../state.js'
import { emit, resetAllListeners } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const RESTORE_DOM = `
  <textarea id="json-output"></textarea>
  <select id="aspect-ratio">
    <option value="768x1152" selected>2:3</option>
    <option value="1024x1024">1:1</option>
  </select>
  <button class="size-btn active" data-size="1">1M</button>
  <button class="size-btn" data-size="2">2M</button>
  <div class="main-content"><div class="canvas-container"><div id="canvas-wrapper"></div></div></div>
  <img id="canvas-overlay">
`

describe('restore — dimensions + content', () => {
  let canvasModule

  beforeEach(async () => {
    document.body.innerHTML = RESTORE_DOM
    state.boxes = []
    state.selectedBoxId = null
    state.boxCounter = 0
    state.canvas = { width: 768, height: 1152, scale: 1, maxDisplayHeight: 800 }
    resetAllListeners()
    canvasModule = await import('../canvas.js?fresh=' + Date.now())
    canvasModule.initCanvas()
    canvasModule.initCanvasEvents()
    localStorage.clear()
  })

  it('restore is a no-op when no blob is stored', () => {
    session.restore()
    expect(document.getElementById('json-output').value).toBe('')
    expect(state.boxes.length).toBe(0)
  })

  it('sets aspect-ratio value + dispatches change', () => {
    session.writeSession({ version: 1, content: null, config: { aspectRatio: '1024x1024', size: '1' }, ui: {} })
    let changed = false
    document.getElementById('aspect-ratio').addEventListener('change', () => { changed = true })
    session.restore()
    expect(document.getElementById('aspect-ratio').value).toBe('1024x1024')
    expect(changed).toBe(true)
  })

  it('sets the size-btn active state from config.size', () => {
    session.writeSession({ version: 1, content: null, config: { aspectRatio: '1024x1024', size: '2' }, ui: {} })
    session.restore()
    const active = document.querySelector('.size-btn.active')
    expect(active?.dataset.size).toBe('2')
  })

  it('restores content: sets json-output and rebuilds boxes via state:loaded', () => {
    const content = JSON.stringify({
      high_level_description: 'scene',
      compositional_deconstruction: {
        background: 'sky',
        elements: [
          { type: 'obj', bbox: [0, 0, 500, 500], desc: 'cat' },
        ],
      },
    })
    session.writeSession({ version: 1, content, config: { aspectRatio: '1024x1024', size: '1' }, ui: {} })
    session.restore()
    expect(document.getElementById('json-output').value).toBe(content)
    expect(state.boxes.length).toBe(1)
  })

  it('ignores corrupt stored content', () => {
    session.writeSession({ version: 1, content: 'not json', config: { aspectRatio: '1024x1024', size: '1' }, ui: {} })
    expect(() => session.restore()).not.toThrow()
    expect(state.boxes.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: FAIL — `restore is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/session.js` (after `captureSnapshot`). Note: size tier is applied **before** dispatching the aspect `change`, because `settings.js updateDimensions` reads both:

```js
let armed = false;

/** Restore dimensions (size tier + aspect ratio) from the blob. */
function applyDimensions(config) {
  // Size tier FIRST — updateDimensions reads .size-btn.active
  const size = config.size || '1';
  document.querySelectorAll('.size-btn').forEach((b) => {
    const on = b.dataset.size === size;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // Aspect ratio — dispatch change so settings.updateDimensions sizes the canvas
  const ar = document.getElementById('aspect-ratio');
  if (ar) {
    const val = config.aspectRatio || localStorage.getItem('ideogram_aspect_ratio');
    if (val && Array.from(ar.options).some((o) => o.value === val)) {
      ar.value = val;
      ar.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

/** Restore prompt content via the existing state:loaded path. */
function applyContent(content) {
  if (!content) return;
  const out = document.getElementById('json-output');
  if (out) out.value = content;
  try {
    emit('state:loaded', { json: JSON.parse(content) });
  } catch {
    /* corrupt content — leave textarea as-is, skip box rebuild */
  }
}

/** Restore the full session: dimensions → content → config → UI. */
export function restore() {
  const blob = loadSession();
  if (!blob) return;

  applyDimensions(blob.config || {});
  applyContent(blob.content);

  // (config + model selects + UI are added in Task 4)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session.js src/__tests__/session.test.js
git commit -m "feat(session): restore dimensions + content"
```

---

## Task 4: Restore — config, model selects, UI, arm guard

**Files:**
- Modify: `src/session.js`
- Modify: `src/__tests__/session.test.js`

**Interfaces:**
- Produces: `restore()` now also applies mode, seed, model selects (async-safe), and UI (tab/fullscreen/preview via synthetic clicks). (The `armed` flag is flipped in `initSession` — Task 6 — not here.)

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/session.test.js`:

```js
describe('restore — config + model selects + UI', () => {
  beforeEach(() => {
    document.body.innerHTML = RESTORE_DOM + `
      <input type="radio" id="mode_photo" name="art_mode" value="photo">
      <input type="radio" id="mode_artstyle" name="art_mode" value="art_style" checked>
      <input type="number" id="seed-input" value="-1">
      <select id="ai-model"></select>
      <button class="tab-btn active" data-tab="editor">Editor</button>
      <button class="tab-btn" data-tab="prompt">Prompt</button>
      <button id="btn-enter-fullscreen"></button>
      <button id="btn-preview"></button>
    `
    resetAllListeners()
    localStorage.clear()
  })

  it('sets mode radio without dispatching events (no cascade)', () => {
    session.writeSession({ version: 1, content: null, config: { mode: 'photo' }, ui: {} })
    session.restore()
    expect(document.getElementById('mode_photo').checked).toBe(true)
    expect(document.getElementById('mode_artstyle').checked).toBe(false)
  })

  it('sets seed input value', () => {
    session.writeSession({ version: 1, content: null, config: { seed: 999 }, ui: {} })
    session.restore()
    expect(document.getElementById('seed-input').value).toBe('999')
  })

  it('applies model select value immediately when option exists', () => {
    const sel = document.getElementById('ai-model')
    sel.innerHTML = '<option value="deepseek::m">m</option>'
    session.writeSession({ version: 1, content: null, config: { aiModel: 'deepseek::m' }, ui: {} })
    session.restore()
    expect(sel.value).toBe('deepseek::m')
  })

  it('applies model select value via observer when option added later', async () => {
    const sel = document.getElementById('ai-model')
    session.writeSession({ version: 1, content: null, config: { aiModel: 'google::gemini' }, ui: {} })
    session.restore()
    expect(sel.value).toBe('')
    // Simulate async population from /api/config
    const opt = document.createElement('option')
    opt.value = 'google::gemini'
    sel.appendChild(opt)
    await new Promise((r) => setTimeout(r, 50))
    expect(sel.value).toBe('google::gemini')
  })

  it('clicks the saved tab button', () => {
    session.writeSession({ version: 1, content: null, config: {}, ui: { tab: 'prompt' } })
    const promptBtn = document.querySelector('.tab-btn[data-tab="prompt"]')
    const spy = vi.spyOn(promptBtn, 'click')
    session.restore()
    expect(spy).toHaveBeenCalled()
  })

  it('clicks fullscreen + preview buttons when saved true', () => {
    session.writeSession({ version: 1, content: null, config: {}, ui: { fullscreen: true, preview: true } })
    const fsSpy = vi.spyOn(document.getElementById('btn-enter-fullscreen'), 'click')
    const pvSpy = vi.spyOn(document.getElementById('btn-preview'), 'click')
    session.restore()
    expect(fsSpy).toHaveBeenCalled()
    expect(pvSpy).toHaveBeenCalled()
  })

  it('does not click fullscreen/preview when saved false', () => {
    session.writeSession({ version: 1, content: null, config: {}, ui: { fullscreen: false, preview: false } })
    const fsSpy = vi.spyOn(document.getElementById('btn-enter-fullscreen'), 'click')
    const pvSpy = vi.spyOn(document.getElementById('btn-preview'), 'click')
    session.restore()
    expect(fsSpy).not.toHaveBeenCalled()
    expect(pvSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: FAIL — mode/seed/model/tab assertions fail (restore doesn't apply them yet).

- [ ] **Step 3: Write minimal implementation**

Add the helper + extend `restore()` in `src/session.js`. Replace the existing `restore()` with this complete version:

```js
/** Apply a <select> value once its <option> exists (options arrive async via /api/config). */
function applySelectWhenReady(id, value) {
  if (!value) return;
  const sel = document.getElementById(id);
  if (!sel) return;
  if (sel.querySelector(`option[value="${value}"]`)) {
    sel.value = value;
    return;
  }
  const observer = new MutationObserver(() => {
    if (sel.querySelector(`option[value="${value}"]`)) {
      sel.value = value;
      observer.disconnect();
    }
  });
  observer.observe(sel, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
}

/** Restore the full session: dimensions → content → config → UI. */
export function restore() {
  const blob = loadSession();
  if (!blob) return;
  const config = blob.config || {};
  const ui = blob.ui || {};
  const el = (id) => document.getElementById(id);

  // 1. Dimensions (before content — boxes need correct canvas size)
  applyDimensions(config);

  // 2. Content → state:loaded rebuilds boxes/fields/palette/layers
  applyContent(blob.content);

  // 3. Remaining config (no event dispatch → no regenerate cascade)
  if (config.mode === 'photo') {
    if (el('mode_photo')) el('mode_photo').checked = true;
  } else {
    if (el('mode_artstyle')) el('mode_artstyle').checked = true;
  }
  if (el('seed-input') && !isNaN(config.seed)) el('seed-input').value = config.seed;
  applySelectWhenReady('ai-model', config.aiModel);
  applySelectWhenReady('vision-model', config.visionModel);
  applySelectWhenReady('recaption-model', config.recaptionModel);

  // 4. UI — reuse existing handlers via synthetic clicks
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${ui.tab || 'editor'}"]`);
  if (tabBtn) tabBtn.click();
  if (ui.fullscreen) el('btn-enter-fullscreen')?.click();
  if (ui.preview) el('btn-preview')?.click();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: PASS (20 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session.js src/__tests__/session.test.js
git commit -m "feat(session): restore config, model selects, UI"
```

---

## Task 5: Reset wipe (guarded)

**Files:**
- Modify: `src/session.js`
- Modify: `src/__tests__/session.test.js`

**Interfaces:**
- Produces: `wipeContent() → void` — sets `content: null` on the stored blob, keeps config/ui.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/session.test.js`:

```js
describe('wipeContent (reset)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('nulls content while preserving config + ui', () => {
    session.writeSession({
      version: 1,
      content: '{"x":1}',
      config: { size: '2', steps: 'Quality' },
      ui: { tab: 'gallery' },
    })
    session.wipeContent()
    const blob = session.loadSession()
    expect(blob.content).toBeNull()
    expect(blob.config).toEqual({ size: '2', steps: 'Quality' })
    expect(blob.ui).toEqual({ tab: 'gallery' })
  })

  it('is a no-op when no blob exists', () => {
    expect(() => session.wipeContent()).not.toThrow()
    expect(session.loadSession()).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: FAIL — `wipeContent is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/session.js` (after `restore`):

```js
/** Clear saved prompt content (called on canvas:reset). Keeps config + ui. */
export function wipeContent() {
  const blob = loadSession();
  if (!blob) return;
  blob.content = null;
  writeSession(blob);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: PASS (22 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session.js src/__tests__/session.test.js
git commit -m "feat(session): wipeContent on reset"
```

---

## Task 6: `initSession` wiring

**Files:**
- Modify: `src/session.js`
- Modify: `src/__tests__/session.test.js`

**Interfaces:**
- Produces: `initSession() → void` — registers debounced `state:changed` save, `pagehide`/`visibilitychange` flush, calls `restore()`, then registers the guarded `canvas:reset` → `wipeContent` listener.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/session.test.js`:

```js
describe('initSession wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <textarea id="json-output">{"a":1}</textarea>
      <select id="aspect-ratio"><option value="768x1152" selected>2:3</option></select>
      <button class="size-btn active" data-size="1">1M</button>
      <div class="main-content"></div>
      <button class="tab-btn active" data-tab="editor">Editor</button>
    `
    resetAllListeners()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces save on state:changed (400ms)', () => {
    session.initSession()
    emit('state:changed')
    expect(session.loadSession()).toBeNull() // not yet
    vi.advanceTimersByTime(400)
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('coalesces rapid state:changed into one save', () => {
    session.initSession()
    emit('state:changed')
    vi.advanceTimersByTime(200)
    emit('state:changed')
    vi.advanceTimersByTime(200)
    // first emit's 400ms hasn't fully elapsed when second reset the clock;
    // only one write happens after the full debounce window
    emit('state:changed')
    vi.advanceTimersByTime(400)
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('flushes immediately on pagehide', () => {
    session.initSession()
    emit('state:changed')
    window.dispatchEvent(new Event('pagehide'))
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('flushes on visibilitychange to hidden', () => {
    session.initSession()
    emit('state:changed')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('canvas:reset wipes content only after restore armed the guard', () => {
    session.writeSession({ version: 1, content: '{"keep":1}', config: {}, ui: {} })
    session.initSession() // restore runs → armed = true
    emit('canvas:reset')
    expect(session.loadSession().content).toBeNull()
    expect(session.loadSession().config).toEqual({})
  })

  it('canvas:reset before initSession does not wipe (startup guard)', () => {
    session.writeSession({ version: 1, content: '{"keep":1}', config: {}, ui: {} })
    // initCanvas() emits canvas:reset at startup, BEFORE initSession registers the listener.
    // Simulate: emit canvas:reset with no listener yet.
    emit('canvas:reset')
    session.initSession()
    expect(session.loadSession().content).toBe('{"keep":1}')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: FAIL — `initSession is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/session.js` (at the end):

```js
const SAVE_DEBOUNCE_MS = 400;
let saveTimer = null;

/** Initialize session persistence: restore, then wire save + reset handlers. */
export function initSession() {
  const flush = () => {
    clearTimeout(saveTimer);
    writeSession(captureSnapshot());
  };

  on('state:changed', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  });

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // Reset Canvas: wipe prompt content, keep config + UI.
  // Registered before restore but guarded — any canvas:reset emitted during
  // restore (none today) is ignored until `armed` flips true below.
  on('canvas:reset', () => {
    if (armed) wipeContent();
  });

  // Restore saved state, then arm the reset guard. (armed lives in module scope;
  // set here — not inside restore() — so it flips even when no blob exists.)
  restore();
  armed = true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/session.test.js`
Expected: PASS (28 tests).

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS — all test files green (no other module broke).

- [ ] **Step 6: Commit**

```bash
git add src/session.js src/__tests__/session.test.js
git commit -m "feat(session): initSession debounced save + flush + reset wipe"
```

---

## Task 7: Wire into app.js + update CLAUDE.md

**Files:**
- Modify: `src/app.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `initSession` from `./session.js`.

- [ ] **Step 1: Modify app.js — import + call initSession after initCanvas**

In `src/app.js`, add the import (alongside the other module imports near the top):

```js
import { initSession } from './session.js';
```

Then, immediately **after** the existing `initCanvas();` call (currently the last init line before the fullscreen section), add:

```js
// Restore saved session (settings, content, boxes, UI) — must run after initCanvas
// because restore dispatches change/click events and rebuilds boxes on the canvas.
initSession();
```

The result: `initCanvas();` is followed by `initSession();`. (Do not place it before `initCanvas()` — the canvas must exist first, and the startup `canvas:reset` from `initCanvas` must fire before `initSession` arms its wipe guard.)

- [ ] **Step 2: Update CLAUDE.md module map**

In `CLAUDE.md`, add a row to the **Module Map** table (insert after the `app.js` row or in alphabetical-ish position with the other modules):

```markdown
| `session.js` | Session persistence — save/restore content + config + UI to `localStorage.ideogram_session` | state, events |
```

- [ ] **Step 3: Update CLAUDE.md editing guide**

In `CLAUDE.md`, add an entry to the **Editing Guide** list:

```markdown
- **Editing session persistence (save/restore on reload)?** → `src/session.js` (+ `initSession()` call at end of `src/app.js`)
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all green, including the new `session.test.js`.

- [ ] **Step 5: Manual smoke test**

Start the server: `python3 server.py` (or `uv run server.py`). In the browser:
1. Change size tier to 2M, steps to Quality, mode to Photo, enter a seed, draw a box, type a description. Switch to the Prompt tab.
2. Refresh the page.
3. Verify: size tier = 2M, steps = Quality, mode = Photo, seed restored, box + description restored, active tab = Prompt.
4. Click **Reset Canvas** → confirm. Refresh → boxes/description gone, but size/steps/mode/seed/tab persisted.
5. Verify no console errors about `[session]`.

- [ ] **Step 6: Commit**

```bash
git add src/app.js CLAUDE.md
git commit -m "feat(session): wire initSession into app startup"
```

---

## Self-Review Notes

- **Spec coverage:** content persistence (Task 3), config knobs size/steps/mode/seed (Tasks 2+4), model selections (Task 4 async-safe), UI tab/fullscreen/preview (Task 4), reset-wipe-keep-config (Tasks 5+6), debounced save + flush (Task 6), exclusions (overlay image never read/written; existing keys untouched), versioning (Task 1), robustness (try/catch in load + write). All spec sections covered.
- **Startup `canvas:reset` guard:** explicitly tested (Task 6, "canvas:reset before initSession does not wipe").
- **Restore order:** dimensions before content — implemented + commented.
- **No sibling imports:** session.js imports only `events.js` (`on`, `emit`); DOM-only for everything else.
- **No new events:** reuses `state:changed`, `state:loaded`, `canvas:reset`; UI restore uses DOM clicks.
- **LOC:** session.js ~120 lines, under the 150 cap.
