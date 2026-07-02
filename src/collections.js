// collections.js — Actions layer: bindings, init, file export/import, re-exports.
// Wires data (collections-data) to UI (collections-ui) and external events.

import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { render } from './collections-ui.js';
import {
  collections, activeId, expandedId, editingId,
  getAll, getActive, parsePrompt, labelFor,
  uid, load, save, setExpandedId, setEditingId,
  createCollection, setActive, renameActive, deleteActive,
  addItem, removeItem, duplicateItem,
  extractTokens, resolveTokens,
} from './collections-data.js';

export { getAll, getActive, labelFor, createCollection, setActive, renameActive, deleteActive, addItem, removeItem, duplicateItem };

function saveEdit(itemId) {
  const c = getActive();
  const it = c?.items.find(i => i.id === itemId);
  if (!it) return;
  const ta = document.querySelector(`.coll-card[data-card="${itemId}"] .coll-edit-textarea`);
  if (!ta) return;
  const val = ta.value;
  try { JSON.parse(val); }
  catch { showToast('Invalid JSON \u2014 fix syntax before saving.', 'error'); return; }
  it.importJson = val;
  setEditingId(null);
  save();
  emit('collection:data-changed');
  showToast('Prompt updated.', 'success');
}

export function generateItem(itemId) {
  const it = getActive()?.items.find(i => i.id === itemId);
  if (!it) return;
  emit('queue:enqueue', { importJson: resolveTokens(itemId, it.importJson) });
  showToast('Queued this prompt.', 'success');
}

export function loadItemToEditor(itemId) {
  const it = getActive()?.items.find(i => i.id === itemId);
  if (!it) return;
  const resolved = resolveTokens(itemId, it.importJson);
  const json = parsePrompt(resolved);
  if (!json.high_level_description && !json.compositional_deconstruction) {
    showToast('This prompt has no loadable structure.', 'error');
    return;
  }
  const out = document.getElementById('json-output');
  if (out) out.value = resolved;
  emit('state:loaded', { json });
  document.getElementById('tab-btn-editor')?.click();
  emit('canvas:relayout');
}

export function generateCollection() {
  const c = getActive();
  if (!c || c.items.length === 0) { showToast('Collection is empty.', 'error'); return; }
  c.items.forEach(i => emit('queue:enqueue', { importJson: i.importJson }));
  showToast(`Queued ${c.items.length} jobs from "${c.name}".`, 'success');
}

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
      setExpandedId(null);
      save();
      emit('collection:data-changed');
      showToast(`Imported "${c.name}" (${items.length}).`, 'success');
    } catch { showToast('Could not read that file.', 'error'); }
  };
  reader.readAsText(file);
}

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
      else if (act.dataset.act === 'edit') { setEditingId(id); emit('collection:data-changed'); }
      else if (act.dataset.act === 'save') saveEdit(id);
      else if (act.dataset.act === 'cancel') { setEditingId(null); emit('collection:data-changed'); }
      else if (act.dataset.act === 'dup') duplicateItem(id);
      else if (act.dataset.act === 'remove') removeItem(id);
      return;
    }
    const card = e.target.closest('[data-card]');
    if (card) {
      if (e.target.closest('.coll-tokens') || e.target.closest('.coll-edit')) return;
      const id = card.dataset.card;
      const expanding = expandedId !== id;
      setExpandedId(expanding ? id : null);
      emit('collection:data-changed');
      if (expanding) {
        document.querySelector(`.coll-card[data-card="${id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

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
    if (!c) return;
    const name = c.name;
    if (confirm(`Delete collection "${name}"? This cannot be undone.`)) {
      deleteActive();
      showToast(`Deleted "${name}".`, 'info');
    }
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

  on('collection:add', ({ importJson, imageUrl }) => {
    const c = addItem(importJson, imageUrl);
    if (c) showToast(`Added to "${c.name}".`, 'success');
    else showToast('Create a collection first.', 'error');
  });
}

export function initCollections() {
  load();
  bind();
  on('collection:data-changed', render);
  render();
}
