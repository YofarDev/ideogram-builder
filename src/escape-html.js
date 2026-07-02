// escape-html.js — Shared HTML-escaping utility (avoids dupes across modules).

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}
