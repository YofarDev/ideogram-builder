// lora.js — LoRA panel: renders the active model's library, multi-selection,
// user-entry deletion. Library data lives in lora-library.js; the "+ Add" form
// in lora-add.js emits `lora:added`. Talks to the rest of the app via state.

import { state } from './state.js';
import { on } from './events.js';
import { showToast } from './toast.js';
import { BUILTIN_LORAS, loadUserLoras, saveUserLoras } from './lora-library.js';

// ponytail: Set preserves insertion order → active LoRAs stack in click order
const activeIds = new Set();
let collapsed = false;
let userLoras = [];

function allEntries() {
  return [...BUILTIN_LORAS, ...userLoras];
}

function getEntry(id) {
  return allEntries().find(l => l.id === id);
}

function visibleEntries() {
  // Ideogram LoRAs don't work on MOSS (and vice versa) — show only the
  // active model's entries.
  return allEntries().filter(e => e.model === state.model);
}

function isUserEntry(entry) {
  return !BUILTIN_LORAS.some(b => b.id === entry.id);
}

function syncState() {
  state.loras = [...activeIds].map(id => {
    const e = getEntry(id);
    return { filename: e.filename, source_url: e.source_url, strengths: { ...e.strengths } };
  });
}

function renderCards() {
  const list = document.getElementById('lora-list');
  if (!list) return;

  const entries = collapsed ? visibleEntries().filter(e => activeIds.has(e.id)) : visibleEntries();

  list.innerHTML = entries.map(entry => {
    const isActive = activeIds.has(entry.id);
    const strVal = entry.strengths.positive;
    const del = isUserEntry(entry)
      ? `<button type="button" class="lora-card-delete" data-id="${entry.id}" aria-label="Remove LoRA" title="Remove from library">&times;</button>`
      : '';
    return `
      <div class="lora-card${isActive ? ' active' : ''}" data-id="${entry.id}">
        <span class="lora-card-name" title="${entry.label}">${entry.label}</span>
        <div class="lora-card-strength">
          <span class="lora-card-strength-label">Str</span>
          <input type="range" min="0" max="2" step="0.05" value="${strVal}"
                 data-id="${entry.id}" class="lora-strength-range" aria-label="LoRA strength">
          <span class="lora-card-strength-value">${strVal.toFixed(1)}</span>
        </div>
        ${del}
      </div>`;
  }).join('');

  list.querySelectorAll('.lora-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.lora-card-strength') || e.target.closest('.lora-card-delete')) return;
      toggleLora(card.dataset.id);
    });
  });

  list.querySelectorAll('.lora-strength-range').forEach(range => {
    range.addEventListener('input', (e) => {
      e.stopPropagation();
      updateStrength(range.dataset.id, parseFloat(range.value));
    });
  });

  list.querySelectorAll('.lora-card-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteUserLora(btn.dataset.id);
    });
  });
}

function updateToggleIcon() {
  const toggle = document.getElementById('lora-toggle');
  if (!toggle) return;
  const icon = toggle.querySelector('.lora-header-icon');
  if (icon) icon.textContent = collapsed ? '▶' : '▼';
  toggle.setAttribute('aria-expanded', String(!collapsed));
}

function toggleLora(id) {
  if (!getEntry(id)) return;
  if (activeIds.has(id)) activeIds.delete(id);
  else activeIds.add(id);
  syncState();
  collapsed = true;
  localStorage.setItem('ideogram_lora_collapsed', 'true');
  updateToggleIcon();
  renderCards();
}

function updateStrength(id, value) {
  const entry = getEntry(id);
  if (!entry) return;
  entry.strengths.positive = value;
  const card = document.querySelector(`.lora-card[data-id="${id}"]`);
  if (card) {
    const valSpan = card.querySelector('.lora-card-strength-value');
    if (valSpan) valSpan.textContent = value.toFixed(1);
  }
  if (activeIds.has(id)) syncState();
}

function deleteUserLora(id) {
  const entry = getEntry(id);
  if (!entry || !isUserEntry(entry)) return;
  userLoras = userLoras.filter(e => e.id !== id);
  saveUserLoras(userLoras);
  if (activeIds.delete(id)) syncState();
  showToast(`Removed "${entry.label}" from the library.`, 'info');
  renderCards();
}

function initToggle() {
  const toggle = document.getElementById('lora-toggle');
  if (!toggle) return;

  const saved = localStorage.getItem('ideogram_lora_collapsed');
  collapsed = saved === 'true';

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    localStorage.setItem('ideogram_lora_collapsed', String(collapsed));
    updateToggleIcon();
    renderCards();
  });
}

export function initLora() {
  activeIds.clear();
  collapsed = false;
  state.loras = [];
  userLoras = loadUserLoras();
  initToggle();
  renderCards();

  on('lora:added', ({ entry }) => {
    userLoras.push(entry);
    saveUserLoras(userLoras);
    renderCards();
  });

  on('model:changed', ({ model }) => {
    // Drop active LoRAs of the other model — they can't run on this engine.
    let dropped = false;
    for (const id of [...activeIds]) {
      const entry = getEntry(id);
      if (entry && entry.model !== model) {
        activeIds.delete(id);
        dropped = true;
      }
    }
    if (dropped) syncState();
    renderCards();
  });

  on('canvas:reset', () => {
    activeIds.clear();
    syncState();
    renderCards();
  });
}

export function restoreLorasFromMeta(loras) {
  activeIds.clear();
  loras.forEach(l => {
    const entry = allEntries().find(e => e.filename === l.filename);
    if (entry) {
      entry.strengths.positive = l.strengths.positive;
      entry.strengths.unconditional = l.strengths.unconditional;
      activeIds.add(entry.id);
    }
  });
  syncState();
  collapsed = true;
  localStorage.setItem('ideogram_lora_collapsed', 'true');
  updateToggleIcon();
  renderCards();
}
