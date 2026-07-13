#!/usr/bin/env python3
"""Convierte un PLY 3DGS (nerfstudio/gsplat) al formato .splat (antimatter15).

El pipeline de publicacion (crop_floaters, export_viewer_sog, splat_align y el
viewer Spark) habla .splat; el lane CUDA (gpu_lane.py) trae PLY. Este puente es
la pieza que une ambos mundos sin tocar el resto del pipeline.

Formato .splat: 32 bytes por gaussiana, little-endian, sin header:
  pos xyz float32 (12) + scale xyz float32 (12) + rgba uint8 (4) + quat uint8 (4)
Transformaciones (las mismas que aplica OpenSplat al exportar):
  scale  = exp(scale_i)                      (el PLY guarda log-scale)
  color  = clamp(0.5 + SH_C0 * f_dc_i) * 255 (SH grado 0 -> RGB)
  alpha  = sigmoid(opacity) * 255
  quat   = normalizado, cuantizado q*128+128

Uso: python3 ply2splat.py <in.ply> <out.splat>
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

SH_C0 = 0.28209479177387814


def read_gaussian_ply(path: Path) -> np.ndarray:
    """Lee un PLY binario 3DGS y devuelve un array estructurado con sus props."""
    raw = path.read_bytes()
    end = raw.find(b"end_header\n")
    if end < 0:
        raise ValueError("PLY sin end_header — ¿archivo corrupto?")
    header = raw[:end].decode("ascii", errors="replace").splitlines()
    if "format binary_little_endian 1.0" not in header:
        raise ValueError("solo se soporta PLY binary_little_endian")
    n = 0
    fields: list[tuple[str, str]] = []
    types = {"float": "<f4", "double": "<f8", "uchar": "u1", "uint8": "u1",
             "int": "<i4", "uint": "<u4", "short": "<i2", "ushort": "<u2"}
    for ln in header:
        p = ln.split()
        if p[:2] == ["element", "vertex"]:
            n = int(p[2])
        elif p and p[0] == "property":
            if p[1] == "list":
                raise ValueError("PLY con propiedades list — no es un PLY de gaussianas")
            fields.append((p[2], types[p[1]]))
    if not n or not fields:
        raise ValueError("PLY sin element vertex o sin propiedades")
    dt = np.dtype(fields)
    body = raw[end + len(b"end_header\n"):]
    if len(body) < n * dt.itemsize:
        raise ValueError(f"PLY truncado: {len(body)} bytes < {n}x{dt.itemsize}")
    return np.frombuffer(body[:n * dt.itemsize], dtype=dt)


def ply_to_splat(src: Path, dst: Path) -> dict:
    v = read_gaussian_ply(src)
    need = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
            "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    missing = [k for k in need if k not in v.dtype.names]
    if missing:
        raise ValueError(f"PLY sin propiedades de gaussianas: faltan {missing}")
    n = len(v)
    pos = np.stack([v["x"], v["y"], v["z"]], axis=1).astype("<f4")
    scale = np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], axis=1)).astype("<f4")
    rgb = 0.5 + SH_C0 * np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], axis=1)
    alpha = 1.0 / (1.0 + np.exp(-v["opacity"].astype("f8")))
    rgba = np.concatenate([np.clip(rgb, 0, 1), alpha[:, None]], axis=1)
    rgba = (rgba * 255).round().clip(0, 255).astype("u1")
    quat = np.stack([v["rot_0"], v["rot_1"], v["rot_2"], v["rot_3"]], axis=1).astype("f8")
    norm = np.linalg.norm(quat, axis=1, keepdims=True)
    norm[norm == 0] = 1.0
    quat = ((quat / norm) * 128 + 128).round().clip(0, 255).astype("u1")
    # orden por impacto visual (volumen x alpha, descendente) — mismo criterio que
    # el conversor de referencia; los viewers no lo exigen pero mejora el LOD
    weight = (scale.astype("f8").prod(axis=1)) * (rgba[:, 3].astype("f8") / 255.0)
    order = np.argsort(-weight)
    out = np.zeros(n, dtype=[("pos", "<f4", 3), ("scale", "<f4", 3),
                             ("rgba", "u1", 4), ("quat", "u1", 4)])
    out["pos"], out["scale"] = pos[order], scale[order]
    out["rgba"], out["quat"] = rgba[order], quat[order]
    dst.write_bytes(out.tobytes())
    return {"gaussians": n, "bytes": n * 32,
            "alpha_mean": float(alpha.mean()), "scale_max": float(scale.max())}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[-1])
    info = ply_to_splat(Path(sys.argv[1]), Path(sys.argv[2]))
    print(info)
