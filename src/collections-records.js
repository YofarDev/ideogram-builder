// Validate collection containers without rewriting the prompt text they carry.
import { detectPromptFormat } from './prompt-convert.js';

export function normalizeItem(item, id) {
  if (!item || typeof item.importJson !== 'string' || !item.importJson.trim()) return null;
  const format = detectPromptFormat(item.importJson);
  const model = format === 'ideogram' ? 'ideogram'
    : ['moss', 'moss-draft'].includes(format) ? 'moss'
    : ['ideogram', 'moss'].includes(item.model) ? item.model : 'moss';
  const result = { id, importJson: item.importJson, model, imageUrl: null };
  if (typeof item.imageUrl === 'string' && item.imageUrl.startsWith('/output/')) {
    try {
      const name = decodeURIComponent(item.imageUrl.slice(8));
      if (name && !/[\\/?#]/.test(name) && /\.(png|jpe?g|webp)$/i.test(name)) result.imageUrl = item.imageUrl;
    } catch { /* invalid encoded filenames have no usable image reference */ }
  }
  if (item.tokenValues && typeof item.tokenValues === 'object' && !Array.isArray(item.tokenValues)) {
    result.tokenValues = Object.fromEntries(Object.entries(item.tokenValues)
      .filter(([key, value]) => /^[\w-]+$/.test(key) && typeof value === 'string'));
  }
  return result;
}

export function parseCollectionFile(text, uid) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('This file is not valid JSON. Fix its syntax or choose an exported collection.'); }
  if (!data || !Array.isArray(data.items)) throw new Error('Choose a collection JSON file with an items list.');
  if (!data.items.length) throw new Error('No prompts found in this collection.');
  const items = data.items.map((item, index) => {
    const normalized = normalizeItem(item, uid());
    if (!normalized) throw new Error(`Prompt ${index + 1} has no prompt text. Fix that entry before importing.`);
    return normalized;
  });
  return { name: typeof data.name === 'string' && data.name.trim() ? data.name.slice(0, 60) : 'Imported', items };
}

export function normalizeCollections(data, uid) {
  if (!Array.isArray(data)) return [];
  const ids = new Set();
  const identifier = value => {
    const base = typeof value === 'string' && /^[\w-]{1,128}$/.test(value) ? value : uid();
    let id = base, suffix = 1;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    return id;
  };
  return data.filter(collection => collection && typeof collection === 'object' && Array.isArray(collection.items))
    .map(collection => ({
      id: identifier(collection.id),
      name: typeof collection.name === 'string' ? collection.name.slice(0, 60) : 'Untitled',
      createdAt: Number.isFinite(collection.createdAt) ? collection.createdAt : 0,
      items: collection.items.map(item => normalizeItem(item, identifier(item?.id))).filter(Boolean),
    }));
}

export function parsePrompt(importJson) {
  try { return JSON.parse(importJson) || {}; }
  catch { return {}; }
}

/** Model for a prompt: explicit value wins; otherwise inferred from format
 * (plain captions can only be MOSS — Ideogram prompts are always JSON). */
export function inferModel(importJson, model) {
  if (model) return model;
  const format = detectPromptFormat(importJson);
  return format === 'ideogram' ? 'ideogram' : 'moss';
}

/** Model for a stored item — legacy items (no model) infer from their JSON. */
export function detectModel(item) {
  const format = detectPromptFormat(item.importJson);
  if (format === 'ideogram') return 'ideogram';
  if (format === 'moss' || format === 'moss-draft') return 'moss';
  return item.model || inferModel(item.importJson);
}


export function labelFor(importJson) {
  const p = parsePrompt(importJson);
  if (p.high_level_description) return p.high_level_description;
  if (p.summary?.caption) return p.summary.caption;
  const el = p.compositional_deconstruction?.elements?.[0];
  if (el?.desc) return el.desc;
  if (p.compositional_deconstruction?.background) return p.compositional_deconstruction.background;
  return (importJson || '').slice(0, 60);
}
