import { state, MODE_PHOTO, MODE_ARTSTYLE } from './state.js';
import { on, emit } from './events.js';

export function initSettings() {
  document.getElementById('aspect-ratio').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    state.canvas.width = w;
    state.canvas.height = h;
    document.getElementById('dim-display').textContent = `${w} × ${h}`;
    emit('canvas:rebuild');
    localStorage.setItem('ideogram_aspect_ratio', e.target.value);
  });

  document.getElementById('mode_photo').addEventListener('change', () => { setPhotoArtMode(MODE_PHOTO); emit('state:changed'); });
  document.getElementById('mode_artstyle').addEventListener('change', () => { setPhotoArtMode(MODE_ARTSTYLE); emit('state:changed'); });

  ['box-mode', 'box-text', 'box-desc'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => { updateBoxData(); emit('state:changed'); });
  });

  ['high_level_description', 'aesthetics', 'lighting', 'medium', 'art_style', 'background'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => emit('state:changed'));
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
    } else {
      boxPanel.style.display = 'none';
    }
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
