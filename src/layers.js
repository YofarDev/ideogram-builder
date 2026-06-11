// layers.js — Photoshop-style layer panel for box navigation

import { state } from './state.js';
import { on, emit } from './events.js';
import { selectBox } from './canvas.js';

let dragSrcId = null;

export function initLayers() {
  const list = document.getElementById('layers-list');

  on('box:selected', () => renderLayers());
  on('state:changed', () => renderLayers());
  on('state:loaded', () => renderLayers());
  on('canvas:reset', () => renderLayers());

  renderLayers();
}

function renderLayers() {
  const list = document.getElementById('layers-list');
  const count = document.getElementById('layer-count');
  list.innerHTML = '';
  if (count) count.textContent = state.boxes.length;

  if (state.boxes.length === 0) {
    list.innerHTML = '<div class="layers-empty">No layers yet — draw on canvas</div>';
    return;
  }

  // Render top-to-bottom (last box = top layer = first in list)
  const boxes = [...state.boxes].reverse();
  boxes.forEach((box) => {
    const row = buildRow(box);
    list.appendChild(row);
  });
}

function buildRow(box) {
  const row = document.createElement('div');
  row.className = 'layer-row' + (box.id === state.selectedBoxId ? ' active' : '');
  row.dataset.id = box.id;
  if (!box.visible) row.classList.add('hidden-layer');

  row.draggable = true;

  // Drag handle
  const grip = document.createElement('span');
  grip.className = 'layer-grip';
  grip.innerHTML = '⠿';
  grip.setAttribute('aria-hidden', 'true');
  row.appendChild(grip);

  // Mini thumbnail
  const thumb = buildThumbnail(box);
  row.appendChild(thumb);

  // Name + badge
  const info = document.createElement('div');
  info.className = 'layer-info';

  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = box.text || box.desc || box.id.replace('box_', 'Box ');
  info.appendChild(name);

  const badge = document.createElement('span');
  badge.className = 'layer-badge';
  badge.textContent = box.mode === 'text' ? 'TXT' : 'OBJ';
  info.appendChild(badge);

  row.appendChild(info);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'layer-actions';

  const eyeBtn = document.createElement('button');
  eyeBtn.className = 'layer-btn layer-eye' + (box.visible ? '' : ' off');
  eyeBtn.innerHTML = box.visible ? '👁' : '👁‍🗨';
  eyeBtn.title = box.visible ? 'Hide layer' : 'Show layer';
  eyeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    box.visible = !box.visible;
    emit('box:visibility', { id: box.id, visible: box.visible });
    renderLayers();
  });
  actions.appendChild(eyeBtn);

  const lockBtn = document.createElement('button');
  lockBtn.className = 'layer-btn layer-lock' + (box.locked ? ' on' : '');
  lockBtn.innerHTML = box.locked ? '🔒' : '🔓';
  lockBtn.title = box.locked ? 'Unlock layer' : 'Lock layer';
  lockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    box.locked = !box.locked;
    emit('box:lock', { id: box.id, locked: box.locked });
    renderLayers();
  });
  actions.appendChild(lockBtn);

  row.appendChild(actions);

  // Click to select (pointerdown, not click — draggable suppresses click)
  row.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.layer-btn')) return;
    selectBox(box.id);
  });

  // Drag & drop reorder
  row.addEventListener('dragstart', (e) => {
    dragSrcId = box.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', box.id);
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    dragSrcId = null;
    document.querySelectorAll('.layer-row').forEach(r => r.classList.remove('drag-over'));
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('drag-over');
  });

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    if (!dragSrcId || dragSrcId === box.id) return;

    const srcIdx = state.boxes.findIndex(b => b.id === dragSrcId);
    const dstIdx = state.boxes.findIndex(b => b.id === box.id);
    if (srcIdx === -1 || dstIdx === -1) return;

    const [moved] = state.boxes.splice(srcIdx, 1);
    state.boxes.splice(dstIdx, 0, moved);

    emit('layers:reordered');
    renderLayers();
  });

  return row;
}

function buildThumbnail(box) {
  const thumb = document.createElement('div');
  thumb.className = 'layer-thumb';

  const cw = state.canvas.width || 1;
  const ch = state.canvas.height || 1;
  const left = ((box.x / cw) * 100);
  const top = ((box.y / ch) * 100);
  const width = Math.max(4, (box.w / cw) * 100);
  const height = Math.max(4, (box.h / ch) * 100);

  const inner = document.createElement('div');
  inner.className = 'layer-thumb-inner';
  inner.style.left = left + '%';
  inner.style.top = top + '%';
  inner.style.width = width + '%';
  inner.style.height = height + '%';

  // Use first color or accent
  const color = box.colors?.[0] || 'var(--accent)';
  inner.style.borderColor = color;
  inner.style.background = color + '18';

  thumb.appendChild(inner);
  return thumb;
}


