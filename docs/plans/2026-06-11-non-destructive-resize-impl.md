# Non-Destructive Canvas Resize Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve boxes and overlay when changing aspect ratio or 1M/2M size

**Architecture:** Store box x/y/w/h as normalized 0-1000 floats internally instead of pixels. Re-render DOM from normalized values when canvas dimensions change. No chained remapping math needed.

**Tech Stack:** Vanilla JS, no build tools.

---

### Task 1: Store box coordinates as normalized 0-1000 in canvas.js

**Files:**
- Modify: `src/canvas.js:109-114` — box creation
- Modify: `src/canvas.js:236-239` — pointer up finalization

**Step 1: Normalize on draw start**

Replace pixel coords with normalized:
```js
const box = {
  id: nextBoxId(),
  x: (startX / state.canvas.width) * 1000,
  y: (startY / state.canvas.height) * 1000,
  w: 0, h: 0,
  mode: 'obj', text: '', desc: '', colors: [],
  visible: true, locked: false,
};
```

**Step 2: Normalize on pointer up**
```js
box.w = ((parseFloat(currentBoxDOM.style.width) || 0) / state.canvas.width) * 1000;
box.h = ((parseFloat(currentBoxDOM.style.height) || 0) / state.canvas.height) * 1000;
box.x = ((parseFloat(currentBoxDOM.style.left) || 0) / state.canvas.width) * 1000;
box.y = ((parseFloat(currentBoxDOM.style.top) || 0) / state.canvas.height) * 1000;
```

### Task 2: Add renderBoxes() and resizeCanvas() to canvas.js

**Files:**
- Modify: `src/canvas.js` — add two functions before `export function initCanvas()`

**Step 1: Add renderBoxes()**
```js
function renderBoxes() {
  state.boxes.forEach(box => {
    const dom = document.getElementById(box.id);
    if (dom) {
      dom.style.left = (box.x / 1000 * state.canvas.width) + 'px';
      dom.style.top = (box.y / 1000 * state.canvas.height) + 'px';
      dom.style.width = (box.w / 1000 * state.canvas.width) + 'px';
      dom.style.height = (box.h / 1000 * state.canvas.height) + 'px';
    }
  });
}
```

**Step 2: Add resizeCanvas()**
```js
function resizeCanvas() {
  const canvas = document.getElementById('canvas-wrapper');
  const container = document.querySelector('.canvas-container');
  const { width, height } = state.canvas;

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  state.canvas.scale = height > 800 ? 800 / height : 1;
  canvas.style.transformOrigin = 'top left';
  canvas.style.transform = `scale(${state.canvas.scale})`;

  const padY = 32;
  container.style.height = (height * state.canvas.scale + padY) + 'px';

  renderBoxes();
}
```

### Task 3: Change canvas:rebuild handler to support resize payload

**Files:**
- Modify: `src/canvas.js:272` — event handler
- Modify: `src/canvas.js:303-354` — state:loaded handler

**Step 1: Change canvas:rebuild handler**
```js
on('canvas:rebuild', (data) => {
  if (data?.oldWidth && state.boxes.length > 0) {
    resizeCanvas();
  } else {
    initCanvas();
  }
});
```

**Step 2: Update state:loaded handler DOM creation**

Remove denormalization lines (308-311). Store bbox values directly (they're already 0-1000). Change DOM position assignment:
```js
const box = {
  id: nextBoxId(),
  x: bbox[1], y: bbox[0],
  w: bbox[3] - bbox[1], h: bbox[2] - bbox[0],
  mode: element.type,
  text: element.text ?? '',
  desc: element.desc,
  colors: element.color_palette ?? [],
  visible: true, locked: false,
};
state.boxes.push(box);

const dom = document.createElement('div');
dom.className = 'bounding-box';
dom.id = box.id;
dom.style.left = (box.x / 1000 * state.canvas.width) + 'px';
dom.style.top = (box.y / 1000 * state.canvas.height) + 'px';
dom.style.width = (box.w / 1000 * state.canvas.width) + 'px';
dom.style.height = (box.h / 1000 * state.canvas.height) + 'px';
```

### Task 4: Pass old dimensions in settings.js

**Files:**
- Modify: `src/settings.js:8-25`

**Step 1: Capture old dims and emit with payload**

```js
function updateDimensions() {
  const sel = document.getElementById('aspect-ratio');
  const size = document.querySelector('.size-btn.active')?.dataset.size || '1';
  const [baseW, baseH] = sel.value.split('x').map(Number);

  const oldWidth = state.canvas.width;
  const oldHeight = state.canvas.height;

  if (size === '2') {
    const longSide = Math.max(baseW, baseH);
    const scale = 2048 / longSide;
    state.canvas.width = round16(baseW * scale);
    state.canvas.height = round16(baseH * scale);
  } else {
    state.canvas.width = baseW;
    state.canvas.height = baseH;
  }

  document.getElementById('dim-display').textContent = `${state.canvas.width} × ${state.canvas.height}`;

  if (state.boxes.length > 0 && oldWidth && oldHeight &&
      (oldWidth !== state.canvas.width || oldHeight !== state.canvas.height)) {
    emit('canvas:rebuild', { oldWidth, oldHeight });
  } else {
    emit('canvas:rebuild');
  }
}
```

### Task 5: Update JSON builder to work with normalized values

**Files:**
- Modify: `src/json-builder.js:32-39` — DOM sync
- Modify: `src/json-builder.js:43-49` — normalization

**Step 1: DOM sync normalizes instead of storing raw pixels**
```js
state.boxes.forEach((box) => {
  const dom = document.getElementById(box.id);
  if (dom) {
    box.x = (parseFloat(dom.style.left) / canvasW) * 1000;
    box.y = (parseFloat(dom.style.top) / canvasH) * 1000;
    box.w = (parseFloat(dom.style.width) / canvasW) * 1000;
    box.h = (parseFloat(dom.style.height) / canvasH) * 1000;
  }
});
```

**Step 2: Use clamp instead of norm (values already 0-1000)**
```js
const clamp = (v) => Math.min(1000, Math.max(0, Math.round(v)));
const x1 = clamp(box.x);
const y1 = clamp(box.y);
const x2 = clamp(box.x + box.w);
const y2 = clamp(box.y + box.h);
```

### Task 6: Update layer thumbnail to use 1000 as divisor

**Files:**
- Modify: `src/layers.js:157-162`

**Step 1: Replace canvas dims lookup with 1000**
```js
const left = ((box.x / 1000) * 100);
const top = ((box.y / 1000) * 100);
const width = Math.max(4, (box.w / 1000) * 100);
const height = Math.max(4, (box.h / 1000) * 100);
```

Remove the `cw`/`ch` variable declarations.

### Task 7: Verify by serving the app

**Step 1: Start the dev server**
```bash
python3 server.py
```

**Step 2: Manual smoke test**
- Load app, draw a few boxes
- Change aspect ratio — boxes should rescale proportionally
- Change 1M/2M — boxes should rescale
- Verify JSON output still has correct 0-1000 bbox values
- Import image, draw boxes, change dimensions — should work
