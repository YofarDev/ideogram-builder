"""Runtime identity collection and profile requirement enforcement.

Runs inside the ComfyUI GPU process (startup diagnostic, benchmark runtime
manifests) or on a dev machine (records unknowns instead of guessing).
`nvidia-smi` cannot establish which CUDA build torch was compiled against —
only torch.version.cuda can, and comfy-kitchen's accelerated CUDA backend is
hard-disabled below cu130 by comfy/quant_ops.py at the pinned commit.
"""

import json
import os
import subprocess
import sys

COMFY_DIR = os.environ.get("COMFY_DIR", "/comfyui")


def _module_version(name):
    try:
        module = __import__(name)
        return getattr(module, "__version__", "unknown")
    except ImportError:
        return None
    except Exception as e:  # noqa: BLE001
        return f"import-error: {e}"


def _git_revision(path):
    try:
        return subprocess.check_output(
            ["git", "-C", path, "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, text=True
        ).strip()
    except Exception:  # noqa: BLE001
        return None


def collect():
    """Everything Phase 0 needs from inside the MOSS process environment."""
    info = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "torch": _module_version("torch"),
        "torch_version_cuda": None,
        "torchvision": _module_version("torchvision"),
        "torchaudio": _module_version("torchaudio"),
        "triton": _module_version("triton"),
        "comfy_kitchen": _module_version("comfy_kitchen"),
        "comfy_kitchen_backends": None,
        "comfyui_revision": _git_revision(COMFY_DIR),
        "rgthree_revision": _git_revision(os.path.join(COMFY_DIR, "custom_nodes", "rgthree-comfy")),
        "spectrum_revision": _git_revision(os.path.join(COMFY_DIR, "custom_nodes", "ComfyUI-Spectrum-MOSS")),
        "gpu_name": None,
        "gpu_capability": None,
        "driver_version": None,
        "cuda_device_count": 0,
    }
    try:
        import torch

        info["torch_version_cuda"] = torch.version.cuda
        info["cuda_device_count"] = torch.cuda.device_count()
        if torch.cuda.is_available():
            info["gpu_name"] = torch.cuda.get_device_name(0)
            info["gpu_capability"] = ".".join(map(str, torch.cuda.get_device_capability(0)))
            driver = torch.cuda.driver_version() if callable(getattr(torch.cuda, "driver_version", None)) else None
            info["driver_version"] = driver
    except Exception as e:  # noqa: BLE001
        info["torch_error"] = str(e)
    try:
        import comfy_kitchen as ck

        info["comfy_kitchen_backends"] = dict(ck.list_backends())
    except Exception:
        pass
    return info


def report(info=None, indent=2):
    print(json.dumps(info or collect(), indent=indent, default=str))


def accelerated_backend_enabled(info=None):
    """True when comfy-kitchen's CUDA backend is registered (not disabled by the
    cu130 gate). Presence of the package alone is not evidence the quantized
    ops used it — check this plus ComfyUI startup logs."""
    info = info or collect()
    backends = info.get("comfy_kitchen_backends")
    if not backends:
        return False, "comfy_kitchen backends unavailable or not importable"
    cuda_state = backends.get("cuda")
    if cuda_state in (None, False, "disabled"):
        return False, f"cuda backend not enabled (state={cuda_state!r})"
    return True, f"cuda backend state={cuda_state!r}"


def enforce_profile_requirements(profile, info=None):
    """Readable startup failure for an optimized profile whose runtime cannot
    meet its declared requirements. The baseline profile tolerates the current
    (possibly fallback) kernel path and is never rejected here."""
    if not profile.get("requires_cuda13"):
        return
    info = info or collect()
    cuda_build = info.get("torch_version_cuda")
    if cuda_build is None:
        raise RuntimeError(
            f"Profile '{profile['profile_id']}' requires PyTorch with CUDA 13.0+ kernels "
            f"(comfy-kitchen disabled its CUDA backend), but torch.version.cuda is unset. "
            f"Build the candidate runtime (runpod/Dockerfile.moss TORCH_SPEC/TORCH_INDEX args) "
            f"or deploy the 'baseline' profile."
        )
    major = int(str(cuda_build).split(".")[0])
    if major < 13:
        raise RuntimeError(
            f"Profile '{profile['profile_id']}' requires PyTorch built against CUDA 13.0+ "
            f"(found cu{cuda_build}). comfy/quant_ops.py disables the comfy-kitchen CUDA backend "
            f"below cu130, so the quantized DiT/encoder would silently fall back. "
            f"Rebuild with the pinned cu130+ wheel set or deploy the 'baseline' profile."
        )


def main(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description="MOSS runtime diagnostics")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON only")
    parser.add_argument("--check-accelerated", action="store_true", help="Assert the comfy-kitchen CUDA backend is enabled")
    parser.add_argument("--enforce", default=None, metavar="PROFILE_JSON",
                        help="Enforce a profile dict's requires_cuda13 requirement (JSON)")
    args = parser.parse_args(argv)

    info = collect()
    if args.check_accelerated:
        ok, detail = accelerated_backend_enabled(info)
        if not ok:
            print(f"ACCELERATED BACKEND NOT ENABLED: {detail}", file=sys.stderr)
            return 1
        print(f"accelerated backend OK: {detail}")
    if args.enforce:
        enforce_profile_requirements(json.loads(args.enforce), info)
    if args.json:
        print(json.dumps(info, indent=2, default=str))
    else:
        report(info)
    return 0


if __name__ == "__main__":
    sys.exit(main())
