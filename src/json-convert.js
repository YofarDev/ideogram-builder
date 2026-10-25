// json-convert.js — "⇄ Convert" button in the Prompt JSON header: rewrites the
// pane's prompt (Ideogram JSON ↔ MOSS layout) and applies it through the shared
// prompt:apply path, which switches the model and rebuilds the boxes. Unlike
// the model toggle's D4 seeding, this overwrites the target model's fields.

import { state, MODEL_MOSS } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';
import { detectPromptFormat, ideogramToMoss, mossToIdeogram } from './prompt-convert.js';

const btn = () => document.getElementById('btn-convert-json');

function syncTitle() {
  const b = btn();
  if (!b) return;
  const label = state.model === 'moss' ? 'Convert to Ideogram JSON' : 'Convert to MOSS layout';
  b.title = label;
  b.setAttribute('aria-label', label);
}

/**
 * Convert raw pane text to the other model's prompt text.
 * Returns { raw, target, dropped } or { error }.
 */
export function convertPromptText(raw) {
  const format = detectPromptFormat(raw);
  const canvas = { width: state.canvas.width, height: state.canvas.height };
  if (format === 'ideogram') {
    const { layout, dropped } = ideogramToMoss(JSON.parse(raw), canvas);
    return { raw: JSON.stringify(layout, null, 2), target: 'moss', dropped };
  }
  if (format === 'moss' || format === 'moss-draft') {
    return { raw: JSON.stringify(mossToIdeogram(JSON.parse(raw), canvas), null, 2), target: 'ideogram', dropped: 0 };
  }
  if (format === 'caption') {
    // MOSS caption mode: the caption becomes the Ideogram description
    const json = mossToIdeogram({ summary: { caption: raw.trim() }, items: [] }, canvas);
    return { raw: JSON.stringify(json, null, 2), target: 'ideogram', dropped: 0 };
  }
  return { error: 'Nothing to convert — the prompt pane is empty.' };
}

export function initJsonConvert() {
  const b = btn();
  if (!b) return;
  // Capture on pointerdown, before a canvas pointerup can regenerate the pane
  // (same race the Apply button guards against).
  let captured = '';
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    captured = document.getElementById('json-output').value;
  });
  b.addEventListener('click', () => {
    const raw = captured || document.getElementById('json-output').value;
    captured = '';
    // Switch to MOSS before building the layout: the switch can shrink the
    // canvas (4M → 2M), and the layout's absolute coords must target the final
    // size. seed: false — the converted prompt overwrites the MOSS fields anyway.
    if (detectPromptFormat(raw) === 'ideogram') emit('model:set', { model: MODEL_MOSS, seed: false });
    const result = convertPromptText(raw);
    if (result.error) {
      showToast(result.error, 'warning');
      return;
    }
    emit('prompt:apply', { raw: result.raw, quiet: true });
    const lost = result.target === 'moss'
      ? 'background, lighting and style merged into caption/meta tags'
      : 'character boxes became objects; tags and canvas type dropped';
    const drop = result.dropped > 0 ? ` ${result.dropped} box${result.dropped > 1 ? 'es' : ''} without a usable bbox dropped.` : '';
    showToast(`Converted to ${result.target === 'moss' ? 'MOSS layout' : 'Ideogram JSON'} (${lost}).${drop}`, 'info');
  });
  on('model:changed', syncTitle);
  syncTitle();
}
