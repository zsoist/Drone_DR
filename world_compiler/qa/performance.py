"""Strict RTX performance gate with no defaults for missing measurements."""

from __future__ import annotations


def evaluate_performance(
    avg_fps: float | None,
    one_percent_low_fps: float | None,
    vram_mib: float | None,
    *,
    route_completed: bool | None,
) -> dict:
    measured = all(value is not None for value in (avg_fps, one_percent_low_fps, vram_mib, route_completed))
    passes = bool(
        measured
        and float(avg_fps) >= 60.0
        and float(one_percent_low_fps) >= 45.0
        and float(vram_mib) <= 7200.0
        and route_completed is True
    )
    return {
        "status": "passed" if passes else "failed" if measured else "blocked_external",
        "passes": passes,
        "avg_fps": avg_fps,
        "one_percent_low_fps": one_percent_low_fps,
        "vram_mib": vram_mib,
        "route_completed": route_completed,
        "thresholds": {"avg_fps_min": 60.0, "one_percent_low_fps_min": 45.0, "vram_mib_max": 7200.0},
    }
