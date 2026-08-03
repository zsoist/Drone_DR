#!/usr/bin/env python3
"""Heightfield LOD del DSM para el cliente (FLIGHTVERSE).

dsm.bin completo (float32 h×w, >100MB) jamás viaja al navegador. Este paso
produce models/<cid>/dsm_lod<N>.bin (float32 row-major, norte primero) +
dsm_lod.json con el frame métrico local listo para three.js:
metros, origen en el centro del DSM, +x=este, fila 0=norte.

Uso:  python3 dsm_lod.py <clip_id> [--target 256]
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

VAULT = Path("/Volumes/SSD/drone-vault")
M_PER_DEG_LAT = 111_320.0  # esferoide medio; error <0.4% — suficiente para vuelo


def fill_nodata(surface: np.ndarray, invalid: np.ndarray) -> np.ndarray:
    """Extend the nearest valid terrain into holes without inventing a low floor."""
    out = np.asarray(surface, dtype=np.float32).copy()
    known = ~np.asarray(invalid, dtype=bool)
    if not known.any():
        raise ValueError("heightfield sin celdas válidas")
    out[~known] = 0
    rows, cols = out.shape
    for _ in range(rows + cols):
        total = np.zeros_like(out)
        count = np.zeros(out.shape, dtype=np.uint8)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            values = np.roll(np.roll(out, dy, axis=0), dx, axis=1)
            neighbors = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            if dy == -1:
                neighbors[-1, :] = False
            elif dy == 1:
                neighbors[0, :] = False
            elif dx == -1:
                neighbors[:, -1] = False
            else:
                neighbors[:, 0] = False
            total += values * neighbors
            count += neighbors
        frontier = ~known & (count > 0)
        if not frontier.any():
            break
        out[frontier] = total[frontier] / count[frontier]
        known |= frontier
        if known.all():
            break
    if not known.all():
        raise ValueError("heightfield contiene nodata no alcanzable")
    return out


def smooth_ground(surface: np.ndarray, *, conservative: bool = False) -> np.ndarray:
    """Build a terrain-scale DTM; buildings remain in the structural collider."""
    out = np.asarray(surface, dtype=np.float32)
    if conservative:
        # Sparse merged reconstructions can contain coherent false hills too
        # wide for a median kernel. Keep the central terrain band playable;
        # buildings and other vertical truth still come from collision.bin.
        low, high = np.percentile(out, (2, 90))
        out = np.clip(out, low, high)
    padded = np.pad(out, 4, mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, (9, 9))
    out = np.median(windows, axis=(-2, -1)).astype(np.float32)
    # A second compact pass removes multi-pixel reconstruction needles while
    # retaining hills. Edge padding is deliberate: np.roll wrapped opposite
    # borders together and could manufacture a ridge across the map.
    padded = np.pad(out, 2, mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, (5, 5))
    return np.median(windows, axis=(-2, -1)).astype(np.float32)


def build(cid: str, target: int = 256) -> dict:
    mdir = VAULT / "models" / cid
    meta = json.loads((mdir / "meta.json").read_text())
    h, w = meta["dsm_shape"]
    gt = meta["dsm_gt"]
    nodata = float(meta.get("dsm_nodata", -9999))
    arr = np.memmap(mdir / "dsm.bin", dtype=np.float32, mode="r", shape=(h, w))

    step = max(1, math.ceil(max(h, w) / target))
    sub = np.array(arr[::step, ::step], dtype=np.float32)
    hh, ww = sub.shape

    # nodata (bordes del ortomosaico): rellenar con p05 del terreno válido —
    # un "suelo" plano honesto en vez de cráteres de -9999 que rompen la malla
    invalid = ~np.isfinite(sub) | (sub <= nodata + 1.0)
    valid = sub[~invalid]
    if valid.size == 0:
        raise SystemExit(f"DSM de {cid} sin celdas válidas")
    sub = fill_nodata(sub, invalid)
    sub = smooth_ground(sub, conservative=float(invalid.mean()) > 0.25)

    lat_c = gt[3] + gt[5] * (h / 2.0)
    m_lon = M_PER_DEG_LAT * math.cos(math.radians(lat_c))
    spacing_x = step * abs(gt[1]) * m_lon
    spacing_z = step * abs(gt[5]) * M_PER_DEG_LAT

    # descartar SOLO el nodata conectado al borde (el faldón exterior):
    # los huecos INTERIORES se quedan rellenos (p05) — descartarlos perforaba
    # techos/suelo con manchas blancas (reporte del operador)
    border = np.zeros_like(invalid)
    border[0, :] = invalid[0, :]; border[-1, :] = invalid[-1, :]
    border[:, 0] |= invalid[:, 0]; border[:, -1] |= invalid[:, -1]
    for _ in range(max(hh, ww)):
        grown = border.copy()
        grown[1:, :] |= border[:-1, :]; grown[:-1, :] |= border[1:, :]
        grown[:, 1:] |= border[:, :-1]; grown[:, :-1] |= border[:, 1:]
        grown &= invalid
        if (grown == border).all():
            break
        border = grown
    mask = (~border).astype(np.uint8) * 255
    (mdir / f"dsm_lod{target}.mask.bin").write_bytes(mask.tobytes())
    bin_name = f"dsm_lod{target}.bin"
    (mdir / bin_name).write_bytes(sub.astype("<f4").tobytes())
    side = {
        "clip_id": cid,
        "bin": bin_name,
        "mask_bin": f"dsm_lod{target}.mask.bin",
        "grid": [hh, ww],                       # filas, columnas (fila 0 = norte)
        "step_px": step,
        "spacing_m": [round(spacing_x, 4), round(spacing_z, 4)],  # x=este, z=sur
        "size_m": [round(spacing_x * (ww - 1), 2), round(spacing_z * (hh - 1), 2)],
        "elev_min": round(float(sub.min()), 2),
        "elev_max": round(float(sub.max()), 2),
        "nodata_filled_pct": round(100.0 * float(invalid.mean()), 2),
        "center_wgs84": [round(gt[0] + gt[1] * w / 2, 7), round(lat_c, 7)],
        "source": {"dsm_shape": [h, w], "dsm_gt": gt, "nodata": nodata},
    }
    (mdir / "dsm_lod.json").write_text(json.dumps(side, indent=1))
    return side


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--target", type=int, default=256)
    args = ap.parse_args()
    side = build(args.clip_id, args.target)
    print(json.dumps(side, indent=1))


if __name__ == "__main__":
    main()
