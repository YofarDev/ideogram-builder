// collections-data.js — Data layer: module state, localStorage CRUD, no DOM rendering.

import { emit } from './events.js';
import { normalizeCollections, inferModel } from './collections-records.js';
export { parsePrompt, inferModel, detectModel, labelFor } from './collections-records.js';
import { showToast } from './toast.js';

const LS_COLLECTIONS = 'ideogram_collections';
const LS_ACTIVE = 'ideogram_active_collection';

let collections = [];
let activeId = null;
let expandedId = null;
let editingId = null;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function load() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(LS_COLLECTIONS)) || [];
    collections = normalizeCollections(data, uid);
    activeId = localStorage.getItem(LS_ACTIVE) || null;
  } catch {
    collections = [];
    activeId = null;
    showToast('Saved collections could not be read. Import a collection backup to recover your prompts.', 'error', 6000);
  }
  if (data && !Array.isArray(data)) showToast('Saved collection data has an invalid format. Import a collection backup to recover your prompts.', 'error', 6000);
  if (!collections.find(c => c.id === activeId)) activeId = collections[0]?.id ?? null;
}

function save() {
  localStorage.setItem(LS_COLLECTIONS, JSON.stringify(collections));
  // The collection write is authoritative; a failed selection preference must
  // not make an otherwise successful import appear to have failed.
  try {
    if (activeId) localStorage.setItem(LS_ACTIVE, activeId);
    else localStorage.removeItem(LS_ACTIVE);
  } catch { /* restored selection can fall back to the first collection */ }
}

load();

export { collections, activeId, expandedId, editingId, uid, load, save };

export function setExpandedId(id) { expandedId = id; }
export function setEditingId(id) { editingId = id; }
export function getExpandedId() { return expandedId; }
export function getEditingId() { return editingId; }

export function getAll() { return collections; }
export function getActive() { return collections.find(c => c.id === activeId) || null; }

export function extractTokens(importJson) {
  if (!importJson) return [];
  const seen = new Set();
  const out = [];
  for (const m of importJson.matchAll(/{{\s*([\w-]+)\s*}}/g)) {
    const name = m[1];
    if (!seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

function tokenValues(itemId, importJson) {
  const tokens = extractTokens(importJson);
  const card = document.querySelector(`.coll-card[data-card="${itemId}"]`);
  const item = getActive()?.items.find(item => item.id === itemId);
  return Object.fromEntries(tokens.map(token => {
    const input = card?.querySelector(`input[data-token="${token}"]`);
    return [token, input ? input.value : item?.tokenValues?.[token] ?? ''];
  }));
}

export function missingTokens(itemId, importJson) {
  return Object.entries(tokenValues(itemId, importJson)).filter(([, value]) => !value.trim()).map(([token]) => token);
}

export function resolveTokens(itemId, importJson) {
  if (!extractTokens(importJson).length) return importJson;
  const values = tokenValues(itemId, importJson);
  const replace = text => text.replace(/{{\s*([\w-]+)\s*}}/g, (_, token) => values[token] ?? '');
  const walk = value => typeof value === 'string' ? replace(value)
    : Array.isArray(value) ? value.map(walk)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [replace(key), walk(child)])) : value;
  try { return JSON.stringify(walk(JSON.parse(importJson))); }
  catch { return replace(importJson); }
}

export function setTokenValue(itemId, token, value) {
  const item = getActive()?.items.find(item => item.id === itemId);
  if (!item || !extractTokens(item.importJson).includes(token)) return;
  item.tokenValues = { ...item.tokenValues, [token]: value };
  save();
}

export function createCollection(name, items = []) {
  const previous = { collections, activeId, expandedId, editingId };
  const c = { id: uid(), name: (name || 'Untitled').slice(0, 60), items, createdAt: Date.now() };
  collections = [c, ...collections];
  activeId = c.id;
  expandedId = null;
  editingId = null;
  try { save(); }
  catch {
    ({ collections, activeId, expandedId, editingId } = previous);
    showToast('Collection could not be saved. Browser storage may be full or unavailable. Export a backup before freeing space, then try again.', 'error', 7000);
    return null;
  }
  emit('collection:data-changed');
  return c;
}

export function setActive(id) {
  if (!collections.find(c => c.id === id)) return;
  activeId = id;
  expandedId = null;
  save();
  emit('collection:data-changed');
}

export function renameActive(name) {
  const c = getActive();
  if (!c) return;
  c.name = (name || 'Untitled').slice(0, 60);
  save();
  emit('collection:data-changed');
}

export function deleteActive() {
  const i = collections.findIndex(c => c.id === activeId);
  if (i === -1) return;
  collections.splice(i, 1);
  activeId = collections[0]?.id ?? null;
  expandedId = null;
  save();
  emit('collection:data-changed');
  return collections[i]?.name;
}

export function addItem(importJson, imageUrl, model) {
  const c = getActive();
  if (!c) return null;
  if (!importJson || !importJson.trim()) return null;
  c.items.push({ id: uid(), importJson, imageUrl: imageUrl || null, model: inferModel(importJson, model) });
  save();
  emit('collection:data-changed');
  return c;
}

export function removeItem(itemId) {
  const c = getActive();
  if (!c) return;
  c.items = c.items.filter(i => i.id !== itemId);
  if (expandedId === itemId) expandedId = null;
  save();
  emit('collection:data-changed');
}

export function duplicateItem(itemId) {
  const c = getActive();
  if (!c) return;
  const i = c.items.findIndex(it => it.id === itemId);
  if (i === -1) return;
  c.items.splice(i + 1, 0, { ...c.items[i], id: uid(), tokenValues: { ...c.items[i].tokenValues } });
  save();
  emit('collection:data-changed');
}
