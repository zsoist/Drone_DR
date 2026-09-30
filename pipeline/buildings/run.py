#!/usr/bin/env python3
"""W4 building pipeline driver (offline asset, not wired into the web).

    python3 -m pipeline.buildings.run footprints <clip_id>     # step 1
    python3 -m pipeline.buildings.run shell      <clip_id>     # step 2 (Roofer or LoD1.x fallback)
    python3 -m pipeline.buildings.run bake       <clip_id>     # step 3 (Blender headless)
    python3 -m pipeline.buildings.run export     <clip_id>     # step 4 (gltfpack)
    python3 -m pipeline.buildings.run photobake  <clip_id>     # W4b: best-photo projected atlas + GLB (no Blender)
    python3 -m pipeline.buildings.run all        <clip_id>

Outputs under models/<cid>/buildings/ ; scratch (point-cloud crops, Roofer output, raw
bakes) under models/<cid>/buildings/work/ (safe to delete).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from buildings import footprints as F          # noqa: E402
from buildings import frame as FR              # noqa: E402
from paths import VAULT                        # noqa: E402

GRID_RES = 0.25


def bdir(cid: str, vault: Path = VAULT) -> Path:
    d = Path(vault) / "models" / cid / "buildings"
    (d / "work").mkdir(parents=True, exist_ok=True)
    return d


def load_grid(cid: str, vault: Path = VAULT):
    fr = FR.load_frame(vault, cid)
    g = FR.dsm_to_grid(fr, Path(vault) / "models" / cid / "dsm.bin", GRID_RES)
    return fr, g


def step_footprints(cid: str, vault: Path = VAULT) -> dict:
    from PIL import Image
    meta = json.loads((Path(vault) / "models" / cid / "meta.json").read_text())
    fr, g = load_grid(cid, vault)
    rgb = FR.ortho_to_grid(fr, meta, Path(vault) / "models" / cid / "ortho_full.jpg", g)
    veg = F.exg_vegetation(rgb)
    fps, dbg = F.extract_footprints(g, veg=veg)
    main = F.select_main(fps)
    names = {f.id: f"b{i:02d}" for i, f in enumerate(main, 1)}
    out = bdir(cid, vault)

    ox, oy = fr.center_odm
    utm = lambda x, y: (x + ox + fr.origin_utm[0], y + oy + fr.origin_utm[1])          # noqa: E731
    lonlat = lambda x, y: fr.odm_to_lonlat(x + ox, y + oy)                              # noqa: E731
    for tag, fn, crs in (("utm32618", utm, "urn:ogc:def:crs:EPSG::32618"), ("wgs84", lonlat, None)):
        fc = F.to_geojson(fps, transform=fn, crs_name=crs)
        for feat in fc["features"]:
            fid = feat["properties"]["id"]
            feat["properties"]["main"] = fid in names
            feat["properties"]["name"] = names.get(fid)
        (out / f"footprints_{tag}.geojson").write_text(json.dumps(fc))
    # ENU (metres about the DSM centre) for the shell stage
    fc = F.to_geojson(fps)
    for feat in fc["features"]:
        fid = feat["properties"]["id"]
        feat["properties"]["main"] = fid in names
        feat["properties"]["name"] = names.get(fid)
    (out / "footprints_enu.geojson").write_text(json.dumps(fc))
    summary = {"count": len(fps), "main": [names[f.id] + f":{f.id}" for f in main],
               "grid_res_m": GRID_RES, "method": "steps"}
    (out / "work" / "veg_ortho.png").parent.mkdir(exist_ok=True)
    Image.fromarray(rgb).save(out / "work" / "ortho_grid.png")
    np.save(out / "work" / "dsm_grid.npy", g.z)
    return summary


def _load_main(cid: str, vault: Path):
    """[(name, id, ENU polygon, props)] for footprints flagged main, tallest first."""
    from shapely.geometry import shape
    fc = json.loads((bdir(cid, vault) / "footprints_enu.geojson").read_text())
    rows = [(f["properties"]["name"], str(f["properties"]["id"]), shape(f["geometry"]), f["properties"])
            for f in fc["features"] if f["properties"].get("main")]
    return sorted(rows, key=lambda r: r[0])


def _obj_write(path: Path, verts, tris):
    with open(path, "w") as o:
        np.savetxt(o, verts, fmt="v %.5f %.5f %.5f")
        for t in tris + 1:
            o.write(f"f {t[0]} {t[1]} {t[2]}\n")


def step_shell(cid: str, vault: Path = VAULT, *, complexity: float = 0.888, force_fallback: bool = False) -> dict:
    """Roofer LoD2.2 shells (fallback lod1x per building) -> work/<name>_shell.npz/.obj in
    Blender space: x=E-cx, y=N-cy, z=elev-elev_min (glTF export then yields the game frame)."""
    from shapely.geometry import shape
    from shapely.affinity import translate
    import shutil
    from buildings import shell as SH
    fr = FR.load_frame(vault, cid)
    out = bdir(cid, vault)
    work = out / "work"
    rows = _load_main(cid, vault)
    grid = FR.Grid(np.load(work / "dsm_grid.npy"), GRID_RES, -135.0, 135.0)
    ox, oy = fr.origin_utm[0] + fr.center_odm[0], fr.origin_utm[1] + fr.center_odm[1]
    utm = json.loads((out / "footprints_utm32618.geojson").read_text())
    main_utm = {"type": "FeatureCollection", "crs": utm["crs"],
                "features": [f for f in utm["features"] if f["properties"].get("main")]}
    (work / "footprints_main_utm.geojson").write_text(json.dumps(main_utm))
    polys_utm = [shape(f["geometry"]) for f in main_utm["features"]]
    result = {}
    roofer_ok = SH.ROOFER.exists() and not force_fallback
    roofer_out = {}
    if roofer_ok:
        prep = SH.roofer_prep_pointcloud(
            VAULT / "odm" / f"proj_{cid}" / "odm_georeferencing" / "odm_georeferenced_model.laz",
            polys_utm, [], work / "roofer_in.las")
        shutil.rmtree(work / "roofer_out", ignore_errors=True)
        proc = SH.run_roofer(work / "roofer_in.las", work / "footprints_main_utm.geojson", work / "roofer_out",
                             extra=["--complexity-factor", str(complexity)])
        (work / "roofer.log").write_text(proc.stdout + "\n" + proc.stderr)
        if proc.returncode == 0:
            roofer_out = SH.read_roofer_output(work / "roofer_out")
        result["_roofer"] = {"rc": proc.returncode, "prep": prep, "complexity": complexity,
                             "binary": "roofer 1.0.0 (3DBAG, GPLv3, prebuilt macOS arm64)"}
    for name, bid, poly, props in rows:
        r = roofer_out.get(bid)
        method = None
        if r is not None and len(r["tris"]) and r["attrs"].get("rf_success", True):
            v = r["verts"].copy()
            v[:, 0] -= ox; v[:, 1] -= oy
            sh = SH.Shell(v, r["tris"], r["surf"], {"roofer": {k: r["attrs"].get(k) for k in (
                "rf_roof_planes", "rf_ridgelines", "rf_rmse_lod22", "rf_roof_type", "rf_h_ground", "rf_pt_density")}}).merged()
            method = "roofer-lod22"
        else:
            sh = SH.lod1x_shell(poly, grid.z, grid, float(props["ground_z"])).merged()
            method = "lod1x-ransac"
        res = SH.roof_residuals(sh, poly, grid)
        sh.verts[:, 2] -= fr.elev_min
        np.savez(work / f"{name}_shell.npz", verts=sh.verts, tris=sh.tris, surf=sh.surf)
        _obj_write(work / f"{name}_shell.obj", sh.verts, sh.tris[sh.surf != 2])   # visual: no floor (never seen)
        result[name] = {"method": method, "tris": int(len(sh.tris)), "verts": int(len(sh.verts)),
                        "roof_vs_dsm": res, "footprint_id": bid, "area_m2": props["area_m2"],
                        "ground_z_msl": float(sh.verts[:, 2].min() + fr.elev_min),
                        "roof_max_msl": float(sh.verts[:, 2].max() + fr.elev_min),
                        "meta": sh.meta}
    (work / "shell_summary.json").write_text(json.dumps(result, indent=1, default=float))
    return result


BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")


def step_crop(cid: str, vault: Path = VAULT, margin_m: float = 2.5, near_m: float = 2.2) -> dict:
    """Crop the ODM textured OBJ to faces within `near_m` of a shell -> work/source_crop.obj.

    Anything farther than the bake rays can reach (cage extrusion + max ray distance) is
    irrelevant, and dropping it keeps the number of 4096^2 atlas pages Blender must load down."""
    import trimesh
    from shapely import contains_xy
    from shapely.ops import unary_union
    from buildings import meshcrop
    fr = FR.load_frame(vault, cid)
    rows = _load_main(cid, vault)
    work = bdir(cid, vault) / "work"
    zone = unary_union([r[2] for r in rows]).buffer(margin_m + near_m)
    cx, cy = fr.center_odm
    mdir = Path(vault) / "models" / cid / "model"
    queries = []
    for name, *_ in rows:
        d = np.load(work / f"{name}_shell.npz")
        queries.append(trimesh.proximity.ProximityQuery(trimesh.Trimesh(d["verts"], d["tris"], process=False)))

    def to_bl(v):
        return np.c_[v[:, 0] - cx, v[:, 1] - cy, v[:, 2] - fr.elev_min]

    def keep(vb):
        cand = contains_xy(zone, vb[:, 0], vb[:, 1])
        out = np.zeros(len(vb), bool)
        idx = np.nonzero(cand)[0]
        near = np.zeros(len(idx), bool)
        for q in queries:
            near |= np.abs(q.signed_distance(vb[idx])) <= near_m      # signed_distance: + inside
        out[idx] = near
        return out

    return meshcrop.crop_obj(mdir / "odm_textured_model_geo.obj", mdir / "odm_textured_model_geo.mtl",
                             keep, work / "source_crop.obj", to_bl=to_bl)


def blender(args: list[str], log: Path, timeout: int = 3600):
    import subprocess
    proc = subprocess.run([str(BLENDER), "-b", "-noaudio", "-P", str(HERE / "bake_building.py"), "--"] + args,
                          capture_output=True, text=True, timeout=timeout)
    log.write_text(proc.stdout + "\n" + proc.stderr)
    if proc.returncode != 0 or ("BAKE_OK" not in proc.stdout and "EXPORT_OK" not in proc.stdout):
        raise RuntimeError(f"blender failed ({proc.returncode}); see {log}")
    return proc


def fill_bake_misses(raw_png: Path, out_png: Path) -> dict:
    """Ray misses / uncovered texels (alpha 0) take the nearest baked colour (EDT dilation),
    so bilinear filtering and mip levels never blend in black."""
    from PIL import Image
    from scipy import ndimage as ndi
    im = np.asarray(Image.open(raw_png).convert("RGBA"))
    hit = im[..., 3] > 0
    miss = ~hit
    idx = ndi.distance_transform_edt(miss, return_distances=False, return_indices=True)
    rgb = im[..., :3][tuple(idx)] if miss.any() else im[..., :3]
    Image.fromarray(np.ascontiguousarray(rgb)).save(out_png)
    return {"hit_frac": float(hit.mean()), "filled_frac": float(miss.mean())}


def step_bake(cid: str, vault: Path = VAULT, *, size: int = 4096, extrude: float = 0.8,
              max_ray: float = 2.0, samples: int = 4, device: str = "CPU") -> dict:
    work = bdir(cid, vault) / "work"
    if not (work / "source_crop.obj").exists():
        step_crop(cid, vault)
    res = {}
    for name, bid, poly, props in _load_main(cid, vault):
        blender(["--phase", "bake", "--name", name, "--work", str(work), "--source", str(work / "source_crop.obj"),
                 "--shell", str(work / f"{name}_shell.obj"), "--size", str(size), "--extrude", str(extrude),
                 "--max-ray", str(max_ray), "--samples", str(samples), "--device", device], work / f"{name}_bake.log")
        fill = fill_bake_misses(work / f"{name}_bake_raw.png", work / f"{name}_atlas.png")
        res[name] = {**fill, **json.loads((work / f"{name}_bake_stats.json").read_text())}
    (work / "bake_summary.json").write_text(json.dumps(res, indent=1))
    return res


GLTFPACK = Path("/Volumes/SSD/_system/tools/gltfpack/gltfpack")


def _gltfpack(src: Path, dst: Path, *, textured: bool, quality: int = 10) -> None:
    import subprocess
    args = [str(GLTFPACK), "-i", str(src), "-o", str(dst), "-cc", "-vpf", "-vt", "16", "-km", "-kn"]
    if textured:
        args += ["-tc", "-tq", str(quality)]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"gltfpack failed: {proc.stderr[-500:]}")


def _node_frame(glb: Path) -> tuple[dict, np.ndarray]:
    """Decode a GLB with the web's own three.js + meshopt (glb_frame.mjs): stats + world vertices."""
    import subprocess, tempfile
    root = HERE.parent.parent
    with tempfile.NamedTemporaryFile(suffix=".f32") as tf:
        out = subprocess.run(["node", str(root / "pipeline" / "glb_frame.mjs"), str(glb), "--dump", tf.name],
                             capture_output=True, text=True, check=True)
        v = np.fromfile(tf.name, dtype=np.float32).reshape(-1, 3).astype(np.float64)
    return json.loads(out.stdout), v


def step_export(cid: str, vault: Path = VAULT, *, quality: int = 10) -> dict:
    import trimesh
    from scipy.spatial import cKDTree
    fr = FR.load_frame(vault, cid)
    out = bdir(cid, vault)
    work = out / "work"
    shells = json.loads((work / "shell_summary.json").read_text())
    grid = FR.Grid(np.load(work / "dsm_grid.npy"), GRID_RES, -135.0, 135.0)
    geo_v = np.array([l.split()[1:4] for l in open(Path(vault) / "models" / cid / "model" / "odm_textured_model_geo.obj")
                      if l.startswith("v ")], dtype=np.float64)
    geo_bl = np.c_[geo_v[:, 0] - fr.center_odm[0], geo_v[:, 1] - fr.center_odm[1], geo_v[:, 2] - fr.elev_min]
    from shapely import contains_xy
    meta = {"version": 1, "clip_id": cid, "frame": "game: x=E, y=elev-elev_min, z=-N, origin=DSM centre "
            "(same as viewer.obj + mesh_offset; verified by glb_frame.mjs)", "elev_min": fr.elev_min,
            "generator": "pipeline/buildings", "buildings": {}}
    for name, info in sorted((k, v) for k, v in shells.items() if not k.startswith("_")):
        d = np.load(work / f"{name}_shell.npz")
        verts, tris, surf = d["verts"], d["tris"], d["surf"]
        raw = work / f"{name}_visual_raw.glb"
        blender(["--phase", "export", "--name", name, "--work", str(work), "--out", str(raw)],
                work / f"{name}_export.log")
        vis = out / f"{name}.glb"
        _gltfpack(raw, vis, textured=True, quality=quality)
        # collision variant: untextured, full closed shell incl. floor, game frame
        game = np.c_[verts[:, 0], verts[:, 2], -verts[:, 1]]
        tm = trimesh.Trimesh(game, tris, process=False)      # bl->game (x, z, -y) is a proper rotation: winding preserved
        craw = work / f"{name}_collision_raw.glb"
        tm.export(craw)
        col = out / f"{name}.collision.glb"
        _gltfpack(craw, col, textured=False)
        # ---- verification through the web's own loader
        st, wv = _node_frame(vis)
        tree = cKDTree(game)
        dist = tree.query(wv)[0]
        cst, cwv = _node_frame(col)
        cdist = tree.query(cwv)[0]
        poly = [r for r in _load_main(cid, vault) if r[0] == name][0][2]
        inz = contains_xy(poly.buffer(1.0), geo_bl[:, 0], geo_bl[:, 1])
        gz = geo_bl[inz]
        # ODM mesh top inside the footprint (99.5th pct of vertices) vs shell roof top
        mesh_top = float(np.percentile(gz[:, 2], 99.5)) if len(gz) else None
        meta["buildings"][name] = {
            "file": f"{name}.glb", "bytes": vis.stat().st_size, "tris": st["tris"],
            "collision_file": f"{name}.collision.glb", "collision_bytes": col.stat().st_size, "collision_tris": cst["tris"],
            "method": info["method"], "footprint_area_m2": info["area_m2"],
            "roof_vs_dsm_m": info["roof_vs_dsm"],
            "height_above_ground_m": round(info["roof_max_msl"] - info["ground_z_msl"], 2),
            "ground_z_msl": round(info["ground_z_msl"], 3), "roof_max_msl": round(info["roof_max_msl"], 3),
            "bbox_game_min": [round(x, 3) for x in st["bbox_min"]] if "bbox_min" in st else None,
            "bbox_game_max": [round(x, 3) for x in st["bbox_max"]] if "bbox_max" in st else None,
            "frame_check": {"glb_vertex_to_shell_max_m": round(float(dist.max()), 5),
                            "collision_vertex_to_shell_max_m": round(float(cdist.max()), 5),
                            "shell_top_y": round(float(game[:, 1].max()), 3),
                            "odm_mesh_top_y_in_footprint_p99_5": None if mesh_top is None else round(mesh_top, 3),
                            "shell_top_minus_mesh_top_m": None if mesh_top is None else round(float(game[:, 1].max()) - mesh_top, 3)},
            "textures": json.loads((work / f"{name}_bake_stats.json").read_text()) | {"format": "KTX2 ETC1S q%d via gltfpack" % quality},
        }
    (out / "meta.json").write_text(json.dumps(meta, indent=1, default=float))
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["footprints", "shell", "bake", "export", "all", "photobake"])
    ap.add_argument("clip_id")
    a = ap.parse_args()
    if a.step == "photobake":      # W4b: photo-projected textures (replaces bake+export for the visual GLB)
        from buildings import photobake as PBK
        print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "facets"} for k, v in PBK.photobake(a.clip_id).items()}, indent=1, default=float))
    if a.step in ("footprints", "all"):
        print(json.dumps(step_footprints(a.clip_id), indent=1))
    if a.step in ("shell", "all"):
        print(json.dumps(step_shell(a.clip_id), indent=1, default=float))
    if a.step in ("bake", "all"):
        print(json.dumps(step_bake(a.clip_id), indent=1))
    if a.step in ("export", "all"):
        print(json.dumps(step_export(a.clip_id), indent=1, default=float))
