# Vision Model Selection — Design

## Goal

Let users pick which vision model processes their image in the Vision tab. Currently hardcoded to the local MLX pipeline (Qwen3-VL + SAM); now also support external vision API providers (OpenAI-compatible, e.g. GPT-4o). Model selection works the same way as the AI Prompt feature: a dropdown populated from a config section in `~/.config/llm-credentials.json`.

## Config

A `vision` section in `~/.config/llm-credentials.json`:

```json
{
  "vision": {
    "openai": {
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-...",
      "default_model": "gpt-4o",
      "models": ["gpt-4o", "gpt-4o-mini"]
    }
  }
}
```

- Provider objects follow the same shape as LLM providers (`base_url`, `api_key`, `default_model`, `models`)
- Initial support: OpenAI only (extensible by adding more provider keys)
- `GET /api/config` returns the `vision` section alongside existing providers

## Frontend — Vision Tab

### Model selector

A `<select id="vision-model">` dropdown added to the vision tab's `.vision-section`, between the subtitle and the dropzone. Styled identically to `#ai-model`.

Dropdown content (populated on page load via `GET /api/config`):
- **Local** — always present, default option (built-in, no config needed). Value: `"local"`
- **OpenAI** (optgroup) — gpt-4o, gpt-4o-mini, etc. from `config.vision.openai.models`. Values: `"openai::gpt-4o"`, etc.

### Request payload

`POST /api/img-to-json` body changes from `{ image }` to `{ image, model }`:
- `model: "local"` — use MLX pipeline
- `model: "openai::gpt-4o"` — use OpenAI vision API

### Loading state

During processing, the model selector is disabled alongside the process button.

## Backend — Server Routing

Single endpoint `POST /api/img-to-json` dispatches based on `model`:

### Local (`model === "local"`)

Unchanged — runs `uv run img-to-json/main.py` subprocess with 120s timeout.

### External provider (e.g. `"openai::gpt-4o"`)

Split on `::` → provider + model name. Look up `base_url` and `api_key` from config.

Construct an OpenAI-compatible chat completions request:
```
POST {baseUrl}/chat/completions
Authorization: Bearer {api_key}
{
  "model": "gpt-4o",
  "messages": [
    { "role": "system", "content": "<vision system prompt>" },
    { "role": "user", "content": [
      { "type": "text", "text": "Analyze this image..." },
      { "type": "image_url", "image_url": { "url": "<base64 data URL>", "detail": "high" } }
    ]}
  ],
  "response_format": { "type": "json_object" },
  "max_tokens": 4096
}
```

Parse response JSON, return in same `{ "json": <parsed JSON> }` format.

### System prompt for external vision

Dedicated prompt adapted from `ai-enhancer.js` `SYSTEM_PROMPT` but tuned for image analysis (the model sees the actual image, not a text description). Instructs the model to output the same Ideogram4 JSON structure.

Stored in Python string (or a `.txt` file in `img-to-json/prompts/`). Covers:
- Output format (same Ideogram JSON schema)
- Bbox format (0–1000 normalized coordinates)
- Element guidelines (3–8 elements, spatial breakdown)
- Specificity rules (no hedge phrasing)

## File Changes

| File | Change |
|------|--------|
| `~/.config/llm-credentials.json` | Add `vision` section (manual) |
| `server.py` | Expose `vision` in `/api/config`, dispatch model in `/api/img-to-json`, add vision API caller |
| `index.html` | Add `<select id="vision-model">` to vision tab |
| `src/vision.js` | Load config, populate dropdown, send `model` field, disable selector during processing |
| `img-to-json/prompts/vision_analysis.txt` | New system prompt for external vision models |

## Error handling

- External API failure (non-2xx) → show toast with status + error snippet
- Timeout (30s for API calls) → show toast timeout error
- Invalid/missing JSON in response → show toast parse error
- Missing API key for selected provider → show toast, don't attempt request
