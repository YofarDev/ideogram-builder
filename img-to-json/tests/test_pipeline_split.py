import json

from pipeline_split import _filter_localized, _assemble_analysis, _override_to_style
from steps.json_builder import build_json

_SCENE = {
    "high_level_description": "A cat on a mat.",
    "background": "Wooden floor with a woven rug.",
    "style": {
        "medium": "photograph",
        "aesthetics": "warm, cozy",
        "lighting": "soft window light",
        "photo_or_art": "50mm f/2.8",
    },
}

_OBJECTS = [
    {"name": "orange cat", "desc": "A fluffy orange tabby.", "has_text": False, "visible_text": None},
    {"name": "food bowl", "desc": "A ceramic bowl.", "has_text": True, "visible_text": "CAT"},
    {"name": "toy mouse", "desc": "A felt mouse toy.", "has_text": False, "visible_text": None},
]


def test_filter_keeps_localized():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
        {"name": "toy mouse", "bbox": None},
    ]
    kept_objs, kept_dets, dropped = _filter_localized(_OBJECTS, detections)
    assert len(kept_objs) == 2
    assert len(kept_dets) == 2
    assert kept_objs[0]["name"] == "orange cat"
    assert kept_dets[1]["bbox"] == [500, 600, 700, 800]


def test_filter_drops_misses_with_ledger():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": None},
        {"name": "toy mouse", "bbox": None},
    ]
    _, _, dropped = _filter_localized(_OBJECTS, detections)
    assert len(dropped) == 2
    assert dropped[0] == {"name": "food bowl", "desc": "A ceramic bowl.", "reason": "sam_no_detection"}
    assert dropped[1]["name"] == "toy mouse"


def test_filter_handles_shorter_detections():
    detections = [{"name": "orange cat", "bbox": [100, 200, 400, 500]}]
    kept_objs, kept_dets, dropped = _filter_localized(_OBJECTS, detections)
    assert len(kept_objs) == 1
    assert len(dropped) == 0


def test_assemble_merges_scene_and_objects():
    analysis = _assemble_analysis(_SCENE, _OBJECTS)
    assert analysis["high_level_description"] == "A cat on a mat."
    assert analysis["background"] == "Wooden floor with a woven rug."
    assert analysis["style"]["medium"] == "photograph"
    assert len(analysis["objects"]) == 3
    assert "bbox" not in analysis["objects"][0]


def test_assemble_feeds_build_json():
    analysis = _assemble_analysis(_SCENE, _OBJECTS[:2])
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(["#FF6600"], analysis, detections)
    parsed = json.loads(result)
    assert parsed["high_level_description"] == "A cat on a mat."
    assert "photo" in parsed["style_description"]
    elements = parsed["compositional_deconstruction"]["elements"]
    assert elements[1]["type"] == "text"
    assert elements[1]["text"] == "CAT"


def test_assemble_uses_explicit_style():
    override_style = {
        "medium": "digital_illustration",
        "aesthetics": "vibrant",
        "lighting": "dramatic rim",
        "photo_or_art": "fantasy art",
    }
    analysis = _assemble_analysis(_SCENE, _OBJECTS, style=override_style)
    assert analysis["style"]["medium"] == "digital_illustration"
    assert analysis["style"]["photo_or_art"] == "fantasy art"
    assert analysis["high_level_description"] == "A cat on a mat."


def test_override_to_style_maps_fields():
    override = {
        "mode": "art_style",
        "aesthetics": "vibrant",
        "lighting": "dramatic rim",
        "medium": "digital_illustration",
        "photo_art": "fantasy art",
    }
    style = _override_to_style(override)
    assert style == {
        "medium": "digital_illustration",
        "aesthetics": "vibrant",
        "lighting": "dramatic rim",
        "photo_or_art": "fantasy art",
    }
