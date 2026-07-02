// collections-data.js — Data layer: module state, localStorage CRUD, no DOM rendering.

import { emit } from './events.js';

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
  try { collections = JSON.parse(localStorage.getItem(LS_COLLECTIONS)) || []; }
  catch { collections = []; }
  activeId = localStorage.getItem(LS_ACTIVE) || null;
  if (!collections.find(c => c.id === activeId)) activeId = collections[0]?.id ?? null;
}

function save() {
  localStorage.setItem(LS_COLLECTIONS, JSON.stringify(collections));
  if (activeId) localStorage.setItem(LS_ACTIVE, activeId);
}

load();

export { collections, activeId, expandedId, editingId, uid, load, save };

export function setExpandedId(id) { expandedId = id; }
export function setEditingId(id) { editingId = id; }
export function getExpandedId() { return expandedId; }
export function getEditingId() { return editingId; }

export function getAll() { return collections; }
export function getActive() { return collections.find(c => c.id === activeId) || null; }

export function parsePrompt(importJson) {
  try { return JSON.parse(importJson) || {}; }
  catch { return {}; }
}

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

export function resolveTokens(itemId, importJson) {
  const tokens = extractTokens(importJson);
  if (!tokens.length) return importJson;
  const card = document.querySelector(`.coll-card[data-card="${itemId}"]`);
  if (!card) return importJson;
  let out = importJson;
  tokens.forEach(t => {
    const inp = card.querySelector(`input[data-token="${t}"]`);
    const val = inp ? inp.value : '';
    out = out.replace(new RegExp(`\\{\\{\\s*${t}\\s*\\}\\}`, 'g'), val);
  });
  return out;
}

export function labelFor(importJson) {
  const p = parsePrompt(importJson);
  if (p.high_level_description) return p.high_level_description;
  const el = p.compositional_deconstruction?.elements?.[0];
  if (el?.desc) return el.desc;
  if (p.compositional_deconstruction?.background) return p.compositional_deconstruction.background;
  return (importJson || '').slice(0, 60);
}

export function createCollection(name) {
  const c = { id: uid(), name: (name || 'Untitled').slice(0, 60), items: [], createdAt: Date.now() };
  collections.unshift(c);
  activeId = c.id;
  expandedId = null;
  save();
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

export function addItem(importJson, imageUrl) {
  const c = getActive();
  if (!c) return null;
  if (!importJson || !importJson.trim()) return null;
  c.items.push({ id: uid(), importJson, imageUrl: imageUrl || null });
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
  c.items.splice(i + 1, 0, { id: uid(), importJson: c.items[i].importJson, imageUrl: c.items[i].imageUrl });
  save();
  emit('collection:data-changed');
}
