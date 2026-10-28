// Keep layer rows alive across prompt edits so focus and drag state survive.
import { state } from './state.js';
import { on, emit } from './events.js';
import { buildRow, updateRow } from './layer-row.js';

export function initLayers() {
  const list = document.getElementById('layers-list');
  on('box:selected', ({ id }) => {
    renderLayers();
    list.querySelectorAll('.layer-row').forEach(row => {
      row.classList.toggle('active', row.dataset.id === id);
      row.querySelector('.layer-select').setAttribute('aria-pressed', String(row.dataset.id === id));
    });
  });
  for (const event of ['state:changed', 'state:loaded', 'canvas:reset']) on(event, renderLayers);
  document.getElementById('canvas-overlay')?.addEventListener('load', () => {
    list.querySelectorAll('.layer-row').forEach(row => { delete row.dataset.thumbnailKey; });
    renderLayers();
  });
  document.getElementById('btn-add-layer')?.addEventListener('click', () => emit('box:create'));
  renderLayers();
}

function moveLayer(source, target) {
  if (source === target) return;
  const from = state.boxes.findIndex(box => box.id === source);
  const to = state.boxes.findIndex(box => box.id === target);
  if (from < 0 || to < 0) return;
  const [moved] = state.boxes.splice(from, 1);
  state.boxes.splice(to, 0, moved);
  emit('layers:reordered');
  emit('state:changed');
}

function renderLayers() {
  const list = document.getElementById('layers-list');
  const count = document.getElementById('layer-count');
  if (count) count.textContent = state.boxes.length;
  if (!state.boxes.length) {
    if (!list.querySelector('.layers-empty')) list.innerHTML = '<div class="layers-empty">No layers yet — draw on canvas</div>';
    return;
  }
  list.querySelector('.layers-empty')?.remove();
  const existing = new Map([...list.querySelectorAll('.layer-row')].map(row => [row.dataset.id, row]));
  [...state.boxes].reverse().forEach((box, index) => {
    const row = existing.get(box.id) || buildRow(box, moveLayer);
    existing.delete(box.id);
    updateRow(row, box);
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
  });
  existing.forEach(row => row.remove());
}
