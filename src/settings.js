import { state, MODE_PHOTO, MODE_ARTSTYLE } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { initRecaption } from './settings-recaption.js';
import { initBoxForm } from './settings-box.js';

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
  } else if (size === '4') {
    const longSide = Math.max(baseW, baseH);
    const scale = 4096 / longSide;
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

  ['high_level_description', 'aesthetics', 'lighting', 'medium', 'art_style', 'background'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => emit('state:changed'));
  });

  // Step preset (Turbo / Default / Quality) — drives mu/std/num_steps in the workflow
  document.querySelectorAll('input[name="steps"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.dataset.preset) state.preset = radio.dataset.preset;
    });
  });

  // MOSS preset (Turbo β / Fast / Quality) — resolved server-side in handler.py
  const savedMossPreset = localStorage.getItem('ideogram_moss_preset');
  if (['Turbo', 'Fast', 'Quality', 'Rapid', 'Draft3', 'FastSpectrum', 'QualitySpectrum', 'Poster', 'Quality30'].includes(savedMossPreset)) {
    state.moss.preset = savedMossPreset;
    const radio = document.querySelector(`input[name="moss_preset"][value="${savedMossPreset}"]`);
    if (radio) radio.checked = true;
  }
  document.querySelectorAll('input[name="moss_preset"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.moss.preset = radio.value;
      localStorage.setItem('ideogram_moss_preset', radio.value);
    });
  });

  // MOSS tops out ~4M total pixels — the 4M tier (up to 9.4M) is Ideogram-only.
  // Switching to MOSS with 4M active falls back to 2M and re-runs the resize.
  on('model:changed', ({ model }) => {
    if (model !== 'moss') return;
    const active = document.querySelector('.size-btn.active');
    if (active?.dataset.size === '4') {
      const twoM = document.querySelector('.size-btn[data-size="2"]');
      if (twoM) twoM.click();
    }
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
      emit('backend:changed', { backend: radio.value });
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
  initBoxForm();

  setPhotoArtMode(MODE_ARTSTYLE);
}

function setPhotoArtMode(mode) {
  state.photoArtMode = mode;
  if (mode === MODE_PHOTO) {
    document.getElementById('medium').value = 'photograph';
    document.getElementById('mode_label').innerText = 'Photo Style';
  } else {
    document.getElementById('medium').disabled = false;
    document.getElementById('mode_label').innerText = 'Art Style';
  }
}
