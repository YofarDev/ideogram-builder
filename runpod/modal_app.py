"""
Modal backend for Ideogram Builder.

Reuses the existing RunPod image (runpod/Dockerfile): ComfyUI + custom nodes +
the 4 Ideogram-4 models + LoRAs + handler.py. Modal hosts the same container;
the endpoint delegates to handler.handler() unchanged.

Deploy (from repo root):

    modal deploy runpod/modal_app.py

Then create the shared-secret token once (used by the web endpoint + the UI):

    modal secret create ideogram-builder AUTH_TOKEN=<some-secret>

Put the printed URL + that token into ~/.config/llm-credentials.json under "modal":

    "modal": {
      "endpoint_url": "https://<workspace>--ideogram-builder-web-app.modal.run/generate",
      "auth_token": "<same-secret>"
    }

GPU default is T4 (16GB, cheapest). The Classic (v1) dual-model workflow may
need more VRAM — change GPU to "A10G" (24GB) below if it OOMs.
"""

import os
import subprocess
import time
from pathlib import Path

import modal

REPO_ROOT = Path(__file__).resolve().parent.parent
COMFY_HOST = "127.0.0.1:8188"
GPU = os.environ.get("IDEOGRAM_GPU", "T4")  # ponytail: T4 cheapest; A10G if Classic OOMs

# Same image RunPod builds: ComfyUI, KJNodes, rgthree, 4 Ideogram-4 models, LoRAs, handler.py.
COMFY_IMAGE = modal.Image.from_dockerfile(
    "runpod/Dockerfile",
    context_dir=str(REPO_ROOT),
)
# Lightweight proxy that terminates HTTP, checks the token, then calls into the GPU class.
PROXY_IMAGE = modal.Image.debian_slim().pip_install("fastapi")

SECRET = modal.Secret.from_name("ideogram-builder")

app = modal.App("ideogram-builder")


@app.cls(
    image=COMFY_IMAGE,
    gpu=GPU,
    scaledown_window=300,  # keep container warm 5 min after last request
    min_containers=0,      # scale to zero when idle
    timeout=900,           # 15 min per generation (ComfyUI + model load)
    secrets=[SECRET],
)
class Comfy:
    """One ComfyUI process per container, reused across requests."""

    @modal.enter()
    def startup(self):
        env = {**os.environ, "COMFY_API_AVAILABLE_INTERVAL_MS": "500"}
        self.proc = subprocess.Popen(
            [
                "python3", "/comfyui/main.py",
                "--listen", "127.0.0.1", "--port", "8188",
                "--preview-method", "none",
            ],
            env=env,
        )
        # Block until ComfyUI answers. /tmp/comfyui.pid (runpod convention) is
        # absent here, so just poll the HTTP endpoint directly.
        import requests
        for _ in range(600):  # up to 5 min for cold model listing
            if self.proc.poll() is not None:
                raise RuntimeError(f"ComfyUI exited early with code {self.proc.returncode}")
            try:
                if requests.get(f"http://{COMFY_HOST}/", timeout=2).status_code == 200:
                    return
            except Exception:
                pass
            time.sleep(0.5)
        raise RuntimeError("ComfyUI did not become ready")

    @modal.exit()
    def shutdown(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()

    @modal.method()
    def generate(self, payload: dict) -> dict:
        # handler.py is at /handler.py in the image; reuse its full websocket path.
        import sys
        sys.path.insert(0, "/")
        import handler as comfy
        return comfy.handler({"input": payload, "id": "modal"})


@app.function(image=PROXY_IMAGE)
@modal.asgi_app()
def web_app():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware

    api = FastAPI(title="ideogram-builder")
    # Browser calls this cross-origin from localhost; allow all (shared-secret already gates access).
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["*"],
    )
    expected = os.environ.get("AUTH_TOKEN", "")

    @api.post("/generate")
    async def generate(req: Request):
        # ponytail: shared-secret header mirrors RunPod's api_key; URL is also unguessable.
        if expected:
            token = (req.headers.get("authorization") or "").removeprefix("Bearer ").strip()
            if token != expected:
                raise HTTPException(status_code=401, detail="invalid auth token")
        payload = await req.json()
        return Comfy().generate.remote(payload)

    return api
