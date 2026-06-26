// collections-preview.js — pure bbox→rect math + canvas preview drawing for collections.
// No DOM at module top-level so the math is unit-checkable in node.

// bbox = [y1, x1, y2, x2] in 0-1000 space (matches canvas.js:418 / json-builder.js:129).
// Returns one rect per element, scaled to `size` (px). Defensive min/max per axis.
export function elementsToRects(elements, size = 1000) {
  if (!Array.isArray(elements)) return [];
  const out = [];
  elements.forEach((el, i) => {
    const b = el && el.bbox;
    if (!Array.isArray(b) || b.length < 4) return;
    const x1 = b[1], y1 = b[0], x2 = b[3], y2 = b[2];
    const left = Math.min(x1, x2), right = Math.max(x1, x2);
    const top = Math.min(y1, y2), bottom = Math.max(y1, y2);
    out.push({
      idx: i,
      type: el.type,
      desc: el.desc,
      colors: Array.isArray(el.color_palette) ? el.color_palette : [],
      text: el.text,
      x: left / 1000 * size,
      y: top / 1000 * size,
      w: (right - left) / 1000 * size,
      h: (bottom - top) / 1000 * size,
    });
  });
  return out;
}

// Draw element rects onto a 2D context. Needs a real canvas (browser only).
export function drawPreview(canvas, elements, size) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // jsdom, or a browser with no 2D context
  const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  const px = size;
  canvas.width = px * dpr;   // backing store (crisp); CSS controls display size
  canvas.height = px * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, px, px);

  const cs = getComputedStyle(canvas);
  const bg = cs.getPropertyValue('--surface-2').trim() || '#1c1c1c';
  const stroke = cs.getPropertyValue('--accent').trim() || '#caa56a';
  const label = cs.getPropertyValue('--text').trim() || '#eee';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);

  const rects = elementsToRects(elements, px);
  if (rects.length === 0) {
    ctx.fillStyle = cs.getPropertyValue('--text-faint').trim() || '#555';
    ctx.font = '11px ' + (cs.getPropertyValue('--font-body').trim() || 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('no layout', px / 2, px / 2);
    return;
  }

  rects.forEach((r) => {
    const fill = (r.colors[0] || stroke);
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    ctx.globalAlpha = 1;
    ctx.fillStyle = label;
    ctx.font = 'bold 10px ' + (cs.getPropertyValue('--font-body').trim() || 'sans-serif');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(r.idx + 1), r.x + 4, r.y + 3);
  });
}

// --- Node self-check (ponytail: one runnable check for the non-trivial math) ---
if (typeof window === 'undefined') {
  const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };
  const els = [{ bbox: [100, 150, 700, 500], color_palette: ['#aaa'] }];
  const r = elementsToRects(els, 200);
  assert(r.length === 1, 'one rect');
  assert(r[0].x === 30 && r[0].y === 20, `scaled x/y got ${r[0].x},${r[0].y}`); // 150/1000*200=30, 100/1000*200=20
  assert(r[0].w === 70 && r[0].h === 120, `scaled w/h got ${r[0].w},${r[0].h}`); // (500-150)/1000*200=70,(700-100)/1000*200=120
  assert(r[0].idx === 0 && r[0].colors[0] === '#aaa', 'metadata carried');
  assert(elementsToRects([], 100).length === 0, 'empty');
  assert(elementsToRects([{ bbox: [1, 2, 3] }], 100).length === 0, 'short bbox dropped');
  const inv = elementsToRects([{ bbox: [700, 500, 100, 150] }], 1000)[0];
  assert(inv.x === 150 && inv.w === 350, 'inverted bbox normalized');
  console.log('collections-preview self-check: OK');
}
