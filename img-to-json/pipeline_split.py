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
