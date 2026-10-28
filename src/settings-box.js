// settings-box.js — Box Properties form: element type toggle (Object/Text/
// Character), text/desc/tags fields, X/Y/W/H pixel editors. Split from
// settings.js to keep files under the ~200 LOC architecture limit.

import { state } from './state.js';
import { on, emit } from './events.js';
import { hasReferenceImage, localImageUrl } from './reference-image.js';

export function initBoxForm() {
  on('image:ready', ({ dataUrl, imageUrl }) => {
    const group = document.getElementById('recaption-group');
    if (group) group.style.display = state.selectedBoxId && (dataUrl || localImageUrl(imageUrl)) ? 'block' : 'none';
  });
  ['box-mode', 'box-text', 'box-desc', 'box-tags'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { updateBoxData(); emit('state:changed'); });
  });

  // Element Type segmented toggle (Object / Text / Character) — writes the
  // hidden #box-mode input
  document.querySelectorAll('#box-mode-toggle .mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hidden = document.getElementById('box-mode');
      hidden.value = btn.dataset.mode;
      syncModeToggle(btn.dataset.mode);
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  on('box:selected', ({ id }) => {
    const boxPanel = document.getElementById('box-panel');
    if (!boxPanel) return;
    if (id) {
      const box = state.boxes.find(b => b.id === id);
      if (!box) return;
      boxPanel.style.display = 'block';
      document.getElementById('box-mode').value = box.mode;
      syncModeToggle(box.mode);
      document.getElementById('box-text').value = box.text;
      document.getElementById('box-desc').value = box.desc;
      const tagsInput = document.getElementById('box-tags');
      if (tagsInput) tagsInput.value = (box.tags ?? []).join(', ');
      document.getElementById('text-input-group').style.display = box.mode === 'text' ? 'block' : 'none';
      populateGeometry(box);
      document.getElementById('recaption-group').style.display = hasReferenceImage() ? 'block' : 'none';
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
      const max = id === 'box-x' ? cw * (1 - box.w / 1000)
        : id === 'box-y' ? ch * (1 - box.h / 1000)
        : id === 'box-w' ? cw * (1 - box.x / 1000) : ch * (1 - box.y / 1000);
      const v = Math.min(Math.max(0, max), Math.max(0, raw));
      if (v !== raw) document.getElementById(id).value = v;
      if (id === 'box-x') box.x = (v / cw) * 1000;
      else if (id === 'box-y') box.y = (v / ch) * 1000;
      else if (id === 'box-w') box.w = (v / cw) * 1000;
      else if (id === 'box-h') box.h = (v / ch) * 1000;
      emit('box:geometry', { id: box.id });
      emit('state:changed');
    });
  });

  // Keep X/Y/W/H in sync after canvas drag/resize
  on('state:changed', () => {
    if (!state.selectedBoxId) return;
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (box) populateGeometry(box, true);
  });

  // Re-render the element type toggle so a character box shows Object in
  // Ideogram mode
  on('model:changed', () => {
    const mode = document.getElementById('box-mode')?.value;
    if (mode) syncModeToggle(mode);
  });
}

function syncModeToggle(mode) {
  const display = mode === 'character' && state.model !== 'moss' ? 'obj' : mode;
  document.querySelectorAll('#box-mode-toggle .mode-btn').forEach((b) => {
    const on = b.dataset.mode === display;
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
  const tagsInput = document.getElementById('box-tags');
  if (tagsInput) {
    box.tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
  }
  document.getElementById('text-input-group').style.display = box.mode === 'text' ? 'block' : 'none';

  const label = document.getElementById(state.selectedBoxId)?.querySelector('.box-label');
  if (label) label.textContent = box.text || box.desc || '';
}

function populateGeometry(box, preserveFocus = false) {
  const cw = state.canvas.width, ch = state.canvas.height;
  for (const [id, value] of [['box-x', box.x * cw], ['box-y', box.y * ch], ['box-w', box.w * cw], ['box-h', box.h * ch]]) {
    const input = document.getElementById(id);
    if (!preserveFocus || input !== document.activeElement) input.value = Math.round(value / 1000);
  }
}
