# Vision Tab — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Vision tab that lets users upload an image, run the img-to-json pipeline, and overlay the resulting JSON boxes on the image in the Editor.

**Architecture:** New "Vision" tab in the tab-bar. New `src/vision.js` module handles upload, calls `POST /api/img-to-json` (new server.py endpoint), emits existing `image:ready` + `state:loaded` events. Reuses existing canvas overlay machinery — same pattern as gallery→editor load.

**Tech Stack:** Vanilla JS, Python http.server (no frameworks), subprocess calls to `uv run` for the MLX-based pipeline.

---

### Task 1: Vision tab HTML + CSS

**Files:**
- Modify: `index.html` (tab button + tab-content + vision styles)

**Step 1: Add the Vision tab button**

After the Gallery tab button in the tab-bar (line ~1606):

```html
<button class="tab-btn" data-tab="vision" role="tab" aria-selected="false" aria-controls="tab-vision" id="tab-btn-vision">Vision</button>
```

**Step 2: Add the Vision tab content**

After the gallery tab-content (before the closing `</div>` of `.left-col`):

```html
<div class="tab-content" id="tab-vision" role="tabpanel" aria-labelledby="tab-btn-vision">
    <div class="ai-section vision-section" id="vision-section">
        <div class="vision-dropzone" id="vision-dropzone">
            <div class="dropzone-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
            <span class="dropzone-label">Drop an image here or click to browse</span>
            <span class="dropzone-hint">Supports JPEG, PNG, WebP</span>
            <input type="file" id="vision-file-input" accept="image/*" hidden>
        </div>
        <div class="vision-preview" id="vision-preview" style="display:none;">
            <img id="vision-preview-img" alt="Selected image">
            <button class="dropzone-link" id="vision-change-btn">Choose a different image</button>
        </div>
        <div class="vision-actions" id="vision-actions">
            <button id="btn-vision-process" class="btn btn-primary" disabled>Process Image</button>
            <span id="vision-status" class="ai-status"></span>
        </div>
    </div>
</div>
```

**Step 3: Add CSS for vision elements**

Add before the responsive section (before `@media`):

```css
.vision-section {
    padding: 28px 24px;
    text-align: center;
}

.vision-dropzone {
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius);
    padding: 40px 20px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.vision-dropzone:hover {
    border-color: rgba(212, 168, 83, 0.35);
    background: rgba(212, 168, 83, 0.03);
}

.vision-dropzone.drag-over {
    border-color: var(--accent);
    background: var(--accent-dim);
}

.vision-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
}

.vision-preview img {
    max-width: 100%;
    max-height: 400px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    object-fit: contain;
}

.vision-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 16px;
}

#btn-vision-process {
    padding: 10px 28px;
    font-size: 14px;
}

#btn-vision-process:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
```

**Step 4: Verify**

Open `index.html` in editor, confirm the new tab appears in the tab-bar.

---

### Task 2: Add `/api/img-to-json` endpoint to server.py

**Files:**
- Modify: `server.py`

**Step 1: Add import and constant at top of server.py**

After line 13 (`PORT = ...`):

```python
IMG_TO_JSON_DIR = Path(__file__).parent / "img-to-json"
```

**Step 2: Update `do_POST` to handle the new endpoint**

In `do_POST`, after the `/api/save-image` block (before the `else`), add:

```python
elif self.path == "/api/img-to-json":
    length = int(self.headers.get("Content-Length", 0))
    body = json.loads(self.rfile.read(length))
    image_b64 = body.get("image", "")
    if not image_b64:
        self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "no image field"}).encode())
        return

    # Decode base64 data URL
    try:
        header, b64 = image_b64.split(",", 1)
    except ValueError:
        self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "invalid data URL"}).encode())
        return

    img_data = base64.b64decode(b64)
    ext = "png" if "image/png" in header else "jpg"

    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False)
    try:
        tmp.write(img_data)
        tmp.close()

        result = subprocess.run(
            ["uv", "run", "--directory", str(IMG_TO_JSON_DIR), "python", "main.py", tmp.name],
            capture_output=True, text=True, timeout=120,
            cwd=str(IMG_TO_JSON_DIR),
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() or f"exit code {result.returncode}"
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": error_msg}).encode())
            return

        json_output = json.loads(result.stdout)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"json": json_output}).encode())
    except subprocess.TimeoutExpired:
        self.send_response(504)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Pipeline timed out after 120 seconds"}).encode())
    except json.JSONDecodeError:
        self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Pipeline returned invalid JSON"}).encode())
    except FileNotFoundError:
        self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"error": "img-to-json pipeline not found. Run `uv sync` in img-to-json/"}).encode())
    finally:
        os.unlink(tmp.name)
```

**Step 3: Verify server.py parses correctly**

Run: `python3 -c "import server"` — should import without errors.

---

### Task 3: Create vision.js module

**Files:**
- Create: `src/vision.js`

**Step 1: Write vision.js**

```javascript
// vision.js — Vision tab: image upload → img-to-json pipeline → overlay on canvas

import { state } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';

export function initVision() {
  const dropzone = document.getElementById('vision-dropzone');
  const fileInput = document.getElementById('vision-file-input');
  const preview = document.getElementById('vision-preview');
  const previewImg = document.getElementById('vision-preview-img');
  const changeBtn = document.getElementById('vision-change-btn');
  const processBtn = document.getElementById('btn-vision-process');
  const statusEl = document.getElementById('vision-status');

  let currentFile = null;

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });

  changeBtn.addEventListener('click', () => fileInput.click());

  processBtn.addEventListener('click', () => processImage());

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file.', 'error');
      return;
    }
    currentFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      preview.style.display = 'flex';
      dropzone.style.display = 'none';
      processBtn.disabled = false;
      statusEl.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB — ready to process`;
    };
    reader.readAsDataURL(file);
  }

  async function processImage() {
    if (!currentFile) return;

    processBtn.disabled = true;
    statusEl.textContent = 'Processing image...';
    dropzone.style.display = 'none';
    preview.style.display = 'flex';

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;

      try {
        const resp = await fetch('/api/img-to-json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl }),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => null);
          throw new Error(errData?.error || `Server error (${resp.status})`);
        }

        const data = await resp.json();
        const jsonStr = JSON.stringify(data.json, null, 2);

        // Set canvas dimensions to match image
        const img = new Image();
        img.onload = () => {
          state.canvas.width = img.width;
          state.canvas.height = img.height;
          document.getElementById('dim-display').textContent = `${img.width} × ${img.height}`;
          const arSelect = document.getElementById('aspect-ratio');
          const val = `${img.width}x${img.height}`;
          if (Array.from(arSelect.options).some(o => o.value === val)) {
            arSelect.value = val;
          }

          emit('canvas:rebuild');
          document.getElementById('json-output').value = jsonStr;
          emit('image:ready', { imageUrl: dataUrl, skipSave: true });
          emit('state:loaded', { json: data.json });

          // Switch to editor tab
          document.getElementById('tab-btn-editor').click();

          statusEl.textContent = '';
          showToast('Image processed successfully.', 'success');
        };
        img.src = dataUrl;

      } catch (err) {
        statusEl.textContent = 'Processing failed';
        showToast(err.message, 'error');
        processBtn.disabled = false;
      }
    };
    reader.readAsDataURL(currentFile);
  }
}
```

---

### Task 4: Wire vision.js in app.js

**Files:**
- Modify: `src/app.js`

**Step 1: Add import and init call**

After line 11 (`import { initLayers } from './layers.js';`):

```javascript
import { initVision } from './vision.js';
```

After line 23 (`initGallery();`):

```javascript
initVision();
```

---

### Task 5: Verify the full flow

1. Start server: `python3 server.py`
2. Open browser to localhost:8080
3. Click the "Vision" tab
4. Drop an image or click to browse
5. See preview, click "Process Image"
6. Wait for pipeline to complete
7. Verify it switches to Editor tab with image overlay + bounding boxes
8. Verify the JSON output area is populated
