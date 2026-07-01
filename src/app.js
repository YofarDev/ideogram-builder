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

// --- Fullscreen drawing mode ---
function applyFullscreenHeight() {
  const topbar = document.getElementById('editor-toolbar');
  const overhead = (topbar ? topbar.offsetHeight : 52) + 96; // toolbar + paddings + gaps + margin
  state.canvas.maxDisplayHeight = Math.max(400, window.innerHeight - overhead);
}

function setFullscreen(on) {
  state.ui.drawFullscreen = on;
  document.querySelector('.main-content').classList.toggle('draw-fullscreen', on);
  if (on) {
    applyFullscreenHeight();
  } else {
    state.canvas.maxDisplayHeight = 800;
  }
  emit('canvas:relayout');
}

document.getElementById('btn-enter-fullscreen').addEventListener('click', () => setFullscreen(true));
document.getElementById('btn-exit-fullscreen').addEventListener('click', () => setFullscreen(false));

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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.ui.drawFullscreen) setFullscreen(false);
});

window.addEventListener('resize', () => {
  if (state.ui.drawFullscreen) applyFullscreenHeight();
  emit('canvas:relayout');
});
