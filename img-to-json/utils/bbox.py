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
