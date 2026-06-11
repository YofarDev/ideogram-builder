#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-8080}"

# Kill any process already using the port (macOS/Linux compatible)
if lsof -ti "tcp:${PORT}" &>/dev/null; then
  kill $(lsof -ti "tcp:${PORT}") 2>/dev/null || true
  sleep 0.3
fi

# Open browser after a short delay so server is ready
if [[ "$(uname)" == "Darwin" ]]; then
  (sleep 1 && open "http://localhost:${PORT}") &
else
  (sleep 1 && xdg-open "http://localhost:${PORT}") &
fi

exec python3 server.py
