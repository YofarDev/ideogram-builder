"""Render an image with a magenta bbox highlight for single-element recaptioning.

The whole image is sent with the target box visually marked so the VLM
doesn't have to map numeric coords to pixels (Approach C).
"""

import math
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


def render_highlight(
    image: Image.Image,
    bbox: list[int],
    max_dim: int = 1024,
    max_file_size: int = 1 * 1024 * 1024,
) -> str:
    """Renders *image* with *bbox* drawn on it, resized so the longest side
    is <= *max_dim* and the JPEG is <= *max_file_size*.

    *bbox* is [y1, x1, y2, x2] in 0-1000 normalized coordinates.

    Returns the absolute path to a temp JPEG. Caller must delete the file.
    """
    if len(bbox) != 4:
        raise ValueError("bbox must have exactly 4 entries [y1,x1,y2,x2]")
    if (bbox[2] - bbox[0]) <= 0 or (bbox[3] - bbox[1]) <= 0:
        raise ValueError("bbox has zero or negative area")

    work = image.convert("RGB")
    longest = max(work.width, work.height)
    if longest > max_dim:
        scale = max_dim / longest
        new_w = round(work.width * scale)
        new_h = round(work.height * scale)
        work = work.resize((new_w, new_h), Image.LANCZOS)

    img_w, img_h = work.size

    # Convert 0-1000 normalized bbox -> pixels
    y1 = max(0, min(img_h - 1, round(bbox[0] / 1000 * img_h)))
    x1 = max(0, min(img_w - 1, round(bbox[1] / 1000 * img_w)))
    y2 = max(y1 + 1, min(img_h, round(bbox[2] / 1000 * img_h)))
    x2 = max(x1 + 1, min(img_w, round(bbox[3] / 1000 * img_w)))

    thickness = max(2, min(8, round(img_w / 200)))

    # Translucent magenta fill, then white outline, then magenta outline
    overlay = Image.new("RGBA", work.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle([x1, y1, x2, y2], fill=(255, 0, 255, 70))
    work = Image.alpha_composite(work.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(work)
    draw.rectangle([x1, y1, x2, y2], outline="white", width=thickness + 2)
    draw.rectangle([x1, y1, x2, y2], outline="magenta", width=thickness)

    # Corner ticks
    _draw_corner_ticks(draw, x1, y1, x2, y2, thickness + 4, img_w, img_h)

    # Encode JPEG, shrinking quality until under the size limit
    quality = 90
    while True:
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        work.save(tmp.name, format="JPEG", quality=quality)
        file_size = Path(tmp.name).stat().st_size
        if file_size <= max_file_size or quality <= 20:
            return tmp.name
        quality -= 10


def _draw_corner_ticks(
    draw: ImageDraw.Draw,
    x1: int, y1: int, x2: int, y2: int,
    length: int, img_w: int, img_h: int,
):
    cl = max(4, min(length, round(img_w * 0.1)))
    color = "magenta"
    # Top-left
    draw.line([x1, y1, min(x1 + cl, img_w - 1), y1], fill=color, width=2)
    draw.line([x1, y1, x1, min(y1 + cl, img_h - 1)], fill=color, width=2)
    # Top-right
    draw.line([x2, y1, max(x2 - cl, 0), y1], fill=color, width=2)
    draw.line([x2, y1, x2, min(y1 + cl, img_h - 1)], fill=color, width=2)
    # Bottom-left
    draw.line([x1, y2, min(x1 + cl, img_w - 1), y2], fill=color, width=2)
    draw.line([x1, y2, x1, max(y2 - cl, 0)], fill=color, width=2)
    # Bottom-right
    draw.line([x2, y2, max(x2 - cl, 0), y2], fill=color, width=2)
    draw.line([x2, y2, x2, max(y2 - cl, 0)], fill=color, width=2)
