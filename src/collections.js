// collections.js — Prompt collections (localStorage), Collections tab DOM, batch generation.
// Owns its data (module-local, like lora.js). Sibling comms via events only.

import { on } from './events.js';
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

// ponytail: load on import so a fresh module instance reads persisted state;
// initCollections() re-calls load() (idempotent) then binds + renders.
load();

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
    document.getElementById('tab-btn-editor')?.click();
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
