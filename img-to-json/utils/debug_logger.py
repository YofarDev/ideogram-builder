"""Lightweight debug logger — saves pipeline artifacts to a timestamped directory.

When `debug_dir` is None all methods are no-ops, so debug mode has zero overhead
when disabled.
"""

import json
import secrets
from datetime import datetime
from pathlib import Path

from PIL import Image


class DebugLogger:
    def __init__(self, debug_dir: Path | None):
        self._dir = debug_dir
        if debug_dir:
            debug_dir.mkdir(parents=True, exist_ok=True)

    @property
    def enabled(self) -> bool:
        return self._dir is not None

    def save_json(self, name: str, data: dict | list) -> None:
        if not self._dir:
            return
        path = self._dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    def save_text(self, name: str, text: str) -> None:
        if not self._dir:
            return
        path = self._dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def save_image(self, name: str, image: Image.Image) -> None:
        if not self._dir:
            return
        path = self._dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, format="PNG")

    def dir_path(self) -> str | None:
        if self._dir is None:
            return None
        return str(self._dir)


def create_debug_dir(base: Path) -> Path:
    """Create ``<base>/debug/YYYYMMDD_HHMMSS_<hex>/`` and return it."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = secrets.token_hex(3)
    d = base / "debug" / f"{stamp}_{suffix}"
    d.mkdir(parents=True, exist_ok=True)
    return d
