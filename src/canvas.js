// canvas.js — Pointer interactions, event listeners, overlay management.
// Imports core canvas functions from canvas-core.

import { state, nextBoxId, randomLayerColor } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';
import {
  createBoxDOM, selectBox, reorderBoxes, deleteSelectedBox,
  setPreviewMode, clearBoxes, initCanvas, resizeCanvas, renderBoxes,
} from './canvas-core.js';

export { initCanvas, clearBoxes, selectBox, reorderBoxes, deleteSelectedBox, setPreviewMode };

// Interaction state (module-scoped, not in global state)
let isDrawing = false;
let isDragging = false;
let isResizing = false;
let currentBoxDOM = null;
let startX = 0, startY = 0;
let dragStartX = 0, dragStartY = 0;
let initialBoxX = 0, initialBoxY = 0, initialBoxW = 0, initialBoxH = 0;
let hasDragged = false;
let activeRect = null;

function windowPointerMove(e) {
  if (!activeRect) return;
  const currentX = (e.clientX - activeRect.left) / state.canvas.scale;
  const currentY = (e.clientY - activeRect.top) / state.canvas.scale;

  if (isDragging && currentBoxDOM) {
    currentBoxDOM.style.left = (initialBoxX + currentX - dragStartX) + 'px';
    currentBoxDOM.style.top = (initialBoxY + currentY - dragStartY) + 'px';
  } else if (isResizing && currentBoxDOM) {
    currentBoxDOM.style.width = Math.max(10, initialBoxW + currentX - dragStartX) + 'px';
    currentBoxDOM.style.height = Math.max(10, initialBoxH + currentY - dragStartY) + 'px';
  }
}

function windowPointerUp() {
  if (isDrawing && currentBoxDOM) {
    const box = state.boxes.find(b => b.id === currentBoxDOM.id);
    const cw = state.canvas.width, ch = state.canvas.height;
    box.w = ((parseFloat(currentBoxDOM.style.width) || 0) / cw) * 1000;
    box.h = ((parseFloat(currentBoxDOM.style.height) || 0) / ch) * 1000;
    box.x = ((parseFloat(currentBoxDOM.style.left) || 0) / cw) * 1000;
    box.y = ((parseFloat(currentBoxDOM.style.top) || 0) / ch) * 1000;

    if (!hasDragged || box.w < 10 || box.h < 10) {
      currentBoxDOM.remove();
      state.boxes = state.boxes.filter(b => b.id !== box.id);
      selectBox(null);
      if (hasDragged) showToast('Box too small, drag a larger area.', 'error');
    } else {
      const canvas = document.getElementById('canvas-wrapper');
      canvas.classList.remove('empty-state');
      canvas.classList.add('has-boxes');
      emit('state:changed');
    }
  }
  isDrawing = false;
  isDragging = false;
  isResizing = false;
  hasDragged = false;
  currentBoxDOM = null;
  activeRect = null;
  window.removeEventListener('pointermove', windowPointerMove);
  window.removeEventListener('pointerup', windowPointerUp);
  emit('state:changed');
}

export function initCanvasEvents() {
  const canvas = document.getElementById('canvas-wrapper');

  canvas.addEventListener('pointerdown', (e) => {
    const scale = state.canvas.scale;
    activeRect = canvas.getBoundingClientRect();
    window.addEventListener('pointermove', windowPointerMove);
    window.addEventListener('pointerup', windowPointerUp);

    if (e.target === canvas) {
      isDrawing = true;
      startX = (e.clientX - activeRect.left) / scale;
      startY = (e.clientY - activeRect.top) / scale;

      const box = {
        id: nextBoxId(),
        x: (startX / state.canvas.width) * 1000,
        y: (startY / state.canvas.height) * 1000,
        w: 0, h: 0,
        mode: 'obj', text: '', desc: '', colors: [],
        color: randomLayerColor(),
        visible: true, locked: false,
      };
      state.boxes.push(box);

      currentBoxDOM = createBoxDOM(box, { selected: true });
      canvas.appendChild(currentBoxDOM);
      selectBox(box.id);

    } else if (e.target.classList.contains('resize-handle') || e.target.classList.contains('corner-handle')) {
      isResizing = true;
      currentBoxDOM = e.target.parentElement;
      const resizeBox = state.boxes.find(b => b.id === currentBoxDOM.id);
      if (resizeBox?.locked) { isResizing = false; return; }
      selectBox(currentBoxDOM.id);
      dragStartX = (e.clientX - activeRect.left) / scale;
      dragStartY = (e.clientY - activeRect.top) / scale;
      initialBoxW = parseFloat(currentBoxDOM.style.width);
      initialBoxH = parseFloat(currentBoxDOM.style.height);
      e.stopPropagation();

    } else if (e.target.classList.contains('bounding-box')) {
      if (e.altKey) {
        const px = (e.clientX - activeRect.left) / scale;
        const py = (e.clientY - activeRect.top) / scale;

        const overlapping = [...canvas.querySelectorAll('.bounding-box')].filter(box => {
          const bx = parseFloat(box.style.left);
          const by = parseFloat(box.style.top);
          const bw = parseFloat(box.style.width);
          const bh = parseFloat(box.style.height);
          return px >= bx && px <= bx + bw && py >= by && py <= by + bh;
        });

        if (overlapping.length > 1) {
          const currentIdx = overlapping.findIndex(b => b.id === state.selectedBoxId);
          const nextIdx = currentIdx >= 0 && currentIdx < overlapping.length - 1
            ? currentIdx + 1
            : 0;
          selectBox(overlapping[nextIdx].id);
        } else if (overlapping.length === 1) {
          selectBox(overlapping[0].id);
        }
        e.stopPropagation();
        return;
      }

      isDragging = true;
      currentBoxDOM = e.target;
      const dragBox = state.boxes.find(b => b.id === currentBoxDOM.id);
      if (dragBox?.locked) { isDragging = false; return; }
      selectBox(currentBoxDOM.id);
      dragStartX = (e.clientX - activeRect.left) / scale;
      dragStartY = (e.clientY - activeRect.top) / scale;
      initialBoxX = parseFloat(currentBoxDOM.style.left);
      initialBoxY = parseFloat(currentBoxDOM.style.top);
      e.stopPropagation();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!activeRect) return;
    const currentX = (e.clientX - activeRect.left) / state.canvas.scale;
    const currentY = (e.clientY - activeRect.top) / state.canvas.scale;

    if (isDrawing && currentBoxDOM) {
      const w = currentX - startX;
      const h = currentY - startY;
      currentBoxDOM.style.width = Math.abs(w) + 'px';
      currentBoxDOM.style.height = Math.abs(h) + 'px';
      currentBoxDOM.style.left = (w < 0 ? currentX : startX) + 'px';
      currentBoxDOM.style.top = (h < 0 ? currentY : startY) + 'px';
      hasDragged = true;
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedBoxId) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      deleteSelectedBox();
    }
  });

  on('box:select', ({ id }) => { selectBox(id); });

  on('canvas:rebuild', (data) => {
    if (data?.oldWidth && state.boxes.length > 0) {
      resizeCanvas();
    } else {
      initCanvas();
    }
  });

  on('canvas:relayout', () => resizeCanvas());

  on('box:create', () => {
    const box = {
      id: nextBoxId(),
      x: 375, y: 375, w: 250, h: 250,
      mode: 'obj', text: '', desc: '', colors: [],
      color: randomLayerColor(),
      visible: true, locked: false,
    };
    state.boxes.push(box);
    const dom = createBoxDOM(box, { selected: true });
    canvas.appendChild(dom);
    canvas.classList.remove('empty-state');
    canvas.classList.add('has-boxes');
    selectBox(box.id);
    emit('state:changed');
  });

  on('box:geometry', () => renderBoxes());

  on('box:color', ({ id }) => {
    const box = state.boxes.find(b => b.id === id);
    const dom = document.getElementById(id);
    if (box && dom) dom.style.setProperty('--box-color', box.color);
  });

  on('box:desc', ({ id }) => {
    const box = state.boxes.find(b => b.id === id);
    const label = document.getElementById(id)?.querySelector('.box-label');
    if (box && label) label.textContent = box.text || box.desc || '';
  });

  on('layers:reordered', () => reorderBoxes());

  on('box:visibility', ({ id, visible }) => {
    const dom = document.getElementById(id);
    if (dom) dom.style.display = visible ? '' : 'none';
  });

  on('box:lock', ({ id, locked }) => {
    const dom = document.getElementById(id);
    if (dom) dom.style.cursor = locked ? 'not-allowed' : 'grab';
  });

  const overlay = document.getElementById('canvas-overlay');
  const opacityGroup = document.getElementById('opacity-group');

  on('image:ready', ({ imageUrl, dataUrl }) => {
    overlay.src = imageUrl;
    if (dataUrl) state.imageDataUrl = dataUrl;
    overlay.classList.add('visible');
    overlay.style.opacity = '0.4';
    opacitySlider.value = '40';
    opacityGroup.style.display = 'flex';
  });

  const opacitySlider = document.getElementById('overlay-opacity');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', () => {
      overlay.style.opacity = opacitySlider.value / 100;
    });
  }

  on('state:loaded', ({ json }) => {
    clearBoxes();
    const elements = json.compositional_deconstruction?.elements || [];
    elements.forEach((element) => {
      const bbox = element.bbox;

      const box = {
        id: nextBoxId(),
        x: bbox[1], y: bbox[0],
        w: bbox[3] - bbox[1], h: bbox[2] - bbox[0],
        mode: element.type,
        text: element.text ?? '',
        desc: element.desc,
        colors: element.color_palette ?? [],
        color: randomLayerColor(),
        visible: true, locked: false,
      };
      state.boxes.push(box);

      const dom = createBoxDOM(box);
      canvas.appendChild(dom);
    });
    if (state.boxes.length > 0) {
      canvas.classList.remove('empty-state');
      canvas.classList.add('has-boxes');
    }
  });
}
