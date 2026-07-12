#!/usr/bin/env python3
"""Alineación splat<->terreno (FLIGHTVERSE) — resuelve la deuda #1 del spike P1.

El splat vive en el frame normalizado de OpenSplat; el juego vive en metros
locales (origen = centro del DSM, +x=este, +y=arriba, +z=sur). Este paso
resuelve la similitud (escala+R+t, Umeyama) entre las posiciones de cámara
del splat (splats/<cid>.cameras.json) y las MISMAS cámaras optimizadas por
OpenSfM en frame topocéntrico (odm/proj_<cid>/opensfm/
reconstruction.topocentric.json — la reconstrucción sobre la que entrenó el
splat), y compone la transformación al frame del juego.

Escribe en models/<cid>/scene.v2.json:
  transforms.splat = { matrix: [16], status: 'aligned', rmse_m, n_cams }
RMSE honesto: si supera el umbral, status queda 'unaligned' y el runtime NO
muestra el splat (regla del spec: nunca fingir registro).

Uso:  python3 splat_align.py <clip_id> [--max-rmse 2.0]
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

VAULT = Path("/Volumes/SSD/drone-vault")
M_LAT = 111_320.0


def rodrigues(rvec: np.ndarray) -> np.ndarray:
    th = np.linalg.norm(rvec)
    if th < 1e-12:
        return np.eye(3)
    k = rvec / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * (K @ K)


def umeyama(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """Similitud src->dst con escala (Umeyama 1991). Devuelve (s, R, t)."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    sc, dc = src - mu_s, dst - mu_d
    cov = dc.T @ sc / len(src)
    U, D, Vt = np.linalg.svd(cov)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1
    R = U @ S @ Vt
    var_s = (sc ** 2).sum() / len(src)
    s = float(np.trace(np.diag(D) @ S) / var_s)
    t = mu_d - s * R @ mu_s
    return s, R, t


def align(cid: str, max_rmse: float = 2.0) -> dict:
    cams = json.loads((VAULT / "splats" / f"{cid}.cameras.json").read_text())
    recon_p = VAULT / "odm" / f"proj_{cid}" / "opensfm" / "reconstruction.topocentric.json"
    if not recon_p.exists():
        raise SystemExit(f"{cid}: sin reconstruction.topocentric.json — no hay verdad métrica")
    recon = json.loads(recon_p.read_text())[0]
    shots = recon["shots"]
    ref = recon["reference_lla"]

    # centros de cámara: splat frame vs topocéntrico (C = -R^T t)
    P_splat, P_topo, used = [], [], []
    for c in cams:
        sh = shots.get(c["img_name"])
        if not sh:
            continue
        R = rodrigues(np.array(sh["rotation"], float))
        C = -R.T @ np.array(sh["translation"], float)
        P_splat.append(c["position"])
        P_topo.append(C)
        used.append(c["img_name"])
    if len(used) < 8:
        raise SystemExit(f"{cid}: solo {len(used)} correspondencias — insuficiente")
    P_splat = np.array(P_splat, float)
    P_topo = np.array(P_topo, float)

    s, R, t = umeyama(P_splat, P_topo)
    pred = (s * (R @ P_splat.T)).T + t
    rmse = float(np.sqrt(((pred - P_topo) ** 2).sum(1).mean()))

    # topocéntrico (E,N,U respecto a reference_lla) -> frame del juego
    # (E, U-elev_min_rel, -N respecto al centro del DSM)
    mdir = VAULT / "models" / cid
    man_p = mdir / "scene.v2.json"
    man = json.loads(man_p.read_text())
    world = man["world"]
    clon, clat = world["center_wgs84"]
    off_e = (ref["longitude"] - clon) * M_LAT * math.cos(math.radians(clat))
    off_n = (ref["latitude"] - clat) * M_LAT
    # datum vertical: si las z topocéntricas son msnm absolutas (drone abs_alt),
    # restar elev_min del DSM; si son relativas (~0..300), anclar al suelo del
    # DSM en el centroide de cámaras. Se decide por magnitud y se reporta.
    z_med = float(np.median(P_topo[:, 2]))
    if z_med > 1500:                       # msnm absoluto (Bogotá ~2600)
        off_u = -world["elev_min"]
        datum = "absolute_msl"
    else:                                  # relativo al punto de referencia
        off_u = float(ref.get("altitude", 0.0)) - 0.0
        datum = "relative_ref"
    M_topo_game = np.array([
        [1, 0, 0, off_e],
        [0, 0, 1, off_u],
        [0, -1, 0, -off_n],
        [0, 0, 0, 1],
    ], float)

    M_splat_topo = np.eye(4)
    M_splat_topo[:3, :3] = s * R
    M_splat_topo[:3, 3] = t
    M = M_topo_game @ M_splat_topo

    ok = rmse <= max_rmse
    man["transforms"]["splat"] = {
        "matrix": [round(v, 8) for v in M.flatten().tolist()],  # row-major 4x4
        "status": "aligned" if ok else "unaligned",
        "rmse_m": round(rmse, 3),
        "n_cams": len(used),
        "scale": round(s, 6),
        "datum": datum,
    }
    man_p.write_text(json.dumps(man, ensure_ascii=False, indent=1))
    return {"cid": cid, "rmse_m": round(rmse, 3), "n_cams": len(used),
            "scale": round(s, 4), "datum": datum, "status": man["transforms"]["splat"]["status"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--max-rmse", type=float, default=2.0)
    args = ap.parse_args()
    print(json.dumps(align(args.clip_id, args.max_rmse), indent=1))


if __name__ == "__main__":
    main()
