# Ideogram Builder

Visual prompt builder for [Ideogram4](https://ideogram.ai/) JSON image generation. Canvas-based bounding box editor with color palettes, RunPod serverless backend, and PNG metadata import.

![Ideogram Builder — empty editor](screenshots/editor.png)
![Ideogram Builder — prompt with JSON output](screenshots/editor-filled.png)

## Features

- **Canvas editor** — draw bounding boxes on a grid, drag/resize, assign labels
- **Color palettes** — add/remove swatches, auto-apply to selected boxes
- **Layer panel** — reorder, hide/show, and lock boxes
- **JSON output** — live-generated Ideogram-compatible JSON prompt
- **PNG import** — drag-drop existing images, extract metadata and bounding boxes
- **Vision / Image-to-JSON** — upload a reference image and auto-generate a prompt via vision LLM
- **RunPod generation** — send prompts to a RunPod serverless ComfyUI endpoint
- **AI prompt enhancer** — refine prompts via DeepSeek, Google, OpenRouter, or Mimo
- **Gallery** — history grid with localStorage persistence and thumbnails
- **Settings** — mode toggle (freeform / grid), aspect ratio presets, box form fields

## Quick Start

```bash
python3 server.py
```

Opens at `http://localhost:8000`. Server auto-loads LLM credentials from `~/.config/llm-credentials.json`.

## Tech Stack

Vanilla JS, no build tools. ES modules via `<script type="module">`.

## Project Structure

```
/                   — Frontend (vanilla JS app)
/runpod/            — RunPod Serverless backend (Docker image + handler)
/docs/              — Prompting guide and architecture plans
```

## RunPod Backend

Serverless endpoint that runs Ideogram-4 via ComfyUI in a Docker container. See [`runpod/README.md`](runpod/README.md) for details.

## License

MIT
