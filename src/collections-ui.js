// collections-ui.js — DOM rendering for the Collections tab.
// Imports data helpers from collections-data; no mutable state of its own.

import { getAll, getActive, parsePrompt, labelFor, extractTokens, resolveTokens } from './collections-data.js';
import { drawPreview } from './collections-preview.js';
import { collections, activeId, expandedId, editingId, setExpandedId } from './collections-data.js';
import { escapeHtml } from './escape-html.js';

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

export function render() {
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
    const mode = els[0]?.type || '\u2014';
    const open = item.id === expandedId;
    return `
      <article class="coll-card${open ? ' expanded' : ''}" data-card="${item.id}">
        <div class="coll-card-head">
          ${item.imageUrl ? `<img class="coll-thumb" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
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
  if (item.id === editingId) {
    return `
      <div class="coll-detail coll-edit">
        <div class="coll-edit-main">
          <div class="coll-detail-subhead">Edit prompt JSON</div>
          <textarea class="coll-edit-textarea" spellcheck="false" data-edit="${item.id}">${escapeHtml(item.importJson)}</textarea>
          <div class="coll-actions">
            <button class="btn btn-primary" data-act="save" data-id="${item.id}">Save</button>
            <button class="btn btn-ghost" data-act="cancel" data-id="${item.id}">Cancel</button>
          </div>
        </div>
      </div>`;
  }
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
    const geo = b.length === 4 ? ` \u00B7 x ${Math.round(b[1] / 10)}% y ${Math.round(b[0] / 10)}%` : '';
    const dots = (el.color_palette || []).slice(0, 4).map(col => `<span class="coll-swatch sm" style="background:${escapeHtml(col)}"></span>`).join('');
    const tip = escapeHtml(`${i + 1}. ${el.type || 'obj'}: ${el.desc || ''}${geo}`);
    return `<span class="coll-el-chip" title="${tip}"><span class="coll-el-idx">${i + 1}</span><span class="coll-el-type">${escapeHtml(el.type || 'obj')}</span>${dots ? `<span class="coll-el-pal">${dots}</span>` : ''}</span>`;
  }).join('') : `<span class="coll-detail-empty">No elements.</span>`;

  const tokens = extractTokens(item.importJson);
  const tokensHtml = tokens.length ? `
    <div class="coll-tokens">
      <div class="coll-detail-subhead">Variables</div>
      <div class="coll-token-grid">
        ${tokens.map(t => `<label class="coll-token-field"><span class="coll-token-label">{{${escapeHtml(t)}}}</span><input class="coll-token-input" data-token="${escapeHtml(t)}" type="text" placeholder="value"></label>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="coll-detail">
      <div class="coll-detail-side">
        ${p.high_level_description ? `<p class="coll-detail-hld">${escapeHtml(p.high_level_description)}</p>` : ''}
        <div class="coll-detail-style">${styleHtml}</div>
      </div>
      <div class="coll-detail-main">
        ${tokensHtml}
        <div class="coll-detail-subhead">Elements</div>
        <div class="coll-el-chips">${elChips}</div>
        <div class="coll-actions">
          <button class="btn btn-primary" data-act="generate" data-id="${item.id}">Generate this one</button>
          <button class="btn btn-secondary" data-act="load" data-id="${item.id}">Load into Editor</button>
          <button class="btn btn-ghost" data-act="edit" data-id="${item.id}">Edit</button>
          <button class="btn btn-ghost" data-act="dup" data-id="${item.id}">Duplicate</button>
          <button class="btn btn-danger" data-act="remove" data-id="${item.id}">Remove</button>
        </div>
      </div>
    </div>`;
}
