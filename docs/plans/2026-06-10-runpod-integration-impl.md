# RunPod Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace local ComfyUI connection with RunPod serverless endpoint, display generated images as canvas overlay with opacity slider.

**Architecture:** New `runpod.js` module replaces `comfyui.js`. Server serves RunPod creds via `/api/config`. Canvas gets an overlay `<img>` element for generated images with z-index above grid but below boxes. Opacity slider in toolbar controls overlay transparency.

**Tech Stack:** Vanilla JS (ES modules), Python server (http.server), RunPod Serverless API

---

### Task 1: Add RunPod config to server.py

**Files:**
- Modify: `server.py`

**Step 1: Update `/api/config` endpoint to include RunPod credentials**

In `server.py`, update the `do_GET` handler to also extract `runpod` from the credentials file and include it in the config response.

Change the config building section (lines 20-24) from:
```python
config = creds.get("deepseek", {})
self.wfile.write(json.dumps(config).encode())
```
To:
```python
config = {}
config["deepseek"] = creds.get("deepseek", {})
config["runpod"] = creds.get("runpod", {})
self.wfile.write(json.dumps(config).encode())
```

**Step 2: Verify**

Run: `python3 server.py &` then `curl http://localhost:8080/api/config` — should return JSON with both `deepseek` and `runpod` keys.

**Step 3: Commit**

```bash
git add server.py
git commit -m "feat: serve runpod config via /api/config"
```

---

### Task 2: Create runpod.js module

**Files:**
- Create: `src/runpod.js`

**Step 1: Write the module**

```js
import { state } from './state.js';
import { emit } from './events.js';

let config = null;

async function getConfig() {
    if (config) return config;
    const resp = await fetch('/api/config');
    const data = await resp.json();
    config = data.runpod || {};
    return config;
}

export async function generateImage() {
    const btn = document.getElementById('btn-generate-image');
    const statusEl = document.getElementById('generate-status');
    const jsonText = document.getElementById('json-output').value;

    if (!jsonText.trim()) {
        alert('Generate or paste a JSON prompt first.');
        return;
    }

    const { api_key, endpoint_id } = await getConfig();
    if (!api_key || !endpoint_id) {
        alert('RunPod not configured. Add runpod.api_key and runpod.endpoint_id to ~/.config/llm-credentials.json');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Generating...';
    if (statusEl) statusEl.textContent = 'Sending request...';
    emit('runpod:loading');

    try {
        const baseUrl = `https://api.runpod.ai/v2/${endpoint_id}`;
        const headers = {
            'Authorization': `Bearer ${api_key}`,
            'Content-Type': 'application/json',
        };

        const submitResp = await fetch(`${baseUrl}/run`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                input: {
                    import_json: jsonText,
                    width: state.canvas.width,
                    height: state.canvas.height,
                }
            }),
        });

        if (!submitResp.ok) {
            const err = await submitResp.text();
            throw new Error(`Submit failed (${submitResp.status}): ${err}`);
        }

        const { id: jobId } = await submitResp.json();

        const result = await pollStatus(baseUrl, headers, jobId, statusEl);

        if (result.status === 'FAILED') {
            throw new Error(result.error || 'Generation failed');
        }

        const images = result.output?.images || [];
        if (images.length === 0) {
            throw new Error('No images returned');
        }

        const imageData = images[0].data;
        const mime = images[0].filename?.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const blob = await fetch(`data:${mime};base64,${imageData}`).then(r => r.blob());
        const imageUrl = URL.createObjectURL(blob);

        emit('image:ready', { imageUrl });
        if (statusEl) statusEl.textContent = '';
    } catch (err) {
        console.error('RunPod error:', err);
        if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        alert('Generation failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Image';
        emit('runpod:done');
    }
}

async function pollStatus(baseUrl, headers, jobId, statusEl) {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;

    while (Date.now() - startTime < timeout) {
        if (statusEl) statusEl.textContent = `Generating... (${Math.round((Date.now() - startTime) / 1000)}s)`;

        const resp = await fetch(`${baseUrl}/status/${jobId}`, { headers });
        if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);

        const result = await resp.json();

        if (result.status === 'COMPLETED') return result;
        if (result.status === 'FAILED') return result;

        await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error('Generation timed out after 5 minutes');
}
```

**Step 2: Commit**

```bash
git add src/runpod.js
git commit -m "feat: add runpod.js module for serverless generation"
```

---

### Task 3: Update index.html — replace generate section, add overlay, add opacity slider

**Files:**
- Modify: `index.html`

**Step 1: Add CSS for canvas overlay**

After the `#canvas-wrapper.empty-state::after` block (around line 282), add:

```css
        #canvas-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: fill;
            pointer-events: none;
            z-index: 1;
            opacity: 0.8;
            display: none;
        }

        #canvas-overlay.visible {
            display: block;
        }

        .bounding-box {
            z-index: 2;
        }

        .resize-handle {
            z-index: 3;
        }
```

**Step 2: Update `.bounding-box` CSS to add z-index**

The `.bounding-box` rule already exists around line 285. Add `z-index: 2;` to it (or the CSS added above will handle it). Same for `.resize-handle` — find its rule and add `z-index: 3;`.

Actually the CSS blocks added in Step 1 set z-index on `.bounding-box` and `.resize-handle`. But since the original CSS rules also define these selectors, the z-index should be added to the existing rules instead to avoid conflicts. Find `.bounding-box {` and add `z-index: 2;`. Find `.resize-handle {` and add `z-index: 3;`.

**Step 3: Add overlay `<img>` inside canvas-wrapper**

Change:
```html
<div id="canvas-wrapper"></div>
```
To:
```html
<div id="canvas-wrapper"><img id="canvas-overlay"></div>
```

**Step 4: Replace generate section (lines 911-925)**

Replace the entire `<div class="generate-section">...</div>` with:

```html
            <div class="generate-section">
                <div style="display:flex;align-items:center;gap:10px;">
                    <button id="btn-generate-image" class="btn btn-primary" style="flex:1;">Generate Image</button>
                    <span id="generate-status" style="font-size:12px;color:var(--text-dim);"></span>
                </div>
            </div>
```

This removes the seed slider, API URL input, and `#image-view` img.

**Step 5: Add opacity slider to toolbar**

In the toolbar section, after `<span class="dim-display" id="dim-display">...</span>` (line 879) and before the Reset button, add:

```html
                <div class="ar-group" id="opacity-group" style="display:none;">
                    <label>Overlay</label>
                    <input type="range" id="overlay-opacity" min="0" max="100" value="80" style="width:70px;">
                </div>
```

The opacity group starts hidden — it shows when an image is loaded.

**Step 6: Remove old generate-section CSS that's no longer needed**

Remove the `#image-view` CSS block (lines 538-546). Keep `.generate-section` and `.input-row` CSS (still used).

**Step 7: Commit**

```bash
git add index.html
git commit -m "feat: replace ComfyUI section with RunPod generate, add canvas overlay + opacity slider"
```

---

### Task 4: Update canvas.js — overlay handling

**Files:**
- Modify: `src/canvas.js`

**Step 1: Update `image:ready` handler**

In `initCanvasEvents()`, replace the `image:ready` listener (lines 201-205):

From:
```js
  on('image:ready', ({ imageUrl }) => {
    canvas.style.backgroundImage = `url("${imageUrl}")`;
    canvas.style.backgroundSize = 'cover';
    document.getElementById('image-view').src = imageUrl;
  });
```

To:
```js
  const overlay = document.getElementById('canvas-overlay');
  const opacityGroup = document.getElementById('opacity-group');

  on('image:ready', ({ imageUrl }) => {
    overlay.src = imageUrl;
    overlay.classList.add('visible');
    opacityGroup.style.display = 'flex';
  });
```

**Step 2: Clear overlay on canvas reset**

In `initCanvas()` (around line 31-32), after clearing `canvas.style.backgroundImage`, also clear the overlay:

After:
```js
  canvas.style.backgroundImage = '';
  canvas.style.backgroundSize = '';
```

Add:
```js
  const overlay = document.getElementById('canvas-overlay');
  if (overlay) {
    overlay.src = '';
    overlay.classList.remove('visible');
  }
  const opacityGroup = document.getElementById('opacity-group');
  if (opacityGroup) opacityGroup.style.display = 'none';
```

**Step 3: Wire opacity slider**

In `initCanvasEvents()`, after the overlay setup, add:

```js
  const opacitySlider = document.getElementById('overlay-opacity');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', () => {
      overlay.style.opacity = opacitySlider.value / 100;
    });
  }
```

**Step 4: Commit**

```bash
git add src/canvas.js
git commit -m "feat: canvas overlay image with opacity slider"
```

---

### Task 5: Update app.js — swap comfyui for runpod

**Files:**
- Modify: `src/app.js`

**Step 1: Replace import**

Change line 6:
```js
import { generateImage } from './comfyui.js';
```
To:
```js
import { generateImage } from './runpod.js';
```

**Step 2: Commit**

```bash
git add src/app.js
git commit -m "feat: switch app.js to runpod module"
```

---

### Task 6: Delete old ComfyUI modules

**Files:**
- Delete: `src/comfyui.js`
- Delete: `src/comfyui-template.js`

**Step 1: Delete files**

```bash
rm src/comfyui.js src/comfyui-template.js
```

**Step 2: Commit**

```bash
git add -u
git commit -m "chore: remove comfyui.js and comfyui-template.js"
```

---

### Task 7: Update settings.js — remove seed slider handler

**Files:**
- Modify: `src/settings.js`

**Step 1: Remove seed slider handler**

The `initSettings()` function sets up the `#r-seed` range slider. Remove that block (it sets `#r-seed-value` text on input). The seed is no longer user-controlled — the RunPod handler manages it.

Find and remove the code that initializes the `#r-seed` slider event listener.

**Step 2: Commit**

```bash
git add src/settings.js
git commit -m "chore: remove seed slider handler from settings"
```

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update module map and event catalog**

Replace `comfyui.js` row with `runpod.js` in the module map. Remove `comfyui-template.js` row. Add `runpod:loading` and `runpod:done` events to the event catalog.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with runpod module"
```

---

### Task 9: Verify end-to-end

**Step 1: Start server**

```bash
python3 server.py
```

**Step 2: Open browser at http://localhost:8080**

**Step 3: Test flow**
1. Draw a bounding box on the canvas
2. Add a description in Box Properties
3. Click "Generate JSON Prompt"
4. Click "Generate Image"
5. Verify: loading state shows, image appears as canvas overlay, boxes visible on top
6. Adjust opacity slider — verify overlay opacity changes
7. Click "Reset Canvas" — verify overlay clears and opacity slider hides

**Step 4: Push all commits**

```bash
git push
```
