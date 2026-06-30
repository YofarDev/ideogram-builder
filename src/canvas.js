// canvas.js — Canvas init, bounding box draw/drag/resize/select

import { state, nextBoxId, randomLayerColor } from './state.js';
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
let hasDragged = false;
let activeRect = null; // cached once per interaction
let dockHiddenForInteraction = false;

// Window-scoped pointermove handler — attached lazily on pointerdown,
// detached on pointerup, so we don't run getBoundingClientRect on every
// mouse twitch across the page.
function windowPointerMove(e) {
  if (!activeRect) return;
  const currentX = (e.clientX - activeRect.left) / state.canvas.scale;
  const currentY = (e.clientY - activeRect.top) / state.canvas.scale;

  if (!dockHiddenForInteraction && (isDragging || isResizing)) {
    dockHiddenForInteraction = true;
    document.getElementById('desc-dock')?.classList.remove('show');
  }

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
  if (dockHiddenForInteraction) {
    dockHiddenForInteraction = false;
    if (state.selectedBoxId) {
      const dock = document.getElementById('desc-dock');
      if (dock && document.querySelector('.main-content')?.classList.contains('draw-fullscreen')) {
        dock.classList.add('show');
      }
    }
  }
  currentBoxDOM = null;
  activeRect = null;
  window.removeEventListener('pointermove', windowPointerMove);
  window.removeEventListener('pointerup', windowPointerUp);
  emit('state:changed');
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

// Fit the canvas into the available center-column space, keeping aspect ratio.
// Sets the wrapper's transform scale and the container's exact size; the container
// is centered in #tab-editor via margin:auto. Pointer math still uses state.canvas.scale.
function applyCanvasScale() {
  const canvas = document.getElementById('canvas-wrapper');
  const container = document.querySelector('.canvas-container');
  const { width, height } = state.canvas;

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  // Available space inside the editor tab (center column), minus the sub-toolbar + queue + gaps + container padding
  const editor = document.getElementById('tab-editor');
  const toolbar = document.getElementById('editor-toolbar');
  const queuePanel = document.getElementById('queue-panel');
  const padX = 32, padY = 32, gap = 12;
  const queueH = queuePanel ? queuePanel.offsetHeight : 0;
  const availW = Math.max(0, (editor ? editor.clientWidth : 0) - padX);
  const availH = Math.max(0, (editor ? editor.clientHeight : 0)
    - (toolbar ? toolbar.offsetHeight : 0) - queueH
    - gap - (queueH > 0 ? gap : 0) - padY);

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

export function setPreviewMode(enabled) {
  state.ui.previewMode = enabled;
  const container = document.querySelector('.canvas-container');
  if (container) container.classList.toggle('preview-mode', enabled);
}

export function initCanvasEvents() {
  const canvas = document.getElementById('canvas-wrapper');

  // --- Pointer down: start drawing, dragging, or resizing ---
  canvas.addEventListener('pointerdown', (e) => {
    const scale = state.canvas.scale;
    activeRect = canvas.getBoundingClientRect();
    // Always cache rect + arm window listeners for the duration of the interaction
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
        // Alt+click: cycle through overlapping boxes at click point
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

  // --- Pointer move on canvas: live drawing + drag detection ---
  // Single listener (previously duplicated).
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
