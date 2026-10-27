"""Tests for runpod/runtime_check.py — runtime identity + requirement gates."""
import pytest

import runtime_check
from runtime_check import accelerated_backend_enabled, collect, enforce_profile_requirements


def test_collect_returns_expected_keys_without_gpu():
    info = collect()
    for key in ("python", "torch", "torch_version_cuda", "triton", "comfy_kitchen",
                "comfyui_revision", "rgthree_revision", "spectrum_revision",
                "gpu_name", "gpu_capability"):
        assert key in info
    # On a dev machine torch may be absent — must not raise, just record.
    assert info["python"]


def test_accelerated_backend_detection():
    ok, _detail = accelerated_backend_enabled({"comfy_kitchen_backends": {"cuda": "enabled", "triton": "disabled"}})
    assert ok is True
    ok, detail = accelerated_backend_enabled({"comfy_kitchen_backends": {}})
    assert ok is False
    ok, _detail = accelerated_backend_enabled({})
    assert ok is False


def test_cuda13_gate_readability():
    """quant_ops.py hard-disables comfy-kitchen's CUDA backend below cu130 — an
    optimized profile must fail with a readable, actionable message."""
    profile = {"profile_id": "resident-highvram-int8", "requires_cuda13": True}
    with pytest.raises(RuntimeError, match="cu12.6"):
        enforce_profile_requirements(profile, {"torch_version_cuda": "12.6"})
    with pytest.raises(RuntimeError, match="unset"):
        enforce_profile_requirements(profile, {"torch_version_cuda": None})
    enforce_profile_requirements(profile, {"torch_version_cuda": "13.1"})  # no raise


def test_baseline_profile_tolerates_current_runtime():
    """Baseline records what is deployed — never rejected for the suspected
    cu126 fallback (that comparison is the Phase 2 experiment itself)."""
    baseline = {"profile_id": "baseline", "requires_cuda13": False}
    enforce_profile_requirements(baseline, {"torch_version_cuda": "12.6"})  # no raise
    enforce_profile_requirements(baseline, {"torch_version_cuda": None})  # no raise
