import { state } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';

export function initPalette() {
  on('box:selected', () => renderColors('box'));

  on('state:loaded', ({ json }) => {
    state.globalPalette = json.style_description?.color_palette || [];
    renderColors('global');
    renderColors('box');
  });
}

function addColor(type, hex) {
  if (type === 'global') {
    if (state.globalPalette.length >= 16) return showToast('Maximum 16 colors allowed.', 'error');
    if (!state.globalPalette.includes(hex)) {
      state.globalPalette.push(hex);
      renderColors('global');
      emit('state:changed');
    }
  } else if (type === 'box' && state.selectedBoxId !== null) {
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (!box) return;
    if (box.colors.length >= 5) return showToast('Maximum 5 colors per box.', 'error');
    if (!box.colors.includes(hex)) {
      box.colors.push(hex);
      renderColors('box');
      emit('state:changed');
    }
  }
}

function removeColor(type, hex) {
  if (type === 'global') {
    state.globalPalette = state.globalPalette.filter(c => c !== hex);
    renderColors('global');
    emit('state:changed');
  } else if (type === 'box' && state.selectedBoxId !== null) {
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (!box) return;
    box.colors = box.colors.filter(c => c !== hex);
    renderColors('box');
    emit('state:changed');
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
    swatch.setAttribute('aria-label', `Remove color ${hex}`);
    swatch.setAttribute('role', 'button');
    swatch.setAttribute('tabindex', '0');
    swatch.innerHTML = '×';
    swatch.onclick = () => removeColor(type, hex);
    swatch.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeColor(type, hex); } };
    container.appendChild(swatch);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'icon-btn';
  addBtn.textContent = '+';
  addBtn.setAttribute('aria-label', 'Add color');
  addBtn.setAttribute('title', 'Add color');
  addBtn.onclick = () => {
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = '#d4a853';
    picker.style.cssText = 'position:fixed;left:0;top:0;width:32px;height:32px;opacity:0;pointer-events:none;z-index:-1;';
    picker.addEventListener('change', function onPick() {
      addColor(type, this.value.toUpperCase());
      this.remove();
    });
    document.body.appendChild(picker);
    picker.click();
  };
  container.appendChild(addBtn);
}
