// json-builder.js — Generate Ideogram4 JSON prompt from state

import { state, MODE_PHOTO } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';

let isLoadingFromJSON = false;

export function initJsonBuilder() {
  on('canvas:reset', () => {
    console.log('[json-builder] canvas:reset — clearing textarea');
    document.getElementById('json-output').value = '';
  });

  on('state:changed', () => {
    console.log('[json-builder] state:changed → generateJSON');
    if (!isLoadingFromJSON) generateJSON();
  });

  on('state:loaded', () => {
    // No-op: each state:loaded caller sets #json-output itself before emitting
    // (see gallery.loadItem, collections.loadItemToEditor). generateJSON() here
    // would run before canvas rebuilds boxes → stale output.
  });

  // Capture textarea value on pointerdown, before canvas pointerup
  // can overwrite it via state:changed → generateJSON().
  let capturedRaw = '';
  document.getElementById('btn-load-json').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capturedRaw = document.getElementById('json-output').value;
  });

  document.getElementById('btn-load-json').addEventListener('click', () => {
    applyJsonText(capturedRaw, 'btn-load-json');
  });

  document.getElementById('btn-paste-json').addEventListener('click', async () => {
    const btn = document.getElementById('btn-paste-json');
    const text = await readClipboard();
    if (text == null) {
      showToast('Clipboard blocked — click the textarea and press Cmd+V.', 'warning');
      const out = document.getElementById('json-output');
      out.focus();
      return;
    }
    if (!text.trim()) {
      showToast('Clipboard is empty.', 'warning');
      flashError(btn);
      return;
    }
    document.getElementById('json-output').value = text;
    if (applyJsonText(text, 'btn-paste-json')) {
      showToast('JSON pasted and applied.', 'success', 1500);
    } else {
      showToast('Clipboard has no valid prompt JSON.', 'error');
    }
  });

  document.getElementById('btn-copy-json').addEventListener('click', () => {
    const output = document.getElementById('json-output');
    if (!output.value.trim()) return;
    navigator.clipboard.writeText(output.value).then(() => {
      const btn = document.getElementById('btn-copy-json');
      const original = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    });
  });
}

function applyJsonText(raw, btnId) {
  try {
    const json = JSON.parse(raw);
    if (!json.high_level_description && !json.style_description && !json.compositional_deconstruction) {
      flashError(document.getElementById(btnId));
      return false;
    }
    isLoadingFromJSON = true;
    emit('state:loaded', { json });
    isLoadingFromJSON = false;
    generateJSON();
    return true;
  } catch {
    flashError(document.getElementById(btnId));
    return false;
  }
}

async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

function flashError(btn) {
  if (!btn) return;
  btn.style.color = 'var(--danger)';
  setTimeout(() => { btn.style.color = ''; }, 1200);
}

export function generateJSON() {
  const canvasW = state.canvas.width;
  const canvasH = state.canvas.height;

  // Sync box positions from DOM → state (normalize to 0-1000)
  state.boxes.forEach((box) => {
    const dom = document.getElementById(box.id);
    if (dom) {
      box.x = (parseFloat(dom.style.left) / canvasW) * 1000;
      box.y = (parseFloat(dom.style.top) / canvasH) * 1000;
      box.w = (parseFloat(dom.style.width) / canvasW) * 1000;
      box.h = (parseFloat(dom.style.height) / canvasH) * 1000;
    }
  });

  // Values already in 0-1000, just clamp
  const clamp = (v) => Math.min(1000, Math.max(0, Math.round(v)));

  const elements = state.boxes.map((box) => {
    const x1 = clamp(box.x);
    const y1 = clamp(box.y);
    const x2 = clamp(box.x + box.w);
    const y2 = clamp(box.y + box.h);

    const el = { type: box.mode, bbox: [y1, x1, y2, x2] };
    if (box.mode === 'text') el.text = box.text;
    el.desc = box.desc;
    if (box.colors?.length > 0) el.color_palette = box.colors;
    return el;
  });

  const output = {
    high_level_description: document.getElementById('high_level_description').value,
    style_description: {
      aesthetics: document.getElementById('aesthetics').value,
      lighting: document.getElementById('lighting').value,
    },
    compositional_deconstruction: {
      background: document.getElementById('background').value,
      elements,
    },
  };

  // Photo mode: photo then medium. Art mode: medium then art_style
  if (state.photoArtMode === MODE_PHOTO) {
    output.style_description.photo = document.getElementById('art_style').value;
    output.style_description.medium = document.getElementById('medium').value;
  } else {
    output.style_description.medium = document.getElementById('medium').value;
    output.style_description.art_style = document.getElementById('art_style').value;
  }

  output.style_description.color_palette = state.globalPalette;
  document.getElementById('json-output').value = JSON.stringify(output, null, 2);
}
