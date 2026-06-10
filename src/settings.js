// settings.js — Photo/art mode toggle, slider bindings, box form management

import { state, MODE_PHOTO, MODE_ARTSTYLE } from './state.js';
import { on } from './events.js';

export function initSettings() {
  // Slider listeners — update display + state
  document.getElementById('canvas-width').addEventListener('input', (e) => {
    document.getElementById('w-val').textContent = e.target.value.toString().padStart(4, '0');
    state.canvas.width = parseInt(e.target.value);
  });

  document.getElementById('canvas-height').addEventListener('input', (e) => {
    document.getElementById('h-val').textContent = e.target.value.toString().padStart(4, '0');
    state.canvas.height = parseInt(e.target.value);
  });

  document.getElementById('r-seed').addEventListener('input', (e) => {
    document.getElementById('r-seed-value').textContent = e.target.value.toString().padStart(5, '0');
  });

  // Mode toggle
  document.getElementById('mode_photo').addEventListener('change', () => setPhotoArtMode(MODE_PHOTO));
  document.getElementById('mode_artstyle').addEventListener('change', () => setPhotoArtMode(MODE_ARTSTYLE));

  // Box form — update state on every input change
  ['box-mode', 'box-text', 'box-desc'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateBoxData);
  });

  // React to box selection — populate form
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
    } else {
      boxPanel.style.display = 'none';
    }
  });

  // React to state load — restore form values
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
    document.getElementById('mode_label').innerText = 'Photo';
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
}
