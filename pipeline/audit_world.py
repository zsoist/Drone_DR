#!/usr/bin/env python3
"""Fail-closed audit for collision assets of active FLIGHTVERSE worlds."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import collision_bake
import mesh_coverage

VAULT = Path("/Volumes/SSD/drone-vault")


def _load(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
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


def audit(*, vault: Path = VAULT, active_only: bool = True) -> dict:
    vault = Path(vault)
    system = _load(vault / "manifest" / "system.json")
    worlds = []
    failures = []
    for cid in _targets(system, active_only):
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
