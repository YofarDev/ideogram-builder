// client-log.js — mirror client-side errors to the server terminal via
// POST /api/log. The UI snackbar auto-hides after a few seconds; the terminal
// keeps the full message and context. Fire-and-forget: logging must never
// break the caller.

export function logError(message, context = {}) {
  console.error(message, context);
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 'error', message: String(message), context }),
  }).catch(() => {});
}
