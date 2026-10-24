// prompt-convert.js — Pure format detection + global-field converters between
// Ideogram and MOSS (same semantics as the captioner's moss_conversion.dart).

import { isMossJson, isMossDraft } from './prompt-moss.js';

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
