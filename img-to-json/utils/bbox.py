import numpy as np


def xyxy_to_ideogram(box_xyxy: list[float]) -> list[int]:
    x1, y1, x2, y2 = box_xyxy
    return [
        max(0, min(1000, round(y1))),
        max(0, min(1000, round(x1))),
        max(0, min(1000, round(y2))),
        max(0, min(1000, round(x2))),
    ]


def mask_to_bbox_ideogram(mask: np.ndarray) -> list[int]:
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    y_min, y_max = np.where(rows)[0][[0, -1]]
    x_min, x_max = np.where(cols)[0][[0, -1]]
    return [int(y_min), int(x_min), int(y_max), int(x_max)]


_BBOX_ORDER = {"xyxy": "x1, y1, x2, y2", "yxyx": "y1, x1, y2, x2"}
_BBOX_DESC = {"xyxy": "x_min, y_min, x_max, y_max", "yxyx": "y_min, x_min, y_max, x_max"}


def to_yxyx(bbox, src_format: str = "xyxy"):
    """Normalize a VLM-produced bbox to Ideogram [y1, x1, y2, x2].

    No-op when src_format == 'yxyx' or bbox is falsy (None/[]).
    """
    if not bbox or src_format == "yxyx":
        return bbox
    x1, y1, x2, y2 = bbox
    return [y1, x1, y2, x2]


def format_prompt(raw: str, bbox_format: str = "xyxy") -> str:
    """Fill {bbox_order} and {bbox_desc} placeholders for the given bbox format."""
    order = _BBOX_ORDER.get(bbox_format, _BBOX_ORDER["xyxy"])
    desc = _BBOX_DESC.get(bbox_format, _BBOX_DESC["xyxy"])
    return raw.replace("{bbox_order}", order).replace("{bbox_desc}", desc)
