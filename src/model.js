// model.js — Workspace switch between Ideogram 4 and MOSS-Image.
// Owns #model-toggle; other modules request switches via the `model:set` event
// (no sibling feature imports).

import { state, MODEL_IDEOGRAM, MODEL_MOSS } from './state.js';
import { on, emit } from './events.js';

/**
 * Switch the active model. Updates state, the body attribute, the radio,
 * localStorage, and emits `model:changed { model, previous }` (unless silent).
 */
export function setModel(model, { silent } = {}) {
  if (model !== MODEL_IDEOGRAM && model !== MODEL_MOSS) return;
  const previous = state.model;
  state.model = model;
  document.body.dataset.model = model;
  const radio = document.querySelector(`input[name="model"][value="${model}"]`);
  if (radio) radio.checked = true;
  localStorage.setItem('ideogram_model', model);
  if (!silent && model !== previous) {
    emit('model:changed', { model, previous });
  }
}

export function initModel() {
  on('model:set', ({ model }) => setModel(model));

  document.querySelectorAll('input[name="model"]').forEach((radio) => {
    radio.addEventListener('change', () => setModel(radio.value));
  });

  const saved = localStorage.getItem('ideogram_model');
  setModel(saved === MODEL_MOSS ? MODEL_MOSS : MODEL_IDEOGRAM, { silent: true });
}
