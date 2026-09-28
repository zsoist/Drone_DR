#!/usr/bin/env python3
"""Retention for AeroBrain's scratch space on the GPU PC.

The GPU lanes keep a failed job's workdir so it can be resumed, and mark failed
splats with `retain-until`, but nothing ever expired either: by 2026-09-28 the PC
held 102 GB of July/August leftovers plus 14 GB on its full C: drive.

Policy (the Mac's jobs.db is the source of truth; the PC only ever holds copies):
- a job still queued/running on the Mac is never touched;
- a future `retain-until` marker is honored;
- a terminal job (done/error/cancelled) expires RETAIN_DAYS after its last write;
- anything that maps to no Mac job (old smoke fixtures) expires after UNTRACKED_DAYS.

Only direct children of the known AeroBrain roots are candidates, deleted by exact
path. The Python env (splat-env) and runs/.scripts are never listed.

Usage:  python3 pipeline/pc_janitor.py            # dry run
        python3 pipeline/pc_janitor.py --apply    # delete + fstrim
"""
from __future__ import annotations

import argparse
import re
import shlex
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

RETAIN_DAYS = 7
UNTRACKED_DAYS = 30
JOBS_DB = Path("/Volumes/SSD/drone-vault/manifest/jobs.db")
ACTIVE = {"queued", "running", "claimed"}
TERMINAL = {"done", "error", "cancelled", "cancel_failed"}
ROOTS = (
    "/root/gpu-jobs/data",
    "/root/gpu-jobs/runs",
    "/root/gpu-jobs/checkpoints",
    "/root/gpu-jobs/odm",
    "/mnt/d/gpu-vault/transfer",
    "/mnt/c/Users/reyes/gpu-transfer",      # legacy bridge on C:, drained after the move
)
_SAFE = re.compile(r"[\w.\-]+")
_JOB_ID = re.compile(r"(?:splat|3d)-\d+(?:-[0-9a-f]{6})?")


@dataclass(frozen=True)
class Entry:
    path: str
    mtime: float
    retain_until: float | None = None
    kbytes: int = 0


def job_id_for(name: str) -> str | None:
    """Map any remote artifact name to the Mac job id that produced it."""
    m = _JOB_ID.search(name)
    return m.group(0) if m else None


def plan(entries: list[Entry], statuses: dict[str, str], now: float,
         retain_days: int = RETAIN_DAYS, untracked_days: int = UNTRACKED_DAYS) -> list[tuple[Entry, str]]:
    """Return (entry, reason) for every entry that should be deleted."""
    out = []
    for e in entries:
        parent, _, name = e.path.rpartition("/")
        if parent not in ROOTS or not _SAFE.fullmatch(name) or name.startswith("."):
            continue
        if e.retain_until and e.retain_until > now:
            continue
        age_days = (now - e.mtime) / 86400
        job = job_id_for(name)
        status = statuses.get(job) if job else None
        if status in ACTIVE:
            continue
        if status in TERMINAL and age_days >= retain_days:
            out.append((e, f"{status} hace {age_days:.0f} d"))
        elif status is None and age_days >= untracked_days:
            out.append((e, f"sin job en el Mac, {age_days:.0f} d"))
    return out


def mac_statuses(db: Path = JOBS_DB) -> dict[str, str]:
    with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as con:
        return dict(con.execute("select id, status from jobs"))


LIST_SCRIPT = r"""
for r in {roots}; do
  [ -d "$r" ] || continue
  for p in "$r"/*; do
    [ -e "$p" ] || continue
    ru=""; [ -f "$p/retain-until" ] && ru=$(cat "$p/retain-until" 2>/dev/null)
    printf 'E\t%s\t%s\t%s\t%s\n' "$p" "$(stat -c %Y "$p")" "$ru" "$(du -sk "$p" | cut -f1)"
  done
done
"""


def remote_entries() -> list[Entry]:
    from gpu_lane import _wsl
    out = _wsl(LIST_SCRIPT.format(roots=" ".join(ROOTS)), timeout=600, label="janitor: listar")
    entries = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 5 or parts[0] != "E":
            continue
        _, path, mtime, ru, kb = parts
        entries.append(Entry(path, float(mtime), float(ru) if ru.strip().isdigit() else None,
                             int(kb) if kb.isdigit() else 0))
    return entries


def sweep(apply: bool = False, now: float | None = None) -> dict:
    victims = plan(remote_entries(), mac_statuses(), now or time.time())
    freed_gb = sum(e.kbytes for e, _ in victims) / 1024 / 1024
    if apply and victims:
        from gpu_lane import _wsl
        paths = " ".join(shlex.quote(e.path) for e, _ in victims)
        # fstrim returns the freed ext4 blocks to the sparse VHDX, i.e. to Windows D:
        _wsl(f"rm -rf -- {paths}; fstrim / >/dev/null 2>&1 || true; echo JANITOR_OK",
             timeout=1800, label="janitor: borrar")
    return {"applied": apply, "count": len(victims), "freed_gb": round(freed_gb, 1),
            "items": [(e.path, reason, round(e.kbytes / 1024 / 1024, 2)) for e, reason in victims]}


def sweep_best_effort() -> None:
    """Called at the start of every GPU job; housekeeping never fails a job."""
    try:
        r = sweep(apply=True)
        if r["count"]:
            print(f"janitor PC: {r['count']} restos, {r['freed_gb']} GB liberados", flush=True)
    except Exception as exc:                     # noqa: BLE001
        print(f"janitor PC omitido: {exc}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    r = sweep(apply=args.apply)
    for path, reason, gb in r["items"]:
        print(f"{'BORRADO' if args.apply else 'borraría'}  {gb:7.2f} GB  {path}  ({reason})")
    print(f"{r['count']} entradas · {r['freed_gb']} GB · {'aplicado' if args.apply else 'dry-run'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
