// state.js — Single source of truth for all app state

export const MODE_PHOTO = 0;
export const MODE_ARTSTYLE = 1;

export const MODEL_IDEOGRAM = 'ideogram';
export const MODEL_MOSS = 'moss';
export const MOSS_DEFAULT_NEGATIVE = 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact';

export const state = {
  canvas: { width: 768, height: 1152, scale: 1, maxDisplayHeight: 800 },
  boxes: [],
  globalPalette: [],
  selectedBoxId: null,
  boxCounter: 0,
  photoArtMode: MODE_ARTSTYLE,
  model: MODEL_IDEOGRAM,
  // moss caption/meta/canvas/negative live in DOM inputs (same pattern as Ideogram fields)
  moss: { promptMode: 'layout', preset: 'Fast' },
  preset: 'Default',
  workflow: 'turbo',
  turboStrength: 0.8,
  loras: [],
  seed: -1,
  ui: { previewMode: false },
  imageDataUrl: null,
  referenceImageUrl: null,
  imageRevision: 0,
};

export function getBox(id) {
  return state.boxes.find(b => b.id === id);
}

export function nextBoxId() {
  return 'box_' + state.boxCounter++;
}

// Normalized box coords live in [0,1000]. Clamp on every write to keep them valid.
export function clampBox(box) {
  box.x = Math.min(1000, Math.max(0, box.x));
  box.y = Math.min(1000, Math.max(0, box.y));
  box.w = Math.min(1000, Math.max(0, box.w));
  box.h = Math.min(1000, Math.max(0, box.h));
}

// Identity color for layers — golden-ratio hue spacing keeps consecutive boxes distinct.
let layerColorSeed = Math.floor(Math.random() * 360);
export function randomLayerColor() {
  const hue = (layerColorSeed * 137.508) % 360;
  layerColorSeed++;
  return `hsl(${hue.toFixed(0)}, 70%, 62%)`;
}

// Sync box positions from their canvas DOM elements → normalized 0–1000 coords.
// Shared by the Ideogram and MOSS JSON builders before serialization.
export function syncBoxesFromDOM() {
  state.boxes.forEach((box) => {
    const dom = document.getElementById(box.id);
    if (dom) {
      box.x = (parseFloat(dom.style.left) / state.canvas.width) * 1000;
      box.y = (parseFloat(dom.style.top) / state.canvas.height) * 1000;
      box.w = (parseFloat(dom.style.width) / state.canvas.width) * 1000;
      box.h = (parseFloat(dom.style.height) / state.canvas.height) * 1000;
    }
  });
}
