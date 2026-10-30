// collections-ui.js — DOM rendering for the Collections tab.
// Imports data helpers from collections-data; no mutable state of its own.

import { getActive, parsePrompt, labelFor, detectModel } from './collections-data.js';
import { drawPreview } from './collections-preview.js';
import { collections, activeId, expandedId } from './collections-data.js';
import { escapeHtml, escapeAttribute } from './escape-html.js';
import { isMossJson, parseMoss } from './prompt-moss.js';
import { state } from './state.js';
import { renderDetail } from './collections-detail.js';
import { hasDraft } from './collections-drafts.js';

/** MOSS items preview from the parsed layout view (editor-format elements). */
function itemElements(item) {
  const parsed = parsePrompt(item.importJson);
  let elements = parsed.compositional_deconstruction?.elements;
  if (detectModel(item) === 'moss' && isMossJson(parsed)) {
    try { elements = parseMoss(parsed, { width: state.canvas.width, height: state.canvas.height }).view.compositional_deconstruction.elements; }
    catch { elements = []; }
  }
  return Array.isArray(elements) ? elements.filter(el => el && typeof el === 'object').map(el => ({
    ...el, color_palette: Array.isArray(el.color_palette) ? el.color_palette.filter(color => typeof color === 'string') : [],
  })) : [];
}

/** Card title: MOSS layouts use summary.caption, else the Ideogram hld. */
function itemTitle(item) {
  if (detectModel(item) === 'moss') {
    const parsed = parsePrompt(item.importJson);
    if (isMossJson(parsed)) return parsed.summary?.caption || labelFor(item.importJson);
    return labelFor(item.importJson);
  }
  return parsePrompt(item.importJson).high_level_description || labelFor(item.importJson);
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
  return `<span class="coll-palette">${colors.map(col => `<span class="coll-swatch" style="background:${escapeAttribute(col)}"></span>`).join('')}</span>`;
}

export function render() {
  const root = document.getElementById('collection-container');
  if (!root) return;
  const focused = document.activeElement;
  const cardId = focused.closest?.('[data-card]')?.dataset.card;
  const selector = focused.id ? `#${focused.id}` : cardId
    ? `.coll-card[data-card="${cardId}"] ${focused.matches('[data-toggle]') ? '[data-toggle]' : focused.dataset.act ? `[data-act="${focused.dataset.act}"]` : focused.dataset.token ? `[data-token="${focused.dataset.token}"]` : ':not(*)'}` : null;
  const selection = focused.matches('input, textarea') ? [focused.selectionStart, focused.selectionEnd] : null;
  renderChips();
  renderHeader();
  renderItems();
  const btn = document.getElementById('btn-collection-generate');
  const c = getActive();
  if (btn) btn.disabled = !c || c.items.length === 0;
  const target = root.contains(focused) ? null : selector && root.querySelector(selector);
  if (target) {
    target.focus({ preventScroll: true });
    if (selection && target.setSelectionRange && selection[0] !== null) target.setSelectionRange(...selection);
  }
}

function renderChips() {
  const wrap = document.getElementById('collection-chips');
  if (!wrap) return;
  wrap.innerHTML = collections.map(c =>
    `<button type="button" id="collection-chip-${c.id}" class="coll-chip${c.id === activeId ? ' active' : ''}" data-chip="${c.id}" role="tab" aria-controls="collection-panel" aria-selected="${c.id === activeId}" tabindex="${c.id === activeId ? 0 : -1}">${escapeHtml(c.name)}<span class="coll-chip-count">${c.items.length}</span></button>`
  ).join('') + `<button class="coll-chip coll-chip-new" id="coll-chip-new">+ New collection</button>`;
  const panel = document.getElementById('collection-panel');
  if (panel) {
    if (activeId) panel.setAttribute('aria-labelledby', `collection-chip-${activeId}`);
    else panel.removeAttribute('aria-labelledby');
  }
}

function renderHeader() {
  const c = getActive();
  const titleEl = document.getElementById('collection-title');
  const metaEl = document.getElementById('collection-meta');
  const rename = titleEl?.querySelector('button');
  if (rename) {
    rename.textContent = c?.name ?? 'No collection';
    rename.disabled = !c;
    rename.setAttribute('aria-label', c ? `Rename collection: ${c.name}` : 'No collection');
  } else if (titleEl) titleEl.textContent = c?.name ?? 'No collection';
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
    const els = itemElements(item);
    const title = itemTitle(item);
    const mode = els[0]?.type || '\u2014';
    const open = item.id === expandedId;
    const modelChip = detectModel(item) === 'moss' ? 'MOSS' : 'Ideogram';
    return `
      <article class="coll-card${open ? ' expanded' : ''}" data-card="${item.id}">
        <div class="coll-card-head">
          ${item.imageUrl ? `<img class="coll-thumb" src="${escapeAttribute(item.imageUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
          <canvas class="coll-preview" width="160" height="160" aria-hidden="true"></canvas>
          <button type="button" class="coll-card-chevron" data-toggle aria-label="${open ? 'Collapse' : 'Expand'} prompt details" aria-expanded="${open}" aria-controls="coll-detail-${item.id}" aria-describedby="coll-title-${item.id}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${open ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'}"/></svg></button>
        </div>
        <div class="coll-card-body">
          <div class="coll-card-title" id="coll-title-${item.id}">${escapeHtml(title)}</div>
          <div class="coll-card-meta">
            <span class="coll-chip-meta">${modelChip}</span>
            <span class="coll-chip-meta">${els.length} box${els.length === 1 ? '' : 'es'}</span>
            <span class="coll-chip-meta">${escapeHtml(mode)}</span>
            ${paletteDots(els)}
          </div>
          <span class="coll-draft-flag"${hasDraft(item) ? '' : ' hidden'}>Unsaved draft</span>
        </div>
        ${open ? renderDetail(item, parsePrompt(item.importJson), els) : `<div id="coll-detail-${item.id}" hidden></div>`}
      </article>`;
  }).join('');

  c.items.forEach(item => {
    const canvas = grid.querySelector(`.coll-card[data-card="${item.id}"] .coll-preview`);
    if (canvas) drawPreview(canvas, itemElements(item), 160);
  });
}
