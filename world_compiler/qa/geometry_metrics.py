"""Geometry accuracy summaries against independent reference samples."""

from __future__ import annotations

import numpy as np


def summarize_errors(errors_m: list[float]) -> dict:
    values = np.asarray(errors_m, dtype=np.float64)
    if values.ndim != 1 or not len(values) or not np.isfinite(values).all() or (values < 0).any():
        raise ValueError("geometry errors must be a non-empty finite non-negative vector")
    median = float(np.median(values))
    p95 = float(np.percentile(values, 95))
    return {
        "sample_count": int(len(values)),
        "median_m": round(median, 9),
        "p95_m": round(p95, 9),
        "passes_median": median <= 0.15,
        "passes_p95": p95 <= 0.40,
    }
