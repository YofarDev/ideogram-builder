# RunPod Serverless — Ideogram-4 Backend

Serverless endpoint that runs [Ideogram-4](https://ideogram.ai/) image generation via ComfyUI on RunPod.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Custom image: ComfyUI (latest) + KJNodes + rgthree + Ideogram-4 model files |
| `handler.py` | RunPod handler — accepts `import_json`, `width`, `height` → returns base64 or S3 images |
| `workflow_template.json` | API-format ComfyUI workflow (stripped of UI-only nodes) |
| `client.py` | CLI for sending requests to a deployed RunPod endpoint |
| `example_prompt.json` | Sample prompt JSON for testing |

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

## API

```
POST /run
```

### Request

```json
{
  "input": {
    "import_json": "<prompt JSON string>",
    "width": 1024,
    "height": 1024
  }
}
```

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
    ]
  }
}
```

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COMFY_API_AVAILABLE_INTERVAL_MS` | `50` | Poll interval when waiting for ComfyUI |
| `COMFY_API_AVAILABLE_MAX_RETRIES` | `0` | Max retries before fallback |
| `BUCKET_ENDPOINT_URL` | — | If set, uploads images to S3 instead of returning base64 |
| `REFRESH_WORKER` | `false` | Whether to refresh worker on startup |
| `WEBSOCKET_RECONNECT_ATTEMPTS` | `5` | WebSocket reconnect attempts |
| `WEBSOCKET_RECONNECT_DELAY_S` | `3` | Delay between reconnects |
