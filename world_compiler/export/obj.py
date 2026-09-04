"""Small deterministic OBJ writer for layered triangle geometry."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def write_obj(path: Path, vertices: np.ndarray, faces: np.ndarray, *, role: str) -> None:
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
    lines.extend(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in faces)
    path.write_text("".join(lines), encoding="utf-8")
