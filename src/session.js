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
