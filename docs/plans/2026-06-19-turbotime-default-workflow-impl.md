# Turbotime LoRA + v20 Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the ostris turbotime LoRA active by default via a new single-model turbo workflow, lower steps to 2/4/8, add an adjustable Turbo Strength slider, hide the now-meaningless Uncond slider, and keep a fallback toggle to the old workflow.

**Architecture:** `workflow_template_lora_turbo.json` (API format, user-provided) replaces `workflow_template_lora.json` as the live base. The handler keeps both templates and dispatches on a `workflow` input (`turbo` default, `v1` fallback). Frontend gains an engine toggle + turbo strength slider in Global Settings.

**Tech Stack:** Vanilla JS (ES modules, no build), Python RunPod handler, Docker, ComfyUI API-format JSON.

**Reference:** Design doc at `docs/plans/2026-06-19-turbotime-default-workflow-design.md`.

---

## REVISION 2026-06-19 (supersedes original Tasks 0, 6, 7, 8)

The original plan assumed a UI-format v20 export needing manual conversion. The user instead provided `runpod/workflow_template_lora_turbo.json` **already in API format**. This collapses Tasks 0, 7 and simplifies Task 8. Tasks 1-5 are already complete on master. The remaining work is below.

**Turbo workflow node map (verified from the file):**
- `165` UNETLoader (single diffusion model, no unconditional)
- `183` LoraLoaderModelOnly — **turbotime**, `strength_model` adjustable, path `ideogram4\control\ideogram_4_turbotime_v1.safetensors`
- `186` Power Lora Loader (rgthree) — **user lora slot** (kiki), populated like old 166/177
- `98:167` CLIPTextEncode — **prompt target** (`text` field, no intermediary)
- `98:27` / `98:28` — width / height (shared with v1)
- `160` — seed (shared with v1)
- `98:156` CustomCombo — preset choice (shared with v1; preset table `98:147` already ships 8/4/2)
- Model chain: `165 → 183 → 186 → 98:171 → (98:185 CFGGuider, 98:172 BasicScheduler)`

---

## BLOCKING prerequisite

**NONE.** The API-format workflow is already committed. All remaining tasks can proceed.

---

### Task 0: Export v20 in ComfyUI API format — OBSOLETE

**Superseded by REVISION 2026-06-19.** The user provided `runpod/workflow_template_lora_turbo.json` already in API format. No manual export needed. File is committed.

---

### Task 1: Add `state.workflow` field with persistence

**Files:**
- Modify: `src/state.js:13` (where `preset` lives)

**Step 1:** Read the current `state.js` to confirm the `preset` field location.

Run: `grep -n "preset" src/state.js`

**Step 2:** Add the `workflow` field after `preset`.

In `src/state.js`, find:
```js
  preset: 'Default',
```
Replace with:
```js
  preset: 'Default',
  workflow: 'v20',
```

**Step 3:** Commit.
```bash
git add src/state.js
git commit -m "feat(state): add workflow field (v20 default, v1 fallback)"
```

---

### Task 2: Hide the Uncond slider in HTML + simplify lora.js

**Files:**
- Modify: `index.html:2099-2102` (the `lora-unconditional` label block)
- Modify: `src/lora.js` (drop unconditional handling)

**Step 1:** In `index.html`, find the Uncond slider label block:
```html
<label style="flex:1;font-size:11px;display:flex;flex-direction:column;gap:4px;" for="lora-unconditional">
    Uncond <span id="lora-unconditional-val" style="opacity:0.6;">0.50</span>
    <input type="range" id="lora-unconditional" min="0" max="2" step="0.1" value="0.5" disabled aria-describedby="lora-unconditional-val">
</label>
```
Delete this entire `<label>` block (leaving the "Main" positive slider with `flex:1` — it will now take full width).

**Step 2:** In `src/lora.js`, find `loadConfigIntoPanel` (around line 73) and remove the two lines setting `lora-unconditional`:
```js
  document.getElementById('lora-unconditional').value = entry.strengths.unconditional;
  document.getElementById('lora-unconditional-val').textContent = entry.strengths.unconditional.toFixed(2);
```
Delete both lines.

**Step 3:** In `src/lora.js`, find `setConfigEnabled` (line 88) and remove `'lora-unconditional'` from the array:
```js
  ['lora-positive', 'lora-unconditional', 'lora-art-style', 'lora-aesthetics', 'lora-medium',
   'lora-use', 'lora-delete'].forEach(id => {
```
Replace with:
```js
  ['lora-positive', 'lora-art-style', 'lora-aesthetics', 'lora-medium',
   'lora-use', 'lora-delete'].forEach(id => {
```

**Step 4:** In `src/lora.js`, find the positive/unconditional input listener (line 207-209):
```js
  ['positive', 'unconditional'].forEach(f => {
    document.getElementById(`lora-${f}`).addEventListener('input', (e) => updateEntry(f, e.target.value));
  });
```
Replace with:
```js
  document.getElementById('lora-positive').addEventListener('input', (e) => updateEntry('positive', e.target.value));
```

**Step 5:** In `src/lora.js` `updateEntry` (line 172), the `if (field === 'positive' || field === 'unconditional')` check stays valid — it just won't get `unconditional` anymore. Leave `useSelected` (line 113) sending `strengths: { ...entry.strengths }` unchanged — the kiki seed keeps `unconditional` for v1 fallback compat; only the UI stops editing it.

**Step 6:** Verify the app still loads.

Run: `python3 server.py` → open `http://localhost:8000` → confirm the LoRA panel shows only the "Main" slider, no "Uncond".

**Step 7:** Commit.
```bash
git add index.html src/lora.js
git commit -m "refactor(lora): hide Uncond slider (no unconditional model in v20)"
```

---

### Task 3: Update step preset values to 2 / 4 / 8

**Files:**
- Modify: `index.html:2078-2083` (the speed radio inputs)

**Step 1:** In `index.html`, find:
```html
<input type="radio" id="steps_turbo" name="steps" value="12" data-preset="Turbo">
<label for="steps_turbo" class="pill-label">Turbo</label>
<input type="radio" id="steps_default" name="steps" value="20" data-preset="Default" checked>
<label for="steps_default" class="pill-label">Default</label>
<input type="radio" id="steps_quality" name="steps" value="48" data-preset="Quality">
<label for="steps_quality" class="pill-label">Quality</label>
```
Replace the three `value` attributes: `12`→`2`, `20`→`4`, `48`→`8`. The `data-preset`, `id`, and `checked` stay the same.

**Step 2:** Verify in browser — serve and confirm the radios still switch and `state.preset` updates (it's driven by `data-preset`, which is unchanged).

**Step 3:** Commit.
```bash
git add index.html
git commit -m "feat(settings): step presets 2/4/8 for turbotime"
```

---

### Task 4: Add the Engine (workflow) toggle UI

**Files:**
- Modify: `index.html` (Global Settings → Generation fieldset, after the Speed pill group ~line 2085)
- Modify: `src/settings.js` (add toggle listener + persistence, mirror aspect-ratio pattern at line 38)

**Step 1:** In `index.html`, find the closing `</div>` of the Speed input-group (after line 2084, before the LoRA input-group). Insert a new input-group:
```html
<div class="input-group">
    <span style="display:block;font-size:12px;font-weight:500;color:var(--text-label);margin-bottom:5px;">Engine</span>
    <div class="pill-group" role="radiogroup" aria-label="Engine">
        <input type="radio" id="engine_v20" name="engine" value="v20" checked>
        <label for="engine_v20" class="pill-label">Turbo</label>
        <input type="radio" id="engine_v1" name="engine" value="v1">
        <label for="engine_v1" class="pill-label">Standard</label>
    </div>
</div>
```

**Step 2:** In `src/settings.js`, inside `initSettings()` (after the steps radio listener block ~line 71), add the engine toggle:
```js
  // Engine / workflow selection — v20 (turbotime) vs v1 (dual-model fallback)
  const savedEngine = localStorage.getItem('ideogram_workflow');
  if (savedEngine === 'v1') {
    document.getElementById('engine_v1').checked = true;
    state.workflow = 'v1';
  }
  document.querySelectorAll('input[name="engine"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.workflow = radio.value;
      localStorage.setItem('ideogram_workflow', radio.value);
    });
  });
```

**Step 3:** Serve and verify — toggle between Turbo/Standard, refresh page, confirm selection persists.

**Step 4:** Commit.
```bash
git add index.html src/settings.js
git commit -m "feat(settings): engine toggle v20/v1 with persistence"
```

---

### Task 5: Send `workflow` param from runpod.js

**Files:**
- Modify: `src/runpod.js:66-78` (the `input` body)

**Step 1:** In `src/runpod.js`, find the `input:` object in the fetch body:
```js
                input: {
                    import_json: importJson,
                    width: state.canvas.width,
                    height: state.canvas.height,
                    preset: state.preset,
                    loras: state.loras.map(l => ({
```
Add `workflow: state.workflow,` after the `preset:` line:
```js
                input: {
                    import_json: importJson,
                    width: state.canvas.width,
                    height: state.canvas.height,
                    preset: state.preset,
                    workflow: state.workflow,
                    loras: state.loras.map(l => ({
```

**Step 2:** Commit.
```bash
git add src/runpod.js
git commit -m "feat(runpod): send workflow param to handler"
```

---

### Task 6: Download turbotime + copy both templates in Dockerfile

**Prerequisite:** None (turbo workflow already committed at `runpod/workflow_template_lora_turbo.json`).

**Files:**
- Modify: `runpod/Dockerfile:30-32`

**Step 1:** In `runpod/Dockerfile`, find:
```dockerfile
RUN mkdir -p /comfyui/models/loras
COPY runpod/handler.py /handler.py
COPY runpod/workflow_template_lora.json /workflow_template.json
```
Replace with:
```dockerfile
RUN mkdir -p /comfyui/models/loras/ideogram4/control
RUN wget -q -O /comfyui/models/loras/ideogram4/control/ideogram_4_turbotime_v1.safetensors \
    https://huggingface.co/ostris/ideogram_4_turbotime_lora/resolve/main/ideogram_4_turbotime_v1.safetensors
COPY runpod/handler.py /handler.py
COPY runpod/workflow_template_lora_turbo.json /workflow_template_turbo.json
COPY runpod/workflow_template_lora.json /workflow_template_lora.json
```

Note: the lora path matches what node 183 references (`ideogram4\control\ideogram_4_turbotime_v1.safetensors`). The old single `/workflow_template.json` copy is removed — the handler now loads both named templates directly (Task 8).

**Step 2:** Commit.
```bash
git add runpod/Dockerfile
git commit -m "feat(docker): download turbotime lora, bundle both workflow templates"
```

---

### Task 7: Inspect the turbo workflow node IDs — DONE

**Completed in REVISION 2026-06-19.** Verified node map:
- `165` UNETLoader, `183` turbotime LoraLoaderModelOnly (`strength_model`), `186` Power Lora Loader (user slot), `98:167` CLIPTextEncode (prompt `text`), `98:27`/`98:28` width/height, `160` seed, `98:156` preset combo (table `98:147` ships 8/4/2), `98:171` ModelSamplingAuraFlow, `98:185` CFGGuider, `98:172` BasicScheduler.

---

### Task 8: Handler — dual-workflow dispatch + turbo strength

**Prerequisite:** Task 7 (node IDs confirmed — done).

**Files:**
- Modify: `runpod/handler.py` (template loading lines 35-41, `build_workflow` 237-260, `handler` job-input parsing ~275-277)

**Step 1:** Replace the single-template loading (lines 35-41):
```python
WORKFLOW_TEMPLATE_PATH = "/workflow_template.json"

LORAS_DIR = "/comfyui/models/loras"
PRESET_INDEX = {"Quality": 1, "Default": 2, "Turbo": 3}

with open(WORKFLOW_TEMPLATE_PATH) as f:
    WORKFLOW_TEMPLATE = json.load(f)
```
With dual-template loading:
```python
WORKFLOW_TEMPLATES = {
    "turbo": "/workflow_template_turbo.json",
    "v1": "/workflow_template_lora.json",
}

LORAS_DIR = "/comfyui/models/loras"

PRESET_INDEX = {"Quality": 1, "Default": 2, "Turbo": 3}

with open(WORKFLOW_TEMPLATES["turbo"]) as f:
    _TURBO_TEMPLATE = json.load(f)
with open(WORKFLOW_TEMPLATES["v1"]) as f:
    _V1_TEMPLATE = json.load(f)
```

The default workflow is `turbo`. `PRESET_INDEX` is shared (both workflows use the same `98:156` CustomCombo).

**Step 2:** Replace the existing `build_workflow` (lines 237-260) with a dispatcher + two builders. Note the turbo workflow reuses the same width/height/seed/preset nodes as v1 (98:27, 98:28, 160, 98:156), so only the prompt target, lora loader, and turbotime strength differ:

```python
def build_workflow(workflow_key, import_json, width, height, preset, seed, loras, turbo_strength):
    if workflow_key == "v1":
        return _build_workflow_v1(import_json, width, height, preset, seed, loras)
    return _build_workflow_turbo(import_json, width, height, preset, seed, loras, turbo_strength)


def _build_workflow_turbo(import_json, width, height, preset, seed, loras, turbo_strength):
    wf = json.loads(json.dumps(_TURBO_TEMPLATE))

    # Dimensions / seed / preset — shared node IDs with v1
    wf["98:27"]["inputs"]["value"] = width
    wf["98:28"]["inputs"]["value"] = height
    if seed is not None and seed >= 0:
        wf["160"]["inputs"]["seed"] = seed
    if preset in PRESET_INDEX:
        wf["98:156"]["inputs"]["choice"] = preset
        wf["98:156"]["inputs"]["index"] = PRESET_INDEX[preset]

    # Prompt — CLIPTextEncode.text directly (no PrimitiveStringMultiline intermediary)
    wf["98:167"]["inputs"]["text"] = import_json

    # Turbotime strength — node 183 (always active in template)
    wf["183"]["inputs"]["strength_model"] = turbo_strength

    # User lora slot — single Power Lora Loader (186), positive strength only
    _populate_lora_loader(wf, "186", loras, "positive")

    return wf


def _build_workflow_v1(import_json, width, height, preset, seed, loras):
    """Original dual-model lora workflow (fallback)."""
    wf = json.loads(json.dumps(_V1_TEMPLATE))
    wf["98:27"]["inputs"]["value"] = width
    wf["98:28"]["inputs"]["value"] = height
    wf["188"]["inputs"]["value"] = import_json
    if seed is not None and seed >= 0:
        wf["160"]["inputs"]["seed"] = seed
    if preset in PRESET_INDEX:
        wf["98:156"]["inputs"]["choice"] = preset
        wf["98:156"]["inputs"]["index"] = PRESET_INDEX[preset]
    _populate_lora_loader(wf, "166", loras, "positive")
    _populate_lora_loader(wf, "177", loras, "unconditional")
    return wf
```

**Step 3:** Update the `handler` function job-input parsing. Find:
```python
    preset = job_input.get("preset", "Default")
    seed = job_input.get("seed")
    loras = job_input.get("loras") or []
```
Replace with:
```python
    preset = job_input.get("preset", "Default")
    seed = job_input.get("seed")
    loras = job_input.get("loras") or []
    workflow_key = job_input.get("workflow", "turbo")
    if workflow_key not in WORKFLOW_TEMPLATES:
        return {"error": f"Unknown workflow '{workflow_key}'"}
    turbo_strength = job_input.get("turbo_strength", 0.8)
```

**Step 4:** Update the `build_workflow` call. Find:
```python
    workflow = build_workflow(import_json, width, height, preset, seed, resolved_loras)
```
Replace with:
```python
    workflow = build_workflow(workflow_key, import_json, width, height, preset, seed, resolved_loras, turbo_strength)
    print(f"worker-ideogram4 - Workflow: {workflow_key}, turbo_strength: {turbo_strength}")
```

**Step 5:** Commit.
```bash
git add runpod/handler.py
git commit -m "feat(handler): dual-workflow dispatch (turbo default, v1 fallback) + turbo strength"
```

---

### Task 9: Build & deploy the new image

**Files:** None (git tag triggers RunPod Container Builder)

**Step 1:** Confirm all prior tasks committed. Run `git log --oneline -8` and confirm the feature commits are present.

**Step 2:** Bump to a new tag. Check the latest tag:
```bash
git tag --sort=-v:refname | head -5
```

**Step 3:** Tag and push (replace x.y.z with bumped version):
```bash
git tag v1.x.z
git push origin v1.x.z
```

**Step 4:** Watch the RunPod Container Builder logs for the build to succeed (turbotime download is ~hundreds of MB — confirm the wget step completes).

---

### Task 10: Live verification (manual)

**Step 1:** With engine = Turbo (v20), no lora selected, Speed = Default (4 steps):
- Generate an image. Confirm it succeeds and renders in ~4 steps (fast).

**Step 2:** Same setup, Speed = Turbo (2 steps) and Speed = Quality (8 steps) — confirm both render.

**Step 3:** THE KEY TEST — engine = Turbo, select kiki lora, Speed = Default:
- Generate. Confirm turbotime + kiki combine without error and the Ghibli style shows through. This verifies the "coupled with another lora" concern.

**Step 4:** Switch engine = Standard (v1), select kiki, Speed = Default:
- Generate. Confirm the old fallback workflow still works end-to-end.

**Step 5:** If any step fails, inspect the RunPod job error and adjust node IDs/input keys in `build_workflow_v20` (most likely culprit = wrong API-format input names from Task 8).

---

## Verification summary

- Tasks 1-5: manual browser check via `python3 server.py`.
- Task 8: no local Python test infra — relies on Task 10 live verification.
- The whole feature is gated by the live RunPod build (Task 9) before it's usable.

## Notes for the executor

- **Task 0 is a hard blocker** owned by the user. Do not attempt to auto-generate the API-format JSON.
- **Task 7 is critical** — the node IDs in the API export will likely differ from the UI-format IDs in `ideogramV4Workflow_v20.json`. Verify before writing handler code. Read the exported JSON's input key names too.
- The v20 bypass mechanism in API format differs from UI format (`mode` field). API format typically omits the node or sets strength to 0. Task 8 uses strength=0 as the safe default; adjust if ComfyUI rejects it.
