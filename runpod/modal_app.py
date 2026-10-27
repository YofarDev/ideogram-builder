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
    MOSS_RUNTIME_PROFILE       named runtime profile         (default "baseline")
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

_deploy_env = os.environ
MOSS_PROFILE = moss_config.resolve_profile(_deploy_env)
MOSS_DEPLOYMENT = moss_config.deployment_settings(_deploy_env)
MOSS_ENABLED_PRESETS = moss_config.resolve_enabled_presets(_deploy_env)[1]

# Env baked into the MOSS GPU container + proxy so runtime code sees the same
# configuration the deploy validated.
_MOSS_ENV = {
    "MOSS_RUNTIME_PROFILE": MOSS_PROFILE["profile_id"],
    "MOSS_RUNTIME_BUILD": os.environ.get("MOSS_RUNTIME_BUILD", "baseline"),
    "MOSS_APP_NAME": os.environ.get("MOSS_APP_NAME", "ideogram-builder"),
    "MOSS_STARTUP_DIAG": str(MOSS_STARTUP_DIAG).lower(),
    "MOSS_ENABLED_PRESETS": ",".join(MOSS_ENABLED_PRESETS),
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

# Same image RunPod builds: ComfyUI, KJNodes, rgthree, 4 Ideogram-4 models, LoRAs, handler.py.
COMFY_IMAGE = modal.Image.from_dockerfile(
    "runpod/Dockerfile",
    context_dir=str(REPO_ROOT),
)
# MOSS-Image twin: pinned ComfyUI + rgthree + Spectrum, MOSS models, helper modules, same handler.
MOSS_IMAGE = modal.Image.from_dockerfile(
    "runpod/Dockerfile.moss",
    context_dir=str(REPO_ROOT),
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
                                 runtime_lock_id=_RUNTIME_LOCK["lock_id"])
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
            return moss_config.capabilities(profile, model_manifest_id=moss_assets.manifest_id(), enabled=enabled)
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
