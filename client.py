import requests
import json
import argparse
import base64
from pathlib import Path


def build_payload(import_json, width, height):
    if isinstance(import_json, (dict, list)):
        import_json = json.dumps(import_json)
    return {
        "input": {
            "import_json": import_json,
            "width": width,
            "height": height,
        }
    }


def send_request(endpoint_id, api_key, payload, sync=True):
    endpoint = f"https://api.runpod.ai/v2/{endpoint_id}/{'runsync' if sync else 'run'}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(endpoint, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()


def save_images(output, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    images = output.get("images", [])
    saved = []
    for img in images:
        if img.get("type") == "base64":
            data = base64.b64decode(img["data"])
            filename = img["filename"]
            path = output_dir / filename
            with open(path, "wb") as f:
                f.write(data)
            saved.append(str(path))
        elif img.get("type") == "s3_url":
            print(f"  S3 URL (not downloading): {img['data']}")
            saved.append(img["data"])

    return saved


def main():
    parser = argparse.ArgumentParser(description="Generate images using RunPod Ideogram-4 endpoint")
    parser.add_argument("prompt_json", help="Path to JSON file containing the prompt definition, or inline JSON string")
    parser.add_argument("--endpoint-id", required=True, help="RunPod endpoint ID")
    parser.add_argument("--api-key", required=True, help="RunPod API key")
    parser.add_argument("--width", type=int, default=1024, help="Image width (default: 1024)")
    parser.add_argument("--height", type=int, default=1024, help="Image height (default: 1024)")
    parser.add_argument("--output-dir", default="./output", help="Directory to save output images")
    parser.add_argument("--async", dest="sync", action="store_false", help="Use async /run endpoint instead of /runsync")
    args = parser.parse_args()

    try:
        with open(args.prompt_json) as f:
            import_json = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        import_json = args.prompt_json

    payload = build_payload(import_json, args.width, args.height)

    print(f"Sending request to endpoint {args.endpoint_id} ({'sync' if args.sync else 'async'})...")
    print(f"  width={args.width}, height={args.height}")
    print(f"  import_json={json.dumps(import_json, indent=2)[:200]}...")

    result = send_request(args.endpoint_id, args.api_key, payload, sync=args.sync)

    if args.sync:
        print(f"Status: {result.get('status', 'N/A')}")

        output = result.get("output", {})
        if "error" in result:
            print(f"Error: {result['error']}")
            return

        saved = save_images(output, args.output_dir)
        if saved:
            print(f"Saved {len(saved)} image(s):")
            for path in saved:
                print(f"  {path}")

        if output.get("errors"):
            print(f"Warnings: {output['errors']}")
    else:
        print(f"Async job submitted. ID: {result.get('id')}")
        print(f"Check status at: https://api.runpod.ai/v2/{args.endpoint_id}/status/{result.get('id')}")


if __name__ == "__main__":
    main()
