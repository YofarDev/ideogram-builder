import { emit } from './events.js';

const SYSTEM_PROMPT = `You convert a natural-language user idea into a structured JSON caption for Ideogram 4 image generation. The caption will be loaded into a visual bounding-box editor where each element becomes a selectable, resizable region on a canvas.

An element earns its own entry only when it describes a distinct visual region or subject that adds a fact not already covered by ` + "`background`" + ` or another element's ` + "`desc`" + `. Do not create separate elements for sub-parts of an already-described subject (hands, limbs, individual gestures) unless that part carries distinct text or a clearly separate color region. Aim for 3–8 spatially distinct elements so the user can fine-tune positions. If fewer than 3 elements would result, the editor will have very few handles — consider whether the scene genuinely supports more.

Output valid JSON with EXACTLY these top-level keys, in this order:
{"aspect_ratio":"W:H","high_level_description":"...","style_description":{...},"compositional_deconstruction":{"background":"...","elements":[ ... ]}}

Return ONLY the JSON object — no markdown fences, no commentary.
Preserve non-ASCII characters as-is. Use SINGLE quotes in prose for embedded text references.

### aspect_ratio (first field)

The target W:H string from the user message. Echo it verbatim.

### high_level_description

One concise sentence summarizing the entire image. Starts with the subject — never "this image shows" or "depicts". Name recognized entities by full name. 50-word cap.

NOTE: This field must state ONLY the main subject(s), the setting, and object counts — e.g. 'Three people at a dining table with plates and wine glasses.' It must NOT include gestures, poses, facial expressions, or emotions; those belong exclusively in the relevant element's ` + "`desc`" + `. Any clause that appears in an element's ` + "`desc`" + ` must be absent from ` + "`high_level_description`" + `.

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

Break the scene into elements that form a coherent composition. Each element represents a distinct visual region or subject — think of them as layers in a composition. Cover foreground, midground, and background regions.

Including "horizontal bands" (sky, ground, horizon) as elements with bboxes is recommended — it gives the user spatial control over those regions.

For dense or scattered groups (flower field, crowd, scattered debris, particles), provide a single encompassing bbox rather than per-item bboxes.

### Element desc guidelines

Each desc is 30–60 words. Identity first, then attributes:
- People: skin tone, hair, visible garments, expression, pose, distinguishing features
- Objects: shape, material, color, markings, distinct parts
- Regions: contents, character, key visual features

Detailed, vivid descriptions. Include observable properties not generic impressions.

NOTE: text elements are exempt from the 30-60 word target and the "identity first" rule — their "desc" is style/placement only (see TEXT handling) and never restates the characters stored in "text".

### BBOX format

[y_min, x_min, y_max, x_max] in 0–1000 normalized coordinates, top-left origin.
Include bboxes on ALL elements — the user needs them for the canvas editor.

Bbox values are normalized to 0-1000 in BOTH axes. A [0,0,500,500] bbox is square only on a 1:1 image; on 16:9 it becomes wide, on 9:16 tall. Scale spans so (x2-x1)/(y2-y1) ≈ width/height for square regions.

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
- "desc" for a text element must describe ONLY the visual treatment and placement — font family/weight, color, size qualifier, whether it is a logo/stylized graphic, and where it sits relative to neighbors. It must NEVER quote, paraphrase, or reference the literal characters. Banned clauses: "reads '...'", "says '...'", "contains the word '...'", "the text '...'", "reading '...'", "spelled '...'".
- Text-element "desc" is shorter (10-25 words) and does NOT need to hit the 30-60 word object target — do not pad it.
- GOOD text desc: "Large, stylized red logo on a black and purple background in the lower left."
- BAD text desc: "A white speech bubble containing the word 'Chut!' in black, bold font." (restates the characters)
- Use separate text elements for visually distinct text blocks
- Include: quoted strings, signage, labels, badges, brand names, numbers, titles
- Each text element appears once in the list
- Use \\n for line breaks within a multi-line text element

### Pop culture references

When the user names a brand, product, public figure, fictional character, or franchise, use the explicit name in the relevant element desc — not a generic stand-in.`;

let fullConfig = null;

export function initAIEnhancer() {
  const modelSelect = document.getElementById('ai-model');
  const btn = document.getElementById('btn-ai-enhance');
  if (!modelSelect || !btn) return;

  btn.disabled = true;
  btn.addEventListener('click', enhancePrompt);

  const rewriteBtn = document.getElementById('btn-rewrite-caption');
  if (rewriteBtn) rewriteBtn.addEventListener('click', rewriteCaption);

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
          opt.textContent = p.has_vision ? `${m} 👁` : m;
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

function aspectRatioFromSelector() {
  const val = document.getElementById('ai-aspect-ratio').value;
  const [w, h] = val.split('x').map(Number);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
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
          { role: 'user', content: `TARGET IMAGE ASPECT RATIO: ${aspectRatioFromSelector()} (width:height).\nUser idea: ${prompt}` },
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

async function rewriteCaption() {
  const currentJson = document.getElementById('json-output').value.trim();
  if (!currentJson) {
    showStatus('No caption to rewrite — generate or load one first', 'error');
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

  const rewriteBtn = document.getElementById('btn-rewrite-caption');
  rewriteBtn.disabled = true;
  rewriteBtn.textContent = 'Rewriting…';

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
          {
            role: 'system',
            content: 'You are a caption rewriting assistant. The caption you receive is '
              + 'in JSON format with a specific schema. Rewrite the caption '
              + 'according to the user instructions while preserving the exact '
              + 'JSON structure and all original fields. Only modify the text '
              + 'values inside the JSON — never change keys, remove fields, or '
              + 'alter the schema. Output ONLY the full rewritten JSON caption — '
              + 'no explanations, no preface, no markdown formatting.',
          },
          {
            role: 'user',
            content: `Improve the descriptions, make them more vivid and detailed. Keep the exact JSON structure.\n\nCaption:\n${currentJson}`,
          },
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

    document.getElementById('json-output').value = JSON.stringify(json, null, 2);
    emit('state:loaded', { json });
    showStatus('Caption rewritten successfully', 'success');
  } catch (err) {
    if (err.name === 'AbortError') {
      showStatus('Rewrite timed out after 30s', 'error');
    } else if (err instanceof SyntaxError) {
      showStatus('Invalid JSON response from API', 'error');
    } else {
      showStatus(err.message, 'error');
    }
  } finally {
    rewriteBtn.disabled = false;
    rewriteBtn.textContent = 'Rewrite';
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
