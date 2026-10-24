// vision-moss.js — MOSS conversion for Vision results. The vision pipeline
// always returns Ideogram JSON; in MOSS mode the globals are converted
// client-side (elements stay as-is — the editor box format is shared).

import { ideogramGlobalsToMoss } from './prompt-convert.js';

/**
 * Ideogram analysis JSON → the `moss` payload for state:loaded
 * ({ caption, meta, canvas, palette }). Lossy by design (lighting/photo fold
 * into meta); the toast tells the user a conversion happened.
 */
export function visionToMoss(json) {
  const style = json.style_description || {};
  const { caption, meta } = ideogramGlobalsToMoss({
    high_level_description: json.high_level_description,
    background: json.compositional_deconstruction?.background,
    medium: style.medium,
    art_style: style.art_style,
    photo: style.photo,
    aesthetics: style.aesthetics,
    lighting: style.lighting,
  });
  return { caption, meta, canvas: '', palette: style.color_palette || [] };
}
