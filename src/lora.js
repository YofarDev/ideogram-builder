// lora.js — LoRA library (localStorage), selection, override application
// Owns the lora panel DOM. Talks to rest of app via events + state only.

import { state } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';

const STORAGE_KEY = 'ideogram_loras';

const KIKI_SEED = {
  id: 'kiki',
  label: 'Kiki (Studio Ghibli)',
  filename: 'kiki_ideogram4_v1.safetensors',
  source_url: 'https://huggingface.co/Yofardev/kiki_ideogram4_v1/resolve/main/kiki_ideogram4_v1.safetensors',
  strengths: { positive: 1.0, unconditional: 0.5 },
  overrides: { art_style: 'Studio Ghibli style', medium: 'anime_screencap' },
};

function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([KIKI_SEED]));
      return [KIKI_SEED];
    }
    const lib = JSON.parse(raw);
    // Migrate the kiki seed forward if its filename/url are stale or missing
    const kiki = lib.find(l => l.id === 'kiki');
    if (kiki && (kiki.filename !== KIKI_SEED.filename || !kiki.source_url)) {
      kiki.filename = KIKI_SEED.filename;
      kiki.source_url = KIKI_SEED.source_url;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
    }
    return lib;
  } catch {
    return [KIKI_SEED];
  }
}

function saveLibrary(lib) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
}

// Mirror handler.py _sanitize_filename so client and worker agree on the name
function sanitizeFilename(url) {
  let name = url.split('/').pop().split('?')[0];
  name = name.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!name) name = 'lora.safetensors';
  if (!name.endsWith('.safetensors')) name += '.safetensors';
  return name;
}

function newId() {
  return 'lora_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

let library = [];
let activeId = null;
let selectedId = null;

function getEntry(id) {
  return library.find(l => l.id === id);
}

function populateSelect() {
  const sel = document.getElementById('lora-select');
  const prev = selectedId || sel.value;
  sel.innerHTML = '<option value="">— select a lora —</option>' +
    library.map(l => `<option value="${l.id}">${l.label || l.filename}</option>`).join('');
  sel.value = library.some(l => l.id === prev) ? prev : '';
}

function loadConfigIntoPanel(entry) {
  if (!entry) {
    setConfigEnabled(false);
    return;
  }
  setConfigEnabled(true);
  document.getElementById('lora-positive').value = entry.strengths.positive;
  document.getElementById('lora-positive-val').textContent = entry.strengths.positive.toFixed(2);
  document.getElementById('lora-art-style').value = entry.overrides.art_style || '';
  document.getElementById('lora-aesthetics').value = entry.overrides.aesthetics || '';
  document.getElementById('lora-medium').value = entry.overrides.medium || '';
}

function setConfigEnabled(enabled) {
  ['lora-positive', 'lora-art-style', 'lora-aesthetics', 'lora-medium',
   'lora-use', 'lora-delete'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

function syncActiveEntry() {
  if (!activeId) return;
  const entry = getEntry(activeId);
  if (!entry) return;
  // Keep state.loras in sync with edited strengths
  if (state.loras[0]) {
    state.loras[0].strengths = { ...entry.strengths };
  }
}

function useSelected() {
  const entry = getEntry(selectedId);
  if (!entry) {
    showToast('Pick a lora first.', 'error');
    return;
  }
  activeId = entry.id;
  state.loras = [{
    filename: entry.filename,
    source_url: entry.source_url,
    strengths: { ...entry.strengths },
  }];
  emit('lora:selected', { overrides: { ...entry.overrides } });
  document.getElementById('lora-active-label').textContent = entry.label || entry.filename;
  showToast(`LoRA active: ${entry.label || entry.filename}`, 'info');
}

function clearActive() {
  if (!activeId) return;
  activeId = null;
  state.loras = [];
  emit('lora:cleared');
  document.getElementById('lora-active-label').textContent = 'none';
}

function addFromUrl() {
  const url = document.getElementById('lora-new-url').value.trim();
  const label = document.getElementById('lora-new-label').value.trim();
  if (!url) {
    showToast('Paste a resolve URL first.', 'error');
    return;
  }
  const entry = {
    id: newId(),
    label: label || sanitizeFilename(url).replace(/\.safetensors$/, ''),
    filename: sanitizeFilename(url),
    source_url: url,
    strengths: { positive: 1.0, unconditional: 0.5 },
    overrides: {},
  };
  library.push(entry);
  saveLibrary(library);
  populateSelect();
  document.getElementById('lora-select').value = entry.id;
  selectedId = entry.id;
  loadConfigIntoPanel(entry);
  document.getElementById('lora-new-url').value = '';
  document.getElementById('lora-new-label').value = '';
  showToast(`Added ${entry.label}.`, 'success');
}

function deleteSelected() {
  if (!selectedId) return;
  const entry = getEntry(selectedId);
  if (selectedId === activeId) clearActive();
  library = library.filter(l => l.id !== selectedId);
  saveLibrary(library);
  selectedId = null;
  populateSelect();
  loadConfigIntoPanel(null);
  showToast(`Removed ${entry?.label || 'lora'}.`, 'info');
}

function updateEntry(field, value) {
  const entry = getEntry(selectedId);
  if (!entry) return;
  if (field === 'positive' || field === 'unconditional') {
    entry.strengths[field] = parseFloat(value);
    document.getElementById(`lora-${field}-val`).textContent = entry.strengths[field].toFixed(2);
  } else {
    entry.overrides[field] = value;
  }
  saveLibrary(library);
  syncActiveEntry();
  // Override text edits on the active lora also push into the main form live
  if (selectedId === activeId && (field === 'art_style' || field === 'aesthetics' || field === 'medium')) {
    const el = document.getElementById(field);
    if (el) {
      el.value = value;
      emit('state:changed');
    }
  }
}

export function initLora() {
  library = loadLibrary();
  activeId = null;
  selectedId = null;

  populateSelect();
  loadConfigIntoPanel(null);

  document.getElementById('lora-select').addEventListener('change', (e) => {
    selectedId = e.target.value;
    loadConfigIntoPanel(getEntry(selectedId));
  });
  document.getElementById('lora-use').addEventListener('click', useSelected);
  document.getElementById('lora-clear').addEventListener('click', clearActive);
  document.getElementById('lora-add').addEventListener('click', addFromUrl);
  document.getElementById('lora-delete').addEventListener('click', deleteSelected);

  document.getElementById('lora-positive').addEventListener('input', (e) => updateEntry('positive', e.target.value));

  // element id → entry override key (art_style has a dash in the DOM id)
  const overrideFields = { 'lora-art-style': 'art_style', 'lora-aesthetics': 'aesthetics', 'lora-medium': 'medium' };
  Object.entries(overrideFields).forEach(([elId, key]) => {
    document.getElementById(elId).addEventListener('input', (e) => updateEntry(key, e.target.value));
  });

  on('canvas:reset', clearActive);
}
