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

let armed = false;

/** Restore dimensions (size tier + aspect ratio) from the blob. */
function applyDimensions(config) {
  // Size tier FIRST — updateDimensions reads .size-btn.active
  const size = config.size || '1';
  document.querySelectorAll('.size-btn').forEach((b) => {
    const on = b.dataset.size === size;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // Aspect ratio — dispatch change so settings.updateDimensions sizes the canvas
  const ar = document.getElementById('aspect-ratio');
  if (ar) {
    const val = config.aspectRatio || localStorage.getItem('ideogram_aspect_ratio');
    if (val && Array.from(ar.options).some((o) => o.value === val)) {
      ar.value = val;
      ar.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

/** Restore prompt content via the existing state:loaded path. */
function applyContent(content) {
  if (!content) return;
  const out = document.getElementById('json-output');
  if (out) out.value = content;
  try {
    emit('state:loaded', { json: JSON.parse(content) });
  } catch {
    /* corrupt content — leave textarea as-is, skip box rebuild */
  }
}

/** Apply a <select> value once its <option> exists (options arrive async via /api/config). */
function applySelectWhenReady(id, value) {
  if (!value) return;
  const sel = document.getElementById(id);
  if (!sel) return;
  if (sel.querySelector(`option[value="${value}"]`)) {
    sel.value = value;
    return;
  }
  const observer = new MutationObserver(() => {
    if (sel.querySelector(`option[value="${value}"]`)) {
      sel.value = value;
      observer.disconnect();
    }
  });
  observer.observe(sel, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
}

/** Restore the full session: dimensions → content → config → UI. */
export function restore() {
  const blob = loadSession();
  if (!blob) return;
  const config = blob.config || {};
  const ui = blob.ui || {};
  const el = (id) => document.getElementById(id);

  // 1. Dimensions (before content — boxes need correct canvas size)
  applyDimensions(config);

  // 2. Content → state:loaded rebuilds boxes/fields/palette/layers
  applyContent(blob.content);

  // 3. Remaining config (no event dispatch → no regenerate cascade)
  if (config.mode === 'photo') {
    if (el('mode_photo')) el('mode_photo').checked = true;
  } else {
    if (el('mode_artstyle')) el('mode_artstyle').checked = true;
  }
  if (el('seed-input') && !isNaN(config.seed)) el('seed-input').value = config.seed;
  applySelectWhenReady('ai-model', config.aiModel);
  applySelectWhenReady('vision-model', config.visionModel);
  applySelectWhenReady('recaption-model', config.recaptionModel);

  // 4. UI — reuse existing handlers via synthetic clicks
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${ui.tab || 'editor'}"]`);
  if (tabBtn) tabBtn.click();
  if (ui.fullscreen) el('btn-enter-fullscreen')?.click();
  if (ui.preview) el('btn-preview')?.click();
}
