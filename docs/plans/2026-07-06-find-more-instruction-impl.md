# Find more — free-text instruction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the user steer the Vision tab's Find more call with a free-text instruction; fix the reveal bug so Find more appears whenever image + JSON are present.

**Architecture:** One text input in `.vision-actions`. A single `updateFindMoreVisibility()` helper replaces the fragile single-call-site reveal. `findMore()` sends `instruction` in the POST body; `_handle_vision_more` injects it into the cloud VLM user message, replacing the fixed "Find ADDITIONAL distinct instances" sentence. Empty instruction = byte-identical to today.

**Tech Stack:** Vanilla JS (ES modules), Python stdlib `http.server`, Vitest + jsdom for tests.

**Design doc:** `docs/plans/2026-07-06-find-more-instruction-design.md`

---

### Task 1: Add the instruction input to the UI

**Files:**
- Modify: `index.html:3380-3384` (the `.vision-actions` block)
- Modify: `index.html` CSS section near `#btn-vision-find-more` rule (line 2517)

**Step 1: Add the input element**

In `index.html`, inside `.vision-actions`, insert the input **before** the Find more button (line 3382). Final block should read:

```html
<div class="vision-actions" id="vision-actions">
    <button id="btn-vision-process" class="btn btn-primary" disabled>Process Image</button>
    <input id="vision-instruction" type="text"
           class="vision-instruction-input"
           placeholder="e.g. find missing people · look for background text"
           style="display:none;">
    <button id="btn-vision-find-more" class="btn" type="button" style="display:none;">Find more items</button>
    <span id="vision-status" class="vision-status" role="status" aria-live="polite"></span>
</div>
```

Note: input starts `display:none` — the reveal helper controls visibility.

**Step 2: Add minimal CSS**

Right after the `#btn-vision-find-more:disabled { ... }` block (line 2531), add:

```css
.vision-instruction-input {
    flex: 1;
    min-width: 160px;
    max-width: 320px;
    padding: 10px 12px;
    font-size: 13px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--hairline-strong);
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s;
}
.vision-instruction-input:focus {
    border-color: var(--accent);
}
.vision-instruction-input::placeholder {
    color: var(--text-muted);
}
```

If any of `--text`, `--bg`, `--hairline-strong`, `--accent`, `--text-muted` don't exist, check `:root` in the same file and use whatever neighboring rules use (the existing `#btn-vision-find-more` rule references `--accent`, `--hairline-strong`, `--accent-glow` — those are confirmed present).

**Step 3: Verify**

Load the app (`python3 server.py`), open Vision tab. The input should be hidden initially (no image). No console errors. No test changes yet.

---

### Task 2: Reveal helper + fix the Find more visibility bug (TDD)

**Files:**
- Modify: `src/vision.js` (add helper, rewire reveal call sites)
- Test: `src/__tests__/vision.test.js` (extend `DOM_HTML`, add tests)

**Step 1: Extend the test fixture**

In `src/__tests__/vision.test.js`, add these elements to the `DOM_HTML` template string (place near the other vision elements, e.g. after `<button id="btn-vision-process">...`):

```js
<button id="btn-vision-find-more" style="display:none;">Find more items</button>
<input id="vision-instruction" type="text" style="display:none;">
<textarea id="vision-json"></textarea>
```

**Step 2: Write the failing tests**

Append to the `describe('vision', ...)` block:

```js
it('shows Find more + instruction input when image and JSON are present', () => {
  const findMoreBtn = document.getElementById('btn-vision-find-more')
  const instructionInput = document.getElementById('vision-instruction')
  const previewImg = document.getElementById('vision-preview-img')
  const visionJson = document.getElementById('vision-json')

  previewImg.src = 'data:image/png;base64,abc'
  visionJson.value = '{"compositional_deconstruction":{"elements":[]}}'
  emit('state:loaded', { json: JSON.parse(visionJson.value) })

  expect(findMoreBtn.style.display).not.toBe('none')
  expect(instructionInput.style.display).not.toBe('none')
})

it('hides Find more + instruction input when JSON is empty', () => {
  const findMoreBtn = document.getElementById('btn-vision-find-more')
  const instructionInput = document.getElementById('vision-instruction')
  const previewImg = document.getElementById('vision-preview-img')
  const visionJson = document.getElementById('vision-json')

  previewImg.src = 'data:image/png;base64,abc'
  visionJson.value = ''
  emit('state:loaded', { json: {} })

  expect(findMoreBtn.style.display).toBe('none')
  expect(instructionInput.style.display).toBe('none')
})

it('typing into vision-json reveals Find more', () => {
  const findMoreBtn = document.getElementById('btn-vision-find-more')
  const previewImg = document.getElementById('vision-preview-img')
  const visionJson = document.getElementById('vision-json')

  previewImg.src = 'data:image/png;base64,abc'
  visionJson.value = ''
  emit('state:loaded', { json: {} })
  expect(findMoreBtn.style.display).toBe('none')

  visionJson.value = '{"compositional_deconstruction":{"elements":[{"desc":"x"}]}}'
  visionJson.dispatchEvent(new Event('input'))

  expect(findMoreBtn.style.display).not.toBe('none')
})
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/vision.test.js`
Expected: 3 FAIL (helper doesn't exist yet; Find more stays `display:none`).

**Step 4: Implement `updateFindMoreVisibility()` in `src/vision.js`**

Near the top of `initVision()` after the element lookups (around line 42), add the helper:

```js
function updateFindMoreVisibility() {
  const hasImage = !!(previewImg && previewImg.src);
  const jsonVal = (document.getElementById('vision-json')?.value || '').trim();
  const show = hasImage && !!jsonVal;
  const display = show ? '' : 'none';
  if (findMoreBtn) findMoreBtn.style.display = display;
  const instr = document.getElementById('vision-instruction');
  if (instr) instr.style.display = display;
}
```

Note: `previewImg`, `findMoreBtn` are already in scope inside `initVision()`.

**Step 5: Wire the helper at every state source**

In `src/vision.js`, replace the existing reveal sites:

1. **`handleFile` (line 186):** replace `if (findMoreBtn) findMoreBtn.style.display = 'none';` with a call to `updateFindMoreVisibility()` placed **after** `previewImg.src = e.target.result;` is set inside the `reader.onload`. (At top of handleFile, before reader loads, src hasn't changed yet — keep the call inside onload where src is guaranteed set.)

2. **`processImage` success (lines 339-344):** remove the block that sets `findMoreBtn.style.display = ''`, `.disabled = false`, `.classList.remove('done')`, `.textContent = 'Find more items'`. Keep the `.disabled = false` / textContent / classList lines (they manage button state, not visibility). Then call `updateFindMoreVisibility()` at the end of the success block.

   Concretely, replace:
   ```js
   if (findMoreBtn) {
     findMoreBtn.style.display = '';
     findMoreBtn.disabled = false;
     findMoreBtn.classList.remove('done');
     findMoreBtn.textContent = 'Find more items';
   }
   ```
   with:
   ```js
   if (findMoreBtn) {
     findMoreBtn.disabled = false;
     findMoreBtn.classList.remove('done');
     findMoreBtn.textContent = 'Find more items';
   }
   updateFindMoreVisibility();
   ```

3. **`state:loaded` listener:** add a new listener (alongside the existing `image:ready` listener around line 166):
   ```js
   on('state:loaded', () => updateFindMoreVisibility());
   ```

4. **`#vision-json` input/paste:** after the existing element lookups, wire:
   ```js
   const visionJsonEl = document.getElementById('vision-json');
   visionJsonEl?.addEventListener('input', updateFindMoreVisibility);
   visionJsonEl?.addEventListener('paste', () => setTimeout(updateFindMoreVisibility, 0));
   ```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/vision.test.js`
Expected: 3 new tests PASS, all existing tests still PASS.

**Step 7: Commit**

```bash
git add src/vision.js src/__tests__/vision.test.js index.html
git commit -m "fix(vision): reveal Find more whenever image+JSON present

Replaces the fragile single-call-site reveal (only after Process Image
success) with a single updateFindMoreVisibility() helper called from
all state sources: process success, state:loaded, #vision-json
input/paste, image:ready. Adds the instruction input element (hidden
by default; same reveal rule)."
```

---

### Task 3: Send the instruction in the find-more request (TDD)

**Files:**
- Modify: `src/vision.js` `findMore()` (line 364)
- Test: `src/__tests__/vision.test.js`

**Step 1: Write the failing tests**

Append to `describe('vision', ...)`:

```js
it('findMore sends instruction in body when input is non-empty', async () => {
  const previewImg = document.getElementById('vision-preview-img')
  const visionJson = document.getElementById('vision-json')
  const instructionInput = document.getElementById('vision-instruction')
  previewImg.src = 'data:image/png;base64,abc'
  visionJson.value = '{"compositional_deconstruction":{"elements":[{"desc":"a"}]}}'
  instructionInput.value = 'find missing people'

  const calls = []
  global.fetch = vi.fn(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    return { ok: true, json: () => Promise.resolve({ new_elements: [] }) }
  })

  document.getElementById('btn-vision-find-more').click()
  await vi.waitFor(() => expect(calls.length).toBe(1))
  expect(calls[0].url).toBe('/api/img-to-json/more')
  expect(calls[0].body.instruction).toBe('find missing people')
})

it('findMore omits instruction when input is empty', async () => {
  const previewImg = document.getElementById('vision-preview-img')
  const visionJson = document.getElementById('vision-json')
  previewImg.src = 'data:image/png;base64,abc'
  visionJson.value = '{"compositional_deconstruction":{"elements":[{"desc":"a"}]}}'

  const calls = []
  global.fetch = vi.fn(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    return { ok: true, json: () => Promise.resolve({ new_elements: [] }) }
  })

  document.getElementById('btn-vision-find-more').click()
  await vi.waitFor(() => expect(calls.length).toBe(1))
  expect(calls[0].body).not.toHaveProperty('instruction')
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/vision.test.js`
Expected: 2 FAIL (`instruction` not in body).

**Step 3: Implement — read instruction in `findMore()`**

In `src/vision.js` `findMore()` (around line 380, where `body` is built), add after the existing body fields:

```js
const instruction = (document.getElementById('vision-instruction')?.value || '').trim();
if (instruction) body.instruction = instruction;
```

The `if (instruction)` guard guarantees empty input → key omitted → byte-identical request shape to today.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/vision.test.js`
Expected: all PASS.

**Step 5: Commit**

```bash
git add src/vision.js src/__tests__/vision.test.js
git commit -m "feat(vision): send free-text instruction with find-more request"
```

---

### Task 4: Backend — inject instruction into the cloud VLM message

**Files:**
- Modify: `server.py` `_handle_vision_more` (line 374), cloud path around line 460-471

**Step 1: Read the instruction from the body**

At the top of `_handle_vision_more`, after the existing `body.get(...)` reads (around line 385), add:

```python
instruction = (body.get("instruction") or "").strip()
```

**Step 2: Inject into the cloud user message**

In the `else:` branch (cloud path, around line 466-471), replace the fixed `user_msg` construction. Today:

```python
seed_block = "\n".join(f"- {it.get('desc', '')}" for it in seed) if seed else "(none)"
user_msg = (
    "Items already found and described:\n" + seed_block
    + "\n\nFind ADDITIONAL distinct instances NOT in the list above. "
    "Return only NEW items, or {\"objects\": []} if nothing new remains."
)
```

Replace with:

```python
seed_block = "\n".join(f"- {it.get('desc', '')}" for it in seed) if seed else "(none)"
# ponytail: local path ignores custom instruction; add --more-instruction to
# img-to-json/main.py if a local user needs it.
_trailer = 'Return only NEW items, or {"objects": []} if nothing new remains.'
if instruction:
    user_msg = (
        "Items already found and described:\n" + seed_block
        + f"\n\nUser instruction: {instruction}\n" + _trailer
    )
else:
    user_msg = (
        "Items already found and described:\n" + seed_block
        + "\n\nFind ADDITIONAL distinct instances NOT in the list above. "
        + _trailer
    )
```

The empty-`instruction` branch is byte-identical to today's message (same words, same newlines).

**Step 3: Syntax-check the server**

Run: `python3 -m py_compile server.py`
Expected: no output, exit 0.

**Step 4: Commit**

```bash
git add server.py
git commit -m "feat(vision): honor free-text instruction in find-more cloud call"
```

---

### Task 5: Manual end-to-end verification

No code changes — verify the full flow.

**Step 1: Start the server**

```bash
python3 server.py
```

**Step 2: Smoke the empty-instruction path (regression check)**

- Vision tab → drop an image → Process Image → wait for JSON.
- Confirm Find more button + instruction input are now visible.
- Leave instruction empty → click Find more → confirm it behaves exactly as before (returns 0+ new elements, appends them, status shows "+N new · M total").

**Step 3: Smoke the instruction path**

- Same image + JSON. Type `find missing people` in the instruction input.
- Click Find more → confirm the request body (DevTools Network → `/api/img-to-json/more` → Payload) includes `"instruction": "find missing people"`.
- Confirm the model returns people-focused new elements.

**Step 4: Smoke the reveal bug fix**

- Without clicking Process: paste a JSON into the Vision JSON textarea after loading an image (or trigger via PNG import / gallery restore).
- Confirm Find more + instruction input appear without needing Process Image.

**Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

---

## Out of scope (per design doc)

- Local-model custom instruction (`main.py` has no flag).
- Multi-turn, replace-JSON, revise modes.
- Session persistence of the instruction.
- Quick-action chips.
