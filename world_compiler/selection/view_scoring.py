"""Small, explicit scoring primitives shared by Hero Cell selection."""

from __future__ import annotations

import math


def normalized(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError("metric must be numeric") from error
    if not math.isfinite(number):
        raise ValueError("metric must be finite")
    return max(0.0, min(1.0, number))
