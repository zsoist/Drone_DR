#!/usr/bin/env python3
"""Roll W5 (vegetation scatter) out to every world that has a terrain + ortho.

    python3 pipeline/backfill_scatter.py                 # every model, skips fresh scatter.json
    python3 pipeline/backfill_scatter.py --only <cid> [--force]
    python3 pipeline/backfill_scatter.py --report        # what is on disk, no work

Per model: scatter.build (idempotent: a scatter whose input fingerprint is unchanged is kept),
then scene_manifest.build so scene.v2.json advertises ``assets.scatter``. The manifest is only
rebuilt for models whose advertised state changed. Vegetation is visual only; a model whose
build fails is reported and skipped, never blocks the batch.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import scatter
from fsutil import read_json
from paths import VAULT


def candidates(vault: Path = VAULT) -> list[str]:
    root = Path(vault) / "models"
    out = []
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        if (d / "dsm_lod.json").is_file() and (d / "meta.json").is_file():
            out.append(d.name)
    return out


def advertised(cid: str, vault: Path = VAULT) -> bool:
    man = read_json(Path(vault) / "models" / cid / "scene.v2.json", {}) or {}
    return bool((man.get("assets") or {}).get("scatter"))


def run(cids: list[str], *, force: bool = False, vault: Path = VAULT, refresh=True, log=print) -> list[dict]:
    rows = []
    for cid in cids:
        row = {"cid": cid, "status": "", "trees": 0, "shrubs": 0}
        try:
            was_fresh = False
            try:
                scatter.validate(cid, vault)
                was_fresh = True
            except ValueError:
                pass
            doc = scatter.build(cid, vault, force=force)
            row.update(trees=doc["counts"]["tree"], shrubs=doc["counts"]["shrub"],
                       status="kept" if was_fresh and not force else "built")
            if refresh and (row["status"] == "built" or not advertised(cid, vault)):
                import scene_manifest
                scene_manifest.build(cid)
                row["status"] += "+manifest"
        except (scatter.ScatterError, OSError, SystemExit, ValueError) as e:
            row["status"] = f"skip: {e}"
        rows.append(row)
        log(f"{cid:<32} {row['status']:<18} trees={row['trees']:<5} shrubs={row['shrubs']}")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", action="append")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--no-manifest", action="store_true")
    a = ap.parse_args()
    cids = a.only or candidates()
    if a.report:
        for cid in cids:
            try:
                d = scatter.validate(cid)
                print(f"{cid:<32} fresh  {d['counts']}  advertised={advertised(cid)}")
            except ValueError as e:
                print(f"{cid:<32} {e}")
        return 0
    run(cids, force=a.force, refresh=not a.no_manifest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
