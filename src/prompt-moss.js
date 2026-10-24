// prompt-moss.js — Pure MOSS-Image layout helpers (no DOM, no state).
// Conversion maths mirrors ComfyUI's MOSSImageLayoutPrompt node so the
// editor's output matches the official node byte-for-byte.

const r9 = (v) => Math.round(v * 1e9) / 1e9;
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Editor boxes (0–1000 x/y/w/h, bottom→top order) → MOSS layout object.
 * Returns { layout, dropped } — dropped counts boxes that degenerate to zero
 * area after conversion (y1 >= y2 or x1 >= x2) and are left out of items.
 */
export function buildMossLayout({ caption, meta, canvas, palette, boxes, width, height }) {
  const hw = Math.floor(width / 2), hh = Math.floor(height / 2);
  let dropped = 0;

  // Items are emitted top-layer-first (reverse of state.boxes), same as Ideogram.
  const items = [...boxes].reverse().flatMap((box) => {
    const y1 = clampInt(Math.floor(r9(box.y * height / 1000)) - hh, -hh, hh);
    const x1 = clampInt(Math.floor(r9(box.x * width / 1000)) - hw, -hw, hw);
    const y2 = clampInt(Math.ceil(r9((box.y + box.h) * height / 1000)) - hh, -hh, hh);
    const x2 = clampInt(Math.ceil(r9((box.x + box.w) * width / 1000)) - hw, -hw, hw);
    if (y1 >= y2 || x1 >= x2) { dropped++; return []; }

    const label = box.mode === 'text' ? 'text' : box.mode === 'character' ? 'character' : 'object';
    const item = { label, caption: box.desc };
    if (label === 'text') item.text = box.text;
    item.bbox = [y1, x1, y2, x2];
    if (box.tags?.length > 0) item.tags = box.tags;
    if (box.colors?.length > 0) item.palette = box.colors;
    return [item];
  });

  const summary = {};
  if (meta?.length > 0) summary.meta = meta;
  if (canvas) summary.canvas = canvas;
  summary.caption = caption;
  if (palette?.length > 0) summary.palette = palette;

  return {
    layout: {
      summary,
      items,
      bbox_coord_space: 'abs_centralized',
      bbox_format: 'yxyx',
    },
    dropped,
  };
}

/** Layout object → one-line string sent to the model (no spaces). */
export function compileMoss(layout) {
  return JSON.stringify(layout);
}

/**
 * Any MOSS JSON (compiled abs_centralized or captioner draft abs/xyxy) →
 * { view, moss, dims }:
 *   view = Ideogram-shaped JSON the existing state:loaded consumers understand
 *   moss = { caption, meta, canvas, palette } for the MOSS field inputs
 *   dims = { width, height } when the draft carries them, else null
 * @param {object} json - parsed MOSS JSON
 * @param {{width:number,height:number}} canvas - canvas size for the compiled form
 */
export function parseMoss(json, { width, height }) {
  const draft = isMossDraft(json);
  const W = draft && Number.isFinite(json.width) ? json.width : width;
  const H = draft && Number.isFinite(json.height) ? json.height : height;
  const hw = Math.floor(W / 2), hh = Math.floor(H / 2);
  // Clamped but NOT rounded: the fractional editor coord is the exact inverse
  // of buildMossLayout's floor/ceil maths, so compile → parse → compile is
  // byte-stable (integer rounding would drift ~1px per round trip). Drawn
  // boxes carry fractional normalized coords already.
  const norm = (v) => Math.min(1000, Math.max(0, v));

  const elements = (json.items || []).map((item) => {
    const b = Array.isArray(item.bbox) ? item.bbox : [0, 0, 0, 0];
    const bbox = draft
      ? [norm(b[1] / H * 1000), norm(b[0] / W * 1000), norm(b[3] / H * 1000), norm(b[2] / W * 1000)]
      : [norm((b[0] + hh) / H * 1000), norm((b[1] + hw) / W * 1000), norm((b[2] + hh) / H * 1000), norm((b[3] + hw) / W * 1000)];

    const type = item.label === 'text' ? 'text' : item.label === 'character' ? 'character' : 'obj';
    const el = { type, bbox };
    if (type === 'text') el.text = item.text ?? '';
    el.desc = item.caption ?? '';
    if (item.palette?.length > 0) el.color_palette = item.palette;
    if (item.tags?.length > 0) el.tags = item.tags;
    return el;
  });

  const view = {
    high_level_description: json.summary?.caption ?? '',
    style_description: {
      aesthetics: '',
      lighting: '',
      medium: '',
      color_palette: json.summary?.palette ?? [],
    },
    compositional_deconstruction: { background: '', elements },
  };

  const moss = {
    caption: json.summary?.caption ?? '',
    meta: json.summary?.meta ?? [],
    canvas: json.summary?.canvas ?? '',
    palette: json.summary?.palette ?? [],
  };

  return { view, moss, dims: draft ? { width: W, height: H } : null };
}

/** summary is an object with a string caption and items is an array. */
export function isMossJson(obj) {
  return !!obj && typeof obj === 'object'
    && !!obj.summary && typeof obj.summary === 'object'
    && typeof obj.summary.caption === 'string'
    && Array.isArray(obj.items);
}

/** Captioner draft form: MOSS JSON with top-left pixel bboxes. */
export function isMossDraft(obj) {
  return isMossJson(obj) && obj.bbox_coord_space === 'abs';
}
