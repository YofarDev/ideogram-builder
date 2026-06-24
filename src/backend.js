// backend.js — dispatcher: routes runJob to RunPod or Modal based on the UI toggle.
import { runJob as runpodJob } from './runpod.js';
import { runJob as modalJob } from './modal.js';

export function currentBackend() {
  return localStorage.getItem('ideogram_backend') === 'modal' ? 'modal' : 'runpod';
}

// Same signature/return shape ({ dataUrl, imageUrl }) regardless of backend.
export function runJob(snapshot, opts) {
  return currentBackend() === 'modal' ? modalJob(snapshot, opts) : runpodJob(snapshot, opts);
}
