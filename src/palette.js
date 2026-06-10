// palette.js — Color palette management (global max 16, per-box max 5)

import { state } from './state.js';
import { on } from './events.js';

export function initPalette() {
  document.getElementById('btn-add-global-color').addEventListener('click', () => addColor('global'));
  document.getElementById('btn-add-box-color').addEventListener('click', () => addColor('box'));

  // React to box selection — render box colors
  on('box:selected', () => renderColors('box'));

  // React to state load — restore palettes
  on('state:loaded', ({ json }) => {
    state.globalPalette = json.style_description?.color_palette || [];
    renderColors('global');
    renderColors('box');
  });
}

function addColor(type) {
  const picker = document.getElementById(type + '-color-picker');
  const hex = picker.value.toUpperCase();

  if (type === 'global') {
    if (state.globalPalette.length >= 16) return alert('Max 16 colors allowed.');
    if (!state.globalPalette.includes(hex)) {
      state.globalPalette.push(hex);
      renderColors('global');
    }
  } else if (type === 'box' && state.selectedBoxId !== null) {
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (!box) return;
    if (box.colors.length >= 5) return alert('Max 5 colors allowed per box.');
    if (!box.colors.includes(hex)) {
      box.colors.push(hex);
      renderColors('box');
    }
  }
}

function removeColor(type, hex) {
  if (type === 'global') {
    state.globalPalette = state.globalPalette.filter(c => c !== hex);
    renderColors('global');
  } else if (type === 'box' && state.selectedBoxId !== null) {
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (!box) return;
    box.colors = box.colors.filter(c => c !== hex);
    renderColors('box');
  }
}

function renderColors(type) {
  const container = document.getElementById(type + '-colors');
  container.innerHTML = '';
  const list = type === 'global'
    ? state.globalPalette
    : (state.boxes.find(b => b.id === state.selectedBoxId)?.colors || []);

  list.forEach((hex) => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = hex;
    swatch.innerHTML = '×';
    swatch.onclick = () => removeColor(type, hex);
    container.appendChild(swatch);
  });
}
