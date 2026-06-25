import json
import logging
from pathlib import Path

from PIL import Image

from steps.preprocess import preprocess
from steps.local_vlm_analysis import _parse_json
from steps.sam_detection import sam_detect
from steps.json_builder import build_json
from utils.palette import extract_palette_from_region

# ponytail: reuse baseline geometry helpers verbatim (baseline frozen for A/B validity)
from pipeline import _unpad_bbox, _bbox_to_pixels, _draw_bboxes

logger = logging.getLogger(__name__)

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def _filter_localized(objects, detections):
    """Drop objects SAM failed to localize.

    Returns (kept_objects, kept_detections, dropped_ledger). Each ledger entry
    is {name, desc, reason} for one dropped object.
    """
    kept_objects, kept_dets, dropped = [], [], []
    for obj, det in zip(objects, detections):
        bbox = det.get("bbox") if det else None
        if bbox is not None:
            kept_objects.append(obj)
            kept_dets.append(det)
        else:
            dropped.append({
                "name": obj.get("name", ""),
                "desc": obj.get("desc", ""),
                "reason": "sam_no_detection",
            })
    return kept_objects, kept_dets, dropped


def _assemble_analysis(scene, objects):
    """Merge scene call + object call into the analysis shape build_json expects."""
    return {
        "high_level_description": scene["high_level_description"],
        "background": scene["background"],
        "style": scene["style"],
        "objects": objects,
    }
