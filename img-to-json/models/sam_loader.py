import platform
from functools import cache


def _get_mlx_predictor():
    from mlx_vlm.utils import load_model, get_model_path
    from mlx_vlm.models.sam3.generate import Sam3Predictor
    from mlx_vlm.models.sam3_1.processing_sam3_1 import Sam31Processor
    model_path = get_model_path("mlx-community/sam3.1-bf16")
    model = load_model(model_path)
    processor = Sam31Processor.from_pretrained(str(model_path))
    return Sam3Predictor(model, processor, score_threshold=0.3)


@cache
def get_sam_predictor():
    if platform.system() == "Darwin":
        return _get_mlx_predictor()
    from models.sam_loader_hf import build_hf_predictor
    return build_hf_predictor()


def unload_sam():
    """Drop the cached SAM predictor so its memory can be reclaimed."""
    get_sam_predictor.cache_clear()
