// canvas.js — Canvas init, bounding box draw/drag/resize/select

import { state, nextBoxId } from './state.js';
import { on, emit } from './events.js';
import { showToast } from './toast.js';

// Interaction state (module-scoped, not in global state)
let isDrawing = false;
let isDragging = false;
let isResizing = false;
let currentBoxDOM = null;
let startX = 0, startY = 0;
let dragStartX = 0, dragStartY = 0;
let initialBoxX = 0, initialBoxY = 0, initialBoxW = 0, initialBoxH = 0;

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

function resizeCanvas() {
  const canvas = document.getElementById('canvas-wrapper');
  const container = document.querySelector('.canvas-container');
  const { width, height } = state.canvas;

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  state.canvas.scale = height > 800 ? 800 / height : 1;
  canvas.style.transformOrigin = 'top left';
  canvas.style.transform = `scale(${state.canvas.scale})`;

  const padY = 32;
  container.style.height = (height * state.canvas.scale + padY) + 'px';

  renderBoxes();
}

export function initCanvas() {
  const canvas = document.getElementById('canvas-wrapper');
  const container = document.querySelector('.canvas-container');
  const { width, height } = state.canvas;

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  state.canvas.scale = height > 800 ? 800 / height : 1;
  canvas.style.transformOrigin = 'top left';
  canvas.style.transform = `scale(${state.canvas.scale})`;

  // Collapse dead space from CSS transform
  const padY = 32; // 16px padding × 2
  container.style.height = (height * state.canvas.scale + padY) + 'px';

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
  if (id) document.getElementById(id).classList.add('selected');
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
        x: (startX / state.canvas.width) * 1000,
        y: (startY / state.canvas.height) * 1000,
        w: 0, h: 0,
        mode: 'obj', text: '', desc: '', colors: [],
        visible: true, locked: false,
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

      for (const pos of ['tl', 'tr', 'bl', 'br']) {
        const corner = document.createElement('div');
        corner.className = `corner-handle ${pos}`;
        currentBoxDOM.appendChild(corner);
      }

      const label = document.createElement('span');
      label.className = 'box-label';
      currentBoxDOM.appendChild(label);

      canvas.appendChild(currentBoxDOM);
      selectBox(box.id);

    } else if (e.target.classList.contains('resize-handle') || e.target.classList.contains('corner-handle')) {
      isResizing = true;
      currentBoxDOM = e.target.parentElement;
      const resizeBox = state.boxes.find(b => b.id === currentBoxDOM.id);
      if (resizeBox?.locked) { isResizing = false; return; }
      selectBox(currentBoxDOM.id);
      const rect = canvas.getBoundingClientRect();
      dragStartX = (e.clientX - rect.left) / scale;
      dragStartY = (e.clientY - rect.top) / scale;
      initialBoxW = parseFloat(currentBoxDOM.style.width);
      initialBoxH = parseFloat(currentBoxDOM.style.height);
      e.stopPropagation();

    } else if (e.target.classList.contains('bounding-box')) {
      if (e.altKey) {
        // Alt+click: cycle through overlapping boxes at click point
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) / scale;
        const py = (e.clientY - rect.top) / scale;

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

  // --- Pointer move on canvas: track if user actually dragged ---
  let hasDragged = false;
  canvas.addEventListener('pointermove', (e) => {
    if (isDrawing) hasDragged = true;
  });

  // --- Pointer up: finalize box ---
  window.addEventListener('pointerup', () => {
    if (isDrawing && currentBoxDOM) {
      const box = state.boxes.find(b => b.id === currentBoxDOM.id);
      const cw = state.canvas.width, ch = state.canvas.height;
      box.w = ((parseFloat(currentBoxDOM.style.width) || 0) / cw) * 1000;
      box.h = ((parseFloat(currentBoxDOM.style.height) || 0) / ch) * 1000;
      box.x = ((parseFloat(currentBoxDOM.style.left) || 0) / cw) * 1000;
      box.y = ((parseFloat(currentBoxDOM.style.top) || 0) / ch) * 1000;

      if (!hasDragged || box.w < 10 || box.h < 10) {
        canvas.removeChild(currentBoxDOM);
        state.boxes = state.boxes.filter(b => b.id !== box.id);
        selectBox(null);
        if (hasDragged) showToast('Box too small — drag a larger area.', 'error');
      } else {
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
    emit('state:changed');
  });

  // --- Keyboard: Delete/Backspace removes selected box ---
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedBoxId) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      deleteSelectedBox();
    }
  });

  // --- Event listeners ---

  on('canvas:rebuild', (data) => {
    if (data?.oldWidth && state.boxes.length > 0) {
      resizeCanvas();
    } else {
      initCanvas();
    }
  });

  // --- Layer event listeners ---
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

  on('image:ready', ({ imageUrl }) => {
    overlay.src = imageUrl;
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
        visible: true, locked: false,
      };
      state.boxes.push(box);

      const dom = document.createElement('div');
      dom.className = 'bounding-box';
      dom.id = box.id;
      const cw = state.canvas.width, ch = state.canvas.height;
      dom.style.left = (box.x / 1000 * cw) + 'px';
      dom.style.top = (box.y / 1000 * ch) + 'px';
      dom.style.width = (box.w / 1000 * cw) + 'px';
      dom.style.height = (box.h / 1000 * ch) + 'px';

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

      canvas.appendChild(dom);
    });
    if (state.boxes.length > 0) {
      canvas.classList.remove('empty-state');
      canvas.classList.add('has-boxes');
    }
  });
}
