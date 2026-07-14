"""Audit real Gaussian splat state in the vault.

This is a data-health gate, not a renderer. It checks the invariants that make
the splat product understandable and recoverable:

  python3 pipeline/audit_splats.py

Fails on:
  - manifest rows whose files do not exist
  - missing Medium/Cinematic/Ultra coverage
  - missing end-to-end done job coverage for Medium/Cinematic/Ultra
  - no clip with multiple splat versions
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

from splat_presets import SPLAT_PRESETS


VAULT = Path("/Volumes/SSD/drone-vault")
SYSTEM = VAULT / "manifest" / "system.json"
JOBS = VAULT / "manifest" / "jobs.db"
REQUIRED_PRESETS = {"medium", "cinematic", "ultra", "ultra20", "frontier", "grandmaster"}
PRESET_BY_ITERS = {profile["iters"]: key for key, profile in SPLAT_PRESETS.items()}


def load_system() -> dict:
    return json.loads(SYSTEM.read_text())


def load_jobs() -> list[sqlite3.Row]:
    con = sqlite3.connect(JOBS)
    con.row_factory = sqlite3.Row
    try:
        return con.execute(
            "SELECT id,label,status,detail,artifact,spec,stage,progress FROM jobs "
            "WHERE kind='splat' ORDER BY started DESC"
        ).fetchall()
    finally:
        con.close()


def job_preset(job: sqlite3.Row) -> str | None:
    try:
        spec = json.loads(job["spec"] or "{}")
    except ValueError:
        spec = {}
    preset = str(spec.get("preset") or "").lower().strip()
    if preset:
        return preset
    try:
        return PRESET_BY_ITERS.get(int(spec.get("iters") or 0))
    except (TypeError, ValueError):
        return None


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
        if s.get("format") not in ("sog", "spz", "ksplat"):
            warnings.append(f"non-optimized visible format: {path} format={s.get('format')}")
        missing = [k for k in ("clip_id", "path", "format", "preset", "iters", "cameras", "duration_s")
                   if s.get(k) in (None, "")]
        if missing:
            failures.append(f"metadata missing {missing}: {path}")
        if not s.get("backend"):
            warnings.append(f"legacy backend missing: {path}")
        if s.get("preset") in ("ultra20", "frontier", "grandmaster"):
            provenance = ("requested_backend", "effective_backend", "requested_downscale",
                          "effective_downscale", "trainer", "params_hash")
            missing_provenance = [key for key in provenance if s.get(key) in (None, "")]
            if missing_provenance:
                failures.append(f"CUDA provenance missing {missing_provenance}: {path}")
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
    preset_counts = Counter(s.get("preset") for s in splats)
    missing_presets = sorted(REQUIRED_PRESETS - set(preset_counts))
    if missing_presets:
        failures.append(f"missing required preset coverage: {missing_presets}")
    multi_version = {clip: len(rows) for clip, rows in by_clip.items() if len(rows) > 1}
    if not multi_version:
        failures.append("no multi-version splat clip found")
    jobs = load_jobs()
    generated_presets = Counter()
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
        else:
            preset = job_preset(j)
            if preset:
                generated_presets[preset] += 1
        required_text = ("loss", "cámaras")
        if any(t not in detail for t in required_text):
            failures.append(f"done job detail lacks quality context: {j['id']} detail={detail!r}")
        if not any(p in detail for p in ("Medium", "Cinematic", "Ultra", "Fast", "custom")):
            failures.append(f"done job detail lacks preset: {j['id']} detail={detail!r}")
        if j["stage"] != "browser-qa" or float(j["progress"] or 0) < 0.99:
            failures.append(f"done job lacks browser QA completion: {j['id']} stage={j['stage']} progress={j['progress']}")
    missing_generated = sorted(REQUIRED_PRESETS - set(generated_presets))
    if missing_generated:
        failures.append(f"missing generated job coverage: {missing_generated}")
    summary = {
        "splats": len(splats),
        "clips": len(by_clip),
        "generated_presets": dict(sorted(generated_presets.items())),
        "multi_version_clips": multi_version,
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
