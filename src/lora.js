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
    id: 'berserk-id4-v1-5k',
    label: 'Berserk (5k)',
    filename: 'berserk_id4_v1_000005000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/berserk_id4_v1_000005000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-5.5k',
    label: 'Berserk (5.5k)',
    filename: 'berserk_id4_v1_000005500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/berserk_id4_v1_000005500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-6k',
    label: 'Berserk (6k)',
    filename: 'berserk_id4_v1_000006000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/berserk_id4_v1_000006000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-6.5k',
    label: 'Berserk (6.5k)',
    filename: 'berserk_id4_v1_000006500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/berserk_id4_v1_000006500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-7k',
    label: 'Berserk (7k)',
    filename: 'berserk_id4_v1_000007000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/berserk_id4_v1_000007000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-7.5k',
    label: 'Berserk (7.5k)',
    filename: 'berserk_id4_v1_000007500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/chkp/berserk_id4_v1_000007500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-8k',
    label: 'Berserk (8k)',
    filename: 'berserk_id4_v1_000008000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/chkp/berserk_id4_v1_000008000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-8.5k',
    label: 'Berserk (8.5k)',
    filename: 'berserk_id4_v1_000008500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/chkp/berserk_id4_v1_000008500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-9k',
    label: 'Berserk (9k)',
    filename: 'berserk_id4_v1_000009000.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/chkp/berserk_id4_v1_000009000.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-9.5k',
    label: 'Berserk (9.5k)',
    filename: 'berserk_id4_v1_000009500.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/chkp/berserk_id4_v1_000009500.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
  {
    id: 'berserk-id4-v1-final',
    label: 'Berserk (final)',
    filename: 'berserk_id4_v1.safetensors',
    source_url: 'https://huggingface.co/Yofardev/berserk_id4_v1/resolve/main/chkp/berserk_id4_v1.safetensors',
    strengths: { positive: 1.0, unconditional: 0.5 },
  },
];

// ponytail: Set preserves insertion order → active LoRAs stack in click order
const activeIds = new Set();
let collapsed = false;

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

  const entries = collapsed ? LORAS.filter(e => activeIds.has(e.id)) : LORAS;

  list.innerHTML = entries.map(entry => {
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
  initToggle();
  renderCards();
  on('canvas:reset', () => {
    activeIds.clear();
    syncState();
    renderCards();
  });
}
