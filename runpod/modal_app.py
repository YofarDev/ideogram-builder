"""
Modal backend for Ideogram Builder.

Hosts two ComfyUI workers behind one token-authed web proxy:

- `Comfy` — the RunPod Ideogram-4 image (runpod/Dockerfile)
- `ComfyMossWorker` — the MOSS-Image image (runpod/Dockerfile.moss) with
  MOSS-only deployment settings; `ComfyMossSnapshotWorker` replaces it as the
  proxy target when MOSS_SNAPSHOT_MODE=gpu_experimental (experimental).

The proxy routes on the request body: `{"model": "moss"}` → ComfyMossWorker,
anything else → Comfy. User-uploaded LoRAs live in the "ideogram-loras" Modal
Volume, mounted at /comfyui/models/loras/user on both classes and reloaded
before each job (`modal volume put ideogram-loras <local> /moss/name.safetensors`).

MOSS worker settings are SEPARATE from the Ideogram worker (GPU, launch args,
memory policy, lifetime, warmup, snapshots) and are configured at deploy time:

    MOSS_GPU                   GPU for ComfyMoss only        (default IDEOGRAM_GPU)
    MOSS_RUNTIME_PROFILE       named runtime profile         (default "rapid-hires-auto-int8-cu128")
    MOSS_MEMORY_MODE           auto|highvram|gpu_only        (profile override)
    MOSS_DIT_FORMAT            int8_convrot|bf16             (profile override)
    MOSS_ENCODER_FORMAT        w4a8|int8_convrot|bf16        (profile override)
    MOSS_COMPILE_BACKEND       off|inductor|cudagraphs       (profile override)
    MOSS_WARMUP                warm representative workflow after readiness (default false)
    MOSS_ENABLED_PRESETS       comma allow-list ∩ profile support
    MOSS_MIN_CONTAINERS        0|1                           (default 0)
    MOSS_SCALEDOWN_SECONDS     300|600|1200                  (default 300)
    MOSS_SNAPSHOT_MODE         off|gpu_experimental          (default off)
    MOSS_STARTUP_DIAG          print runtime_check report at startup (default true)

Override combinations are validated by runpod/moss_config.resolve_profile():
only declared, immutable profile IDs are ever served. GET /capabilities serves
the validated preset list from deploy-time configuration — it never starts a
GPU container.

Volumes:
    ideogram-loras    user LoRAs (both workers, unchanged)
    moss-models       optional pinned benchmark assets (runpod/moss_assets.py populate)
    moss-compile-cache|moss-compile-cache-dev  persistent Inductor/Triton caches
    moss-bench        benchmark artifacts

Deploy (from repo root):
    modal deploy runpod/modal_app.py

Then create the shared-secret token once (used by the web endpoint + the UI):

    modal secret create ideogram-builder AUTH_TOKEN=<some-secret>

Put the printed URL + that token into ~/.config/llm-credentials.json under "modal":

    "modal": {
      "endpoint_url": "https://<workspace>--ideogram-builder-web-app.modal.run/generate",
      "auth_token": "<same-secret>"
    }

GPU default is RTX-PRO-6000 (96GB) for both workers; set IDEOGRAM_GPU=A10G at
deploy time for cheaper hardware.
"""

import inspect
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import modal

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNPOD_DIR = Path(__file__).resolve().parent
COMFY_HOST = "127.0.0.1:8188"
GPU = os.environ.get("IDEOGRAM_GPU", "RTX-PRO-6000")  # 96GB; set A100-80GB for Classic

# --- MOSS deployment settings (evaluated at deploy time, baked into env) -------
MOSS_GPU = os.environ.get("MOSS_GPU", GPU)
MOSS_STARTUP_DIAG = (os.environ.get("MOSS_STARTUP_DIAG") or "true").strip().lower() != "false"
MOSS_SNAPSHOT_MODE = (os.environ.get("MOSS_SNAPSHOT_MODE") or "off").strip().lower()

# Validate profile + deployment knobs ONCE at deploy time so a bad combination
# fails `modal deploy` instead of every request.
import moss_config  # noqa: E402  (runpod/ is this file's directory)

_deploy_env = dict(os.environ)
# Permanent production default; baseline remains an explicit rollback profile.
_deploy_env.setdefault("MOSS_RUNTIME_PROFILE", "rapid-hires-auto-int8-cu128")
MOSS_PROFILE = moss_config.resolve_profile(_deploy_env)
MOSS_DEPLOYMENT = moss_config.deployment_settings(_deploy_env)
MOSS_ENABLED_PRESETS = moss_config.resolve_enabled_presets(_deploy_env)[1]

# Env baked into the MOSS GPU container + proxy so runtime code sees the same
# configuration the deploy validated. The experimental allow-list is parsed and
# validated here (deploy-time) so an unknown name fails `modal deploy` rather
# than surprising the proxy at request time.
_MOSS_EXPERIMENTAL_PRESETS = moss_config.resolve_experimental_presets(_deploy_env)
_MOSS_ENV = {
    "MOSS_RUNTIME_PROFILE": MOSS_PROFILE["profile_id"],
    "MOSS_RUNTIME_BUILD": os.environ.get("MOSS_RUNTIME_BUILD", "baseline"),
    "MOSS_APP_NAME": os.environ.get("MOSS_APP_NAME", "ideogram-builder"),
    "MOSS_STARTUP_DIAG": str(MOSS_STARTUP_DIAG).lower(),
    "MOSS_ENABLED_PRESETS": ",".join(MOSS_ENABLED_PRESETS),
    "MOSS_EXPERIMENTAL_PRESETS": ",".join(_MOSS_EXPERIMENTAL_PRESETS),
    "MOSS_MIN_CONTAINERS": str(MOSS_DEPLOYMENT["min_containers"]),
    "MOSS_SCALEDOWN_SECONDS": str(MOSS_DEPLOYMENT["scaledown_seconds"]),
    "MOSS_SNAPSHOT_MODE": MOSS_DEPLOYMENT["snapshot_mode"],
}
# Freeze the canonical profile, rather than reapplying partial overrides remotely.
_LOCK_PATH = next((p for p in (RUNPOD_DIR / "moss-runtime.lock.json", Path("/moss-runtime.lock.json"), Path("/root/moss-runtime.lock.json")) if p.exists()), None)
if _LOCK_PATH is None:
    raise RuntimeError("MOSS runtime lock is missing from the image")
_RUNTIME_LOCK = json.loads(_LOCK_PATH.read_text())
_RUNTIME_BUILD = _MOSS_ENV["MOSS_RUNTIME_BUILD"]
if _RUNTIME_BUILD not in ("baseline", "cu130"):
    raise moss_config.ProfileError("MOSS_RUNTIME_BUILD must be baseline or cu130")
_MOSS_BUILD_ARGS = {}
if _RUNTIME_BUILD == "cu130":
    candidate = _RUNTIME_LOCK["candidate_runtime_cu130"]
    _MOSS_BUILD_ARGS = {
        "TORCH_SPEC": " ".join(f"{package}=={candidate[package]}" for package in ("torch", "torchvision", "torchaudio")),
        "TORCH_INDEX": candidate["index"],
    }

# ComfyUI revision candidate, orthogonal to the wheel set: the runtime lock's
# policy is "never silently upgraded in place", so v0.43.1 (MOSS RoPE scaling,
# color-depth control, edit-LoRA support, lower peak memory) is an explicit
# MOSS_COMFYUI_BUILD=v0431 deploy that overrides the Dockerfile's baseline
# ARG. Default keeps the validated baseline revision.
_COMFYUI_BUILD = os.environ.get("MOSS_COMFYUI_BUILD", "baseline").strip()
_COMFYUI_CANDIDATES = {
    "v0431": _RUNTIME_LOCK["baseline_runtime"]["comfyui_v043_candidate"]["revision"],
}
if _COMFYUI_BUILD not in ("baseline", *_COMFYUI_CANDIDATES):
    raise moss_config.ProfileError(
        f"MOSS_COMFYUI_BUILD must be baseline or one of {', '.join(_COMFYUI_CANDIDATES)}")
if _COMFYUI_BUILD != "baseline":
    _MOSS_BUILD_ARGS["COMFY_REVISION"] = _COMFYUI_CANDIDATES[_COMFYUI_BUILD]
_COMFYUI_REVISION = _MOSS_BUILD_ARGS.get("COMFY_REVISION", _RUNTIME_LOCK["baseline_runtime"]["comfyui"]["revision"])
_MOSS_ENV["MOSS_COMFYUI_BUILD"] = _COMFYUI_BUILD

# Same image RunPod builds: ComfyUI, KJNodes, rgthree, 4 Ideogram-4 models, LoRAs, handler.py.
# Deploy-time cached-image reuse (plan 2026-10-28 §1): MOSS_CACHED_IMAGE_ID /
# IDEOGRAM_CACHED_IMAGE_ID name previously built immutable images; only the
# small source overlay is re-baked on top via add_local_file(copy=True), so a
# Python-only change costs no multi-GB weights download or reinstall. The IDs
# are workspace-specific — they are never hard-coded as source defaults; empty
# means a full Dockerfile build (the reproducible path for dependency/model
# changes). A requested ID that does not exist fails deploy/run loudly
# (Image.from_id raises), which is the intended clear failure.
IDEOGRAM_CACHED_IMAGE_ID = (os.environ.get("IDEOGRAM_CACHED_IMAGE_ID") or "").strip()
MOSS_CACHED_IMAGE_ID = (os.environ.get("MOSS_CACHED_IMAGE_ID") or "").strip()
if MOSS_CACHED_IMAGE_ID and _COMFYUI_BUILD != "baseline":
    raise moss_config.ProfileError(
        "MOSS_COMFYUI_BUILD requires a full image rebuild; unset MOSS_CACHED_IMAGE_ID "
        "so the requested ComfyUI revision cannot be bypassed by a cached image.")

# Source overlays mirroring the Dockerfiles' COPY lists COMPLETELY: every file
# the image ships from the repo is re-layered, so stale copies baked into a
# cached image cannot shadow the new sources. test_modal_moss_lifecycle.py
# asserts this coverage against the Dockerfiles themselves.
IDEOGRAM_OVERLAY_FILES = (
    ("runpod/handler.py", "/handler.py"),
    ("runpod/workflow_template_lora_turbo.json", "/workflow_template_turbo.json"),
    ("runpod/workflow_template_lora.json", "/workflow_template_lora.json"),
)
MOSS_OVERLAY_FILES = (
    ("runpod/handler.py", "/handler.py"),
    ("runpod/workflow_template_moss.json", "/workflow_template_moss.json"),
    ("runpod/moss_config.py", "/moss_config.py"),
    ("runpod/moss_workflow.py", "/moss_workflow.py"),
    ("runpod/moss_assets.py", "/moss_assets.py"),
    ("runpod/comfy_metrics.py", "/comfy_metrics.py"),
    ("runpod/moss_benchmark.py", "/moss_benchmark.py"),
    ("runpod/moss_benchmark_worker.py", "/moss_benchmark_worker.py"),
    ("runpod/moss_cache.py", "/moss_cache.py"),
    ("runpod/moss_memory.py", "/moss_memory.py"),
    ("runpod/runtime_check.py", "/runtime_check.py"),
    ("runpod/moss-models.json", "/moss-models.json"),
    ("runpod/moss-runtime.lock.json", "/moss-runtime.lock.json"),
    ("runpod/benchmarks/moss/fixtures.json", "/benchmarks/moss/fixtures.json"),
    ("runpod/custom_nodes/moss_runtime/__init__.py", "/comfyui/custom_nodes/moss_runtime/__init__.py"),
)


def _worker_image(cached_image_id, dockerfile, overlay_files, *, build_args=None):
    """Cached immutable weights/dependency base + this checkout's sources.

    With cached_image_id set, Image.from_id supplies the heavy layers and only
    the overlay is built. Otherwise the full Dockerfile path is used. Overlay
    order matches the Dockerfile so later sources win."""
    if cached_image_id:
        image = modal.Image.from_id(cached_image_id)
        print(f"[image] reusing cached image {cached_image_id} with a "
              f"{len(overlay_files)}-file source overlay")
    else:
        image = modal.Image.from_dockerfile(
            dockerfile, context_dir=str(REPO_ROOT), build_args=build_args or {})
    for source, remote in overlay_files:
        image = image.add_local_file(REPO_ROOT / source, remote, copy=True)
    return image


COMFY_IMAGE = _worker_image(IDEOGRAM_CACHED_IMAGE_ID, "runpod/Dockerfile", IDEOGRAM_OVERLAY_FILES)
# MOSS-Image twin: pinned ComfyUI + rgthree + Spectrum, MOSS models, helper modules, same handler.
MOSS_IMAGE = _worker_image(
    MOSS_CACHED_IMAGE_ID, "runpod/Dockerfile.moss", MOSS_OVERLAY_FILES,
    build_args=_MOSS_BUILD_ARGS,
).env(_MOSS_ENV)
# Lightweight proxy that terminates HTTP, checks the token, then calls into the
# GPU class. Carries moss_config/moss_assets so /capabilities resolves the
# deployment configuration without ever touching a GPU container.
PROXY_IMAGE = (
    modal.Image.debian_slim()
    .pip_install("fastapi")
    .add_local_file(RUNPOD_DIR / "moss_config.py", "/root/moss_config.py")
    .add_local_file(RUNPOD_DIR / "moss_assets.py", "/root/moss_assets.py")
    .add_local_file(RUNPOD_DIR / "moss-models.json", "/root/moss-models.json")
    .add_local_file(_LOCK_PATH, "/root/moss-runtime.lock.json")
)

SECRET = modal.Secret.from_name("ideogram-builder")

app = modal.App(_MOSS_ENV["MOSS_APP_NAME"])

# Volumes: user LoRAs (shared), MOSS benchmark models, compiler caches, bench artifacts.
LORA_VOL = modal.Volume.from_name("ideogram-loras", create_if_missing=True)
MOSS_MODELS_VOL = modal.Volume.from_name("moss-models", create_if_missing=True)
MOSS_COMPILE_CACHE_VOL = modal.Volume.from_name("moss-compile-cache", create_if_missing=True)
MOSS_COMPILE_CACHE_VOL_DEV = modal.Volume.from_name("moss-compile-cache-dev", create_if_missing=True)
MOSS_BENCH_VOL = modal.Volume.from_name("moss-bench", create_if_missing=True)

MOSS_VOLUMES = {
    "/comfyui/models/loras/user": LORA_VOL,
    "/moss-models": MOSS_MODELS_VOL,
    "/moss-compile-cache": MOSS_COMPILE_CACHE_VOL,
    "/moss-compile-cache-dev": MOSS_COMPILE_CACHE_VOL_DEV,
}


class _ComfyWorker:
    """Shared ComfyUI lifecycle. Plain methods, called by the Modal-decorated
    subclasses below — Modal requires each worker declared as its own @app.cls."""

    def comfy_args(self):
        return [
            "python3", "/comfyui/main.py",
            "--listen", "127.0.0.1", "--port", "8188",
            "--preview-method", "none",
        ]

    def comfy_env(self, env):
        return {**env, "COMFY_API_AVAILABLE_INTERVAL_MS": "500"}

    def post_ready(self):
        """Hook after the HTTP server answers, before serving requests."""
        return

    def pre_start(self):
        """Prepare files and environment before the server imports model paths."""

    def startup(self):
        sys.path.insert(0, "/")
        import handler as comfy
        self.worker_instance_id = comfy.reset_worker_identity()
        self.pre_start()
        env = self.comfy_env(os.environ)
        args = self.comfy_args()
        print(f"[startup] launching ComfyUI: {' '.join(args[1:])}")
        self.proc = subprocess.Popen(args, env=env)
        # Block until ComfyUI answers. HTTP readiness only — model readiness
        # is post_ready()'s job. /tmp/comfyui.pid (runpod convention) is
        # absent here, so just poll the HTTP endpoint directly.
        import requests
        for _ in range(600):  # up to 5 min for cold model listing
            if self.proc.poll() is not None:
                raise RuntimeError(f"ComfyUI exited early with code {self.proc.returncode}")
            try:
                if requests.get(f"http://{COMFY_HOST}/", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            raise RuntimeError("ComfyUI did not become ready")
        self.post_ready()

    def shutdown(self):
        if not getattr(self, "proc", None):
            return
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=10)

    def generate(self, payload: dict) -> dict:
        # Pick up LoRAs uploaded to the volume since the last job. Tolerate
        # failure: ComfyUI keeps volume files mmap'd after first use, and
        # Modal refuses to reload while handles are open — without the
        # try/except every queued job after the first fails with "there are
        # open files preventing the operation". A stale view is harmless:
        # ensure_loras re-downloads anything missing from its source_url, so
        # we only lose picking up external `modal volume put` uploads on a
        # warm container.
        try:
            LORA_VOL.reload()
        except Exception as e:
            print(f"[volume] reload skipped: {e}", file=sys.stderr, flush=True)
        # handler.py is at /handler.py in the image; reuse its full websocket
        # path. (sys comes from the module import — a function-level
        # `import sys` here would shadow it for the whole scope and break the
        # sys.stderr reference in the except block above.)
        sys.path.insert(0, "/")
        import handler as comfy
        return comfy.handler({"input": payload, "id": "modal"})


# --- MOSS-specific lifecycle ---------------------------------------------------

def _moss_comfy_args(profile):
    """Launch flags implied by the profile. Memory modes are alternatives —
    never combine the mutually exclusive residency flags."""
    args = [
        "python3", "/comfyui/main.py",
        "--listen", "127.0.0.1", "--port", "8188",
        "--preview-method", "none",
    ]
    if profile["memory_mode"] == "highvram":
        args.append("--highvram")
    elif profile["memory_mode"] == "gpu_only":
        args.append("--gpu-only")
    # Triton is comfy-kitchen's opt-in backend; leave it off unless a dedicated
    # profile validates it (do not enable every experimental --fast option).
    return args


class ComfyMoss(_ComfyWorker):
    """MOSS-Image worker: MOSS deployment settings, asset verification,
    optional compiler-cache env, optional representative warmup."""

    _profile = MOSS_PROFILE

    _enabled_presets = MOSS_ENABLED_PRESETS

    def pre_start(self):
        import moss_assets
        import moss_cache
        import runtime_check

        # Parent handler and child must read the same canonical configuration.
        canonical = self.comfy_env(os.environ)
        for var in (*moss_config.PROFILE_ENV_FIELDS, "MOSS_WARMUP"):
            os.environ.pop(var, None)
        os.environ.update(canonical)
        # A dedicated explicit file preserves any user-owned default config.
        moss_assets.write_extra_model_paths("/tmp/moss-extra-model-paths.yaml")
        moss_assets.assert_profile_assets(self._profile, self._enabled_presets)
        self._cache = None
        if self._profile["compile_backend"] != "off":
            self._cache = moss_cache.prepare(
                self._profile, runtime_check.collect(), moss_assets.load_manifest(),
                json.loads(Path("/moss-runtime.lock.json").read_text()))

    def comfy_args(self):
        return _moss_comfy_args(self._profile) + ["--extra-model-paths-config", "/tmp/moss-extra-model-paths.yaml"]

    def comfy_env(self, env):
        result = {**env, **_MOSS_ENV, "MOSS_RUNTIME_PROFILE": self._profile["profile_id"],
                  "MOSS_ENABLED_PRESETS": ",".join(self._enabled_presets),
                  "COMFY_API_AVAILABLE_INTERVAL_MS": "500"}
        # Do not let inherited overrides change the selected benchmark profile.
        for var in (*moss_config.PROFILE_ENV_FIELDS, "MOSS_WARMUP"):
            result.pop(var, None)
        if getattr(self, "_cache", None):
            result.update(self._cache["env"])
        return result

    def post_ready(self):
        import requests
        import runtime_check

        # This runs in the child after ComfyUI has applied quant_ops policy.
        response = requests.get(f"http://{COMFY_HOST}/moss/runtime", timeout=120)
        response.raise_for_status()
        self.runtime_info = response.json()
        self.runtime_info.update(runtime_profile=self._profile["profile_id"], runtime_build=_RUNTIME_BUILD,
                                 runtime_lock_id=_RUNTIME_LOCK["lock_id"],
                                 worker_instance_id=self.worker_instance_id)
        if MOSS_STARTUP_DIAG:
            print("[startup] ComfyUI runtime: " + json.dumps(self.runtime_info, default=str))
        runtime_check.enforce_profile_requirements(self._profile, self.runtime_info)
        import moss_assets
        loaders = requests.get(f"http://{COMFY_HOST}/object_info", timeout=30)
        loaders.raise_for_status()
        moss_assets.assert_loader_visibility(self._profile, self._enabled_presets, loaders.json())
        if getattr(self, "_cache", None):
            self.runtime_info["compiler_cache"] = {k: self._cache[k] for k in ("namespace", "worker", "reused_from")}
        if self._profile.get("warmup"):
            self.run_warmup()

    def shutdown(self):
        super().shutdown()
        if getattr(self, "_cache", None):
            import moss_cache
            moss_cache.publish(self._cache)
            MOSS_COMPILE_CACHE_VOL.commit()

    def run_warmup(self):
        """One representative warmup workflow after HTTP readiness: warms the
        profile's DiT/encoder/VAE, an enabled recipe and the compile bucket at
        1024². Warmup jobs are marked (prefix 'warmup') and their outputs are
        deleted — they never enter user history. One warmup does NOT initialise
        every preset; preset/shape switches still carry first-use cost."""
        import json as _json
        import uuid as _uuid

        import moss_assets
        import moss_workflow
        import requests

        sys.path.insert(0, "/")
        started = time.monotonic()
        try:
            template = _json.loads(Path("/workflow_template_moss.json").read_text())
            assets = moss_assets.resolve_profile_assets(self._profile)
            preset_id = "Turbo" if "Turbo" in self._enabled_presets else self._enabled_presets[0]
            preset = moss_config.MOSS_PRESETS[preset_id]
            adapter_ref = None
            if preset["adapter"] and not self._profile.get("merged_adapter"):
                adapter_ref = moss_assets.resolve_adapter(preset["adapter"])[1]
            wf, _ = moss_workflow.build_moss_workflow(
                template, preset_name=preset_id, preset=preset, prompt="warmup",
                negative="", width=1024, height=1024, seed=0, loras=[],
                profile=self._profile, assets=assets, adapter_ref=adapter_ref)
            wf["12"]["inputs"]["filename_prefix"] = "warmup/warmup"
            client_id = f"warmup-{_uuid.uuid4()}"
            resp = requests.post(
                f"http://{COMFY_HOST}/prompt",
                data=_json.dumps({"prompt": wf, "client_id": client_id}),
                headers={"Content-Type": "application/json"}, timeout=30)
            resp.raise_for_status()
            prompt_id = resp.json()["prompt_id"]
            for _ in range(1200):  # up to 10 min for the first uncached run
                if self.proc.poll() is not None:
                    raise RuntimeError(f"warmup: ComfyUI exited early ({self.proc.returncode})")
                history = requests.get(f"http://{COMFY_HOST}/history/{prompt_id}", timeout=10).json()
                if prompt_id in history:
                    status = history[prompt_id].get("status", {})
                    if status.get("status_str") == "error":
                        raise RuntimeError(f"warmup workflow failed: {status}")
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError("warmup workflow did not complete in 10 min")
            # Remove temporary warmup outputs so they never reach the gallery.
            out_dir = Path("/comfyui/output/warmup")
            if out_dir.exists():
                for f in out_dir.iterdir():
                    f.unlink(missing_ok=True)
                try:
                    out_dir.rmdir()
                except OSError:
                    pass
            elapsed = time.monotonic() - started
            print(f"[startup] warmup completed in {elapsed:.1f}s (model readiness)")
        except Exception as e:  # noqa: BLE001 — a failing warmup must fail startup loudly
            print(f"[startup] WARMUP FAILED: {e}", file=sys.stderr, flush=True)
            raise


def _snapshot_supported():
    try:
        return "enable_memory_snapshot" in inspect.signature(modal.App.cls).parameters
    except (TypeError, ValueError):
        return False


@app.cls(
    image=COMFY_IMAGE,
    gpu=GPU,
    scaledown_window=300,  # keep container warm 5 min after last request
    min_containers=0,      # scale to zero when idle
    timeout=900,           # 15 min per generation (ComfyUI + model load)
    secrets=[SECRET],
    volumes={"/comfyui/models/loras/user": LORA_VOL},
)
class Comfy(_ComfyWorker):
    """Ideogram-4 worker: one ComfyUI process per container, reused across requests."""

    @modal.enter()
    def startup(self):
        super().startup()

    @modal.exit()
    def shutdown(self):
        super().shutdown()

    @modal.method()
    def generate(self, payload: dict) -> dict:
        return super().generate(payload)


_moss_cls_kwargs = dict(
    image=MOSS_IMAGE,
    gpu=MOSS_GPU,
    scaledown_window=MOSS_DEPLOYMENT["scaledown_seconds"],
    min_containers=MOSS_DEPLOYMENT["min_containers"],
    env=_MOSS_ENV,
    timeout=900,
    startup_timeout=1200,  # model listing + asset checks + optional warmup
    secrets=[SECRET],
    volumes=MOSS_VOLUMES,
)


@app.cls(**{**_moss_cls_kwargs, "min_containers": 0 if MOSS_DEPLOYMENT["snapshot_mode"] == "gpu_experimental" else MOSS_DEPLOYMENT["min_containers"]})
class ComfyMossWorker(ComfyMoss):
    """MOSS worker on the validated profile. Experimental snapshot mode lives
    in ComfyMossSnapshotWorker; these two are never both routed to."""

    @modal.enter()
    def startup(self):
        super().startup()

    @modal.exit()
    def shutdown(self):
        super().shutdown()

    @modal.method()
    def generate(self, payload: dict) -> dict:
        return super().generate(payload)


if MOSS_DEPLOYMENT["snapshot_mode"] == "gpu_experimental":
    if not _snapshot_supported():
        raise SystemExit(
            "MOSS_SNAPSHOT_MODE=gpu_experimental requires a Modal SDK with memory-snapshot "
            "support (enable_memory_snapshot). Upgrade modal or set MOSS_SNAPSHOT_MODE=off."
        )

    @app.cls(**_moss_cls_kwargs, enable_memory_snapshot=True, experimental_options={"enable_gpu_snapshot": True})
    class ComfyMossSnapshotWorker(ComfyMoss):
        """EXPERIMENTAL (Phase 8): GPU memory snapshots on the subprocess-based
        ComfyUI topology. Capture/restore, child liveness and post-restore
        generation must all pass the smoke runbook before this is routed to.
        First test this actual topology before trusting restore behaviour."""

        @modal.enter(snap=True)
        def startup(self):
            # Initialization + warmup run in the snapshot-enabled lifecycle
            # hook: captured after warmup, restored on demand.
            super().startup()

        @modal.exit()
        def shutdown(self):
            super().shutdown()

        @modal.method()
        def generate(self, payload: dict) -> dict:
            return super().generate(payload)
else:
    ComfyMossSnapshotWorker = None


@app.function(
    image=PROXY_IMAGE,
    min_containers=1,    # keep proxy warm — prevents cold-start redirect (303 CORS bug)
    secrets=[SECRET],    # AUTH_TOKEN for the shared-secret check
    env=_MOSS_ENV,       # deploy-time configuration for /capabilities
)
@modal.asgi_app()
def web_app():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware

    api = FastAPI(title="ideogram-builder")
    # Browser calls this cross-origin from localhost; allow all (shared-secret already gates access).
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )
    expected = os.environ.get("AUTH_TOKEN", "")

    def _check_auth(req: Request):
        if expected:
            token = (req.headers.get("authorization") or "").removeprefix("Bearer ").strip()
            if token != expected:
                raise HTTPException(status_code=401, detail="invalid auth token")

    def _moss_target():
        if MOSS_DEPLOYMENT["snapshot_mode"] == "gpu_experimental" and ComfyMossSnapshotWorker is not None:
            return ComfyMossSnapshotWorker
        return ComfyMossWorker

    @api.post("/generate")
    async def generate(req: Request):
        _check_auth(req)
        payload = await req.json()
        target = _moss_target() if payload.get("model") == "moss" else Comfy
        call = target().generate.spawn(payload)
        return {"call_id": call.object_id}

    @api.get("/status/{call_id}")
    async def status(call_id: str, req: Request):
        _check_auth(req)
        call = modal.FunctionCall.from_id(call_id)
        try:
            result = call.get(timeout=0)
        except TimeoutError:
            return {"status": "pending"}
        except Exception as e:
            return {"status": "failed", "error": str(e)}
        return {"status": "completed", "result": result}

    @api.get("/capabilities")
    async def capabilities(req: Request):
        """Validated preset list from deploy-time configuration. Served by the
        CPU proxy — fetching capabilities must never start a GPU container."""
        _check_auth(req)
        sys.path.insert(0, "/root")
        import moss_assets
        import moss_config

        try:
            profile, enabled = moss_config.resolve_enabled_presets(os.environ)
            return moss_config.capabilities(
                profile, model_manifest_id=moss_assets.manifest_id(), enabled=enabled,
                experimental=moss_config.resolve_experimental_presets(os.environ))
        except moss_config.ProfileError as e:
            raise HTTPException(status_code=503, detail=f"deployment configuration error: {e}")

    return api


# --- Maintenance / benchmark entrypoints (CPU-only or explicit GPU) ------------

@app.function(
    image=MOSS_IMAGE,
    volumes={"/moss-models": MOSS_MODELS_VOL, "/moss-bench": MOSS_BENCH_VOL},
    timeout=7200,
    secrets=[SECRET],
)
def moss_populate_models(keys: str = "") -> str:
    """CPU-only maintenance: populate pinned candidate assets onto the
    /moss-models volume and verify hashes. Never runs during a request.

        modal run runpod/modal_app.py::moss_populate_models --keys adapter_rapid4,adapter_draft3
    """
    sys.path.insert(0, "/")
    import moss_assets

    wanted = {k.strip() for k in keys.split(",") if k.strip()} or None
    populated = moss_assets.populate("/moss-models", wanted)
    MOSS_MODELS_VOL.commit()
    moss_assets.write_extra_model_paths("/moss-bench/extra_model_paths.yaml")
    MOSS_BENCH_VOL.commit()
    return "populated:\n" + "\n".join(populated)


@app.function(
    image=MOSS_IMAGE,
    gpu=MOSS_GPU,
    volumes=MOSS_VOLUMES | {"/moss-bench": MOSS_BENCH_VOL},
    timeout=7200,
    secrets=[SECRET],
    env=_MOSS_ENV,
    startup_timeout=1200,
)
def moss_benchmark_run(profiles: str = "baseline", presets: str = "Fast",
                       fixtures: str = "", seeds: str = "101,202,303,404,505",
                       max_jobs: int = None, max_minutes: int = None,
                       dry_run: bool = False, cached_prompt: bool = False,
                       loras_json: str = "[]", width: int = None, height: int = None) -> dict:
    """Authenticated benchmark entrypoint calling the SAME workflow builder as
    production (in-process against handler). Artifacts land on the moss-bench
    volume under <run-id>/.

        modal run runpod/modal_app.py::moss_benchmark_run \
            --profiles baseline,resident-highvram-int8 --presets Fast
    """
    sys.path.insert(0, "/")
    import moss_benchmark

    import uuid
    run_id = time.strftime("run-%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]
    out_dir = f"/moss-bench/{run_id}"
    from moss_benchmark_worker import BenchmarkWorkers

    with BenchmarkWorkers(ComfyMoss) as workers:
        summary = moss_benchmark.run_benchmark(
            runner=workers,
            mode="internal",
            profiles=[p.strip() for p in profiles.split(",") if p.strip()],
            presets=[p.strip() for p in presets.split(",") if p.strip()],
            fixture_ids=[f.strip() for f in fixtures.split(",") if f.strip()] or None,
            seeds=[int(s) for s in seeds.split(",") if s.strip()],
            out_dir=out_dir,
            max_jobs=max_jobs,
            max_minutes=max_minutes,
            dry_run=dry_run,
            cached_prompt=cached_prompt,
            loras=json.loads(loras_json), width=width, height=height,
        )
    MOSS_BENCH_VOL.commit()
    return {"run_id": run_id, "out_dir": out_dir, "summary": summary}


@app.local_entrypoint()
def moss_benchmark_main(
    profiles: str = "baseline", presets: str = "Fast", fixtures: str = "",
    seeds: str = "101,202,303,404,505", max_jobs: int = None, max_minutes: int = None,
    dry_run: bool = False, cached_prompt: bool = False,
    loras_json: str = "[]", width: int = None, height: int = None,
):
    result = moss_benchmark_run.remote(
        profiles=profiles, presets=presets, fixtures=fixtures, seeds=seeds,
        max_jobs=max_jobs, max_minutes=max_minutes, dry_run=dry_run,
        cached_prompt=cached_prompt,
        loras_json=loras_json, width=width, height=height,
    )
    print(f"benchmark run {result['run_id']} written to volume moss-bench:{result['out_dir']}")
    summary = result.get("summary") or {}
    if summary.get("report"):
        print(summary["report"])
    else:
        print(json.dumps(summary, indent=2, default=str))


# --- Cached-image verification (plan 2026-10-28 §1) -----------------------------
# Run BEFORE deploying with MOSS_CACHED_IMAGE_ID / IDEOGRAM_CACHED_IMAGE_ID to
# prove the referenced images exist in this workspace and contain the expected
# weights/runtime layout. With the ID env vars unset these probes build the
# full Dockerfile images — set the IDs to probe the cached path cheaply.

@app.function(image=MOSS_IMAGE, timeout=300)
def moss_image_probe() -> dict:
    required = [
        "/handler.py", "/moss_config.py", "/moss_workflow.py", "/moss_assets.py",
        "/comfy_metrics.py", "/moss_benchmark.py", "/moss_cache.py", "/moss_memory.py",
        "/runtime_check.py", "/moss-models.json", "/moss-runtime.lock.json",
        "/workflow_template_moss.json", "/benchmarks/moss/fixtures.json",
        "/comfyui/custom_nodes/moss_runtime/__init__.py",
        "/comfyui/models/diffusion_models/moss_image_sft_int8_convrot.safetensors",
        "/comfyui/models/text_encoders/qwen3.5_9b_w4a8_gptq.safetensors",
        "/comfyui/models/vae/flux2-vae_small.safetensors",
        "/comfyui/models/loras/moss/control/moss_sft_dmd8.safetensors",
    ]
    missing = [p for p in required if not Path(p).exists()]
    if missing:
        raise RuntimeError(f"MOSS image is missing expected files: {missing}")
    return {"ok": True, "checked": len(required),
            "runtime_profile": os.environ.get("MOSS_RUNTIME_PROFILE", "")}


@app.function(image=COMFY_IMAGE, timeout=300)
def ideogram_image_probe() -> dict:
    required = [
        "/handler.py", "/workflow_template_turbo.json", "/workflow_template_lora.json",
        "/comfyui/models/diffusion_models/ideogram4_int8_convrot.safetensors",
        "/comfyui/models/text_encoders/qwen3vl_8b_fp8_scaled.safetensors",
        "/comfyui/models/vae/flux2-vae.safetensors",
    ]
    missing = [p for p in required if not Path(p).exists()]
    if missing:
        raise RuntimeError(f"Ideogram image is missing expected files: {missing}")
    return {"ok": True, "checked": len(required)}


@app.local_entrypoint()
def verify_cached_images(skip_ideogram: bool = False):
    """Cheap existence/contents check for the cached worker images.

        MOSS_CACHED_IMAGE_ID=im-… IDEOGRAM_CACHED_IMAGE_ID=im-… \
            modal run runpod/modal_app.py::verify_cached_images
    """
    moss = moss_image_probe.remote()
    print(f"MOSS image OK: {moss}")
    if not skip_ideogram:
        print(f"Ideogram image OK: {ideogram_image_probe.remote()}")


@app.local_entrypoint()
def record_deployment_manifest(
    moss_image_id: str = "", ideogram_image_id: str = "", app_name: str = "", out: str = "",
):
    """Write the non-secret deployment manifest: workspace, source revision,
    image IDs, build selection and configuration pins. Workspace-specific IDs
    live ONLY here, never as source defaults.

        modal run runpod/modal_app.py::record_deployment_manifest \
            --moss-image-id im-… --ideogram-image-id im-… --app-name ideogram-builder-rapid-preview
    """
    import subprocess

    def _git(*args):
        return subprocess.check_output(["git", *args], text=True, cwd=str(REPO_ROOT)).strip()

    try:
        workspace = subprocess.check_output(["modal", "profile", "current"], text=True).strip()
    except Exception:
        workspace = "unknown"
    manifest = {
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "workspace": workspace,
        "app_name": app_name or _MOSS_ENV["MOSS_APP_NAME"],
        "source_revision": _git("rev-parse", "HEAD"),
        "source_dirty": bool(_git("status", "--porcelain")),
        "build_selection": {
            "moss_image_id": moss_image_id or None,
            "ideogram_image_id": ideogram_image_id or None,
            "runtime_build": _RUNTIME_BUILD,
            "comfyui_build": _COMFYUI_BUILD,
            "rebuild_path": "unset MOSS_CACHED_IMAGE_ID/IDEOGRAM_CACHED_IMAGE_ID and deploy "
                            "(full Dockerfile build; required for dependency/model changes)",
        },
        "runtime_profile": MOSS_PROFILE["profile_id"],
        "profile_status": MOSS_PROFILE["status"],
        "enabled_presets": list(MOSS_ENABLED_PRESETS),
        "experimental_presets": [p.strip() for p in (_deploy_env.get("MOSS_EXPERIMENTAL_PRESETS") or "").split(",") if p.strip()],
        "pins": {
            "runtime_lock_id": _RUNTIME_LOCK["lock_id"],
            "model_manifest_id": json.loads((RUNPOD_DIR / "moss-models.json").read_text())["manifest_id"],
            "comfyui": _COMFYUI_REVISION,
            "rgthree": _RUNTIME_LOCK["baseline_runtime"]["rgthree"]["revision"],
        },
    }
    dest = Path(out) if out else RUNPOD_DIR.parent / "docs" / "deploy" / f"{time.strftime('%Y-%m-%d')}-{manifest['app_name']}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"deployment manifest written to {dest}")
    print(json.dumps(manifest, indent=2))
