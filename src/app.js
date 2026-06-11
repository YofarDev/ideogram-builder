// app.js — Entry point: imports all modules, wires button handlers, calls init()

import { initCanvas, initCanvasEvents, deleteSelectedBox } from './canvas.js';
import { initPalette } from './palette.js';
import { initJsonBuilder } from './json-builder.js';
import { generateImage } from './runpod.js';
import { initImport } from './png-import.js';
import { initSettings } from './settings.js';
import { initAIEnhancer } from './ai-enhancer.js';
import { initGallery } from './gallery.js';
import { initLayers } from './layers.js';
import { initVision } from './vision.js';
import { showToast } from './toast.js';

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
document.getElementById('btn-generate-image').addEventListener('click', () => generateImage());
document.getElementById('btn-delete-box').addEventListener('click', () => deleteSelectedBox());
document.getElementById('btn-config').addEventListener('click', () => fetch('/api/open-config'));

// Import state for reset confirmation
import { state } from './state.js';

// Initial render
initCanvas();
