// state.js — Single source of truth for all app state

export const MODE_PHOTO = 0;
export const MODE_ARTSTYLE = 1;

export const state = {
  canvas: { width: 768, height: 1152, scale: 1, maxDisplayHeight: 800 },
  boxes: [],
  globalPalette: [],
  selectedBoxId: null,
  boxCounter: 0,
  photoArtMode: MODE_ARTSTYLE,
  preset: 'Default',
  workflow: 'turbo',
  turboStrength: 0.8,
  loras: [],
  seed: -1,
  ui: { previewMode: false },
  imageDataUrl: null,
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
