# Prompt Collections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add named collections of saved prompts (new Collections tab) that can be generated in one action using the editor's current settings.

**Architecture:** One new module `src/collections.js` (localStorage-backed, mirrors `lora.js` pattern), one new event `collection:add`, and one small export `enqueueImportJson` added to `queue.js`. No `state.js` changes.

**Tech Stack:** Vanilla ES modules, `vitest` + `jsdom` (already wired), browser `localStorage`.

---

## Baseline note (read before running tests)

`npm test` is currently **RED at baseline** — 9 pre-existing failures in
`src/__tests__/ai-enhancer.test.js` (8) and `src/__tests__/queue.test.js` (1).
These are unrelated test drift, NOT caused by this feature, and are out of scope.

**The verification gate for this plan is:**
1. The NEW tests added by this plan pass, AND
2. The total failure count does **not increase** (baseline = 9 failures).
Run `npm test 2>&1 | tail -3` and confirm `Tests … failed` is ≤ 9.

Do NOT "fix" the pre-existing red tests — that is scope creep.

---

## Task 1: Add `enqueueImportJson` to the queue (TDD)

**Files:**
- Modify: `src/queue.js`
- Test: `src/__tests__/queue.test.js`

**Why:** The existing `enqueue()` reads the prompt from the `#json-output`
textarea. Generating a collection must enqueue many prompts without clobbering
that textarea, so we need a variant that accepts a prompt string directly. It
reuses `buildSnapshot()` (settings come from current state) and the existing
`drain()` worker.

### Step 1: Write the failing test

Add this test inside the existing `describe('queue', ...)` block in
`src/__tests__/queue.test.js` (e.g. after the "enqueue adds a queued row"
test):

```js
  it('enqueueImportJson enqueues a prompt without reading #json-output', async () => {
    document.getElementById('json-output').value = ''  // editor textarea is empty
    const emit = vi.fn()
    const mod = await loadQueue({ emit, runJob: okRunJob() })
    mod.enqueueImportJson('{"high_level_description":"from collection"}')
    expect(document.getElementById('queue-panel').children.length).toBe(1)
    // the queued job's prompt is the passed string, not the empty textarea
    expect(emit).not.toHaveBeenCalled()  // not drained yet synchronously
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(emit).toHaveBeenCalledWith('image:ready', expect.objectContaining({
      importJson: expect.stringContaining('from collection'),
    }))
  })

  it('enqueueImportJson ignores empty/whitespace prompts', async () => {
    const mod = await loadQueue({ runJob: okRunJob() })
    mod.enqueueImportJson('   ')
    expect(document.getElementById('queue-panel').children.length).toBe(0)
  })
```

### Step 2: Run the test to verify it fails

Run: `npm test -- queue 2>&1 | tail -20`
Expected: FAIL — `enqueueImportJson is not a function`.

### Step 3: Implement `enqueueImportJson`

In `src/queue.js`, refactor the job-creation out of `enqueue()` and add the new
export. Replace the existing `enqueue` function (lines ~39-54) with:

```js
function makeJob(importJson) {
  return {
    id: counter++,
    snapshot: { ...buildSnapshot(), importJson },
    status: 'queued',
    abort: new AbortController(),
  };
}

export function enqueue() {
  const jsonText = document.getElementById('json-output').value;
  if (!jsonText.trim()) {
    showToast('Create a prompt first — draw boxes and fill the settings, or load JSON.', 'error');
    return;
  }
  queue.push(makeJob(jsonText));
  render();
  drain();
}

export function enqueueImportJson(importJson) {
  if (!importJson || !importJson.trim()) return;
  queue.push(makeJob(importJson));
  render();
  drain();
}
```

Note `{ ...buildSnapshot(), importJson }` — `buildSnapshot()` already sets
`importJson` from the textarea; the override replaces it with the collection's
prompt. `makeJob` is module-private (not exported) since only the two enqueue
functions need it.

### Step 4: Run the test to verify it passes

Run: `npm test -- queue 2>&1 | tail -8`
Expected: the two new tests PASS. The pre-existing queue failure
("emits image:ready...") is still red — that's baseline, leave it.

### Step 5: Commit

```bash
git add src/queue.js src/__tests__/queue.test.js
git commit -m "feat(queue): add enqueueImportJson for collection generation"
```

---

## Task 2: `collections.js` data layer + CRUD tests (TDD)

**Files:**
- Create: `src/collections.js`
- Test: `src/__tests__/collections.test.js`

**Why:** Build and unit-test the pure-ish data layer (load/save to localStorage,
create collection, add/remove items, label derivation) before any DOM code.

### Step 1: Write the failing tests

Create `src/__tests__/collections.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

const DOM_HTML = `
  <div id="collection-header"></div>
  <select id="collection-select"></select>
  <input id="collection-name">
  <button id="btn-collection-new"></button>
  <button id="btn-collection-rename"></button>
  <button id="btn-collection-delete"></button>
  <div id="collection-items"></div>
  <textarea id="collection-paste"></textarea>
  <button id="btn-collection-paste-add"></button>
  <button id="btn-collection-generate"></button>
  <div id="collection-count"></div>
  <div id="toast-container"></div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  localStorage.clear()
})

async function loadCollections(mocks = {}) {
  vi.resetModules()
  vi.doMock('../events.js', () => ({ emit: mocks.emit ?? vi.fn(), on: mocks.on ?? vi.fn() }))
  vi.doMock('../toast.js', () => ({ showToast: mocks.showToast ?? vi.fn() }))
  vi.doMock('../queue.js', () => ({ enqueueImportJson: mocks.enqueueImportJson ?? vi.fn() }))
  return import('../collections.js')
}

describe('collections data layer', () => {
  it('createCollection adds and activates a new collection, persists to localStorage', async () => {
    const mod = await loadCollections()
    const c = mod.createCollection('Portraits')
    expect(c.name).toBe('Portraits')
    expect(mod.getActive().id).toBe(c.id)
    const stored = JSON.parse(localStorage.getItem('ideogram_collections'))
    expect(stored[0].name).toBe('Portraits')
  })

  it('addItem appends to the active collection with a derived label', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const json = JSON.stringify({ high_level_description: 'A red apple' })
    const c = mod.addItem(json)
    expect(c.items).toHaveLength(1)
    expect(c.items[0].importJson).toBe(json)
    expect(mod.labelFor(json)).toBe('A red apple')
  })

  it('labelFor falls back to first element desc then background then truncation', async () => {
    const mod = await loadCollections()
    expect(mod.labelFor(JSON.stringify({
      compositional_deconstruction: { elements: [{ desc: 'a cat' }] },
    }))).toBe('a cat')
    expect(mod.labelFor(JSON.stringify({
      compositional_deconstruction: { background: 'a field' },
    }))).toBe('a field')
    expect(mod.labelFor('not json at all here')).toBe('not json at all here')
  })

  it('removeItem drops an item by id from the active collection', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const c = mod.addItem('{"high_level_description":"x"}')
    const id = c.items[0].id
    mod.removeItem(id)
    expect(mod.getActive().items).toHaveLength(0)
  })

  it('load restores collections + active id from localStorage on init', async () => {
    const mod = await loadCollections()
    const c = mod.createCollection('Persisted')
    const reloaded = await loadCollections()  // fresh module instance reads localStorage
    expect(reloaded.getAll().some(x => x.id === c.id)).toBe(true)
    expect(reloaded.getActive().id).toBe(c.id)
  })

  it('generateCollection enqueues every item and does nothing if empty', async () => {
    const enqueueImportJson = vi.fn()
    const showToast = vi.fn()
    const mod = await loadCollections({ enqueueImportJson, showToast })
    mod.createCollection('Batch')
    mod.addItem('{"high_level_description":"one"}')
    mod.addItem('{"high_level_description":"two"}')
    mod.generateCollection()
    expect(enqueueImportJson).toHaveBeenCalledTimes(2)
    // empty collection path:
    mod.createCollection('Empty')
    mod.generateCollection()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('empty'), 'error')
  })
})
```

### Step 2: Run the test to verify it fails

Run: `npm test -- collections 2>&1 | tail -15`
Expected: FAIL — module `../collections.js` not found / functions undefined.

### Step 3: Implement `collections.js` (full module)

Create `src/collections.js`. This is the complete module — data layer + DOM +
event wiring — so Tasks 3 and 5 only add HTML IDs and call `initCollections()`.
Keep under ~160 LOC.

```js
// collections.js — Prompt collections (localStorage), Collections tab DOM, batch generation.
// Owns its data (module-local, like lora.js). Sibling comms via events only.

import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { enqueueImportJson } from './queue.js';

const LS_COLLECTIONS = 'ideogram_collections';
const LS_ACTIVE = 'ideogram_active_collection';

let collections = [];
let activeId = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function load() {
  try { collections = JSON.parse(localStorage.getItem(LS_COLLECTIONS)) || []; }
  catch { collections = []; }
  activeId = localStorage.getItem(LS_ACTIVE) || null;
  if (!collections.find(c => c.id === activeId)) activeId = collections[0]?.id ?? null;
}

function save() {
  localStorage.setItem(LS_COLLECTIONS, JSON.stringify(collections));
  if (activeId) localStorage.setItem(LS_ACTIVE, activeId);
}

export function getAll() { return collections; }
export function getActive() { return collections.find(c => c.id === activeId) || null; }

export function labelFor(importJson) {
  try {
    const j = JSON.parse(importJson);
    if (j.high_level_description) return j.high_level_description;
    const el = j.compositional_deconstruction?.elements?.[0];
    if (el?.desc) return el.desc;
    if (j.compositional_deconstruction?.background) return j.compositional_deconstruction.background;
  } catch {}
  return (importJson || '').slice(0, 60);
}

export function createCollection(name) {
  const c = { id: uid(), name: (name || 'Untitled').slice(0, 60), items: [] };
  collections.unshift(c);
  activeId = c.id;
  save();
  render();
  return c;
}

export function setActive(id) {
  if (collections.find(c => c.id === id)) { activeId = id; save(); render(); }
}

export function renameActive(name) {
  const c = getActive();
  if (c) { c.name = (name || 'Untitled').slice(0, 60); save(); render(); }
}

export function deleteActive() {
  const i = collections.findIndex(c => c.id === activeId);
  if (i === -1) return;
  const name = collections[i].name;
  collections.splice(i, 1);
  activeId = collections[0]?.id ?? null;
  save();
  render();
  showToast(`Deleted "${name}".`, 'info');
}

export function addItem(importJson) {
  const c = getActive();
  if (!c) return null;
  if (!importJson || !importJson.trim()) return null;
  c.items.push({ id: uid(), importJson });
  save();
  render();
  return c;
}

export function removeItem(itemId) {
  const c = getActive();
  if (!c) return;
  c.items = c.items.filter(i => i.id !== itemId);
  save();
  render();
}

export function generateCollection() {
  const c = getActive();
  if (!c || c.items.length === 0) {
    showToast('Collection is empty.', 'error');
    return;
  }
  c.items.forEach(i => enqueueImportJson(i.importJson));
  showToast(`Queued ${c.items.length} jobs from "${c.name}".`, 'success');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function render() {
  const sel = document.getElementById('collection-select');
  const itemsEl = document.getElementById('collection-items');
  const countEl = document.getElementById('collection-count');
  const nameInput = document.getElementById('collection-name');
  const genBtn = document.getElementById('btn-collection-generate');
  if (!sel) return; // not on a page with the collections DOM

  sel.innerHTML = collections.map(c =>
    `<option value="${c.id}"${c.id === activeId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('') || `<option value="">No collections</option>`;

  const c = getActive();
  if (nameInput) nameInput.value = c?.name ?? '';
  if (countEl) countEl.textContent = c ? `${c.items.length} prompt${c.items.length === 1 ? '' : 's'}` : '0 prompts';
  if (genBtn) genBtn.disabled = !c || c.items.length === 0;

  if (!itemsEl) return;
  if (!c || c.items.length === 0) {
    itemsEl.innerHTML = `<div class="collections-empty">No prompts yet. Add from the Gallery, the Editor JSON panel, or paste below.</div>`;
    return;
  }
  itemsEl.innerHTML = c.items.map(item => `
    <div class="collection-item" data-id="${item.id}">
      <span class="collection-item-label">${escapeHtml(labelFor(item.importJson))}</span>
      <button class="collection-item-remove" data-id="${item.id}" aria-label="Remove from collection">&times;</button>
    </div>`).join('');
}

function bind() {
  const sel = document.getElementById('collection-select');
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => setActive(sel.value));
  }
  document.getElementById('btn-collection-new')?.addEventListener('click', () => {
    createCollection('Collection ' + (collections.length + 1));
    document.getElementById('collection-name')?.focus();
  });
  document.getElementById('btn-collection-rename')?.addEventListener('click', () => {
    renameActive(document.getElementById('collection-name').value);
  });
  document.getElementById('btn-collection-delete')?.addEventListener('click', () => {
    const c = getActive();
    if (c && confirm(`Delete collection "${c.name}"? This cannot be undone.`)) deleteActive();
  });
  document.getElementById('btn-collection-paste-add')?.addEventListener('click', () => {
    const json = document.getElementById('collection-paste').value;
    const c = addItem(json);
    if (c) { document.getElementById('collection-paste').value = ''; showToast(`Added to "${c.name}".`, 'success'); }
    else showToast('Create a collection first.', 'error');
  });
  const itemsEl = document.getElementById('collection-items');
  if (itemsEl && !itemsEl.dataset.bound) {
    itemsEl.dataset.bound = '1';
    itemsEl.addEventListener('click', (e) => {
      const rm = e.target.closest('.collection-item-remove');
      if (rm) removeItem(rm.dataset.id);
    });
  }
  document.getElementById('btn-collection-generate')?.addEventListener('click', () => {
    generateCollection();
    if (getActive()?.items.length) emit('collection:generated'); // app.js switches to Editor tab
  });
  // Editor "add to collection" button (in the JSON panel header) — owned here
  document.getElementById('btn-add-to-collection')?.addEventListener('click', () => {
    const json = document.getElementById('json-output')?.value;
    const c = addItem(json);
    if (c) showToast(`Added to "${c.name}".`, 'success');
    else showToast('Create a collection first.', 'error');
  });

  on('collection:add', ({ importJson }) => {
    const c = addItem(importJson);
    if (c) showToast(`Added to "${c.name}".`, 'success');
    else showToast('Create a collection first.', 'error');
  });
}

export function initCollections() {
  load();
  bind();
  render();
}
```

### Step 4: Run the tests to verify they pass

Run: `npm test -- collections 2>&1 | tail -10`
Expected: all 6 new tests PASS.

### Step 5: Commit

```bash
git add src/collections.js src/__tests__/collections.test.js
git commit -m "feat(collections): add collections module with data layer and tests"
```

---

## Task 3: Add Collections tab + JSON-panel button + CSS to `index.html`

**Files:**
- Modify: `index.html`

### Step 3a: Add the Collections tab button

In `index.html`, the toolbar tab buttons are at ~line 2357-2360. Add a new
button **after** the Gallery tab button:

```html
<button class="tab-btn" data-tab="collections" role="tab" aria-selected="false" aria-controls="tab-collections" id="tab-btn-collections">Collections</button>
```

### Step 3b: Add the tab panel

The gallery tab panel ends at ~line 2581 (`</div>` closing `#tab-gallery`).
Add a new panel **immediately after** `#tab-gallery`:

```html
<div class="tab-content" id="tab-collections" role="tabpanel" aria-labelledby="tab-btn-collections">
    <div id="collection-container">
        <div class="collection-toolbar">
            <label class="sr-only" for="collection-select">Active collection</label>
            <select id="collection-select" class="ai-model-select"></select>
            <input id="collection-name" class="preset-name-input" placeholder="Collection name" aria-label="Collection name">
            <button id="btn-collection-new" class="btn btn-ghost" title="New collection">+ New</button>
            <button id="btn-collection-rename" class="btn btn-secondary" title="Rename active collection">Rename</button>
            <button id="btn-collection-delete" class="btn btn-danger" title="Delete active collection">Delete</button>
            <span id="collection-count" class="layer-count">0 prompts</span>
        </div>
        <div class="collection-paste-row">
            <label class="sr-only" for="collection-paste">Paste prompt JSON</label>
            <textarea id="collection-paste" rows="2" placeholder="Paste prompt JSON here, then Add…"></textarea>
            <button id="btn-collection-paste-add" class="btn btn-secondary">Add</button>
        </div>
        <div class="collection-items" id="collection-items"></div>
        <div class="collection-footer">
            <button id="btn-collection-generate" class="btn btn-primary btn-block">Generate Collection</button>
        </div>
    </div>
</div>
```

### Step 3c: Add the "Add to collection" button to the Editor JSON panel header

At ~line 2663 the `<div class="json-header-actions">` opens. Add this button as
the **first child** inside it (before `#btn-load-json`):

```html
<button id="btn-add-to-collection" class="json-action-btn" aria-label="Add current prompt to collection" title="Add to collection">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
</button>
```

### Step 3d: Add CSS

Add this block inside the existing `<style>` (a good spot is right after the
`.gallery-card-btn.delete:hover` rule around line 718):

```css
/* Collections tab */
#tab-collections.active {
    display: block;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.collection-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}

.collection-toolbar #collection-select { flex: 0 1 200px; }
.collection-toolbar #collection-name { flex: 1 1 160px; }

.collection-paste-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
    margin-bottom: 12px;
}

.collection-paste-row textarea {
    flex: 1;
    font-family: var(--font-body);
    font-size: 12px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    outline: none;
    resize: vertical;
}

.collection-paste-row textarea:focus { border-color: var(--accent); }

.collection-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
}

.collections-empty {
    text-align: center;
    padding: 32px 16px;
    color: var(--text-dim);
    font-style: italic;
    font-size: 12px;
}

.collection-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
}

.collection-item:hover { border-color: var(--hairline-hover); }

.collection-item-label {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.collection-item-remove {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    line-height: 1;
    border-radius: 3px;
}

.collection-item-remove:hover { color: var(--danger); }

.collection-footer {
    position: sticky;
    bottom: 0;
}

.collection-footer .btn[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
}
```

Also: the existing rule that hides sidebars/workflow toggle on certain tabs
references `.main-content.gallery-active`, `.vision-active`, `.prompt-active`.
Collections is a full-width tab too, so **add `collections-active`** to those
selectors. Find this block (~lines 1700-1718) and add `.collections-active`
next to each `.gallery-active` etc.:

```css
.main-content.collections-active .left-sidebar,
.main-content.collections-active .right-sidebar {
    display: none;
}
body:has(.main-content.collections-active) .workflow-toggle,
body:has(.main-content.collections-active) .backend-toggle {
    display: none;
}
```

### Step 3e: Commit

```bash
git add index.html
git commit -m "feat(ui): add Collections tab, toolbar, paste box, and add-to-collection button"
```

---

## Task 4: Wire `switchTab` layout class + `initCollections` + Gallery emit

**Files:**
- Modify: `src/gallery.js`
- Modify: `src/app.js`

### Step 4a: Make the Collections tab trigger the full-width layout

In `src/gallery.js`, `switchTab()` (lines ~40-52) toggles `.gallery-active` /
`.vision-active` / `.prompt-active` on `.main-content`. Add `collections-active`
in **all three** places it currently sets the others:

1. In the initial-sync block inside `initGallery()` (~line 13-15), add:
   `mc.classList.toggle('collections-active', tab === 'collections');`
2. Inside `switchTab()` (~lines 47-50), add the same line.

Also, so the collections list re-renders when the tab is opened (it may have
changed since last view), add at the bottom of the `if (tab === 'gallery')`
check (~line 51):

```js
    if (tab === 'gallery') renderGallery();
    if (tab === 'collections') window.dispatchEvent(new Event('collections:tab-shown'));
```

(The event is optional polish — `render()` is already called on every mutation,
so the tab is always current. Skip the event unless a stale-render bug shows up.
Default: do NOT add it, keep the diff minimal.)

So the only change in `switchTab` is adding the one `collections-active` line,
and the one line in the `initGallery` initial-sync block. Two lines total in
`gallery.js`.

### Step 4b: Call `initCollections()` from app.js

In `src/app.js`:

1. Add the import with the other module imports (after `initStylePresets` import,
   ~line 14):
   ```js
   import { initCollections } from './collections.js';
   ```
2. Call it in the init block (after `initQueue();` on line 30):
   ```js
   initCollections();
   ```

### Step 4c: Make Gallery cards emit `collection:add`

In `src/gallery.js`, `renderGallery()` builds each card (~lines 87-97). Add an
"Add to collection" button to the `.gallery-card-actions` div, after the delete
button. Update the `innerHTML` actions block:

```js
        card.innerHTML = `
            <img src="/output/${item.img}" alt="" loading="lazy" decoding="async">
            <div class="gallery-card-info">
                <div class="gallery-card-actions">
                    <button class="gallery-card-btn add-collection" title="Add prompt to collection" aria-label="Add prompt to collection"><span aria-hidden="true">+</span></button>
                    <button class="gallery-card-btn download" title="Download image" aria-label="Download image"><span aria-hidden="true">&darr;</span></button>
                    <button class="gallery-card-btn delete" title="Delete" aria-label="Delete"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="gallery-card-date">${dateStr}</div>
                <div class="gallery-card-prompt">${escapeHtml(desc)}</div>
            </div>
        `;
```

Then bind it (after the download/delete bindings, ~line 99-107):

```js
        card.querySelector('.gallery-card-btn.add-collection').addEventListener('click', (e) => {
            e.stopPropagation();
            emit('collection:add', { importJson: item.prompt_json || '' });
        });
```

`gallery.js` already imports `emit` from `./events.js` (line 2), so no new import
needed.

Add a tiny hover style (optional, matches the existing download/delete style).
Add to `index.html` `<style>` near the other `.gallery-card-btn` rules:

```css
.gallery-card-btn.add-collection:hover {
    color: var(--accent);
}
```

### Step 4d: Verify no test regressions

Run: `npm test 2>&1 | tail -3`
Expected: failure count ≤ 9 (baseline). New collections (6) + queue (2) tests
should be passing.

### Step 4e: Commit

```bash
git add src/gallery.js src/app.js index.html
git commit -m "feat: wire Collections tab into gallery and editor"
```

---

## Task 5: Manual browser verification

**Files:** none (verification only)

Start the dev server: `python3 server.py` (per CLAUDE.md). Open the app and
walk through each path. Mark each box.

- [ ] **Collections tab appears** in the toolbar between Gallery and the spacer.
- [ ] Clicking it shows the full-width Collections view (sidebars hidden).
- [ ] **Create:** click "+ New" → a collection appears in the select, count = 0
      prompts, Generate button disabled.
- [ ] **Rename:** type a name, click Rename → select updates.
- [ ] **Paste add:** paste valid prompt JSON into the paste box, click Add →
      a row appears with the `high_level_description` as its label; count = 1;
      Generate enabled.
- [ ] **Add from Editor:** go to Editor, draw a box / set a description, click
      the "+" button in the Prompt JSON panel header → toast "Added to …";
      row appears in Collections tab.
- [ ] **Add from Gallery:** go to Gallery, click "+" on a card → toast
      "Added to …"; row appears in Collections tab.
- [ ] **Remove:** click × on a collection row → row disappears, count updates.
- [ ] **Persistence:** reload the page → the collection and its items survive
      (localStorage).
- [ ] **Generate Collection:** set editor settings (size, Speed preset,
      workflow, optional LoRA, seed). Go to Collections, click "Generate
      Collection" → tab switches to Editor, N jobs appear in the queue panel
      with the correct seeds, they run sequentially, and each result lands in
      the Gallery.
- [ ] **Empty guard:** with an empty active collection, Generate shows the
      "Collection is empty." error toast and enqueues nothing.
- [ ] **Delete:** click Delete + confirm → collection removed, select falls
      back to the next collection (or "No collections").

If anything fails, file it as a follow-up — do not expand scope here.

---

## Task 6: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

Add `collections.js` to the **Module Map** table (after the `lora.js` row):

```
| `collections.js` | Collections tab UI, localStorage CRUD, batch generation | events, queue (enqueueImportJson), toast |
```

Add the new events to the **Event Catalog**:

```
| `collection:add` | `{ importJson }` | gallery (card button), editor (JSON header button) | collections |
| `collection:generated` | none | collections | app (switch to Editor tab) |
```

Note: `collection:generated` is emitted but currently unused by app.js (Task 4
left the tab-switch as a comment, not wired). Either wire it in app.js
(`on('collection:generated', () => switchTab('editor'))` — but `switchTab` is
module-private in gallery.js, so it would need an export) **or** drop the
event entirely and instead have `collections.js` click the Editor tab button
directly: `document.getElementById('tab-btn-editor').click()`. **Recommended
(laziest):** replace the `emit('collection:generated')` line in collections.js
with `document.getElementById('tab-btn-editor')?.click();` and do NOT add the
event to the catalog. Apply this simplification in Task 4 before committing,
then this task only documents `collection:add`.

Update the **Editing Guide** with a pointer:

```
- **Editing prompt collections?** → `src/collections.js` (+ `enqueueImportJson` in `src/queue.js`)
```

### Commit

```bash
git add CLAUDE.md
git commit -m "docs: document collections module and collection:add event"
```

---

## Summary

- 1 new module (`collections.js`, ~155 LOC)
- 1 new queue export (`enqueueImportJson`)
- 1 new event (`collection:add`)
- 8 new tests (6 collections + 2 queue)
- No new dependencies, no server changes, no `state.js` changes
- Reuses the existing queue for generation; results land in the Gallery as normal
