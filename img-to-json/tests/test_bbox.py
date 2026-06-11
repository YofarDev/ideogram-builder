import numpy as np

from utils.bbox import xyxy_to_ideogram, mask_to_bbox_ideogram


def test_xyxy_to_ideogram_basic():
    box = [100.0, 200.0, 300.0, 400.0]
    result = xyxy_to_ideogram(box)
    assert result == [200, 100, 400, 300]


def test_xyxy_to_ideogram_clip_low():
    box = [-10.0, -5.0, 500.0, 600.0]
    result = xyxy_to_ideogram(box)
    assert result == [0, 0, 600, 500]


def test_xyxy_to_ideogram_clip_high():
    box = [900.0, 950.0, 1100.0, 1050.0]
    result = xyxy_to_ideogram(box)
    assert result == [950, 900, 1000, 1000]


def test_xyxy_to_ideogram_rounds():
    box = [100.4, 200.6, 300.4, 400.6]
    result = xyxy_to_ideogram(box)
    assert result == [201, 100, 401, 300]


def test_mask_to_bbox_basic():
    mask = np.zeros((100, 100), dtype=bool)
    mask[30:70, 20:80] = True
    result = mask_to_bbox_ideogram(mask)
    assert result == [30, 20, 69, 79]


def test_mask_to_bbox_single_pixel():
    mask = np.zeros((100, 100), dtype=bool)
    mask[50, 50] = True
    result = mask_to_bbox_ideogram(mask)
    assert result == [50, 50, 50, 50]
