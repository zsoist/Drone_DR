"""Preflight de memoria per-preset (U1.3): el veredicto ANTES de quemar cómputo.

Nace del P1 (ultra quemaba 10 min en 3 rungs pre-condenados) y del P0 (un preset
sobre-presupuesto operó días sin que nadie lo viera). Motor = el modelo de tres
términos medido cadáver a cadáver el 11-jul (SPLAT_EXPERIMENTS.md), con sus
cláusulas: pendientes config-dependientes, error conocido ~±25% (dirección
histórica: conservadora — test nº7: −5%), calibrado a UNA clase de escena.

peak ≈ base_imgs(n·px·12B/d²)  +  pendiente(preset)·steps  +  escalón(salto ¼→½)

Toda proyección viaja al job (proyectado-vs-observado = telemetría permanente
del modelo: cada job real lo re-testea).
"""
from pathlib import Path

import hwconfig

# MiB/step durante densificación a ¼ de resolución interna, POR CLASE de preset —
# calibradas de los runs instrumentados del 11-jul (ver SPLAT_EXPERIMENTS.md):
#   bounded (thresh 0.0008/refine 300): serie medida 2.39
#   aggressive (defaults fast/medium): (6992−1400_base−900_overhead)/1500 = 3.1 (escena 1)
#   heavy (cinematic/ultra): muertes a ~10.5GB/~2200 steps ≈ 5.3
SLOPE_MIB_STEP = {"fast": 3.1, "medium": 3.1, "cinematic": 5.3, "ultra": 5.3}
WARMUP = 500                    # la densificación arranca aquí
JUMP_STEP = 3000                # resolution-schedule default: ¼→½
JUMP_MIB = 1336                 # escalón aditivo medido
JUMP_SLOPE_MULT = 1.55          # multiplicador de pendiente medido
PRESET_ITERS = {"fast": 1000, "medium": 2000, "cinematic": 7000, "ultra": 15000}
BASE_OVERHEAD_MIB = 900         # runtime torch/MPS + nube inicial (observado en arranques)


def _base_imgs_mib(n_images: int, width: int, d: int = 1) -> float:
    h = width * 9 // 16
    return n_images * (width * h * 3 * 4) / (d * d) / 2**20


def _gauss_mib(preset: str, iters: int, d: int = 1) -> float:
    slope = SLOPE_MIB_STEP.get(preset, 5.3)
    steps = max(0, min(iters, JUMP_STEP) - WARMUP)
    total = slope * steps
    if iters > JUMP_STEP:
        total += JUMP_MIB + slope * JUMP_SLOPE_MULT * (iters - JUMP_STEP)
    return total


def project_peak_mib(n_images: int, width: int, preset: str, d: int = 1,
                     iters: int | None = None) -> float:
    iters = iters or PRESET_ITERS.get(preset, 2000)
    return round(BASE_OVERHEAD_MIB + _base_imgs_mib(n_images, width, d)
                 + _gauss_mib(preset, iters, d))


def splat_preflight(n_images: int, width: int, preset: str, d: int = 1) -> dict:
    """Veredicto SAFE/ELEVATED/LIKELY_OOM/REJECTED contra el cap vigente.

    LIKELY_OOM incluye qué rung de la escalera probablemente sobreviva;
    REJECTED = ni el último rung cabe (el caso P1: no quemar los 10 minutos)."""
    cap = int(hwconfig.load()["caps"]["opensplat_mib"])
    proj = project_peak_mib(n_images, width, preset, d)
    pct = round(proj / cap * 100)
    out = {"projected_peak_mib": proj, "cap_mib": cap, "pct": pct,
           "basis": f"{n_images} imgs @{width}px /{d} · preset {preset} · modelo 3 términos (±25%, conservador)"}
    if pct <= 70:
        return {**out, "verdict": "SAFE"}
    if pct <= 90:
        return {**out, "verdict": "ELEVATED"}
    # ¿algún rung de la escalera cabe? (los rungs bajan -d, que solo ataca base_imgs —
    # el P1 demostró que NO reducen el driver de conteo; el modelo lo refleja)
    for rung, rd in ((1, d * 2), (2, d * 2)):
        rproj = project_peak_mib(n_images, width, preset, rd)
        if rproj / cap <= 0.9:
            return {**out, "verdict": "LIKELY_OOM",
                    "surviving_rung": rung, "rung_projected_mib": rproj,
                    "note": f"full-res proyecta {pct}% — el rung {rung} (-d {rd}) proyecta {round(rproj/cap*100)}%"}
    return {**out, "verdict": "REJECTED",
            "note": "ni el último rung cabe — no encolar (el caso P1: evita quemar los rungs)"}
