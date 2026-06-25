from functools import cache

from mlx_vlm.utils import load_model, get_model_path
from mlx_vlm.models.sam3.generate import Sam3Predictor
from mlx_vlm.models.sam3_1.processing_sam3_1 import Sam31Processor


@cache
def get_sam_predictor():
    model_path = get_model_path("mlx-community/sam3.1-bf16")
    model = load_model(model_path)
    processor = Sam31Processor.from_pretrained(str(model_path))
    predictor = Sam3Predictor(model, processor, score_threshold=0.3)
    return predictor


def unload_sam():
    """Drop the cached SAM predictor so its memory can be reclaimed."""
    get_sam_predictor.cache_clear()
