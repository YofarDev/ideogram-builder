import { state } from './state.js';

// Session references may point only to local output images.
export function localImageUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/output/')) return null;
  try {
    const name = decodeURIComponent(value.slice(8));
    return name && !/[\\/?#]/.test(name) && /\.(png|jpe?g|webp)$/i.test(name) ? value : null;
  } catch { return null; }
}

export function hasReferenceImage() {
  return Boolean(state.imageDataUrl || localImageUrl(state.referenceImageUrl));
}

export async function readReferenceImage() {
  if (state.imageDataUrl) return state.imageDataUrl;
  const url = localImageUrl(state.referenceImageUrl);
  if (!url) throw new Error('Load a reference image before recaptioning.');
  const revision = state.imageRevision;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Reference image could not be loaded. Reopen it from the gallery.');
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Reference image could not be read. Reopen it from the gallery.'));
    reader.readAsDataURL(blob);
  });
  if (revision !== state.imageRevision) throw new Error('Reference image changed. Try recaptioning again.');
  state.imageDataUrl = dataUrl;
  return dataUrl;
}
