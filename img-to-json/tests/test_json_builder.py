import json

from steps.json_builder import build_json

_SAMPLE_ANALYSIS = {
    "high_level_description": "A cat sitting on a mat.",
    "style": {
        "medium": "photograph",
        "aesthetics": "warm, cozy, intimate",
        "lighting": "soft natural light from a window",
        "photo_or_art": "iPhone 15, f/1.8, shallow depth of field",
    },
    "background": "A wooden floor with a woven rug.",
    "objects": [
        {
            "name": "orange cat",
            "desc": "A fluffy orange tabby cat with green eyes",
            "has_text": False,
            "visible_text": None,
        },
        {
            "name": "food bowl",
            "desc": "A ceramic food bowl with 'CAT' printed on it",
            "has_text": True,
            "visible_text": "CAT",
        },
    ],
}

_SAMPLE_PALETTE = ["#FF6600", "#CC4400"]


def test_key_order():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(_SAMPLE_PALETTE, _SAMPLE_ANALYSIS, detections)
    parsed = json.loads(result)

    keys = list(parsed.keys())
    assert keys == ["high_level_description", "style_description", "compositional_deconstruction"]


def test_photo_not_art_style():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(_SAMPLE_PALETTE, _SAMPLE_ANALYSIS, detections)
    parsed = json.loads(result)
    sd = parsed["style_description"]
    assert "photo" in sd
    assert "art_style" not in sd
    assert sd["photo"] == "iPhone 15, f/1.8, shallow depth of field"


def test_art_style_not_photo():
    analysis = {**_SAMPLE_ANALYSIS}
    analysis["style"] = {**_SAMPLE_ANALYSIS["style"], "medium": "painting", "photo_or_art": "oil on canvas, impressionist style"}
    result = build_json(_SAMPLE_PALETTE, analysis, [])
    parsed = json.loads(result)
    sd = parsed["style_description"]
    assert "art_style" in sd
    assert "photo" not in sd
    assert sd["art_style"] == "oil on canvas, impressionist style"


def test_text_vs_obj_element():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(_SAMPLE_PALETTE, _SAMPLE_ANALYSIS, detections)
    parsed = json.loads(result)
    elements = parsed["compositional_deconstruction"]["elements"]

    assert elements[0]["type"] == "obj"
    assert "desc" in elements[0]
    assert "text" not in elements[0]

    assert elements[1]["type"] == "text"
    assert "text" in elements[1]
    assert elements[1]["text"] == "CAT"
    assert "desc" in elements[1]


def test_bbox_omitted_when_none():
    detections = [
        {"name": "orange cat", "bbox": None},
        {"name": "food bowl", "bbox": None},
    ]
    result = build_json(_SAMPLE_PALETTE, _SAMPLE_ANALYSIS, detections)
    parsed = json.loads(result)
    elements = parsed["compositional_deconstruction"]["elements"]

    assert "bbox" not in elements[0]
    assert "bbox" not in elements[1]


def test_style_key_order_photo():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(_SAMPLE_PALETTE, _SAMPLE_ANALYSIS, detections)
    parsed = json.loads(result)
    sd = parsed["style_description"]
    keys = list(sd.keys())
    assert keys == ["aesthetics", "lighting", "photo", "medium", "color_palette"], f"got {keys}"


def test_style_key_order_art():
    analysis = {**_SAMPLE_ANALYSIS}
    analysis["style"] = {**_SAMPLE_ANALYSIS["style"], "medium": "painting", "photo_or_art": "oil on canvas"}
    result = build_json(_SAMPLE_PALETTE, analysis, [])
    parsed = json.loads(result)
    sd = parsed["style_description"]
    keys = list(sd.keys())
    assert keys == ["aesthetics", "lighting", "medium", "art_style", "color_palette"], f"got {keys}"


def test_duplicate_object_names():
    """Elements with the same name should get their own bbox via index matching."""
    analysis = {
        "high_level_description": "Two cats.",
        "style": {
            "medium": "photograph",
            "aesthetics": "cute",
            "lighting": "bright",
            "photo_or_art": "50mm f/2.8",
        },
        "background": "A sofa.",
        "objects": [
            {"name": "cat", "desc": "An orange tabby cat.", "has_text": False, "visible_text": None},
            {"name": "cat", "desc": "A black cat.", "has_text": False, "visible_text": None},
        ],
    }
    detections = [
        {"name": "cat", "bbox": [100, 200, 400, 500]},
        {"name": "cat", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(["#FF6600"], analysis, detections)
    parsed = json.loads(result)
    elements = parsed["compositional_deconstruction"]["elements"]
    assert len(elements) == 2
    assert elements[0]["desc"] == "An orange tabby cat."
    assert elements[1]["desc"] == "A black cat."
    assert elements[0]["bbox"] == [100, 200, 400, 500]
    assert elements[1]["bbox"] == [500, 600, 700, 800]


def test_text_null_fallback():
    """visible_text=null should serialize as empty string, not null."""
    analysis = {**_SAMPLE_ANALYSIS}
    analysis["objects"] = [
        {"name": "sign", "desc": "A sign.", "has_text": True, "visible_text": None},
    ]
    result = build_json(["#FF6600"], analysis, [])
    parsed = json.loads(result)
    el = parsed["compositional_deconstruction"]["elements"][0]
    assert el["text"] == ""


def test_json_serialization_minimal():
    detections = [
        {"name": "orange cat", "bbox": [100, 200, 400, 500]},
        {"name": "food bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(_SAMPLE_PALETTE, _SAMPLE_ANALYSIS, detections)
    assert ": " not in result
    assert ', "' not in result
