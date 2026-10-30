// Editing details belong to the session, separate from the generation prompt.
import { state, validCanvasSize } from './state.js';
import { emit } from './events.js';
import { localImageUrl } from './reference-image.js';

export function captureWorkspace() {
  return {
    width: state.canvas.width, height: state.canvas.height,
    boxes: state.boxes.map(box => ({ ...box, colors: [...(box.colors || [])], tags: [...(box.tags || [])] })),
    palette: [...state.globalPalette],
    loras: state.loras.map(lora => ({ ...lora, strengths: { ...lora.strengths } })),
    selectedIndex: state.boxes.findIndex(box => box.id === state.selectedBoxId),
    imageUrl: localImageUrl(state.referenceImageUrl),
    imageOpacity: Number.parseFloat(document.getElementById('canvas-overlay')?.style.opacity || '0.4'),
  };
}

const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

export function restoreWorkspace(workspace) {
  if (!workspace || !Array.isArray(workspace.boxes)
    || !validCanvasSize(workspace.width, workspace.height)) return false;
  const boxes = workspace.boxes.filter(box => box && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(box[key])));
  // Reject a partial snapshot so the prompt's intact boxes remain available.
  if (boxes.length !== workspace.boxes.length) return false;
  state.canvas.width = workspace.width;
  state.canvas.height = workspace.height;
  const dimensions = document.getElementById('dim-display');
  if (dimensions) dimensions.textContent = `${workspace.width} × ${workspace.height}`;
  emit('workspace:restore', {
    boxes: boxes.map(box => ({
      x: box.x, y: box.y, w: box.w, h: box.h,
      mode: ['obj', 'text', 'character'].includes(box.mode) ? box.mode : 'obj',
      text: typeof box.text === 'string' ? box.text : '',
      desc: typeof box.desc === 'string' ? box.desc : '',
      color: typeof box.color === 'string' ? box.color : '',
      colors: strings(box.colors), tags: strings(box.tags),
      visible: box.visible !== false, locked: box.locked === true,
    })),
    palette: strings(workspace.palette), selectedIndex: workspace.selectedIndex,
    loras: Array.isArray(workspace.loras) ? workspace.loras : null,
  });
  emit('canvas:relayout');
  const imageUrl = localImageUrl(workspace.imageUrl);
  if (imageUrl) emit('image:ready', { imageUrl, opacity: workspace.imageOpacity, skipSave: true });
  return true;
}
