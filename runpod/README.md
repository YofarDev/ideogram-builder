# RunPod Serverless — Ideogram-4 / MOSS-Image Backend

Serverless endpoint that runs [Ideogram-4](https://ideogram.ai/) and [MOSS-Image](https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT) image generation via ComfyUI on RunPod. Each model has its own Docker image and endpoint; both share `handler.py`.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Ideogram-4 image: ComfyUI (latest) + KJNodes + rgthree + Ideogram-4 model files |
| `Dockerfile.moss` | MOSS-Image image: ComfyUI (pinned ≥ MOSS merge) + rgthree + MOSS model files |
| `handler.py` | RunPod handler — accepts `model`, `import_json`, `width`, `height`, `preset`, `negative_prompt` → returns base64 or S3 images + `seed` |
| `workflow_template.json` | API-format ComfyUI workflow (stripped of UI-only nodes) |
| `workflow_template_moss.json` | MOSS-Image API-format workflow (UNET/CLIP/VAE loaders + DMD LoRA + SLG + KSampler) |
| `client.py` | CLI for sending requests to a deployed RunPod endpoint |
| `example_prompt.json` | Sample Ideogram prompt JSON for testing |
| `example_moss_layout.json` | Sample MOSS layout JSON (EXPLORE poster, 1024×1024) for testing |

## How It Works

1. RunPod starts a container with ComfyUI + Ideogram-4 models
2. `handler.py` receives a job with a prompt JSON, width, and height
3. It injects the prompt into the workflow template and queues it on ComfyUI
4. It waits for execution via WebSocket, then fetches output images
5. Images are returned as base64 strings (or uploaded to S3 if `BUCKET_ENDPOINT_URL` is set)

## Building

Push a git tag (e.g. `v1.0.8`) — RunPod Container Builder picks it up automatically.

- **Dockerfile path:** `runpod/Dockerfile`
- **Build context:** repo root

Manual build:

```bash
docker build -f runpod/Dockerfile -t ideogram4-worker .
```

### MOSS-Image endpoint (manual, one-time)

MOSS ships in a separate image (~13 GB of weights, no Ideogram files). Create a
**second serverless endpoint** in the RunPod console pointing at the same repo
repository:

- **Dockerfile path:** `runpod/Dockerfile.moss`
- **Build context:** repo root

```bash
docker build -f runpod/Dockerfile.moss -t moss-worker .
```

Jobs are routed by the `model` input: absent (or `"ideogram"`) → Ideogram-4
workflow, `"moss"` → MOSS workflow. The handler only loads the templates that
exist in its own image, so a MOSS job sent to the Ideogram endpoint fails fast.

## API

```
POST /run
```

### Request

```json
{
  "input": {
    "import_json": "<prompt JSON string or MOSS layout JSON / plain caption>",
    "width": 1024,
    "height": 1024,
    "model": "moss",
    "negative_prompt": "nsfw, worst quality, bad anatomy, watermark, jpeg artifact",
    "preset": "Fast"
  }
}
```

`model`, `negative_prompt` are MOSS-only (ignored for Ideogram). MOSS presets:
`Turbo` (8-step DMD LoRA, experimental), `Fast` (25 steps, default), `Quality`
(50 steps). MOSS `width`/`height` must be multiples of 16.

### Response

```json
{
  "output": {
    "images": [
      {
        "filename": "ComfyUI_00001_.png",
        "type": "base64",
        "data": "<base64-encoded image data>"
      }
    ],
    "seed": 123456789
  }
}
```

`seed` is the seed actually used (randomised server-side when the request omits it).

## CLI Usage

```bash
python client.py prompt.json \
  --endpoint-id <your-endpoint-id> \
  --api-key <your-api-key> \
  --width 1024 \
  --height 1024 \
  --output-dir ./output
```

Use `--async` flag for the async `/run` endpoint instead of sync `/runsync`.

MOSS smoke tests (against the MOSS endpoint):

```bash
python client.py --model moss --preset Fast \
  --prompt "A red fox in snow" \
  --endpoint-id <moss-endpoint-id> --api-key <api-key>

python client.py runpod/example_moss_layout.json \
  --model moss --preset Fast \
  --endpoint-id <moss-endpoint-id> --api-key <api-key>
```

`--model {ideogram,moss}` (default `ideogram`), `--preset`, `--negative`, and
`--prompt` (plain caption instead of a JSON file) are also accepted.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COMFY_API_AVAILABLE_INTERVAL_MS` | `50` | Poll interval when waiting for ComfyUI |
| `COMFY_API_AVAILABLE_MAX_RETRIES` | `0` | Max retries before fallback |
| `BUCKET_ENDPOINT_URL` | — | If set, uploads images to S3 instead of returning base64 |
| `REFRESH_WORKER` | `false` | Whether to refresh worker on startup |
| `WEBSOCKET_RECONNECT_ATTEMPTS` | `5` | WebSocket reconnect attempts |
| `WEBSOCKET_RECONNECT_DELAY_S` | `3` | Delay between reconnects |
| `HF_TOKEN` | — | HuggingFace bearer token; lets the worker download user LoRAs from private HF repos |

## Credentials keys (in `~/.config/llm-credentials.json`)

```json
{
  "runpod": { "api_key": "…", "endpoint_id": "ideogram-endpoint", "endpoints": { "moss": "moss-endpoint" } },
  "modal": { "endpoint_url": "…", "auth_token": "…", "lora_volume": "ideogram-loras" },
  "huggingface": { "token": "hf_…", "lora_repo": "you/private-loras" }
}
```

`modal.lora_volume` + `huggingface` enable the **local LoRA upload** flow: the
editor's LoRA panel "+ Add → File" streams the `.safetensors` to `server.py`,
which pushes it to the Modal volume (`modal volume put`) and/or the private HF
repo (`hf upload`). Workers pick it up from the volume (reloaded per job) or
download it on demand with `HF_TOKEN`. The token is never returned by the API.
