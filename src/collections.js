// collections.js — Actions layer: bindings, init, file export/import, re-exports.
// Wires data (collections-data) to UI (collections-ui) and external events.

import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { state } from './state.js';
import { render } from './collections-ui.js';
import { bindCollectionFiles } from './collections-io.js';
import { saveEdit, cancelEdit, bindCollectionRename } from './collections-edit.js';
import { bindCollectionInteractions } from './collections-interactions.js';
import { detectPromptFormat } from './prompt-convert.js';
import {
  getAll, getActive, labelFor,
  load,
  createCollection, setActive, renameActive, deleteActive,
  addItem, removeItem, duplicateItem,
  resolveTokens, detectModel, missingTokens,
} from './collections-data.js';

export { getAll, getActive, labelFor, createCollection, setActive, renameActive, deleteActive, addItem, removeItem, duplicateItem };

export function generateItem(itemId) {
  const it = getActive()?.items.find(i => i.id === itemId);
  if (!it) return;
  const missing = missingTokens(itemId, it.importJson);
  if (missing.length) { showToast(`Fill the variables before generating: ${missing.join(', ')}.`, 'error'); return; }
  emit('queue:enqueue', { importJson: resolveTokens(itemId, it.importJson), model: detectModel(it) });
  showToast('Queued this prompt.', 'success');
}

export function loadItemToEditor(itemId) {
  const it = getActive()?.items.find(i => i.id === itemId);
  if (!it) return;
  const resolved = resolveTokens(itemId, it.importJson);
  const format = detectPromptFormat(resolved);
  if (format === 'empty' || (format === 'caption' && detectModel(it) !== 'moss')) {
    showToast('This prompt has no loadable structure.', 'error');
    return;
  }
  const out = document.getElementById('json-output');
  if (out) out.value = resolved;
  if (format === 'caption') emit('model:set', { model: 'moss', seed: false });
  emit('prompt:apply', { raw: resolved });
  if (it.imageUrl) emit('image:ready', { imageUrl: it.imageUrl, skipSave: true });
  document.getElementById('tab-btn-editor')?.click();
  emit('canvas:relayout');
}

export function generateCollection() {
  const c = getActive();
  if (!c || c.items.length === 0) { showToast('Collection is empty.', 'error'); return; }
  const missing = [...new Set(c.items.flatMap(item => missingTokens(item.id, item.importJson)))];
  if (missing.length) { showToast(`Fill the variables before generating: ${missing.join(', ')}.`, 'error'); return; }
  c.items.forEach(i => emit('queue:enqueue', { importJson: resolveTokens(i.id, i.importJson), model: detectModel(i) }));
  showToast(`Queued ${c.items.length} jobs from "${c.name}".`, 'success');
}

function bind() {
  const root = document.getElementById('collection-container');
  if (!root || root.dataset.bound) return;
  root.dataset.bound = '1';

  bindCollectionInteractions(root, { generateItem, loadItemToEditor, saveEdit, cancelEdit });

  bindCollectionRename();

  document.getElementById('btn-collection-delete')?.addEventListener('click', () => {
    const c = getActive();
    if (!c) return;
    const name = c.name;
    if (confirm(`Delete collection "${name}"? This cannot be undone.`)) {
      deleteActive();
      showToast(`Deleted "${name}".`, 'info');
    }
  });
  bindCollectionFiles(getActive);

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
    const c = addItem(json, null, state.model);
    if (c) showToast(`Added to "${c.name}".`, 'success');
    else showToast('Create a collection first.', 'error');
  });

  on('collection:add', ({ importJson, imageUrl, model }) => {
    const c = addItem(importJson, imageUrl, model);
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
