"""
Local Vision-Language Model loader.

Model is selected at runtime via the model_name parameter. Models are
auto-downloaded from HuggingFace (mlx-community/ org) on first use.
"""

from functools import cache

import mlx_vlm
from mlx_vlm.utils import get_model_path


@cache
def get_local_vlm(model_name="Qwen3-VL-4B-Instruct-8bit"):
    """Load a local VLM — cached per model_name after first call.

    model_name is a HuggingFace repo under mlx-community/ (e.g. "Qwen3-VL-8B-Instruct-4bit").
    If it already contains a "/", it's used as-is (full org/repo path).
    """
    repo = model_name if "/" in model_name else f"mlx-community/{model_name}"
    model_path = get_model_path(repo)
    model, processor = mlx_vlm.load(model_path)
    return model, processor
