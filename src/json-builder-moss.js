// json-builder-moss.js — MOSS half of the JSON pane: layout/caption output and
// the MOSS/draft/caption apply paths. Split from json-builder.js (same feature).

import { state, syncBoxesFromDOM } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';
import { buildMossLayout, parseMoss } from './prompt-moss.js';

let droppedToastShown = false;

function splitList(value) {
  return (value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function setPromptMode(mode) {
  state.moss.promptMode = mode;
  document.body.dataset.mossPrompt = mode;
  const radio = document.querySelector(`input[name="moss_prompt_mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}

export function generateMoss() {
  syncBoxesFromDOM();
  const output = document.getElementById('json-output');
  const chip = document.getElementById('json-format-chip');

  if (state.moss.promptMode === 'caption') {
    output.value = document.getElementById('moss-caption').value;
    if (chip) chip.textContent = 'MOSS caption';
    return;
  }

  // VERIFY: zero items — summary-only layout vs plain summary.caption text;
  // if the summary-only form generates worse, emit the caption alone.
  const { layout, dropped } = buildMossLayout({
    caption: document.getElementById('moss-caption').value,
    meta: splitList(document.getElementById('moss-meta')?.value),
    canvas: document.getElementById('moss-canvas')?.value || '',
    palette: state.globalPalette,
    boxes: state.boxes,
    width: state.canvas.width,
    height: state.canvas.height,
  });
  output.value = JSON.stringify(layout, null, 2);
  if (chip) chip.textContent = `MOSS layout · ${state.canvas.width}×${state.canvas.height}`;
  if (dropped > 0 && !droppedToastShown) {
    showToast(`Dropped ${dropped} zero-size box${dropped > 1 ? 'es' : ''} from the MOSS layout.`, 'warning');
    droppedToastShown = true;
  }
}

/**
 * Apply a MOSS layout JSON (compiled or captioner draft) to the editor.
 * The caller has already switched the model; emits state:loaded with the
 * Ideogram-shaped view + the MOSS globals payload.
 */
export function applyMossText(raw) {
  const json = JSON.parse(raw);
  const { view, moss, dims } = parseMoss(json, { width: state.canvas.width, height: state.canvas.height });

  // A draft carries its own canvas size — resize first so boxes land right
  // (same events png-import uses).
  if (dims && (dims.width !== state.canvas.width || dims.height !== state.canvas.height)) {
    state.canvas.width = dims.width;
    state.canvas.height = dims.height;
    document.getElementById('dim-display').textContent = `${dims.width} × ${dims.height}`;
    const arSelect = document.getElementById('aspect-ratio');
    const val = `${dims.width}x${dims.height}`;
    if (arSelect && Array.from(arSelect.options).some(o => o.value === val)) arSelect.value = val;
    emit('canvas:rebuild');
  }

  setPromptMode('layout');
  emit('state:loaded', { json: view, moss });
}

/** Plain caption while MOSS is active: fill the caption field, switch mode. */
export function applyCaptionText(text) {
  document.getElementById('moss-caption').value = text;
  setPromptMode('caption');
  emit('state:changed');
}
