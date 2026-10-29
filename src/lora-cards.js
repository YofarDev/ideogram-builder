// lora-cards.js — Pure HTML templates for the LoRA popover cards (split of
// lora.js). No DOM/state access.

import { escapeHtml } from './escape-html.js';

export function activeCard(entry) {
  const str = entry.strengths.positive;
  return `
    <div class="lora-card active" data-id="${entry.id}">
      <span class="lora-card-check" aria-hidden="true"></span>
      <span class="lora-card-name" title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>
      <div class="lora-card-strength">
        <input type="range" min="-1" max="2" step="0.05" value="${str}"
               data-id="${entry.id}" class="lora-strength-range" aria-label="${escapeHtml(entry.label)} strength">
        <span class="lora-card-strength-value">${str.toFixed(2)}</span>
      </div>
    </div>`;
}

export function libraryCard(entry, deletable) {
  const del = deletable
    ? `<button type="button" class="lora-card-delete" data-id="${entry.id}" aria-label="Delete ${escapeHtml(entry.label)} from library" title="Delete from library">&times;</button>`
    : '';
  return `
    <div class="lora-card" data-id="${entry.id}">
      <span class="lora-card-check" aria-hidden="true"></span>
      <span class="lora-card-name" title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>
      ${del}
    </div>`;
}
