"""Linux SAM backend: HuggingFace Grounding DINO (text -> bounding boxes).

The pipeline's local SAM3 (mlx) is Apple-Silicon-only. Grounding DINO is the
closest Linux equivalent to what Sam3Predictor does here: it takes a text phrase
and returns candidate boxes + scores for that phrase. sam_detection.py only
consumes .scores and .boxes (xyxy, pixel) so we wrap Grounding DINO behind that
same interface.

Set IDEOGRAM_GROUNDING_MODEL / IDEOGRAM_GROUNDING_THRESHOLD /
IDEOGRAM_GROUNDING_TEXT_THRESHOLD to tune without code changes.
"""
import os
from functools import cache

_MODEL_ID = os.environ.get("IDEOGRAM_GROUNDING_MODEL", "IDEA-Research/grounding-dino-tiny")
_THRESHOLD = float(os.environ.get("IDEOGRAM_GROUNDING_THRESHOLD", "0.30"))
_TEXT_THRESHOLD = float(os.environ.get("IDEOGRAM_GROUNDING_TEXT_THRESHOLD", "0.25"))


class _DetectionResult:
    def __init__(self, boxes, scores):
        self.boxes = boxes
        self.scores = scores


class _GroundingDinoPredictor:
    def __init__(self, model, processor, threshold, text_threshold):
        self._model = model
        self._processor = processor
        self._threshold = threshold
        self._text_threshold = text_threshold

    def predict(self, image, text_prompt):
        import torch

        text = text_prompt.strip()
        if not text.endswith("."):
            text = text + "."
        inputs = self._processor(images=image, text=text, return_tensors="pt")
        with torch.no_grad():
            outputs = self._model(**inputs)
        w, h = image.size
        results = self._processor.post_process_grounded_object_detection(
            outputs,
            input_ids=inputs.get("input_ids"),
            threshold=self._threshold,
            text_threshold=self._text_threshold,
            target_sizes=[(h, w)],
        )
        r = results[0]
        boxes = [b for b in r["boxes"]]
        scores = [float(s) for s in r["scores"].tolist()]
        return _DetectionResult(boxes=boxes, scores=scores)


def build_hf_predictor():
    """Build a fresh Grounding DINO predictor. Caching is handled by the caller
    (get_sam_predictor) so unload_sam can drop it via cache_clear()."""
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

    processor = AutoProcessor.from_pretrained(_MODEL_ID)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(_MODEL_ID)
    model.eval()
    return _GroundingDinoPredictor(model, processor, _THRESHOLD, _TEXT_THRESHOLD)
