#!/usr/bin/env python3
"""Create models/<id>/ortho_thumb.webp (max 480 px wide) for every published model.

Idempotent: skips a model whose thumb is newer than its ortho. Only ADDS files.

  python3 pipeline/backfill_thumbs.py [--force] [--vault PATH]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tresd_publish  # noqa: E402


def backfill(models_dir: Path, force: bool = False) -> dict:
    res = {"created": [], "skipped": [], "no_ortho": [], "failed": [],
           "bytes_before": 0, "bytes_after": 0}
    if not models_dir.is_dir():
        return res
    for d in sorted(models_dir.iterdir()):
        if not d.is_dir() or not (d / "meta.json").exists():
            continue
        src = next((d / n for n in ("ortho.webp", "ortho.png") if (d / n).exists()), None)
        if src is None:
            res["no_ortho"].append(d.name)
            continue
        dst = d / tresd_publish.THUMB_NAME
        res["bytes_before"] += src.stat().st_size
        if not force and dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            res["skipped"].append(d.name)
            res["bytes_after"] += dst.stat().st_size
            continue
        if tresd_publish.make_ortho_thumb(src, dst):
            res["created"].append(d.name)
            res["bytes_after"] += dst.stat().st_size
        else:
            res["failed"].append(d.name)
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--force", action="store_true", help="regenerate even if up to date")
    ap.add_argument("--vault", default=str(tresd_publish.VAULT))
    a = ap.parse_args()
    r = backfill(Path(a.vault) / "models", a.force)
    print(f"created {len(r['created'])} · skipped {len(r['skipped'])} · "
          f"no ortho {len(r['no_ortho'])} · failed {len(r['failed'])}")
    print(f"ortho bytes {r['bytes_before']:,} → thumb bytes {r['bytes_after']:,}")
    return 1 if r["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
