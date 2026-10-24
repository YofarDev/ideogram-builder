// prompt-convert.js — Pure format detection, global-field converters and
// full-document converters between Ideogram and MOSS (same semantics as the
// captioner's moss_conversion.dart).

import { isMossJson, isMossDraft, buildMossLayout, parseMoss } from './prompt-moss.js';

/**
 * → 'ideogram' | 'moss' | 'moss-draft' | 'caption' | 'empty'
 *   ideogram: JSON with high_level_description | style_description | compositional_deconstruction
 *   moss / moss-draft: per prompt-moss predicates; any other non-empty text → 'caption'
 */
export function detectPromptFormat(text) {
  if (!text || !text.trim()) return 'empty';
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      if (obj.high_level_description || obj.style_description || obj.compositional_deconstruction) return 'ideogram';
      if (isMossDraft(obj)) return 'moss-draft';
      if (isMossJson(obj)) return 'moss';
    }
  } catch { /* not JSON */ }
  return 'caption';
}

/**
 * Ideogram global fields → MOSS { caption, meta } (lossy).
 * caption = [hld, background].filter(Boolean).join(' ')
 * meta = [medium, ...aesthetics.split(','), lighting, photo || art_style] trimmed, empties dropped
 */
export function ideogramGlobalsToMoss({ high_level_description = '', background = '', medium = '', art_style = '', photo = '', aesthetics = '', lighting = '' } = {}) {
  const caption = [high_level_description, background].filter(Boolean).join(' ');
  const meta = [
    medium,
    ...aesthetics.split(','),
    lighting,
    photo || art_style,
  ].map((s) => s.trim()).filter(Boolean);
  return { caption, meta };
}

/**
 * MOSS { caption, meta } → Ideogram globals (inverse, lossy).
 * medium = first meta tag that is a known Ideogram medium (else '');
 * aesthetics = the remaining meta tags joined ', '.
 */
export function mossGlobalsToIdeogram({ caption = '', meta = [] } = {}) {
  const tags = Array.isArray(meta) ? meta : [];
  const medium = tags.find((t) => KNOWN_MEDIUMS.includes(t)) || '';
  const aesthetics = tags.filter((t) => t !== medium).join(', ');
  return { high_level_description: caption, medium, aesthetics };
}

const KNOWN_MEDIUMS = ['photograph', 'illustration', '3d_render', 'painting', 'graphic_design'];

/**
 * Full Ideogram JSON → MOSS layout object (lossy; see ideogramGlobalsToMoss).
 * Elements keep their order; bbox-less elements are dropped and counted.
 * @param {object} json - parsed Ideogram JSON
 * @param {{width:number,height:number}} canvas - generation size the layout targets
 * @returns {{ layout: object, dropped: number }}
 */
export function ideogramToMoss(json, { width, height }) {
  const style = json.style_description || {};
  const comp = json.compositional_deconstruction || {};
  const { caption, meta } = ideogramGlobalsToMoss({
    high_level_description: json.high_level_description || '',
    background: comp.background || '',
    medium: style.medium || '',
    art_style: style.art_style || '',
    photo: style.photo || '',
    aesthetics: style.aesthetics || '',
    lighting: style.lighting || '',
  });

  let missing = 0;
  // Ideogram lists elements top-layer-first; buildMossLayout takes editor
  // order (bottom→top) and reverses it, so feed it reversed.
  const boxes = (comp.elements || []).flatMap((el) => {
    const b = el.bbox;
    if (!Array.isArray(b) || b.length !== 4) { missing++; return []; }
    // Un-flip inverted corners (seen in hand-written prompts, e.g. x1 > x2)
    const [y1, y2] = [Math.min(b[0], b[2]), Math.max(b[0], b[2])];
    const [x1, x2] = [Math.min(b[1], b[3]), Math.max(b[1], b[3])];
    return [{
      x: x1, y: y1, w: x2 - x1, h: y2 - y1,
      mode: el.type === 'text' ? 'text' : el.type === 'character' ? 'character' : 'obj',
      desc: el.desc || '',
      text: el.text ?? '',
      tags: el.tags || [],
      colors: el.color_palette || [],
    }];
  }).reverse();

  const { layout, dropped } = buildMossLayout({
    caption, meta, canvas: '', palette: style.color_palette || [], boxes, width, height,
  });
  return { layout, dropped: dropped + missing };
}

/**
 * Full MOSS layout (compiled or captioner draft) → Ideogram JSON (lossy:
 * character → obj, tags and summary.canvas have no Ideogram slot).
 * @param {object} json - parsed MOSS JSON
 * @param {{width:number,height:number}} canvas - size for centralized coords
 */
export function mossToIdeogram(json, canvas) {
  const { view, moss } = parseMoss(json, canvas);
  const { high_level_description, medium, aesthetics } = mossGlobalsToIdeogram(moss);
  const round = (v) => Math.min(1000, Math.max(0, Math.round(v)));
  const elements = view.compositional_deconstruction.elements.map((el) => {
    const out = { type: el.type === 'text' ? 'text' : 'obj', bbox: el.bbox.map(round) };
    if (el.type === 'text') out.text = el.text ?? '';
    out.desc = el.desc;
    if (el.color_palette?.length > 0) out.color_palette = el.color_palette;
    return out;
  });
  return {
    high_level_description,
    style_description: {
      aesthetics,
      lighting: '',
      medium,
      art_style: '',
      color_palette: moss.palette || [],
    },
    compositional_deconstruction: { background: '', elements },
  };
}
