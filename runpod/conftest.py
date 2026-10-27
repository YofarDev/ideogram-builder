"""Shared test setup for runpod tests (CPU-only).

Stubs the `runpod` package so handler.py imports on a dev machine, and puts
the runpod directory on sys.path so the moss helper modules import the same
way they do inside the MOSS image (files at /).
"""

import sys
import types
from pathlib import Path

RUNPOD_DIR = Path(__file__).resolve().parent
if str(RUNPOD_DIR) not in sys.path:
    sys.path.insert(0, str(RUNPOD_DIR))

_runpod = types.ModuleType("runpod")
_runpod.serverless = types.ModuleType("runpod.serverless")
_runpod.serverless.start = lambda cfg: None
_utils = types.ModuleType("runpod.serverless.utils")
_rp_upload = types.ModuleType("runpod.serverless.utils.rp_upload")
_rp_upload.upload_image = lambda *a, **k: ""
_utils.rp_upload = _rp_upload
_runpod.serverless.utils = _utils
sys.modules.setdefault("runpod", _runpod)
sys.modules.setdefault("runpod.serverless", _runpod.serverless)
sys.modules.setdefault("runpod.serverless.utils", _utils)
sys.modules.setdefault("runpod.serverless.utils.rp_upload", _rp_upload)
