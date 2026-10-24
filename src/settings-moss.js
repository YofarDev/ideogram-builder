// settings-moss.js — MOSS global fields: prompt format, caption, meta, canvas,
// negative prompt. Reads/writes the DOM inputs directly (same pattern as the
// Ideogram fields); json-builder reads the same ids.

import { state, MODE_PHOTO, MODEL_MOSS } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { ideogramGlobalsToMoss, mossGlobalsToIdeogram } from './prompt-convert.js';

const MOSS_INPUTS = ['moss-caption', 'moss-meta', 'moss-canvas', 'moss-negative'];

function readIdeogramGlobals() {
  const art = document.getElementById('art_style')?.value || '';
  const photo = state.photoArtMode === MODE_PHOTO ? art : '';
  return {
    high_level_description: document.getElementById('high_level_description')?.value || '',
    background: document.getElementById('background')?.value || '',
    medium: document.getElementById('medium')?.value || '',
    aesthetics: document.getElementById('aesthetics')?.value || '',
    lighting: document.getElementById('lighting')?.value || '',
    photo,
    art_style: photo ? '' : art,
  };
}

function setPromptMode(mode) {
  state.moss.promptMode = mode;
  document.body.dataset.mossPrompt = mode;
  const radio = document.querySelector(`input[name="moss_prompt_mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  emit('state:changed');
}

// D4: on switch, auto-convert globals when the target's fields are empty and
// the source's aren't. Never overwrite non-empty fields.
function seedGlobals({ model }) {
  if (model === MODEL_MOSS) {
    const captionInput = document.getElementById('moss-caption');
    if (!captionInput || captionInput.value.trim()) return;
    const source = readIdeogramGlobals();
    const { caption, meta } = ideogramGlobalsToMoss(source);
    if (!caption && meta.length === 0) return;
    captionInput.value = caption;
    document.getElementById('moss-meta').value = meta.join(', ');
    showToast('Converted Ideogram fields to MOSS (background merged into caption).', 'info');
  } else {
    const hld = document.getElementById('high_level_description');
    const caption = document.getElementById('moss-caption')?.value || '';
    if (!hld || hld.value.trim() || !caption.trim()) return;
    const { medium, aesthetics } = mossGlobalsToIdeogram({
      caption,
      meta: (document.getElementById('moss-meta')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
    });
    hld.value = caption;
    const mediumInput = document.getElementById('medium');
    if (!mediumInput.value.trim()) mediumInput.value = medium;
    const aestheticsInput = document.getElementById('aesthetics');
    if (!aestheticsInput.value.trim()) aestheticsInput.value = aesthetics;
    showToast('Converted MOSS caption to Ideogram fields.', 'info');
  }
}

export function initSettingsMoss() {
  MOSS_INPUTS.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => emit('state:changed'));
  });

  document.querySelectorAll('input[name="moss_prompt_mode"]').forEach((radio) => {
    radio.addEventListener('change', () => setPromptMode(radio.value));
  });
  document.body.dataset.mossPrompt = state.moss.promptMode;

  on('model:changed', seedGlobals);

  on('state:loaded', ({ moss }) => {
    if (!moss) return;
    document.getElementById('moss-caption').value = moss.caption || '';
    document.getElementById('moss-meta').value = (moss.meta || []).join(', ');
    document.getElementById('moss-canvas').value = moss.canvas || '';
    if (moss.negative !== undefined) {
      document.getElementById('moss-negative').value = moss.negative;
    }
  });
}

export { setPromptMode };
