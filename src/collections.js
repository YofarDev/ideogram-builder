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

export function generateItem(itemId) {
  const it = getActive()?.items.find(i => i.id === itemId);
  if (!it) return;
  enqueueImportJson(it.importJson);
  showToast('Queued this prompt.', 'success');
}

export function loadItemToEditor(itemId) {
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
  const elChips = els.length ? els.map((el, i) => {
    const b = el.bbox || [];
    const geo = b.length === 4 ? ` · x ${Math.round(b[1] / 10)}% y ${Math.round(b[0] / 10)}%` : '';
    const dots = (el.color_palette || []).slice(0, 4).map(col => `<span class="coll-swatch sm" style="background:${escapeHtml(col)}"></span>`).join('');
    const tip = escapeHtml(`${i + 1}. ${el.type || 'obj'}: ${el.desc || ''}${geo}`);
    return `<span class="coll-el-chip" title="${tip}"><span class="coll-el-idx">${i + 1}</span><span class="coll-el-type">${escapeHtml(el.type || 'obj')}</span>${dots ? `<span class="coll-el-pal">${dots}</span>` : ''}</span>`;
  }).join('') : `<span class="coll-detail-empty">No elements.</span>`;

  return `
    <div class="coll-detail">
      <div class="coll-detail-side">
        ${p.high_level_description ? `<p class="coll-detail-hld">${escapeHtml(p.high_level_description)}</p>` : ''}
        <div class="coll-detail-style">${styleHtml}</div>
      </div>
      <div class="coll-detail-main">
        <div class="coll-detail-subhead">Elements</div>
        <div class="coll-el-chips">${elChips}</div>
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

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) { setActive(chip.dataset.chip); return; }
    if (e.target.closest('#coll-chip-new')) { createCollection('Collection ' + (collections.length + 1)); return; }

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

  document.getElementById('btn-collection-delete')?.addEventListener('click', () => {
    const c = getActive();
    if (c && confirm(`Delete collection "${c.name}"? This cannot be undone.`)) deleteActive();
  });
  document.getElementById('btn-collection-export')?.addEventListener('click', exportActive);
  const importInput = document.getElementById('collection-import-input');
  document.getElementById('btn-collection-import')?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => { if (importInput.files[0]) importCollection(importInput.files[0]); importInput.value = ''; });

  document.getElementById('btn-collection-paste-add')?.addEventListener('click', () => {
    const ta = document.getElementById('collection-paste');
    const c = addItem(ta.value);
    if (c) { ta.value = ''; showToast(`Added to "${c.name}".`, 'success'); }
    else showToast('Create a collection first.', 'error');
  });

  document.getElementById('btn-collection-generate')?.addEventListener('click', () => {
    generateCollection();
    document.getElementById('tab-btn-editor')?.click();
  });

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
