import { state } from './state.js';
import { on, emit } from './events.js';

const STORAGE_KEY = 'ideogram_style_presets';

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function save(presets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function populateSelect(select) {
  const presets = load();
  const current = select.value;
  select.innerHTML = '<option value="">None</option>';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}

function renderEditor() {
  const select = document.getElementById('style-preset-editor');
  if (!select) return;
  populateSelect(select);
}

function applyPreset(id) {
  if (!id) return;
  const presets = load();
  const preset = presets.find(p => p.id === id);
  if (!preset) return;
  emit('style-preset:applied', { preset });
}

export function initStylePresets() {
  const select = document.getElementById('style-preset-editor');
  if (!select) return;

  renderEditor();

  select.addEventListener('change', () => applyPreset(select.value));

  document.getElementById('btn-save-preset')?.addEventListener('click', () => {
    const nameInput = document.getElementById('preset-name-input');
    const name = nameInput?.value.trim();
    if (!name) return;
    const presets = load();
    presets.push({
      id: uid(), name,
      mode: state.photoArtMode,
      aesthetics: document.getElementById('aesthetics').value,
      lighting: document.getElementById('lighting').value,
      medium: document.getElementById('medium').value,
      photo_art: document.getElementById('art_style').value,
    });
    save(presets);
    nameInput.value = '';
    renderEditor();
  });

  document.getElementById('btn-delete-preset')?.addEventListener('click', () => {
    const id = select.value;
    if (!id) return;
    if (!confirm('Delete this preset?')) return;
    const presets = load().filter(p => p.id !== id);
    save(presets);
    renderEditor();
  });
}
