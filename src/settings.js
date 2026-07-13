import { state, MODE_PHOTO, MODE_ARTSTYLE } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { initRecaption } from './settings-recaption.js';

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
  } else if (size === '1.5') {
    const scale = Math.sqrt(1.5);
    state.canvas.width = round16(baseW * scale);
    state.canvas.height = round16(baseH * scale);
  } else {
    state.canvas.width = baseW;
    state.canvas.height = baseH;
  }

  document.getElementById('dim-display').textContent = `${state.canvas.width} × ${state.canvas.height}`;

  const dimsChanged = oldWidth !== state.canvas.width || oldHeight !== state.canvas.height;
  if (dimsChanged) {
    emit('canvas:rebuild', { oldWidth, oldHeight });
  }
}

export function initSettings() {
  document.getElementById('aspect-ratio').addEventListener('change', () => {
    localStorage.setItem('ideogram_aspect_ratio', document.getElementById('aspect-ratio').value);
    updateDimensions();
  });

  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      updateDimensions();
    });
  });

  document.getElementById('mode_photo').addEventListener('change', () => { setPhotoArtMode(MODE_PHOTO); emit('state:changed'); });
  document.getElementById('mode_artstyle').addEventListener('change', () => { setPhotoArtMode(MODE_ARTSTYLE); emit('state:changed'); });

  ['box-mode', 'box-text', 'box-desc'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => { updateBoxData(); emit('state:changed'); });
  });

  // Element Type segmented toggle (Object / Text) — writes the hidden #box-mode input
  document.querySelectorAll('#box-mode-toggle .mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hidden = document.getElementById('box-mode');
      hidden.value = btn.dataset.mode;
      syncModeToggle(btn.dataset.mode);
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
    });
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

  // Workflow engine — Turbo (turbotime) vs Classic (v1 dual-model). Toggle lives in the top toolbar.
  const savedWorkflow = localStorage.getItem('ideogram_workflow');
  if (savedWorkflow === 'v1') {
    document.getElementById('workflow-classic').checked = true;
    state.workflow = 'v1';
  }
  document.querySelectorAll('input[name="workflow"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.workflow = radio.value;
      localStorage.setItem('ideogram_workflow', radio.value);
      syncTurboStrengthVisibility();
    });
  });

  // Generation backend — RunPod vs Modal. Persisted; default RunPod.
  if (localStorage.getItem('ideogram_backend') === 'modal') {
    document.getElementById('backend-modal').checked = true;
  }
  document.querySelectorAll('input[name="backend"]').forEach(radio => {
    radio.addEventListener('change', () => {
      localStorage.setItem('ideogram_backend', radio.value);
    });
  });

  // Turbo strength — persisted; the whole row is hidden when workflow != turbo (Classic)
  const savedTurboStrength = localStorage.getItem('ideogram_turbo_strength');
  if (savedTurboStrength !== null) {
    const val = parseFloat(savedTurboStrength);
    if (!isNaN(val)) {
      state.turboStrength = val;
      document.getElementById('turbo-strength').value = val;
    }
  }
  document.getElementById('turbo-strength').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      state.turboStrength = val;
      localStorage.setItem('ideogram_turbo_strength', val.toString());
    }
  });

  // Show/hide the Turbo Strength row based on the current workflow
  function syncTurboStrengthVisibility() {
    const group = document.getElementById('turbo-strength-group');
    if (!group) return;
    group.style.display = state.workflow === 'turbo' ? '' : 'none';
  }
  syncTurboStrengthVisibility();

  on('style-preset:applied', ({ preset }) => {
    const mode = preset.mode;
    document.getElementById('mode_' + (mode === 'photo' ? 'photo' : 'artstyle')).checked = true;
    setPhotoArtMode(mode);
    // Only overwrite fields the preset actually specifies; leave others as-is.
    if (preset.aesthetics) document.getElementById('aesthetics').value = preset.aesthetics;
    if (preset.lighting) document.getElementById('lighting').value = preset.lighting;
    if (preset.medium) document.getElementById('medium').value = preset.medium;
    if (preset.photo_art) document.getElementById('art_style').value = preset.photo_art;
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
      syncModeToggle(box.mode);
      document.getElementById('box-text').value = box.text;
      document.getElementById('box-desc').value = box.desc;
      document.getElementById('text-input-group').style.display = box.mode === 'text' ? 'block' : 'none';
      populateGeometry(box);
      document.getElementById('recaption-group').style.display = state.imageDataUrl ? 'block' : 'none';
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
      const raw = parseFloat(document.getElementById(id).value);
      if (isNaN(raw)) return;
      const cw = state.canvas.width, ch = state.canvas.height;
      const max = (id === 'box-x' || id === 'box-w') ? cw : ch;
      const v = Math.min(max, Math.max(0, raw));
      if (v !== raw) document.getElementById(id).value = v;
      if (id === 'box-x') box.x = (v / cw) * 1000;
      else if (id === 'box-y') box.y = (v / ch) * 1000;
      else if (id === 'box-w') box.w = (v / cw) * 1000;
      else if (id === 'box-h') box.h = (v / ch) * 1000;
      emit('box:geometry', { id: box.id });
    });
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

  initRecaption();

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

function syncModeToggle(mode) {
  document.querySelectorAll('#box-mode-toggle .mode-btn').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
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
