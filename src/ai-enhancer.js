import { emit } from './events.js';
import { state } from './state.js';

const SYSTEM_PROMPT = `You convert a natural-language user idea into a structured JSON caption for Ideogram 4 image generation. The caption will be loaded into a visual bounding-box editor where each element becomes a selectable, resizable region on a canvas. This requires 3–8 spatially distinct elements so the user can fine-tune positions.

Output valid JSON with EXACTLY these top-level keys, in this order:
{"aspect_ratio":"W:H","high_level_description":"...","style_description":{...},"compositional_deconstruction":{"background":"...","elements":[ ... ]}}

Return ONLY the JSON object — no markdown fences, no commentary.
Preserve non-ASCII characters as-is. Use SINGLE quotes in prose for embedded text references.

### aspect_ratio (first field)

The target W:H string from the user message. Echo it verbatim.

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

Break the scene into 3–8 elements that form a coherent composition. Each element represents a distinct visual region or subject — think of them as layers in a composition. Cover foreground, midground, and background regions.

Including "horizontal bands" (sky, ground, horizon) as elements with bboxes is recommended — it gives the user spatial control over those regions.

### Element desc guidelines

Each desc is 30–60 words. Identity first, then attributes:
- People: skin tone, hair, visible garments, expression, pose, distinguishing features
- Objects: shape, material, color, markings, distinct parts
- Regions: contents, character, key visual features

Detailed, vivid descriptions. Include observable properties not generic impressions.

### BBOX format

[y_min, x_min, y_max, x_max] in 0–1000 normalized coordinates, top-left origin.
Include bboxes on ALL elements — the user needs them for the canvas editor.
For elements meant to fill a region of the frame, use bboxes that cover that region proportionally.

### Specificity — commit to one value

Banned hedge phrasings: "things like", "such as", "e.g.", "for example", "or similar", "various (as a qualifier)", "could include", "might be", "some kind of". Replace with concrete nouns, counts, colors, materials.

Banned alternative listings: "oak or walnut", "cream or ivory". Pick ONE and commit.

Banned implied/suggested hedges: "implied", "suggested", "hinted", "barely visible", "possibly", "perhaps". If it's in the scene, describe it concretely.

### Exhaustive content

When the user provides enumerable content (lists, schedules, named items), every item must appear as its own element. Never sacrifice completeness.

### TEXT handling

For in-image text elements:
- "text" field holds literal characters verbatim — preserve diacritics, capitalization
- Use separate text elements for visually distinct text blocks
- Include: quoted strings, signage, labels, badges, brand names, numbers, titles
- Each text element appears once in the list
- Use \\n for line breaks within a multi-line text element

### Pop culture references

When the user names a brand, product, public figure, fictional character, or franchise, use the explicit name in the relevant element desc — not a generic stand-in.`;

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectRatioStr() {
  const w = state.canvas.width;
  const h = state.canvas.height;
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

let fullConfig = null;

export function initAIEnhancer() {
  const modelSelect = document.getElementById('ai-model');
  const btn = document.getElementById('btn-ai-enhance');
  if (!modelSelect || !btn) return;

  btn.disabled = true;
  btn.addEventListener('click', enhancePrompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  fetch('/api/config', { signal: controller.signal })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
      clearTimeout(timeout);
      fullConfig = config;
      modelSelect.innerHTML = '';
      const providers = ['deepseek', 'google', 'openrouter', 'mimo'];
      let firstModel = null;

      providers.forEach(provider => {
        const p = config[provider];
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
          if (!firstModel) firstModel = opt.value;
        });

        if (p.default_model && p.models.includes(p.default_model)) {
          const defaultVal = `${provider}::${p.default_model}`;
          if (firstModel) firstModel = defaultVal;
        }

        modelSelect.appendChild(group);
      });

      if (firstModel) {
        modelSelect.value = firstModel;
      } else {
        modelSelect.innerHTML = '<option value="">No models available — check credentials</option>';
      }
      btn.disabled = false;
    })
    .catch(() => {
      clearTimeout(timeout);
      modelSelect.innerHTML = '<option value="deepseek::deepseek-v4-flash">deepseek-v4-flash</option>';
      btn.disabled = false;
    });
}

async function enhancePrompt() {
  const prompt = document.getElementById('ai-prompt').value.trim();
  if (!prompt) {
    showStatus('Enter a prompt first', 'error');
    return;
  }

  const selected = document.getElementById('ai-model').value;
  if (!selected) {
    showStatus('No model selected', 'error');
    return;
  }

  const [provider, ...rest] = selected.split('::');
  const model = rest.join('::');
  const p = fullConfig?.[provider];
  if (!p?.api_key) {
    showStatus(`No API key for ${provider}`, 'error');
    return;
  }

  const defaultBaseUrls = {
    deepseek: 'https://api.deepseek.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/openai',
    openrouter: 'https://openrouter.ai/api/v1',
    mimo: 'https://api.xiaomimimo.com/v1',
  };
  const baseUrl = p.base_url || defaultBaseUrls[provider] || 'https://api.deepseek.com/v1';
  const apiUrl = `${baseUrl}/chat/completions`;

  setLoading(true);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${p.api_key}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `TARGET IMAGE ASPECT RATIO: ${aspectRatioStr()} (width:height).\nUser idea: ${prompt}` },
        ],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API ${response.status}: ${text.slice(0, 100)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from API');

    const json = JSON.parse(content);

    if (!json.compositional_deconstruction?.elements) {
      throw new Error('Response missing elements array');
    }

    delete json.aspect_ratio;
    document.getElementById('json-output').value = JSON.stringify(json, null, 2);
    emit('state:loaded', { json });
    // Switch to editor tab so the user sees the populated canvas
    document.querySelector('.tab-btn[data-tab="editor"]')?.click();
    showStatus('Prompt enhanced successfully', 'success');

  } catch (err) {
    if (err.name === 'AbortError') {
      showStatus('Request timed out after 30s', 'error');
    } else if (err instanceof SyntaxError) {
      showStatus('Invalid JSON response from API', 'error');
    } else {
      showStatus(err.message, 'error');
    }
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  const btn = document.getElementById('btn-ai-enhance');
  const textarea = document.getElementById('ai-prompt');
  btn.disabled = loading;
  btn.textContent = loading ? 'Enhancing...' : 'AI Enhance';
  textarea.disabled = loading;
}

function showStatus(msg, type) {
  const el = document.getElementById('ai-status');
  el.textContent = msg;
  el.className = 'ai-status ' + type;
}
