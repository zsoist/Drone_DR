#!/usr/bin/env python3
"""SceneManifestV2 — el contrato único de escena que consume FLIGHTVERSE.

Una escena = un modelo procesado. El manifiesto consolida en UN fetch lo que
hoy vive disperso (meta.json, dsm_lod.json, splat meta, track, geocode) y
declara capacidades SOLO si el asset existe en disco — la superficie nunca
promete lo que el backend no tiene (regla de honestidad del spec §2).

Escribe models/<cid>/scene.v2.json. Genera el dsm_lod si falta.

Uso:  python3 scene_manifest.py <clip_id> | --all
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import dsm_lod
import scenes

VAULT = Path("/Volumes/SSD/drone-vault")
COVERAGE_DIAMETERS_M = (100, 200, 400, 600, 1000)


def _load(p: Path):
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _geocode_name(lat: float, lon: float) -> str | None:
    cache = _load(VAULT / "manifest" / "geocode.json") or {}
    hit = cache.get(f"{round(lat, 3)},{round(lon, 3)}")
    return (hit or {}).get("name")


def _obj_center(path: Path) -> list[float] | None:
    """Media XYZ que publish resta al viewer.obj; fallback para modelos previos."""
    if not path.exists():
        return None
    n = 0
    sx = sy = sz = 0.0
    with path.open(errors="ignore") as f:
        for line in f:
            if not line.startswith("v "):
                continue
            p = line.split()
            sx += float(p[1]); sy += float(p[2]); sz += float(p[3]); n += 1
    return [round(sx / n, 4), round(sy / n, 4), round(sz / n, 4)] if n else None


def coverage_products(scene: dict | None, manifest: dict, shape: str = "circle") -> list[dict]:
    """Describe honest site products at the five shared coverage diameters.

    These rows are a renderer contract, not five invented reconstructions: every
    row references only assets that really exist in the published scene. The
    runtime can select the best representation for near detail versus wide-area
    context while preserving one stable site identity.
    """
    if shape not in ("circle", "square"):
        raise ValueError("coverage shape must be circle or square")
    scene = scene if isinstance(scene, dict) else {}
    assets = manifest.get("assets") or {}
    evidence = scene.get("source_evidence") or []
    world_size = (manifest.get("world") or {}).get("size_m") or []
    try:
        verified_diameter = min(float(world_size[0]), float(world_size[1]))
    except (IndexError, TypeError, ValueError):
        verified_diameter = None
    products = {
        "splat": assets.get("splat"),
        "mesh": assets.get("mesh_viewer"),
        "odm_terrain": assets.get("dsm_lod_bin"),
        "ortho": assets.get("ortho"),
    }
    rows = []
    for diameter in COVERAGE_DIAMETERS_M:
        radius = diameter / 2
        area = diameter * diameter if shape == "square" else math.pi * radius * radius
        if diameter <= 200 and products["splat"]:
            renderer = "splat"
        elif diameter <= 400 and products["mesh"]:
            renderer = "mesh"
        else:
            renderer = "terrain"
        if renderer == "terrain" and not products["odm_terrain"]:
            renderer = "mesh" if products["mesh"] else "splat" if products["splat"] else "none"
        integrated = sum(1 for row in evidence if isinstance(row, dict)
                         and row.get("status") == "integrated")
        capture_band_sources = sum(1 for row in evidence if isinstance(row, dict)
                                   and row.get("status") == "integrated"
                                   and int(row.get("altitude_band_m") or 0) == diameter)
        asset_ready = renderer != "none"
        extent_verified = bool(verified_diameter is not None and verified_diameter >= diameter)
        rows.append({
            "diameter_m": diameter,
            "radius_m": radius,
            "shape": shape,
            "area_m2": round(area, 1),
            "preferred_renderer": renderer,
            "ready": asset_ready and extent_verified,
            "asset_ready": asset_ready,
            "extent_verified": extent_verified,
            "available_diameter_m": round(verified_diameter, 1) if verified_diameter is not None else None,
            "status": "ready" if asset_ready and extent_verified else (
                "coverage_pending" if asset_ready else "assets_missing"),
            "integrated_sources": integrated,
            "capture_band_sources": capture_band_sources,
            "products": products.copy(),
        })
    return rows


def _site_for_version(cid: str) -> dict | None:
    for scene in scenes.list_scenes():
        if scene.get("active_version") == cid:
            return scene
        if any(version.get("id") == cid for version in scene.get("versions") or []):
            return scene
    return None


def build(cid: str) -> dict:
    mdir = VAULT / "models" / cid
    meta = _load(mdir / "meta.json")
    if not meta:
        raise SystemExit(f"{cid}: sin meta.json — no es una escena publicada")

    lod = _load(mdir / "dsm_lod.json")
    if not lod and meta.get("has_dsm") and (mdir / "dsm.bin").exists():
        lod = dsm_lod.build(cid)

    # preferencia: .clean.sog (floaters filtrados, ~50% más liviano, Spark
    # lo lee nativo) > ksplat > splat
    splat_bin = next((p for p in (VAULT / "splats" / f"{cid}.clean.sog",
                                  VAULT / "splats" / f"{cid}.ksplat",
                                  VAULT / "splats" / f"{cid}.splat") if p.exists()), None)
    splat_meta = _load(VAULT / "splats" / f"{cid}.meta.json") or {}
    cameras_json = VAULT / "splats" / f"{cid}.cameras.json"
    track_p = VAULT / "tracks" / f"{cid}.flight.json"
    track = _load(track_p) or {}
    viewer_obj = meta.get("model_viewer")
    mesh_offset = meta.get("mesh_offset")
    if viewer_obj and not mesh_offset:
        mesh_offset = _obj_center(mdir / "model" / "odm_textured_model_geo.obj")

    caps = {
        "terrain": bool(lod),
        "ortho": bool(meta.get("ortho_asset")),
        "splat": bool(splat_bin),
        "track": track_p.exists(),
        "mesh": bool(viewer_obj),
    }
    center = (lod or {}).get("center_wgs84")
    name = None
    if center:
        name = _geocode_name(center[1], center[0])

    man = {
        "version": 2,
        "clip_id": cid,
        "name": name or meta.get("title") or cid,
        "recon_id": (meta.get("reconstruction") or {}).get("recon_id"),
        "capabilities": caps,
        "world": {
            "grid": (lod or {}).get("grid"),
            "spacing_m": (lod or {}).get("spacing_m"),
            "size_m": (lod or {}).get("size_m"),
            "elev_min": (lod or {}).get("elev_min"),
            "elev_max": (lod or {}).get("elev_max"),
            "center_wgs84": center,
        } if lod else None,
        "assets": {k: v for k, v in {
            "dsm_lod_meta": f"data/models/{cid}/dsm_lod.json" if lod else None,
            "dsm_lod_bin": f"data/models/{cid}/{lod['bin']}" if lod else None,
            "dsm_lod_mask": f"data/models/{cid}/{lod['mask_bin']}" if lod and lod.get("mask_bin") else None,
            "ortho": f"data/models/{cid}/{meta['ortho_asset']}" if meta.get("ortho_asset") else None,
            "ortho_full": f"data/models/{cid}/ortho_full.jpg" if (mdir / "ortho_full.jpg").exists() else None,
            "splat": f"data/splats/{splat_bin.name}" if splat_bin else None,
            "splat_cameras": f"data/splats/{cid}.cameras.json" if cameras_json.exists() else None,
            "track": f"data/tracks/{cid}.flight.json" if track_p.exists() else None,
            "mesh_viewer": f"data/models/{cid}/{viewer_obj}" if viewer_obj else None,
            "mesh_mtl_low": f"data/models/{cid}/model/odm_textured_model_viewer_low.mtl"
                            if (mdir / "model" / "odm_textured_model_viewer_low.mtl").exists() else None,
            "mesh_mtl": f"data/models/{cid}/model/odm_textured_model_viewer.mtl"
                        if (mdir / "model" / "odm_textured_model_viewer.mtl").exists() else None,
            "mesh_mtl_extra": f"data/models/{cid}/model/odm_textured_model_viewer_extra.mtl"
                              if (mdir / "model" / "odm_textured_model_viewer_extra.mtl").exists() else None,
            "mesh_mtl_geo": f"data/models/{cid}/model/odm_textured_model_geo.mtl"
                            if (mdir / "model" / "odm_textured_model_geo.mtl").exists() else None,
            "collision_bin": f"data/models/{cid}/collision.bin" if (mdir / "collision.bin").exists() else None,
            "collision_meta": f"data/models/{cid}/collision.json" if (mdir / "collision.json").exists() else None,
            "objects": f"data/models/{cid}/objects.json" if (mdir / "objects.json").exists() else None,
            "poster": f"data/models/{cid}/{meta['ortho_asset']}" if meta.get("ortho_asset") else f"data/thumbs/{cid}.jpg",
        }.items() if v},
        # honestidad: la alineación splat<->terreno NO está resuelta; el runtime
        # debe leer status y no fingir registro. Materia prima anotada.
        "transforms": {
            "splat": {"rotation": [-0.7071067811865476, 0, 0, 0.7071067811865476],
                      "status": "unaligned"},
            "mesh_offset": mesh_offset,
        },
        "spawn": {
            "position_m": [0, round(((lod or {}).get("elev_max", 0) or 0)
                                    - ((lod or {}).get("elev_min", 0) or 0) + 60, 1), 0],
            "look_at_m": [0, 0, 0],
        } if lod else None,
        "stats": {k: v for k, v in {
            "gsd_cm_px": (meta.get("qa") or {}).get("gsd_cm_px"),
            "cloud_points": meta.get("cloud_points"),
            "splat_cameras": splat_meta.get("cameras"),
            "splat_final_loss": splat_meta.get("final_loss"),
            "track_duration_s": (track.get("stats") or {}).get("duration_s"),
            "track_distance_m": (track.get("stats") or {}).get("distance_m"),
            "track_max_alt_m": (track.get("stats") or {}).get("max_rel_alt_m"),
        }.items() if v is not None},
        "quality": {k: v for k, v in {
            "splat_bytes": splat_bin.stat().st_size if splat_bin else None,
            "lod_bytes": (mdir / lod["bin"]).stat().st_size if lod else None,
            "ortho_bytes": meta.get("ortho_bytes"),
        }.items() if v},
    }
    site_scene = _site_for_version(cid)
    if site_scene:
        active_version = next((version for version in site_scene.get("versions") or []
                               if version.get("id") == site_scene.get("active_version")), {})
        evidence = site_scene.get("source_evidence") or []
        counts = {status: sum(1 for row in evidence if row.get("status") == status)
                  for status in scenes.SOURCE_STATUSES}
        site_summary = {
            "scene_id": site_scene.get("id"),
            "title": site_scene.get("title"),
            "active_version": site_scene.get("active_version"),
            "is_active_version": site_scene.get("active_version") == cid,
            "version_count": len(site_scene.get("versions") or []),
            "source_count": len((site_scene.get("source_inventory") or {}).get("videos") or []),
            "source_status": counts,
            "effective_sources": active_version.get("effective_sources") or [],
            "dropped_sources": active_version.get("dropped_sources") or [],
            "altitude_bands_m": sorted({int(row.get("altitude_band_m")) for row in evidence
                                         if row.get("altitude_band_m")}),
        }
        coverage = {
            "diameters_m": list(COVERAGE_DIAMETERS_M),
            "default_shape": "circle",
            "shapes": {
                "circle": coverage_products(site_scene, man, "circle"),
                "square": coverage_products(site_scene, man, "square"),
            },
        }
        site_lod = {"version": 1, "clip_id": cid, "site": site_summary,
                    "coverage": coverage}
        (mdir / "site.lod.json").write_text(json.dumps(site_lod, ensure_ascii=False, indent=1))
        man["name"] = site_scene.get("title") or man["name"]
        man["site"] = site_summary
        man["coverage"] = coverage
        man["assets"]["site_lod"] = f"data/models/{cid}/site.lod.json"
    (mdir / "scene.v2.json").write_text(json.dumps(man, ensure_ascii=False, indent=1))
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id", nargs="?")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    cids = ([p.name for p in (VAULT / "models").iterdir()
             if (p / "meta.json").exists()] if args.all else [args.clip_id])
    if not cids or cids == [None]:
        raise SystemExit("clip_id o --all")
    for cid in cids:
        try:
            man = build(cid)
            caps = ",".join(k for k, v in man["capabilities"].items() if v)
            print(f"{cid}: scene.v2.json ok · {man['name']} · [{caps}]")
        except SystemExit as e:
            print(f"{cid}: SKIP — {e}")


if __name__ == "__main__":
    main()
