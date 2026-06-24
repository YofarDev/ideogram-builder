# Modal Backend Design

## Goal

Add Modal as an alternative serverless GPU backend alongside RunPod. User picks
RunPod or Modal from a toolbar toggle; the existing queue/generation flow runs
unchanged. The entire RunPod architecture (Dockerfile, `handler.py`, ComfyUI
workflow logic) is reused verbatim — Modal just hosts the same container.

## Decisions

- **Reuse, don't rewrite:** Modal runs the existing `runpod/Dockerfile` image
  via `modal.Image.from_dockerfile`. ComfyUI, custom nodes, the 4 Ideogram-4
  models, LoRAs, and `handler.py` are all unchanged.
- **Handler delegation:** the Modal endpoint imports `handler.py` and calls its
  existing `handler({"input":...})` — same websocket/history/base64 path. Zero
  logic duplication.
- **Synchronous, no polling:** Modal returns the image in one HTTP response.
  `modal.js` is simpler than `runpod.js` (no `/status` loop).
- **GPU:** `T4` (16GB, cheapest). Turbo (single-model) workflow fits comfortably;
  Classic (dual-model) may need bumping to `A10G` — noted in a comment.
- **Warm containers:** `@app.cls(scaledown_window=300, min_containers=0)` keeps
  a container alive 5 min after idle; `@modal.enter()` starts ComfyUI once per
  container via `subprocess.Popen`.
- **Auth:** shared-secret `Authorization: Bearer <token>` header checked in the
  endpoint against `os.environ["AUTH_TOKEN"]` (Modal Secret). Mirrors RunPod's
  api_key.
- **Toggle persistence:** `localStorage.ideogram_backend` (`runpod` | `modal`),
  wired like the existing workflow toggle.
- **Config:** `modal: { endpoint_url, auth_token }` added to
  `~/.config/llm-credentials.json`, surfaced via `/api/config`.

## Architecture

```
toolbar [RunPod|Modal] pill  →  localStorage.ideogram_backend
                                     │
queue.drain() ── runJob(snapshot) ─► backend.js (dispatcher)
                                     ├─ runpod.runJob  (poll /status)
                                     └─ modal.runJob   (single POST)
                                            │
                                            ▼  POST {input...} Bearer token
                                  https://<ws>--ideogram-builder-comfy.modal.run
                                            │
                                  @app.cls Comfy (T4, warm)
                                    @modal.enter() → Popen comfyui main.py
                                    @modal.asgi_app() → auth check → handler.handler()
                                            │
                                  { images:[{data:base64}] }
```

### `src/backend.js` (NEW, ~15 LOC)
Dispatcher. Caches `/api/config` once. Exports `runJob(snapshot, opts)` that
reads `localStorage.ideogram_backend` and delegates to `runpod.js` or `modal.js`.
Both backends return the same `{ dataUrl, imageUrl }` shape.

### `src/modal.js` (NEW, ~45 LOC)
- `getConfig()` → `data.modal` (`endpoint_url`, `auth_token`); throws if missing.
- `runJob(snapshot, { onStatus, signal })`: single `fetch(POST)` to
  `endpoint_url` with `Authorization: Bearer <auth_token>` and the same
  `input` body shape RunPod uses. A 1s `onStatus` ticker runs until the response
  settles (mirrors runpod.js UX). Unwraps `result.images[0].data` → dataURL/blob
  → `{ dataUrl, imageUrl }`.

### `runpod/modal_app.py` (NEW, ~75 LOC)
- `image = modal.Image.from_dockerfile("runpod/Dockerfile", context=repo_root)`
  (paths resolved from `__file__`).
- `@app.cls(gpu="T4", image=image, scaledown_window=300, min_containers=0, timeout=900)`
- `@modal.enter() def startup`: `Popen(["python3","/comfyui/main.py","--listen","127.0.0.1","--port","8188"])`, then block on the existing `handler.check_server()`.
- `@modal.asgi_app()`: FastAPI app, one `POST /generate` route → verify Bearer
  token == `os.environ["AUTH_TOKEN"]` → `return handler.handler({"input": body, "id":"modal"})`.
- AUTH_TOKEN via `modal.Secret.from_name("ideogram-builder")` (env `AUTH_TOKEN`).
- Deploy: `modal deploy runpod/modal_app.py` (run from repo root). Prints URL.

## Frontend changes

| File | Change |
|------|--------|
| `index.html` | Add `#backend-toggle` pill group (RunPod/Modal radios) in toolbar next to workflow toggle |
| `src/settings.js` | Wire backend radios, persist `localStorage.ideogram_backend`, default `runpod` |
| `src/queue.js` | `import { runJob } from './backend.js'` (was `./runpod.js`) |
| `src/backend.js` | NEW — dispatcher |
| `src/modal.js` | NEW — Modal caller |

## Server change

| File | Change |
|------|--------|
| `server.py` | Add `"modal"` to the `/api/config` key allowlist (line ~133) |

## Config shape

```json
"modal": {
  "endpoint_url": "https://<workspace>--ideogram-builder-comfy-generate.modal.run",
  "auth_token": "<secret>"
}
```

## Error handling

- Modal not configured (missing `endpoint_url`/`auth_token`) → `runJob` throws
  with a message pointing at the credentials file (same UX as RunPod path).
- 401/403 from endpoint → "Modal auth failed — check auth_token".
- Non-ok response → surface status + body text.
- Abort → `AbortError` propagates; queue handles cancel as today.

## Out of scope

- Modal Volume for model weights (baked in image, same as RunPod; revisit if
  rebuild cost matters).
- Separate `modal/` directory (colocated with the Dockerfile it reuses).
- README; deploy steps live as comments in `modal_app.py`.
- GPU auto-selection per workflow (Classic→A10G); manual edit only.

## Testing

Manual: deploy Modal app, set credentials, toggle to Modal, Generate, confirm
image returns + canvas overlay + gallery save all work as under RunPod. Toggle
back to RunPod, confirm unchanged.
