// app.js — Entry point: imports all modules, wires button handlers, calls init()

import { initCanvas, initCanvasEvents, deleteSelectedBox } from './canvas.js';
import { initPalette } from './palette.js';
import { initJsonBuilder, generateJSON } from './json-builder.js';
import { generateImage } from './comfyui.js';
import { initImport, loadFromPastedJSON } from './png-import.js';
import { initSettings } from './settings.js';

// Initialize all modules
initSettings();
initPalette();
initJsonBuilder();
initCanvasEvents();
initImport();

// Wire button handlers (no inline onclick in HTML)
document.getElementById('btn-reset').addEventListener('click', () => initCanvas());
document.getElementById('btn-generate-json').addEventListener('click', () => generateJSON());
document.getElementById('btn-load-json').addEventListener('click', () => loadFromPastedJSON());
document.getElementById('btn-generate-image').addEventListener('click', () => generateImage());
document.getElementById('btn-delete-box').addEventListener('click', () => deleteSelectedBox());

// Initial render
initCanvas();
