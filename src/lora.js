// lora.js — LoRA library (hardcoded), multi-selection
// Owns the lora panel DOM. Talks to rest of app via state only.

import { state } from './state.js';
import { on } from './events.js';

const LORAS = [
  {
    id: 'kiki-v2',
    label: 'Kiki (Studio Ghibli)',
    filename: 'kiki_ideogram4_v2.safetensors',
    source_url: 'https://huggingface.co/Yofardev/kiki_ideogram4_v2/resolve/main/kiki_ideogram4_v2.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'naoki-urasawa-v1',
    label: 'Naoki Urasawa',
    filename: 'naoki_urasawa_ideogram4_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/naoki_urasawa_ideogram4_v1/resolve/main/naoki_urasawa_ideogram4_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'tintin-v3',
    label: 'Tintin (v3)',
    filename: 'tintin_v3.safetensors',
    source_url: 'https://huggingface.co/Yofardev/tintin_id4_v3/resolve/main/tintin_v3.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'yofardev-v1',
    label: 'Yofardev (v1)',
    filename: 'yofardev_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/yofardev_id4_v1/resolve/main/yofardev_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'test-mil-v1-final',
    label: 'Test Mil v1 (final)',
    filename: 'test_mil_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/test_mil_v1/resolve/main/test_mil_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'retro-pokemon-v1',
    label: 'Retro Pokémon (v1)',
    filename: 'retro_pokémon_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/retro_pokemon_id4_v1/resolve/main/retro_pok%C3%A9mon_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-v1',
    label: 'Ovi Style (v1)',
    filename: 'ovi_style_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-500',
    label: 'Ovi Style (500 steps)',
    filename: 'ovi_style_v1_000000500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000000500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-1000',
    label: 'Ovi Style (1000 steps)',
    filename: 'ovi_style_v1_000001000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000001000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-1500',
    label: 'Ovi Style (1500 steps)',
    filename: 'ovi_style_v1_000001500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000001500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-2000',
    label: 'Ovi Style (2000 steps)',
    filename: 'ovi_style_v1_000002000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000002000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-2500',
    label: 'Ovi Style (2500 steps)',
    filename: 'ovi_style_v1_000002500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000002500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-3000',
    label: 'Ovi Style (3000 steps)',
    filename: 'ovi_style_v1_000003000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000003000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-3500',
    label: 'Ovi Style (3500 steps)',
    filename: 'ovi_style_v1_000003500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000003500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-4000',
    label: 'Ovi Style (4000 steps)',
    filename: 'ovi_style_v1_000004000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000004000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'ovi-style-4500',
    label: 'Ovi Style (4500 steps)',
    filename: 'ovi_style_v1_000004500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/ovi_style_id4_v1/resolve/main/ovi_style_v1_000004500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
];

// ponytail: Set preserves insertion order → active LoRAs stack in click order
const activeIds = new Set();

function getEntry(id) {
  return LORAS.find(l => l.id === id);
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

  list.innerHTML = LORAS.map(entry => {
    const isActive = activeIds.has(entry.id);
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
      toggleLora(card.dataset.id);
    });
  });

  list.querySelectorAll('.lora-strength-range').forEach(range => {
    range.addEventListener('input', (e) => {
      e.stopPropagation();
      updateStrength(range.dataset.id, parseFloat(range.value));
    });
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
  if (card) {
    const valSpan = card.querySelector('.lora-card-strength-value');
    if (valSpan) valSpan.textContent = value.toFixed(1);
  }
  if (activeIds.has(id)) syncState();
}

export function initLora() {
  activeIds.clear();
  state.loras = [];
  renderCards();
  on('canvas:reset', () => {
    activeIds.clear();
    syncState();
    renderCards();
  });
}
