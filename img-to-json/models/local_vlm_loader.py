"""
Local Vision-Language Model loader (currently Qwen3-VL-4B).

Swap the model_path below to change the local VLM used by the img-to-json
pipeline. The prompt in prompts/global_analysis.txt may also need updating
if the replacement model expects a different schema.

Extending: add a new loader module here, import it in pipeline.py, and
switch on a config flag to pick which VLM to load.
"""

from functools import cache

import mlx_vlm
from mlx_vlm.utils import load_model, get_model_path


@cache
def get_local_vlm():
    """Load the local VLM (Qwen3-VL-4B, 8-bit MLX) — cached after first call.

    Returns (model, processor) tuple compatible with mlx_vlm.generate().
    """
    model_path = get_model_path("mlx-community/Qwen3-VL-4B-Instruct-8bit")
    model, processor = mlx_vlm.load(model_path)
    return model, processor
