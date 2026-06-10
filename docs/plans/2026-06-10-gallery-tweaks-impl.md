# UI Tweaks & Gallery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move AI prompt to top, load all LLM providers, add gallery tab with thumbnails, persist aspect ratio.

**Architecture:** New `gallery.js` module manages tab state + localStorage history. `ai-enhancer.js` updated to enumerate all providers. `settings.js` persists aspect ratio.

**Tech Stack:** Vanilla JS, localStorage, offscreen Canvas for thumbnails

---

### Task 1: Move AI Prompt section above canvas

**Files:**
- Modify: `index.html`

**Step 1: Reorder HTML**

In `index.html`, move the entire `<div class="ai-section">...</div>` block (currently between canvas-container and action-row) to ABOVE `<div class="canvas-container">`.

Current order in `<div class="left-col">`:
1. canvas-container
2. ai-section
3. action-row
4. json-output
5. generate-section

New order:
1. ai-section
2. canvas-container
3. action-row
4. json-output
5. generate-section

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat: move AI prompt section above canvas"
```

---

### Task 2: Load all models from all providers

**Files:**
- Modify: `src/ai-enhancer.js`

**Step 1: Rewrite model loading to enumerate all providers**

Replace the model loading section in `initAIEnhancer()`. Instead of only reading `config.deepseek`, iterate all provider keys and build `<optgroup>` sections.

New `initAIEnhancer()`:

```js
export function initAIEnhancer() {
  const modelSelect = document.getElementById('ai-model');
  const btn = document.getElementById('btn-ai-enhance');

  btn.disabled = true;
  btn.addEventListener('click', enhancePrompt);

  fetch('/api/config')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
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
```

**Step 2: Update `enhancePrompt()` to use provider-specific base_url and api_key**

Replace the existing `enhancePrompt` function. The key change: parse `provider::model` from the select value, look up the provider config, use its `base_url` and `api_key`.

Add a module-level variable to store the full config:

```js
let fullConfig = null;
```

Update the fetch handler to store it:
```js
    .then(config => {
      fullConfig = config;
      // ... rest of model loading
    })
```

Update `enhancePrompt()`:

```js
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
```

Remove the old `let apiKey = '';` variable (replaced by `fullConfig`).

**Step 3: Commit**

```bash
git add src/ai-enhancer.js
git commit -m "feat: load all LLM providers with optgroup model selector"
```

---

### Task 3: Add tab bar HTML + CSS

**Files:**
- Modify: `index.html`

**Step 1: Add tab bar CSS**

After the `.ai-section` CSS block (around line 372), add:

```css
        .tab-bar {
            display: flex;
            gap: 0;
            border-bottom: 1px solid var(--border);
            margin-bottom: 12px;
        }

        .tab-btn {
            flex: 1;
            padding: 10px 16px;
            font-family: var(--font-display);
            font-size: 13px;
            font-weight: 500;
            color: var(--text-muted);
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            transition: color 0.2s, border-color 0.2s;
        }

        .tab-btn:hover {
            color: var(--text);
        }

        .tab-btn.active {
            color: var(--accent);
            border-bottom-color: var(--accent);
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        .gallery-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 12px;
        }

        .gallery-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            overflow: hidden;
            cursor: pointer;
            transition: border-color 0.2s, transform 0.15s;
        }

        .gallery-card:hover {
            border-color: var(--accent);
            transform: translateY(-2px);
        }

        .gallery-card img {
            width: 100%;
            aspect-ratio: 1;
            object-fit: cover;
            display: block;
        }

        .gallery-card-info {
            padding: 8px 10px;
        }

        .gallery-card-date {
            font-size: 10px;
            color: var(--text-dim);
            margin-bottom: 3px;
        }

        .gallery-card-prompt {
            font-size: 11px;
            color: var(--text-muted);
            line-height: 1.4;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }

        .gallery-empty {
            text-align: center;
            padding: 40px 20px;
            color: var(--text-dim);
            font-style: italic;
        }

        .gallery-card-delete {
            float: right;
            background: none;
            border: none;
            color: var(--text-dim);
            cursor: pointer;
            font-size: 14px;
            padding: 0 2px;
            line-height: 1;
        }

        .gallery-card-delete:hover {
            color: var(--danger);
        }
```

**Step 2: Wrap left-col content in tab structure**

Change the `<div class="left-col">` contents to:

```html
        <div class="left-col">
            <div class="tab-bar">
                <button class="tab-btn active" data-tab="editor">Editor</button>
                <button class="tab-btn" data-tab="gallery">Gallery</button>
            </div>

            <div class="tab-content active" id="tab-editor">
                <div class="ai-section">
                    ... (ai-section stays here) ...
                </div>

                <div class="canvas-container">
                    ... (canvas stays here) ...
                </div>

                <div class="action-row">...</div>
                <textarea id="json-output">...</textarea>
                <div class="generate-section">...</div>
            </div>

            <div class="tab-content" id="tab-gallery">
                <div id="gallery-container">
                    <div class="gallery-empty" id="gallery-empty">No generations yet. Generate your first image!</div>
                    <div class="gallery-grid" id="gallery-grid"></div>
                </div>
            </div>
        </div>
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add tab bar HTML/CSS for editor/gallery"
```

---

### Task 4: Create gallery.js module

**Files:**
- Create: `src/gallery.js`

**Step 1: Write the module**

```js
import { emit } from './events.js';
import { on } from './events.js';

const STORAGE_KEY = 'ideogram_history';
const MAX_ITEMS = 30;

export function initGallery() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    renderGallery();

    on('image:ready', ({ imageUrl }) => {
        saveToGallery(imageUrl);
    });
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
    if (tab === 'gallery') renderGallery();
}

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveHistory(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

function saveToGallery(imageUrl) {
    const promptJson = document.getElementById('json-output').value;
    const aspectRatio = document.getElementById('aspect-ratio').value;
    const selected = document.getElementById('ai-model').value;
    const [provider, model] = (selected || '').split('::');

    createThumbnail(imageUrl, (thumbnail) => {
        const items = getHistory();
        items.unshift({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            timestamp: Date.now(),
            thumbnail,
            prompt_json: promptJson,
            aspect_ratio: aspectRatio,
            provider: provider || '',
            model: model || '',
        });
        saveHistory(items);
    });
}

function createThumbnail(imageUrl, callback) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const maxW = 200;
        const scale = maxW / img.width;
        const canvas = document.createElement('canvas');
        canvas.width = maxW;
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => callback('');
    img.src = imageUrl;
}

function renderGallery() {
    const grid = document.getElementById('gallery-grid');
    const empty = document.getElementById('gallery-empty');
    const items = getHistory();

    grid.innerHTML = '';

    if (items.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'gallery-card';

        const date = new Date(item.timestamp);
        const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        let desc = '';
        try {
            const j = JSON.parse(item.prompt_json);
            desc = j.high_level_description || item.prompt_json.slice(0, 80);
        } catch {
            desc = item.prompt_json?.slice(0, 80) || 'No prompt';
        }

        card.innerHTML = `
            ${item.thumbnail ? `<img src="${item.thumbnail}" alt="Generation">` : ''}
            <div class="gallery-card-info">
                <button class="gallery-card-delete" data-id="${item.id}" title="Delete">&times;</button>
                <div class="gallery-card-date">${dateStr}</div>
                <div class="gallery-card-prompt">${escapeHtml(desc)}</div>
            </div>
        `;

        card.querySelector('.gallery-card-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteItem(item.id);
        });

        card.addEventListener('click', () => loadItem(item));

        grid.appendChild(card);
    });
}

function deleteItem(id) {
    const items = getHistory().filter(i => i.id !== id);
    saveHistory(items);
    renderGallery();
}

function loadItem(item) {
    if (item.aspect_ratio) {
        const sel = document.getElementById('aspect-ratio');
        if (sel.querySelector(`option[value="${item.aspect_ratio}"]`)) {
            sel.value = item.aspect_ratio;
            sel.dispatchEvent(new Event('change'));
        }
    }

    if (item.prompt_json) {
        document.getElementById('json-output').value = item.prompt_json;
        try {
            const json = JSON.parse(item.prompt_json);
            emit('state:loaded', { json });
        } catch {}
    }

    switchTab('editor');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
```

**Step 2: Commit**

```bash
git add src/gallery.js
git commit -m "feat: add gallery.js — tab switching, localStorage history, thumbnails"
```

---

### Task 5: Wire gallery.js into app.js

**Files:**
- Modify: `src/app.js`

**Step 1: Add import and init call**

Add import:
```js
import { initGallery } from './gallery.js';
```

Add init call (after other inits):
```js
initGallery();
```

**Step 2: Commit**

```bash
git add src/app.js
git commit -m "feat: wire gallery module into app"
```

---

### Task 6: Persist aspect ratio

**Files:**
- Modify: `src/settings.js`

**Step 1: Save aspect ratio on change**

In the aspect ratio change handler, add localStorage save:

```js
  document.getElementById('aspect-ratio').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    state.canvas.width = w;
    state.canvas.height = h;
    document.getElementById('dim-display').textContent = `${w} × ${h}`;
    localStorage.setItem('ideogram_aspect_ratio', e.target.value);
    emit('canvas:rebuild');
  });
```

**Step 2: Restore aspect ratio on init**

At the end of `initSettings()`, after `setPhotoArtMode(MODE_ARTSTYLE)`, add:

```js
  const saved = localStorage.getItem('ideogram_aspect_ratio');
  if (saved) {
    const sel = document.getElementById('aspect-ratio');
    if (sel.querySelector(`option[value="${saved}"]`)) {
      sel.value = saved;
      const [w, h] = saved.split('x').map(Number);
      state.canvas.width = w;
      state.canvas.height = h;
      document.getElementById('dim-display').textContent = `${w} × ${h}`;
    }
  }
```

**Step 3: Commit**

```bash
git add src/settings.js
git commit -m "feat: persist last aspect ratio in localStorage"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add gallery.js to module map and event catalog**

In the module map table, add:
```
| `gallery.js` | Tab switching, history grid, thumbnail creation, localStorage | events |
```

In the event catalog, add:
```
| `image:ready` | ... | runpod, png-import | canvas (overlay), gallery (save) |
```

In the editing guide, add:
```
- **Editing gallery/history?** → `src/gallery.js`
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with gallery module"
```

---

### Task 8: Verify end-to-end

**Step 1: Start server**

```bash
python3 server.py
```

**Step 2: Open browser at http://localhost:8080**

**Step 3: Test**
1. AI prompt section is above the canvas
2. Model selector shows optgroups for DeepSeek, Google, Mimo (OpenRouter has empty models array)
3. Switch aspect ratio → reload page → aspect ratio persists
4. Generate an image → gallery tab shows the thumbnail
5. Click gallery card → switches to editor tab with prompt loaded
6. Delete gallery card → removed from grid

**Step 4: Push all commits**

```bash
git push
```
