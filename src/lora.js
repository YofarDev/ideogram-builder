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
  sel.innerHTML = '<option value="">— none —</option>' +
    library.map(l => `<option value="${l.id}">${l.label || l.filename}</option>`).join('');
  sel.value = library.some(l => l.id === prev) ? prev : (activeId || '');
}

// Selecting a LoRA from the dropdown activates it immediately;
// picking "— none —" clears it. (No separate "Use" button.)
function selectLora(id) {
  if (!id) {
    selectedId = null;
    clearActive();
    setConfigEnabled(false);
    return;
  }
  const entry = getEntry(id);
  if (!entry) return;
  selectedId = id;
  activeId = id;
  state.loras = [{
    filename: entry.filename,
    source_url: entry.source_url,
    strengths: { ...entry.strengths },
  }];
  emit('lora:selected', { overrides: { ...entry.overrides } });
  document.getElementById('lora-active-label').textContent = entry.label || entry.filename;
  document.getElementById('lora-positive').value = entry.strengths.positive;
  setConfigEnabled(true);
}

function clearActive() {
  if (!activeId) return;
  activeId = null;
  state.loras = [];
  emit('lora:cleared');
  document.getElementById('lora-active-label').textContent = 'none';
}

function setConfigEnabled(enabled) {
  const strength = document.getElementById('lora-positive');
  const del = document.getElementById('lora-delete');
  if (strength) strength.disabled = !enabled;
  if (del) del.disabled = !enabled;
}

function toggleAddRow() {
  const row = document.getElementById('lora-add-row');
  if (!row) return;
  const open = row.style.display === 'none';
  row.style.display = open ? 'flex' : 'none';
  if (open) document.getElementById('lora-new-url').focus();
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
  document.getElementById('lora-new-url').value = '';
  document.getElementById('lora-new-label').value = '';
  document.getElementById('lora-add-row').style.display = 'none';
  selectLora(entry.id);
  document.getElementById('lora-select').value = entry.id;
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
  setConfigEnabled(false);
  document.getElementById('lora-positive').value = 1;
  showToast(`Removed ${entry?.label || 'lora'}.`, 'info');
}

function updateStrength(value) {
  const entry = getEntry(selectedId);
  if (!entry) return;
  entry.strengths.positive = parseFloat(value);
  saveLibrary(library);
  if (selectedId === activeId && state.loras[0]) {
    state.loras[0].strengths = { ...entry.strengths };
  }
}

export function initLora() {
  library = loadLibrary();
  activeId = null;
  selectedId = null;

  populateSelect();
  setConfigEnabled(false);

  document.getElementById('lora-select').addEventListener('change', (e) => selectLora(e.target.value));
  document.getElementById('lora-add').addEventListener('click', toggleAddRow);
  document.getElementById('lora-add-confirm').addEventListener('click', addFromUrl);
  document.getElementById('lora-delete').addEventListener('click', deleteSelected);
  document.getElementById('lora-positive').addEventListener('input', (e) => updateStrength(e.target.value));

  on('canvas:reset', clearActive);
}
