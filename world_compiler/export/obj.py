"""Small deterministic OBJ writer for layered triangle geometry."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def write_obj(
    path: Path,
    vertices: np.ndarray,
    faces: np.ndarray,
    *,
    role: str,
    uv_bounds: tuple[float, float, float, float] | None = None,
) -> None:
    vertices = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.uint32)
    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise ValueError("OBJ vertices must have shape (N, 3)")
    if faces.ndim != 2 or faces.shape[1] != 3:
        raise ValueError("OBJ faces must have shape (N, 3)")
    if not np.isfinite(vertices).all():
        raise ValueError("OBJ vertices must be finite")
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"# AeroBrain Hero Cell layer: {role}\n", f"o {role}\n"]
    lines.extend(f"v {x:.9f} {y:.9f} {z:.9f}\n" for x, y, z in vertices)
    if uv_bounds is not None:
        x0, z0, x1, z1 = (float(value) for value in uv_bounds)
        if not x1 > x0 or not z1 > z0:
            raise ValueError("OBJ UV bounds must have positive area")
        uv = np.column_stack(
            ((vertices[:, 0] - x0) / (x1 - x0), (vertices[:, 2] - z0) / (z1 - z0))
        )
        lines.extend(f"vt {u:.9f} {v:.9f}\n" for u, v in uv)
        lines.extend(
            f"f {a + 1}/{a + 1} {b + 1}/{b + 1} {c + 1}/{c + 1}\n"
            for a, b, c in faces
        )
    else:
        lines.extend(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in faces)
    path.write_text("".join(lines), encoding="utf-8")
