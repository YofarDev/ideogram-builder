// app.js — Entry point: imports all modules, wires button handlers, calls init()

import { initCanvas, initCanvasEvents, deleteSelectedBox, setPreviewMode } from './canvas.js';
import { initPalette } from './palette.js';
import { initJsonBuilder } from './json-builder.js';
import { initJsonConvert } from './json-convert.js';
import { enqueue, initQueue } from './queue.js';
import { initImport } from './png-import.js';
import { initModel } from './model.js';
import { initSettings } from './settings.js';
import { initSettingsMoss } from './settings-moss.js';
import { initAIEnhancer } from './ai-enhancer.js';
import { initGallery } from './gallery.js';
import { initLayers } from './layers.js';
import { initVision } from './vision.js';
import { initAudit } from './audit.js';
import { initLora } from './lora.js';
import { initLoraAdd } from './lora-add.js';
import { initStylePresets } from './style-presets.js';
import { initCollections } from './collections.js';
import { initSession } from './session.js';
import { showToast } from './toast.js';
import { emit, on } from './events.js';

// Initialize all modules
initModel();
initSettings();
initSettingsMoss();
initAIEnhancer();
initPalette();
initJsonBuilder();
initJsonConvert();
initCanvasEvents();
initLayers();
initImport();
initGallery();
initVision();
initAudit();
initLora();
initLoraAdd();
initStylePresets();
initQueue();
initCollections();

// Wire button handlers (no inline onclick in HTML)
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
// All cards start expanded; collapsed card ids persist across reloads.
const COLLAPSED_KEY = 'ideogram_collapsed_cards';
let collapsedCards;
try { collapsedCards = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []); }
catch { collapsedCards = new Set(); }
document.querySelectorAll('.card-toggle').forEach((btn) => {
  const card = btn.closest('.collapsible');
  if (!card) return;
  const setCollapsed = (collapsed) => {
    card.classList.toggle('collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
  };
  if (collapsedCards.has(card.id)) setCollapsed(true);
  btn.addEventListener('click', () => {
    const collapsed = !card.classList.contains('collapsed');
    setCollapsed(collapsed);
    if (!card.id) return;
    collapsedCards[collapsed ? 'add' : 'delete'](card.id);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedCards])); } catch { /* storage blocked */ }
  });
});

// Cmd/Ctrl+Enter queues a generation from anywhere in the Editor. The JSON
// pane claims the chord first (Apply) and marks the event handled.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.defaultPrevented || e.repeat) return;
  const generate = document.getElementById('btn-generate-image');
  if (!generate.offsetParent || generate.disabled) return;
  e.preventDefault();
  generate.click();
});

// Queue dropdown — toggled by the Queue button next to Generate; closes on
// outside click or Escape. The panel floats over the canvas (see .queue-panel CSS).
const queueBtn = document.getElementById('btn-queue');
const queuePanel = document.getElementById('queue-panel');
function setQueueOpen(open) {
  if (!open && queuePanel.contains(document.activeElement)) queueBtn.focus();
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
