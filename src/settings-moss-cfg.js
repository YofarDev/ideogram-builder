// settings-moss-cfg.js — MOSS custom CFG override input (split of
// settings-moss). Empty input = the selected preset's default; valid range
// matches the server-side gate (handler rejects anything outside 1–10).
// Imports by settings-moss.js to keep initSettingsMoss focused on field
// bindings; negative-prompt availability follows the effective CFG.

import { state } from './state.js';
import { showToast } from './toast.js';
import { presetCfg } from './moss-presets.js';
import { refreshNegativePromptUI } from './settings-moss.js';

export const CFG_MIN = 1;
export const CFG_MAX = 10;

/** Placeholder mirrors the selected preset's default so "empty = default" is
 * visible at a glance. */
export function syncCfgPlaceholder() {
  const input = document.getElementById('moss-cfg');
  if (!input) return;
  const cfg = presetCfg(state.moss.preset);
  input.placeholder = cfg !== undefined ? String(cfg) : '';
  input.title = `Empty = preset default (${cfg !== undefined ? cfg : 'n/a'}). ` +
    'Custom values sample at this CFG with the preset\'s steps/sampler.';
}

export function initMossCfgControls() {
  const cfgInput = document.getElementById('moss-cfg');
  const savedCfg = localStorage.getItem('ideogram_moss_cfg');
  if (savedCfg !== null && savedCfg !== '') {
    const val = parseFloat(savedCfg);
    if (!isNaN(val) && val >= CFG_MIN && val <= CFG_MAX) {
      state.moss.cfg = val;
      if (cfgInput) cfgInput.value = savedCfg;
    }
  }
  cfgInput?.addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    if (raw === '') {
      state.moss.cfg = null;
      localStorage.setItem('ideogram_moss_cfg', '');
      refreshNegativePromptUI();
      return;
    }
    const val = parseFloat(raw);
    if (isNaN(val) || val < CFG_MIN || val > CFG_MAX) {
      showToast(`CFG must be between ${CFG_MIN} and ${CFG_MAX}. Leave empty to use the preset default.`, 'warning');
      e.target.value = state.moss.cfg !== null && state.moss.cfg !== undefined ? String(state.moss.cfg) : '';
      return;
    }
    state.moss.cfg = val;
    localStorage.setItem('ideogram_moss_cfg', String(val));
    refreshNegativePromptUI();
  });
  syncCfgPlaceholder();
}
