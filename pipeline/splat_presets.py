"""Shared Gaussian splat training presets.

The API, worker, UI tests and manifests need the same vocabulary. Keeping it in
one small module prevents "7000" from meaning cinematic in one place and custom
elsewhere.
"""

SPLAT_PRESETS = {
    "fast": {
        "iters": 1000,
        "label": "Fast",
        "eta_mps": "~8-18 min",
        "eta_cpu": "~15-35 min",
        "description": "Draft preview for checking capture/poses.",
        "timeout": 2 * 3600,
        "train_args": [],
    },
    "medium": {
        "iters": 2000,
        "label": "Medium",
        "eta_mps": "~4-12 min",
        "eta_cpu": "~30-60 min",
        "description": "Reliable default for inspecting shape and coverage.",
        "timeout": 3 * 3600,
        "train_args": [],
    },
    "cinematic": {
        "iters": 7000,
        "label": "Cinematic",
        "eta_mps": "~45-75 min",
        "eta_cpu": "~2-3 h",
        "description": "Shareable photoreal quality with strong convergence.",
        "timeout": 6 * 3600,
        # Aerial scenes can balloon close to 1M gaussians by ~50%, making 7k
        # MPS runs take ~1h and producing 20MB+ mobile assets. Keep the 7k
        # refinement budget, but make densification less aggressive than the
        # OpenSplat default while still richer than Ultra's bounded overnight
        # profile.
        "train_args": [
            "--save-every", "1000",
            "--refine-every", "150",
            "--densify-grad-thresh", "0.00035",
            "--stop-screen-size-at", "3000",
        ],
    },
    "ultra": {
        "iters": 15000,
        "label": "Ultra",
        "eta_mps": "~2-4 h",
        "eta_cpu": "~5-8 h",
        "description": "Best local quality for overnight/premium runs.",
        "timeout": 10 * 3600,
        # On a 16GB M4, OpenSplat defaults can exceed 1M gaussians before 25%
        # on aerial video. That makes late iterations crawl and creates mobile-
        # hostile assets. Ultra keeps the long refinement budget but bounds
        # gaussian growth: fewer split passes, higher split threshold, and an
        # earlier stop for large screen-space splits.
        "train_args": [
            "--save-every", "1000",
            "--refine-every", "200",
            "--densify-grad-thresh", "0.0005",
            "--stop-screen-size-at", "2500",
        ],
    },
}

_ALIASES = {
    "rapido": "fast",
    "rápido": "fast",
    "balanced": "medium",
    "balanceado": "medium",
    "medio": "medium",
    "cinematico": "cinematic",
    "cinemático": "cinematic",
}


def resolve_splat_spec(spec: dict | None) -> dict:
    """Return a validated splat preset dict from API/job spec.

    Legacy callers may still pass only {"iters": 7000}; known iteration counts
    map back to named presets. Unknown custom counts are allowed inside a bounded
    range, but the UI now uses named presets for auditability.
    """
    spec = spec or {}
    raw = str(spec.get("preset") or "").strip().lower()
    key = _ALIASES.get(raw, raw)
    if key in SPLAT_PRESETS:
        out = {"key": key, **SPLAT_PRESETS[key]}
        return out
    if raw and key != "custom":
        allowed = ", ".join(("medium", "cinematic", "ultra"))
        raise ValueError(f"preset de splat inválido: {raw} (usa {allowed})")

    try:
        iters = int(spec.get("iters") or SPLAT_PRESETS["medium"]["iters"])
    except (TypeError, ValueError):
        iters = SPLAT_PRESETS["medium"]["iters"]

    by_iters = {v["iters"]: k for k, v in SPLAT_PRESETS.items()}
    if iters in by_iters:
        key = by_iters[iters]
        return {"key": key, **SPLAT_PRESETS[key]}

    if not 500 <= iters <= 30000:
        raise ValueError("iteraciones de splat fuera de rango (500-30000)")
    return {
        "key": "custom",
        "iters": iters,
        "label": f"Custom {iters}",
        "eta_mps": "variable",
        "eta_cpu": "variable",
        "description": "Custom iteration count",
        "timeout": max(2 * 3600, min(14 * 3600, int(iters * 2.5))),
        "train_args": [],
    }
