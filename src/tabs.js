// Shared workspace navigation, including the Assist group and keyboard tabs.
import { emit } from './events.js';

const ASSIST_TABS = ['prompt', 'vision', 'json2caption'];

export function switchTab(tab, { notify = true } = {}) {
  if (!document.getElementById(`tab-${tab}`)) return;
  const group = document.querySelector('[data-tab-group="assist"]');
  if (group && ASSIST_TABS.includes(tab)) {
    group.dataset.tab = tab;
    group.setAttribute('aria-controls', `tab-${tab}`);
  }
  document.querySelectorAll('.tab-btn').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });
  const content = document.querySelector('.main-content');
  for (const name of ['gallery', 'vision', 'prompt', 'json2caption', 'collections']) {
    content?.classList.toggle(`${name}-active`, tab === name);
  }
  if (tab === 'editor') emit('canvas:relayout');
  if (notify) emit('tab:changed', { tab });
}

export function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
    button.addEventListener('keydown', event => {
      const list = button.closest('[role="tablist"]');
      if (!list || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...list.querySelectorAll('.tab-btn')];
      const index = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
  });
  switchTab(document.querySelector('.tab-btn.active')?.dataset.tab || 'editor', { notify: false });
}
