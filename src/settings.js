import { state, MODE_PHOTO, MODE_ARTSTYLE, randomLayerColor } from './state.js';
import { on, emit } from './events.js';

function round16(v) {
  return Math.round(v / 16) * 16;
}

function updateDimensions() {
  const sel = document.getElementById('aspect-ratio');
  const size = document.querySelector('.size-btn.active')?.dataset.size || '1';
  const [baseW, baseH] = sel.value.split('x').map(Number);

  const oldWidth = state.canvas.width;
  const oldHeight = state.canvas.height;

  if (size === '2') {
    const longSide = Math.max(baseW, baseH);
    const scale = 2048 / longSide;
    state.canvas.width = round16(baseW * scale);
    state.canvas.height = round16(baseH * scale);
  } else {
    state.canvas.width = baseW;
    state.canvas.height = baseH;
  }

  document.getElementById('dim-display').textContent = `${state.canvas.width} × ${state.canvas.height}`;

  const hasBoxes = state.boxes.length > 0;
  const dimsChanged = oldWidth !== state.canvas.width || oldHeight !== state.canvas.height;
  if (hasBoxes && dimsChanged) {
    emit('canvas:rebuild', { oldWidth, oldHeight });
  } else {
    emit('canvas:rebuild');
  }
}

export function initSettings() {
  document.getElementById('aspect-ratio').addEventListener('change', () => {
    localStorage.setItem('ideogram_aspect_ratio', document.getElementById('aspect-ratio').value);
    updateDimensions();
  });

  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateDimensions();
    });
  });

  document.getElementById('mode_photo').addEventListener('change', () => { setPhotoArtMode(MODE_PHOTO); emit('state:changed'); });
  document.getElementById('mode_artstyle').addEventListener('change', () => { setPhotoArtMode(MODE_ARTSTYLE); emit('state:changed'); });

  ['box-mode', 'box-text', 'box-desc'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => { updateBoxData(); emit('state:changed'); });
  });

  ['high_level_description', 'aesthetics', 'lighting', 'medium', 'art_style', 'background'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => emit('state:changed'));
  });

  // Step preset (Turbo / Default / Quality) — drives mu/std/num_steps in the workflow
  document.querySelectorAll('input[name="steps"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.dataset.preset) state.preset = radio.dataset.preset;
    });
  });

  // LoRA override lifecycle: snapshot form → apply overrides → restore on clear
  let loraSnapshot = null;
  const OVERRIDE_FIELDS = ['aesthetics', 'lighting', 'medium', 'art_style'];

  on('lora:selected', ({ overrides }) => {
    loraSnapshot = {};
    OVERRIDE_FIELDS.forEach(id => {
      loraSnapshot[id] = document.getElementById(id).value;
    });
    loraSnapshot.photoArtMode = state.photoArtMode;

    if (overrides && typeof overrides === 'object') {
      Object.entries(overrides).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el && val != null) el.value = val;
      });
      // art_style only emits in ARTSTYLE mode → force it so the override survives
      if ('art_style' in overrides) setPhotoArtMode(MODE_ARTSTYLE);
    }
    emit('state:changed');
  });

  on('lora:cleared', () => {
    if (!loraSnapshot) return;
    OVERRIDE_FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = loraSnapshot[id];
    });
    setPhotoArtMode(loraSnapshot.photoArtMode);
    loraSnapshot = null;
    emit('state:changed');
  });

  // Seed input
  const seedInput = document.getElementById('seed-input');
  seedInput.addEventListener('input', () => {
    state.seed = parseInt(seedInput.value, 10);
    if (isNaN(state.seed)) state.seed = -1;
  });

  // Random seed button
  document.getElementById('btn-random-seed').addEventListener('click', () => {
    const randomSeed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    state.seed = randomSeed;
    seedInput.value = randomSeed;
  });

  on('box:selected', ({ id }) => {
    const boxPanel = document.getElementById('box-panel');
    if (id) {
      const box = state.boxes.find(b => b.id === id);
      if (!box) return;
      boxPanel.style.display = 'block';
      document.getElementById('box-mode').value = box.mode;
      document.getElementById('box-text').value = box.text;
      document.getElementById('box-desc').value = box.desc;
      document.getElementById('text-input-group').style.display = box.mode === 'text' ? 'block' : 'none';
      populateGeometry(box);
      const swatch = document.getElementById('box-color-swatch');
      if (swatch) swatch.style.background = box.color || 'var(--accent)';
    } else {
      boxPanel.style.display = 'none';
    }
  });

  // X/Y/W/H pixel editors → normalized box coords
  ['box-x', 'box-y', 'box-w', 'box-h'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      if (!state.selectedBoxId) return;
      const box = state.boxes.find(b => b.id === state.selectedBoxId);
      if (!box) return;
      const v = parseFloat(document.getElementById(id).value);
      if (isNaN(v)) return;
      const cw = state.canvas.width, ch = state.canvas.height;
      if (id === 'box-x') box.x = (v / cw) * 1000;
      else if (id === 'box-y') box.y = (v / ch) * 1000;
      else if (id === 'box-w') box.w = Math.max(1, (v / cw) * 1000);
      else if (id === 'box-h') box.h = Math.max(1, (v / ch) * 1000);
      emit('box:geometry', { id: box.id });
    });
  });

  document.getElementById('btn-reroll-color').addEventListener('click', () => {
    if (!state.selectedBoxId) return;
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (!box) return;
    box.color = randomLayerColor();
    const swatch = document.getElementById('box-color-swatch');
    if (swatch) swatch.style.background = box.color;
    emit('box:color', { id: box.id });
    emit('state:changed');
  });

  // Keep X/Y/W/H in sync after canvas drag/resize
  on('state:changed', () => {
    if (!state.selectedBoxId) return;
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (box) populateGeometry(box);
  });

  on('state:loaded', ({ json }) => {
    document.getElementById('high_level_description').value = json.high_level_description || '';
    document.getElementById('aesthetics').value = json.style_description?.aesthetics || '';
    document.getElementById('lighting').value = json.style_description?.lighting || '';
    document.getElementById('medium').value = json.style_description?.medium || '';
    document.getElementById('background').value = json.compositional_deconstruction?.background || '';

    if (json.style_description?.photo !== undefined) {
      document.getElementById('art_style').value = json.style_description.photo;
      document.getElementById('mode_photo').checked = true;
      setPhotoArtMode(MODE_PHOTO);
    } else {
      document.getElementById('art_style').value = json.style_description?.art_style || '';
      document.getElementById('mode_artstyle').checked = true;
      setPhotoArtMode(MODE_ARTSTYLE);
    }
  });

  setPhotoArtMode(MODE_ARTSTYLE);
}

function setPhotoArtMode(mode) {
  state.photoArtMode = mode;
  if (mode === MODE_PHOTO) {
    document.getElementById('medium').value = 'photograph';
    document.getElementById('medium').disabled = true;
    document.getElementById('mode_label').innerText = 'Photo Style';
  } else {
    document.getElementById('medium').disabled = false;
    document.getElementById('mode_label').innerText = 'Art Style';
  }
}

function updateBoxData() {
  if (!state.selectedBoxId) return;
  const box = state.boxes.find(b => b.id === state.selectedBoxId);
  if (!box) return;
  box.mode = document.getElementById('box-mode').value;
  box.text = document.getElementById('box-text').value;
  box.desc = document.getElementById('box-desc').value;
  document.getElementById('text-input-group').style.display = box.mode === 'text' ? 'block' : 'none';

  const label = document.getElementById(state.selectedBoxId)?.querySelector('.box-label');
  if (label) label.textContent = box.text || box.desc || '';
}

function populateGeometry(box) {
  const cw = state.canvas.width, ch = state.canvas.height;
  document.getElementById('box-x').value = Math.round((box.x / 1000) * cw);
  document.getElementById('box-y').value = Math.round((box.y / 1000) * ch);
  document.getElementById('box-w').value = Math.round((box.w / 1000) * cw);
  document.getElementById('box-h').value = Math.round((box.h / 1000) * ch);
}
