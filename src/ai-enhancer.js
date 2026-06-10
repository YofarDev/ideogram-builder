import { emit } from './events.js';

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

let fullConfig = null;

export function initAIEnhancer() {
  const modelSelect = document.getElementById('ai-model');
  const btn = document.getElementById('btn-ai-enhance');

  btn.disabled = true;
  btn.addEventListener('click', enhancePrompt);

  fetch('/api/config')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
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

      if (firstModel) modelSelect.value = firstModel;
      btn.disabled = false;
    })
    .catch(() => {
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

  const baseUrl = p.base_url || 'https://api.deepseek.com/v1';
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
