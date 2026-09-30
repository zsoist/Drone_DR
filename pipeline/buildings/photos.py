"""Drone photo cameras in the W4 game frame (photo-projected facade texturing, W4b).

Source of poses: ODM's OpenSfM `reconstruction.json` (Brown camera, topocentric frame:
x=E, y=N, z=up MSL, origin = reference_lla at altitude 0).  ODM georeferences its meshes by
a pure translation (UTM of reference_lla minus coords.txt origin), so

    odm  = topo + (utm(reference_lla) - coords_origin)         (x=E, y=N, z=MSL)
    game = (x_odm - cx,  z_odm - elev_min,  -(y_odm - cy))      (frame.Frame.odm_to_game)

OpenSfM pose convention: X_cam = R X + t  with R = rodrigues(rotation), camera looks along +z,
+x right, +y down.  Brown model (normalised image coordinates, focal in units of max(w, h)):

    xd = x*rad + 2 p1 x y + p2 (r2 + 2 x^2)       yd = y*rad + p1 (r2 + 2 y^2) + 2 p2 x y
    u = xd*S + (w-1)/2 + c_x*S      v = yd*S + (h-1)/2 + c_y*S    ... with focal folded in:

        xd, yd computed from x/z, y/z scaled by focal: u = fx*xd*S + ... (see `Camera.project`).
Pure numpy; unit-tested on synthetic cameras (test_buildings_photo.py).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


def rodrigues(w) -> np.ndarray:
    w = np.asarray(w, dtype=np.float64)
    th = float(np.linalg.norm(w))
    if th < 1e-12:
        return np.eye(3)
    k = w / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * (K @ K)


@dataclass
class Camera:
    """Pinhole + Brown distortion, world = game frame (y up)."""
    name: str
    R: np.ndarray            # world -> camera (3x3)
    t: np.ndarray            # (3,)
    w: int
    h: int
    focal: float             # normalised (x max(w,h))
    cx: float = 0.0          # normalised principal point offset
    cy: float = 0.0
    k1: float = 0.0
    k2: float = 0.0
    k3: float = 0.0
    p1: float = 0.0
    p2: float = 0.0

    @property
    def size(self) -> int:
        return max(self.w, self.h)

    @property
    def f_px(self) -> float:
        return self.focal * self.size

    @property
    def center(self) -> np.ndarray:
        return -self.R.T @ self.t

    @property
    def forward(self) -> np.ndarray:
        return self.R[2]

    def to_cam(self, X) -> np.ndarray:
        return np.asarray(X, dtype=np.float64) @ self.R.T + self.t

    def project(self, X, *, distort: bool = True):
        """World points (...,3) -> (u, v pixel, depth).  Pixel centres are integer + 0.5-free
        OpenSfM convention: u = xd*S + (w-1)/2 (so u in [0, w-1] over the frame)."""
        c = self.to_cam(X)
        z = c[..., 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            x = c[..., 0] / z
            y = c[..., 1] / z
        if distort and (self.k1 or self.k2 or self.k3 or self.p1 or self.p2):
            r2 = x * x + y * y
            rad = 1 + r2 * (self.k1 + r2 * (self.k2 + r2 * self.k3))
            xd = x * rad + 2 * self.p1 * x * y + self.p2 * (r2 + 2 * x * x)
            yd = y * rad + self.p1 * (r2 + 2 * y * y) + 2 * self.p2 * x * y
        else:
            xd, yd = x, y
        S = self.size
        u = (self.focal * xd + self.cx) * S + (self.w - 1) / 2
        v = (self.focal * yd + self.cy) * S + (self.h - 1) / 2
        return u, v, z

    def in_frame(self, u, v, z, margin: float = 0.0):
        return (z > 0.1) & (u >= margin) & (v >= margin) & (u <= self.w - 1 - margin) & (v <= self.h - 1 - margin)


def _cam_from_json(name: str, shot: dict, cam: dict, R_map, t_map) -> Camera:
    R0 = rodrigues(shot["rotation"])
    t0 = np.asarray(shot["translation"], dtype=np.float64)
    # world' = A(world):  X' = M X + o   ->  X = M^-1 (X' - o);  X_cam = R0 M^-1 (X' - o) + t0
    R = R0 @ R_map.T
    t = t0 - R @ t_map
    return Camera(name=name, R=R, t=t, w=int(cam["width"]), h=int(cam["height"]),
                  focal=float(cam.get("focal", cam.get("focal_x", 0.0))),
                  cx=float(cam.get("c_x", 0.0)), cy=float(cam.get("c_y", 0.0)),
                  k1=float(cam.get("k1", 0.0)), k2=float(cam.get("k2", 0.0)), k3=float(cam.get("k3", 0.0)),
                  p1=float(cam.get("p1", 0.0)), p2=float(cam.get("p2", 0.0)))


def topo_to_game_affine(frame, ref_lla: dict):
    """(M, o) with game = M @ topo + o, M a proper rotation (permutation with a sign)."""
    import sys
    pipe = str(Path(__file__).resolve().parent.parent)
    if pipe not in sys.path:
        sys.path.insert(0, pipe)
    import scene_aoi
    ue, un = scene_aoi.utm18_from_wgs84(ref_lla["latitude"], ref_lla["longitude"])
    dE, dN = ue - frame.origin_utm[0], un - frame.origin_utm[1]
    cx, cy = frame.center_odm
    # game = (E - cx, up - elev_min, -(N - cy))  with E = x_t + dE, N = y_t + dN, up = z_t + alt
    M = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=np.float64)
    o = np.array([dE - cx, ref_lla.get("altitude", 0.0) - frame.elev_min, -(dN - cy)])
    return M, o


def load_cameras(vault: Path, cid: str, frame, *, offset_game=(0.0, 0.0, 0.0)) -> dict[str, Camera]:
    """All registered shots of the ODM project behind `cid` as game-frame cameras.
    `offset_game` is an optional extra translation of the WORLD (registration refinement)."""
    root = Path(vault) / "odm" / f"proj_{cid.split('_aoi')[0]}" / "opensfm"
    rec = json.loads((root / "reconstruction.json").read_text())[0]
    M, o = topo_to_game_affine(frame, rec["reference_lla"])
    o = o + np.asarray(offset_game, dtype=np.float64)
    return {n: _cam_from_json(n, s, rec["cameras"][s["camera"]], M, o) for n, s in rec["shots"].items()}


def images_dir(vault: Path, cid: str) -> Path:
    return Path(vault) / "odm" / f"proj_{cid.split('_aoi')[0]}" / "images"
