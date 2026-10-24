// ai-enhancer-moss.js — MOSS half of the Prompt→JSON tab: system prompts for
// layout-draft and caption output, and result validation + apply. Split from
// ai-enhancer.js (LOC limit). Behaviour adapted from OpenMOSS's
// moss-image-prompt-enhancer skill, not copied.

import { emit } from './events.js';
import { isMossJson } from './prompt-moss.js';

/** Draft-form layout prompt: the LLM places top-left pixel xyxy boxes using
 * the selected canvas size — LLMs place absolute pixels better than centered
 * coords, and the editor already parses the draft form. */
const LAYOUT_SYSTEM_PROMPT = `You convert a natural-language user idea into a MOSS-Image layout DRAFT (JSON) for a visual bounding-box editor.

Choose subjects wisely: each item is a distinct visual region or subject (3–8 items). Never split sub-parts of an already-described subject unless the part carries distinct text or a clearly separate color region.

Output ONLY a JSON object with EXACTLY this shape:
{"width":W,"height":H,"bbox_coord_space":"abs","bbox_format":"xyxy","summary":{"meta":["..."],"canvas":"single|multi_panel|collage","caption":"...","palette":["#RRGGBB"]},"items":[...]}

Rules:
- width/height: the pixel size given in the user message, echoed verbatim (positive multiples of 16).
- summary.caption: one concise sentence covering subject(s), setting, counts — no gestures or emotions (those live in item captions).
- summary.meta: 0–4 medium/genre tags (e.g. "poster", "illustration", "photograph"). summary.canvas only when meaningful. summary.palette optional, uppercase #RRGGBB, max 8.
- Each item: {"label":"object|character|text","caption":"30–60 word description (identity first)","bbox":[x_min,y_min,x_max,y_max]} — plus "text":"literal characters" when label is "text", optional "tags" and "palette".
- bbox is ABSOLUTE PIXELS from the canvas TOP-LEFT, x in 0..width, y in 0..height. Boxes place content — they are not drawn borders. Dense groups (crowd, flower field) get one encompassing box.
- A box is a placement annotation; exact visible wording goes ONLY in a text item's "text" field (preserve diacritics/case; \\n for line breaks). A text item's "caption" describes only visual treatment and placement (10–25 words) and never restates the characters.
- label "character" for people/animals/anthropomorphic beings, "text" for in-image wording, else "object".
- Commit to one value — no "or similar", "e.g.", "might be". Pick concrete nouns, counts, colors, materials.
- Name brands/characters/products explicitly when the user names them.
- No markdown fences, no commentary. Preserve non-ASCII characters as-is.`;

const CAPTION_SYSTEM_PROMPT = `You convert a natural-language user idea into ONE detailed caption for MOSS-Image generation.

Output ONLY a single prose paragraph (no JSON, no headings, no markdown):
- Main subject(s) and setting first, then composition, style, lighting, palette
- Quote any in-image text verbatim inside the caption
- Commit to concrete nouns, counts, colors, materials — no hedging ("or similar", "e.g.", "might be")
- Preserve non-ASCII characters and proper names as-is`;

export function mossSystemPrompt(format) {
  return format === 'caption' ? CAPTION_SYSTEM_PROMPT : LAYOUT_SYSTEM_PROMPT;
}

export function mossUserPrompt(idea, format, { width, height }) {
  if (format === 'caption') return `User idea: ${idea}`;
  return `TARGET CANVAS: ${width}\u00d7${height} pixels (width\u00d7height, multiples of 16).\nUser idea: ${idea}`;
}

/**
 * Validate + apply a MOSS enhance result via the shared prompt:apply path.
 * Returns { ok } or { ok: false, error } — the caller shows the status.
 */
export function applyMossEnhanceResult(content, format) {
  if (format === 'caption') {
    const text = content.trim();
    if (!text) return { ok: false, error: 'Empty response from API' };
    emit('prompt:apply', { raw: text });
    return { ok: true };
  }

  let draft;
  try {
    draft = JSON.parse(content);
  } catch {
    return { ok: false, error: 'Invalid JSON response from API' };
  }
  if (!isMossJson(draft)) {
    return { ok: false, error: 'Response missing MOSS summary/items' };
  }
  emit('prompt:apply', { raw: content });
  return { ok: true };
}
