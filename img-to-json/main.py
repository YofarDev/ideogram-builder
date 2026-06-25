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

    args = parser.parse_args()

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
