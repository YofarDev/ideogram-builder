# AI Prompt Enhancer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI prompt enhancer that transforms natural language into complete Ideogram JSON with bounding boxes, style descriptions, and color palettes.

**Architecture:** New `src/ai-enhancer.js` module calls DeepSeek API (OpenAI-compatible) from the browser. API key stored in localStorage. Response populates form fields via existing `state:loaded` event. New prompt section in HTML between canvas and action buttons.

**Tech Stack:** Vanilla JS, DeepSeek API (OpenAI-compatible), localStorage

---

### Task 1: Add AI enhancer section to HTML + CSS

**Files:**
- Modify: `index.html` (add prompt section + button + API key input + CSS)

**Step 1: Add the HTML section**

Insert after the canvas container (`.canvas-container` div) and before the `.action-row` div:

```html
<div class="ai-section">
  <div class="ai-header">
    <span class="ai-label">AI Prompt</span>
    <div class="ai-key-row">
      <input type="password" id="ai-api-key" placeholder="sk-..." value="">
      <label for="ai-api-key" class="ai-key-label">API Key</label>
    </div>
  </div>
  <textarea id="ai-prompt" rows="3" placeholder="Describe the image you want to create... e.g. 'A serene mountain lake at sunset with pine trees framing the shore, golden light reflecting on water'"></textarea>
  <div class="ai-actions">
    <button id="btn-ai-enhance" class="btn btn-primary">✨ AI Enhance</button>
    <span id="ai-status" class="ai-status"></span>
  </div>
</div>
```

**Step 2: Add CSS**

Add before the `/* Action row */` comment:

```css
/* AI Prompt Section */
.ai-section {
  background: rgba(26, 23, 20, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  animation: fadeSlideUp 0.4s ease-out 0.18s both;
}

.ai-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.ai-label {
  font-family: var(--font-display);
  font-size: 14px;
  color: var(--text);
}

.ai-key-row {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-key-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  white-space: nowrap;
}

#ai-api-key {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  width: 180px;
  outline: none;
  transition: border-color 0.2s;
}

#ai-api-key:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

#ai-prompt {
  width: 100%;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  outline: none;
  resize: vertical;
  min-height: 64px;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

#ai-prompt:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

#ai-prompt::placeholder {
  color: var(--text-dim);
  font-style: italic;
}

#ai-prompt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

#btn-ai-enhance {
  padding: 8px 20px;
  font-size: 13px;
}

#btn-ai-enhance:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ai-status {
  font-size: 12px;
  color: var(--text-muted);
  transition: color 0.2s;
}

.ai-status.error {
  color: var(--danger);
}

.ai-status.success {
  color: var(--accent);
}
```

**Step 3: Verify HTML renders without errors**

Run: `python3 -m http.server 8080 &` and open browser to check the AI section appears correctly styled.

---

### Task 2: Create `src/ai-enhancer.js`

**Files:**
- Create: `src/ai-enhancer.js`

**Step 1: Write the module**

```js
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

export function initAIEnhancer() {
  const keyInput = document.getElementById('ai-api-key');
  const savedKey = localStorage.getItem('ai_api_key') || '';
  keyInput.value = savedKey;

  keyInput.addEventListener('change', () => {
    localStorage.setItem('ai_api_key', keyInput.value);
  });

  document.getElementById('btn-ai-enhance').addEventListener('click', enhancePrompt);
}

async function enhancePrompt() {
  const prompt = document.getElementById('ai-prompt').value.trim();
  if (!prompt) {
    showStatus('Enter a prompt first', 'error');
    return;
  }

  const apiKey = document.getElementById('ai-api-key').value.trim();
  if (!apiKey) {
    showStatus('Enter your DeepSeek API key first', 'error');
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
        model: 'deepseek-v4-flash',
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
```

**Step 2: Verify syntax**

Run: `node --check src/ai-enhancer.js`
Expected: No output (success)

---

### Task 3: Wire module in `src/app.js`

**Files:**
- Modify: `src/app.js`

**Step 1: Add import and init call**

Add import at top:
```js
import { initAIEnhancer } from './ai-enhancer.js';
```

Add init call after other init calls:
```js
initAIEnhancer();
```

**Step 2: Verify syntax**

Run: `node --check src/app.js`
Expected: No output (success)

---

### Task 4: End-to-end verification

**Step 1: Serve the app**

Run: `python3 -m http.server 8080 &`

**Step 2: Manual test**
1. Open `http://localhost:8080`
2. Verify AI section appears between canvas and action buttons
3. Enter your DeepSeek API key (should persist on reload)
4. Type a prompt like "A cyberpunk city at night with neon signs"
5. Click "✨ AI Enhance"
6. Verify: button shows "Enhancing..." during request
7. On success: form fields populated, canvas has bounding boxes, JSON textarea filled, status shows green "Prompt enhanced successfully"
8. On error: red error message shown

**Step 3: Verify no console errors**

Open browser DevTools console — no JavaScript errors should appear.

---

### Task 5: Commit

```bash
git add src/ai-enhancer.js src/app.js index.html
git commit -m "feat: add AI prompt enhancer with DeepSeek integration"
```
