"""Dedup new detection elements against already-found ones by bbox IoU.

Final caption elements carry no `name` (only `desc` + `bbox`), so dedup is
geometry-only: a new box that heavily overlaps an existing box is treated as
the same subject and dropped. Cross-name overlaps (a person holding a dog) are
kept because IoU between distinct overlapping subjects stays below threshold.
"""

from __future__ import annotations


def _iou(a, b) -> float:
    """IoU for ideogram bboxes [y1, x1, y2, x2], normalized or pixel — unit-agnostic."""
    ay1, ax1, ay2, ax2 = a
    by1, bx1, by2, bx2 = b
    iy1, ix1 = max(ay1, by1), max(ax1, bx1)
    iy2, ix2 = min(ay2, by2), min(ax2, bx2)
    iw, ih = ix2 - ix1, iy2 - iy1
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    area_a = max(0.0, ay2 - ay1) * max(0.0, ax2 - ax1)
    area_b = max(0.0, by2 - by1) * max(0.0, bx2 - bx1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def dedup_new(new_elements: list[dict], existing_elements: list[dict], iou_threshold: float = 0.5) -> list[dict]:
    """Return new_elements with any box heavily overlapping an existing box removed."""
    existing_boxes = [e["bbox"] for e in existing_elements if e.get("bbox")]
    kept: list[dict] = []
    for el in new_elements:
        box = el.get("bbox")
        if box is None:
            kept.append(el)
            continue
        if any(_iou(box, eb) > iou_threshold for eb in existing_boxes):
            continue
        kept.append(el)
    return kept


if __name__ == "__main__":
    # ponytail: self-check — no test framework, just an assert-based demo.
    existing = [{"desc": "a", "bbox": [0.0, 0.0, 0.5, 0.5]}]
    dup = {"desc": "b", "bbox": [0.0, 0.0, 0.48, 0.48]}      # near-identical → drop
    far = {"desc": "c", "bbox": [0.6, 0.6, 0.9, 0.9]}         # disjoint → keep
    no_box = {"desc": "d"}                                      # no bbox → keep
    out = dedup_new([dup, far, no_box], existing)
    assert [e["desc"] for e in out] == ["c", "d"], out
    assert abs(_iou([0, 0, 1, 1], [0, 0, 1, 1]) - 1.0) < 1e-9
    assert _iou([0, 0, 0.5, 0.5], [0.5, 0.5, 1, 1]) == 0.0
    print("dedup self-check ok")
