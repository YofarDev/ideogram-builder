# Collections Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Collections tab as a first-class surface: chip navigation, inline-renamable header, a responsive grid of live-preview cards with expandable per-item detail + actions, and export/import — all in the app's warm-dark editorial aesthetic.

**Architecture:** Vanilla JS, no build tools. Pure bbox→rect math + canvas drawing live in a new DOM-free helper (`collections-preview.js`, node-testable); all DOM/data/events stay in `collections.js`. No new events — reuses `state:loaded` for "Load into Editor". No backend — export/import are pure client Blob/file-reader. localStorage keys unchanged.

**Tech Stack:** Vanilla ES modules, Canvas 2D, existing CSS variables (`--accent`, `--surface`, `--font-display`, etc.), existing `.btn` classes.

**Design doc:** `docs/plans/2026-06-26-collections-redesign-design.md`

**Testing note:** This repo has no JS test runner (no build tools). The plan uses **manual browser verification** for UI, plus **one Node self-check** for the pure preview math (the only non-trivial logic). Run the app with `python3 server.py`.

**Key facts (verified):**
- bbox format is `[y1, x1, y2, x2]` in 0–1000 space — see `src/canvas.js:418` (`x: bbox[1], y: bbox[0], w: bbox[3]-bbox[1], h: bbox[2]-bbox[0]`) and `src/json-builder.js:129`.
- `state:loaded { json }` is consumed by canvas, json-builder, layers, palette, settings, style-presets → "Load into Editor" fully rebuilds the editor.
- `enqueueImportJson(importJson)` enqueues a single job.
- `app.js:32` calls `initCollections()` — keep that export.
- Tab switch via `document.getElementById('tab-btn-editor')?.click()`.

---

### Task 1: Create the pure preview helper + Node self-check

**Files:**
- Create: `src/collections-preview.js`
- Test: `src/collections-preview.js` (inline `// @check` self-check, run via `node --input-type=module`)

**Step 1: Write `src/collections-preview.js`**

```js
// collections-preview.js — pure bbox→rect math + canvas preview drawing for collections.
// No DOM at module top-level so the math is unit-checkable in node.

// bbox = [y1, x1, y2, x2] in 0-1000 space (matches canvas.js:418 / json-builder.js:129).
// Returns one rect per element, scaled to `size` (px). Defensive min/max per axis.
export function elementsToRects(elements, size = 1000) {
  if (!Array.isArray(elements)) return [];
  const out = [];
  elements.forEach((el, i) => {
    const b = el && el.bbox;
    if (!Array.isArray(b) || b.length < 4) return;
    const x1 = b[1], y1 = b[0], x2 = b[3], y2 = b[2];
    const left = Math.min(x1, x2), right = Math.max(x1, x2);
    const top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    out.push({
      idx: i,
      type: el.type,
      desc: el.desc,
      colors: Array.isArray(el.color_palette) ? el.color_palette : [],
      text: el.text,
      x: left / 1000 * size,
      y: top / 1000 * size,
      w: (right - left) / 1000 * size,
      h: (bottom - top) / 1000 * size,
    });
  });
  return out;
}

// Draw element rects onto a 2D context. Needs a real canvas (browser only).
// styles is optional; defaults read CSS variables at call time.
export function drawPreview(canvas, elements, size) {
  if (!canvas || !canvas.getContext) return;
  const dpr = window.devicePixelRatio || 1;
  const px = size;
  canvas.width = px * dpr;
  canvas.height = px * dpr;
  canvas.style.width = px + 'px';
  canvas.style.height = px + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, px, px);

  const cs = getComputedStyle(canvas);
  const bg = cs.getPropertyValue('--surface-2').trim() || '#1c1c1c';
  const stroke = cs.getPropertyValue('--accent').trim() || '#caa56a';
  const label = cs.getPropertyValue('--text').trim() || '#eee';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);

  const rects = elementsToRects(elements, px);
  if (rects.length === 0) {
    ctx.fillStyle = cs.getPropertyValue('--text-faint').trim() || '#555';
    ctx.font = '11px ' + (cs.getPropertyValue('--font-body').trim() || 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('no layout', px / 2, px / 2);
    return;
  }

  rects.forEach((r) => {
    const fill = (r.colors[0] || stroke);
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    ctx.globalAlpha = 1;
    ctx.fillStyle = label;
    ctx.font = 'bold 10px ' + (cs.getPropertyValue('--font-body').trim() || 'sans-serif');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(r.idx + 1), r.x + 4, r.y + 3);
  });
}

// --- Node self-check (ponytail: one runnable check for the non-trivial math) ---
if (typeof window === 'undefined') {
  const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };
  const els = [{ bbox: [100, 150, 700, 500], color_palette: ['#aaa'] }];
  const r = elementsToRects(els, 200);
  assert(r.length === 1, 'one rect');
  assert(r[0].x === 30 && r[0].y === 20, `scaled x/y got ${r[0].x},${r[0].y}`); // 150/1000*200=30, 100/1000*200=20
  assert(r[0].w === 70 && r[0].h === 120, `scaled w/h got ${r[0].w},${r[0].h}`); // (500-150)/1000*200=70,(700-100)/1000*200=120
  assert(r[0].idx === 0 && r[0].colors[0] === '#aaa', 'metadata carried');
  assert(elementsToRects([], 100).length === 0, 'empty');
  assert(elementsToRects([{ bbox: [1, 2, 3] }], 100).length === 0, 'short bbox dropped');
  // inverted bbox defends via min/max
  const inv = elementsToRects([{ bbox: [700, 500, 100, 150] }], 1000)[0];
  assert(inv.x === 150 && inv.w === 350, 'inverted bbox normalized');
  console.log('collections-preview self-check: OK');
}
```

**Step 2: Run the self-check**

Run: `node --input-type=module -e "import('./src/collections-preview.js')"`
Expected output: `collections-preview self-check: OK`

**Step 3: Commit**

```bash
git add src/collections-preview.js
git commit -m "feat(collections): pure preview math + canvas drawing helper"
```

---

### Task 2: Replace the collections HTML markup

**Files:**
- Modify: `index.html` (the `#tab-collections` → `#collection-container` block, currently lines ~2699–2719)

**Step 1: Replace the block**

Replace everything from `<div id="collection-container">` through its closing `</div>` (before `</div>` of `#tab-collections`) with:

```html
<div id="collection-container">
    <div class="coll-top">
        <div class="coll-chips" id="collection-chips" role="tablist" aria-label="Collections"></div>
        <div class="coll-head-actions">
            <input type="file" id="collection-import-input" accept=".json,application/json" hidden>
            <button id="btn-collection-import" class="coll-icon-btn" title="Import collection" aria-label="Import collection">&#8593;&#8657;</button>
            <button id="btn-collection-export" class="coll-icon-btn" title="Export collection" aria-label="Export collection">&#8595;&#8651;</button>
            <button id="btn-collection-delete" class="coll-icon-btn danger" title="Delete collection" aria-label="Delete collection">&times;</button>
        </div>
    </div>
    <header class="coll-header">
        <h2 class="coll-title" id="collection-title" title="Click to rename">No collection</h2>
        <input id="collection-title-edit" class="coll-title-input" maxlength="60" hidden>
        <div class="coll-meta" id="collection-meta">0 prompts</div>
    </header>
    <div class="coll-paste">
        <label class="sr-only" for="collection-paste">Paste prompt JSON</label>
        <textarea id="collection-paste" rows="2" placeholder="Paste prompt JSON here, then Add…"></textarea>
        <button id="btn-collection-paste-add" class="btn btn-secondary">Add</button>
    </div>
    <div class="coll-grid" id="collection-grid"></div>
    <div class="coll-footer">
        <button id="btn-collection-generate" class="btn btn-primary btn-block">Generate Collection</button>
    </div>
</div>
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat(collections): new header/chips/grid markup"
```

---

### Task 3: Rewrite the collections CSS

**Files:**
- Modify: `index.html` — replace the existing `/* Collections tab */ … .collection-footer .btn[disabled]` block (currently lines ~724–823) with the block below. Keep `#tab-collections.active { display:block; flex:1; min-height:0; overflow-y:auto; }`.

**Step 1: Replace the collections CSS block**

```css
/* Collections tab */
#tab-collections.active {
    display: block;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.coll-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
}

.coll-chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 4px;
    flex: 1;
    min-width: 0;
    scrollbar-width: thin;
}

.coll-chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    font-family: var(--font-body);
    font-size: 12px;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    transition: color .15s, background .15s, border-color .15s;
}
.coll-chip:hover { color: var(--text); border-color: var(--hairline-hover); }
.coll-chip.active {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
}
.coll-chip-count {
    font-size: 10px;
    opacity: .7;
    font-variant-numeric: tabular-nums;
}
.coll-chip-new {
    color: var(--accent);
    border-style: dashed;
    font-size: 14px;
    line-height: 1;
}

.coll-head-actions { display: flex; gap: 4px; flex: 0 0 auto; }
.coll-icon-btn {
    width: 30px; height: 30px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 15px;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color .15s, border-color .15s;
}
.coll-icon-btn:hover { color: var(--text); border-color: var(--hairline-hover); }
.coll-icon-btn.danger:hover { color: var(--danger); }
.coll-icon-btn[disabled] { opacity: .4; cursor: not-allowed; }

.coll-header { margin-bottom: 16px; }
.coll-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1.1;
    color: var(--text);
    cursor: text;
    letter-spacing: .2px;
}
.coll-title-input {
    width: 100%;
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1.1;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    outline: none;
}
.coll-meta {
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: .3px;
    text-transform: lowercase;
}

.coll-paste {
    display: flex;
    gap: 8px;
    align-items: stretch;
    margin-bottom: 14px;
}
.coll-paste textarea {
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
.coll-paste textarea:focus { border-color: var(--accent); }

.coll-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
    align-items: start;
}

.coll-empty {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px 16px;
    color: var(--text-dim);
    font-style: italic;
    font-size: 12px;
}

.coll-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    cursor: pointer;
    transition: transform .15s, border-color .15s, box-shadow .15s;
}
.coll-card:hover {
    border-color: var(--hairline-hover);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px -10px var(--accent-glow);
}
.coll-card.expanded {
    grid-column: 1 / -1;
    cursor: default;
    border-color: var(--accent);
    transform: none;
}

.coll-card-head { position: relative; }
.coll-preview {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    height: auto;
    background: var(--surface-2);
}
.coll-card-chevron {
    position: absolute;
    top: 6px; right: 6px;
    width: 22px; height: 22px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px;
    color: var(--text);
    background: oklch(14.5% 0.008 75 / 0.6);
    border: 1px solid var(--border);
    border-radius: 999px;
    cursor: pointer;
    backdrop-filter: blur(4px);
}

.coll-card-body { padding: 9px 10px 11px; }
.coll-card-title {
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--text);
    font-weight: 500;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.7em;
}
.coll-card-meta {
    margin-top: 7px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
}
.coll-chip-meta {
    font-size: 10px;
    color: var(--text-dim);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 7px;
    text-transform: lowercase;
}
.coll-palette { display: inline-flex; gap: 3px; }
.coll-swatch {
    width: 11px; height: 11px;
    border-radius: 3px;
    border: 1px solid oklch(0% 0 0 / 0.25);
    display: inline-block;
}
.coll-swatch.sm { width: 9px; height: 9px; }

/* Expanded detail */
.coll-detail {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    gap: 18px;
    padding: 16px;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
}
@media (max-width: 640px) {
    .coll-detail { grid-template-columns: 1fr; }
    .coll-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
}
.coll-detail-side { min-width: 0; }
.coll-detail-hld {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
}
.coll-detail-row {
    display: flex;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--hairline);
    font-size: 11.5px;
}
.coll-detail-k {
    flex: 0 0 80px;
    color: var(--text-dim);
    text-transform: capitalize;
}
.coll-detail-v { color: var(--text-muted); min-width: 0; }
.coll-detail-empty { color: var(--text-faint); font-style: italic; font-size: 11.5px; padding: 4px 0; }

.coll-detail-main { min-width: 0; }
.coll-detail-subhead {
    font-family: var(--font-display);
    font-size: 13px;
    color: var(--accent);
    margin-bottom: 8px;
}
.coll-el-list { list-style: none; margin: 0 0 14px; padding: 0; }
.coll-el {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--hairline);
    font-size: 11.5px;
}
.coll-el-idx {
    flex: 0 0 18px;
    width: 18px; height: 18px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 600;
    color: var(--accent);
    background: var(--accent-dim);
    border-radius: 4px;
}
.coll-el-type {
    flex: 0 0 auto;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: .4px;
    color: var(--text-dim);
}
.coll-el-desc {
    flex: 1; min-width: 0;
    color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.coll-el-geo { flex: 0 0 auto; font-size: 10px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.coll-el-pal { display: inline-flex; gap: 3px; flex: 0 0 auto; }

.coll-actions { display: flex; flex-wrap: wrap; gap: 6px; }

.coll-footer { position: sticky; bottom: 0; }
.coll-footer .btn[disabled] { opacity: .5; cursor: not-allowed; }
```

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat(collections): editorial card-grid + chip styles"
```

---

### Task 4: Rewrite `collections.js` data + render

**Files:**
- Modify: `src/collections.js` (full rewrite; keep `initCollections` export)

**Step 1: Replace the entire file with:**

```js
// collections.js — Prompt collections (localStorage), Collections tab DOM, batch generation.
// Owns its data (module-local). Sibling comms via events only.

import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { enqueueImportJson } from './queue.js';
import { drawPreview } from './collections-preview.js';

const LS_COLLECTIONS = 'ideogram_collections';
const LS_ACTIVE = 'ideogram_active_collection';

let collections = [];
let activeId = null;
let expandedId = null;

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

// ponytail: load on import so a fresh module instance reads persisted state;
// initCollections() re-calls load() (idempotent) then binds + renders.
load();

export function getAll() { return collections; }
export function getActive() { return collections.find(c => c.id === activeId) || null; }

export function labelFor(importJson) {
  const p = parsePrompt(importJson);
  if (p.high_level_description) return p.high_level_description;
  const el = p.compositional_deconstruction?.elements?.[0];
  if (el?.desc) return el.desc;
  if (p.compositional_deconstruction?.background) return p.compositional_deconstruction.background;
  return (importJson || '').slice(0, 60);
}

function parsePrompt(importJson) {
  try { return JSON.parse(importJson) || {}; }
  catch { return {}; }
}

export function createCollection(name) {
  const c = { id: uid(), name: (name || 'Untitled').slice(0, 60), items: [], createdAt: Date.now() };
  collections.unshift(c);
  activeId = c.id;
  expandedId = null;
  save();
  render();
  return c;
}

export function setActive(id) {
  if (collections.find(c => c.id === id)) { activeId = id; expandedId = null; save(); render(); }
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
  expandedId = null;
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
  if (expandedId === itemId) expandedId = null;
  save();
  render();
}

export function duplicateItem(itemId) {
  const c = getActive();
  if (!c) return;
  const i = c.items.findIndex(it => it.id === itemId);
  if (i === -1) return;
  c.items.splice(i + 1, 0, { id: uid(), importJson: c.items[i].importJson });
  save();
  render();
}

function generateItem(itemId) {
  const it = getActive()?.items.find(i => i.id === itemId);
  if (!it) return;
  enqueueImportJson(it.importJson);
  showToast('Queued this prompt.', 'success');
}

function loadItemToEditor(itemId) {
  const it = getActive()?.items.find(i => i.id === itemId);
  if (!it) return;
  const json = parsePrompt(it.importJson);
  if (!json.high_level_description && !json.compositional_deconstruction) {
    showToast('This prompt has no loadable structure.', 'error');
    return;
  }
  emit('state:loaded', { json });
  document.getElementById('tab-btn-editor')?.click();
}

export function generateCollection() {
  const c = getActive();
  if (!c || c.items.length === 0) { showToast('Collection is empty.', 'error'); return; }
  c.items.forEach(i => enqueueImportJson(i.importJson));
  showToast(`Queued ${c.items.length} jobs from "${c.name}".`, 'success');
}

// --- Export / Import (pure client) ---

function exportActive() {
  const c = getActive();
  if (!c || c.items.length === 0) return;
  const payload = { name: c.name, exportedAt: new Date().toISOString(), items: c.items.map(i => ({ importJson: i.importJson })) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importCollection(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const items = Array.isArray(data.items)
        ? data.items.filter(i => i.importJson).map(i => ({ id: uid(), importJson: i.importJson }))
        : [];
      if (!items.length) { showToast('No prompts found in file.', 'error'); return; }
      const c = { id: uid(), name: (data.name || 'Imported').slice(0, 60), items, createdAt: Date.now() };
      collections.unshift(c);
      activeId = c.id;
      expandedId = null;
      save();
      render();
      showToast(`Imported "${c.name}" (${items.length}).`, 'success');
    } catch { showToast('Could not read that file.', 'error'); }
  };
  reader.readAsText(file);
}

// --- render ---

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function paletteDots(els) {
  const colors = [];
  els.forEach(el => (el.color_palette || []).forEach(col => { if (colors.length < 6 && !colors.includes(col)) colors.push(col); }));
  if (!colors.length) return '';
  return `<span class="coll-palette">${colors.map(col => `<span class="coll-swatch" style="background:${escapeHtml(col)}"></span>`).join('')}</span>`;
}

function render() {
  if (!document.getElementById('collection-container')) return;
  renderChips();
  renderHeader();
  renderItems();
  const btn = document.getElementById('btn-collection-generate');
  const c = getActive();
  if (btn) btn.disabled = !c || c.items.length === 0;
}

function renderChips() {
  const wrap = document.getElementById('collection-chips');
  if (!wrap) return;
  wrap.innerHTML = collections.map(c =>
    `<button class="coll-chip${c.id === activeId ? ' active' : ''}" data-chip="${c.id}" role="tab" aria-selected="${c.id === activeId}">${escapeHtml(c.name)}<span class="coll-chip-count">${c.items.length}</span></button>`
  ).join('') + `<button class="coll-chip coll-chip-new" id="coll-chip-new" title="New collection" aria-label="New collection">+</button>`;
}

function renderHeader() {
  const c = getActive();
  const titleEl = document.getElementById('collection-title');
  const metaEl = document.getElementById('collection-meta');
  if (titleEl) titleEl.textContent = c?.name ?? 'No collection';
  if (metaEl) {
    const n = c?.items.length ?? 0;
    const parts = [`${n} prompt${n === 1 ? '' : 's'}`];
    if (c?.createdAt) parts.push('edited ' + relTime(c.createdAt));
    metaEl.textContent = parts.join(' · ');
  }
  const del = document.getElementById('btn-collection-delete');
  const exp = document.getElementById('btn-collection-export');
  if (del) del.disabled = !c;
  if (exp) exp.disabled = !c || c.items.length === 0;
}

function renderItems() {
  const grid = document.getElementById('collection-grid');
  if (!grid) return;
  const c = getActive();
  if (!c || c.items.length === 0) {
    grid.innerHTML = `<div class="coll-empty">No prompts yet. Add from the Gallery, the Editor JSON panel, or paste below.</div>`;
    return;
  }
  grid.innerHTML = c.items.map(item => {
    const p = parsePrompt(item.importJson);
    const els = p.compositional_deconstruction?.elements || [];
    const title = p.high_level_description || labelFor(item.importJson);
    const mode = els[0]?.type || '—';
    const open = item.id === expandedId;
    return `
      <article class="coll-card${open ? ' expanded' : ''}" data-card="${item.id}">
        <div class="coll-card-head">
          <canvas class="coll-preview" width="160" height="160" aria-hidden="true"></canvas>
          <button class="coll-card-chevron" data-toggle aria-label="${open ? 'Collapse' : 'Expand details'}">${open ? '\u25BE' : '\u25B8'}</button>
        </div>
        <div class="coll-card-body">
          <div class="coll-card-title">${escapeHtml(title)}</div>
          <div class="coll-card-meta">
            <span class="coll-chip-meta">${els.length} box${els.length === 1 ? '' : 'es'}</span>
            <span class="coll-chip-meta">${escapeHtml(mode)}</span>
            ${paletteDots(els)}
          </div>
        </div>
        ${open ? renderDetail(item, p, els) : ''}
      </article>`;
  }).join('');

  c.items.forEach(item => {
    const canvas = grid.querySelector(`.coll-card[data-card="${item.id}"] .coll-preview`);
    if (canvas) drawPreview(canvas, parsePrompt(item.importJson).compositional_deconstruction?.elements || [], 160);
  });
}

function renderDetail(item, p, els) {
  const s = p.style_description || {};
  const bg = p.compositional_deconstruction?.background || '';
  const rows = [
    s.aesthetics && ['Aesthetics', s.aesthetics],
    s.lighting && ['Lighting', s.lighting],
    s.medium && ['Medium', s.medium],
    s.art_style && ['Art style', s.art_style],
    s.photo && ['Photo', s.photo],
    bg && ['Background', bg],
  ].filter(Boolean);
  const styleHtml = rows.length
    ? rows.map(([k, v]) => `<div class="coll-detail-row"><span class="coll-detail-k">${k}</span><span class="coll-detail-v">${escapeHtml(v)}</span></div>`).join('')
    : `<div class="coll-detail-empty">No style metadata.</div>`;
  const elList = els.length ? els.map((el, i) => {
    const b = el.bbox || [];
    const geo = b.length === 4 ? `x ${Math.round(b[1] / 10)}% · y ${Math.round(b[0] / 10)}%` : '';
    const dots = (el.color_palette || []).slice(0, 5).map(col => `<span class="coll-swatch sm" style="background:${escapeHtml(col)}"></span>`).join('');
    return `<li class="coll-el"><span class="coll-el-idx">${i + 1}</span><span class="coll-el-type">${escapeHtml(el.type || 'obj')}</span><span class="coll-el-desc">${escapeHtml(el.desc || '')}</span><span class="coll-el-geo">${geo}</span>${dots ? `<span class="coll-el-pal">${dots}</span>` : ''}</li>`;
  }).join('') : `<li class="coll-detail-empty">No elements.</li>`;

  return `
    <div class="coll-detail">
      <div class="coll-detail-side">
        ${p.high_level_description ? `<p class="coll-detail-hld">${escapeHtml(p.high_level_description)}</p>` : ''}
        <div class="coll-detail-style">${styleHtml}</div>
      </div>
      <div class="coll-detail-main">
        <div class="coll-detail-subhead">Elements</div>
        <ul class="coll-el-list">${elList}</ul>
        <div class="coll-actions">
          <button class="btn btn-primary" data-act="generate" data-id="${item.id}">Generate this one</button>
          <button class="btn btn-secondary" data-act="load" data-id="${item.id}">Load into Editor</button>
          <button class="btn btn-ghost" data-act="dup" data-id="${item.id}">Duplicate</button>
          <button class="btn btn-danger" data-act="remove" data-id="${item.id}">Remove</button>
        </div>
      </div>
    </div>`;
}

// --- bind ---

function bind() {
  const root = document.getElementById('collection-container');
  if (!root || root.dataset.bound) return;
  root.dataset.bound = '1';

  // chips: switch + new
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) { setActive(chip.dataset.chip); return; }
    if (e.target.closest('#coll-chip-new')) { createCollection('Collection ' + (collections.length + 1)); return; }

    // card expand toggle (click card body or chevron, but not action buttons)
    const act = e.target.closest('[data-act]');
    if (act) {
      const id = act.dataset.id;
      if (act.dataset.act === 'generate') generateItem(id);
      else if (act.dataset.act === 'load') loadItemToEditor(id);
      else if (act.dataset.act === 'dup') duplicateItem(id);
      else if (act.dataset.act === 'remove') removeItem(id);
      return;
    }
    const card = e.target.closest('[data-card]');
    if (card) {
      const id = card.dataset.card;
      expandedId = (expandedId === id) ? null : id;
      render();
    }
  });

  // header inline rename
  const titleEl = document.getElementById('collection-title');
  const titleEdit = document.getElementById('collection-title-edit');
  const commitRename = () => {
    titleEdit.hidden = true;
    titleEl.hidden = false;
    renameActive(titleEdit.value.trim() || getActive()?.name || 'Untitled');
  };
  titleEl?.addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    titleEdit.value = c.name;
    titleEl.hidden = true;
    titleEdit.hidden = false;
    titleEdit.focus();
    titleEdit.select();
  });
  titleEdit?.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { titleEdit.hidden = true; titleEl.hidden = false; } });
  titleEdit?.addEventListener('blur', commitRename);

  // import / export / delete
  document.getElementById('btn-collection-delete')?.addEventListener('click', () => {
    const c = getActive();
    if (c && confirm(`Delete collection "${c.name}"? This cannot be undone.`)) deleteActive();
  });
  document.getElementById('btn-collection-export')?.addEventListener('click', exportActive);
  const importInput = document.getElementById('collection-import-input');
  document.getElementById('btn-collection-import')?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => { if (importInput.files[0]) importCollection(importInput.files[0]); importInput.value = ''; });

  // paste-add
  document.getElementById('btn-collection-paste-add')?.addEventListener('click', () => {
    const ta = document.getElementById('collection-paste');
    const c = addItem(ta.value);
    if (c) { ta.value = ''; showToast(`Added to "${c.name}".`, 'success'); }
    else showToast('Create a collection first.', 'error');
  });

  // generate collection -> editor
  document.getElementById('btn-collection-generate')?.addEventListener('click', () => {
    generateCollection();
    document.getElementById('tab-btn-editor')?.click();
  });

  // editor JSON panel "add to collection"
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

**Step 2: Commit**

```bash
git add src/collections.js
git commit -m "feat(collections): chips, inline rename, preview cards, expand, export/import"
```

---

### Task 5: Verify end-to-end (manual)

**Step 1: Run the math self-check**

Run: `node --input-type=module -e "import('./src/collections-preview.js')"`
Expected: `collections-preview self-check: OK`

**Step 2: Run the app**

Run: `python3 server.py`, open the served URL.

**Step 3: Manual checks (Collections tab)**

- [ ] Chips row shows existing collections; active one is gold; `+` chip creates a new one.
- [ ] Clicking the DM Serif title turns it into an editable input; Enter/blur saves; Escape cancels.
- [ ] Meta line shows `N prompts · edited …`.
- [ ] Cards render with a **live preview canvas** showing numbered boxes in distinct colors; titles/meta/palette dots show.
- [ ] Hover lifts the card with a gold glow; chevron toggles.
- [ ] Clicking a card expands it full-width: full description, style rows, element list with bbox %, and 4 action buttons.
- [ ] **Generate this one** → toast "Queued this prompt" + job appears in queue.
- [ ] **Load into Editor** → editor tab opens, boxes/form/palette/layers populate from the prompt.
- [ ] **Duplicate** → a copy appears immediately after the source.
- [ ] **Remove** → item disappears; if it was expanded, grid collapses back.
- [ ] Paste-Add still works; Editor JSON panel `+` button still adds.
- [ ] **Export** downloads `<name>.json`; **Import** of that file recreates the collection.
- [ ] Delete (with confirm) removes the active collection and falls back to another.
- [ ] No console errors; layout is responsive (narrow the window).

**Step 3: Commit any fixups, then done**

```bash
git add -A
git commit -m "fix(collections): verification fixups"
```

---

## Done criteria
- All manual checks pass, no console errors.
- Node self-check prints OK.
- `collections.js` ≤ ~200 LOC, `collections-preview.js` pure + tested.
- No new events added; `initCollections` export preserved; `app.js` untouched.
