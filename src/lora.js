// lora.js — LoRA popover (toolbar "LoRA" button): active stack with strength
// sliders on top, searchable library of the active model's entries below.
// Library data lives in lora-library.js; the "+ Add" form in lora-add.js emits
// `lora:added`. Talks to the rest of the app via state.

import { state } from './state.js';
import { on } from './events.js';
import { showToast } from './toast.js';
import { activeCard, libraryCard } from './lora-cards.js';
import { initLoraPanel } from './lora-panel.js';
import { BUILTIN_LORAS, loadUserLoras, saveUserLoras } from './lora-library.js';

// ponytail: Set preserves insertion order → active LoRAs stack in click order
const activeIds = new Set();
let userLoras = [];
let query = '';

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

function libraryMatches() {
  const q = query.trim().toLowerCase();
  return visibleEntries().filter(e => !activeIds.has(e.id) && (!q || e.label.toLowerCase().includes(q)));
}

function renderCards() {
  const activeList = document.getElementById('lora-active');
  const list = document.getElementById('lora-list');
  if (!list) return;

  const active = [...activeIds].map(getEntry).filter(Boolean);
  const library = libraryMatches();

  if (activeList) {
    activeList.innerHTML = active.length
      ? active.map(activeCard).join('')
      : '<div class="lora-empty">None active — pick one below.</div>';
  }
  list.innerHTML = library.length
    ? library.map(e => libraryCard(e, isUserEntry(e))).join('')
    : `<div class="lora-empty">${query ? 'No LoRA matches.' : 'All LoRAs are active.'}</div>`;

  const libCount = document.getElementById('lora-library-count');
  if (libCount) libCount.textContent = String(visibleEntries().length - active.length);
  updateTrigger(active);
}

// Toolbar button: badge = active count, tooltip = active names
function updateTrigger(active) {
  const badge = document.getElementById('lora-badge');
  if (badge) {
    badge.textContent = String(active.length);
    badge.hidden = active.length === 0;
  }
  const btn = document.getElementById('btn-lora');
  if (btn) btn.title = active.length ? active.map(e => e.label).join('\n') : 'LoRAs — none active';
}

function bindListEvents(root) {
  // initLora can run more than once on the same DOM (session restore, tests)
  if (root.dataset.loraBound) return;
  root.dataset.loraBound = '1';
  root.addEventListener('click', (e) => {
    const del = e.target.closest('.lora-card-delete');
    if (del) return deleteUserLora(del.dataset.id);
    if (e.target.closest('.lora-card-strength')) return;
    const card = e.target.closest('.lora-card');
    if (card) toggleLora(card.dataset.id);
  });
  root.addEventListener('input', (e) => {
    if (e.target.classList.contains('lora-strength-range')) {
      updateStrength(e.target.dataset.id, parseFloat(e.target.value));
    }
  });
}

function toggleLora(id) {
  if (!getEntry(id)) return;
  if (activeIds.has(id)) activeIds.delete(id);
  else activeIds.add(id);
  syncState();
  renderCards();
}

function updateStrength(id, value) {
  const entry = getEntry(id);
  if (!entry) return;
  entry.strengths.positive = value;
  const card = document.querySelector(`.lora-card[data-id="${id}"]`);
  const valSpan = card?.querySelector('.lora-card-strength-value');
  if (valSpan) valSpan.textContent = value.toFixed(2);
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

// Search box callbacks for lora-panel.js
function onSearch(value) {
  query = value;
  renderCards();
}

// Enter activates the first match — type-to-pick without the mouse.
// Returns true when something was picked so the panel can clear the box.
function onPickFirst() {
  const first = libraryMatches()[0];
  if (!first) return false;
  query = '';
  toggleLora(first.id);
  return true;
}

export function initLora() {
  activeIds.clear();
  query = '';
  state.loras = [];
  userLoras = loadUserLoras();
  ['lora-active', 'lora-list'].forEach(id => {
    const el = document.getElementById(id);
    if (el) bindListEvents(el);
  });
  initLoraPanel({ onSearch, onPickFirst });
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
  renderCards();
}
