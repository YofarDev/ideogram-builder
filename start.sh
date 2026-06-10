#!/usr/bin/env bash
set -euo pipefail
open http://localhost:8080
exec python3 server.py
