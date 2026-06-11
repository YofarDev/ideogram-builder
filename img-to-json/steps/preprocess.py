from dataclasses import dataclass
from PIL import Image, ImageOps

from utils.palette import extract_palette


@dataclass
class PreprocessResult:
    image_orig: Image.Image
    image_padded: Image.Image
    palette: list[str]
    pad_offsets: tuple[int, int, int, int]


def preprocess(image_path: str, canvas_size: int = 1000) -> PreprocessResult:
    image_orig = Image.open(image_path).convert("RGB")

    target = (canvas_size, canvas_size)
    image_padded = ImageOps.pad(image_orig, target, method=Image.LANCZOS, color=0)

    ow, oh = image_orig.size
    scale = min(canvas_size / ow, canvas_size / oh)
    scaled_w = round(ow * scale)
    scaled_h = round(oh * scale)
    pad_x = (canvas_size - scaled_w) // 2
    pad_y = (canvas_size - scaled_h) // 2
    pad_offsets = (pad_x, pad_y, canvas_size - scaled_w - pad_x, canvas_size - scaled_h - pad_y)

    palette = extract_palette(image_path)

    return PreprocessResult(
        image_orig=image_orig,
        image_padded=image_padded,
        palette=palette,
        pad_offsets=pad_offsets,
    )
