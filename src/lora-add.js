// lora-add.js — "+ Add" LoRA form: URL or local .safetensors file. Files stream
// to server.py (/api/lora/upload), which pushes them to the Modal volume and/or
// the private HF repo. New entries reach lora.js via the `lora:added` event.

import { state } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';

let targetsFetched = false;

// Same normalization the worker's _sanitize_filename applies on download
function filenameFromUrl(url) {
  let name = url.split('#')[0].split('?')[0].split('/').pop() || 'lora.safetensors';
  name = name.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!name.endsWith('.safetensors')) name += '.safetensors';
  return name;
}

function form() {
  return document.getElementById('lora-add-form');
}

function source() {
  const checked = document.querySelector('input[name="lora_add_source"]:checked');
  return checked ? checked.value : 'url';
}

function openForm() {
  const f = form();
  if (!f) return;
  f.hidden = false;
  document.getElementById('lora-add-model').value = state.model;
  if (!targetsFetched) fetchTargets();
}

function syncSourceInputs() {
  const isUrl = source() === 'url';
  document.getElementById('lora-add-url').style.display = isUrl ? '' : 'none';
  const file = document.getElementById('lora-add-file');
  file.style.display = isUrl ? 'none' : '';
}

async function fetchTargets() {
  try {
    const resp = await fetch('/api/lora/targets');
    const targets = await resp.json();
    targetsFetched = true;
    if (!targets.modal && !targets.hf) {
      const file = document.getElementById('lora-add-file');
      file.disabled = true;
      document.getElementById('lora-add-hint').textContent =
        'No upload target configured — add modal.lora_volume or huggingface.lora_repo to the credentials.';
    }
  } catch {
    document.getElementById('lora-add-hint').textContent = 'Could not reach the server — file upload unavailable.';
  }
}

function addFromUrl() {
  const url = document.getElementById('lora-add-url').value.trim();
  if (!url) {
    showToast('Enter a LoRA URL.', 'warning');
    return;
  }
  const filename = filenameFromUrl(url);
  const label = document.getElementById('lora-add-label').value.trim() || filename.replace('.safetensors', '');
  emit('lora:added', {
    entry: {
      id: `user-${Date.now()}`,
      label,
      model: document.getElementById('lora-add-model').value,
      filename,
      source_url: url.replace('/blob/', '/resolve/'),
      strengths: { positive: 1.0, unconditional: 0.5 },
    },
  });
  showToast(`Added "${label}" to the library.`, 'success');
  closeForm();
}

function uploadFile() {
  const fileInput = document.getElementById('lora-add-file');
  const file = fileInput.files[0];
  if (!file) {
    showToast('Choose a .safetensors file.', 'warning');
    return;
  }
  const model = document.getElementById('lora-add-model').value;
  const label = document.getElementById('lora-add-label').value.trim() || file.name.replace(/\.safetensors$/i, '');
  const hint = document.getElementById('lora-add-hint');
  const confirmBtn = document.getElementById('btn-lora-add-confirm');
  confirmBtn.disabled = true;

  // XHR (not fetch) for upload progress
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/lora/upload?name=${encodeURIComponent(file.name)}&model=${model}`);
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      hint.textContent = `Uploading… ${Math.round((e.loaded / e.total) * 100)}%`;
    }
  });
  xhr.addEventListener('load', () => {
    confirmBtn.disabled = false;
    try {
      const resp = JSON.parse(xhr.responseText);
      if (xhr.status !== 200) {
        hint.textContent = '';
        showToast(resp.error || `Upload failed (${xhr.status}).`, 'error');
        return;
      }
      emit('lora:added', {
        entry: {
          id: `user-${Date.now()}`,
          label,
          model,
          filename: resp.filename,
          source_url: resp.source_url ?? null,
          strengths: { positive: 1.0, unconditional: 0.5 },
        },
      });
      hint.textContent = resp.warnings?.length ? resp.warnings.join(' ') : '';
      showToast(`Uploaded "${label}"${resp.source_url ? ' to ' + resp.targets.join(' + ') : ''}.`, 'success');
      closeForm();
    } catch {
      showToast('Upload response was not valid JSON.', 'error');
    }
  });
  xhr.addEventListener('error', () => {
    confirmBtn.disabled = false;
    hint.textContent = '';
    showToast('Upload failed — server unreachable.', 'error');
  });
  xhr.send(file);
}

function closeForm() {
  const f = form();
  if (!f) return;
  f.hidden = true;
  ['lora-add-label', 'lora-add-url'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('lora-add-file').value = '';
  document.getElementById('lora-add-hint').textContent = '';
}

export function initLoraAdd() {
  const addBtn = document.getElementById('btn-lora-add');
  if (!addBtn) return;

  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (form().hidden) openForm();
    else closeForm();
  });

  document.querySelectorAll('input[name="lora_add_source"]').forEach(radio => {
    radio.addEventListener('change', syncSourceInputs);
  });
  syncSourceInputs();

  document.getElementById('btn-lora-add-confirm').addEventListener('click', () => {
    if (source() === 'url') addFromUrl();
    else uploadFile();
  });

  // Keep the model select in sync when the workspace switches while open
  on('model:changed', () => {
    const select = document.getElementById('lora-add-model');
    if (select && !form().hidden) select.value = state.model;
  });
}
