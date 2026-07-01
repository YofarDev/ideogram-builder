// session.js — Persist & restore session state (content + config + UI) across reloads.
import { on, emit } from './events.js';

const STORAGE_KEY = 'ideogram_session';
export const VERSION = 1;

/** Read + parse the session blob. Returns null when absent or corrupt. */
export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

/** Serialize + persist the blob. Quota / private-mode errors are swallowed. */
export function writeSession(blob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...blob, version: VERSION }));
  } catch (err) {
    console.warn('[session] save failed', err);
  }
}

/** Read current content/config/ui from the live DOM into a snapshot blob. */
export function captureSnapshot() {
  const el = (id) => document.getElementById(id);

  const jsonText = el('json-output')?.value.trim();
  const activeSize = document.querySelector('.size-btn.active');
  const stepsRadio = document.querySelector('input[name="steps"]:checked');
  const activeTab = document.querySelector('.tab-btn.active');

  const seedRaw = parseInt(el('seed-input')?.value, 10);

  return {
    version: VERSION,
    content: jsonText || null,
    config: {
      size: activeSize?.dataset.size || '1',
      steps: stepsRadio?.dataset.preset || 'Default',
      mode: el('mode_photo')?.checked ? 'photo' : 'art_style',
      seed: isNaN(seedRaw) ? -1 : seedRaw,
      aspectRatio: el('aspect-ratio')?.value || '768x1152',
      aiModel: el('ai-model')?.value || '',
      visionModel: el('vision-model')?.value || '',
      recaptionModel: el('recaption-model')?.value || '',
    },
    ui: {
      tab: activeTab?.dataset.tab || 'editor',
      fullscreen: document.querySelector('.main-content')?.classList.contains('draw-fullscreen') || false,
      preview: el('btn-preview')?.classList.contains('active') || false,
    },
  };
}
