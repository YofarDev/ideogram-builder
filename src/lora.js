// lora.js — LoRA library (hardcoded), selection, override application
// Owns the lora panel DOM. Talks to rest of app via events + state only.

import { state } from './state.js';
import { on, emit } from './events.js';

const LORAS = [
  {
    id: 'kiki-v2',
    label: 'Kiki (Studio Ghibli)',
    filename: 'kiki_ideogram4_v2.safetensors',
    source_url: 'https://huggingface.co/Yofardev/kiki_ideogram4_v2/resolve/main/kiki_ideogram4_v2.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
    overrides: { art_style: 'Studio Ghibli style', medium: 'anime_screencap' },
  },
  {
    id: 'naoki-urasawa-v1',
    label: 'Naoki Urasawa',
    filename: 'naoki_urasawa_ideogram4_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/naoki_urasawa_ideogram4_v1/resolve/main/naoki_urasawa_ideogram4_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
    overrides: {},
  },
];

let activeId = null;

function getEntry(id) {
  return LORAS.find(l => l.id === id);
}

function renderCards() {
  const list = document.getElementById('lora-list');
  if (!list) return;

  list.innerHTML = LORAS.map(entry => {
    const isActive = entry.id === activeId;
    const strVal = entry.strengths.positive;
    return `
      <div class="lora-card${isActive ? ' active' : ''}" data-id="${entry.id}">
        <span class="lora-card-name" title="${entry.label}">${entry.label}</span>
        <div class="lora-card-strength">
          <span class="lora-card-strength-label">Str</span>
          <input type="range" min="0" max="2" step="0.05" value="${strVal}"
                 data-id="${entry.id}" class="lora-strength-range" aria-label="LoRA strength">
          <span class="lora-card-strength-value">${strVal.toFixed(1)}</span>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.lora-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.lora-card-strength')) return;
      const id = card.dataset.id;
      if (activeId === id) {
        clearActive();
      } else {
        selectLora(id);
      }
    });
  });

  list.querySelectorAll('.lora-strength-range').forEach(range => {
    range.addEventListener('input', (e) => {
      e.stopPropagation();
      updateStrength(range.dataset.id, parseFloat(range.value));
    });
  });
}

function selectLora(id) {
  const entry = getEntry(id);
  if (!entry) return;
  activeId = id;
  state.loras = [{
    filename: entry.filename,
    source_url: entry.source_url,
    strengths: { ...entry.strengths },
  }];
  emit('lora:selected', { overrides: { ...entry.overrides } });
  renderCards();
}

function clearActive() {
  if (!activeId) return;
  activeId = null;
  state.loras = [];
  emit('lora:cleared');
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
  if (id === activeId && state.loras[0]) {
    state.loras[0].strengths = { ...entry.strengths };
  }
}

export function initLora() {
  activeId = null;
  renderCards();
  on('canvas:reset', clearActive);
}
