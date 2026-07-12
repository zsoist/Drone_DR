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
    floor = float(np.percentile(valid, 5))
    sub = np.where(invalid, np.float32(floor), sub)
    # mediana 3x3: las AGUJAS del DSM (px sueltos de reconstrucción) fundían
    # los edificios en púas — la mediana las mata preservando bordes reales
    st = np.stack([np.roll(np.roll(sub, dy, 0), dx, 1)
                   for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    sub = np.median(st, axis=0).astype(np.float32)

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
