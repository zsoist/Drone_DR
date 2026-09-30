#!/usr/bin/env python3
"""Fail-closed audit for collision assets of active FLIGHTVERSE worlds."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import collision_bake
import mesh_coverage

from fsutil import read_json  # noqa: E402
from paths import VAULT  # noqa: E402


def _load(path: Path) -> dict:
    value = read_json(path, {})
    return value if isinstance(value, dict) else {}


def _targets(system: dict, active_only: bool) -> list[str]:
    models = [
        row.get("clip_id")
        for row in system.get("models") or []
        if isinstance(row, dict) and row.get("clip_id")
    ]
    if not active_only:
        return list(dict.fromkeys(models))

    scenes = [
        scene for scene in system.get("scenes") or []
        if isinstance(scene, dict)
    ]
    versioned = {
        version.get("id")
        for scene in scenes
        for version in scene.get("versions") or []
        if isinstance(version, dict) and version.get("id")
    }
    targets = [
        scene.get("active_version")
        for scene in scenes
        if scene.get("active_version")
    ]
    targets.extend(cid for cid in models if cid not in versioned)
    return list(dict.fromkeys(cid for cid in targets if cid))


def frame_failure(manifest: dict, model_dir: Path) -> dict | None:
    """Geometric sanity the fingerprint checks cannot give: the fingerprint hashes the very offset
    that produced the collider, so a self-consistent WRONG frame used to pass (a 250 m shifted mesh
    kept 13% of the triangles and still audited ok). Only rejects what is provably wrong."""
    transforms = manifest.get("transforms") or {}
    offset = transforms.get("mesh_offset")
    if offset is not None and transforms.get("mesh_offset_frame") != "dsm_center":
        return {"reason": "mesh_offset_frame_unverified",
                "frame": transforms.get("mesh_offset_frame")}
    size = (manifest.get("world") or {}).get("size_m")
    bounds = _load(model_dir / "collision.json").get("bounds")
    try:
        (x0, _y0, z0), (x1, _y1, z1) = bounds
        half_x, half_z = float(size[0]) / 2, float(size[1]) / 2
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    except (TypeError, ValueError, IndexError):
        return None                      # nothing declared to compare against
    # collider centre must sit inside the DSM footprint; the mesh may overhang its edge, never float away
    if abs(cx) > half_x or abs(cz) > half_z:
        return {"reason": "collider_outside_world",
                "collider_center_m": [round(cx, 1), round(cz, 1)],
                "world_half_extent_m": [round(half_x, 1), round(half_z, 1)]}
    return None


def audit(*, vault: Path = VAULT, active_only: bool = True) -> dict:
    vault = Path(vault)
    system_path = vault / "manifest" / "system.json"
    system = _load(system_path)
    worlds = []
    failures = []
    # Fail closed: a missing/unreadable/empty manifest, or one with nothing to audit, used
    # to yield zero targets and "ok" — an audit that verified nothing.
    if not system_path.is_file() or not system:
        failures.append({"reason": "system_manifest_missing", "path": str(system_path)})
        targets: list[str] = []
    else:
        targets = _targets(system, active_only)
        if not targets:
            failures.append({"reason": "no_worlds_to_audit", "active_only": bool(active_only)})
    for cid in targets:
        manifest_path = vault / "models" / cid / "scene.v2.json"
        manifest = _load(manifest_path)
        if not manifest:
            failures.append({
                "clip_id": cid,
                "reason": "scene_manifest_missing",
            })
            continue
        capabilities = manifest.get("capabilities") or {}
        row = {
            "clip_id": cid,
            "mesh": bool(capabilities.get("mesh")),
            "terrain": bool(capabilities.get("terrain")),
            "collision": bool(capabilities.get("collision")),
        }
        worlds.append(row)
        if not row["mesh"]:
            continue
        if not row["collision"]:
            failures.append({
                "clip_id": cid,
                "reason": "collision_not_published",
            })
            continue
        geometry_failure = frame_failure(manifest, vault / "models" / cid)
        if geometry_failure:
            failures.append({"clip_id": cid, **geometry_failure})
            continue
        try:
            collider = collision_bake.validate(cid, vault=vault)
            coverage = mesh_coverage.validate(cid, vault=vault)
            row.update({
                "tris": collider["tris"],
                "covered_pct": coverage["covered_pct"],
            })
        except (OSError, KeyError, TypeError, ValueError) as error:
            failures.append({
                "clip_id": cid,
                "reason": "collision_assets_invalid",
                "error": str(error),
            })
    return {
        "ok": not failures,
        "active_only": bool(active_only),
        "worlds": worlds,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--vault", type=Path, default=VAULT)
    args = parser.parse_args()
    result = audit(vault=args.vault, active_only=not args.all)
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
