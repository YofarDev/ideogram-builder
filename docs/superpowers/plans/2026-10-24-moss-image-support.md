# MOSS-Image Support — Design + Implementation Plan

> **For the implementing agent:** work phase by phase, in order. Each task lists files, exact
> behaviour, tests, and an acceptance check. Run `npm test` after every frontend task. Items
> marked **VERIFY** are facts not yet confirmed on real hardware — confirm them, and if they are
> wrong use the listed fallback and note it in the PR. Keep to the architecture rules in
> `CLAUDE.md` (≤150 LOC per file, modules talk via `events.js`, state in `state.js`).

---

## 0. Research findings (why the plan looks like this)

**Model.** `OpenMOSS-Team/MOSS-Image-SFT`: 5B single-stream DiT, Qwen3.5-9B text encoder,
FLUX.2 VAE (small decoder). Apache-2.0. Accepts natural language, tag sequences, or a JSON
layout. Dimensions must be positive multiples of 16. Recommended 1M–2M total pixels; works from
0.25M up to ~4M.

**ComfyUI is native** (merged Oct 16 2026, ComfyUI master ≥ commit `e087d8f6`; release v0.41.3
does *not* include it). No custom node needed. So MOSS fits the existing
RunPod/Modal + ComfyUI + `handler.py` architecture with a new workflow template.

ComfyUI-format weights: `huggingface.co/Comfy-Org/MOSS-Image`:

| File | Size | Use |
|---|---|---|
| `diffusion_models/moss_image_sft_int8_convrot.safetensors` | 5.4 GB | default |
| `diffusion_models/moss_image_sft_bf16.safetensors` | 10.2 GB | fallback if int8 fails |
| `text_encoders/qwen3.5_9b_w4a8_gptq.safetensors` | 7.3 GB | default (official template) |
| `text_encoders/qwen3.5_9b_int8_convrot.safetensors` | 9.7 GB | fallback |
| `vae/flux2-vae_small.safetensors` | 0.25 GB | default |

Official Comfy template (`Comfy-Org/workflow_templates/templates/image_moss_image_t2i_bboxes.json`):
`UNETLoader` → `SkipLayerGuidanceDiTSimple(single_layers "22", start 0, end 0.5)` → `KSampler`
(25 steps, cfg 2.5, `er_sde`, `simple`); `CLIPLoader(type "moss_image")` → two
`CLIPTextEncode`; `EmptyFlux2LatentImage`; `VAELoader`; `VAEDecode`. Default negative:
`nsfw, worst quality, bad anatomy, watermark, jpeg artifact`. Model's built-in shift is 5 (no
ModelSampling node needed). Official Python defaults: 50 steps, CFG 3, Euler, uncond layer-skip 22.

**Layout JSON format (what the model actually receives):**

```json
{"summary":{"meta":["poster"],"canvas":"single","caption":"A minimalist travel poster…","palette":["#F3E9D2"]},
 "items":[{"label":"text","caption":"Large dark-blue title centered at the top.","text":"EXPLORE","bbox":[-416,-384,-288,384]},
          {"label":"object","caption":"A flat blue mountain illustration.","bbox":[-192,-288,384,288],"palette":["#2B4C7E"]}],
 "bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}
```

- `bbox` = `[y_min, x_min, y_max, x_max]` in **absolute pixels, origin at canvas centre**
  (1024×1024 → each axis −512…+512). Coordinates must match the generation width/height.
- `label` ∈ `object | character | text` (`character` = person/animal/anthropomorphic being).
- `text` required for `label: "text"`; `tags` and `palette` optional per item.
- `summary.meta` = medium/genre tags, `summary.canvas` ∈ `single | multi_panel | collage`.
- ComfyUI's own `MOSSImageLayoutPrompt` node converts **exactly our editor's box format**
  (0–1000 normalized `[y0,x0,y1,x1]`, `type`, `desc`, `color_palette`) into this layout. Our
  conversion copies its maths so output matches the official node byte-for-byte.
- The captioner app (`yofardev_captioner/lib/core/models/moss_layout_caption.dart`) stores a
  *draft* form: `width`, `height`, `bbox_coord_space: "abs"`, `bbox_format: "xyxy"`, top-left
  pixel bboxes. We must **import** that form too (users paste captioner output).

**LoRAs.** ComfyUI's built-in LoRA key mapping supports MOSS (kohya `lora_unet_*`, bare module
paths, fused-qkv split). LoRAs from KohakuMossTrainer / DiffSynth / ai-toolkit load with the
normal LoRA loader → rgthree Power Lora Loader works as today. Community 8-step DMD LoRA:
`lodestones/MOSS-Image-SFT-8-steps-dmd/lora.safetensors` (1.2 GB, strength 1.0, no CFG,
work-in-progress) → used for an experimental **Turbo** preset.

---

## 1. Decision record

| # | Decision | Why |
|---|---|---|
| D1 | Model is a top-level **workspace switch** (`Ideogram 4 / MOSS-Image`) in the toolbar. Canvas, boxes, palette, queue, gallery stay shared. | Boxes are model-agnostic geometry; only the global fields and serialization differ. |
| D2 | Editor keeps its internal box format (0–1000 normalized, `state.boxes`). MOSS JSON is produced at output time and parsed back on load. | Zero churn in canvas/layers; mirrors ComfyUI's native node. |
| D3 | MOSS gets its **own global fieldset** (caption, meta tags, canvas type, negative prompt) instead of reusing Ideogram fields. Both fieldsets live in the DOM; only the active one is visible. | MOSS has no background/lighting/medium slots; mapping them silently would be confusing. |
| D4 | On switch, if the target model's global fields are empty and the source's aren't, auto-convert (lossy) and toast what happened. Never overwrite non-empty fields. | Fast iteration without data loss. |
| D5 | Pasting/loading JSON auto-detects format (Ideogram / MOSS layout / MOSS draft) and switches model when it doesn't match. | Paste-anything flow. |
| D6 | MOSS prompt has two formats: **Layout** (default, JSON from boxes) and **Caption** (plain natural language, boxes ignored). | Model supports both; captions are better for loose ideas. |
| D7 | New box type `character` (MOSS only). In Ideogram output it serializes as `obj`; in state it stays `character` so round-trips keep it. Per-box `tags` (MOSS only). | Matches MOSS schema without hurting Ideogram. |
| D8 | Separate Docker image `runpod/Dockerfile.moss` (no Ideogram weights) and separate RunPod endpoint; Modal gets a second GPU class `ComfyMoss` in the same app, the proxy routes by `payload.model`. One shared `handler.py`. | A combined image would be ~30 GB and slow every cold start. |
| D9 | MOSS presets: **Turbo β** (8-step DMD LoRA), **Fast** (official Comfy template, 25 steps), **Quality** (official Python defaults, 50 steps). Resolved server-side in `handler.py`. | Same pill UX as Ideogram's speed toggle. |
| D10 | LoRA library entries get a `model` field; the panel shows only the active model's LoRAs. User-added LoRAs (URL or local file) persist in localStorage. | Ideogram LoRAs don't work on MOSS. |
| D11 | Local LoRA files: upload through `server.py` → **Modal Volume** (for Modal) and/or **private HF repo** (for RunPod), handler downloads private files with `HF_TOKEN`. See §6. | Answers "use local LoRAs without making them public on HF". |
| D12 | The 4M resolution tier is hidden for MOSS (model tops out ~4M total pixels; our 4M tier is long-side 4096 → up to 9.4M). | Prevent broken generations. |

---

## 2. UX design

### 2.1 Toolbar

```
Ideogram Builder  Editor · Prompt→JSON · JSON→Caption · Vision · Collections · Gallery   [Open Output]
                                   ┌──────────────────────┐ ┌──────────────┐ ┌───────────────┐ ┌──────────────────────┐
                        spacer →   │ Ideogram 4 │ MOSS    │ │ RunPod│Modal │ │ Turbo│Classic │ │ Fast│Default│Quality │  ← Ideogram
                                   └──────────────────────┘ └──────────────┘ └───────────────┘ └──────────────────────┘
                                   ┌──────────────────────┐ ┌──────────────┐                   ┌──────────────────────┐
                                   │ Ideogram 4 │ MOSS    │ │ RunPod│Modal │                   │ Turbo β│Fast│Quality │  ← MOSS
                                   └──────────────────────┘ └──────────────┘                   └──────────────────────┘
```

- New `#model-toggle` pill group, first in the right-hand cluster (it's the most consequential
  choice). Same `.pill-group` styling as `#backend-toggle`.
- `#workflow-toggle` and `#steps-toggle` get class `ideogram-only`. New `#moss-preset-toggle`
  (class `moss-only`) with radios `name="moss_preset"` values `Turbo|Fast|Quality`, default `Fast`.
  `Turbo β` has `title="Experimental 8-step distillation LoRA"`.
- When MOSS is active, the selected model pill uses a subtle secondary tint (optional, a
  `--model-moss` token, e.g. `oklch(72% 0.09 145)`) so users can't miss which model will run.
  Gold accent stays everywhere else.

### 2.2 Left "Global settings" panel

```
Ideogram active                         MOSS active
──────────────────────────              ──────────────────────────
Turbo strength [0.8]                    LoRAs (MOSS only)  [+ Add]
LoRAs (Ideogram only) [+ Add]           Prompt format (• Layout  ○ Caption)
High-level description                  Caption*            [textarea, 6 rows]
Background                              Meta tags           [poster, illustration, …]
(Photo | Art style)                     Canvas              [— | single | multi_panel | collage]
Medium / Art style / Aesthetics /       Negative prompt     [textarea, 2 rows, prefilled]
Lighting                                Style preset        [▼]  (MOSS presets only)
Style preset [▼]                        Palette
Palette
```

- Ideogram fieldset (existing markup) gets class `ideogram-only`; new `<fieldset id="moss-fields"
  class="panel-section moss-only">`.
- Caption mode hides `Meta tags` and `Canvas` (they only exist in layout JSON) and shows a banner
  on the canvas: *"Caption mode — boxes are ignored"*; boxes render at 35% opacity and drawing still
  works (so switching back is lossless).
- Palette stays shared (`state.globalPalette` → `summary.palette` for MOSS).

### 2.3 Box properties panel

- Type toggle becomes `Object | Text | Character`; the `Character` button has class `moss-only`.
  In Ideogram mode a `character` box shows `Object` as active.
- New `Tags` input (comma-separated, class `moss-only`) under the description → `box.tags`.
- Layer list rows show a tiny glyph per type (existing pattern) — add one for character.

### 2.4 JSON pane (`#json-section`)

- Header shows a format chip: `Ideogram JSON` / `MOSS layout · 1024×1536` / `MOSS caption`.
- MOSS layout is displayed pretty-printed (what you see is what is sent, minified).
- Load / Paste / Apply accept any format (auto-detect, D5). Caption mode: Apply puts the
  textarea text into the MOSS caption field.

### 2.5 Other surfaces

| Surface | MOSS behaviour |
|---|---|
| Gallery | Card gets a model chip; `restoreMeta` switches model + MOSS preset/negative. |
| Collections | Items store `model`; preview chip; "Generate Collection" uses each item's own model. Paste-add detects format. |
| Session | Persists model, MOSS fields, prompt format, MOSS preset. |
| PNG import | Detects MOSS prompts in ComfyUI metadata (any node whose `inputs.text` parses as MOSS). |
| Prompt→JSON (AI enhancer) | MOSS mode uses a MOSS system prompt; LLM returns the *draft* form (top-left pixel xyxy — LLMs place these better) which we compile. |
| JSON→Caption | Works on whichever JSON is pasted; in MOSS mode the output can be pushed into the MOSS caption field. |
| Vision | Pipeline still returns Ideogram JSON; in MOSS mode convert client-side before loading (lossy, toast). |
| Audit | Ideogram-only for v1 (`ideogram-only` on the audit block; MOSS shows a one-line note). |

---

## 3. Data model

### 3.1 `state.js` additions

```js
export const MODEL_IDEOGRAM = 'ideogram';
export const MODEL_MOSS = 'moss';
export const MOSS_DEFAULT_NEGATIVE = 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact';

// inside state:
model: MODEL_IDEOGRAM,
moss: { promptMode: 'layout', preset: 'Fast' },   // caption/meta/canvas/negative live in DOM inputs (same pattern as Ideogram fields)
```

Box objects gain `tags: []`; `mode` may be `'obj' | 'text' | 'character'`.

### 3.2 Pure helpers (no DOM, no imports) — new files

**`src/prompt-moss.js`**

```js
// Editor boxes (0–1000, x/y/w/h, bottom→top) → MOSS layout object.
export function buildMossLayout({ caption, meta, canvas, palette, boxes, width, height })
// Layout object → one-line string sent to the model.
export function compileMoss(layout)            // JSON.stringify(layout) (no spaces)
// Any MOSS JSON (compiled or captioner draft) → { view, moss, dims }
//   view = Ideogram-shaped JSON the existing state:loaded consumers understand
//   moss = { caption, meta, canvas, palette }
//   dims = { width, height } when the draft carries them, else null
export function parseMoss(json, { width, height })
export function isMossJson(obj)                // summary is object with string caption && items is array
export function isMossDraft(obj)               // isMossJson && bbox_coord_space === 'abs'
```

Conversion maths (copy exactly; matches ComfyUI `MOSSImageLayoutPrompt`):

```js
const r9 = v => Math.round(v * 1e9) / 1e9;
const hw = Math.floor(W / 2), hh = Math.floor(H / 2);
y1 = Math.floor(r9(box.y * H / 1000)) - hh;
x1 = Math.floor(r9(box.x * W / 1000)) - hw;
y2 = Math.ceil(r9((box.y + box.h) * H / 1000)) - hh;
x2 = Math.ceil(r9((box.x + box.w) * W / 1000)) - hw;
// clamp y to [-hh, hh], x to [-hw, hw]; drop item if y1 >= y2 || x1 >= x2 (return count of dropped)
```

- Items are emitted **top-layer-first** (reverse of `state.boxes`), same as Ideogram.
- Item key order: `label, caption, text (text only), bbox, tags (if non-empty), palette (if non-empty)`.
  `label`: `text`→`text`, `character`→`character`, else `object`. `caption` = `box.desc`.
  `palette` = `box.colors`.
- Summary key order: `meta` (if non-empty), `canvas` (if set), `caption`, `palette` (if non-empty).
- Top level: `summary`, `items`, `bbox_coord_space: "abs_centralized"`, `bbox_format: "yxyx"`.
- Zero items in Layout mode: still emit the JSON (summary only). **VERIFY** quality vs plain caption;
  if worse, emit `summary.caption` as plain text when there are no items.

Parse back (centralized yxyx → editor view element `bbox` 0–1000 `[y0,x0,y1,x1]`):
`y0 = (y1 + hh) / H * 1000`, `x0 = (x1 + hw) / W * 1000`, etc., rounded and clamped 0–1000.
Draft (`abs`, `xyxy`, top-left): `[x1,y1,x2,y2]` → `y0 = y1 / H * 1000`, `x0 = x1 / W * 1000`…,
using the draft's own `width`/`height`.
View element: `{ type: label==='text'?'text':label==='character'?'character':'obj', bbox, desc: caption, text, color_palette: palette, tags }`.
View globals: `high_level_description: caption`, `style_description.color_palette: summary.palette`,
everything else empty strings (Ideogram fields are **not** touched on MOSS load — see Task 2.4).

**`src/prompt-convert.js`**

```js
export function detectPromptFormat(text)
// → 'ideogram' | 'moss' | 'moss-draft' | 'caption' | 'empty'
//   ideogram: JSON with high_level_description | style_description | compositional_deconstruction
//   moss / moss-draft: per prompt-moss predicates; any other non-empty text → 'caption'
export function ideogramGlobalsToMoss({ high_level_description, background, medium, art_style, photo, aesthetics, lighting })
// caption = [hld, background].filter(Boolean).join(' ')
// meta = [medium, ...aesthetics.split(','), lighting, photo || art_style].map(trim).filter(Boolean)
export function mossGlobalsToIdeogram({ caption, meta })
// KNOWN_MEDIUMS = ['photograph','illustration','3d_render','painting','graphic_design']
// hld = caption; medium = first meta in KNOWN_MEDIUMS (else ''); aesthetics = remaining meta joined ', '
```

Port these from `yofardev_captioner/lib/core/models/moss_conversion.dart` (same semantics).

### 3.3 Generation snapshot (`queue.js buildSnapshot`)

Add: `model`, `negativePrompt` (MOSS only, else `''`), `promptFormat` (`'layout'|'caption'`).
`preset` = `state.model === 'moss' ? state.moss.preset : state.preset`.
`importJson` keeps its name (compiled layout or caption text for MOSS) to avoid churn.
`enqueueImportJson(importJson, { model })` — collections pass their item's model.

### 3.4 Backend payload (RunPod `input` / Modal body)

```json
{ "model": "moss", "import_json": "<compiled layout or caption>", "negative_prompt": "…",
  "width": 1024, "height": 1536, "preset": "Fast", "seed": 123, "loras": [{ "filename", "source_url", "strengths": { "positive": 0.8 } }] }
```

`model` absent ⇒ `"ideogram"` (back-compat with existing clients and collections).

---

## 4. Phase A — Backend

### Task A1 — `runpod/workflow_template_moss.json` (new, API format)

```json
{
  "1":  {"class_type": "UNETLoader", "inputs": {"unet_name": "moss_image_sft_int8_convrot.safetensors", "weight_dtype": "default"}},
  "2":  {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3.5_9b_w4a8_gptq.safetensors", "type": "moss_image", "device": "default"}},
  "3":  {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae_small.safetensors"}},
  "4":  {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": "moss/control/moss_sft_dmd8.safetensors", "strength_model": 1.0, "model": ["1", 0]}},
  "5":  {"class_type": "Power Lora Loader (rgthree)", "inputs": {"PowerLoraLoaderHeaderWidget": {"type": "PowerLoraLoaderHeaderWidget"}, "➕ Add Lora": "", "model": ["4", 0]}},
  "6":  {"class_type": "SkipLayerGuidanceDiTSimple", "inputs": {"model": ["5", 0], "double_layers": "", "single_layers": "22", "start_percent": 0.0, "end_percent": 0.5}},
  "7":  {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 0]}},
  "8":  {"class_type": "CLIPTextEncode", "inputs": {"text": "nsfw, worst quality, bad anatomy, watermark, jpeg artifact", "clip": ["2", 0]}},
  "9":  {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
  "10": {"class_type": "KSampler", "inputs": {"seed": 0, "steps": 25, "cfg": 2.5, "sampler_name": "er_sde", "scheduler": "simple", "denoise": 1.0,
                                               "model": ["6", 0], "positive": ["7", 0], "negative": ["8", 0], "latent_image": ["9", 0]}},
  "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["3", 0]}},
  "12": {"class_type": "SaveImage", "inputs": {"filename_prefix": "moss", "images": ["11", 0]}}
}
```

Copy the exact Power Lora Loader input shape from node `186` of
`runpod/workflow_template_lora_turbo.json` if it differs.

### Task A2 — `runpod/handler.py`

1. Load templates lazily and only if the file exists (each image ships only its own):
   `WORKFLOW_TEMPLATES = {"turbo": …, "v1": …, "moss": "/workflow_template_moss.json"}`;
   replace the module-level `open()` calls with a `_load_template(key)` cached helper that returns
   a deep copy, raising `ValueError("Workflow 'x' not available on this worker")` when missing.
2. Read `model = job_input.get("model", "ideogram")`. If `moss`: ignore `workflow`, validate
   `width % 16 == 0 and height % 16 == 0`, call `_build_workflow_moss`.
3. Preset table:

   ```python
   MOSS_PRESETS = {
       "Turbo":   {"steps": 8,  "cfg": 1.0, "sampler": "euler",  "scheduler": "simple", "slg": None,        "dmd": True},
       "Fast":    {"steps": 25, "cfg": 2.5, "sampler": "er_sde", "scheduler": "simple", "slg": (0.0, 0.5), "dmd": False},
       "Quality": {"steps": 50, "cfg": 3.0, "sampler": "euler",  "scheduler": "simple", "slg": (0.0, 1.0), "dmd": False},
   }
   ```

   **VERIFY** Turbo sampler/scheduler (DMD card gives no ComfyUI sampler) and Quality SLG end;
   tweak by eye with 3 seeds and record the choice in a comment.
4. `_build_workflow_moss(prompt, negative, width, height, preset, seed, loras)`:
   - node 7 `text` = prompt; node 8 `text` = negative (allow empty string).
   - node 9 width/height; node 10 steps/cfg/sampler/scheduler/seed.
   - Seed: if `seed is None or seed < 0` → `random.randint(0, 2**53 - 1)`. Return the used seed in
     the result (`result["seed"]`) — also do this for Ideogram if trivial.
   - `dmd` false → delete node 4, set node 5 `model` = `["1", 0]`.
   - `slg` None → delete node 6, set node 10 `model` = `["5", 0]`; else set start/end.
   - `_populate_lora_loader(wf, "5", loras, "positive")`.
5. LoRA download: allow sub-paths (`user/foo.safetensors`): `os.makedirs(os.path.dirname(dest))`.
   If `HF_TOKEN` env is set and the URL host ends with `huggingface.co`, send
   `Authorization: Bearer <token>`. Update the 403 message to mention `HF_TOKEN`.
6. Keep Ideogram behaviour byte-identical when `model` is absent.

Tests: add `runpod/test_handler_moss.py` (pytest, run with `uv run --with pytest pytest runpod`)
that monkeypatches template loading and asserts: node wiring for each preset, LoRA population,
seed randomisation, 16-multiple validation error, Ideogram path unchanged (snapshot of
`build_workflow("turbo", …)` before/after).

### Task A3 — `runpod/Dockerfile.moss` (new)

Same structure as `runpod/Dockerfile`, minus Ideogram weights:

- `FROM runpod/worker-comfyui:5.8.5-base`; build-essential + python3-dev.
- Clone ComfyUI master, then `git checkout <sha>` of a commit ≥ `e087d8f6` (record the SHA; pinning
  prevents surprise breakage), `pip install -r requirements.txt`.
- rgthree-comfy (Power Lora Loader). KJNodes not needed.
- **VERIFY** int8_convrot loads with plain `UNETLoader` on native ComfyUI (the official template
  does this). If not, add `ComfyUI-INT8-Fast` like the Ideogram image, or fall back to
  `moss_image_sft_bf16.safetensors`.
- **VERIFY** `qwen3.5_9b_w4a8_gptq` runs on RTX 3090/A5000 (needs a w4a8 kernel). Fallback:
  `qwen3.5_9b_int8_convrot.safetensors`.
- wget into `models/diffusion_models`, `models/text_encoders`, `models/vae` (URLs:
  `https://huggingface.co/Comfy-Org/MOSS-Image/resolve/main/<path>`).
- wget DMD LoRA → `/comfyui/models/loras/moss/control/moss_sft_dmd8.safetensors` from
  `https://huggingface.co/lodestones/MOSS-Image-SFT-8-steps-dmd/resolve/main/lora.safetensors`.
- `mkdir -p /comfyui/models/loras/user`.
- COPY `runpod/handler.py /handler.py`, `runpod/workflow_template_moss.json /workflow_template_moss.json`.

RunPod: user creates a **second serverless endpoint** pointing at the same repo, Dockerfile path
`runpod/Dockerfile.moss`, build context repo root (manual step — document it in `runpod/README.md`).

### Task A4 — `runpod/modal_app.py`

- `MOSS_IMAGE = modal.Image.from_dockerfile("runpod/Dockerfile.moss", context_dir=str(REPO_ROOT))`.
- Extract the body of `Comfy` into a base mixin and declare `ComfyMoss` with `image=MOSS_IMAGE`
  (same gpu/timeouts/secrets). Modal needs each `@app.cls` declared separately; share the
  `startup/shutdown/generate` implementation through a plain Python base class.
- Proxy `/generate`: `target = ComfyMoss if payload.get("model") == "moss" else Comfy`.
  `/status/{call_id}` unchanged.
- LoRA volume (see §6): `LORA_VOL = modal.Volume.from_name("ideogram-loras", create_if_missing=True)`
  mounted at `/comfyui/models/loras/user` on **both** classes; call `LORA_VOL.reload()` at the
  start of `generate`.
- Update docstring + `CLAUDE.md` Modal section.

### Task A5 — `runpod/client.py`

Add `--model {ideogram,moss}`, `--negative`, `--preset`; for a quick smoke test accept
`--prompt "plain caption"` as an alternative to the JSON file.

**Phase A acceptance:** `python runpod/client.py --model moss --prompt "A red fox in snow" --preset Fast`
against the new endpoint returns a PNG; same with `runpod/example_moss_layout.json` (add one —
the EXPLORE poster from §0 at 1024×1024). Ideogram client call still works.

---

## 5. Phase B — Frontend core

Run `npm test` after each task. Add tests in `src/__tests__/` following the existing jsdom style.

### Task B1 — Pure helpers

Create `src/prompt-moss.js` and `src/prompt-convert.js` per §3.2.
Tests `src/__tests__/prompt-moss.test.js`, `prompt-convert.test.js`:
- EXPLORE example: boxes built from its centralized coords → `buildMossLayout` reproduces them exactly at 1024×1024.
- Non-square 768×1152: compile → parse → compile is stable (idempotent after first round).
- Box at the very edge (x=0, w=1000) → `[-hh, -hw, …, hw]`, nothing dropped; zero-width box dropped.
- Item ordering top-layer-first; key order as specified (compare `JSON.stringify`).
- Draft (captioner `toJson` sample with `width`, `height`, `abs`, `xyxy`) parses to the same view as its compiled form.
- `detectPromptFormat` for all five outcomes.
- Converters: captioner semantics (aesthetics split/trim, known-medium recovery).

### Task B2 — State + model switch module

- `state.js`: §3.1 additions.
- New `src/model.js` (imports `state`, `events`): owns `#model-toggle`; on init reads
  `localStorage.ideogram_model` (default `ideogram`); `setModel(model, { silent })` sets
  `state.model`, `document.body.dataset.model`, checks the radio, persists, emits
  `model:changed { model, previous }`. Export `setModel` for app/gallery/session (they call it via
  the event `model:set { model }` to respect the no-sibling-import rule — model.js listens to
  `model:set`).
- `index.html`: add the toggle markup (§2.1) and CSS:

  ```css
  body[data-model="moss"] .ideogram-only,
  body:not([data-model="moss"]) .moss-only { display: none !important; }
  ```

- Mark `ideogram-only`: `#workflow-toggle`, `#steps-toggle`, `#turbo-strength-group`, the Ideogram
  fieldset(s) in the global panel, the 4M size button, the audit block. Add `#moss-preset-toggle`
  (`moss-only`) and wire it in `settings.js` → `state.moss.preset` (persist
  `localStorage.ideogram_moss_preset`).
- When switching to MOSS with the 4M tier active, select the 2M tier and re-run `updateDimensions`.
- `app.js`: `initModel()` before `initSettings()`.
- Tests: `model.test.js` (persist, event payload, body attribute, `model:set`).

### Task B3 — MOSS global fieldset

- Markup `#moss-fields` (§2.2): `#moss-prompt-mode` radios (`layout|caption`), `#moss-caption`
  textarea, `#moss-meta` input (comma-separated), `#moss-canvas` select (`""`, `single`,
  `multi_panel`, `collage`), `#moss-negative` textarea prefilled with `MOSS_DEFAULT_NEGATIVE`.
- New `src/settings-moss.js` (imports `state`, `events`, `prompt-convert`): input listeners emit
  `state:changed`; prompt-mode toggle sets `state.moss.promptMode`, toggles
  `body.dataset.mossPrompt = 'caption'|'layout'` (CSS hides meta/canvas in caption mode and dims
  `.bbox` to 0.35 opacity + shows the canvas banner), emits `state:changed`.
- Listens `model:changed`: implements D4 seeding (read Ideogram inputs → `ideogramGlobalsToMoss`
  → fill MOSS inputs only if `#moss-caption` is empty; reverse for MOSS→Ideogram filling only empty
  Ideogram inputs). Toast: *"Converted Ideogram fields to MOSS (background merged into caption)."*
- Listens `state:loaded` with payload `moss` present → fill MOSS inputs from it.
- Do not export field readers: json-builder must not import a feature module. It reads the MOSS
  DOM ids directly, exactly as it does for Ideogram fields today.
- Tests: seeding rules (empty vs non-empty), caption-mode body attribute.

### Task B4 — JSON builder + load/paste

`src/json-builder.js` (split into `json-builder.js` + `json-builder-moss.js` if it passes 150 LOC):

- `generateJSON()` → `state.model === 'moss' ? generateMoss() : generateIdeogram()` (current code
  renamed). Ideogram path: map `box.mode === 'character'` → `type: 'obj'`.
- `generateMoss()`: sync DOM box positions (reuse the existing sync loop — extract it into a helper),
  then caption mode → textarea = caption text; layout mode → `buildMossLayout(...)` pretty-printed
  (`JSON.stringify(layout, null, 2)`). Toast once if items were dropped.
- Format chip in the JSON header (`#json-format-chip`), updated on every generate.
- `applyJsonText(raw)`:
  1. `detectPromptFormat(raw)`.
  2. `'ideogram'` → if model is MOSS emit `model:set { model: 'ideogram' }` + toast; then current path.
  3. `'moss' | 'moss-draft'` → if model is Ideogram emit `model:set { model: 'moss' }` + toast; if the
     draft carries `width/height` and they differ from the canvas, set the canvas size first (emit
     the same events png-import uses: set `state.canvas`, update `#dim-display`, `canvas:rebuild`);
     then `parseMoss` → set `state.moss.promptMode = 'layout'` → `emit('state:loaded', { json: view, moss })`.
  4. `'caption'` while MOSS → put text in `#moss-caption`, switch prompt mode to caption.
     While Ideogram → keep current error flash.
- `queue.js buildSnapshot`: §3.3. `JSON.parse` minification already happens; for caption mode
  `importJson` is the raw text (parse fails → falls through, already handled).
- Tests: extend `json-builder.test.js` (MOSS output for 2 boxes incl. character + text; caption
  mode; character→obj in Ideogram), `queue.test.js` (snapshot fields per model).

### Task B5 — Canvas / box panel / layers

- `canvas.js` `state:loaded`: read `tags: element.tags ?? []`; accept `type: 'character'`.
- Box panel: `Character` mode button (`moss-only`) + `#box-tags` input (`moss-only`) in
  `settings.js` box-form code; on `model:changed` to Ideogram, re-render the toggle so a
  `character` box shows `Object` active.
- Box label badge / layer glyph for `character` (reuse existing obj/text glyph pattern).
- Caption-mode canvas banner element (`#caption-mode-banner`, `moss-only`, shown via CSS when
  `body[data-moss-prompt="caption"]`).

### Task B6 — Backends

- `runpod.js`: `endpoint = config.endpoints?.[snapshot.model] || config.endpoint_id`; error
  message names the missing key (`runpod.endpoints.moss`). Add `model`, `negative_prompt` to `input`.
- `modal.js`: add `model`, `negative_prompt` to the body.
- `server.py` `/api/config`: already passes `runpod` through — nothing to do beyond documenting
  `runpod.endpoints` in `config.example.json`.
- Tests: `runpod.test.js`, `modal.test.js` payload + endpoint selection.

**Phase B acceptance (manual, `python3 server.py`):** switch to MOSS, draw a text box "EXPLORE"
and an object box, fill caption → JSON pane shows centralized yxyx layout with the right chip →
Generate (Fast) returns an image with the text in the box. Paste the EXPLORE JSON while in Ideogram
→ app switches to MOSS and draws both boxes. Paste a captioner draft → canvas resizes, boxes match.
Switch back to Ideogram → Ideogram fields untouched, boxes intact.

---

## 6. Phase C — LoRAs (per model + local files)

### 6.1 Findings: using LoRAs without uploading them publicly to HF

Today `handler.py` only downloads from a **public** URL (403 → error). RunPod `/run` bodies are
capped (~10 MB), so LoRA files (50 MB–1.2 GB) cannot ride in the job payload. Options:

| Option | Backend | Effort | Verdict |
|---|---|---|---|
| **Modal Volume** — `modal volume put ideogram-loras my.safetensors /my.safetensors`, volume mounted at `/comfyui/models/loras/user` | Modal | Low | **Recommended for Modal.** One CLI command, no HF, persists, workers see it after `reload()`. |
| **Private HF repo + `HF_TOKEN`** on the worker | RunPod + Modal | Low | **Recommended for RunPod.** Files stay private; upload is one `hf upload` call that `server.py` can do for you. |
| RunPod network volume (S3-compatible API upload) | RunPod | Medium | Works, but pins the endpoint to one datacenter → worse GPU availability. Not recommended. |
| Presigned S3/R2 bucket URL | Both | Medium | Extra account/bucket; no advantage over private HF. |
| Tunnel to your Mac (`cloudflared` serving a local folder) | Both | Low | Every cold worker pulls GBs over home upload; flaky. Not recommended. |

Plan: an **"Add LoRA"** UI that takes either a URL or a local `.safetensors` file. Local files go to
`server.py`, which pushes them to every configured target: Modal Volume (via `modal volume put`)
and/or the private HF repo (via `hf upload`). Both CLIs are already on the machine for
deployment (`uv tool install huggingface_hub` if `hf` is missing). The LoRA entry gets
`filename: "user/<model>/<name>.safetensors"` plus `source_url` (HF resolve URL) when HF is a
target. On Modal the file is already present in the volume → no download; on RunPod the handler
downloads it with `HF_TOKEN`.

### Task C1 — Credentials + server endpoints (`server.py`, `config.example.json`)

```json
"huggingface": { "token": "hf_…", "lora_repo": "Yofardev/private-loras" },
"modal": { "endpoint_url": "…", "auth_token": "…", "lora_volume": "ideogram-loras" }
```

- `GET /api/lora/targets` → `{ "modal": bool, "hf": bool }` (never return the token).
- `POST /api/lora/upload?name=<file>&model=<ideogram|moss>` with the raw file as body
  (stream to `~/.cache/ideogram-builder/loras/<model>/<name>` in 1 MB chunks; reject non
  `.safetensors`, sanitize name with the same regex as `handler._sanitize_filename`).
  Then:
  - Modal: `subprocess.run(["modal", "volume", "put", "--force", vol, local, f"/{model}/{name}"])`.
  - HF: create repo once if needed (`hf repo create <repo> --private --type model`, ignore
    "already exists"), then `hf upload <repo> <local> <model>/<name> --private`, with env
    `HF_TOKEN=<token>`.
  - Response: `{ filename: "user/<model>/<name>", source_url: "https://huggingface.co/<repo>/resolve/main/<model>/<name>" | null, targets: [...] }`.
  - Run uploads in a thread; long uploads must not block the server (it's `ThreadingHTTPServer`, OK).
- Worker secrets: add `HF_TOKEN` to the Modal secret (`modal secret create ideogram-builder AUTH_TOKEN=… HF_TOKEN=…`)
  and to the RunPod endpoint env vars. Document in `runpod/README.md`.

### Task C2 — LoRA library rework (`src/lora.js`, maybe split `lora-library.js` + `lora-add.js`)

- Every built-in entry gets `model: 'ideogram'`. User entries live in
  `localStorage.ideogram_loras_user` (`[{ id, label, filename, source_url, model, strengths }]`),
  merged after built-ins.
- Render only entries with `entry.model === state.model`; on `model:changed` drop active ids of
  the other model, `syncState()`, re-render.
- MOSS cards show one strength slider (positive); Ideogram unchanged.
- `+ Add` button in the LoRA header → inline form: label, model (defaults to current), and either
  **URL** (HF `blob`/`resolve` URL; filename derived like the handler) or **File** (file input +
  drop zone; `fetch('/api/lora/upload?…', { method: 'POST', body: file })`, progress via
  `XMLHttpRequest.upload.onprogress`). Disable the File option with a hint when
  `/api/lora/targets` reports neither target.
- Delete (×) on user entries only.
- `restoreLorasFromMeta` looks up both lists.
- Tests: filtering by model, user entry persistence, restore from meta.

**Phase C acceptance:** add a local MOSS LoRA file → it appears in the MOSS list only → Generate on
Modal applies it (log line "LoRAs active: user/moss/…"); on RunPod the worker downloads it from the
private repo.

---

## 7. Phase D — Secondary surfaces

### Task D1 — Gallery + session

- Wherever generation meta is assembled (follow `image:ready` emit in `queue.js` → `gallery.js`
  `saveToDisk`), add `model`, `negativePrompt`, `promptFormat`, `mossPreset`.
- `gallery.restoreMeta`: emit `model:set` first, then restore preset (Ideogram `steps` radios or
  MOSS `moss_preset` radios), negative, prompt mode. Model chip on cards (`meta.model || 'ideogram'`).
- `session.js`: save/restore `model`, MOSS inputs (`moss-caption`, `moss-meta`, `moss-canvas`,
  `moss-negative`), `promptMode`, MOSS preset, box `tags`. Restore model **before** content so
  json-builder renders the right format. Extend `session.test.js`.

### Task D2 — Collections

- Item schema gets `model` (legacy items → `'ideogram'`). Paste-add: `detectPromptFormat` sets the
  model; caption text allowed for MOSS items.
- `collection:add` payload gains `model` (emitters: gallery card button, JSON header button).
- Batch generate: `enqueueImportJson(item.prompt_json, { model: item.model })`; `buildSnapshot`
  takes `model` from opts when given (negative/preset still from current UI — acceptable v1).
- Preview: chip + for MOSS layouts draw boxes from `parseMoss(...).view` (reuse the existing
  preview renderer with the view JSON).

### Task D3 — PNG import

`png-import.js`: replace the single `inputs.text` → `JSON.parse` loop with: for every node in
`result.prompt`, take `inputs.text` (string) and run `detectPromptFormat`; prefer `ideogram`/`moss`
hits; MOSS hits go through the same path as Task B4 step 3 (emit `model:set`, then
`state:loaded` with `moss`). Keep the Ideogram path unchanged. Extend `png-import.test.js`.

### Task D4 — AI tabs

- `ai-enhancer.js` (+ `server.py` if prompts live there): when `state.model === 'moss'`, use a MOSS
  system prompt. Base it on the official skill
  `https://github.com/OpenMOSS/MOSS-Image/blob/main/skills/moss-image-prompt-enhancer/SKILL.md`
  (fetch it; adapt, don't copy verbatim). Ask the LLM for the **draft** form (`width`, `height`,
  `bbox_coord_space:"abs"`, `bbox_format:"xyxy"`, top-left pixels, labels incl. `character`) using
  the selected aspect ratio's pixel size; or a plain caption if the user picks "Caption" in the tab.
  Load result through `applyJsonText`-equivalent path (emit the same events).
- Vision tab: on result while MOSS, convert the Ideogram JSON with `ideogramGlobalsToMoss` + keep
  elements as-is (editor format is shared) and emit `state:loaded` with a `moss` payload; toast
  *"Converted from Ideogram analysis."*
- Audit: hidden in MOSS (`ideogram-only`) + `moss-only` note "Audit supports Ideogram JSON only".

### Task D5 — Docs

- `CLAUDE.md`: module map rows for `model.js`, `settings-moss.js`, `prompt-moss.js`,
  `prompt-convert.js`, `json-builder-moss.js` (if split), LoRA split files; rule addition:
  *"Pure helpers (`prompt-*.js`, `escape-html.js`) have no DOM/state access and may be imported by
  any module."* Event catalog rows:

  | Event | Payload | Emitted by | Consumed by |
  |---|---|---|---|
  | `model:changed` | `{ model, previous }` | model | settings, settings-moss, json-builder, lora, layers, canvas, session |
  | `model:set` | `{ model }` | json-builder, gallery, session, png-import, collections | model |
  | `state:loaded` | `{ json, moss? }` | (existing) + json-builder (MOSS) | existing + settings-moss |

- `README.md` + `runpod/README.md`: MOSS endpoint setup, credentials keys, LoRA upload flow.

---

## 8. Final verification checklist

- [ ] `npm test` green; `uv run --with pytest pytest runpod` green.
- [ ] Ideogram regression: generate with Turbo + Classic, LoRA on, PNG import, gallery restore,
      collection batch — all unchanged.
- [ ] MOSS: Fast / Quality / Turbo β each produce an image at 768×1152 and 1024×1024; text box
      text renders inside its box (Quality).
- [ ] Model switch round-trip keeps both field sets and all boxes (incl. character + tags).
- [ ] Paste: Ideogram JSON, MOSS compiled, captioner draft, plain caption — each lands in the right model/mode.
- [ ] Reload page → session restores model, MOSS fields, mode, preset.
- [ ] Gallery card from MOSS restores MOSS state; collections mixing both models generate each with its model.
- [ ] Local LoRA upload → visible in MOSS list only → applied on Modal and on RunPod.
- [ ] No file in `src/` over ~200 LOC; `CLAUDE.md` updated.

## 9. Out of scope (v1)

- MOSS-Image-Base model choice, color/depth control LoRA (`MOSSImageControl`), edit LoRAs.
- Per-item negative/preset overrides in collections.
- Renaming the app/brand ("Ideogram Builder").
- Audit/recaption prompts tuned for MOSS.
