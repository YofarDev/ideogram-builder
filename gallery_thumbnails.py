"""Small, cached gallery previews. Original images are never modified."""
from functools import lru_cache
from io import BytesIO
from pathlib import Path


def gallery_thumbnail(output_dir: Path, name: str) -> bytes:
    if not name or name != Path(name).name or "\\" in name:
        raise ValueError("invalid image name")
    root = output_dir.resolve()
    image_path = (root / name).resolve()
    if image_path.parent != root or image_path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        raise ValueError("invalid image name")
    stat = image_path.stat()
    return _render_thumbnail(str(image_path), stat.st_mtime_ns, stat.st_size)


@lru_cache(maxsize=128)
def _render_thumbnail(path: str, modified_ns: int, size: int) -> bytes:
    # Import on demand: the editor and non-image APIs do not require Pillow.
    from PIL import Image, ImageOps

    with Image.open(path) as original:
        original.draft("RGB", (320, 320))
        image = ImageOps.exif_transpose(original)
        image = ImageOps.fit(image, (320, 320), method=Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        result = BytesIO()
        image.save(result, format="WEBP", quality=80)
        return result.getvalue()
