"""Copy-on-start compiler caches: local writers, immutable published generations.

Workers never compile into the shared volume. They copy a completed compatible
generation locally, then publish under their own ID after ComfyUI stops. This
avoids relying on cross-container file locks or sharing partially written caches.
"""
import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path


def namespace(profile, runtime, model_manifest, runtime_lock):
    identity = {
        "profile": profile, "models": model_manifest, "runtime_lock": runtime_lock,
        "gpu": runtime.get("gpu_capability"), "gpu_name": runtime.get("gpu_name"),
        "software": {k: runtime.get(k) for k in (
            "python", "torch", "torch_version_cuda", "triton", "comfy_kitchen",
            "comfyui_revision", "rgthree_revision", "spectrum_revision")},
    }
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:32]


def prepare(profile, runtime, model_manifest, runtime_lock, *, shared_root="/moss-compile-cache", local_root="/tmp/moss-compile-cache"):
    key = namespace(profile, runtime, model_manifest, runtime_lock)
    worker = uuid.uuid4().hex
    published = Path(shared_root) / key / "generations"
    work = Path(local_root) / key / worker
    work.mkdir(parents=True)
    ready = sorted((p for p in published.glob("*") if (p / "COMPLETE").is_file()), key=lambda p: p.name)
    if ready:
        shutil.copytree(ready[-1], work, dirs_exist_ok=True)
        (work / "COMPLETE").unlink(missing_ok=True)
    return {
        "namespace": key, "worker": worker, "local": str(work), "published": str(published),
        "reused_from": str(ready[-1]) if ready else None,
        "env": {"TORCHINDUCTOR_CACHE_DIR": str(work / "inductor"), "TRITON_CACHE_DIR": str(work / "triton")},
    }


def publish(cache):
    """Caller commits the Modal volume only after this complete generation exists."""
    target = Path(cache["published"]) / cache["worker"]
    if (target / "COMPLETE").exists():
        return
    if target.exists():
        shutil.rmtree(target)  # only this worker owns this unpublished generation
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(cache["local"], target)
    marker = target / "COMPLETE"
    with marker.open("w") as stream:
        stream.write(cache["namespace"])
        stream.flush()
        os.fsync(stream.fileno())
