#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-8080}"
# Kill any process already using the port
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 0.3
# Open browser after a short delay so server is ready
(sleep 1 && xdg-open "http://localhost:${PORT}") &
exec python3 server.py
