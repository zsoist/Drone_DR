"""Shared Gaussian splat training presets and request normalization.

The API, worker, UI tests and manifests need the same vocabulary. Keeping it in
one small module prevents "7000" from meaning cinematic in one place and custom
elsewhere.
"""

SUPPORTED_SPLAT_BACKENDS = ("metal", "cpu", "cuda")
SPLAT_RESOLUTIONS = ("auto", "full", "half")


def _local_profile(*, default_backend="metal"):
    return {
        "supported_backends": SUPPORTED_SPLAT_BACKENDS,
        "default_backend": default_backend,
        "cuda": {"resolution": "auto", "strict": True, "train_args": []},
    }


SPLAT_PRESETS = {
    "fast": {
        "iters": 1000,
        "label": "Fast 1K",
        "eta_mps": "~8-18 min",
        "eta_cpu": "~15-35 min",
        "description": "Draft preview for checking capture/poses.",
        "timeout": 2 * 3600,
        "train_args": [],
        **_local_profile(),
    },
    "medium": {
        "iters": 2000,
        "label": "Medium 2K",
        "eta_mps": "~4-12 min",
        "eta_cpu": "~30-60 min",
        "description": "Reliable default for inspecting shape and coverage.",
        "timeout": 3 * 3600,
        "train_args": [],
        **_local_profile(),
    },
    "cinematic": {
        "iters": 7000,
        "label": "Cinematic 7K",
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
        **_local_profile(),
    },
    "ultra": {
        "iters": 15000,
        "label": "Ultra 15K",
        "eta_cuda": "~14-22 min",
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
        **_local_profile(),
        "cuda": {
            "resolution": "auto",
            "strict": True,
            "train_args": [
                "--pipeline.model.sh-degree", "0",
                "--pipeline.model.stop-split-at", "15000",
            ],
        },
    },
    "ultra20": {
        "iters": 20000,
        "label": "Ultra+ 20K",
        "eta_mps": "CUDA only",
        "eta_cpu": "CUDA only",
        "eta_cuda": "Primera medición en esta GPU",
        "description": "CUDA refinement after Gaussian growth has stabilized.",
        "timeout": 12 * 3600,
        "train_args": [],
        "supported_backends": ("cuda",),
        "default_backend": "cuda",
        "cuda": {
            "resolution": "auto",
            "strict": True,
            "train_args": [
                "--pipeline.model.sh-degree", "0",
                "--pipeline.model.stop-split-at", "15000",
            ],
        },
    },
    "frontier": {
        "iters": 30000,
        "label": "Frontier 30K",
        "eta_mps": "CUDA only",
        "eta_cpu": "CUDA only",
        "eta_cuda": "Primera medición en esta GPU",
        "description": "Complete native Splatfacto optimizer schedule on NVIDIA CUDA.",
        "timeout": 16 * 3600,
        "train_args": [],
        "supported_backends": ("cuda",),
        "default_backend": "cuda",
        "cuda": {
            "resolution": "auto",
            "strict": True,
            "train_args": [
                "--pipeline.model.sh-degree", "0",
                "--pipeline.model.stop-split-at", "15000",
            ],
        },
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
    "ultra15": "ultra",
    "ultra15k": "ultra",
    "15k": "ultra",
    "ultra+": "ultra20",
    "ultra20k": "ultra20",
    "20k": "ultra20",
    "frontier30": "frontier",
    "frontier30k": "frontier",
    "30k": "frontier",
}

_BACKEND_ALIASES = {
    "mps": "metal",
    "metal/mps": "metal",
    "apple metal": "metal",
    "nvidia": "cuda",
    "nvidia cuda": "cuda",
    "cuda remote": "cuda",
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
        allowed = ", ".join(SPLAT_PRESETS)
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
        **_local_profile(),
    }


def validate_splat_backend(preset: str | dict, backend: str | None) -> str:
    """Return the canonical backend or reject an unsupported profile pair."""
    profile = resolve_splat_spec(preset if isinstance(preset, dict)
                                 else {"preset": preset})
    raw = str(backend or profile["default_backend"]).strip().lower()
    canonical = _BACKEND_ALIASES.get(raw, raw)
    if canonical not in SUPPORTED_SPLAT_BACKENDS:
        raise ValueError(f"backend de splat inválido: {raw}")
    if canonical not in profile["supported_backends"]:
        raise ValueError(f"{profile['label']} requiere NVIDIA CUDA")
    return canonical


def normalize_splat_resolution(value, *, backend: str,
                               requested_downscale=None, default="auto") -> tuple[str, int]:
    """Normalize the public resolution vocabulary and its concrete first scale."""
    if value in (None, ""):
        try:
            legacy_d = int(requested_downscale) if requested_downscale not in (None, "") else None
        except (TypeError, ValueError):
            raise ValueError("downscale de splat inválido (usa 1 o 2)") from None
        if legacy_d is not None:
            value = {1: "full", 2: "half"}.get(legacy_d)
            if value is None:
                raise ValueError("downscale de splat inválido (usa 1 o 2)")
        else:
            value = default if backend == "cuda" else "half"
    value = str(value).strip().lower()
    aliases = {"d1": "full", "complete": "full", "completa": "full",
               "d2": "half", "media": "half", "mitad": "half"}
    value = aliases.get(value, value)
    if value not in SPLAT_RESOLUTIONS:
        raise ValueError(f"resolución de splat inválida: {value} (usa auto, full o half)")
    if backend != "cuda" and value == "auto":
        value = "half"
    return value, 2 if value == "half" else 1


def normalize_splat_request(spec: dict | None) -> dict:
    """Return the immutable backend/profile/resolution portion of a splat job."""
    spec = spec or {}
    profile = resolve_splat_spec(spec)
    backend = validate_splat_backend(profile, spec.get("backend"))
    cuda_default = profile.get("cuda", {}).get("resolution", "auto")
    resolution, requested_downscale = normalize_splat_resolution(
        spec.get("resolution"), backend=backend,
        requested_downscale=(spec.get("requested_downscale")
                             if spec.get("requested_downscale") is not None
                             else spec.get("downscale")),
        default=cuda_default,
    )
    best_available = bool(spec.get("best_available", backend != "cuda"))
    backend_policy = "strict" if backend == "cuda" or not best_available else "best_available"
    return {
        "preset": profile["key"],
        "iters": profile["iters"],
        "backend": backend,
        "backend_policy": backend_policy,
        "resolution": resolution,
        "requested_downscale": requested_downscale,
        "best_available": False if backend == "cuda" else best_available,
    }


def public_splat_profiles() -> list[dict]:
    """Serialize the safe UI portion of the canonical profile contract."""
    out = []
    for key, profile in SPLAT_PRESETS.items():
        public = {
            "key": key,
            "label": profile["label"],
            "iters": profile["iters"],
            "description": profile["description"],
            "supported_backends": list(profile["supported_backends"]),
            "default_backend": profile["default_backend"],
            "eta_mps": profile.get("eta_mps"),
            "eta_cpu": profile.get("eta_cpu"),
            "eta_cuda": profile.get("eta_cuda"),
            "cuda": {
                "resolution": profile.get("cuda", {}).get("resolution", "auto"),
                "strict": bool(profile.get("cuda", {}).get("strict", True)),
            },
        }
        out.append(public)
    return out
