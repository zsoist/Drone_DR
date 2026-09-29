#!/usr/bin/env python3
"""ODM textured mesh -> per-device-tier GLB (meshopt geometry + KTX2 textures).

W1 of docs/WORLD_UPGRADE_PLAN.md. The published *viewer* OBJ (geo minus its vertex
mean, see tresd_publish.make_viewer_mesh) is the source of geometry, so a GLB lands in
exactly the frame scene.js already gives the OBJ (rotation.x = -PI/2 + mesh_offset):
no axis conversion, no re-bake, the 106 atlas pages and their UVs are kept as they are.

    models/<cid>/glb/{mobile,desktop,extra}.glb + glb/meta.json

Tiers (one GLB per device tier, no distance LOD -> nothing pops):
    mobile   vtl_* pages  (viewer_low.mtl)    ETC1S q10, ~420k tris
    desktop  vtx_* pages  (viewer_extra.mtl)  ETC1S q10, ~440k tris
    extra    geo PNG pages (geo.mtl)          ETC1S q10, full mesh (529k tris)

MEASURED CHOICES (recon_4e4245a1f4_aoi130, 8 fixed cameras, SSIM vs today's OBJ ladder;
see glb/gate.json):
  * codec: UASTC (-tu) keeps SSIM ~0.98-0.99 even when decimated, but its images are 3x
    the whole current download (desktop 92.6 MB for 101.7 Mpx; mobile 22.8 MB vs the
    18.6 MB baseline) -> fails the fail-closed budget gate. ETC1S q10 is the ceiling that
    fits: codec-only SSIM 0.9745 (full mesh, mobile pages).
  * decimation: SSIM (ETC1S q10, mobile pages) 0.9745 @529k tris, 0.972 @397k, 0.964 @291k,
    0.957 @212k, 0.92 @120k; the plan's 120k / 300k targets therefore cannot meet
    SSIM >= 0.97 on this vegetation-heavy scene, and the tri budgets below are the
    smallest that do. Bytes / GPU / first-frame wins come from KTX2 + meshopt, not tris.

Gates (fail closed, nothing is published when they fail):
    * frame  - every GLB vertex (through gltfpack's quantisation node transform) lies
               within 1 cm of a source OBJ vertex, bbox never grows past the source and,
               for the un-decimated tier, bbox + area-weighted centroid are within 1 cm
               (decimated tiers: centroid within 10 cm, bbox shrink <= 2 % of the extent).
    * visual/budget - pipeline/glb_gate.py (browser render SSIM, bytes, GPU MB, first frame);
               scene_manifest.py advertises only tiers green there (approved()).

Usage:
    python3 glb_export.py <clip_id> [--tier mobile ...] [--force]
    python3 glb_export.py <clip_id> --verify        # re-run the frame gate on disk
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

from fsutil import atomic_write_json, read_json  # noqa: E402
from paths import PIPE, VAULT  # noqa: E402

VERSION = 1
TOOLS_DEFAULT = Path("/Volumes/SSD/_system/tools/gltfpack/gltfpack")
FRAME_TOL_M = 0.01                 # subset / bbox / centroid tolerance (extra tier)
DECIMATED_CENTROID_TOL_M = 0.10    # area-weighted centroid drift allowed after simplification
DECIMATED_SHRINK_FRAC = 0.02       # max bbox shrink after simplification, fraction of extent
GPU_BPP = 8                        # ASTC 4x4 / BC7 (worst case; ETC2 would be 4)

# `mtl` names live next to the viewer OBJ (tresd_publish.VIEWER_TIERS + the ODM original).
TIERS: dict[str, dict] = {
    "mobile": {"mtl": "odm_textured_model_viewer_low.mtl", "target_tris": 420_000,
               "codec": "etc1s", "quality": 10, "uv_bits": 14, "pos_bits": 16},
    "desktop": {"mtl": "odm_textured_model_viewer_extra.mtl", "target_tris": 440_000,
                "codec": "etc1s", "quality": 10, "uv_bits": 16, "pos_bits": 16},
    "extra": {"mtl": "odm_textured_model_geo.mtl", "target_tris": None,
              "codec": "etc1s", "quality": 10, "uv_bits": 16, "pos_bits": 16},
}


class GateError(RuntimeError):
    """A fail-closed gate rejected the output; nothing was published."""


# --------------------------------------------------------------------------- tools
def gltfpack_path() -> Path | None:
    for cand in (os.environ.get("AEROBRAIN_GLTFPACK"), shutil.which("gltfpack"), str(TOOLS_DEFAULT)):
        if cand and Path(cand).is_file() and os.access(cand, os.X_OK):
            return Path(cand)
    return None


def gltfpack_version(binary: Path) -> str:
    out = subprocess.run([str(binary), "-v"], capture_output=True, text=True, timeout=30)
    return (out.stdout + out.stderr).strip().splitlines()[0] if (out.stdout + out.stderr).strip() else "unknown"


def gltfpack_supports_ktx2(binary: Path) -> bool:
    out = subprocess.run([str(binary), "-h"], capture_output=True, text=True, timeout=30)
    return "-tc" in (out.stdout + out.stderr)


# ------------------------------------------------------------------------- sources
def _paths(cid: str, vault: Path) -> tuple[Path, Path, Path]:
    model_dir = Path(vault) / "models" / cid
    meta = read_json(model_dir / "meta.json", {}) or {}
    viewer = model_dir / (meta.get("model_viewer") or "model/odm_textured_model_viewer.obj")
    return model_dir, model_dir / "glb", viewer


def obj_counts(path: Path) -> tuple[int, int]:
    verts = tris = 0
    with open(path, "rb") as fh:
        for line in fh:
            if line.startswith(b"v "):
                verts += 1
            elif line.startswith(b"f "):
                tris += max(0, len(line.split()) - 3)
    return verts, tris


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def mtl_pages(mtl: Path) -> list[str]:
    return [ln.split(None, 1)[1].strip() for ln in mtl.read_text(errors="ignore").splitlines()
            if ln.strip().startswith("map_Kd")]


def source_fingerprint(viewer: Path, mtls: dict[str, Path]) -> str:
    """sha256 over the viewer OBJ bytes, each tier MTL and the (name, size) of every page.

    Same idea as collision_bake._fingerprint (hash of the source geometry + contract):
    any change to the OBJ, the page assignment or a page file invalidates the GLBs."""
    digest = hashlib.sha256()
    digest.update(f"glb_export:{VERSION}\n".encode())
    digest.update(_sha256(viewer).encode())
    for name in sorted(mtls):
        mtl = mtls[name]
        digest.update(f"\n{name}:{hashlib.sha256(mtl.read_bytes()).hexdigest()}".encode())
        for page in mtl_pages(mtl):
            f = mtl.parent / page
            digest.update(f"\n {page}:{f.stat().st_size if f.exists() else -1}".encode())
    return digest.hexdigest()


def _params_key(tier: str, params: dict, fingerprint: str, packer: str) -> str:
    blob = json.dumps({"tier": tier, "params": params, "fp": fingerprint, "gltfpack": packer},
                      sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------- GLB
def read_glb_json(path: Path) -> tuple[dict, int]:
    """Return (json, offset of the BIN chunk payload)."""
    with open(path, "rb") as fh:
        magic, _ver, _len = struct.unpack("<4sII", fh.read(12))
        if magic != b"glTF":
            raise ValueError(f"{path.name}: no es GLB")
        clen, ctype = struct.unpack("<II", fh.read(8))
        if ctype != 0x4E4F534A:
            raise ValueError(f"{path.name}: falta el chunk JSON")
        doc = json.loads(fh.read(clen))
        bin_off = 12 + 8 + clen
        fh.seek(bin_off)
        head = fh.read(8)
        bin_payload = bin_off + 8 if len(head) == 8 else 0
    return doc, bin_payload


def ktx2_stats(path: Path) -> dict:
    """Texture inventory of a GLB: count, pixels, mip levels and a GPU-memory estimate."""
    doc, bin_off = read_glb_json(path)
    views = doc.get("bufferViews", [])
    pixels = 0
    gpu_bytes = 0
    count = 0
    levels_min = 99
    with open(path, "rb") as fh:
        for img in doc.get("images", []):
            if img.get("mimeType") != "image/ktx2" or "bufferView" not in img:
                raise ValueError(f"{path.name}: textura no-KTX2 ({img.get('mimeType')})")
            bv = views[img["bufferView"]]
            fh.seek(bin_off + bv.get("byteOffset", 0))
            head = fh.read(48)
            if head[:12] != b"\xabKTX 20\xbb\r\n\x1a\n":
                raise ValueError(f"{path.name}: cabecera KTX2 inválida")
            w, h, _d, _layers, _faces, levels = struct.unpack("<6I", head[20:44])
            levels = max(1, levels)
            levels_min = min(levels_min, levels)
            count += 1
            pixels += w * h
            for lv in range(levels):
                lw, lh = max(1, w >> lv), max(1, h >> lv)
                gpu_bytes += ((lw + 3) // 4) * ((lh + 3) // 4) * 16      # 4x4 block @ 8 bpp
    return {"textures": count, "texture_px": pixels, "min_mip_levels": levels_min if count else 0,
            "gpu_texture_mb": round(gpu_bytes / 1048576, 1), "gpu_assumption": f"{GPU_BPP} bpp + mips"}


# ----------------------------------------------------------------------- frame gate
def _obj_arrays(viewer: Path) -> tuple[np.ndarray, np.ndarray]:
    import collision_bake
    return collision_bake.parse_obj(viewer)


def source_frame_stats(viewer: Path) -> dict:
    verts, idx = _obj_arrays(viewer)
    # Only vertices a face references are rendered (and survive gltfpack); ODM meshes carry
    # tens of thousands of orphan `v` lines (some 75 m below the terrain) that would make a
    # correct GLB look "shrunk". Compare against the rendered geometry.
    v = verts.astype(np.float64)[np.unique(idx)]
    remap = np.zeros(len(verts), dtype=np.int64)
    remap[np.unique(idx)] = np.arange(len(v))
    idx = remap[idx]
    tri = v[idx.reshape(-1, 3)]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    centroid = (area[:, None] * tri.mean(axis=1)).sum(axis=0) / area.sum()
    return {"verts": v, "bbox_min": v.min(axis=0), "bbox_max": v.max(axis=0),
            "centroid": centroid, "area": float(area.sum()), "tris": len(idx) // 3}


def glb_frame_stats(glb: Path, dump: Path | None = None) -> dict:
    cmd = ["node", "--no-warnings", str(PIPE / "glb_frame.mjs"), str(glb)]
    if dump is not None:
        cmd += ["--dump", str(dump)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise GateError(f"glb_frame.mjs falló ({glb.name}): {out.stderr.strip()[-400:]}")
    return json.loads(out.stdout.strip().splitlines()[-1])


def frame_gate(glb: Path, source: dict, *, decimated: bool) -> dict:
    """Compare a GLB with the source OBJ in the OBJ frame. Returns the evidence dict
    (with `ok`); raises nothing so callers can report all tiers."""
    from scipy.spatial import cKDTree

    with tempfile.TemporaryDirectory(prefix="glbframe-", dir=str(glb.parent)) as tmp:
        dump = Path(tmp) / "v.f32"
        stats = glb_frame_stats(glb, dump)
        pts = np.fromfile(dump, dtype=np.float32).reshape(-1, 3).astype(np.float64)
    dist, _ = cKDTree(source["verts"]).query(pts, workers=-1)
    gmin, gmax = np.array(stats["bbox_min"]), np.array(stats["bbox_max"])
    d_min = gmin - source["bbox_min"]          # >0 => GLB shrank on that side
    d_max = source["bbox_max"] - gmax          # >0 => GLB shrank on that side
    grow = float(max((-d_min).max(), (-d_max).max()))          # GLB exceeding the source box
    shrink_xy = float(max(d_min[:2].max(), d_max[:2].max()))
    shrink_all = float(max(d_min.max(), d_max.max()))
    centroid_delta = float(np.linalg.norm(np.array(stats["centroid"]) - source["centroid"]))
    ev = {
        "vertex_subset_max_m": round(float(dist.max()), 5),
        "vertex_subset_p999_m": round(float(np.percentile(dist, 99.9)), 5),
        "bbox_grow_m": round(grow, 5),
        "bbox_shrink_xy_m": round(shrink_xy, 5),
        "bbox_shrink_max_m": round(shrink_all, 5),
        "centroid_delta_m": round(centroid_delta, 5),
        "tris": stats["tris"], "materials": stats["materials"],
        "bbox_min": [round(x, 4) for x in gmin], "bbox_max": [round(x, 4) for x in gmax],
        "decimated": decimated,
    }
    ok = ev["vertex_subset_max_m"] <= FRAME_TOL_M and grow <= FRAME_TOL_M
    if decimated:
        # simplification legitimately drops tip vertices (isolated specks at the rim):
        # bound the loss at 2 % of the model extent instead of demanding 1 cm.
        extent = float((source["bbox_max"] - source["bbox_min"]).max())
        ok = (ok and centroid_delta <= DECIMATED_CENTROID_TOL_M
              and shrink_all <= DECIMATED_SHRINK_FRAC * extent)
    else:
        ok = ok and shrink_all <= FRAME_TOL_M and centroid_delta <= FRAME_TOL_M
    ev["ok"] = bool(ok)
    return ev


# ---------------------------------------------------------------------------- build
def _tier_args(tier: str, cfg: dict, ratio: float, threads: int) -> list[str]:
    args = ["-cc", "-tc"]
    if cfg["codec"] == "uastc":
        args.append("-tu")
    args += ["-tq", str(cfg["quality"]), "-tj", str(threads)]
    if ratio < 0.9995:
        args += ["-si", f"{ratio:.5f}"]
    # pos_bits ladder for very large extents, where the 16-bit integer grid (extent/65535,
    # ~12 mm at 780 m) exceeds the 1 cm frame tolerance (measured on recon_4e4245a1f4):
    #   16 -> integer grid (default)   24 -> float positions, 16-bit mantissa (-vpf -vp 16)
    #   32 -> no quantisation at all (-noq, exact but ~20 % bigger)
    # NB: bare -vpf (default 14-bit mantissa) is WORSE than the integer grid.
    if cfg["pos_bits"] >= 32:
        args += ["-noq"]
    elif cfg["pos_bits"] >= 24:
        args += ["-vpf", "-vp", "16"]
    else:
        args += ["-vp", str(cfg["pos_bits"])]
    args += ["-vt", str(cfg["uv_bits"]), "-km"]
    return args


def _stage(work: Path, viewer: Path, mtl: Path) -> Path:
    """Work dir whose mesh.obj is the viewer OBJ (symlink) and whose
    `odm_textured_model_geo.mtl` (the name the OBJ's mtllib line asks for) is this tier's
    MTL, with the page files symlinked beside it."""
    work.mkdir(parents=True, exist_ok=True)
    (work / "mesh.obj").symlink_to(viewer.resolve())
    (work / "odm_textured_model_geo.mtl").write_text(mtl.read_text())
    for page in mtl_pages(mtl):
        src = mtl.parent / page
        if not src.exists():
            raise FileNotFoundError(f"{mtl.name}: falta la página {page}")
        link = work / page
        if not link.exists():
            link.symlink_to(src.resolve())
    return work / "mesh.obj"


def available_tiers(cid: str, vault: Path = VAULT) -> dict[str, dict]:
    _model_dir, _glb_dir, viewer = _paths(cid, vault)
    return {t: cfg for t, cfg in TIERS.items() if (viewer.parent / cfg["mtl"]).exists()}


def build(cid: str, *, vault: Path = VAULT, tiers: list[str] | None = None, force: bool = False,
          gltfpack: Path | None = None, tier_overrides: dict | None = None,
          threads: int | None = None, log=print) -> dict:
    vault = Path(vault)
    model_dir, glb_dir, viewer = _paths(cid, vault)
    if not viewer.exists():
        raise GateError(f"{cid}: sin viewer OBJ ({viewer})")
    packer = gltfpack or gltfpack_path()
    if packer is None:
        raise GateError("gltfpack no encontrado (AEROBRAIN_GLTFPACK / PATH / "
                        f"{TOOLS_DEFAULT})")
    if not gltfpack_supports_ktx2(packer):
        raise GateError(f"{packer}: build sin compresión de texturas (-tc)")
    version = gltfpack_version(packer)
    cfgs = {t: {**c, **((tier_overrides or {}).get(t) or {})} for t, c in TIERS.items()}
    have = {t: c for t, c in cfgs.items() if (viewer.parent / c["mtl"]).exists()}
    wanted = [t for t in (tiers or list(TIERS)) if t in have]
    if not wanted:
        raise GateError(f"{cid}: ningún tier tiene sus texturas/MTL")
    mtls = {t: viewer.parent / have[t]["mtl"] for t in have}
    fp = source_fingerprint(viewer, mtls)
    _verts, src_tris = obj_counts(viewer)

    glb_dir.mkdir(parents=True, exist_ok=True)
    meta = read_json(glb_dir / "meta.json", {}) or {}
    if meta.get("source_fingerprint") != fp or meta.get("version") != VERSION:
        for f in glb_dir.glob("*.glb"):        # stale outputs of an older source
            f.unlink()
        meta = {}
    meta_tiers = dict(meta.get("tiers") or {})
    source = None
    threads = threads or os.cpu_count() or 4

    for tier in wanted:
        cfg = have[tier]
        ratio = 1.0 if not cfg["target_tris"] else min(1.0, cfg["target_tris"] / src_tris)
        params = {**cfg, "ratio": round(ratio, 5)}
        key = _params_key(tier, params, fp, version)
        out = glb_dir / f"{tier}.glb"
        prev = meta_tiers.get(tier) or {}
        if (not force and out.exists() and prev.get("key") == key
                and out.stat().st_size == prev.get("bytes")):
            log(f"[{tier}] up to date ({prev['bytes']/1e6:.1f} MB, {prev['tris']} tris)")
            continue
        work = Path(tempfile.mkdtemp(prefix=f".work-{tier}-", dir=str(glb_dir)))
        try:
            obj = _stage(work, viewer, mtls[tier])
            tmp_out = work / "out.glb"
            report = work / "report.json"
            cmd = [str(packer), "-i", str(obj), "-o", str(tmp_out), "-r", str(report),
                   *_tier_args(tier, cfg, ratio, threads)]
            t0 = time.time()
            log(f"[{tier}] gltfpack ratio={ratio:.3f} codec={cfg['codec']} ...")
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
            if proc.returncode != 0 or not tmp_out.exists():
                raise GateError(f"[{tier}] gltfpack rc={proc.returncode}: "
                                f"{(proc.stderr or proc.stdout).strip()[-400:]}")
            secs = time.time() - t0
            if source is None:
                source = source_frame_stats(viewer)
            evidence = frame_gate(tmp_out, source, decimated=ratio < 0.9995)
            if not evidence["ok"]:
                raise GateError(f"[{tier}] frame gate FAILED: {json.dumps(evidence)}")
            tex = ktx2_stats(tmp_out)
            if tex["textures"] != len(set(mtl_pages(mtls[tier]))) or tex["min_mip_levels"] < 2:
                raise GateError(f"[{tier}] texturas incompletas o sin mips: {tex}")
            entry = {
                "file": f"{tier}.glb", "bytes": tmp_out.stat().st_size,
                "sha256": _sha256(tmp_out), "tris": evidence["tris"], "src_tris": src_tris,
                "key": key, "params": params, "seconds": round(secs, 1),
                "frame": evidence, **tex,
            }
            os.replace(tmp_out, out)                     # same dir -> atomic
            meta_tiers[tier] = entry
            meta = {
                "version": VERSION, "clip_id": cid, "source_fingerprint": fp,
                "source": {"obj": str(viewer.relative_to(model_dir)),
                           "tris": src_tris, "frame": "viewer OBJ (geo minus vertex mean)"},
                "gltfpack": version,
                "tiers": {t: meta_tiers[t] for t in TIERS if t in meta_tiers},
            }
            atomic_write_json(glb_dir / "meta.json", meta, indent=1)   # after EACH tier
            log(f"[{tier}] ok {entry['bytes']/1e6:.1f} MB · {entry['tris']} tris · "
                f"GPU~{entry['gpu_texture_mb']} MB · {secs:.0f}s")
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return meta


def validate(cid: str, *, vault: Path = VAULT) -> dict:
    """Cheap freshness check (used by scene_manifest): meta present, fingerprint matches
    the current viewer OBJ / MTLs / pages and every listed GLB has the recorded size."""
    _model_dir, glb_dir, viewer = _paths(cid, vault)
    meta = read_json(glb_dir / "meta.json")
    if not isinstance(meta, dict) or meta.get("version") != VERSION:
        raise ValueError(f"{cid}: glb/meta.json ausente o de otra versión")
    if not viewer.exists():
        raise ValueError(f"{cid}: sin viewer OBJ")
    mtls = {t: viewer.parent / TIERS[t]["mtl"] for t in TIERS if (viewer.parent / TIERS[t]["mtl"]).exists()}
    if meta.get("source_fingerprint") != source_fingerprint(viewer, mtls):
        raise ValueError(f"{cid}: glb stale (fingerprint)")
    tiers = meta.get("tiers") or {}
    if not tiers:
        raise ValueError(f"{cid}: glb/meta.json sin tiers")
    for name, entry in tiers.items():
        f = glb_dir / entry.get("file", "")
        if not f.is_file() or f.stat().st_size != entry.get("bytes"):
            raise ValueError(f"{cid}: glb {name} ausente o truncado")
        if not (entry.get("frame") or {}).get("ok"):
            raise ValueError(f"{cid}: glb {name} sin frame gate")
    return meta


def approved(cid: str, *, vault: Path = VAULT) -> dict[str, dict]:
    """Tiers the WEB may prefer: fresh GLB (validate) AND a passing glb_gate.py verdict
    (glb/gate.json, same source fingerprint). Fail closed: any doubt -> {} -> OBJ ladder."""
    try:
        meta = validate(cid, vault=vault)
    except (ValueError, OSError):
        return {}
    _model_dir, glb_dir, _viewer = _paths(cid, vault)
    gate = read_json(glb_dir / "gate.json", {}) or {}
    if gate.get("source_fingerprint") != meta["source_fingerprint"]:
        return {}
    if (gate.get("fallback") or {}).get("ok") is not True:      # OBJ fallback must be proven
        return {}
    if (gate.get("csp") or {}).get("ok") is not True:           # ... and the CSP-safe decode
        return {}
    return {name: entry for name, entry in meta["tiers"].items()
            if ((gate.get("tiers") or {}).get(name) or {}).get("ok") is True
            and (gate["tiers"][name].get("key") == entry.get("key"))}


def verify(cid: str, *, vault: Path = VAULT, log=print) -> dict:
    """Freshness + re-run the frame gate against the files on disk."""
    meta = validate(cid, vault=vault)
    _model_dir, glb_dir, viewer = _paths(cid, vault)
    source = source_frame_stats(viewer)
    out = {}
    for tier, entry in meta["tiers"].items():
        ev = frame_gate(glb_dir / entry["file"], source,
                        decimated=(entry["params"].get("ratio", 1) or 1) < 0.9995)
        out[tier] = ev
        log(f"[{tier}] frame {'ok' if ev['ok'] else 'FAIL'} · subset max {ev['vertex_subset_max_m']*100:.2f} cm · "
            f"bbox grow {ev['bbox_grow_m']*100:.2f} cm · centroid Δ {ev['centroid_delta_m']*100:.2f} cm")
        if not ev["ok"]:
            raise GateError(f"[{tier}] frame gate FAILED: {json.dumps(ev)}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("clip_id")
    ap.add_argument("--tier", action="append", choices=list(TIERS))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--gltfpack")
    args = ap.parse_args(argv)
    try:
        if args.verify:
            verify(args.clip_id)
        else:
            meta = build(args.clip_id, tiers=args.tier, force=args.force,
                         gltfpack=Path(args.gltfpack) if args.gltfpack else None)
            print(json.dumps({t: {k: e[k] for k in ("bytes", "tris", "gpu_texture_mb")}
                              for t, e in meta["tiers"].items()}, indent=1))
    except (GateError, ValueError, OSError) as err:
        print(f"glb_export: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
