import json
import logging
import os
import shutil
from pathlib import Path

from PIL import Image

from mlx_vlm import generate
from mlx_vlm.prompt_utils import apply_chat_template

from steps.preprocess import preprocess
from steps.local_vlm_analysis import _parse_json
from steps.sam_detection import sam_detect
from steps.json_builder import build_json
from utils.palette import extract_palette_from_region

from models.local_vlm_loader import get_local_vlm

# ponytail: reuse baseline geometry helpers verbatim (baseline frozen for A/B validity)
from pipeline import _unpad_bbox, _bbox_to_pixels, _draw_bboxes

logger = logging.getLogger(__name__)

_PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
_VLM_MAX_DIM = 512


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


def _override_to_style(override):
    """Map a client style_override ({mode, aesthetics, lighting, medium, photo_art})
    to the `style` dict shape build_json reads ({medium, aesthetics, lighting, photo_or_art})."""
    return {
        "medium": override["medium"],
        "aesthetics": override.get("aesthetics", ""),
        "lighting": override.get("lighting", ""),
        "photo_or_art": override.get("photo_art", ""),
    }


def _assemble_analysis(scene, objects, style=None):
    """Merge scene call + object call into the analysis shape build_json expects.
    If style is None, falls back to the VLM-produced scene["style"]."""
    if style is None:
        style = scene["style"]
    return {
        "high_level_description": scene["high_level_description"],
        "background": scene["background"],
        "style": style,
        "objects": objects,
    }


def _vlm_call(image, system_prompt, user_text, debug, debug_subdir, model_name="Qwen3-VL-4B-Instruct-8bit", max_tokens=4096, max_dim=_VLM_MAX_DIM):
    """One VLM generation with markdown-fence JSON parsing + single retry. Returns parsed dict."""
    w, h = image.size
    scale = max_dim / max(w, h)
    if scale < 1.0:
        image = image.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    model, processor = get_local_vlm(model_name)
    config = model.config
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]
    prompt = apply_chat_template(processor, config, messages, num_images=1)

    retry_text = (
        "Return ONLY a raw JSON object. No text before or after. "
        "Do not wrap in markdown code fences."
    )
    for attempt in range(2):
        result = generate(model, processor, prompt, image=image, max_tokens=max_tokens)
        response = result.text
        if debug and debug.enabled:
            debug.save_text(f"{debug_subdir}_raw_response_attempt_{attempt + 1}.txt", response)
        parsed = _parse_json(response)
        if parsed is not None:
            if debug and debug.enabled:
                debug.save_json(f"{debug_subdir}_parsed.json", parsed)
            return parsed
        user_text = retry_text
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ]
        prompt = apply_chat_template(processor, config, messages, num_images=1)

    raise RuntimeError(f"VLM failed to return valid JSON after 2 attempts.\nRaw output:\n{result.text}")


def run(
    image_path: str,
    output_path: str | None = None,
    verbose: bool = False,
    low_memory: bool = False,
    debug=None,
    style_override=None,
    model: str = "Qwen3-VL-4B-Instruct-8bit",
):
    pre = preprocess(image_path)
    if verbose:
        logger.info("Split step 1 - preprocess: palette=%d colors", len(pre.palette))
    if debug and debug.enabled:
        debug.save_json("01_preprocess_result.json", {
            "palette": pre.palette,
            "pad_offsets": list(pre.pad_offsets),
            "orig_size": list(pre.image_orig.size),
        })
        debug.save_image("01_preprocess_image_padded.png", pre.image_padded)

    scene_prompt_name = "scene_analysis_no_style.txt" if style_override else "scene_analysis.txt"
    scene_prompt = (_PROMPT_DIR / scene_prompt_name).read_text().strip()
    scene = _vlm_call(pre.image_orig, scene_prompt, "Analyze this image and return the JSON.", debug, "02_scene", model)
    if verbose:
        logger.info("Split step 2a - scene call done")
    if style_override and debug and debug.enabled:
        debug.save_json("02_scene_style_override.json", style_override)

    object_prompt = (_PROMPT_DIR / "object_listing.txt").read_text().strip()
    raw_objects = _vlm_call(pre.image_orig, object_prompt, "List the individual objects in this image and return the JSON.", debug, "03_objects", model)
    objects = raw_objects.get("objects", [])
    if verbose:
        logger.info("Split step 2b - object call: %d objects", len(objects))

    if low_memory:
        import gc
        gc.collect()
        import mlx.core
        mlx.core.metal.clear_cache()

    names = [o.get("name", "") for o in objects]
    detections = sam_detect(pre.image_padded, names, vlm_bboxes=None, verbose=verbose, debug=debug)
    for det in detections:
        if det.get("bbox") is not None:
            det["bbox"] = _unpad_bbox(det["bbox"], pre.pad_offsets, pre.image_orig.size)

    kept_objects, kept_detections, dropped = _filter_localized(objects, detections)
    if verbose:
        logger.info("Split step 3 - SAM: %d/%d localized", len(kept_objects), len(objects))

    if debug and debug.enabled:
        debug.save_json("03_sam_detections_all.json", [
            {"name": d.get("name"), "bbox": d.get("bbox")} for d in detections
        ])
        debug.save_json("03_sam_dropped_elements.json", dropped)
        sam_boxes = [d.get("bbox") for d in kept_detections]
        sam_labels = [o.get("name", "") for o in kept_objects]
        debug.save_image("03_sam_boxes.png", _draw_bboxes(pre.image_orig, sam_boxes, sam_labels))
        # ponytail: sam_detection.py (frozen) forces a 03_sam/ subfolder; flatten to match
        sam_subdir = Path(debug.dir_path()) / "03_sam"
        if sam_subdir.is_dir():
            for f in sam_subdir.iterdir():
                if f.is_file() and not f.name.startswith("."):
                    f.rename(sam_subdir.parent / f"03_sam_{f.name}")
            shutil.rmtree(sam_subdir, ignore_errors=True)

    if dropped:
        miss_count = len(dropped)
        import tempfile, subprocess, sys
        img_dir = Path(__file__).resolve().parent
        tmp_objects = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        tmp_objects.write(json.dumps(dropped))
        tmp_objects.close()
        try:
            result = subprocess.run(
                [sys.executable, str(img_dir / "main.py"), "--bbox-only",
                 image_path, "--objects", tmp_objects.name, "--model", model],
                capture_output=True, text=True, timeout=120,
                cwd=str(img_dir),
            )
            if result.returncode == 0:
                fb = json.loads(result.stdout)
                from collections import defaultdict, deque
                vlm_boxes = defaultdict(deque)
                for o in fb.get("objects", []):
                    if o.get("bbox") is not None:
                        vlm_boxes[o["name"]].append(o["bbox"])
                still_dropped = []
                for d in dropped:
                    if vlm_boxes[d["name"]]:
                        kept_objects.append({"name": d["name"], "desc": d.get("desc", ""), "has_text": False})
                        kept_detections.append({"name": d["name"], "bbox": vlm_boxes[d["name"]].popleft()})
                    else:
                        still_dropped.append(d)
                dropped = still_dropped
                if verbose:
                    logger.info("Split step 3b - VLM bbox fallback (subprocess): recovered %d/%d SAM misses",
                                miss_count - len(dropped), miss_count)
            elif verbose:
                logger.warning("VLM bbox fallback subprocess failed: %s", result.stderr.strip()[:200])
        except Exception as e:
            if verbose:
                logger.warning("VLM bbox fallback failed: %s", e)
        finally:
            os.unlink(tmp_objects.name)

    ow, oh = pre.image_orig.size
    element_palettes = {}
    for obj, det in zip(kept_objects, kept_detections):
        bbox = det.get("bbox")
        if bbox is None:
            continue
        px1, py1, px2, py2 = _bbox_to_pixels(bbox, ow, oh)
        if px2 > px1 and py2 > py1:
            try:
                region = pre.image_orig.crop((px1, py1, px2, py2))
                element_palettes[obj["name"]] = extract_palette_from_region(region, color_count=5)
                # ponytail: palette data lives in element_palettes dict, no per-file debug
            except Exception as e:
                if verbose:
                    logger.warning("Per-element palette failed for '%s': %s", obj["name"], e)

    style = _override_to_style(style_override) if style_override else scene["style"]
    analysis = _assemble_analysis(scene, kept_objects, style=style)
    caption_json = build_json(pre.palette, analysis, kept_detections, element_palettes=element_palettes)

    if debug and debug.enabled:
        debug.save_text("05_final_caption.json", caption_json)

    if output_path:
        Path(output_path).write_text(caption_json, encoding="utf-8")
    else:
        print(caption_json)
