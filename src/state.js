// state.js — Single source of truth for all app state

export const MODE_PHOTO = 0;
export const MODE_ARTSTYLE = 1;

export const state = {
  canvas: { width: 1024, height: 1024, scale: 1 },
  boxes: [],
  globalPalette: [],
  selectedBoxId: null,
  boxCounter: 0,
  photoArtMode: MODE_ARTSTYLE,
};

export function getBox(id) {
  return state.boxes.find(b => b.id === id);
}

export function nextBoxId() {
  return 'box_' + state.boxCounter++;
}
