import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from steps.preprocess import preprocess
from steps.local_vlm_analysis import analyze
from steps.sam_detection import sam_detect
from steps.json_builder import build_json
from utils.palette import extract_palette_from_region

logger = logging.getLogger(__name__)

PAD_SIZE = 1000


def _unpad_bbox(bbox, pad_offsets, orig_size):
    px, py, _, _ = pad_offsets
    ow, oh = orig_size
    scale = min(PAD_SIZE / ow, PAD_SIZE / oh)
    sw = round(ow * scale)
    sh = round(oh * scale)

    y1, x1, y2, x2 = bbox
    x1_n = max(0, min(1000, round(((x1 - px) / sw) * 1000)))
    y1_n = max(0, min(1000, round(((y1 - py) / sh) * 1000)))
    x2_n = max(0, min(1000, round(((x2 - px) / sw) * 1000)))
    y2_n = max(0, min(1000, round(((y2 - py) / sh) * 1000)))
    return [y1_n, x1_n, y2_n, x2_n]


def _bbox_to_pixels(bbox, img_w, img_h):
    y1, x1, y2, x2 = bbox
    return (
        round(x1 / 1000 * img_w),
        round(y1 / 1000 * img_h),
        round(x2 / 1000 * img_w),
        round(y2 / 1000 * img_h),
    )


_COLORS = [
    "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
    "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4",
]


def _draw_bboxes(image, boxes, labels=None):
    """Draw bounding boxes on a copy of *image*. Returns new Image."""
    draw_img = image.copy()
    draw = ImageDraw.Draw(draw_img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
    except (OSError, IOError):
        font = ImageFont.load_default()

    for i, bbox in enumerate(boxes):
        if bbox is None:
            continue
        px1, py1, px2, py2 = _bbox_to_pixels(bbox, *image.size)
        color = _COLORS[i % len(_COLORS)]
        draw.rectangle([px1, py1, px2, py2], outline=color, width=3)
        label = labels[i] if labels and i < len(labels) else str(i)
        text = f"{i}: {label}"
        bbox_text = draw.textbbox((px1, py1), text, font=font)
        draw.rectangle(bbox_text, fill=color)
        draw.text((px1, py1), text, fill="white", font=font)

    return draw_img


def run(
    image_path: str,
    output_path: str | None = None,
    verbose: bool = False,
    no_sam: bool = False,
    low_memory: bool = False,
    debug=None,
    model: str = "Qwen3-VL-4B-Instruct-8bit",
    bbox_format: str = "xyxy",
):
    pre = preprocess(image_path)
    if verbose:
        logger.info("Step 1 — preprocess: palette=%d colors, pad=%s", len(pre.palette), pre.pad_offsets)

    if debug and debug.enabled:
        debug.save_json("01_preprocess/result.json", {
            "palette": pre.palette,
            "pad_offsets": list(pre.pad_offsets),
            "orig_size": list(pre.image_orig.size),
        })
        debug.save_image("01_preprocess/image_padded.png", pre.image_padded)

    analysis = analyze(pre.image_orig, verbose=verbose, debug=debug, model_name=model, bbox_format=bbox_format)
    if verbose:
        obj_count = len(analysis.get("objects", []))
        logger.info("Step 2 — Local VLM: %d objects detected", obj_count)

    if debug and debug.enabled:
        debug.save_json("02_vlm/analysis.json", analysis)
        # Draw VLM bboxes on original image
        vlm_boxes = [obj.get("bbox") for obj in analysis.get("objects", [])]
        vlm_labels = [obj.get("name", "") for obj in analysis.get("objects", [])]
        vlm_annotated = _draw_bboxes(pre.image_orig, vlm_boxes, vlm_labels)
        debug.save_image("02_vlm/vlm_boxes.png", vlm_annotated)

    if not no_sam:
        if low_memory:
            import gc
            from models.local_vlm_loader import get_local_vlm
            gc.collect()
            import mlx.core
            mlx.core.metal.clear_cache()

        # Skip SAM for group elements (flower field, crowd, etc.) — SAM detects
        # individuals within a group, producing bad matches. Heuristics: plural
        # name (ends in 's' but not 'ss') or desc contains group keywords.
        _GROUP_KEYWORDS = [
            "group of", "cluster of", "row of", "pair of", "collection of",
            "stack of", "arrangement of", "several ", "multiple ",
            "a set of", "a bunch of",
        ]
        _sam_indices, _sam_names = [], []
        for i, obj in enumerate(analysis["objects"]):
            name = obj.get("name", "")
            desc = obj.get("desc", "")
            is_plural = name.lower().endswith("s") and not name.lower().endswith("ss")
            desc_has_group = any(kw in desc.lower() for kw in _GROUP_KEYWORDS)
            if is_plural or desc_has_group:
                if verbose:
                    logger.info("Skipping SAM for group element: '%s'", name)
            else:
                _sam_indices.append(i)
                _sam_names.append(name)

        vlm_bboxes = [analysis["objects"][i].get("bbox") for i in _sam_indices]
        detections_full = sam_detect(pre.image_padded, _sam_names, vlm_bboxes=vlm_bboxes, verbose=verbose, debug=debug)

        # Merge SAM results back into full-length array (VLM fallback for groups)
        detections = [{"name": obj["name"], "bbox": obj.get("bbox")} for obj in analysis["objects"]]
        for j, idx in enumerate(_sam_indices):
            if j < len(detections_full):
                detections[idx] = detections_full[j]
        for det in detections:
            if det["bbox"] is not None:
                det["bbox"] = _unpad_bbox(det["bbox"], pre.pad_offsets, pre.image_orig.size)

        # Use Qwen's bbox as fallback when SAM misses
        for i, det in enumerate(detections):
            if det["bbox"] is None and i < len(analysis["objects"]):
                qwen_bbox = analysis["objects"][i].get("bbox")
                if qwen_bbox is not None:
                    det["bbox"] = qwen_bbox
                    if verbose:
                        logger.info("Fallback to Qwen bbox for '%s'", analysis["objects"][i]["name"])

        if verbose:
            det_count = sum(1 for d in detections if d["bbox"] is not None)
            logger.info("Step 3 — SAM: %d/%d objects localized", det_count, len(detections))
    else:
        detections = [{"name": obj["name"], "bbox": obj.get("bbox")} for obj in analysis["objects"]]
        if verbose:
            bbox_count = sum(1 for d in detections if d["bbox"] is not None)
            logger.info("Step 3 — SAM: skipped (%d Qwen bboxes)", bbox_count)

    if debug and debug.enabled:
        debug.save_json("03_sam/detections.json", detections)
        # Draw SAM bboxes on original image
        sam_boxes = [d.get("bbox") for d in detections]
        sam_labels = [d.get("name", "") for d in detections]
        sam_annotated = _draw_bboxes(pre.image_orig, sam_boxes, sam_labels)
        debug.save_image("03_sam/sam_boxes.png", sam_annotated)

    # Per-element color palettes
    ow, oh = pre.image_orig.size
    for i, obj in enumerate(analysis["objects"]):
        det = detections[i] if i < len(detections) else {}
        bbox = det.get("bbox") or obj.get("bbox")
        if bbox is not None:
            px1, py1, px2, py2 = _bbox_to_pixels(bbox, ow, oh)
            if px2 > px1 and py2 > py1:
                try:
                    region = pre.image_orig.crop((px1, py1, px2, py2))
                    region_palette = extract_palette_from_region(region, color_count=5)
                    obj["element_palette"] = region_palette
                    # palette data lives in obj["element_palette"], no per-file debug
                except Exception as e:
                    if verbose:
                        logger.warning("Per-element palette failed for '%s': %s", obj["name"], e)

    caption_json = build_json(pre.palette, analysis, detections, element_palettes={
        obj["name"]: obj.get("element_palette", [])
        for obj in analysis["objects"]
    })

    if debug and debug.enabled:
        debug.save_text("05_final/caption.json", caption_json)

    if output_path:
        Path(output_path).write_text(caption_json, encoding="utf-8")
        if verbose:
            logger.info("Output written to %s", output_path)
    else:
        print(caption_json)
