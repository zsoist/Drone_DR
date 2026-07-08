"""Audit real Gaussian splat state in the vault.

This is a data-health gate, not a renderer. It checks the invariants that make
the splat product understandable and recoverable:

  python3 pipeline/audit_splats.py

Fails on:
  - manifest rows whose files do not exist
  - duplicate current splats for a clip
  - missing critical quality metadata
  - done jobs pointing at dead artifacts
  - done job cards missing preset/runtime/loss/camera context

Warns on legacy metadata we cannot truthfully reconstruct, such as backend for
old sidecars that did not record it.
"""
from __future__ import annotations

import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path


VAULT = Path("/Volumes/SSD/drone-vault")
SYSTEM = VAULT / "manifest" / "system.json"
JOBS = VAULT / "manifest" / "jobs.db"


def load_system() -> dict:
    return json.loads(SYSTEM.read_text())


def load_jobs() -> list[sqlite3.Row]:
    con = sqlite3.connect(JOBS)
    con.row_factory = sqlite3.Row
    try:
        return con.execute(
            "SELECT id,label,status,detail,artifact FROM jobs "
            "WHERE kind='splat' ORDER BY started DESC"
        ).fetchall()
    finally:
        con.close()


def audit() -> tuple[list[str], list[str], dict]:
    failures: list[str] = []
    warnings: list[str] = []
    sys = load_system()
    splats = sys.get("splats") or []
    by_clip = defaultdict(list)
    for s in splats:
        by_clip[s.get("clip_id")].append(s)
        path = s.get("path")
        full = VAULT / "splats" / str(path or "")
        if not path or not full.exists():
            failures.append(f"missing asset: {s.get('clip_id')} path={path}")
            continue
        if s.get("format") != "ksplat":
            warnings.append(f"non-optimized visible format: {path} format={s.get('format')}")
        missing = [k for k in ("clip_id", "path", "format", "preset", "iters", "loss", "cameras", "duration_s")
                   if s.get(k) in (None, "")]
        if missing:
            failures.append(f"metadata missing {missing}: {path}")
        if not s.get("backend"):
            warnings.append(f"legacy backend missing: {path}")
        if s.get("bytes", 0) < 100_000:
            failures.append(f"splat asset suspiciously small: {path} bytes={s.get('bytes')}")
        if s.get("loss") is not None and float(s["loss"]) > 0.2:
            warnings.append(f"high final loss: {path} loss={s['loss']}")
        if s.get("cameras") is not None and int(s["cameras"]) < 8:
            failures.append(f"too few cameras: {path} cameras={s['cameras']}")
    for clip, rows in by_clip.items():
        current = [s for s in rows if s.get("current")]
        if len(current) > 1:
            failures.append(f"duplicate current splats for {clip}: {[s.get('path') for s in current]}")
    jobs = load_jobs()
    for j in jobs:
        if j["status"] != "done":
            continue
        art = j["artifact"] or ""
        detail = j["detail"] or ""
        if not art:
            if "modelo eliminado" not in detail:
                warnings.append(f"done splat job without artifact: {j['id']}")
            continue
        if not (VAULT / art).exists():
            failures.append(f"done job points to missing artifact: {j['id']} {art}")
        required_text = ("loss", "cámaras")
        if any(t not in detail for t in required_text):
            failures.append(f"done job detail lacks quality context: {j['id']} detail={detail!r}")
        if not any(p in detail for p in ("Medium", "Cinematic", "Ultra", "Fast", "custom")):
            failures.append(f"done job detail lacks preset: {j['id']} detail={detail!r}")
    preset_counts = Counter(s.get("preset") for s in splats)
    summary = {
        "splats": len(splats),
        "clips": len(by_clip),
        "presets": dict(sorted(preset_counts.items())),
        "warnings": len(warnings),
        "failures": len(failures),
    }
    return failures, warnings, summary


def main() -> int:
    failures, warnings, summary = audit()
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    for w in warnings:
        print(f"WARN {w}")
    for f in failures:
        print(f"FAIL {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
