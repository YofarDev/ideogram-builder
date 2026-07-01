// events.js — Tiny pub/sub event bus for cross-module communication

const listeners = {};

export function on(event, fn) {
  (listeners[event] ??= []).push(fn);
}

export function emit(event, data) {
  (listeners[event] ?? []).forEach(fn => fn(data));
}

/** Reset all event listeners — used in tests to prevent stale listener accumulation. */
export function resetAllListeners() {
  Object.keys(listeners).forEach(k => delete listeners[k]);
}
