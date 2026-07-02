// app.js — Entry point: imports all modules, wires button handlers, calls init()

import { initCanvas, initCanvasEvents, deleteSelectedBox, setPreviewMode } from './canvas.js';
import { initPalette } from './palette.js';
import { initJsonBuilder } from './json-builder.js';
import { enqueue, initQueue } from './queue.js';
import { initImport } from './png-import.js';
import { initSettings } from './settings.js';
import { initAIEnhancer } from './ai-enhancer.js';
import { initGallery } from './gallery.js';
import { initLayers } from './layers.js';
import { initVision } from './vision.js';
import { initLora } from './lora.js';
import { initStylePresets } from './style-presets.js';
import { initCollections } from './collections.js';
import { initSession } from './session.js';
import { showToast } from './toast.js';
import { emit, on } from './events.js';

// Initialize all modules
initSettings();
initAIEnhancer();
initPalette();
initJsonBuilder();
initCanvasEvents();
initLayers();
initImport();
initGallery();
initVision();
initLora();
initStylePresets();
initQueue();
initCollections();

// Wire button handlers (no inline onclick in HTML)
document.getElementById('btn-reset').addEventListener('click', () => {
  if (state.boxes.length === 0 && !document.getElementById('json-output').value.trim()) {
    initCanvas();
    return;
  }
  if (confirm('Reset canvas? All boxes and settings will be lost.')) {
    initCanvas();
    showToast('Canvas reset.', 'info');
  }
});
document.getElementById('btn-generate-image').addEventListener('click', () => enqueue());
document.getElementById('btn-delete-box')?.addEventListener('click', () => deleteSelectedBox());
document.getElementById('btn-config').addEventListener('click', () => fetch('/api/open-config'));

// Import state for reset confirmation
import { state } from './state.js';

// Initial render
initCanvas();
// Restore saved session (settings, content, boxes, UI) — must run after initCanvas
// because restore dispatches change/click events and rebuilds boxes on the canvas.
initSession();

document.getElementById('btn-preview').addEventListener('click', () => {
  const enabled = !state.ui.previewMode;
  setPreviewMode(enabled);
  document.getElementById('btn-preview').classList.toggle('active', enabled);
});

on('canvas:reset', () => {
  if (state.ui.previewMode) {
    setPreviewMode(false);
    document.getElementById('btn-preview').classList.remove('active');
  }
});

// Collapsible cards — every .card-toggle toggles its nearest .collapsible card.
// Prompt JSON starts collapsed; all other cards start expanded.
document.querySelectorAll('.card-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.collapsible');
    if (!card) return;
    const collapsed = card.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
  });
});

// Queue dropdown — toggled by the Queue button next to Generate; closes on
// outside click or Escape. The panel floats over the canvas (see .queue-panel CSS).
const queueBtn = document.getElementById('btn-queue');
const queuePanel = document.getElementById('queue-panel');
function setQueueOpen(open) {
  queuePanel.hidden = !open;
  queueBtn.setAttribute('aria-expanded', String(open));
}
queueBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setQueueOpen(queuePanel.hidden);
});
document.addEventListener('click', (e) => {
  if (!queuePanel.hidden && !queuePanel.contains(e.target) && e.target !== queueBtn) {
    setQueueOpen(false);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !queuePanel.hidden) setQueueOpen(false);
});

window.addEventListener('resize', () => emit('canvas:relayout'));
