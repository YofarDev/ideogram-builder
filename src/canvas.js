// canvas.js — Canvas init, bounding box draw/drag/resize/select

import { state, nextBoxId } from './state.js';
import { on, emit } from './events.js';

// Interaction state (module-scoped, not in global state)
let isDrawing = false;
let isDragging = false;
let isResizing = false;
let currentBoxDOM = null;
let startX = 0, startY = 0;
let dragStartX = 0, dragStartY = 0;
let initialBoxX = 0, initialBoxY = 0, initialBoxW = 0, initialBoxH = 0;

export function initCanvas() {
  const canvas = document.getElementById('canvas-wrapper');
  const { width, height } = state.canvas;

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  state.canvas.scale = height > 800 ? 800 / height : 1;
  canvas.style.transform = `scale(${state.canvas.scale})`;
  canvas.parentElement.style.width = (width * state.canvas.scale) + 'px';

  canvas.style.backgroundImage = '';
  canvas.style.backgroundSize = '';

  emit('canvas:reset');
  clearBoxes();
}

export function clearBoxes() {
  const canvas = document.getElementById('canvas-wrapper');
  canvas.innerHTML = '';
  state.boxes.length = 0;
  state.selectedBoxId = null;
  emit('box:selected', { id: null });
}

export function selectBox(id) {
  state.selectedBoxId = id;
  document.querySelectorAll('.bounding-box').forEach(el => el.classList.remove('selected'));
  if (id) document.getElementById(id).classList.add('selected');
  emit('box:selected', { id });
}

export function deleteSelectedBox() {
  if (!state.selectedBoxId) return;
  const dom = document.getElementById(state.selectedBoxId);
  if (dom) dom.remove();
  state.boxes = state.boxes.filter(b => b.id !== state.selectedBoxId);
  selectBox(null);
}

export function initCanvasEvents() {
  const canvas = document.getElementById('canvas-wrapper');

  // --- Pointer down: start drawing, dragging, or resizing ---
  canvas.addEventListener('pointerdown', (e) => {
    const scale = state.canvas.scale;

    if (e.target === canvas) {
      isDrawing = true;
      const rect = canvas.getBoundingClientRect();
      startX = (e.clientX - rect.left) / scale;
      startY = (e.clientY - rect.top) / scale;

      const box = {
        id: nextBoxId(),
        x: startX, y: startY, w: 0, h: 0,
        mode: 'obj', text: '', desc: '', colors: [],
      };
      state.boxes.push(box);

      currentBoxDOM = document.createElement('div');
      currentBoxDOM.className = 'bounding-box selected';
      currentBoxDOM.id = box.id;
      currentBoxDOM.style.left = startX + 'px';
      currentBoxDOM.style.top = startY + 'px';

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      currentBoxDOM.appendChild(handle);
      canvas.appendChild(currentBoxDOM);
      selectBox(box.id);

    } else if (e.target.classList.contains('resize-handle')) {
      isResizing = true;
      currentBoxDOM = e.target.parentElement;
      selectBox(currentBoxDOM.id);
      const rect = canvas.getBoundingClientRect();
      dragStartX = (e.clientX - rect.left) / scale;
      dragStartY = (e.clientY - rect.top) / scale;
      initialBoxW = parseFloat(currentBoxDOM.style.width);
      initialBoxH = parseFloat(currentBoxDOM.style.height);
      e.stopPropagation();

    } else if (e.target.classList.contains('bounding-box')) {
      isDragging = true;
      currentBoxDOM = e.target;
      selectBox(currentBoxDOM.id);
      const rect = canvas.getBoundingClientRect();
      dragStartX = (e.clientX - rect.left) / scale;
      dragStartY = (e.clientY - rect.top) / scale;
      initialBoxX = parseFloat(currentBoxDOM.style.left);
      initialBoxY = parseFloat(currentBoxDOM.style.top);
      e.stopPropagation();
    }
  });

  // --- Pointer move on canvas: update drawing ---
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) / state.canvas.scale;
    const currentY = (e.clientY - rect.top) / state.canvas.scale;

    if (isDrawing && currentBoxDOM) {
      const w = currentX - startX;
      const h = currentY - startY;
      currentBoxDOM.style.width = Math.abs(w) + 'px';
      currentBoxDOM.style.height = Math.abs(h) + 'px';
      currentBoxDOM.style.left = (w < 0 ? currentX : startX) + 'px';
      currentBoxDOM.style.top = (h < 0 ? currentY : startY) + 'px';
    }
  });

  // --- Pointer move on window: update dragging/resizing ---
  window.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) / state.canvas.scale;
    const currentY = (e.clientY - rect.top) / state.canvas.scale;

    if (isDragging && currentBoxDOM) {
      currentBoxDOM.style.left = (initialBoxX + currentX - dragStartX) + 'px';
      currentBoxDOM.style.top = (initialBoxY + currentY - dragStartY) + 'px';
    } else if (isResizing && currentBoxDOM) {
      currentBoxDOM.style.width = Math.max(10, initialBoxW + currentX - dragStartX) + 'px';
      currentBoxDOM.style.height = Math.max(10, initialBoxH + currentY - dragStartY) + 'px';
    }
  });

  // --- Pointer up: finalize box ---
  window.addEventListener('pointerup', () => {
    if (isDrawing && currentBoxDOM) {
      const box = state.boxes.find(b => b.id === currentBoxDOM.id);
      box.w = parseFloat(currentBoxDOM.style.width) || 0;
      box.h = parseFloat(currentBoxDOM.style.height) || 0;
      box.x = parseFloat(currentBoxDOM.style.left) || 0;
      box.y = parseFloat(currentBoxDOM.style.top) || 0;

      if (box.w < 10 || box.h < 10) {
        canvas.removeChild(currentBoxDOM);
        state.boxes = state.boxes.filter(b => b.id !== box.id);
        selectBox(null);
      }
    }
    isDrawing = false;
    isDragging = false;
    isResizing = false;
    currentBoxDOM = null;
  });

  // --- Event listeners ---

  on('canvas:rebuild', () => initCanvas());

  on('image:ready', ({ imageUrl }) => {
    canvas.style.backgroundImage = `url("${imageUrl}")`;
    canvas.style.backgroundSize = 'cover';
    document.getElementById('image-view').src = imageUrl;
  });

  on('state:loaded', ({ json }) => {
    clearBoxes();
    const elements = json.compositional_deconstruction?.elements || [];
    elements.forEach((element) => {
      const bbox = [...element.bbox];
      bbox[0] = (bbox[0] / 1000) * state.canvas.height;
      bbox[2] = (bbox[2] / 1000) * state.canvas.height;
      bbox[1] = (bbox[1] / 1000) * state.canvas.width;
      bbox[3] = (bbox[3] / 1000) * state.canvas.width;

      const box = {
        id: nextBoxId(),
        x: bbox[1], y: bbox[0],
        w: bbox[3] - bbox[1], h: bbox[2] - bbox[0],
        mode: element.type,
        text: element.text ?? '',
        desc: element.desc,
        colors: element.color_palette ?? [],
      };
      state.boxes.push(box);

      const dom = document.createElement('div');
      dom.className = 'bounding-box';
      dom.id = box.id;
      dom.style.left = box.x + 'px';
      dom.style.top = box.y + 'px';
      dom.style.width = box.w + 'px';
      dom.style.height = box.h + 'px';

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      dom.appendChild(handle);
      canvas.appendChild(dom);
    });
  });
}
