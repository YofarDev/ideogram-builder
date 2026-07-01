import argparse
import json
import logging
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Image → Ideogram4 JSON caption pipeline"
    )
    parser.add_argument("image_path", help="Path to input image")
    parser.add_argument("--output", "-o", help="Write JSON to file instead of stdout")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print intermediate outputs")
    parser.add_argument("--no-sam", action="store_true", help="Skip SAM bounding-box detection")
    parser.add_argument(
        "--low-memory",
        action="store_true",
        help="Unload Qwen3-VL before loading SAM (slower, safer on 16GB)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Save intermediate artifacts for debugging",
    )
    parser.add_argument(
        "--split",
        action="store_true",
        help="Use the split pipeline (two VLM calls + SAM-only localization)",
    )
    parser.add_argument(
        "--style-override",
        type=str,
        help="Path to JSON file with style override for the split pipeline",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="Qwen3-VL-4B-Instruct-8bit",
        help="Local VLM model name (HuggingFace repo under mlx-community/)",
    )
    parser.add_argument(
        "--bbox-only",
        action="store_true",
        help="Subprocess mode: given --objects JSON file, output bboxes only",
    )
    parser.add_argument(
        "--objects",
        type=str,
        help="Path to JSON file with objects list (for --bbox-only mode)",
    )
    parser.add_argument(
        "--bbox-format",
        type=str,
        default="xyxy",
        choices=["xyxy", "yxyx"],
        help="Bbox order the VLM is asked to emit (final JSON is always yxyx)",
    )

    args = parser.parse_args()

    if args.bbox_only:
        _run_bbox_only(args)
        return

    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)

    debug_logger = None
    if args.debug:
        from utils.debug_logger import create_debug_dir, DebugLogger
        debug_dir = create_debug_dir(Path(__file__).resolve().parent)
        debug_logger = DebugLogger(debug_dir)

    kwargs = dict(
        image_path=args.image_path,
        output_path=args.output,
        verbose=args.verbose,
        low_memory=args.low_memory,
        debug=debug_logger,
        model=args.model,
        bbox_format=args.bbox_format,
    )
    if args.split:
        from pipeline_split import run
        if args.style_override:
            kwargs["style_override"] = json.loads(Path(args.style_override).read_text())
    else:
        from pipeline import run
        kwargs["no_sam"] = args.no_sam

    run(**kwargs)

    if debug_logger and debug_logger.enabled:
        print(f"[debug_dir]{debug_logger.dir_path()}", file=sys.stderr)


if __name__ == "__main__":
    main()


def _run_bbox_only(args):
    """Subprocess mode: load VLM fresh (no SAM), output bboxes for given objects."""
    from PIL import Image
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template
    from models.local_vlm_loader import get_local_vlm
    from steps.local_vlm_analysis import _parse_json
    from utils.bbox import to_yxyx, format_prompt

    image = Image.open(args.image_path).convert("RGB")
    objects = json.loads(Path(args.objects).read_text())
    prompt_dir = Path(__file__).resolve().parent / "prompts"

    system_prompt = format_prompt((prompt_dir / "bbox_fallback.txt").read_text().strip(), args.bbox_format)
    user_msg = "Locate these objects:\n" + "\n".join(
        f"- {o['name']}: {o.get('desc', '')[:100]}" for o in objects
    )

    w, h = image.size
    scale = 512 / max(w, h)
    if scale < 1.0:
        image = image.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

    model, processor = get_local_vlm(args.model)
    config = model.config
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_msg},
    ]
    prompt = apply_chat_template(processor, config, messages, num_images=1)
    result = generate(model, processor, prompt, image=image, max_tokens=1024)

    parsed = _parse_json(result.text)
    if parsed:
        for o in parsed.get("objects", []):
            if "bbox" in o:
                o["bbox"] = to_yxyx(o.get("bbox"), args.bbox_format)
        print(json.dumps(parsed))
    else:
        print(json.dumps({"objects": []}))
