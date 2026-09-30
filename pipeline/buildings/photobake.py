"""W4b driver: photo-projected atlas + GLB for every main building (Mac only, no Blender needed).

    python3 -m pipeline.buildings.photobake <clip_id> [--only b01] [--atlas 4096] [--facets N]

Reads work/<name>_shell.npz (shell in Blender space; game = (x, z, -y)), the ODM cameras/photos
and the DSM grid; writes <name>.glb (meshopt + KTX2 via gltfpack), work/<name>_photo_atlas.png,
work/<name>_photo_labels.png (which photo won where) and merges per-facet metadata into meta.json.
The previous visual GLBs are kept as <name>.v1.glb (and meta.v1.json) on first run.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from buildings import facets as FA               # noqa: E402
from buildings import frame as FR                # noqa: E402
from buildings import photoproj as PP            # noqa: E402
from buildings import photos as PH               # noqa: E402
from paths import VAULT                          # noqa: E402

GRID_RES = 0.25


def shell_game(work: Path, name: str):
    d = np.load(work / f"{name}_shell.npz")
    v = d["verts"]
    g = np.c_[v[:, 0], v[:, 2], -v[:, 1]]
    return g, d["tris"], d["surf"]


def _vis_faces(g, t, s):
    keep = s != 2
    return g, t[keep], s[keep]


def build_building(name, cid, vault, fr, cams, store, hf, *, atlas=4096, min_d=0.02, max_d=0.08,
                   facet_limit=None, log=print):
    bdir = Path(vault) / "models" / cid / "buildings"
    work = bdir / "work"
    g, t, s = _vis_faces(*shell_game(work, name))
    fs = FA.extract_facets(g, t, s)
    if facet_limit:
        fs = fs[:facet_limit]
    # provisional coarse layout only to get sample points for ranking
    for f in fs:
        W, H = f.size_m
        f.px = (max(4, int(W / 0.1)), max(4, int(H / 0.1)))
    ranked, target = {}, {}
    t0 = time.time()
    for f in fs:
        mask = FA.facet_mask(f, g, t)
        pts = PP.sample_points(f, mask)
        rk = PP.rank_cameras(f, pts, cams, hf, store)
        ranked[f.fid] = rk
        target[f.fid] = 0.85 * rk[0].gsd if rk else max_d
    log(f"[{name}] ranked {len(fs)} facets in {time.time() - t0:.1f}s")
    k = FA.layout_atlas(fs, atlas, target_density=target, min_density=min_d, max_density=max_d, roof_scale=1.0)
    log(f"[{name}] layout scale {k:.3f}; densities cm/px min {min(f.density for f in fs) * 100:.1f} "
        f"max {max(f.density for f in fs) * 100:.1f}")
    img = np.full((atlas, atlas, 3), 128, np.uint8)
    labels = np.zeros((atlas, atlas, 3), np.uint8)
    infos = {}
    t0 = time.time()
    palette = np.random.default_rng(7).integers(40, 255, size=(4096, 3)).astype(np.uint8)
    photo_ids: dict[str, int] = {}
    prm = PP.BakeParams()
    for f in fs:
        mask = FA.facet_mask(f, g, t)
        rgb, info = PP.bake_facet(f, mask, cams, store, hf, ranked[f.fid], prm)
        w, h = f.px
        x, y = f.at
        P = FA.PAD
        padded = np.pad(rgb, ((P, P), (P, P), (0, 0)), mode="edge")
        img[y - P:y + h + P, x - P:x + w + P] = padded
        pid = photo_ids.setdefault(info.get("primary") or "-", len(photo_ids))
        labels[y:y + h, x:x + w] = palette[pid]
        infos[f.fid] = info
        if f.fid % 10 == 0:
            log(f"[{name}] facet {f.fid}/{len(fs)} {w}x{h}px primary={info.get('primary')} holes={info['hole_frac']}")
    log(f"[{name}] baked in {time.time() - t0:.1f}s")
    return g, t, s, fs, img, labels, infos, k


def write_glb(name, g, t, fs, atlas_img, out_raw: Path, atlas: int):
    import trimesh
    from PIL import Image
    V, UV, N, F = [], [], [], []
    base = 0
    for f in fs:
        P = g[t[f.tris]].reshape(-1, 3)
        uv = FA.facet_uv(f, g, t, atlas).reshape(-1, 2)
        V.append(P)
        UV.append(uv)
        N.append(np.tile(f.n, (len(P), 1)))
        F.append(np.arange(len(P)).reshape(-1, 3) + base)
        base += len(P)
    V, UV, N, F = np.vstack(V), np.vstack(UV), np.vstack(N), np.vstack(F)
    UV = np.c_[UV[:, 0], 1.0 - UV[:, 1]]          # trimesh flips v on glTF export (expects origin bottom-left)
    mat = trimesh.visual.material.PBRMaterial(baseColorTexture=Image.fromarray(atlas_img), metallicFactor=0.0,
                                              roughnessFactor=1.0, name=f"{name}_facade")
    mesh = trimesh.Trimesh(V, F, vertex_normals=N, process=False,
                           visual=trimesh.visual.TextureVisuals(uv=UV, material=mat))
    mesh.export(out_raw)
    return V, F


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--only")
    ap.add_argument("--atlas", type=int, default=4096)
    ap.add_argument("--facets", type=int, default=0, help="debug: only the N largest facets")
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--suffix", default="", help="write <name><suffix>.glb (debug)")
    a = ap.parse_args()
    res = photobake(a.clip_id, only=a.only, atlas=a.atlas, facet_limit=a.facets, export=not a.no_export, suffix=a.suffix)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "facets"} for k, v in res.items()}, indent=1, default=float))


def photobake(cid, vault=VAULT, *, only=None, atlas=4096, facet_limit=0, export=True, suffix="", log=print):
    from buildings import run as R
    fr = FR.load_frame(vault, cid)
    bdir = Path(vault) / "models" / cid / "buildings"
    work = bdir / "work"
    grid = FR.Grid(np.load(work / "dsm_grid.npy"), GRID_RES, -135.0, 135.0)
    hf = PP.HeightField(grid, fr.elev_min)
    cams = PH.load_cameras(vault, cid, fr)
    store = PP.PhotoStore(PH.images_dir(vault, cid), work / "photo_sharpness.json")
    store.measure_sharpness(list(cams))
    for n in ("b01", "b02"):                                   # keep v1 for comparison (first run only)
        for ext in (".glb",):
            src, dst = bdir / f"{n}{ext}", bdir / f"{n}.v1{ext}"
            if src.exists() and not dst.exists():
                shutil.copy2(src, dst)
    if (bdir / "meta.json").exists() and not (bdir / "meta.v1.json").exists():
        shutil.copy2(bdir / "meta.json", bdir / "meta.v1.json")
    meta = json.loads((bdir / "meta.json").read_text())
    out = {}
    from PIL import Image
    for name in sorted(k for k in meta["buildings"]):
        if only and name != only:
            continue
        g, t, s, fs, img, labels, infos, k = build_building(name, cid, vault, fr, cams, store, hf, atlas=atlas,
                                                            facet_limit=facet_limit, log=log)
        Image.fromarray(img).save(work / f"{name}_photo_atlas.png")
        Image.fromarray(labels).save(work / f"{name}_photo_labels.png")
        rec = {"facets": []}
        for f in fs:
            i = infos[f.fid]
            rec["facets"].append({"id": f.fid, "kind": "wall" if f.kind == FA.WALL else "roof",
                                  "area_m2": round(f.area, 2), "size_m": [round(x, 2) for x in f.size_m],
                                  "normal": [round(float(x), 3) for x in f.n], "texel_cm": round(f.density * 100, 2),
                                  "px": list(f.px), "atlas_xy": list(f.at), "primary_photo": i.get("primary"),
                                  "primary_cos": i["photos"][0]["cos"] if i.get("photos") else None,
                                  "primary_gsd_cm": round(i["photos"][0]["gsd_m"] * 100, 2) if i.get("photos") else None,
                                  "photos": i.get("photos", [])[:4], "hole_frac": i["hole_frac"],
                                  "veg_frac": i.get("veg_frac", 0.0)})
        rec["atlas"] = atlas
        rec["density_scale_vs_native"] = round(k, 3)
        area = sum(f.area for f in fs)
        rec["texel_cm_area_weighted"] = round(float(sum(f.density * f.area for f in fs) / area * 100), 2)
        rec["hole_frac_area_weighted"] = round(float(sum(infos[f.fid]["hole_frac"] * f.area for f in fs) / area), 4)
        if export:
            raw = work / f"{name}_photo_raw.glb"
            V, F = write_glb(name, g, t, fs, img, raw, atlas)
            vis = bdir / f"{name}{suffix}.glb"
            R._gltfpack(raw, vis, textured=True, quality=10)
            st, wv = R._node_frame(vis)
            from scipy.spatial import cKDTree
            dist = cKDTree(g).query(wv)[0]
            rec["bytes"] = vis.stat().st_size
            rec["tris"] = st["tris"]
            rec["frame_check_glb_vertex_to_shell_max_m"] = round(float(dist.max()), 5)
            rec["file"] = vis.name
        out[name] = rec
        if export and not suffix:
            b = meta["buildings"][name]
            b["file"] = f"{name}.glb"
            b["bytes"] = rec["bytes"]
            b["tris"] = rec["tris"]
            b["frame_check"]["glb_vertex_to_shell_max_m"] = rec["frame_check_glb_vertex_to_shell_max_m"]
            b["textures"] = {"method": "photo-projection (best-view per facet, DSM visibility, ExG mask, gain match)",
                             "size": atlas, "format": "KTX2 ETC1S q10 via gltfpack",
                             **{kk: rec[kk] for kk in ("density_scale_vs_native", "texel_cm_area_weighted", "hole_frac_area_weighted")},
                             "facets": rec["facets"]}
    if export and not suffix:
        meta["textures_generator"] = "pipeline/buildings/photobake.py (v2, photo-projected); v1 = Blender bake, see meta.v1.json"
        (bdir / "meta.json").write_text(json.dumps(meta, indent=1, default=float))
    return out


if __name__ == "__main__":
    main()
