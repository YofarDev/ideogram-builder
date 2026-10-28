// session-moss.js — MOSS half of session persistence: model, MOSS field
// inputs, prompt mode and preset. Split from session.js (LOC limit).

import { state, MODEL_MOSS } from './state.js';
import { emit } from './events.js';
import { capabilitiesPending, isAvailable, presetLabel } from './moss-presets.js';
import { showToast } from './toast.js';

/** Capture the MOSS config from the live DOM (only meaningful in moss mode). */
export function captureMossConfig() {
  const el = (id) => document.getElementById(id);
  return {
    model: document.body.dataset.model === 'moss' ? MODEL_MOSS : 'ideogram',
    ...(document.body.dataset.model === 'moss' ? {
      mossPreset: document.querySelector('input[name="moss_preset"]:checked')?.value || 'Fast',
      mossPromptMode: document.body.dataset.mossPrompt === 'caption' ? 'caption' : 'layout',
      moss: {
        caption: el('moss-caption')?.value || '',
        meta: el('moss-meta')?.value || '',
        canvas: el('moss-canvas')?.value || '',
        negative: el('moss-negative')?.value || '',
      },
    } : {}),
  };
}

/**
 * Restore the MOSS side of a session: switch model first (content restores
 * after this and must render in the right format), then fill the inputs.
 * Returns true when the session was a MOSS session.
 */
export function restoreMoss(config) {
  if (config.model !== MODEL_MOSS) return false;

  // Model BEFORE content — json-builder regenerates in the new format and
  // seed:false keeps D4 seeding from overwriting the saved fields below.
  emit('model:set', { model: MODEL_MOSS, seed: false });

  const m = config.moss || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && v !== undefined) el.value = v;
  };
  set('moss-caption', m.caption);
  set('moss-meta', m.meta);
  set('moss-canvas', m.canvas);
  set('moss-negative', m.negative);

  const pm = config.mossPromptMode === 'caption' ? 'caption' : 'layout';
  state.moss.promptMode = pm;
  document.body.dataset.mossPrompt = pm;
  const pmRadio = document.querySelector(`input[name="moss_prompt_mode"][value="${pm}"]`);
  if (pmRadio) pmRadio.checked = true;

  if (config.mossPreset) {
    state.moss.preset = config.mossPreset;
    localStorage.setItem('ideogram_moss_preset', config.mossPreset);
    const r = document.querySelector(`input[name="moss_preset"][value="${config.mossPreset}"]`);
    if (r) r.checked = true;
    // Availability-aware restore: keep the saved selection but require an
    // explicit supported choice before submission — never silently re-recipe.
    if (!capabilitiesPending() && !isAvailable(config.mossPreset)) {
      showToast(`Preset “${presetLabel(config.mossPreset)}” was saved in this session but is not available on the current backend — select a supported preset before generating.`, 'error', 5000);
    }
  }
  return true;
}
