// A gesture owns its listeners and commits only when it changes a box.
import { state, nextBoxId, randomLayerColor, clampBox } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';
import { createBoxDOM, selectBox, renderBoxes } from './canvas-core.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const geometry = box => ({ x: box.x, y: box.y, w: box.w, h: box.h });

export function initCanvasPointer(canvas) {
  let gesture = null;
  const matches = event => gesture && (event.pointerId == null || gesture.pointerId == null || event.pointerId === gesture.pointerId);
  const point = event => ({
    x: clamp((event.clientX - gesture.rect.left) / gesture.scale, 0, gesture.width),
    y: clamp((event.clientY - gesture.rect.top) / gesture.scale, 0, gesture.height),
  });

  function move(event) {
    if (!matches(event)) return;
    const g = gesture;
    const current = point(event);
    const dx = current.x - g.start.x, dy = current.y - g.start.y;
    let { left, top, width, height } = g.initial;
    if (g.kind === 'draw') {
      left = Math.min(current.x, g.start.x);
      top = Math.min(current.y, g.start.y);
      width = Math.abs(dx);
      height = Math.abs(dy);
    } else if (g.kind === 'drag') {
      left = clamp(left + dx, 0, Math.max(0, g.width - width));
      top = clamp(top + dy, 0, Math.max(0, g.height - height));
    } else {
      const right = clamp(left + width, 10, g.width);
      const bottom = clamp(top + height, 10, g.height);
      if (g.corner.includes('l')) left = clamp(left + dx, 0, right - 10);
      if (g.corner.includes('t')) top = clamp(top + dy, 0, bottom - 10);
      width = g.corner.includes('r') ? clamp(right + dx, left + 10, g.width) - left : right - left;
      height = g.corner.includes('b') ? clamp(bottom + dy, top + 10, g.height) - top : bottom - top;
    }
    Object.assign(g.dom.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  function finish(event, cancelled = false) {
    if (!gesture || (event && !matches(event))) return;
    const g = gesture;
    gesture = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', escape);
    try { canvas.releasePointerCapture?.(g.pointerId); } catch { /* Pointer may already be released. */ }

    const box = state.boxes.find(box => box.id === g.id);
    if (!box) return;
    if (cancelled) Object.assign(box, g.before);
    if (!cancelled) {
      box.x = parseFloat(g.dom.style.left) / g.width * 1000;
      box.y = parseFloat(g.dom.style.top) / g.height * 1000;
      box.w = parseFloat(g.dom.style.width) / g.width * 1000;
      box.h = parseFloat(g.dom.style.height) / g.height * 1000;
      clampBox(box);
    }
    const tooSmall = g.kind === 'draw' && (box.w < 10 || box.h < 10);
    if (g.kind === 'draw' && (cancelled || tooSmall)) {
      g.dom.remove();
      state.boxes = state.boxes.filter(box => box.id !== g.id);
      selectBox(state.boxes.some(box => box.id === g.previous) ? g.previous : null);
      if (!cancelled && (box.w > 0 || box.h > 0)) showToast('Box too small, drag a larger area.', 'error');
    }
    canvas.classList.toggle('empty-state', state.boxes.length === 0);
    canvas.classList.toggle('has-boxes', state.boxes.length > 0);
    renderBoxes();
    if (!cancelled && !tooSmall && Object.keys(g.before).some(key => box[key] !== g.before[key])) emit('state:changed');
  }

  function cancel(event) { finish(['pointercancel', 'lostpointercapture'].includes(event?.type) ? event : null, true); }
  function escape(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancel();
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || gesture || state.ui.previewMode) return;
    const dom = event.target.closest('.bounding-box');
    if (event.target !== canvas && !dom) return;
    const selected = dom && state.boxes.find(box => box.id === dom.id);
    if (selected && event.altKey) {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / state.canvas.scale / state.canvas.width * 1000;
      const y = (event.clientY - rect.top) / state.canvas.scale / state.canvas.height * 1000;
      const overlapping = state.boxes.filter(box => box.visible && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
      const index = overlapping.findIndex(box => box.id === state.selectedBoxId);
      if (overlapping.length) selectBox(overlapping[(index + 1) % overlapping.length].id);
      return;
    }
    if (selected?.locked) { selectBox(selected.id); canvas.focus({ preventScroll: true }); return; }
    if (dom && !selected) return;
    const handle = event.target.closest('.resize-handle, .corner-handle');
    gesture = {
      pointerId: event.pointerId, rect: canvas.getBoundingClientRect(), scale: state.canvas.scale,
      width: state.canvas.width, height: state.canvas.height, previous: state.selectedBoxId,
      kind: !dom ? 'draw' : handle ? 'resize' : 'drag',
      corner: ['tl', 'tr', 'bl', 'br'].find(corner => handle?.classList.contains(corner)) || 'br',
    };
    gesture.start = point(event);
    const box = selected || {
      id: nextBoxId(), x: gesture.start.x / gesture.width * 1000, y: gesture.start.y / gesture.height * 1000,
      w: 0, h: 0, mode: 'obj', text: '', desc: '', colors: [], tags: [],
      color: randomLayerColor(), visible: true, locked: false,
    };
    if (!selected) { state.boxes.push(box); canvas.appendChild(createBoxDOM(box)); }
    gesture.id = box.id;
    gesture.before = geometry(box);
    gesture.dom = document.getElementById(box.id);
    gesture.initial = Object.fromEntries(['left', 'top', 'width', 'height'].map(key => [key, parseFloat(gesture.dom.style[key]) || 0]));
    selectBox(box.id);
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Synthetic events have no active pointer. */ }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
  });
  canvas.addEventListener('lostpointercapture', cancel);
  return cancel;
}
