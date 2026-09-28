"""Where AeroBrain's heavy compute runs.

Operator decision 2026-09-28: every ODM and splat-training job runs on the GPU PC
(CUDA, strict — a PC failure never spills onto the Mac). The Mac serves the web and
video, and only does light post-processing on demand. Set AEROBRAIN_COMPUTE=local
to re-enable the legacy Mac paths (Metal splats, local ODM) for a single run.
"""
from __future__ import annotations

import os


def pc_only() -> bool:
    return os.environ.get("AEROBRAIN_COMPUTE", "pc").strip().lower() != "local"


def route_odm(spec: dict) -> dict:
    """ODM request → PC CUDA, strict (no local fallback)."""
    spec = dict(spec or {})
    if pc_only():
        spec["backend"] = "cuda"
        spec["backend_policy"] = "strict"
        if spec.get("splat_backend") or spec.get("splat"):
            spec["splat_backend"] = "cuda"
    return spec


def route_splat(raw: dict) -> dict:
    """Raw splat request → CUDA before normalization picks resolution/policy."""
    raw = dict(raw or {})
    if pc_only():
        raw["backend"] = "cuda"
        raw["best_available"] = False
    return raw
