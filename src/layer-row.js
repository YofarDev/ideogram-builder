import { state } from './state.js';
import { emit } from './events.js';
import { updateThumbnail } from './layer-thumbnail.js';

const icon = content => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
let dragSource = null;
const rowSignatures = new WeakMap();

export function buildRow(box, moveLayer) {
  const row = document.createElement('div');
  row.className = 'layer-row';
  row.dataset.id = box.id;
  row.draggable = true;
  row.setAttribute('role', 'listitem');
  row.innerHTML = `<span class="layer-grip" aria-hidden="true">${icon('<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>')}</span>
    <button class="layer-select" type="button"><span class="layer-thumb" aria-hidden="true"></span><span class="layer-info"><span class="layer-color-dot" aria-hidden="true"></span><span class="layer-name"></span><span class="layer-badge" aria-hidden="true"></span></span></button>
    <span class="layer-actions"><button class="layer-btn layer-eye" type="button"></button><button class="layer-btn layer-lock" type="button"></button></span>`;
  row.addEventListener('click', event => {
    if (!event.target.closest('.layer-btn')) emit('box:select', { id: row.dataset.id });
  });
  for (const [selector, property, eventName] of [['.layer-eye', 'visible', 'box:visibility'], ['.layer-lock', 'locked', 'box:lock']]) {
    row.querySelector(selector).addEventListener('click', event => {
      event.stopPropagation();
      const current = state.boxes.find(item => item.id === row.dataset.id);
      if (!current) return;
      current[property] = !current[property];
      emit(eventName, { id: current.id, [property]: current[property] });
      updateRow(row, current);
    });
  }
  row.querySelector('.layer-select').addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const boxes = [...state.boxes].reverse();
    const index = boxes.findIndex(item => item.id === row.dataset.id);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? boxes.length - 1
      : Math.min(boxes.length - 1, Math.max(0, index + (event.key === 'ArrowUp' ? -1 : 1)));
    if (event.altKey && event.key.startsWith('Arrow')) {
      moveLayer(row.dataset.id, boxes[target].id);
      row.querySelector('.layer-select').focus();
    } else {
      emit('box:select', { id: boxes[target].id });
      const rows = [...row.parentElement.querySelectorAll('.layer-row')];
      rows.find(item => item.dataset.id === boxes[target].id)?.querySelector('.layer-select').focus();
    }
  });
  row.addEventListener('dragstart', event => {
    dragSource = row.dataset.id;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragSource);
  });
  row.addEventListener('dragend', () => {
    dragSource = null;
    row.classList.remove('dragging');
    row.parentElement?.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
  });
  row.addEventListener('dragover', event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', event => {
    event.preventDefault();
    row.classList.remove('drag-over');
    if (dragSource) moveLayer(dragSource, row.dataset.id);
    dragSource = null;
  });
  return row;
}

export function updateRow(row, box) {
  const name = box.text || box.desc || box.id.replace('box_', 'Box ');
  updateThumbnail(row, box);
  const signature = JSON.stringify([name, box.mode, box.color, box.visible, box.locked, box.id === state.selectedBoxId]);
  if (rowSignatures.get(row) === signature) return;
  rowSignatures.set(row, signature);
  row.classList.toggle('active', box.id === state.selectedBoxId);
  row.classList.toggle('hidden-layer', !box.visible);
  const select = row.querySelector('.layer-select');
  select.setAttribute('aria-label', `Select layer: ${name}`);
  select.setAttribute('aria-pressed', String(box.id === state.selectedBoxId));
  row.querySelector('.layer-name').textContent = name;
  row.querySelector('.layer-name').title = name;
  row.querySelector('.layer-color-dot').style.background = box.color || 'var(--accent)';
  row.querySelector('.layer-badge').textContent = box.mode === 'text' ? 'TXT' : box.mode === 'character' ? 'CHR' : 'OBJ';
  const eye = row.querySelector('.layer-eye');
  eye.classList.toggle('off', !box.visible);
  eye.title = `${box.visible ? 'Hide' : 'Show'} layer: ${name}`;
  eye.setAttribute('aria-label', eye.title);
  eye.setAttribute('aria-pressed', String(box.visible));
  const eyeIcon = box.visible ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' : '<path d="m3 3 18 18M10.6 5.1C17.7 4.2 22 12 22 12a20 20 0 0 1-3.1 3.8M6.4 6.4A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.6-1.4"/>';
  if (eye.dataset.visible !== String(box.visible)) eye.innerHTML = icon(eyeIcon);
  eye.dataset.visible = box.visible;
  const lock = row.querySelector('.layer-lock');
  lock.classList.toggle('on', box.locked);
  lock.title = `${box.locked ? 'Unlock' : 'Lock'} layer: ${name}`;
  lock.setAttribute('aria-label', lock.title);
  lock.setAttribute('aria-pressed', String(box.locked));
  if (lock.dataset.locked !== String(box.locked)) lock.innerHTML = icon(`<rect x="5" y="10" width="14" height="11" rx="2"/><path d="${box.locked ? 'M8 10V6a4 4 0 0 1 8 0v4' : 'M8 10V6a4 4 0 0 1 8 0'}"/>`);
  lock.dataset.locked = box.locked;
}
