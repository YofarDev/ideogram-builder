import json

from utils.caption_verifier import verify, canonicalize


def _make_caption(overrides=None):
    cap = {
        "high_level_description": "A test scene.",
        "style_description": {
            "aesthetics": "warm, cozy",
            "lighting": "soft daylight",
            "photo": "35mm f/1.8",
            "medium": "photograph",
            "color_palette": ["#FF6600", "#CC4400"],
        },
        "compositional_deconstruction": {
            "background": "A room.",
            "elements": [
                {"type": "obj", "bbox": [100, 200, 400, 500], "desc": "A fluffy cat."},
            ],
        },
    }
    if overrides:
        _deep_merge(cap, overrides)
    return json.dumps(cap, separators=(",", ":"), ensure_ascii=False)


def _deep_merge(base, overrides):
    for k, v in overrides.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def test_valid_caption_no_warnings():
    warnings = verify(_make_caption())
    assert warnings == []


def test_missing_top_level():
    cap = _make_caption({"compositional_deconstruction": None})
    parsed = json.loads(cap)
    del parsed["compositional_deconstruction"]
    raw = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("compositional_deconstruction" in w for w in warnings)


def test_missing_style_type():
    cap = json.loads(_make_caption())
    sd = cap["style_description"]
    del sd["photo"]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("photo" in w and "art_style" in w for w in warnings)


def test_photo_key_order():
    cap = json.loads(_make_caption())
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    order_warnings = [w for w in warnings if "key order" in w]
    assert not order_warnings, f"key order warnings: {order_warnings}"


def test_art_style_key_order():
    cap = json.loads(_make_caption({
        "style_description": {
            "aesthetics": "vibrant",
            "lighting": "dramatic",
            "medium": "painting",
            "art_style": "oil on canvas",
            "color_palette": ["#112233"],
        }
    }))
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    order_warnings = [w for w in warnings if "key order" in w]
    assert not order_warnings, f"key order warnings: {order_warnings}"


def test_wrong_key_order_triggers_warning():
    cap = json.loads(_make_caption())
    # Put photo after medium
    sd = cap["style_description"]
    sd["aesthetics"] = sd.pop("aesthetics")
    sd["medium"] = sd.pop("medium")
    sd["photo"] = sd.pop("photo")
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("key order" in w for w in warnings)


def test_bbox_out_of_range():
    cap = json.loads(_make_caption())
    cap["compositional_deconstruction"]["elements"][0]["bbox"] = [-10, 0, 500, 1100]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("out of range" in w for w in warnings)


def test_bbox_y_min_gte_y_max():
    cap = json.loads(_make_caption())
    cap["compositional_deconstruction"]["elements"][0]["bbox"] = [500, 0, 100, 400]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("y_min" in w and "y_max" in w for w in warnings)


def test_hex_case_warning():
    cap = json.loads(_make_caption())
    cap["style_description"]["color_palette"] = ["#ff6600", "#cc4400"]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("uppercase" in w for w in warnings)


def test_palette_too_many_colors():
    cap = json.loads(_make_caption())
    cap["style_description"]["color_palette"] = [f"#{i:02X}{i:02X}{i:02X}" for i in range(20)]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("exceeds limit" in w for w in warnings)


def test_element_palette_too_many():
    cap = json.loads(_make_caption())
    cap["compositional_deconstruction"]["elements"][0]["color_palette"] = [f"#{i:02X}{i:02X}{i:02X}" for i in range(10)]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("exceeds limit" in w for w in warnings)


def test_canonicalize_uppercases_hex():
    cap = json.loads(_make_caption())
    cap["style_description"]["color_palette"] = ["#ff6600"]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    result = canonicalize(raw)
    parsed = json.loads(result)
    assert parsed["style_description"]["color_palette"] == ["#FF6600"]


def test_canonicalize_clamps_bbox():
    cap = json.loads(_make_caption())
    cap["compositional_deconstruction"]["elements"][0]["bbox"] = [-50, 0, 500, 1100]
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    result = canonicalize(raw)
    parsed = json.loads(result)
    bbox = parsed["compositional_deconstruction"]["elements"][0]["bbox"]
    assert bbox == [0, 0, 500, 1000]


def test_canonicalize_compact_separators():
    cap = json.loads(_make_caption())
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    result = canonicalize(raw)
    # Compact format has no space after : or , as separators between JSON tokens
    # (string values like "warm, cozy" are fine since the comma is inside quotes)
    # Check that simple key-value patterns have no spaces
    assert '","' in result  # comma between quoted tokens
    assert '":"' in result  # colon between key and value


def test_element_unknown_type():
    cap = json.loads(_make_caption())
    cap["compositional_deconstruction"]["elements"][0]["type"] = "widget"
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("unknown type" in w for w in warnings)


def test_both_photo_and_art_style():
    cap = json.loads(_make_caption())
    cap["style_description"]["art_style"] = "oil painting"
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    warnings = verify(raw)
    assert any("both" in w and "photo" in w for w in warnings)


def test_empty_string_passthrough():
    """Canonicalize should not strip high_level_description if empty."""
    cap = json.loads(_make_caption())
    cap["high_level_description"] = ""
    raw = json.dumps(cap, separators=(",", ":"), ensure_ascii=False)
    result = canonicalize(raw)
    parsed = json.loads(result)
    assert parsed["high_level_description"] == ""


def test_json_builder_integration():
    """Verify that build_json output passes verify() with no warnings."""
    from steps.json_builder import build_json

    analysis = {
        "high_level_description": "A cat on a mat.",
        "style": {
            "medium": "photograph",
            "aesthetics": "warm, cozy",
            "lighting": "soft window light",
            "photo_or_art": "iPhone 15 f/1.8",
        },
        "background": "A wooden floor with a rug.",
        "objects": [
            {"name": "cat", "desc": "A fluffy orange tabby cat with green eyes.", "has_text": False, "visible_text": None},
            {"name": "bowl", "desc": "A ceramic bowl with text.", "has_text": True, "visible_text": "CAT"},
        ],
    }
    palette = ["#FF6600", "#CC4400"]
    detections = [
        {"name": "cat", "bbox": [100, 200, 400, 500]},
        {"name": "bowl", "bbox": [500, 600, 700, 800]},
    ]
    result = build_json(palette, analysis, detections)
    warnings = verify(result)
    assert not warnings, f"build_json output has verifier warnings: {warnings}"
