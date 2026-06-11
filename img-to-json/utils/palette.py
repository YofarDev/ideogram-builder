from colorthief import ColorThief


from PIL import Image


def extract_palette(image_path: str, color_count: int = 6) -> list[str]:
    ct = ColorThief(image_path)
    palette = ct.get_palette(color_count=color_count, quality=1)
    return [f"#{r:02X}{g:02X}{b:02X}" for r, g, b in palette]


def extract_palette_from_region(image: Image.Image, color_count: int = 5) -> list[str]:
    from colorthief import ColorThief
    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    try:
        image.save(tmp.name, format="PNG")
        ct = ColorThief(tmp.name)
        palette = ct.get_palette(color_count=color_count, quality=1)
        return [f"#{r:02X}{g:02X}{b:02X}" for r, g, b in palette]
    finally:
        import os
        tmp.close()
        os.unlink(tmp.name)
