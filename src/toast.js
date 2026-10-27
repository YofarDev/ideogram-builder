// toast.js — Inline toast notifications replacing alert()

export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return; // no toast host (headless restore paths) — drop silently
  const toast = document.createElement('div');
  toast.className = `toast${type !== 'info' ? ` toast-${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}
