import json

_STYLE_PHOTO_KEYS = ["aesthetics", "lighting", "photo", "medium", "color_palette"]
_STYLE_ART_KEYS = ["aesthetics", "lighting", "medium", "art_style", "color_palette"]
_COMPOSITION_KEYS = ["background", "elements"]
_ELEMENT_OBJ_KEYS = ["type", "bbox", "desc", "color_palette"]
_ELEMENT_TEXT_KEYS = ["type", "bbox", "text", "desc", "color_palette"]


def verify(caption_str: str) -> list[str]:
    warnings: list[str] = []
    try:
        caption = json.loads(caption_str)
    except json.JSONDecodeError as e:
        return [f"Invalid JSON: {e}"]

    _check_keys(caption, ["high_level_description", "style_description", "compositional_deconstruction"],
                "top-level", warnings)

    sd = caption.get("style_description", {})
    has_photo = "photo" in sd
    has_art = "art_style" in sd
    if has_photo and has_art:
        warnings.append("style_description has both 'photo' and 'art_style' — only one allowed")
    elif not has_photo and not has_art:
        warnings.append("style_description missing both 'photo' and 'art_style'")

    if has_photo:
        _check_keys(sd, _STYLE_PHOTO_KEYS, "style_description (photo)", warnings)
    elif has_art:
        _check_keys(sd, _STYLE_ART_KEYS, "style_description (art)", warnings)
    else:
        for field in ("aesthetics", "lighting", "medium"):
            if field not in sd:
                warnings.append(f"style_description missing: {field}")

    cp = sd.get("color_palette", [])
    _check_palette(cp, "style_description.color_palette", 16, warnings)
    _check_hex_case(cp, "style_description.color_palette", warnings)

    cd = caption.get("compositional_deconstruction", {})
    _check_keys(cd, _COMPOSITION_KEYS, "compositional_deconstruction", warnings)

    elements = cd.get("elements", [])
    for i, el in enumerate(elements):
        el_type = el.get("type", "")
        if el_type == "obj":
            _check_keys(el, _ELEMENT_OBJ_KEYS, f"element[{i}] (obj)", warnings, optional={"bbox", "color_palette"})
        elif el_type == "text":
            _check_keys(el, _ELEMENT_TEXT_KEYS, f"element[{i}] (text)", warnings, optional={"bbox", "color_palette"})
        else:
            warnings.append(f"element[{i}] unknown type: {el_type}")
            _check_keys(el, ["type", "desc"], f"element[{i}]", warnings)

        _check_bbox(el.get("bbox"), i, warnings)

        elem_cp = el.get("color_palette", [])
        _check_palette(elem_cp, f"element[{i}].color_palette", 5, warnings)
        _check_hex_case(elem_cp, f"element[{i}].color_palette", warnings)

    return warnings


def canonicalize(caption_str: str) -> str:
    caption = json.loads(caption_str)
    sd = caption.get("style_description", {})

    _canon_style(sd)
    cd = caption.get("compositional_deconstruction", {})
    for el in cd.get("elements", []):
        _canon_bbox(el)
        _canon_palette(el, "color_palette")
    _canon_palette(sd, "color_palette")

    return json.dumps(caption, separators=(",", ":"), ensure_ascii=False)


def _check_keys(obj: dict, expected: list[str], label: str, warnings: list[str],
                optional: set[str] | None = None) -> None:
    if optional is None:
        optional = set()
    keys = list(obj.keys())
    for k in expected:
        if k not in obj and k not in optional:
            warnings.append(f"{label} missing: {k}")
    present = [k for k in expected if k in obj]
    ordered = [k for k in keys if k in present]
    if ordered != present:
        warnings.append(f"{label} key order: got {ordered}, expected {present}")


def _check_bbox(bbox, idx: int, warnings: list[str]) -> None:
    if bbox is None:
        return
    if not isinstance(bbox, list) or len(bbox) != 4:
        warnings.append(f"element[{idx}] bbox not a 4-element list")
        return
    if not all(isinstance(v, int) for v in bbox):
        warnings.append(f"element[{idx}] bbox values must be ints")
        return
    y1, x1, y2, x2 = bbox
    for name, val in [("y_min", y1), ("x_min", x1), ("y_max", y2), ("x_max", x2)]:
        if not (0 <= val <= 1000):
            warnings.append(f"element[{idx}] bbox.{name}={val} out of range [0,1000]")
    if y1 >= y2:
        warnings.append(f"element[{idx}] bbox y_min ({y1}) >= y_max ({y2})")
    if x1 >= x2:
        warnings.append(f"element[{idx}] bbox x_min ({x1}) >= x_max ({x2})")


def _check_palette(palette: list, label: str, limit: int, warnings: list[str]) -> None:
    if len(palette) > limit:
        warnings.append(f"{label}: {len(palette)} colors exceeds limit of {limit}")
    for c in palette:
        if not (isinstance(c, str) and len(c) == 7 and c[0] == "#"):
            warnings.append(f"{label}: invalid hex color '{c}'")


def _check_hex_case(palette: list, label: str, warnings: list[str]) -> None:
    for c in palette:
        if isinstance(c, str) and c != c.upper():
            warnings.append(f"{label}: hex '{c}' should be uppercase")


def _canon_style(sd: dict) -> None:
    cp = sd.get("color_palette", [])
    sd["color_palette"] = [c.upper() if isinstance(c, str) else c for c in cp]


def _canon_bbox(el: dict) -> None:
    bbox = el.get("bbox")
    if bbox is None or not isinstance(bbox, list) or len(bbox) != 4:
        return
    y1, x1, y2, x2 = bbox
    el["bbox"] = [
        max(0, min(1000, int(y1))),
        max(0, min(1000, int(x1))),
        max(0, min(1000, int(y2))),
        max(0, min(1000, int(x2))),
    ]


def _canon_palette(obj: dict, key: str) -> None:
    cp = obj.get(key, [])
    if cp:
        obj[key] = [c.upper() if isinstance(c, str) else c for c in cp]
