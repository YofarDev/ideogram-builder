#!/usr/bin/env bash
set -euo pipefail
# ponytail: cd to script dir so static file serving works from any CWD; resolve symlinks for global aliases
SOURCE="${BASH_SOURCE[0]:-$0}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  SOURCE="$DIR/$SOURCE"
done
cd "$(cd -P "$(dirname "$SOURCE")" && pwd)"
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
