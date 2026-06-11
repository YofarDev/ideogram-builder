import logging
from collections import Counter

from PIL import Image

from models.sam_loader import get_sam_predictor
from utils.bbox import xyxy_to_ideogram

logger = logging.getLogger(__name__)


def _center(bbox):
    """Return center (x, y) from ideogram-format [y1, x1, y2, x2] bbox."""
    if bbox is None:
        return None
    y1, x1, y2, x2 = bbox
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def _distance(a, b):
    if a is None or b is None:
        return float("inf")
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def sam_detect(
    image: Image.Image,
    object_names: list[str],
    vlm_bboxes: list | None = None,
    verbose: bool = False,
    debug=None,
) -> list[dict]:
    predictor = get_sam_predictor()
    n = len(object_names)
    results: list[dict | None] = [None] * n

    if debug and debug.enabled:
        debug.save_image("03_sam/input_image_padded.png", image)

    # Group indices by name to deduplicate SAM calls
    name_counts = Counter(object_names)
    seen: dict[str, int] = {}

    for i, name in enumerate(object_names):
        is_first = name not in seen
        seen[name] = seen.get(name, 0) + 1

        if is_first:
            # First occurrence — call SAM and collect top-N detections
            try:
                result = predictor.predict(image, text_prompt=name)
            except Exception as e:
                logger.warning("SAM detection failed for '%s': %s", name, e)
                continue

            if result.scores is None or len(result.scores) == 0:
                logger.warning("SAM found no detection for '%s'", name)
                continue

            # Take top N detections for this name
            count = name_counts[name]
            if len(result.scores) <= count:
                top_indices = list(range(len(result.scores)))
            else:
                top_indices = sorted(
                    range(len(result.scores)),
                    key=lambda k: float(result.scores[k]),
                    reverse=True,
                )[:count]

            sam_boxes = []
            for idx in top_indices:
                score = result.scores[idx].item() if hasattr(result.scores[idx], "item") else result.scores[idx]
                bbox = xyxy_to_ideogram(result.boxes[idx].tolist())
                sam_boxes.append({"bbox": bbox, "score": float(score), "box_xyxy": result.boxes[idx].tolist()})

                if verbose:
                    logger.info(
                        "SAM '%s' (#%d): score=%.3f, box_xyxy=%s",
                        name, idx, score, result.boxes[idx].tolist(),
                    )

            if debug and debug.enabled:
                safe_name = name.replace(" ", "_").replace("/", "_")
                debug.save_json(f"03_sam/detection_{safe_name}.json", {
                    "name": name,
                    "count_requested": count,
                    "detections": sam_boxes,
                })

            # Assign SAM detections to VLM objects by bbox proximity
            # Collect indices for this name that don't have results yet
            name_indices = [j for j, n_ in enumerate(object_names) if n_ == name]

            if len(sam_boxes) == 1 and len(name_indices) > 1:
                # Only one SAM box for multiple VLM objects — assign to closest, rest get None
                vlm_centers = [_center(vlm_bboxes[j] if vlm_bboxes else None) for j in name_indices]
                sam_center = _center(sam_boxes[0]["bbox"])
                best = min(range(len(vlm_centers)), key=lambda k: _distance(vlm_centers[k], sam_center))
                results[name_indices[best]] = {"name": name, "bbox": sam_boxes[0]["bbox"]}
            else:
                # Match each SAM box to closest VLM object (greedy, by ascending distance)
                pairs = []
                for si, sb in enumerate(sam_boxes):
                    sam_c = _center(sb["bbox"])
                    for vi, ni in enumerate(name_indices):
                        vlm_c = _center(vlm_bboxes[ni] if vlm_bboxes else None)
                        pairs.append((_distance(vlm_c, sam_c), si, vi, ni))
                pairs.sort()

                used_sam = set()
                used_vlm = set()
                for _, si, vi, ni in pairs:
                    if si in used_sam or vi in used_vlm:
                        continue
                    results[ni] = {"name": name, "bbox": sam_boxes[si]["bbox"]}
                    used_sam.add(si)
                    used_vlm.add(vi)
        # Non-first occurrences with same name are already handled above

    # Fill unmatched slots with None bbox
    for i in range(n):
        if results[i] is None:
            results[i] = {"name": object_names[i], "bbox": None}

    return results
