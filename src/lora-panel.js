// lora-panel.js — LoRA popover chrome (split of lora.js): #btn-lora toggles
// #lora-panel, outside click / Escape close it, the search box reports to lora.js
// through callbacks. Owns no LoRA data.

function setPanelOpen(open) {
  const panel = document.getElementById('lora-panel');
  const btn = document.getElementById('btn-lora');
  if (!panel || !btn) return;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) document.getElementById('lora-search')?.focus();
}

/** @param {{ onSearch: (value: string) => void, onPickFirst: () => boolean }} handlers */
export function initLoraPanel({ onSearch, onPickFirst }) {
  const panel = document.getElementById('lora-panel');
  const btn = document.getElementById('btn-lora');
  // initLora can run more than once on the same DOM (session restore, tests)
  if (!panel || !btn || btn.dataset.loraBound) return;
  btn.dataset.loraBound = '1';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPanelOpen(panel.hidden);
  });
  // composedPath() is fixed at dispatch time, so clicks on cards that re-render
  // (and detach) still count as inside the panel.
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !e.composedPath().includes(panel)) setPanelOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setPanelOpen(false);
  });

  const search = document.getElementById('lora-search');
  search?.addEventListener('input', () => onSearch(search.value));
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && onPickFirst()) search.value = '';
  });
}
