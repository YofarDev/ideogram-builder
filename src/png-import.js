// png-import.js — PNG metadata extraction, JSON load, drag-drop handling

import { state } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';

export function initImport() {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      importImage(e.dataTransfer.files[0]);
    }
  });
}

export function initJsonModal() {
  const overlay = document.getElementById('json-modal');
  const dropzone = document.getElementById('modal-dropzone');
  const fileInput = document.getElementById('json-file-input');
  const input = document.getElementById('json-modal-input');
  const validation = document.getElementById('modal-validation');
  const loadBtn = document.getElementById('json-modal-load');
  const browseBtn = document.getElementById('json-modal-browse');
  const cancelBtn = document.getElementById('json-modal-cancel');

  // Close button
  cancelBtn.addEventListener('click', () => closeJsonModal());

  // Overlay click to close
  overlay.addEventListener('click', (e) => {
    if (e.target.id === 'json-modal') closeJsonModal();
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeJsonModal();
  });

  // File browse
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#json-modal-browse')) return;
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleModalFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  // Drop zone drag events
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleModalFile(e.dataTransfer.files[0]);
  });

  // Live validation on textarea input
  input.addEventListener('input', () => {
    const text = input.value.trim();
    if (!text) {
      validation.textContent = '';
      validation.className = 'modal-validation';
      loadBtn.disabled = true;
      return;
    }
    try {
      const json = JSON.parse(text);
      if (validateIdeogramJson(json)) {
        const preview = summarizeJson(json);
        validation.textContent = '✓ ' + preview;
        validation.className = 'modal-validation valid';
        loadBtn.disabled = false;
      } else {
        validation.textContent = 'Not an Ideogram prompt — missing high_level_description, style_description, or compositional_deconstruction';
        validation.className = 'modal-validation invalid';
        loadBtn.disabled = true;
      }
    } catch (e) {
      validation.textContent = e.message.replace(/^JSON\.parse: /, '');
      validation.className = 'modal-validation invalid';
      loadBtn.disabled = true;
    }
  });

  // Ctrl+Enter to load
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!loadBtn.disabled) loadFromJsonModal();
    }
  });

  // Load button
  loadBtn.addEventListener('click', () => loadFromJsonModal());
}

function summarizeJson(json) {
  const parts = [];
  if (json.compositional_deconstruction?.elements?.length) {
    parts.push(json.compositional_deconstruction.elements.length + ' elements');
  }
  if (json.high_level_description) {
    const desc = json.high_level_description.substring(0, 40);
    parts.push('"' + desc + (desc.length >= 40 ? '…' : '') + '"');
  }
  return parts.length ? parts.join(' — ') : 'Valid JSON';
}

function handleModalFile(file) {
  if (file.name.endsWith('.json') || file.type === 'application/json') {
    const reader = new FileReader();
    reader.onload = () => {
      const input = document.getElementById('json-modal-input');
      input.value = reader.result;
      input.dispatchEvent(new Event('input'));
    };
    reader.readAsText(file);
  } else if (file.type === 'image/png') {
    importImage(file);
    closeJsonModal();
  } else {
    showToast('Only .json and .png files are supported.', 'error');
  }
}

export function openJsonModal() {
  const overlay = document.getElementById('json-modal');
  const input = document.getElementById('json-modal-input');
  const validation = document.getElementById('modal-validation');
  const loadBtn = document.getElementById('json-modal-load');
  input.value = '';
  validation.textContent = '';
  validation.className = 'modal-validation';
  loadBtn.disabled = true;
  overlay.classList.add('open');
  input.focus();
}

export function closeJsonModal() {
  document.getElementById('json-modal').classList.remove('open');
}

export function loadFromJsonModal() {
  const input = document.getElementById('json-modal-input');
  const text = input.value.trim();
  if (!text) {
    showToast('Please paste some JSON first.', 'error');
    return;
  }
  try {
    const json = JSON.parse(text);
    if (!validateIdeogramJson(json)) {
      showToast('JSON doesn\'t match Ideogram format.', 'error');
      return;
    }
    document.getElementById('json-output').value = JSON.stringify(json, null, 2);
    emit('state:loaded', { json });
    closeJsonModal();
    showToast('JSON loaded successfully.', 'success');
  } catch (e) {
    showToast('Invalid JSON: ' + e.message, 'error');
  }
}

function validateIdeogramJson(json) {
  if (!json || typeof json !== 'object') return false;
  return !!(
    json.high_level_description !== undefined ||
    json.style_description !== undefined ||
    json.compositional_deconstruction !== undefined
  );
}

async function importImage(file) {
  if (!file.type.startsWith('image')) {
    showToast('Only image files can be imported.', 'error');
    return;
  }

  const img = new Image();
  img.onload = function () {
    state.canvas.width = this.width;
    state.canvas.height = this.height;
    document.getElementById('dim-display').textContent = `${this.width} × ${this.height}`;
    const arSelect = document.getElementById('aspect-ratio');
    const val = `${this.width}x${this.height}`;
    if (Array.from(arSelect.options).some(o => o.value === val)) {
      arSelect.value = val;
    }

    emit('canvas:rebuild');

    const reader = new FileReader();
    reader.onload = () => {
      emit('image:ready', { imageUrl: img.src, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);

    if (file.type === 'image/png') {
      file.arrayBuffer().then((buff) => {
        const json = extractComfyUIMetadata(buff);
        if (json) {
          document.getElementById('json-output').value = JSON.stringify(json, null, 2);
          emit('state:loaded', { json });
          showToast('PNG metadata extracted.', 'success');
        }
      }).catch(() => { /* non-critical */ });
    }
  };
  img.src = URL.createObjectURL(file);
}

function extractComfyUIMetadata(arrayBuffer) {
  const view = new DataView(arrayBuffer);

  if (view.byteLength < 8 || view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
    throw new Error('Not a valid PNG file.');
  }

  let offset = 8;
  const result = {};

  while (offset < view.byteLength) {
    if (offset + 8 > view.byteLength) break;

    const length = view.getUint32(offset);
    const chunkType = String.fromCharCode(
      view.getUint8(offset + 4), view.getUint8(offset + 5),
      view.getUint8(offset + 6), view.getUint8(offset + 7),
    );
    offset += 8;

    if (chunkType === 'tEXt') {
      if (offset + length > view.byteLength) break;

      const chunkData = new Uint8Array(arrayBuffer, offset, length);
      const nullByteIndex = chunkData.indexOf(0);

      if (nullByteIndex !== -1) {
        const keyword = new TextDecoder('ascii').decode(chunkData.subarray(0, nullByteIndex));

        if (keyword === 'prompt' || keyword === 'workflow') {
          const rawText = new TextDecoder('utf-8').decode(chunkData.subarray(nullByteIndex + 1));
          try {
            result[keyword] = JSON.parse(rawText);
          } catch (e) {
            result[keyword] = rawText;
          }
        }
      }
    }

    offset += length + 4;
  }

  for (const key of Object.keys(result.prompt || {})) {
    try {
      const json = JSON.parse(result.prompt[key].inputs.text);
      if (json.hasOwnProperty('high_level_description')) return json;
    } catch (e) { /* skip */ }
  }
  return null;
}
