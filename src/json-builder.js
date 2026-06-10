// json-builder.js — Generate Ideogram4 JSON prompt from state

import { state, MODE_PHOTO } from './state.js';
import { on } from './events.js';

export function initJsonBuilder() {
  on('canvas:reset', () => {
    document.getElementById('json-output').value = '';
  });
}

export function generateJSON() {
  const canvasW = state.canvas.width;
  const canvasH = state.canvas.height;

  // Sync box positions from DOM → state
  state.boxes.forEach((box) => {
    const dom = document.getElementById(box.id);
    if (dom) {
      box.x = parseFloat(dom.style.left);
      box.y = parseFloat(dom.style.top);
      box.w = parseFloat(dom.style.width);
      box.h = parseFloat(dom.style.height);
    }
  });

  // Normalize coordinates 0–1000
  const norm = (val, max) => Math.min(1000, Math.max(0, Math.round((val / max) * 1000)));

  const elements = state.boxes.map((box) => {
    const x1 = norm(box.x, canvasW);
    const y1 = norm(box.y, canvasH);
    const x2 = norm(box.x + box.w, canvasW);
    const y2 = norm(box.y + box.h, canvasH);

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
