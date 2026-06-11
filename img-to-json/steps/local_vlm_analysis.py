import json
import logging
from pathlib import Path

from PIL import Image
from mlx_vlm import generate
from mlx_vlm.prompt_utils import apply_chat_template

"""
Step 2 — Local VLM analysis (currently Qwen3-VL-4B).

Sends the image to the local VLM loaded by local_vlm_loader and returns
a structured analysis (high-level description, style, objects with bboxes).

Swapping the local model: change the model in models/local_vlm_loader.py
and update prompts/global_analysis.txt to match the new model's schema.
"""

from models.local_vlm_loader import get_local_vlm

logger = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "global_analysis.txt"
_SYSTEM_PROMPT = _PROMPT_PATH.read_text().strip()

_USER_TEXT = "Analyze this image and return the JSON."

_RETRY_PROMPT = (
    "Return ONLY a raw JSON object. No text before or after. "
    "Do not wrap in markdown code fences."
)


def _parse_json(raw: str) -> dict | None:
    stripped = raw.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def _build_messages(user_text: str) -> list:
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_text},
    ]


def analyze(image: Image.Image, verbose: bool = False, debug=None) -> dict:
    model, processor = get_local_vlm()
    config = model.config

    user_text = _USER_TEXT
    messages = _build_messages(user_text)
    prompt = apply_chat_template(processor, config, messages, num_images=1)

    if debug and debug.enabled:
        debug.save_text("02_vlm/system_prompt.txt", _SYSTEM_PROMPT)
        debug.save_text("02_vlm/user_message.txt", user_text)

    for attempt in range(2):
        result = generate(
            model, processor, prompt, image=image, max_tokens=4096, verbose=verbose
        )
        response = result.text
        if verbose:
            logger.info("Qwen3-VL raw response (attempt %d):\n%s", attempt + 1, response)

        if debug and debug.enabled:
            debug.save_text(f"02_vlm/raw_response_attempt_{attempt + 1}.txt", response)

        parsed = _parse_json(response)
        if parsed is not None:
            parsed.setdefault("objects", [])
            if debug and debug.enabled:
                debug.save_json("02_vlm/parsed.json", parsed)
            return parsed

        if verbose:
            logger.warning("JSON parse failed on attempt %d, retrying...", attempt + 1)
        user_text = _RETRY_PROMPT
        messages = _build_messages(user_text)
        prompt = apply_chat_template(processor, config, messages, num_images=1)

    raise RuntimeError(
        f"Qwen3-VL failed to return valid JSON after 2 attempts.\nRaw output:\n{result.text}"
    )
