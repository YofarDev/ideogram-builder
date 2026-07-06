# JSON Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users feed the current image + JSON back into a vision model (local or cloud) and accept/reject critique suggestions individually via a right-side dock panel in the Editor tab.

**Architecture:** New `src/audit.js` module owns the panel + accept/reject flow. New `img-to-json/prompts/json_audit.txt` + `--audit-mode` flag in `main.py` + `/api/audit-json` endpoint handle the backend. Reuses `_cloud_vlm_chat`, `_run_pipeline_subprocess`, `populateLLMVisionModels`, and the existing `state:loaded` event — no new infrastructure.

**Tech Stack:** Vanilla JS (ES modules, vitest + jsdom for tests), Python (server.py + img-to-json/main.py), no new dependencies.

**Design doc:** `docs/plans/2026-07-06-json-audit-design.md`

---

### Task 1: Audit prompt file

**Files:**
- Create: `img-to-json/prompts/json_audit.txt`

**Step 1: Write the prompt**

`img-to-json/prompts/json_audit.txt`:

```text
You are auditing an existing image caption against the image it describes.
Your job is to find what the caption got wrong or missed, and emit a list of
suggestions the user will accept or reject one by one.

The current caption JSON is provided inline in the user message.

Return ONLY a raw JSON object (no markdown fences, no prose) of this shape:

{
  "suggestions": [
    {
      "type": "add_element",
      "reason": "<one sentence: what's missing and where>",
      "element": {
        "name": "<singular concrete noun phrase>",
        "desc": "<30-60 words, visually grounded>",
        "has_text": false,
        "visible_text": null,
        "bbox": [y1, x1, y2, x2]
      }
    },
    {
      "type": "update_element",
      "reason": "<one sentence: what's weak or wrong>",
      "index": <0-based index into compositional_deconstruction.elements>,
      "patch": {"desc": "<30-60 words>"}
    },
    {
      "type": "update_field",
      "reason": "<one sentence: what's wrong>",
      "field": "<dot-path: background | high_level_description | style.medium | style.aesthetics | style.lighting | style.photo_or_art>",
      "value": "<proposed new value>"
    }
  ]
}

Rules:
- Coordinates are normalized [y1, x1, y2, x2] in [0, 1], yxyx order (top-left to bottom-right).
- Only suggest changes that are visually grounded in the image. No hallucinations.
- For add_element, follow the same name/desc rules as object_listing.txt:
  singular concrete nouns, no plurals or group nouns, one distinct region per entry.
- For text elements, read literal characters into visible_text and set has_text: true;
  desc must describe visual treatment only, never quote the literal text.
- update_element.patch may include desc and/or visible_text. Never include name or bbox.
- update_field.field MUST be one of the dot-paths listed above.
- Suggest at most ~10 things. Quality over quantity. If the caption is already
  accurate and complete, return {"suggestions": []}.
- Do NOT suggest removing elements. Do NOT rewrite the whole JSON. One mutation per suggestion.
```

**Step 2: Commit**

```bash
git add img-to-json/prompts/json_audit.txt
git commit -m "feat: add json_audit prompt for image+json critique"
```

---

### Task 2: Pure mutation helpers + validators (TDD)

**Files:**
- Create: `src/__tests__/audit.test.js`
- Create: `src/audit.js` (helpers only — UI added in Task 6)

**Step 1: Write the failing tests**

`src/__tests__/audit.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { validateSuggestion, applyAddElement, applyUpdateElement, applyUpdateField } from '../audit.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const baseJson = () => ({
  high_level_description: 'a scene',
  background: 'a wall',
  style: { medium: 'photograph', aesthetics: 'minimal', lighting: 'soft', photo_or_art: '50mm' },
  compositional_deconstruction: { elements: [
    { name: 'cup', desc: 'a red cup', has_text: false, visible_text: null, bbox: [0.1, 0.1, 0.3, 0.3] },
    { name: 'book', desc: 'a blue book', has_text: false, visible_text: null, bbox: [0.4, 0.4, 0.6, 0.6] },
  ] },
})

describe('audit helpers', () => {
  it('validateSuggestion accepts a well-formed add_element', () => {
    const s = { type: 'add_element', reason: 'x', element: { name: 'y', desc: 'z', has_text: false, visible_text: null, bbox: [0, 0, 0.1, 0.1] } }
    expect(validateSuggestion(s)).toEqual(s)
  })

  it('validateSuggestion rejects unknown type', () => {
    expect(validateSuggestion({ type: 'explode', reason: 'x' })).toBeNull()
  })

  it('validateSuggestion rejects add_element with missing bbox', () => {
    expect(validateSuggestion({ type: 'add_element', reason: 'x', element: { name: 'y', desc: 'z' } })).toBeNull()
  })

  it('validateSuggestion rejects add_element with bad bbox length', () => {
    expect(validateSuggestion({ type: 'add_element', reason: 'x', element: { name: 'y', desc: 'z', bbox: [0, 0, 1] } })).toBeNull()
  })

  it('validateSuggestion accepts update_element with desc patch', () => {
    const s = { type: 'update_element', index: 0, reason: 'x', patch: { desc: 'better' } }
    expect(validateSuggestion(s)).toEqual(s)
  })

  it('validateSuggestion rejects update_element with non-integer index', () => {
    expect(validateSuggestion({ type: 'update_element', index: 'a', reason: 'x', patch: { desc: 'y' } })).toBeNull()
  })

  it('validateSuggestion accepts update_field with allowed dot-path', () => {
    const s = { type: 'update_field', field: 'style.lighting', reason: 'x', value: 'hard' }
    expect(validateSuggestion(s)).toEqual(s)
  })

  it('validateSuggestion rejects update_field with unknown field', () => {
    expect(validateSuggestion({ type: 'update_field', field: 'mood', reason: 'x', value: 'happy' })).toBeNull()
  })

  it('applyAddElement pushes a new element', () => {
    const json = baseJson()
    const s = { type: 'add_element', element: { name: 'plate', desc: 'a plate', has_text: false, visible_text: null, bbox: [0.7, 0.7, 0.9, 0.9] } }
    applyAddElement(json, s)
    expect(json.compositional_deconstruction.elements).toHaveLength(3)
    expect(json.compositional_deconstruction.elements[2].name).toBe('plate')
  })

  it('applyUpdateElement merges patch into the indexed element', () => {
    const json = baseJson()
    applyUpdateElement(json, { index: 1, patch: { desc: 'a navy book' } })
    expect(json.compositional_deconstruction.elements[1].desc).toBe('a navy book')
    expect(json.compositional_deconstruction.elements[1].name).toBe('book')
  })

  it('applyUpdateElement throws on stale index (out of bounds)', () => {
    const json = baseJson()
    expect(() => applyUpdateElement(json, { index: 99, patch: { desc: 'x' } })).toThrow(/stale/i)
  })

  it('applyUpdateField sets a top-level field', () => {
    const json = baseJson()
    applyUpdateField(json, { field: 'background', value: 'a brick wall' })
    expect(json.background).toBe('a brick wall')
  })

  it('applyUpdateField sets a nested style field via dot-path', () => {
    const json = baseJson()
    applyUpdateField(json, { field: 'style.lighting', value: 'hard sun' })
    expect(json.style.lighting).toBe('hard sun')
  })

  it('applyUpdateField throws on missing dot-path', () => {
    const json = baseJson()
    expect(() => applyUpdateField(json, { field: 'style.mood', value: 'x' })).toThrow(/stale|missing/i)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/__tests__/audit.test.js
```

Expected: FAIL — `Cannot find module '../audit.js'`.

**Step 3: Implement the helpers**

`src/audit.js` (top of file — UI orchestration appended in Task 6):

```javascript
// audit.js — image+JSON critique: fetch suggestions, render panel, apply accepts.
// Pure helpers (this task) + UI orchestration (Task 6).

const ALLOWED_FIELDS = new Set([
  'background',
  'high_level_description',
  'style.medium',
  'style.aesthetics',
  'style.lighting',
  'style.photo_or_art',
])

function isValidBbox(b) {
  return Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number' && Number.isFinite(n))
}

export function validateSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const { type, reason } = raw
  if (typeof reason !== 'string') return null
  if (type === 'add_element') {
    const el = raw.element
    if (!el || typeof el !== 'object') return null
    if (typeof el.name !== 'string' || typeof el.desc !== 'string') return null
    if (!isValidBbox(el.bbox)) return null
    return { type, reason: String(reason), element: { ...el, has_text: !!el.has_text, visible_text: el.visible_text ?? null } }
  }
  if (type === 'update_element') {
    if (!Number.isInteger(raw.index) || raw.index < 0) return null
    if (!raw.patch || typeof raw.patch !== 'object') return null
    return { type, reason: String(reason), index: raw.index, patch: { ...raw.patch } }
  }
  if (type === 'update_field') {
    if (!ALLOWED_FIELDS.has(raw.field)) return null
    if (typeof raw.value !== 'string') return null
    return { type, reason: String(reason), field: raw.field, value: raw.value }
  }
  return null
}

export function applyAddElement(json, suggestion) {
  json.compositional_deconstruction ||= { elements: [] }
  json.compositional_deconstruction.elements ||= []
  json.compositional_deconstruction.elements.push(suggestion.element)
}

export function applyUpdateElement(json, suggestion) {
  const els = json?.compositional_deconstruction?.elements
  if (!Array.isArray(els) || suggestion.index >= els.length) {
    throw new Error('stale: element index out of range; re-run audit')
  }
  Object.assign(els[suggestion.index], suggestion.patch)
}

export function applyUpdateField(json, suggestion) {
  const path = suggestion.field.split('.')
  let cursor = json
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof cursor[path[i]] !== 'object' || cursor[path[i]] === null) {
      throw new Error(`stale: field path ${suggestion.field} missing; re-run audit`)
    }
    cursor = cursor[path[i]]
  }
  const leaf = path[path.length - 1]
  if (!(leaf in cursor)) {
    throw new Error(`stale: field path ${suggestion.field} missing; re-run audit`)
  }
  cursor[leaf] = suggestion.value
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/__tests__/audit.test.js
```

Expected: PASS — 14 tests.

**Step 5: Commit**

```bash
git add src/audit.js src/__tests__/audit.test.js
git commit -m "feat: pure validators + mutation helpers for json audit"
```

---

### Task 3: `--audit-mode` flag in main.py

**Files:**
- Modify: `img-to-json/main.py`

**Step 1: Add CLI flags + dispatch**

In `img-to-json/main.py`, add the two flags to the `argparse` block (alongside `--bbox-only`):

```python
    parser.add_argument(
        "--audit-mode",
        action="store_true",
        help="Audit mode: given --json-file with current caption, emit critique suggestions JSON",
    )
    parser.add_argument(
        "--json-file",
        type=str,
        help="Path to existing caption JSON (for --audit-mode)",
    )
```

Add the early dispatch right after the existing `--bbox-only` early return (around the `if args.bbox_only:` block):

```python
    if args.audit_mode:
        _run_audit_mode(args)
        return
```

Append the new function at the bottom of `main.py` (alongside `_run_bbox_only`):

```python
def _run_audit_mode(args):
    """Subprocess mode: load local VLM, run ONE call with json_audit.txt prompt,
    print suggestions JSON to stdout. No SAM, no build_json."""
    import json as _json
    from PIL import Image
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template
    from models.local_vlm_loader import get_local_vlm
    from steps.local_vlm_analysis import _parse_json

    if not args.json_file:
        print(_json.dumps({"error": "audit-mode requires --json-file"}))
        sys.exit(2)

    image = Image.open(args.image_path).convert("RGB")
    existing_caption = _json.loads(Path(args.json_file).read_text())

    prompt_dir = Path(__file__).resolve().parent / "prompts"
    system_prompt = (prompt_dir / "json_audit.txt").read_text().strip()
    user_text = "Audit this caption against the image. Current JSON:\n" + _json.dumps(existing_caption)

    w, h = image.size
    scale = 512 / max(w, h)
    if scale < 1.0:
        image = image.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

    model, processor = get_local_vlm(args.model)
    config = model.config
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]
    prompt = apply_chat_template(processor, config, messages, num_images=1)

    retry_text = "Return ONLY a raw JSON object. No markdown fences, no prose."
    result = None
    for attempt in range(2):
        result = generate(model, processor, prompt, image=image, max_tokens=4096)
        parsed = _parse_json(result.text)
        if parsed is not None:
            print(_json.dumps(parsed))
            return
        # retry once with stricter instruction
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text + "\n\n" + retry_text},
        ]
        prompt = apply_chat_template(processor, config, messages, num_images=1)

    print(_json.dumps({"error": "VLM did not return JSON after 2 attempts", "raw": result.text[:500]}))
    sys.exit(1)
```

**Step 2: Smoke-test the CLI shape**

```bash
uv run --directory img-to-json python main.py --help | grep -E "(audit-mode|json-file)"
```

Expected: both flags appear in help text.

**Step 3: (Optional, if local Qwen is installed) Manual end-to-end**

```bash
uv run --directory img-to-json python main.py img-to-json/debug/test_input.jpg --audit-mode --json-file img-to-json/example_prompt.json -v
```

Expected: JSON with a `suggestions` array (or `{"error": ...}` if Qwen unavailable).

**Step 4: Commit**

```bash
git add img-to-json/main.py
git commit -m "feat: --audit-mode flag routes to one-shot local VLM critique call"
```

---

### Task 4: `/api/audit-json` endpoint

**Files:**
- Modify: `server.py`

**Step 1: Add `do_POST` branch**

Find the existing `/api/img-to-json` branch in `do_POST` (around the section that ends with `self._handle_vision_api(...)` / `self._handle_vision_split(...)`). Add a sibling branch **before** the `else: self._send_json(404, ...)`:

```python
        elif self.path == "/api/audit-json":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            image_b64 = body.get("image", "")
            existing_json = body.get("json", "")
            model = body.get("model", "")
            bbox_format = body.get("bbox_format", "xyxy")

            if not image_b64 or not existing_json or not model:
                self._send_json(400, {"error": "Missing required fields: image, json, model"})
                return
            if _vision_state["proc"] is not None:
                self._send_json(409, {"error": "Another vision job is in flight"})
                return

            try:
                header, b64 = image_b64.split(",", 1)
            except ValueError:
                self._send_json(400, {"error": "invalid data URL"})
                return
            ext = "png" if "image/png" in header else "jpg"

            if model == "local":
                self._handle_audit_local(image_b64, ext, existing_json, body.get("local_model", ""), bbox_format)
            else:
                self._handle_audit_api(model, image_b64, existing_json, bbox_format)
```

**Step 2: Add the two handler methods**

Add these as methods on `Handler` (place them near `_handle_vision_api` / `_handle_vision_split`):

```python
    def _handle_audit_api(self, model, image_b64, existing_json, bbox_format="xyxy"):
        """Cloud audit: one chat call with json_audit prompt + current JSON inline."""
        resolved = self._resolve_cloud_provider(model)
        if resolved is None:
            return
        provider, model_name, base_url, api_key = resolved
        _vlog(f"audit-api: provider={provider} model={model_name}")

        try:
            system_prompt = (IMG_TO_JSON_DIR / "prompts" / "json_audit.txt").read_text().strip()
        except FileNotFoundError:
            self._send_json(500, {"error": "json_audit.txt prompt not found"})
            return

        user_text = "Audit this caption against the image. Current JSON:\n" + existing_json
        try:
            content = self._cloud_vlm_chat(base_url, api_key, model_name, system_prompt, user_text, image_b64)
            parsed = json.loads(content)
        except RuntimeError as e:
            self._send_json(502, {"error": str(e)})
            return
        except json.JSONDecodeError:
            self._send_json(502, {"error": "audit call returned invalid JSON", "detail": content[:500]})
            return

        suggestions = parsed.get("suggestions", []) if isinstance(parsed, dict) else []
        _vlog(f"audit-api: ok, suggestions={len(suggestions)}")
        self._send_json(200, {"suggestions": suggestions})

    def _handle_audit_local(self, image_b64, ext, existing_json, local_model, bbox_format="xyxy"):
        """Local audit: subprocess main.py --audit-mode. SAM never loads."""
        img_data = base64.b64decode(image_b64.split(",", 1)[1] if "," in image_b64 else image_b64)
        import tempfile
        tmp_img = tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False)
        tmp_json = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        try:
            tmp_img.write(img_data); tmp_img.close()
            tmp_json.write(existing_json); tmp_json.close()

            cmd = ["uv", "run", "--directory", str(IMG_TO_JSON_DIR), "python", "main.py",
                   tmp_img.name, "--audit-mode", "--json-file", tmp_json.name,
                   "--bbox-format", bbox_format]
            if local_model:
                cmd.extend(["--model", local_model])

            try:
                # ponytail: reuse the shared subprocess runner; it raises _Cancelled / RuntimeError.
                # We can't use _run_pipeline_subprocess directly because audit JSON shape differs
                # (no [verifier] / [debug_dir] expectations) — but the cancellation/error shape is identical,
                # so accept the unused return values.
                json_output, _verifier, _debug = self._run_pipeline_subprocess(cmd)
            except _Cancelled:
                self._send_json(499, {"error": "Cancelled"})
                return
            except FileNotFoundError:
                self._send_json(500, {"error": "img-to-json pipeline not found"})
                return
            except RuntimeError as e:
                self._send_json(500, {"error": str(e)})
                return
        finally:
            for p in (tmp_img.name, tmp_json.name):
                try: os.unlink(p)
                except OSError: pass

        suggestions = json_output.get("suggestions", []) if isinstance(json_output, dict) else []
        _vlog(f"audit-local: ok, suggestions={len(suggestions)}")
        self._send_json(200, {"suggestions": suggestions})
```

**Step 3: Syntax check**

```bash
python3 -m py_compile server.py && echo "server.py OK"
```

Expected: `server.py OK`.

**Step 4: (Manual) Smoke test the endpoint**

Start server (`python3 server.py`), then from another shell:

```bash
# Cloud path (replace provider::model with one from your config):
curl -s -X POST http://localhost:8080/api/audit-json \
  -H 'Content-Type: application/json' \
  -d '{"image":"data:image/png;base64,iVBORw0KGgo=...","json":"{\"high_level_description\":\"...\"}","model":"openai::gpt-4o"}' | head
```

Expected: `{"suggestions":[...]}` or `{"error":"..."}` with a useful message.

**Step 5: Commit**

```bash
git add server.py
git commit -m "feat: /api/audit-json endpoint (local subprocess + cloud chat dispatch)"
```

---

### Task 5: DOM hooks in index.html

**Files:**
- Modify: `index.html` (editor toolbar + new panel container)

**Step 1: Add the Audit button to the editor toolbar**

Find the existing editor toolbar (where buttons like "Recaption" live — same row as `btn-recaption`). Add a sibling button:

```html
<button id="btn-audit" class="btn" type="button" disabled>Audit JSON</button>
```

**Step 2: Add the panel container**

Find the editor tab container (where the layers panel lives). Add a sibling panel, hidden by default:

```html
<div id="audit-panel" class="audit-panel" hidden>
  <div class="audit-panel-header">
    <span class="audit-panel-title">Audit suggestions</span>
    <select id="audit-model" class="ai-model-select" aria-label="Audit model"></select>
    <button id="btn-audit-close" class="audit-close" type="button" aria-label="Close audit panel">&times;</button>
  </div>
  <div id="audit-suggestions" class="audit-suggestions"></div>
  <div class="audit-panel-footer">
    <button id="btn-audit-accept-all" class="btn" type="button">Accept all</button>
  </div>
</div>
```

**Step 3: Add minimal CSS**

Append to the existing `<style>` block (the file already has shared `.btn` styles — only add audit-specific ones):

```css
.audit-panel {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 360px; background: var(--bg-elevated, #1e1e1e);
  border-left: 1px solid var(--border, #333);
  display: flex; flex-direction: column;
  z-index: 50; box-shadow: -4px 0 16px rgba(0,0,0,0.3);
}
.audit-panel[hidden] { display: none; }
.audit-panel-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px; border-bottom: 1px solid var(--border, #333);
}
.audit-panel-title { font-weight: 600; flex: 1; }
.audit-suggestions { flex: 1; overflow-y: auto; padding: 8px; }
.audit-card {
  border: 1px solid var(--border, #333); border-radius: 6px;
  padding: 10px; margin-bottom: 8px; background: var(--bg, #252525);
}
.audit-card.applied { opacity: 0.5; }
.audit-card.rejected { opacity: 0.4; text-decoration: line-through; }
.audit-card-type { font-size: 11px; text-transform: uppercase; color: var(--accent, #4a9); letter-spacing: 0.5px; }
.audit-card-reason { font-style: italic; color: var(--text-muted, #999); margin: 4px 0; }
.audit-card-diff { font-size: 12px; margin: 6px 0; }
.audit-card-actions { display: flex; gap: 6px; margin-top: 8px; }
.audit-card-error { color: var(--danger, #e55); font-size: 12px; margin-top: 6px; }
.audit-panel-footer { padding: 10px; border-top: 1px solid var(--border, #333); }
```

(Exact CSS variable names may differ — match whatever the codebase already uses. If a variable doesn't exist, fall back to a literal color via the comma default shown above.)

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: audit panel DOM + button shell in editor tab"
```

---

### Task 6: audit.js UI orchestration (TDD)

**Files:**
- Modify: `src/audit.js` (append UI to the helpers from Task 2)
- Modify: `src/__tests__/audit.test.js` (append UI tests)

**Step 1: Extend the test fixture DOM**

At the top of `src/__tests__/audit.test.js`, add a `DOM_HTML` constant and a `beforeEach` that wires up the panel. Replace the existing top of the file (the import block stays, the test block stays — only add DOM setup above the existing `describe`):

```javascript
const DOM_HTML = `
  <button id="btn-audit" disabled></button>
  <div id="audit-panel" hidden>
    <select id="audit-model"><option value="local">local</option></div>
    <button id="btn-audit-close"></button>
    <div id="audit-suggestions"></div>
    <button id="btn-audit-accept-all"></button>
  </div>
  <textarea id="json-output"></textarea>
  <div id="vision-model-row"></div>
`

let auditModule

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ suggestions: [] }) })
  auditModule = await import('../audit.js')
  auditModule.initAudit()
})
```

**Step 2: Write failing UI tests**

Append to the existing `describe('audit helpers', ...)` block (or add a new describe):

```javascript
describe('audit UI', () => {
  const sampleSuggestions = (overrides = {}) => ({
    type: 'add_element',
    reason: 'missing glass',
    element: { name: 'wine glass', desc: 'a glass', has_text: false, visible_text: null, bbox: [0.5, 0.5, 0.6, 0.6] },
    ...overrides,
  })

  function setJsonOutput(json) {
    document.getElementById('json-output').value = JSON.stringify(json)
  }

  function readJsonOutput() {
    return JSON.parse(document.getElementById('json-output').value)
  }

  it('opens panel and renders suggestions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [sampleSuggestions()] }),
    })
    document.getElementById('btn-audit').disabled = false
    document.getElementById('btn-audit').click()
    await vi.waitFor(() => {
      const cards = document.querySelectorAll('.audit-card')
      expect(cards.length).toBe(1)
    })
    expect(document.getElementById('audit-panel').hasAttribute('hidden')).toBe(false)
  })

  it('drops malformed suggestions with a toast', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [
        sampleSuggestions(),
        { type: 'explode', reason: 'bad' },
        { type: 'add_element', reason: 'no element' },
      ] }),
    })
    const { showToast } = await import('../toast.js')
    document.getElementById('btn-audit').disabled = false
    document.getElementById('btn-audit').click()
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.audit-card').length).toBe(1)
    })
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('malformed'), 'warning')
  })

  it('accept on add_element pushes element and emits state:loaded', async () => {
    const baseJson = { compositional_deconstruction: { elements: [] } }
    setJsonOutput(baseJson)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [sampleSuggestions()] }),
    })
    const { on } = await import('../events.js')
    const seen = vi.fn()
    on('state:loaded', seen)

    document.getElementById('btn-audit').disabled = false
    document.getElementById('btn-audit').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(1))
    document.querySelector('.audit-card-accept').click()

    const updated = readJsonOutput()
    expect(updated.compositional_deconstruction.elements.length).toBe(1)
    expect(updated.compositional_deconstruction.elements[0].name).toBe('wine glass')
    expect(seen).toHaveBeenCalled()
  })

  it('stale update_element shows inline error, no crash', async () => {
    setJsonOutput({ compositional_deconstruction: { elements: [{ name: 'x', desc: 'y' }] } })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [
        { type: 'update_element', index: 99, reason: 'x', patch: { desc: 'better' } },
      ] }),
    })
    document.getElementById('btn-audit').disabled = false
    document.getElementById('btn-audit').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(1))
    document.querySelector('.audit-card-accept').click()
    expect(document.querySelector('.audit-card-error').textContent).toMatch(/stale/i)
  })

  it('reject removes the card', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [sampleSuggestions()] }),
    })
    document.getElementById('btn-audit').disabled = false
    document.getElementById('btn-audit').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(1))
    document.querySelector('.audit-card-reject').click()
    expect(document.querySelectorAll('.audit-card').length).toBe(0)
  })

  it('Accept all applies every pending suggestion', async () => {
    setJsonOutput({ compositional_deconstruction: { elements: [] }, style: { lighting: 'soft' } })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [
        sampleSuggestions(),
        { type: 'update_field', field: 'style.lighting', reason: 'x', value: 'hard' },
      ] }),
    })
    document.getElementById('btn-audit').disabled = false
    document.getElementById('btn-audit').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(2))
    document.getElementById('btn-audit-accept-all').click()
    const updated = readJsonOutput()
    expect(updated.compositional_deconstruction.elements.length).toBe(1)
    expect(updated.style.lighting).toBe('hard')
  })
})
```

**Step 3: Run tests to verify they fail**

```bash
npm test -- src/__tests__/audit.test.js
```

Expected: FAIL — `initAudit is not a function` or similar.

**Step 4: Implement the UI orchestration**

Append to `src/audit.js` (below the helpers from Task 2):

```javascript
// UI orchestration (Task 6)
import { state } from './state.js'
import { emit, on } from './events.js'
import { showToast } from './toast.js'

let _panel, _list, _modelSelect, _btn, _closeBtn, _acceptAllBtn
let _pending = []  // [{suggestion, cardEl, status}]

export function initAudit() {
  _btn = document.getElementById('btn-audit')
  _panel = document.getElementById('audit-panel')
  _list = document.getElementById('audit-suggestions')
  _modelSelect = document.getElementById('audit-model')
  _closeBtn = document.getElementById('btn-audit-close')
  _acceptAllBtn = document.getElementById('btn-audit-accept-all')
  if (!_btn || !_panel) return

  // Enable the button only when an image is loaded
  const updateBtnState = () => {
    _btn.disabled = !state.imageDataUrl
  }
  updateBtnState()
  on('image:ready', updateBtnState)

  _btn.addEventListener('click', runAudit)
  _closeBtn?.addEventListener('click', () => _panel.hidden = true)
  _acceptAllBtn?.addEventListener('click', acceptAll)

  // Populate model select (mirrors recaption pattern)
  fetch('/api/config', { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
      const vision = config.vision
      if (!vision) return
      Object.entries(vision).forEach(([provider, p]) => {
        if (!p?.models?.length || p.models.every(m => !m)) return
        if (provider !== 'local' && !p?.api_key) return
        const group = document.createElement('optgroup')
        group.label = provider === 'local' ? 'Local' : provider.charAt(0).toUpperCase() + provider.slice(1)
        p.models.forEach(m => {
          if (!m) return
          const opt = document.createElement('option')
          opt.value = provider === 'local' ? 'local' : `${provider}::${m}`
          opt.textContent = m
          group.appendChild(opt)
        })
        _modelSelect.appendChild(group)
      })
    })
    .catch(() => {})
}

async function runAudit() {
  if (!state.imageDataUrl) return
  const model = _modelSelect.value
  if (!model) { showToast('Select a vision model for audit', 'error'); return }

  _btn.disabled = true
  _btn.textContent = 'Auditing\u2026'
  _list.innerHTML = '<div class="audit-empty">Auditing\u2026</div>'
  _panel.hidden = false
  _pending = []

  const body = { image: state.imageDataUrl, json: document.getElementById('json-output').value, model }
  if (model === 'local') {
    body.local_model = _modelSelect.options[_modelSelect.selectedIndex].textContent
  }

  try {
    const resp = await fetch('/api/audit-json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => null)
      throw new Error(err?.error || `Server error (${resp.status})`)
    }
    const data = await resp.json()
    renderSuggestions(data.suggestions || [])
  } catch (err) {
    showToast(err.message, 'error')
    _list.innerHTML = `<div class="audit-empty">Audit failed: ${err.message}</div>`
  } finally {
    _btn.disabled = false
    _btn.textContent = 'Audit JSON'
  }
}

function renderSuggestions(rawList) {
  const valid = []
  let dropped = 0
  for (const raw of rawList) {
    const s = validateSuggestion(raw)
    if (s) valid.push(s)
    else dropped += 1
  }
  if (dropped > 0) showToast(`${dropped} suggestion${dropped === 1 ? '' : 's'} skipped as malformed`, 'warning')

  _list.innerHTML = ''
  _pending = []
  if (valid.length === 0) {
    _list.innerHTML = '<div class="audit-empty">No improvements found.</div>'
    return
  }
  for (const s of valid) {
    const card = renderCard(s)
    _list.appendChild(card.el)
    _pending.push({ suggestion: s, cardEl: card.el, status: 'pending', ...card })
  }
}

function renderCard(s) {
  const el = document.createElement('div')
  el.className = 'audit-card'

  const typeLabel = s.type === 'add_element' ? 'Add element'
    : s.type === 'update_element' ? `Update element #${s.index}`
    : `Update ${s.field}`

  let diffHtml = ''
  if (s.type === 'add_element') {
    diffHtml = `<div class="audit-card-diff"><strong>${s.element.name}</strong> — ${s.element.desc}</div>`
  } else if (s.type === 'update_element') {
    diffHtml = `<div class="audit-card-diff">→ ${s.patch.desc || JSON.stringify(s.patch)}</div>`
  } else {
    diffHtml = `<div class="audit-card-diff">→ ${s.value}</div>`
  }

  el.innerHTML = `
    <div class="audit-card-type">${typeLabel}</div>
    <div class="audit-card-reason">${s.reason}</div>
    ${diffHtml}
    <div class="audit-card-actions">
      <button class="btn audit-card-accept" type="button">Accept</button>
      <button class="btn audit-card-reject" type="button">Reject</button>
    </div>
  `

  const accept = () => applySuggestion(s, el)
  const reject = () => { el.classList.add('rejected'); el.querySelector('.audit-card-actions').remove() }
  el.querySelector('.audit-card-accept').addEventListener('click', accept)
  el.querySelector('.audit-card-reject').addEventListener('click', reject)

  return { el, accept, reject }
}

function applySuggestion(suggestion, cardEl) {
  let json
  try {
    json = JSON.parse(document.getElementById('json-output').value)
  } catch (e) {
    showToast('Current JSON is invalid; cannot apply', 'error')
    return
  }
  try {
    if (suggestion.type === 'add_element') applyAddElement(json, suggestion)
    else if (suggestion.type === 'update_element') applyUpdateElement(json, suggestion)
    else if (suggestion.type === 'update_field') applyUpdateField(json, suggestion)
  } catch (e) {
    const errEl = document.createElement('div')
    errEl.className = 'audit-card-error'
    errEl.textContent = e.message
    cardEl.appendChild(errEl)
    return
  }
  document.getElementById('json-output').value = JSON.stringify(json, null, 2)
  emit('state:loaded', { json })
  cardEl.classList.add('applied')
  const actions = cardEl.querySelector('.audit-card-actions')
  if (actions) actions.remove()
}

function acceptAll() {
  for (const item of _pending) {
    if (item.status === 'pending' && !item.cardEl.classList.contains('applied') && !item.cardEl.classList.contains('rejected')) {
      item.accept()
    }
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- src/__tests__/audit.test.js
```

Expected: PASS — all tests (14 helpers + 6 UI).

**Step 6: Commit**

```bash
git add src/audit.js src/__tests__/audit.test.js
git commit -m "feat: audit panel UI — fetch, render, accept/reject, accept all"
```

---

### Task 7: Wire initAudit in app.js

**Files:**
- Modify: `src/app.js`

**Step 1: Import + call**

Find the existing import block (where `initVision` etc. are imported). Add:

```javascript
import { initAudit } from './audit.js';
```

Find the init call sequence (where `initVision()` is called, near the bottom). Add alongside:

```javascript
initAudit();
```

**Step 2: Smoke test**

```bash
npm test
```

Expected: all 191 + new audit tests pass.

**Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: wire initAudit in app init"
```

---

### Task 8: Manual end-to-end + polish

**Step 1: Run server**

```bash
python3 server.py
```

**Step 2: Exercise the full flow**

1. Open `http://localhost:8080` in a browser
2. Vision tab → drop an image → process → JSON loads into Editor
3. Editor tab → click **"Audit JSON"** button
4. Verify panel opens on the right with suggestion cards
5. Click Accept on an `add_element` → verify a new box appears on the canvas
6. Click Accept on an `update_field` → verify JSON textarea updates
7. Click Reject on one → verify card greys out
8. Click **Accept all** → verify remaining pendings all apply
9. Close panel → verify canvas state preserved

**Step 3: Edge cases to verify manually**

- Audit with no model selected → toast "Select a vision model for audit"
- Audit a second time while a previous audit's accepts are mid-render → no crash
- Switch vision model mid-session → panel uses the new one on next run
- Cloud model that returns malformed JSON → 502 with useful message

**Step 4: Fix any visual issues found in step 2-3**

Adjust CSS in `index.html` as needed. No code changes unless bugs surface.

**Step 5: Final commit**

```bash
git add -A
git commit -m "polish: audit panel v1 visual tweaks from manual review"
```

---

## Done criteria

- All `npm test` passing (existing 191 + new audit tests)
- `python3 -m py_compile server.py` clean
- `uv run --directory img-to-json python main.py --help` shows `--audit-mode` and `--json-file`
- Manual flow in Task 8 step 2 works end-to-end
- No existing tests broken
