// settings-custom-size.js — Custom canvas size: the "Custom…" aspect-ratio
// option plus W×H inputs (split of settings). Imports by settings.js; the
// canvas:custom-size event lets programmatic resizers (MOSS drafts, gallery
// restore) select Custom… without importing this module.

import { state, validCanvasSize } from './state.js';
import { on } from './events.js';
import { showToast } from './toast.js';

export const CUSTOM_AR_VALUE = 'custom';

export function readCustomBase() {
  return {
    width: parseInt(document.getElementById('custom-width')?.value, 10),
    height: parseInt(document.getElementById('custom-height')?.value, 10),
  };
}

/** Custom dims must satisfy validCanvasSize AND the ×16 grid the MOSS
 * backend enforces (server rejects other sizes with an actionable error,
 * but the input catches it earlier with a friendlier message). */
export function validCustomSize(width, height) {
  return validCanvasSize(width, height) && width % 16 === 0 && height % 16 === 0;
}

/** Show/hide the W×H row; when switching to Custom, seed the inputs from the
 * saved size if valid, else the current canvas — so selecting Custom never
 * jumps the layout. */
export function syncCustomRow() {
  const sel = document.getElementById('aspect-ratio');
  const row = document.getElementById('custom-size-row');
  if (!sel || !row) return;
  const isCustom = sel.value === CUSTOM_AR_VALUE;
  row.style.display = isCustom ? '' : 'none';
  if (!isCustom) return;
  const saved = {
    width: parseInt(localStorage.getItem('ideogram_custom_width'), 10),
    height: parseInt(localStorage.getItem('ideogram_custom_height'), 10),
  };
  const seed = validCustomSize(saved.width, saved.height)
    ? saved
    : { width: state.canvas.width, height: state.canvas.height };
  const w = document.getElementById('custom-width');
  const h = document.getElementById('custom-height');
  w.value = String(seed.width);
  h.value = String(seed.height);
  w.dataset.lastValid = String(seed.width);
  h.dataset.lastValid = String(seed.height);
}

/** Select the Custom… aspect-ratio entry for a specific size: persists the
 * choice, seeds the W×H inputs (with their revert anchors) and reveals the
 * row. updateDimensions is NOT called — callers own the canvas. */
export function selectCustomSize(width, height) {
  const sel = document.getElementById('aspect-ratio');
  if (!sel || !Array.from(sel.options).some(o => o.value === CUSTOM_AR_VALUE)) return;
  sel.value = CUSTOM_AR_VALUE;
  localStorage.setItem('ideogram_aspect_ratio', CUSTOM_AR_VALUE);
  localStorage.setItem('ideogram_custom_width', String(width));
  localStorage.setItem('ideogram_custom_height', String(height));
  const row = document.getElementById('custom-size-row');
  if (row) row.style.display = '';
  [['custom-width', width], ['custom-height', height]].forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) {
      input.value = String(value);
      input.dataset.lastValid = String(value);
    }
  });
}

export function initCustomSizeControls() {
  // Custom W×H — committed on change (blur/Enter), not per keystroke. Invalid
  // values warn and revert to the last applied size; the canvas never moves.
  ['custom-width', 'custom-height'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      const { width, height } = readCustomBase();
      if (!validCustomSize(width, height)) {
        showToast('Custom width and height must be multiples of 16 (min 16).', 'warning');
        e.target.value = e.target.dataset.lastValid || String(state.canvas.width);
        return;
      }
      e.target.dataset.lastValid = e.target.value;
      localStorage.setItem('ideogram_custom_width', String(width));
      localStorage.setItem('ideogram_custom_height', String(height));
      document.getElementById('aspect-ratio')?.dispatchEvent(new Event('change'));
    });
  });

  // Programmatic resizers route through the bus — no sibling imports.
  on('canvas:custom-size', ({ width, height }) => selectCustomSize(width, height));
}
