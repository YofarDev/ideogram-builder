import { editingId, extractTokens } from './collections-data.js';
import { draftFor, hasDraft } from './collections-drafts.js';
import { escapeHtml, escapeAttribute } from './escape-html.js';

export function renderDetail(item, p, els) {
  if (item.id === editingId) {
    return `
      <div class="coll-detail coll-edit" id="coll-detail-${item.id}">
        <div class="coll-edit-main">
          <label class="coll-detail-subhead" for="coll-edit-${item.id}">Edit prompt</label>
          <p class="coll-edit-hint" id="coll-edit-help-${item.id}">Cmd/Ctrl+Enter saves · Escape cancels. Generation uses the saved prompt.</p>
          <textarea class="coll-edit-textarea" id="coll-edit-${item.id}" spellcheck="false" data-edit="${item.id}" aria-describedby="coll-edit-help-${item.id}" aria-errormessage="coll-edit-error-${item.id}" aria-keyshortcuts="Control+Enter Meta+Enter">${escapeHtml(draftFor(item))}</textarea>
          <p class="coll-edit-status" role="status">${hasDraft(item) ? 'Unsaved changes' : 'Matches saved prompt'}</p>
          <p class="coll-edit-error" id="coll-edit-error-${item.id}" role="alert" hidden></p>
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
    const dots = (el.color_palette || []).slice(0, 4).map(col => `<span class="coll-swatch sm" style="background:${escapeAttribute(col)}"></span>`).join('');
    const tip = escapeAttribute(`${i + 1}. ${el.type || 'obj'}: ${el.desc || ''}${geo}`);
    return `<span class="coll-el-chip" title="${tip}"><span class="coll-el-idx">${i + 1}</span><span class="coll-el-type">${escapeHtml(el.type || 'obj')}</span>${dots ? `<span class="coll-el-pal">${dots}</span>` : ''}</span>`;
  }).join('') : `<span class="coll-detail-empty">No elements.</span>`;

  const tokens = extractTokens(item.importJson);
  const tokensHtml = tokens.length ? `
    <div class="coll-tokens">
      <div class="coll-detail-subhead">Variables</div>
      <div class="coll-token-grid">
        ${tokens.map(t => `<label class="coll-token-field"><span class="coll-token-label">{{${escapeHtml(t)}}}</span><input class="coll-token-input" data-token="${escapeAttribute(t)}" value="${escapeAttribute(item.tokenValues?.[t] ?? '')}" type="text" placeholder="value"></label>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="coll-detail" id="coll-detail-${item.id}">
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
