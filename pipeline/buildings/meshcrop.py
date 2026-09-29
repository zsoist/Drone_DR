"""Crop the (huge) textured ODM OBJ to the neighbourhood of a few footprints so Blender only
has to load the atlas pages those faces use (2 buildings -> ~10 of 106 pages)."""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np


def _mtl_map(mtl: Path) -> dict[str, str]:
    cur, out = None, {}
    for line in Path(mtl).read_text().splitlines():
        p = line.split(None, 1)
        if len(p) == 2 and p[0] == "newmtl":
            cur = p[1].strip()
        elif len(p) == 2 and p[0] == "map_Kd" and cur:
            out[cur] = p[1].strip()
    return out


def crop_obj(obj: Path, mtl: Path, keep, out_obj: Path, *, to_bl, require_all: bool = False) -> dict:
    """Write out_obj(+.mtl) with the faces whose vertices satisfy keep(Vb) -> bool array
    (Vb = to_bl(V), the vertices already mapped to Blender space; any / all per `require_all`).
    Texture paths in the
    written .mtl are relative to the output (Blender mangles absolute ones); PNGs are not copied."""
    obj, mtl, out_obj = Path(obj), Path(mtl), Path(out_obj)
    verts, vts, faces, fmat, mats = [], [], [], [], []
    cur = -1
    with obj.open() as f:
        for line in f:
            c = line[:2]
            if c == "v ":
                verts.append(line.split()[1:4])
            elif c == "vt":
                vts.append(line.split()[1:3])
            elif c == "f ":
                faces.append(line.split()[1:4])
                fmat.append(cur)
            elif line.startswith("usemtl"):
                name = line.split()[1]
                if name not in mats:
                    mats.append(name)
                cur = mats.index(name)
    V = np.array(verts, dtype=np.float64)
    VT = np.array(vts, dtype=np.float64)
    fi = np.array([[int(t.split("/")[0]) - 1 for t in fc] for fc in faces], dtype=np.int64)
    ti = np.array([[int(t.split("/")[1]) - 1 for t in fc] for fc in faces], dtype=np.int64)
    fmat = np.array(fmat)
    Vall = to_bl(V)
    vin = keep(Vall)
    fk = vin[fi].all(axis=1) if require_all else vin[fi].any(axis=1)
    fi, ti, fmat = fi[fk], ti[fk], fmat[fk]
    uv, inv_v = np.unique(fi, return_inverse=True)
    ut, inv_t = np.unique(ti, return_inverse=True)
    Vb = Vall[uv]
    used = sorted(set(fmat.tolist()))
    maps = _mtl_map(mtl)
    out_obj.parent.mkdir(parents=True, exist_ok=True)
    with out_obj.open("w") as o:
        o.write(f"mtllib {out_obj.stem}.mtl\n")
        np.savetxt(o, Vb, fmt="v %.5f %.5f %.5f")
        np.savetxt(o, VT[ut], fmt="vt %.6f %.6f")
        inv_v = inv_v.reshape(-1, 3) + 1
        inv_t = inv_t.reshape(-1, 3) + 1
        for m in used:
            o.write(f"usemtl {mats[m]}\n")
            idx = np.nonzero(fmat == m)[0]
            for i in idx:
                a, b = inv_v[i], inv_t[i]
                o.write(f"f {a[0]}/{b[0]} {a[1]}/{b[1]} {a[2]}/{b[2]}\n")
    with (out_obj.with_suffix(".mtl")).open("w") as o:
        for m in used:
            name = mats[m]
            o.write(f"newmtl {name}\nKd 1 1 1\nmap_Kd {os.path.relpath((mtl.parent / maps[name]).resolve(), out_obj.resolve().parent)}\n")
    return {"faces": int(len(fi)), "materials": [mats[m] for m in used], "verts": int(len(uv))}
