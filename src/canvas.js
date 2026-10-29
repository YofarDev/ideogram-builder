// canvas.js — Pointer interactions, event listeners, overlay management.
// Imports core canvas functions from canvas-core.

import { state, nextBoxId, randomLayerColor, clampBox } from './state.js';
import { on, emit } from './events.js';
import { initCanvasPointer } from './canvas-pointer.js';
import { localImageUrl } from './reference-image.js';
import {
  createBoxDOM, selectBox, reorderBoxes, deleteSelectedBox,
  setPreviewMode, clearBoxes, initCanvas, resizeCanvas, renderBoxes,
} from './canvas-core.js';

export { initCanvas, clearBoxes, selectBox, reorderBoxes, deleteSelectedBox, setPreviewMode };

export function initCanvasEvents() {
  const canvas = document.getElementById('canvas-wrapper');

  const cancelPointer = initCanvasPointer(canvas);
  on('canvas:reset', cancelPointer);
  on('state:loaded', cancelPointer);

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedBoxId) {
      if (!canvas.isConnected) return;
      if (!canvas.closest('#tab-editor')?.classList.contains('active') || state.ui.previewMode) return;
      if (document.activeElement?.closest('[contenteditable]:not([contenteditable="false"])')) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      deleteSelectedBox();
    }
  });

  on('box:select', ({ id }) => { selectBox(id); });

  on('workspace:restore', ({ boxes, selectedIndex }) => {
    cancelPointer();
    clearBoxes();
    boxes.forEach(saved => {
      const box = { ...saved, id: nextBoxId() };
      clampBox(box);
      state.boxes.push(box);
      const dom = createBoxDOM(box);
      dom.style.display = box.visible ? '' : 'none';
      dom.style.cursor = box.locked ? 'not-allowed' : 'grab';
      canvas.appendChild(dom);
    });
    canvas.classList.toggle('empty-state', boxes.length === 0);
    canvas.classList.toggle('has-boxes', boxes.length > 0);
    selectBox(state.boxes[selectedIndex]?.id || null);
  });

  on('canvas:rebuild', (data) => {
    cancelPointer();
    // Dimension edits preserve the workspace even when caption mode has no boxes.
    if (data?.oldWidth) {
      resizeCanvas();
      emit('state:changed');
    } else {
      initCanvas();
    }
  });

  on('canvas:relayout', () => { cancelPointer(); resizeCanvas(); });

  on('box:create', () => {
    const box = {
      id: nextBoxId(),
      x: 375, y: 375, w: 250, h: 250,
      mode: 'obj', text: '', desc: '', colors: [], tags: [],
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

  function allLayersHidden() {
    return state.boxes.length > 0 && state.boxes.every(b => !b.visible);
  }

  function updateOverlayPointerEvents() {
    overlay.style.pointerEvents = allLayersHidden() && overlay.classList.contains('visible') ? 'auto' : '';
  }

  on('image:ready', ({ imageUrl, dataUrl, opacity = 0.4 }) => {
    overlay.src = imageUrl;
    state.imageDataUrl = dataUrl || null;
    state.referenceImageUrl = localImageUrl(imageUrl);
    state.imageRevision++;
    overlay.classList.add('visible');
    const level = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.4;
    overlay.style.opacity = String(level);
    opacitySlider.value = String(Math.round(level * 100));
    opacityGroup.style.display = 'flex';
    updateOverlayPointerEvents();
  });

  on('image:saved', ({ imageUrl, dataUrl }) => {
    if (state.imageDataUrl === dataUrl) state.referenceImageUrl = localImageUrl(imageUrl);
  });

  const opacitySlider = document.getElementById('overlay-opacity');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', () => {
      overlay.style.opacity = opacitySlider.value / 100;
      emit('overlay:changed');
    });
  }

  overlay.addEventListener('click', (e) => {
    if (!allLayersHidden() || !overlay.src) return;
    e.stopPropagation();
    window.open(overlay.src, '_blank');
  });

  // Re-evaluate when any box visibility changes
  on('box:visibility', () => updateOverlayPointerEvents());

  on('state:loaded', ({ json }) => {
    clearBoxes();
    // JSON elements are top-layer-first (panel order); state.boxes is bottom→top.
    const elements = [...(json.compositional_deconstruction?.elements || [])].reverse();
    elements.forEach((element) => {
      const bbox = element.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(n => typeof n === 'number' && Number.isFinite(n))) return;

      const box = {
        id: nextBoxId(),
        x: bbox[1], y: bbox[0],
        w: bbox[3] - bbox[1], h: bbox[2] - bbox[0],
        mode: element.type,
        text: element.text ?? '',
        desc: element.desc,
        colors: element.color_palette ?? [],
        tags: element.tags ?? [],
        color: randomLayerColor(),
        visible: true, locked: false,
      };
      clampBox(box);
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
