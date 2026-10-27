"""Pinned MOSS asset resolution, verification and maintenance population.

Stdlib-only so it stays importable in CPU-only tests and the Modal proxy.
Resolution order per asset: the image-baked /comfyui/models tree first, then
the optional /moss-models benchmark volume (mirrored layout, exposed to
ComfyUI via the generated extra-model-paths config). Generation never
downloads assets — a missing pinned file is a hard, readable error.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

MANIFEST_PATH = os.environ.get(
    "MOSS_MODELS_MANIFEST",
    str(Path(__file__).resolve().parent / "moss-models.json"),
)
MODELS_ROOT = os.environ.get("MOSS_MODELS_ROOT", "/moss-models")   # Modal volume
COMFY_MODELS_ROOT = os.environ.get("COMFY_MODELS_ROOT", "/comfyui/models")

# asset role -> model folder (baked root) and mirrored subfolder on the volume
ROLE_DIRS = {
    "diffusion_model": "diffusion_models",
    "text_encoder": "text_encoders",
    "vae": "vae",
    "distillation_adapter": os.path.join("loras", "moss", "control"),
}

HF_RESOLVE_URL = "https://huggingface.co/{repo}/resolve/{revision}/{repo_path}"

_manifest_cache = {}


class AssetError(RuntimeError):
    """Readable failure for a missing/mismatched pinned asset."""


def load_manifest(path=None):
    path = path or MANIFEST_PATH
    if path not in _manifest_cache:
        with open(path) as f:
            _manifest_cache[path] = json.load(f)
    return _manifest_cache[path]


def manifest_id(path=None):
    return load_manifest(path)["manifest_id"]


def asset(key, path=None):
    try:
        return load_manifest(path)["assets"][key]
    except KeyError:
        raise AssetError(f"Unknown asset key '{key}' in manifest {MANIFEST_PATH}") from None


def candidate_paths(entry):
    """Local paths to probe, baked root first, benchmark volume second."""
    role_dir = ROLE_DIRS[entry["role"]]
    if entry["role"] == "distillation_adapter":
        return [
            os.path.join(COMFY_MODELS_ROOT, "loras", "moss", "control", entry["filename"]),
            os.path.join(MODELS_ROOT, "loras", "moss", "control", entry["filename"]),
        ]
    folder = ROLE_DIRS[entry["role"]]
    return [
        os.path.join(COMFY_MODELS_ROOT, folder, entry["filename"]),
        os.path.join(MODELS_ROOT, folder, entry["filename"]),
    ]


def resolve_asset(key, *, check_hash=False, path=None):
    """Locate a pinned asset. Returns (absolute_path, workflow_ref, entry).
    Raises AssetError when absent; AssetError also when a hash check fails."""
    entry = asset(key, path)
    for candidate in candidate_paths(entry):
        if os.path.exists(candidate):
            if check_hash and entry.get("sha256"):
                verify_sha256(candidate, entry["sha256"])
            return candidate, entry["workflow_ref"], entry
    raise AssetError(
        f"Pinned asset '{key}' ({entry['filename']} from {entry['repo']}@{entry['revision'][:12]}) "
        f"is not present. Expected one of: {', '.join(candidate_paths(entry))}. "
        f"Populate it with the maintenance entrypoint (modal run runpod/modal_app.py::moss_populate_models) "
        f"or pick a profile whose assets are baked into the image."
    )


def resolve_profile_assets(profile, *, check_hash=False, path=None):
    """workflow filenames for a profile's DiT/encoder/VAE loaders."""
    from moss_config import ASSET_BY_FORMAT

    keys = {
        "dit": ASSET_BY_FORMAT["dit"][profile["dit_format"]],
        "encoder": ASSET_BY_FORMAT["encoder"][profile["encoder_format"]],
        "vae": profile.get("vae_asset", "vae_small"),
    }
    return {role: resolve_asset(key, check_hash=check_hash, path=path)[1] for role, key in keys.items()}


def adapter_asset_key(adapter):
    from moss_config import DISTILLATION_ADAPTERS

    if adapter not in DISTILLATION_ADAPTERS:
        raise AssetError(f"Unknown distillation adapter '{adapter}'")
    return f"adapter_{adapter}"


def resolve_adapter(adapter, *, check_hash=False, path=None):
    return resolve_asset(adapter_asset_key(adapter), check_hash=check_hash, path=path)


def verify_sha256(file_path, expected, chunk=1024 * 1024):
    digest = hashlib.sha256()
    with open(file_path, "rb") as f:
        while True:
            block = f.read(chunk)
            if not block:
                break
            digest.update(block)
    actual = digest.hexdigest()
    if actual != expected:
        raise AssetError(f"sha256 mismatch for {file_path}: expected {expected}, got {actual}")


def required_asset_keys(profile, presets):
    """Every asset a profile needs to serve the given preset ids."""
    from moss_config import ASSET_BY_FORMAT

    keys = {
        ASSET_BY_FORMAT["dit"][profile["dit_format"]],
        ASSET_BY_FORMAT["encoder"][profile["encoder_format"]],
        profile.get("vae_asset", "vae_small"),
    }
    for pid in presets:
        from moss_config import MOSS_PRESETS
        adapter = MOSS_PRESETS[pid].get("adapter")
        if adapter:
            keys.add(adapter_asset_key(adapter))
    return sorted(keys)


def assert_profile_assets(profile, presets, *, check_hash=False, path=None):
    """Fail clearly at startup/request time when a required asset is absent."""
    missing = []
    for key in required_asset_keys(profile, presets):
        try:
            resolve_asset(key, check_hash=check_hash, path=path)
        except AssetError as e:
            missing.append(str(e))
    if missing:
        raise AssetError("\n".join(missing))


# ---------------------------------------------------------------------------
# extra-model-paths config for the /moss-models volume
# ---------------------------------------------------------------------------

EXTRA_MODEL_PATHS_YAML = """\
# Generated for the MOSS benchmark-model volume (runpod/moss_assets.py).
# Mounted at {models_root}; user LoRAs stay on their own volume.
moss_models:
  base_path: {models_root}
  diffusion_models: diffusion_models
  text_encoders: text_encoders
  vae: vae
  loras: loras
"""


def write_extra_model_paths(dest, models_root=None):
    models_root = models_root or MODELS_ROOT
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    Path(dest).write_text(EXTRA_MODEL_PATHS_YAML.format(models_root=models_root))
    return dest


# ---------------------------------------------------------------------------
# CPU-only maintenance population (never called during a generation request)
# ---------------------------------------------------------------------------

def download_asset(entry, dest, downloader=None):
    """Stream one pinned file from its HF revision into dest (atomic rename)."""
    url = HF_RESOLVE_URL.format(repo=entry["repo"], revision=entry["revision"],
                                repo_path=entry["repo_path"])
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    tmp = dest + ".tmp"
    if downloader is None:
        request = urllib.request.Request(url)
        token = os.environ.get("HF_TOKEN")
        if token and "huggingface.co" in url:
            request.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(request, timeout=600) as resp, open(tmp, "wb") as f:
            while True:
                block = resp.read(1024 * 1024)
                if not block:
                    break
                f.write(block)
    else:
        downloader(url, tmp)
    os.replace(tmp, dest)
    return dest


def populate(dest_root, keys=None, *, check_hashes=True, downloader=None, path=None):
    """Populate candidate assets onto the benchmark volume. Returns the list of
    populated paths. keys=None → every asset whose container_path lives under
    the volume root (i.e. the candidates, not the baked baseline)."""
    manifest = load_manifest(path)
    if keys is not None:
        keys = set(keys)
    selected = {}
    for key, entry in manifest["assets"].items():
        on_volume = entry["container_path"].startswith(MODELS_ROOT)
        if keys is None:
            if on_volume:
                selected[key] = entry
        elif key in keys:
            selected[key] = entry
    if keys:
        unknown = keys - set(manifest["assets"])
        if unknown:
            raise AssetError(f"Unknown asset keys: {', '.join(sorted(unknown))}")

    populated = []
    for key, entry in selected.items():
        dest = os.path.join(dest_root, ROLE_DIRS[entry["role"]], entry["filename"])
        if os.path.exists(dest) and (not check_hashes or entry.get("sha256")):
            if check_hashes and entry.get("sha256"):
                try:
                    verify_sha256(dest, entry["sha256"])
                    populated.append(dest)
                    continue
                except AssetError:
                    pass  # corrupt/incomplete: re-download
        print(f"[moss_assets] downloading {key}: {entry['repo']}@{entry['revision'][:12]} {entry['repo_path']}")
        download_asset(entry, dest, downloader=downloader)
        if check_hashes and entry.get("sha256"):
            verify_sha256(dest, entry["sha256"])
        populated.append(dest)
    if not populated:
        print("[moss_assets] nothing to populate")
    return populated


def main(argv=None):
    parser = argparse.ArgumentParser(description="MOSS pinned-asset maintenance (CPU-only)")
    parser.add_argument("--dest", default=MODELS_ROOT, help="Volume root to populate (default %(default)s)")
    parser.add_argument("--keys", default="", help="Comma-separated asset keys (default: all volume candidates)")
    parser.add_argument("--list", action="store_true", help="List manifest assets and exit")
    parser.add_argument("--check", action="store_true", help="Verify local files against pinned hashes")
    parser.add_argument("--manifest", default=None, help="Manifest path override")
    args = parser.parse_args(argv)

    if args.list:
        manifest = load_manifest(args.manifest)
        for key, entry in manifest["assets"].items():
            print(f"{key:24} {entry['filename']:44} {entry['repo']}@{entry['revision'][:12]}")
        return 0

    if args.check:
        manifest = load_manifest(args.manifest)
        failures = 0
        for key, entry in manifest["assets"].items():
            local = [p for p in candidate_paths(entry) if os.path.exists(p)]
            if not local:
                print(f"MISSING  {key}: {entry['filename']}")
                failures += 1
            else:
                try:
                    verify_sha256(local[0], entry["sha256"])
                    print(f"OK       {key}: {local[0]}")
                except AssetError as e:
                    print(f"HASH BAD {key}: {e}")
                    failures += 1
        return 1 if failures else 0

    keys = {k.strip() for k in args.keys.split(",") if k.strip()} or None
    populate(args.dest, keys, path=args.manifest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
