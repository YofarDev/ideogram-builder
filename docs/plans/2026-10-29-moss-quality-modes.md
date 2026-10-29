# MOSS quality modes — 2026-10-29

Implements the research-driven improvements from
[docs/research/2026-10-29-moss-inference-guide.md](../research/2026-10-29-moss-inference-guide.md)
(the consolidated r/StableDiffusion survey). All state changes are additive:
the frozen Fast/Quality/Turbo recipes and the shipped `rapid-hires-auto-int8-cu128`
production profile are untouched.

## What landed

### 1. Poster β and Quality 30 β candidate presets (`runpod/moss_config.py`)

- **`Poster`**: 25 steps, CFG 3.75, `res_multistep`/simple, SLG single layer 22
  over 0–1. From the community good-text reports (guide §8): CFG 3.5–4 with a
  res-family sampler produced reliable text; the official template notes
  SLG layers 24/26 also help lettering. The report's `res_2s` is **not** a
  ComfyUI sampler name (verified against v0.43.1's `KSAMPLER_NAMES`);
  `res_multistep` is the family member that exists and independently appears
  in the 5.5 MP character-render report.
- **`PosterSLG22-24`**: benchmark-only control isolating the 22 vs 22+24
  layer-set claim (same recipe otherwise). Served only under
  `MOSS_BENCHMARK_MODE`.
- **`Quality30`**: Quality's recipe at 30 steps (iteration-speed report:
  limited perceived loss from 50 → 30).
- SLG layer sets are now preset-configurable (`slg_layers`, builder default
  "22"); the base presets carry no override so the frozen-contract test and
  saved-session semantics are unchanged.
- Both presets ride the existing candidate machinery: enabled on
  adapter/candidate profiles, advertised only with explicit
  `MOSS_EXPERIMENTAL_PRESETS` opt-in or after validation.

### 2. Negative prompt suppressed at CFG 1

`Rapid`/`Turbo`/`Draft3` sample at CFG 1 where the negative branch contributes
nothing (guide §4). The workflow builder and the legacy handler builder now
blank the negative text so a long UI negative is never encoded just to be
ignored; `generation` metadata records `negative_prompt_suppressed`. The UI
grays the field with an explanatory hint (`refreshNegativePromptUI`, driven by
`presetIgnoresNegative` from the local cfg table). The field value is kept —
switching back to a guided preset restores it.

### 3. Optional caption upsampler (`enhance_caption`)

- New MOSS-only request field `enhance_caption` (default false) on both
  backends. When true, the graph inserts a core **`TextGenerate`** node (node
  15) that runs the *same* Qwen text encoder as a generator with the official
  Comfy-Org enhancer system prompt (embedded verbatim in
  `moss_workflow.MOSS_UPSAMPLER_SYSTEM_PROMPT`, extracted from the official
  template; the official sampling parameters, max_length 4096, seed = the
  generation seed for reproducibility) and feeds the generated caption into
  the positive encode. No extra model downloads.
- `generation` records `prompt_upsampler`. `validate_graph` now accepts
  wired optional inputs (`required ∪ optional` membership), needed for
  `TextGenerate.system_prompt`, and expands DynamicCombo child inputs.
  The API graph uses `sampling_mode: "on"` and dotted keys such as
  `sampling_mode.temperature` and `sampling_mode.seed`; ComfyUI constructs
  the nested execution dictionary internally.
- UI: "Enhance Caption" checkbox in the MOSS Scene panel; captured in
  snapshots/sessions/gallery metadata; restored on session and gallery load.
  Off by default — the guide (§7) documents that rewriting can add unwanted
  content and confounds A/B tests.
- Caption-only: disabled in Layout mode, suppressed on queued collection
  layouts, and rejected server-side for structured JSON. The official
  rewriter emits prose and must not replace centered-yxyx layout objects.
- Older gallery/session metadata defaults enhancement to false, rather than
  inheriting a previous enhanced run. Explicit saved settings still restore.
- `TextGenerate` and its system-prompt input already exist at the baseline
  pin (`7cebca52227c63b4180ceed448cbd7ad22903b6d`); v0.43.1 is not required
  merely for this node. GPU validation of the enhancement path is still needed.

### 4. Full FLUX.2 VAE profile for 4 MP

- Manifest gains **`vae_full`** (`Comfy-Org/MOSS-Image` `vae/flux2-vae.safetensors`,
  sha256 `868fe7b3…`, LFS oid resolved 2026-10-29; volume candidate, populated
  by `moss_populate_models`).
- `_profile()` accepts `vae_asset`; new candidate profile
  **`rapid-hires-vae-full-auto-int8-cu128`** — the shipped Rapid 4/6/8-step
  policy with the full decoder (the community 4 MP recipe's VAE, guide §3).
  Its `-warm` twin is auto-declared. `required_asset_keys` /
  `resolve_profile_assets` already honoured `vae_asset`, so resolution,
  startup checks and benchmarks needed no further changes.

### 5. ComfyUI v0.43.1 as an explicit build candidate

The runtime lock's policy is "never silently upgraded in place", so the pin
is **not** changed by default:

- `MOSS_COMFYUI_BUILD=v0431` (deploy-time env) passes
  `COMFY_REVISION=086099f5d8886163ef77dc354f8382cb7431582a` as a Docker build
  arg; `baseline` (default) keeps the Dockerfile's validated pin. The choice
  is recorded in the container env and the lock.
- Combining that candidate with `MOSS_CACHED_IMAGE_ID` is rejected at import
  time. Unset the cached-image ID for the full rebuild. Deployment manifests
  record the selected ComfyUI build and revision.
- `moss-runtime.lock.json` now carries the resolved v0.43.1 tag/revision
  (v0.43.1 over v0.43.0 for the follow-up fixes). v0.43.x adds MOSS RoPE
  scaling, color-depth control, edit-LoRA support and lower peak memory
  (guide §2) — RoPE scaling is the relevant mitigation path for high-res
  duplication on the new 4 MP Rapid tier.
- **Revalidation required before promoting**: comfy-kitchen's version and
  CUDA-backend gating move with ComfyUI's requirements; the cu128/cu130
  conclusions measured against the baseline pin do not carry over. Run the
  benchmark matrix on a `v0431` build before switching production.

### 6. SFT destripe LoRAs in the built-in library

Two opt-in fixes for vertical banding on SFT at large sizes (guide §10),
pinned to immutable HF revisions and downloaded on demand like every built-in
LoRA:

- `moss-destripe-top64` — nynxz's 1.9 MB extracted adapter
  (`@59d3547a…`), strength 1 (author guidance: up to 1.5 around 1024²).
- `moss-destripe-blocks` — Kijai's blocks 21–49 rank-512 reversion
  (`@9869b285…`, referenced by the official Comfy-Org template), **negative
  −0.5 strength** — the reason the strength slider now spans −1…2.

MATLOWAI's DeBand layer-reversion checkpoint was deliberately **not** added:
its rapid-moss branch warns that fused Comfy-Org weights (our Rapid path) can
silently produce noise or black images.

### DMD2 "Turbo β2" — investigated and dropped

The paired SFT-DMD2 report (sharper, less bokeh) does not survive scrutiny:
the announcement thread exposes no resolvable HuggingFace repository (no repo
for the author, nothing under `MOSS DMD2` searches), and its accessible
comments are predominantly negative — pattern artifacts in grass/foliage
("GPT image style sloppy artifacts") and style collapse the OP concedes
("80s film texture and 90s DnD style lost"). With no pinnable sha256 and
negative community evidence, adding the asset would violate the manifest's
evidence discipline. Revisit if the author publishes a card.

## Deployment / validation sequence

1. Deploy unchanged sources with the current profile — nothing below is
   enabled by default; this is a no-op safety check.
2. Trial the new modes on a separate Modal preview app, keeping production's
   cu128 formats, residency and small VAE. The production profile does not
   technically enable Poster/Quality30; an experimental allow-list alone
   cannot add them. Use the dedicated candidate profile:

   ```sh
   MOSS_APP_NAME=ideogram-builder-quality-preview \
   MOSS_RUNTIME_PROFILE=rapid-hires-quality-modes-auto-int8-cu128 \
   MOSS_RUNTIME_BUILD=baseline MOSS_COMFYUI_BUILD=baseline \
   MOSS_ENABLED_PRESETS= MOSS_EXPERIMENTAL_PRESETS=Rapid,Poster,Quality30 \
   modal deploy runpod/modal_app.py --env main
   ```

   All three candidate recipes are explicitly experimental. Benchmark
   `Poster` vs benchmark-only `PosterSLG22-24`, then `Quality30` vs `Quality`:

   ```sh
   MOSS_RUNTIME_BUILD=baseline MOSS_COMFYUI_BUILD=baseline \
   modal run runpod/modal_app.py::moss_benchmark_main \
     --profiles rapid-hires-quality-modes-auto-int8-cu128 \
     --presets Poster,PosterSLG22-24,Quality30,Quality
   ```

   The benchmark worker enables benchmark mode internally; the control is
   never advertised by the ordinary generation endpoint.
3. Use `modal run runpod/modal_app.py::moss_populate_models` to fetch volume
   assets, including `vae_full`. Then deploy the full-VAE trial separately:

   ```sh
   MOSS_APP_NAME=ideogram-builder-vae-preview \
   MOSS_RUNTIME_PROFILE=rapid-hires-vae-full-auto-int8-cu128 \
   MOSS_RUNTIME_BUILD=baseline MOSS_COMFYUI_BUILD=baseline \
   MOSS_ENABLED_PRESETS= MOSS_EXPERIMENTAL_PRESETS=Rapid \
   modal deploy runpod/modal_app.py --env main
   ```

   Rapid must be explicitly opted in because this profile is a candidate.
   Visually compare 2/4 MP against the small-VAE production profile before
   promoting. These are deployment instructions, not evidence of execution.
4. Separately trial `MOSS_COMFYUI_BUILD=v0431` with
   `MOSS_CACHED_IMAGE_ID=` for the full image rebuild and kernel/runtime
   revalidation matrix. Baseline caption enhancement can be tested without
   changing the ComfyUI revision.

## Test evidence

- Backend: 241 passed (`uv run --with pytest --with requests --with
  websocket-client --with modal pytest runpod/`), +38 over the prior 203 —
  covering preset recipes, SLG layer sets, negative suppression in both
  builders, upsampler graph wiring + schema validation with optional inputs,
  vae_full manifest/resolution, and the v0431 build-arg selection.
- Frontend: 513 passed (`npx vitest run`), +20 over the prior 493 — preset
  info/cfg table, negative-field availability, enhance toggle binding,
  snapshot/request plumbing for both backends, session/gallery restore, and
  the destripe library entries incl. the negative-strength slider.

### Review follow-up verification

- Graph schema tests use a pinned TextGenerate input-schema fixture, including
  DynamicCombo child definitions. They reject nested objects, missing sampling
  fields and unknown inputs. The handler validates the enhancer node against
  the deployed schema before queueing when `/object_info` is available.
- Separate CPU checks executed the actual ComfyUI DynamicCombo finalizer and
  `TextGenerate.execute` source from both baseline and v0.43.1, with only the
  model calls stubbed. Both accepted the corrected API graph and preserved the
  sampling settings and seed. This is an input-contract check, not GPU inference.
- Regression tests cover structured-layout rejection/preservation, collection
  layout submissions from Caption mode, saved-enhancement defaults, checkbox
  availability, the documented trial profile/opt-ins, and conflicting cached
  image/build selection.
- All review fixes are local source changes. No preview/production deploy,
  full container build or GPU quality validation was performed for them.
