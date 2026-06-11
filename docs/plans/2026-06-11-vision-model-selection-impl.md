# Vision Model Selection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a model selector dropdown to the Vision tab so users can pick between the local MLX pipeline or external vision API providers (OpenAI-compatible, e.g. GPT-4o).

**Architecture:** Config lives in a `vision` section of `~/.config/llm-credentials.json`. Frontend fetches `/api/config`, populates a `<select>` with "Local" (built-in) + external providers. Backend `POST /api/img-to-json` dispatches based on `model` field: `"local"` runs existing MLX subprocess, `"openai::gpt-4o"` calls OpenAI vision API.

**Tech Stack:** Vanilla JS frontend, Python `http.server` backend, `urllib` for vision API calls.

---

### Task 1: Update `/api/config` to expose vision providers

**Files:**
- Modify: `server.py:19-34`

**Step 1: Modify `/api/config` handler**

Add `"vision"` to the keys extracted from credentials:

```python
# server.py, around line 29
config = {}
for key in ("deepseek", "google", "openrouter", "mimo", "runpod", "vision"):
    if key in creds:
        config[key] = creds[key]
```

**Step 2: Verify**

Run: `python -c "
import json
from pathlib import Path
creds = json.loads((Path.home() / '.config' / 'llm-credentials.json').read_text())
print(json.dumps({k: creds[k] for k in ('deepseek','google','openrouter','mimo','runpod','vision') if k in creds}, indent=2)[:200])
"` — should include vision section if present

---

### Task 2: Add vision system prompt file

**Files:**
- Create: `img-to-json/prompts/vision_analysis.txt`

**Step 1: Write the system prompt**

Create `img-to-json/prompts/vision_analysis.txt` with a prompt adapted from `ai-enhancer.js`'s `SYSTEM_PROMPT`, tuned for vision models that see the actual image. Instructs the model to output the same Ideogram4 JSON structure.

Content:
```
You analyze an image and output a structured JSON caption for Ideogram 4 image generation. The caption will be loaded into a visual bounding-box editor where each element becomes a selectable, resizable region on a canvas. This requires 3-8 spatially distinct elements so the user can fine-tune positions.

Output valid JSON with EXACTLY these top-level keys, in this order:
{"aspect_ratio":"W:H","high_level_description":"...","style_description":{...},"compositional_deconstruction":{"background":"...","elements":[ ... ]}}

Return ONLY the JSON object — no markdown fences, no commentary.
Preserve non-ASCII characters as-is. Use SINGLE quotes in prose for embedded text references.

### aspect_ratio (first field)

The detected W:H ratio of the input image. Compute from the image dimensions.

### high_level_description

One concise sentence summarizing the entire image. Starts with the subject — never "this image shows" or "depicts". Name recognized entities by full name. 50-word cap.

### style_description (key order is strict)

For PHOTOGRAPHIC captions (use "photo" field):
{"aesthetics":"...","lighting":"...","photo":"camera/lens details","medium":"photograph","color_palette":["#RRGGBB"]}

For NON-PHOTOGRAPHIC captions (use "art_style" instead of "photo"):
{"aesthetics":"...","lighting":"...","medium":"illustration|3d_render|painting|graphic_design","art_style":"...","color_palette":["#RRGGBB"]}

Rules:
- EXACTLY ONE of "photo" or "art_style" — never both
- "color_palette" is optional, must be last if present. Up to 16 colors, uppercase #RRGGBB only.

### compositional_deconstruction (key order is strict)

{
  "background": "detailed description of the overall environment and atmosphere",
  "elements": [ ... ]
}

"background" must come before "elements". Describe the overall scene, environment, lighting, and mood here.

### ELEMENTS — detailed spatial breakdown

Each element is one of:
{"type":"obj","bbox":[y1,x1,y2,x2],"desc":"...","color_palette":["#RRGGBB"]}
{"type":"text","bbox":[y1,x1,y2,x2],"text":"literal text","desc":"...","color_palette":["#RRGGBB"]}

Break the scene into 3-8 elements that form a coherent composition. Each element represents a distinct visual region or subject — think of them as layers in a composition. Cover foreground, midground, and background regions.

Including "horizontal bands" (sky, ground, horizon) as elements with bboxes is recommended — it gives the user spatial control over those regions.

### Element desc guidelines

Each desc is 30-60 words. Identity first, then attributes:
- People: skin tone, hair, visible garments, expression, pose, distinguishing features
- Objects: shape, material, color, markings, distinct parts
- Regions: contents, character, key visual features

Detailed, vivid descriptions. Include observable properties not generic impressions.

### BBOX format

[y_min, x_min, y_max, x_max] in 0-1000 normalized coordinates, top-left origin.
Include bboxes on ALL elements — the user needs them for the canvas editor.
For elements meant to fill a region of the frame, use bboxes that cover that region proportionally.

### Specificity — commit to one value

Banned hedge phrasings: "things like", "such as", "e.g.", "for example", "or similar", "various (as a qualifier)", "could include", "might be", "some kind of". Replace with concrete nouns, counts, colors, materials.

Banned alternative listings: "oak or walnut", "cream or ivory". Pick ONE and commit.

Banned implied/suggested hedges: "implied", "suggested", "hinted", "barely visible", "possibly", "perhaps". If it's in the scene, describe it concretely.

### TEXT handling

For in-image text elements:
- "text" field holds literal characters verbatim — preserve diacritics, capitalization
- Use separate text elements for visually distinct text blocks
- Include: quoted strings, signage, labels, badges, brand names, numbers, titles
- Each text element appears once in the list
- Use \n for line breaks within a multi-line text element

### Pop culture references

When you see a brand, product, public figure, fictional character, or franchise, use the explicit name in the relevant element desc — not a generic stand-in.
```

---

### Task 3: Backend — update `/api/img-to-json` for model dispatch

**Files:**
- Modify: `server.py:96-167`

**Step 1: Refactor endpoint to accept `model` field**

Change the handler to read a `model` field from the request body (default: `"local"`).

```python
elif self.path == "/api/img-to-json":
    length = int(self.headers.get("Content-Length", 0))
    body = json.loads(self.rfile.read(length))
    image_b64 = body.get("image", "")
    model = body.get("model", "local")
    
    if not image_b64:
        # ... existing error handling ...
        return

    header, b64 = image_b64.split(",", 1)
    img_data = base64.b64decode(b64)
    ext = "png" if "image/png" in header else "jpg"

    if model == "local":
        # existing pipeline logic
        ...
    else:
        # external vision API
        self._handle_vision_api(model, image_b64, ext)
```

**Step 2: Implement `_handle_vision_api` method**

Add a new method to `Handler` that:
1. Splits `model` on `::` to get `provider` and `model_name`
2. Loads credentials, gets `base_url` and `api_key` for that provider
3. Reads the vision system prompt from `img-to-json/prompts/vision_analysis.txt`
4. Makes an OpenAI-compatible chat completions request
5. Parses and returns the JSON

```python
def _handle_vision_api(self, model_str, image_data_url, ext):
    import urllib.request
    parts = model_str.split("::", 1)
    if len(parts) != 2:
        self._send_json(400, {"error": "Invalid model format"})
        return
    provider, model_name = parts
    
    creds = json.loads(CREDENTIALS_PATH.read_text())
    vision = creds.get("vision", {}).get(provider)
    if not vision or not vision.get("api_key"):
        self._send_json(400, {"error": f"No API key configured for {provider}"})
        return
    
    base_url = vision.get("base_url", "https://api.openai.com/v1")
    api_key = vision["api_key"]
    
    prompt_path = IMG_TO_JSON_DIR / "prompts" / "vision_analysis.txt"
    system_prompt = prompt_path.read_text().strip()
    
    url = f"{base_url.rstrip('/')}/chat/completions"
    
    body = json.dumps({
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": [
                {"type": "text", "text": "Analyze this image and produce the structured JSON output as instructed."},
                {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}}
            ]}
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 4096,
    }).encode()
    
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    })
    
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:200]
        self._send_json(502, {"error": f"Vision API {e.code}: {error_body}"})
        return
    except urllib.error.URLError as e:
        self._send_json(502, {"error": f"Vision API connection error: {str(e)}"})
        return
    except json.JSONDecodeError:
        self._send_json(502, {"error": "Vision API returned invalid JSON"})
        return
    
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content:
        self._send_json(502, {"error": "Vision API returned empty response"})
        return
    
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        self._send_json(502, {"error": "Vision API returned non-JSON content"})
        return
    
    self._send_json(200, {"json": parsed})
```

Add a helper `_send_json` to Handler:

```python
def _send_json(self, status, data):
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Access-Control-Allow-Origin", "*")
    self.end_headers()
    self.wfile.write(json.dumps(data).encode())
```

**Step 3: Test the endpoint manually**

Run the server: `python3 server.py`
Send a test request with curl (using a small test image):
```bash
# First test local (should still work)
curl -s -X POST http://localhost:8080/api/img-to-json \
  -H 'Content-Type: application/json' \
  -d '{"image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "model": "local"}' | head -c 200

# Test with OpenAI model (requires config)
curl -s -X POST http://localhost:8080/api/img-to-json \
  -H 'Content-Type: application/json' \
  -d '{"image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "model": "openai::gpt-4o"}'
```

---

### Task 4: Frontend — add model selector to vision tab

**Files:**
- Modify: `index.html:1841-1867`
- Modify: `src/vision.js`

**Step 1: Add dropdown HTML to index.html**

After the subtitle paragraph (line 1844), add:

```html
<div class="ai-header" style="margin-bottom:24px;width:100%;max-width:300px;justify-content:center;">
    <span class="ai-label">Vision Model</span>
    <select id="vision-model" class="ai-model-select">
        <option value="local">Local (Qwen3-VL + SAM)</option>
    </select>
</div>
```

**Step 2: Populate dropdown from config in vision.js**

In `initVision()`, fetch `/api/config` to populate the dropdown with external vision providers (same pattern as `ai-enhancer.js`).

Add at the beginning of `initVision`:

```javascript
const visionModelSelect = document.getElementById('vision-model');
fetch('/api/config', { signal: AbortSignal.timeout(5000) })
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(config => {
    const vision = config.vision;
    if (vision) {
      Object.entries(vision).forEach(([provider, p]) => {
        if (!p?.api_key || !p?.models?.length) return;
        if (p.models.every(m => !m)) return;

        const group = document.createElement('optgroup');
        group.label = provider.charAt(0).toUpperCase() + provider.slice(1);

        p.models.forEach(m => {
          if (!m) return;
          const opt = document.createElement('option');
          opt.value = `${provider}::${m}`;
          opt.textContent = m;
          group.appendChild(opt);
        });

        if (p.default_model && p.models.includes(p.default_model)) {
          const defaultVal = `${provider}::${p.default_model}`;
          const existing = group.querySelector(`[value="${defaultVal}"]`);
          if (existing) group.insertBefore(existing, group.firstChild);
        }

        visionModelSelect.appendChild(group);
      });
    }
  })
  .catch(() => {
    // silent fallback — local only
  });
```

**Step 3: Send model field in processImage()**

In the `processImage()` function, read the selected model:

```javascript
const selectedModel = document.getElementById('vision-model').value || 'local';

// In the fetch call:
body: JSON.stringify({ image: dataUrl, model: selectedModel }),
```

**Step 4: Disable model selector during processing**

Add to the processing state:

```javascript
isProcessing = true;
processBtn.disabled = true;
visionModelSelect.disabled = true;
processBtn.textContent = 'Processing\u2026';
statusEl.textContent = 'Processing\u2026';

// In finally:
visionModelSelect.disabled = false;
```

---

### Task 5: Wire up in app.js

**Files:**
- Modify: `src/app.js`

**Step 1: No changes needed**

`initVision` is already called in app.js and handles its own DOM wiring. The config fetch is self-contained within `initVision`.

---

### Task 6: Add vision section template to `/api/open-config`

**Files:**
- Modify: `server.py:47-65`

**Step 1: Add vision template**

When creating the template file (line 50-55), add a `vision` section:

```python
CREDENTIALS_PATH.write_text(json.dumps({
    "deepseek": {...},
    "google": {...},
    "openrouter": {...},
    "mimo": {...},
    "vision": {
        "openai": {
            "base_url": "https://api.openai.com/v1",
            "api_key": "",
            "default_model": "gpt-4o",
            "models": ["gpt-4o", "gpt-4o-mini"]
        }
    }
}, indent=2))
```

---

### Task 7: Refactor server.py — DRY JSON responses

**Files:**
- Modify: `server.py`

**Step 1: Extract `_send_json` helper**

Add a helper method to `Handler` to eliminate repetitive response boilerplate:

```python
def _send_json(self, status, data):
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Access-Control-Allow-Origin", "*")
    self.end_headers()
    self.wfile.write(json.dumps(data).encode())
```

**Step 2: Refactor existing endpoints to use `_send_json`**

Replace inline response code in:
- `/api/config` GET
- `/api/save-image` POST
- `/api/img-to-json` POST (both branches)
- `/api/open-output` GET
- `/api/open-config` GET
