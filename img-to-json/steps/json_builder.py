import json
import logging
import sys

from utils.caption_verifier import verify

logger = logging.getLogger(__name__)


def build_json(
    palette: list[str],
    analysis: dict,
    detections: list[dict],
    element_palettes: dict[str, list[str]] | None = None,
) -> str:
    style = analysis["style"]
    photo_or_art_value = style.get("photo_or_art", "")
    is_photo = style.get("medium") == "photograph"

    if is_photo:
        style_description: dict = {
            "aesthetics": style["aesthetics"],
            "lighting": style["lighting"],
            "photo": photo_or_art_value,
            "medium": style["medium"],
            "color_palette": palette,
        }
    else:
        style_description: dict = {
            "aesthetics": style["aesthetics"],
            "lighting": style["lighting"],
            "medium": style["medium"],
            "art_style": photo_or_art_value,
            "color_palette": palette,
        }

    if element_palettes is None:
        element_palettes = {}

    elements: list[dict] = []

    for i, obj in enumerate(analysis["objects"]):
        det = detections[i] if i < len(detections) else {}
        bbox = det.get("bbox") or obj.get("bbox")
        name = obj["name"]

        if obj.get("has_text"):
            el: dict = {"type": "text"}
            if bbox is not None:
                el["bbox"] = bbox
            el["text"] = obj.get("visible_text") or ""
            el["desc"] = obj["desc"]
        else:
            el = {"type": "obj"}
            if bbox is not None:
                el["bbox"] = bbox
            el["desc"] = obj["desc"]

        elem_pal = element_palettes.get(name, [])
        if elem_pal:
            el["color_palette"] = elem_pal

        elements.append(el)

    caption = {
        "high_level_description": analysis["high_level_description"],
        "style_description": style_description,
        "compositional_deconstruction": {
            "background": analysis["background"],
            "elements": elements,
        },
    }

    json_str = json.dumps(caption, separators=(",", ":"), ensure_ascii=False)

    warnings = verify(json_str)
    for w in warnings:
        print(f"[verifier] {w}", file=sys.stderr)

    return json_str
