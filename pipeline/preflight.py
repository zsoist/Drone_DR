"""Evidence-based OpenSplat memory preflight.

Only Medium has a controlled, instrumented calibration across the current
30/81/214-camera workloads. Cinematic and Ultra have both successful and OOM
runs, so extrapolating a failed-run slope through 7k/15k iterations creates
false 50-120 GB numbers. For those presets we report the deterministic image
load floor and an explicitly unverified risk instead.
"""

import hwconfig
from splat_presets import SPLAT_PRESETS, validate_splat_backend


PRESET_ITERS = {key: value["iters"] for key, value in SPLAT_PRESETS.items()}
BASE_OVERHEAD_MIB = 900

# Medium calibration from SPLAT_EXPERIMENTS.md. At 214 images, -d2 projected
# 8800 MiB and observed 8354 MiB (76% of the 11 GiB operational cap).
MEDIUM_SLOPE_MIB_STEP = 3.1
MEDIUM_WARMUP = 500


def _base_imgs_mib(n_images: int, width: int, d: int = 1) -> float:
    height = width * 9 // 16
    return n_images * (width * height * 3 * 4) / (d * d) / 2**20


def input_floor_mib(n_images: int, width: int, d: int = 1) -> int:
    """Deterministic lower bound: decoded image tensors plus runtime overhead."""
    return round(BASE_OVERHEAD_MIB + _base_imgs_mib(n_images, width, d))


def project_peak_mib(n_images: int, width: int, preset: str, d: int = 1,
                     iters: int | None = None) -> int:
    """Return the calibrated Medium estimate; reject unsupported precision."""
    if preset != "medium":
        raise ValueError(f"preset {preset} has no calibrated numeric peak model")
    steps = max(0, (iters or PRESET_ITERS["medium"]) - MEDIUM_WARMUP)
    return round(input_floor_mib(n_images, width, d) + MEDIUM_SLOPE_MIB_STEP * steps)


def splat_preflight(n_images: int, width: int, preset: str, d: int = 1) -> dict:
    """Classify risk without claiming that the Mac is categorically incapable.

    `recommended_d` is an execution hint. A value of 2 means the full-resolution
    image load already consumes too much of the cap, so the worker should skip
    the guaranteed-waste full-resolution attempt.
    """
    if preset not in PRESET_ITERS:
        raise ValueError(f"unknown splat preset: {preset}")
    if n_images < 1 or width < 1 or d < 1:
        raise ValueError("n_images, width and d must be positive")

    cap = int(hwconfig.load()["caps"]["opensplat_mib"])
    floor = input_floor_mib(n_images, width, d)
    d2 = max(2, d)
    floor_d2 = input_floor_mib(n_images, width, d2)
    recommended_d = d2 if floor / cap > 0.70 else d
    common = {
        "preset": preset,
        "n_images": n_images,
        "width": width,
        "input_scale": d,
        "cap_mib": cap,
        "input_floor_mib": floor,
        "d2_input_floor_mib": floor_d2,
        "recommended_d": recommended_d,
        "basis": (f"{n_images} imágenes @{width}px /{d}; piso de carga calculado "
                  "con tensores RGB float32 + overhead observado"),
    }

    if preset != "medium":
        if floor_d2 / cap > 0.90:
            return {
                **common,
                "verdict": "INPUT_FLOOR_EXCEEDS_CAP",
                "confidence": "deterministic_floor",
                "note": ("Incluso la carga de imágenes a -d 2 rebasa el margen operativo; "
                         "reduce imágenes o resolución antes de entrenar."),
            }
        note = ("Cinematic/Ultra no tiene un modelo de pico calibrado para esta escena. "
                "El Mac ha completado estos presets y también ha tenido OOM; se usará "
                "la escala de entrada más segura y se registrará cada fallback.")
        if recommended_d == 2:
            note = (f"La carga full-res por sí sola estima {floor} MiB; comenzar en -d 2 "
                    f"reduce ese piso a {floor_d2} MiB. " + note)
        return {
            **common,
            "verdict": "UNVERIFIED_HIGH_RISK",
            "confidence": "unverified",
            "note": note,
        }

    projected = project_peak_mib(n_images, width, "medium", d)
    d2_projected = project_peak_mib(n_images, width, "medium", d2)
    pct = round(projected / cap * 100)
    d2_pct = round(d2_projected / cap * 100)
    out = {
        **common,
        "confidence": "calibrated",
        "projected_peak_mib": projected,
        "d2_projected_peak_mib": d2_projected,
        "pct": pct,
        "d2_pct": d2_pct,
        "basis": (common["basis"] + "; Medium calibrado contra picos medidos "
                  "(incertidumbre histórica aproximada ±25%)"),
    }
    if pct <= 70:
        return {**out, "verdict": "SAFE", "recommended_d": d}
    if pct <= 90:
        return {**out, "verdict": "ELEVATED", "recommended_d": d}
    if d2_pct <= 90:
        return {
            **out,
            "verdict": "LIKELY_OOM",
            "recommended_d": d2,
            "surviving_rung": 1,
            "rung_projected_mib": d2_projected,
            "note": (f"Full-res está fuera del sobre calibrado ({pct}%); -d {d2} "
                     f"proyecta {d2_pct}% y debe ser el primer intento."),
        }
    return {
        **out,
        "verdict": "REJECTED",
        "recommended_d": d2,
        "note": ("Medium queda fuera del sobre calibrado incluso a -d 2; reduce el "
                 "conjunto de imágenes o usa una resolución de entrada menor."),
    }


def splat_preflight_for_backend(n_images: int, width: int, preset: str,
                                backend: str = "metal", *, node: dict | None = None,
                                project_bytes: int = 0,
                                wsl_free_bytes: int | None = None,
                                bridge_free_bytes: int | None = None) -> dict:
    """Route preflight to the owning machine without mixing memory models."""
    backend = validate_splat_backend(preset, backend)
    if backend != "cuda":
        return {**splat_preflight(n_images, width, preset), "backend": backend,
                "machine": "mac"}

    node = dict(node or {})
    status = str(node.get("status") or "unknown")
    required_wsl = max(2 * 1024**3, int(project_bytes) * 4)
    required_bridge = max(1024**3, int(project_bytes) * 2)
    common = {
        "preset": preset,
        "backend": "cuda",
        "machine": "pc",
        "n_images": n_images,
        "width": width,
        "node_status": status,
        "gpu": node.get("gpu"),
        "driver": node.get("driver"),
        "vram_total_mb": node.get("vram_total_mb"),
        "environment_verified": bool(node.get("environment_verified")),
        "project_bytes": int(project_bytes),
        "required_wsl_bytes": required_wsl,
        "required_bridge_bytes": required_bridge,
        "wsl_free_bytes": wsl_free_bytes,
        "bridge_free_bytes": bridge_free_bytes,
        "confidence": "unverified_full_resolution",
        "recommended_d": 1,
    }
    if status not in ("awake", "asleep"):
        return {**common, "verdict": "NODE_UNAVAILABLE",
                "note": "El nodo CUDA no responde; verifica red, SSH o Wake-on-LAN."}
    if status == "awake" and node.get("environment_verified") is False:
        return {**common, "verdict": "ENVIRONMENT_INVALID",
                "note": "El nodo responde pero CUDA/gsplat todavía no está verificado."}
    if wsl_free_bytes is not None and wsl_free_bytes < required_wsl:
        return {**common, "verdict": "INSUFFICIENT_DISK",
                "disk": "wsl", "note": "Espacio insuficiente en WSL ext4."}
    if bridge_free_bytes is not None and bridge_free_bytes < required_bridge:
        return {**common, "verdict": "INSUFFICIENT_DISK",
                "disk": "bridge", "note": "Espacio insuficiente en el puente NTFS."}
    if status == "asleep":
        return {**common, "verdict": "NODE_ASLEEP",
                "note": "El PC está dormido y se despertará al iniciar el trabajo."}
    return {**common, "verdict": "UNVERIFIED_FULL_RES",
            "note": ("CUDA intentará la entrada completa primero. El pico de VRAM se "
                     "medirá; sólo un OOM clasificado permite reintentar a media resolución.")}
