// canvas-core.js — Canvas init, box DOM creation, scaling, public API (no interaction state).

import { state, nextBoxId, randomLayerColor } from './state.js';
import { emit } from './events.js';

function createBoxDOM(box, { selected = false } = {}) {
  const dom = document.createElement('div');
  dom.className = 'bounding-box' + (selected ? ' selected' : '');
  dom.id = box.id;
  const cw = state.canvas.width, ch = state.canvas.height;
  dom.style.left = (box.x / 1000 * cw) + 'px';
  dom.style.top = (box.y / 1000 * ch) + 'px';
  dom.style.width = (box.w / 1000 * cw) + 'px';
  dom.style.height = (box.h / 1000 * ch) + 'px';
  if (box.color) dom.style.setProperty('--box-color', box.color);

  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  dom.appendChild(handle);

  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const corner = document.createElement('div');
    corner.className = `corner-handle ${pos}`;
    dom.appendChild(corner);
  }

  const label = document.createElement('span');
  label.className = 'box-label';
  label.textContent = box.text || box.desc || '';
  dom.appendChild(label);

  return dom;
}

function renderBoxes() {
  state.boxes.forEach(box => {
    const dom = document.getElementById(box.id);
    if (dom) {
      dom.style.left = (box.x / 1000 * state.canvas.width) + 'px';
      dom.style.top = (box.y / 1000 * state.canvas.height) + 'px';
      dom.style.width = (box.w / 1000 * state.canvas.width) + 'px';
      dom.style.height = (box.h / 1000 * state.canvas.height) + 'px';
    }
  });
}

function applyCanvasScale() {
  const canvas = document.getElementById('canvas-wrapper');
  const container = document.querySelector('.canvas-container');
  const { width, height } = state.canvas;

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  const editor = document.getElementById('tab-editor');
  const toolbar = document.getElementById('editor-toolbar');
  const padX = 32, padY = 32, gap = 12;
  const availW = Math.max(0, (editor ? editor.clientWidth : 0) - padX);
  const availH = Math.max(0, (editor ? editor.clientHeight : 0)
    - (toolbar ? toolbar.offsetHeight : 0) - gap - padY);

  const fitW = width > 0 ? availW / width : 1;
  const fitH = height > 0 ? availH / height : 1;
  let scale = Math.min(fitW, fitH, 1);
  if (!(scale > 0)) scale = 1;
  state.canvas.scale = scale;

  canvas.style.transformOrigin = 'top left';
  canvas.style.transform = `scale(${scale})`;

  container.style.width = (width * scale + padX) + 'px';
  container.style.height = (height * scale + padY) + 'px';
}

function resizeCanvas() {
  applyCanvasScale();
  renderBoxes();
}

export function initCanvas() {
  const canvas = document.getElementById('canvas-wrapper');
  const { width, height } = state.canvas;

  applyCanvasScale();

  canvas.style.backgroundImage = '';
  canvas.style.backgroundSize = '';

  const overlay = document.getElementById('canvas-overlay');
  if (overlay) {
    overlay.src = '';
    overlay.classList.remove('visible');
  }
  const opacityGroup = document.getElementById('opacity-group');
  if (opacityGroup) opacityGroup.style.display = 'none';

  canvas.classList.add('empty-state');
  canvas.classList.remove('has-boxes');

  emit('canvas:reset');
  clearBoxes();
}

export function clearBoxes() {
  const canvas = document.getElementById('canvas-wrapper');
  canvas.querySelectorAll('.bounding-box').forEach(el => el.remove());
  state.boxes.length = 0;
  state.selectedBoxId = null;
  canvas.classList.add('empty-state');
  canvas.classList.remove('has-boxes');
  emit('box:selected', { id: null });
}

export function selectBox(id) {
  state.selectedBoxId = id;
  document.querySelectorAll('.bounding-box').forEach(el => el.classList.remove('selected'));
  if (id) document.getElementById(id)?.classList.add('selected');
  emit('box:selected', { id });
}

export function reorderBoxes() {
  const canvas = document.getElementById('canvas-wrapper');
  state.boxes.forEach((box, i) => {
    const dom = document.getElementById(box.id);
    if (dom) {
      canvas.appendChild(dom);
      dom.style.zIndex = box.id === state.selectedBoxId ? 10 : i + 2;
    }
  });
}

export function deleteSelectedBox() {
  if (!state.selectedBoxId) return;
  const box = state.boxes.find(b => b.id === state.selectedBoxId);
  const desc = box?.desc || box?.text || 'this box';
  if (!confirm(`Delete "${desc}"? This cannot be undone.`)) return;

  const canvas = document.getElementById('canvas-wrapper');
  const dom = document.getElementById(state.selectedBoxId);
  if (dom) dom.remove();
  state.boxes = state.boxes.filter(b => b.id !== state.selectedBoxId);
  selectBox(null);
  if (state.boxes.length === 0) {
    canvas.classList.add('empty-state');
    canvas.classList.remove('has-boxes');
  }
  emit('state:changed');
}

export function setPreviewMode(enabled) {
  state.ui.previewMode = enabled;
  const container = document.querySelector('.canvas-container');
  if (container) container.classList.toggle('preview-mode', enabled);
}

export { createBoxDOM, applyCanvasScale, resizeCanvas, renderBoxes };
