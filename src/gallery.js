import { on, emit } from './events.js';
import { state } from './state.js';
import { restoreMeta } from './gallery-meta.js';
import { buildGalleryCard, describeItem } from './gallery-cards.js';
import { initTabs, switchTab } from './tabs.js';
import { showToast } from './toast.js';

const PAGE_SIZE = 48;
let items = [];
let visibleCount = PAGE_SIZE;
let requestId = 0;
let controller;

export function initGallery() {
  items = [];
  visibleCount = PAGE_SIZE;
  on('tab:changed', ({ tab }) => { if (tab === 'gallery') refreshGallery(); });
  initTabs();
  if (document.getElementById('tab-gallery')?.classList.contains('active')) refreshGallery();

  for (const id of ['gallery-search', 'gallery-model-filter']) {
    const field = document.getElementById(id);
    field?.addEventListener(id === 'gallery-search' ? 'input' : 'change', () => {
      visibleCount = PAGE_SIZE;
      renderGallery();
    });
  }
  document.getElementById('gallery-clear-filters')?.addEventListener('click', () => {
    document.getElementById('gallery-search').value = '';
    document.getElementById('gallery-model-filter').value = 'all';
    visibleCount = PAGE_SIZE;
    renderGallery();
    document.getElementById('gallery-search').focus();
  });
  document.getElementById('gallery-refresh')?.addEventListener('click', refreshGallery);
  document.getElementById('gallery-show-more')?.addEventListener('click', () => {
    const index = visibleCount;
    visibleCount += PAGE_SIZE;
    renderGallery();
    document.querySelectorAll('.gallery-card-open')[index]?.focus();
  });
  document.getElementById('btn-open-output')?.addEventListener('click', () => fetch('/api/open-output'));

  let lastSaveTime = 0;
  let lastSaveDataUrl = '';
  on('image:ready', async ({ dataUrl, importJson, loras, skipSave, meta }) => {
    if (skipSave || !dataUrl) return;
    const now = Date.now();
    if (dataUrl === lastSaveDataUrl && now - lastSaveTime < 3000) return;
    lastSaveTime = now;
    lastSaveDataUrl = dataUrl;
    const saved = await saveToDisk(dataUrl, importJson ?? document.getElementById('json-output').value, loras, meta);
    if (!saved) lastSaveDataUrl = '';
    if (saved && document.getElementById('tab-gallery')?.classList.contains('active')) refreshGallery();
  });
}

async function refreshGallery() {
  const current = ++requestId;
  controller?.abort();
  controller = new AbortController();
  const grid = document.getElementById('gallery-grid');
  const refresh = document.getElementById('gallery-refresh');
  grid.setAttribute('aria-busy', 'true');
  if (refresh) refresh.disabled = true;
  setStatus('Loading images…');
  document.getElementById('gallery-empty').hidden = true;
  try {
    const response = await fetch('/api/list-output', { signal: controller.signal });
    if (!response.ok) throw new Error('Gallery request failed');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid gallery response');
    if (current !== requestId) return;
    items = data.map(item => ({ ...item, ...describeItem(item) }));
    grid.setAttribute('aria-busy', 'false');
    renderGallery();
  } catch (error) {
    if (current === requestId && error.name !== 'AbortError') {
      setStatus('Could not load images. Check the local server, then choose Refresh.', true);
    }
  } finally {
    if (current === requestId) {
      grid.setAttribute('aria-busy', 'false');
      if (refresh) refresh.disabled = false;
    }
  }
}

function setStatus(message, error = false) {
  const status = document.getElementById('gallery-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('has-error', error);
}

function renderGallery() {
  const loading = document.getElementById('gallery-grid').getAttribute('aria-busy') === 'true';
  const query = document.getElementById('gallery-search')?.value.trim().toLocaleLowerCase() || '';
  const model = document.getElementById('gallery-model-filter')?.value || 'all';
  const filtered = items.filter(item => (model === 'all' || item.model === model)
    && `${item.description} ${item.prompt_json} ${item.img}`.toLocaleLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  filtered.slice(0, visibleCount).forEach(item => fragment.appendChild(buildGalleryCard(item, { load: loadItem, remove: deleteItem })));
  document.getElementById('gallery-grid').replaceChildren(fragment);
  const filteredView = query !== '' || model !== 'all';
  const shown = Math.min(filtered.length, visibleCount);
  if (!loading) setStatus(filteredView || shown < items.length ? `${shown} of ${items.length} images` : `${items.length} image${items.length === 1 ? '' : 's'}`);
  const empty = document.getElementById('gallery-empty');
  empty.hidden = loading || filtered.length !== 0;
  empty.textContent = items.length ? 'No images match your search. Try another prompt or model.' : 'No images yet. Generate an image in the editor to start your gallery.';
  const clear = document.getElementById('gallery-clear-filters');
  if (clear) clear.hidden = !filteredView;
  const more = document.getElementById('gallery-show-more');
  if (more) more.hidden = shown >= filtered.length;
}

async function deleteItem(id) {
  if (!confirm('Delete this image and its saved prompt? This cannot be undone.')) return;
  try {
    const response = await fetch('/api/delete-output', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: id }),
    });
    if (!response.ok || !(await response.json()).ok) throw new Error('Delete failed');
    items = items.filter(item => item.id !== id);
    renderGallery();
  } catch {
    showToast('Image could not be deleted. Check the local server and try again.', 'error');
  }
}

function loadItem(item) {
  // Restore model/dimensions before applying the prompt; attach the image last
  // so a model or canvas reset cannot erase the preview.
  if (item.meta && Object.keys(item.meta).length) restoreMeta(item.meta);
  if (item.prompt_json) {
    document.getElementById('json-output').value = item.prompt_json;
    emit('prompt:apply', { raw: item.prompt_json, quiet: true });
  }
  emit('image:ready', { imageUrl: `/output/${encodeURIComponent(item.img)}`, skipSave: true });
  switchTab('editor');
  document.querySelector('.tab-btn[data-tab="editor"]')?.focus();
}

async function saveToDisk(dataUrl, promptJson, loras, meta) {
  const loraSuffix = (loras ?? state.loras).map(lora => lora.filename.replace(/\.safetensors$/, '')).join('+') || undefined;
  try {
    const response = await fetch('/api/save-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, promptJson: promptJson || '', loraSuffix, meta: meta || undefined }),
    });
    if (!response.ok) throw new Error('Save failed');
    const result = await response.json();
    if (typeof result?.filename === 'string') {
      emit('image:saved', { dataUrl, imageUrl: `/output/${encodeURIComponent(result.filename)}` });
    }
    return true;
  } catch {
    showToast('Image could not be saved to the gallery. Check that the local server is running.', 'error', 6000);
    return false;
  }
}
