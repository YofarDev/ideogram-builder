// modal-accounts.js — Modal account picker + monthly usage (server-proxied).
import { emit, on } from './events.js';
import { showToast } from './toast.js';

let accounts = [];
let active = '';
let usageRequest = 0;

function backend() {
  return localStorage.getItem('ideogram_backend') === 'modal' ? 'modal' : 'runpod';
}

function syncVisibility() {
  const wrap = document.getElementById('modal-account-wrap');
  if (wrap) wrap.hidden = backend() !== 'modal' || accounts.length === 0;
}

function renderAccounts() {
  const select = document.getElementById('modal-account');
  if (!select) return;
  select.replaceChildren(...accounts.map(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }));
  if (accounts.includes(active)) select.value = active;
  select.disabled = accounts.length < 2;
  syncVisibility();
}

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

async function loadUsage() {
  const el = document.getElementById('modal-usage');
  if (!el) return;
  const request = ++usageRequest;
  el.textContent = '';
  el.title = '';
  if (backend() !== 'modal' || !active) return;
  try {
    const resp = await fetch(`/api/modal/usage?account=${encodeURIComponent(active)}`);
    const data = await resp.json();
    if (request !== usageRequest || backend() !== 'modal') return;
    if (!resp.ok || data.error) {
      el.textContent = 'usage n/a';
      el.title = data.error || `usage unavailable (${resp.status})`;
      return;
    }
    if (data.remaining != null) {
      el.textContent = `${money(data.remaining)} left`;
      el.title = `${money(data.metered_cost)} used this month · ${money(data.monthly_credits)} included · billed ${money(data.billed_cost)}`;
    } else {
      el.textContent = `${money(data.metered_cost)} used`;
      el.title = `Billed ${money(data.billed_cost)} this month`;
    }
  } catch {
    if (request === usageRequest) el.textContent = 'usage n/a';
  }
}

async function loadConfig() {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) return;
    const cfg = await resp.json();
    const modal = cfg.modal || {};
    accounts = Array.isArray(modal.accounts) ? modal.accounts : [];
    active = modal.active || '';
    renderAccounts();
    loadUsage();
  } catch { /* config unavailable — leave the picker hidden */ }
}

async function switchAccount(name) {
  const select = document.getElementById('modal-account');
  try {
    const resp = await fetch('/api/modal/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `switch failed (${resp.status})`);
    accounts = Array.isArray(data.accounts) ? data.accounts : accounts;
    active = data.active || name;
    renderAccounts();
    emit('config:changed');
    await loadUsage();
    showToast(`Modal account: ${active}`, 'info', 2000);
  } catch (error) {
    if (select) select.value = active;
    showToast(error.message, 'error', 4000);
  }
}

export function initModalAccounts() {
  const select = document.getElementById('modal-account');
  if (!select) return;
  select.addEventListener('change', () => switchAccount(select.value));
  on('backend:changed', () => {
    syncVisibility();
    if (backend() === 'modal') loadUsage();
  });
  syncVisibility();
  loadConfig();
}
