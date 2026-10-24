# Ideogram Builder

Visual prompt builder for [Ideogram4](https://ideogram.ai/) and [MOSS-Image](https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT) JSON image generation. Canvas-based bounding box editor with color palettes, RunPod/Modal backends, and PNG metadata import.

![Ideogram Builder — empty editor](screenshots/editor.png)
![Ideogram Builder — prompt with JSON output](screenshots/editor-filled.png)

## Features

- **Canvas editor** — draw bounding boxes on a grid, drag/resize, assign labels
- **Color palettes** — add/remove swatches, auto-apply to selected boxes
- **Layer panel** — reorder, hide/show, and lock boxes
- **JSON output** — live-generated Ideogram-compatible JSON prompt
- **PNG import** — drag-drop existing images, extract metadata and bounding boxes
- **Vision / Image-to-JSON** — upload a reference image and auto-generate a prompt via vision LLM
- **Two models** — Ideogram 4 and MOSS-Image workspaces share the canvas/boxes/palette; MOSS adds layout (centralized yxyx) and caption prompt formats, per-box tags and character boxes
- **RunPod / Modal generation** — send prompts to a RunPod serverless endpoint or a Modal app; MOSS jobs route to their own endpoint/worker automatically
- **AI prompt enhancer** — refine prompts via DeepSeek, Google, OpenRouter, or Mimo
- **Gallery** — history grid with localStorage persistence and thumbnails
- **Settings** — mode toggle (freeform / grid), aspect ratio presets, box form fields

## Quick Start

```bash
python3 server.py
```

Opens at `http://localhost:8000`. Server auto-loads LLM credentials from `~/.config/llm-credentials.json` (see `config.example.json` for every key, including `runpod.endpoints.moss`, `modal.lora_volume` and `huggingface` for private LoRA uploads).

## Tests

```bash
NODE_OPTIONS=--no-experimental-webstorage npm test          # frontend (Node 26 needs the flag)
uv run --with pytest --with requests --with websocket-client pytest runpod        # handler
uv run --with pytest --with numpy --with requests pytest test_server_lora.py      # upload endpoints
```

## Tech Stack

Vanilla JS, no build tools. ES modules via `<script type="module">`.

## Project Structure

```
/                   — Frontend (vanilla JS app)
/runpod/            — RunPod Serverless backend (Docker image + handler)
/docs/              — Prompting guide and architecture plans
```

## Backends

RunPod and Modal each host an Ideogram-4 and a MOSS-Image worker (separate Docker images, one shared handler). See [`runpod/README.md`](runpod/README.md) for endpoint setup, credentials keys and the local LoRA upload flow (file → Modal volume and/or private HF repo, downloaded on workers with `HF_TOKEN`).

## License

MIT
