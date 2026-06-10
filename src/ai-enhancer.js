import { emit } from './events.js';

const API_URL = 'https://api.deepseek.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are an expert prompt engineer for Ideogram AI image generation. Given a natural language description, generate a complete JSON prompt for Ideogram's API.

Output valid JSON with this exact structure:
{
  "high_level_description": "concise summary of the entire image",
  "style_description": {
    "aesthetics": "mood and visual quality (e.g. cinematic, ethereal, vibrant, moody)",
    "lighting": "lighting conditions (e.g. golden hour, soft diffused, dramatic side light)",
    "medium": "art medium (e.g. digital painting, photograph, oil painting, concept art)",
    "art_style": "artistic style (e.g. impressionist, photorealism, minimalist, surreal)",
    "color_palette": ["#hex", "#hex", "#hex"]
  },
  "compositional_deconstruction": {
    "background": "detailed background description",
    "elements": [
      {
        "type": "obj",
        "bbox": [y1, x1, y2, x2],
        "desc": "detailed element description with appearance, texture, color",
        "color_palette": ["#hex"]
      }
    ]
  }
}

Rules:
- bbox coordinates use 0-1000 normalized range where [y1,x1] is top-left and [y2,x2] is bottom-right
- Elements must cover a coherent composition across the full canvas
- Include 3-6 elements arranged in a meaningful layout
- Each element needs a detailed visual description
- Colors should be harmonious hex values that match the scene
- Choose medium, aesthetics, lighting, and art_style that enhance the description
- If the description mentions photography, use "photo" field instead of "art_style"
- Return ONLY valid JSON, no explanations`;

let apiKey = '';

export function initAIEnhancer() {
  const modelSelect = document.getElementById('ai-model');
  const btn = document.getElementById('btn-ai-enhance');

  btn.disabled = true;
  btn.addEventListener('click', enhancePrompt);

  fetch('/api/config')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
      const ds = config.deepseek || {};
      if (ds.api_key) {
        apiKey = ds.api_key;
      }

      if (ds.models?.length) {
        modelSelect.innerHTML = '';
        ds.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          modelSelect.appendChild(opt);
        });
        if (ds.default_model && ds.models.includes(ds.default_model)) {
          modelSelect.value = ds.default_model;
        }
      }
      btn.disabled = false;
    })
    .catch(() => {
      modelSelect.innerHTML = '<option value="deepseek-v4-flash">deepseek-v4-flash</option><option value="deepseek-v4-pro">deepseek-v4-pro</option><option value="deepseek-chat">deepseek-chat</option>';
      btn.disabled = false;
    });
}

async function enhancePrompt() {
  const prompt = document.getElementById('ai-prompt').value.trim();
  if (!prompt) {
    showStatus('Enter a prompt first', 'error');
    return;
  }

  if (!apiKey) {
    showStatus('No API key available — check LLM credentials', 'error');
    return;
  }

  const model = document.getElementById('ai-model').value;
  if (!model) {
    showStatus('No model selected', 'error');
    return;
  }

  setLoading(true);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
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
  btn.textContent = loading ? '    Enhancing...' : '✨ AI Enhance';
  textarea.disabled = loading;
}

function showStatus(msg, type) {
  const el = document.getElementById('ai-status');
  el.textContent = msg;
  el.className = 'ai-status ' + type;
}
