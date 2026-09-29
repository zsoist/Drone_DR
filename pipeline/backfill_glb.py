#!/usr/bin/env python3
"""Roll W1 (ODM viewer mesh -> per-device GLB tiers) out to every model.

    python3 backfill_glb.py                      # every model with a viewer OBJ
    python3 backfill_glb.py --only <cid> [--force] [--timeout SECONDS]
    python3 backfill_glb.py --only <cid> --refresh-manifest   # what the post-publish hook runs
    python3 backfill_glb.py --report             # table from what is on disk, no work

Per model: glb_export.build (gltfpack) -> glb_gate (cold-Chrome SSIM / sharpness / budget,
OBJ-fallback and CSP checks). Thresholds are glb_gate's own constants (identical to the
pilot); nothing here relaxes them.

Idempotent: a model whose GLB fingerprint is fresh and whose gate is green for every tier
it has is skipped (--force redoes it). A tier that the gate rejects is NOT advertised
(scene_manifest.py only advertises glb_export.approved()) - the web keeps the OBJ ladder.
Before giving up on a tier a bounded per-model search (max MAX_ATTEMPTS builds) tries the
one parameter that can fix the observed failure and still fit the budget:

    quality-only failure (SSIM / sharpness)  -> raise the triangle target x1.25 (-> full mesh)
    budget-only failure (download/GPU/frame) -> lower ETC1S quality (10 -> 7) if SSIM has
                                                headroom, else lower the triangle target x0.75
    both                                     -> stop (a real conflict, no parameter fixes it)

Codec stays ETC1S: UASTC is 3x the whole current download (see glb_export docstring).
Chosen params + every attempt are written to glb/meta.json["backfill"] and glb/search.json.

Each model runs in its own subprocess with a timeout; one failure never stops the batch.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import glb_export
from fsutil import atomic_write_json, read_json  # noqa: E402
from paths import PIPE, VAULT  # noqa: E402

MAX_ATTEMPTS = 5
SEARCH_VERSION = 3
DEFAULT_TIMEOUT_S = 5400
QUALITY_FLOOR = 7
SSIM_HEADROOM = 0.01
LOCK_NAME = ".backfill.lock"


# ------------------------------------------------------------------ discovery/state
def candidates(vault: Path = VAULT) -> list[str]:
    root = Path(vault) / "models"
    out = []
    for d in sorted(root.iterdir()) if root.is_dir() else []:
        if (d / "model" / "odm_textured_model_viewer.obj").is_file():
            out.append(d.name)
    return out


def _tiers_present(cid: str, vault: Path) -> list[str]:
    _md, _gd, viewer = glb_export._paths(cid, vault)
    return [t for t, c in glb_export.TIERS.items() if (viewer.parent / c["mtl"]).exists()]


def _search_state(cid: str, vault: Path) -> dict:
    _md, gd, _v = glb_export._paths(cid, vault)
    return read_json(gd / "search.json", {}) or {}


def _fingerprint(cid: str, vault: Path) -> str | None:
    _md, _gd, viewer = glb_export._paths(cid, vault)
    mtls = {t: viewer.parent / glb_export.TIERS[t]["mtl"] for t in _tiers_present(cid, vault)}
    return glb_export.source_fingerprint(viewer, mtls) if viewer.exists() and mtls else None


def _exhausted(cid: str, vault: Path, fp: str | None) -> dict:
    st = _search_state(cid, vault)
    ok = st.get("source_fingerprint") == fp and st.get("search_version") == SEARCH_VERSION
    return st.get("tiers", {}) if ok else {}


def is_done(cid: str, vault: Path = VAULT) -> bool:
    """Fresh fingerprint and, for every tier the model has, either green or already
    searched to exhaustion against THIS source fingerprint."""
    try:
        meta = glb_export.validate(cid, vault=vault)
    except (ValueError, OSError):
        meta = None
    if meta is None:                                     # nothing valid on disk: done only if every tier was rejected
        exhausted = _exhausted(cid, vault, _fingerprint(cid, vault))
        return bool(exhausted) and all((exhausted.get(t) or {}).get("status") == "exhausted"
                                       for t in _tiers_present(cid, vault))
    ok = glb_export.approved(cid, vault=vault)
    exhausted = _exhausted(cid, vault, meta["source_fingerprint"])
    for tier in _tiers_present(cid, vault):
        if tier in ok:
            continue
        if (exhausted.get(tier) or {}).get("status") == "exhausted":
            continue
        return False
    return True


# ---------------------------------------------------------------- bounded search
def _quantisation_error(msg: str) -> bool:
    """True when the frame-gate evidence in a GateError message points at position
    quantisation (subset distance / bbox growth beyond 1 cm) rather than decimation."""
    try:
        ev = json.loads(msg[msg.index("{"):])
    except ValueError:                                   # truncated message: assume quantisation
        m = __import__("re").search(r'"vertex_subset_max_m": ([0-9.e-]+)', msg)
        return bool(m) and float(m.group(1)) > glb_export.FRAME_TOL_M
    return (ev.get("vertex_subset_max_m", 0) > glb_export.FRAME_TOL_M
            or ev.get("bbox_grow_m", 0) > glb_export.FRAME_TOL_M)


def next_override(history: list[dict], src_tris: int) -> dict | None:
    """Pure: given the attempts so far (each {override, params, checks, ssim_mean} or
    {override, error}) return the next `tier_overrides` entry to try, or None to stop.
    Overrides accumulate (the next one starts from the last one's)."""
    if len(history) >= MAX_ATTEMPTS or not history:
        return None
    last = history[-1]
    cur = dict(last["override"])
    tried = {json.dumps(h["override"], sort_keys=True) for h in history}

    def fresh(o):
        return None if json.dumps(o, sort_keys=True) in tried else o

    def more_tris(target):
        if target is None:
            return None
        bigger = int(target * 1.25)
        return {**cur, "target_tris": None if bigger >= int(src_tris * 0.97) else bigger}

    if last.get("error"):                                # frame gate rejected the build
        pos = cur.get("pos_bits", 16)
        if pos < 32 and _quantisation_error(last["error"]):                                     # 16-bit grid > 1 cm on big extents:
            return fresh({**cur, "pos_bits": 24 if pos < 24 else 32})   # float16-mantissa, then -noq
        nxt = more_tris(cur["target_tris"] if "target_tris" in cur else last.get("target_tris"))
        return fresh(nxt) if nxt else None
    checks = last["checks"]
    params = last["params"]
    target = params.get("target_tris")
    quality_fail = not (checks.get("ssim") and checks.get("sharpness"))
    budget_fail = not all(checks.get(k, True) for k in ("download", "gpu", "first_frame"))
    if quality_fail == budget_fail:                      # both red (or nothing red): stop
        return None
    if quality_fail:
        if target is not None:
            return fresh(more_tris(target))
        if params.get("codec") == "etc1s":               # full mesh and still short: codec-limited
            return fresh({**cur, "target_tris": None, "codec": "uastc"})
        return None
    # budget-only failure
    if params.get("codec") == "uastc":                   # the codec that fixed SSIM broke the budget
        return None
    q = params.get("quality", 10)
    if q > QUALITY_FLOOR and last.get("ssim_mean", 0) >= glb_gate_ssim_min() + SSIM_HEADROOM:
        return fresh({**cur, "quality": QUALITY_FLOOR})
    base = target if target is not None else src_tris
    lower = int(base * 0.75)
    if lower < 60_000:
        return None
    return fresh({**cur, "target_tris": lower})


def glb_gate_ssim_min() -> float:
    import glb_gate
    return glb_gate.SSIM_MIN


def _src_tris(cid: str, vault: Path) -> int:
    return glb_export.obj_counts(glb_export._paths(cid, vault)[2])[1]


def search_tier(cid: str, tier: str, *, vault: Path, base_url: str, log, build=None,
                gate_tier=None, src_tris: int | None = None) -> dict:
    """Build + gate one tier, iterating next_override. Returns
    {status: green|exhausted, verdict, attempts, entry}. build/gate_tier injectable for tests."""
    import glb_gate
    build = build or glb_export.build
    gate_tier = gate_tier or glb_gate.gate_tier
    history: list[dict] = []
    override: dict = {}
    ref = None
    best = None
    while True:
        try:
            meta = build(cid, vault=vault, tiers=[tier],
                         tier_overrides={tier: override} if override else None, log=log)
        except glb_export.GateError as err:
            history.append({"override": override, "error": str(err)[:3000], "checks": {}, "params": {},
                            "target_tris": override.get("target_tris", glb_export.TIERS[tier]["target_tris"])})
            log(f"[{tier}] build rejected: {str(err)[:200]}")
            nxt = next_override(history, src_tris or _src_tris(cid, vault))
            if nxt is None:
                break
            log(f"[{tier}] -> retry with {nxt}")
            override = nxt
            continue
        entry = meta["tiers"][tier]
        src = src_tris or entry["src_tris"]
        if ref is None:
            ref = glb_gate.run_variant(base_url, cid, tier, "obj")
        verdict = gate_tier(base_url, cid, tier, None, log=log, ref=ref)
        verdict["key"] = entry["key"]
        att = {"override": override, "params": entry["params"], "tris": entry["tris"],
               "bytes": entry["bytes"], "key": entry["key"], "ok": verdict["ok"],
               "checks": verdict["checks"], "ssim_mean": verdict["ssim_mean"],
               "ssim_min": verdict["ssim_min"], "budget": verdict["budget"]}
        history.append(att)
        best = {"verdict": verdict, "entry": entry}
        if verdict["ok"]:
            return {"status": "green", "attempts": history, **best}
        nxt = next_override(history, src)
        if nxt is None:
            break
        log(f"[{tier}] gate red {verdict['checks']} -> retry with {nxt}")
        override = nxt
    return {"status": "exhausted", "attempts": history, **(best or {"verdict": None, "entry": None})}


# ------------------------------------------------------------------- per model
def process_model(cid: str, *, vault: Path = VAULT, force: bool = False,
                  base_url: str | None = None, log=print, tiers: list[str] | None = None) -> dict:
    """Export + gate one model. Returns a result dict (never raises for gate failures)."""
    import glb_gate
    base_url = base_url or glb_gate.DEFAULT_BASE_URL
    t0 = time.time()
    res: dict = {"clip_id": cid, "status": "ok", "tiers": {}}
    if not force and is_done(cid, vault):
        res["status"] = "skipped"
        res["detail"] = "fresh fingerprint + gate green"
        return res
    _md, glb_dir, viewer = glb_export._paths(cid, vault)
    glb_dir.mkdir(parents=True, exist_ok=True)
    lock = glb_dir / LOCK_NAME
    if not _acquire(lock):
        res.update(status="skipped", detail="another backfill holds the lock")
        return res
    try:
        want = [t for t in (tiers or list(glb_export.TIERS)) if t in _tiers_present(cid, vault)]
        if not want:
            res.update(status="failed", detail="no tier has its MTL/pages")
            return res
        if force:
            for t in want:                       # force = rebuild with defaults
                (glb_dir / f"{t}.glb").unlink(missing_ok=True)
        try:
            approved = {} if force else glb_export.approved(cid, vault=vault)
            fresh_meta = None if force else _fresh_meta(cid, vault)
        except Exception:
            approved, fresh_meta = {}, None
        state_tiers = {} if force else _exhausted(cid, vault, _fingerprint(cid, vault))
        verdicts: dict = {}
        outcomes: dict = {}
        for tier in want:
            if tier in approved:
                outcomes[tier] = {"status": "green", "attempts": (state_tiers.get(tier) or {}).get("attempts", []),
                                  "kept": True}
                continue
            if (state_tiers.get(tier) or {}).get("status") == "exhausted" and not force:
                outcomes[tier] = state_tiers[tier]
                continue
            try:
                out = search_tier(cid, tier, vault=vault, base_url=base_url, log=log)
            except Exception as err:            # noqa: BLE001 - one tier must not kill the model
                log(f"[{tier}] FAILED: {err}")
                outcomes[tier] = {"status": "exhausted", "attempts": [], "error": str(err)[:300]}
                continue
            outcomes[tier] = {"status": out["status"], "attempts": out["attempts"]}
            if out.get("verdict"):
                verdicts[tier] = out["verdict"]
        # gate.json: keep existing green tiers, add the searched ones, then the OBJ-fallback + CSP checks
        try:
            meta = glb_export.validate(cid, vault=vault)
        except (ValueError, OSError):
            _write_state(cid, vault, _fingerprint(cid, vault), outcomes)
            res.update(status="rejected", detail="every tier rejected before a GLB was produced",
                       errors={t: (o.get("attempts") or [{}])[-1].get("error", "")[:300] for t, o in outcomes.items()})
            return res
        gate0 = read_json(glb_dir / "gate.json", {}) or {}
        gate_fresh = (gate0.get("source_fingerprint") == meta["source_fingerprint"]
                      and (gate0.get("fallback") or {}).get("ok") and (gate0.get("csp") or {}).get("ok"))
        if verdicts or not gate_fresh:
            glb_gate.run(cid, list(verdicts), base_url, vault=vault, log=log, precomputed=verdicts)
        _write_records(cid, vault, meta, outcomes)
        res["tiers"] = summarize(cid, vault)["tiers"]
        res["errors"] = {t: o["error"] for t, o in outcomes.items() if o.get("error")}
        adv = glb_export.approved(cid, vault=vault)
        res["advertised"] = sorted(adv)
        res["status"] = "ok" if all(t in adv for t in want) else "partial" if adv else "rejected"
        return res
    except Exception as err:                    # noqa: BLE001
        res.update(status="failed", detail=f"{type(err).__name__}: {err}"[:400])
        return res
    finally:
        res["seconds"] = round(time.time() - t0)
        lock.unlink(missing_ok=True)


def _fresh_meta(cid: str, vault: Path) -> dict | None:
    try:
        return glb_export.validate(cid, vault=vault)
    except (ValueError, OSError):
        return None


def _write_state(cid: str, vault: Path, fp: str | None, outcomes: dict) -> None:
    _md, glb_dir, _v = glb_export._paths(cid, vault)
    glb_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(glb_dir / "search.json",
                      {"version": 1, "search_version": SEARCH_VERSION, "source_fingerprint": fp,
                       "tiers": outcomes, "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, indent=1)


def _write_records(cid: str, vault: Path, meta: dict, outcomes: dict) -> None:
    _md, glb_dir, _v = glb_export._paths(cid, vault)
    _write_state(cid, vault, meta["source_fingerprint"], outcomes)
    gate = read_json(glb_dir / "gate.json", {}) or {}
    chosen = {}
    for tier, entry in meta["tiers"].items():
        o = outcomes.get(tier) or {}
        chosen[tier] = {"params": entry["params"], "status": o.get("status", "unknown"),
                        "gate_ok": ((gate.get("tiers") or {}).get(tier) or {}).get("ok"),
                        "attempts": len(o.get("attempts") or [])}
    fresh = read_json(glb_dir / "meta.json", {}) or meta
    fresh["backfill"] = chosen
    atomic_write_json(glb_dir / "meta.json", fresh, indent=1)


def _acquire(lock: Path) -> bool:
    if lock.exists():
        try:
            pid = int(lock.read_text().strip() or 0)
            os.kill(pid, 0)
            return False                         # holder alive
        except (ValueError, ProcessLookupError, PermissionError, OSError):
            pass                                 # stale lock
    lock.write_text(str(os.getpid()))
    return True


# ----------------------------------------------------------------------- reports
def summarize(cid: str, vault: Path = VAULT) -> dict:
    _md, glb_dir, _v = glb_export._paths(cid, vault)
    meta = read_json(glb_dir / "meta.json", {}) or {}
    gate = read_json(glb_dir / "gate.json", {}) or {}
    adv = glb_export.approved(cid, vault=vault)
    rows = {}
    for tier, e in (meta.get("tiers") or {}).items():
        g = (gate.get("tiers") or {}).get(tier) or {}
        b = g.get("budget") or {}
        rows[tier] = {
            "tris": e["tris"], "src_tris": e["src_tris"], "glb_mb": round(e["bytes"] / 1e6, 1),
            "obj_mb": (b.get("download_mb") or [None, None])[0],
            "obj_gpu_mb": (b.get("gpu_texture_mb") or [None, None])[0], "gpu_mb": e["gpu_texture_mb"],
            "ssim": g.get("ssim_mean"), "gate_ok": g.get("ok"), "advertised": tier in adv,
            "checks": g.get("checks"), "target_tris": e["params"].get("target_tris"),
            "quality": e["params"].get("quality"), "codec": e["params"].get("codec"),
        }
    return {"clip_id": cid, "tiers": rows}


def table(results: list[dict]) -> str:
    head = (f"{'model':28} {'tier':8} {'tris':>8} {'MB obj>glb':>14} {'GPU MB':>13} {'SSIM':>6} "
            f"{'gate':>5} {'adv':>4}  params")
    lines = [head, "-" * len(head)]
    for r in results:
        rows = r.get("tiers") or {}
        if not rows:
            lines.append(f"{r['clip_id']:28} {'-':8} {r['status']}: {r.get('detail', '')}")
        for tier, t in rows.items():
            lines.append(
                f"{r['clip_id']:28} {tier:8} {t['tris']:>8} "
                f"{str(t['obj_mb']) + '>' + str(t['glb_mb']):>14} "
                f"{str(t['obj_gpu_mb']) + '>' + str(t['gpu_mb']):>13} {t['ssim'] if t['ssim'] is not None else '-':>6} "
                f"{'PASS' if t['gate_ok'] else 'FAIL':>5} {'yes' if t['advertised'] else 'no':>4}  "
                f"{t['codec']} q{t['quality']} tris<={t['target_tris'] or 'full'}"
                + ("" if t["gate_ok"] else f" red={[k for k, v in (t['checks'] or {}).items() if not v]}"))
    return "\n".join(lines)


# ---------------------------------------------------------- batch + post-publish
def run_isolated(cid: str, *, force: bool, timeout: int, base_url: str | None, vault: Path,
                 refresh_manifest: bool = False) -> dict:
    """Run process_model in a child process so a timeout can kill gltfpack/Chrome."""
    out = Path(vault) / "models" / cid / "glb" / ".result.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)
    cmd = [sys.executable, str(Path(__file__).resolve()), "--only", cid, "--child", str(out),
           "--vault", str(vault)]
    if force:
        cmd.append("--force")
    if base_url:
        cmd += ["--base-url", base_url]
    if refresh_manifest:
        cmd.append("--refresh-manifest")
    try:
        proc = subprocess.run(cmd, timeout=timeout)
    except subprocess.TimeoutExpired:
        _reap_children()
        return {"clip_id": cid, "status": "timeout", "detail": f"> {timeout}s", "tiers": {}}
    res = read_json(out, None)
    out.unlink(missing_ok=True)
    if not isinstance(res, dict):
        return {"clip_id": cid, "status": "failed", "detail": f"child rc={proc.returncode}, no result",
                "tiers": {}}
    return res


def _reap_children() -> None:
    for pat in ("gltfpack", "remote-debugging-port"):
        subprocess.run(["pkill", "-f", pat], capture_output=True)


def refresh_manifest(cid: str, log=print) -> bool:
    """Same function scene_manifest --all uses per scene."""
    import scene_manifest
    try:
        man = scene_manifest.build(cid)
        log(f"scene.v2.json refreshed for {cid} · glb_mesh={bool(man['capabilities'].get('glb_mesh'))}")
        return True
    except (OSError, ValueError, SystemExit) as err:
        log(f"scene.v2 refresh skipped for {cid}: {err}")
        return False


def post_publish(cid: str, *, log=print, popen=subprocess.Popen, vault: Path = VAULT) -> bool:
    """Worker hook: after a successful 3D publish run GLB export + gate + manifest refresh
    for `cid` on the Mac, in a detached process (never blocks or fails the publish job,
    never touches the PC GPU lane). Returns True when the process was started."""
    try:
        glb_dir = Path(vault) / "models" / cid / "glb"
        glb_dir.mkdir(parents=True, exist_ok=True)
        logf = open(glb_dir / "backfill.log", "ab")
        cmd = [sys.executable, str(Path(__file__).resolve()), "--only", cid, "--refresh-manifest",
               "--timeout", str(DEFAULT_TIMEOUT_S)]
        try:
            popen(cmd, cwd=str(PIPE), stdout=logf, stderr=subprocess.STDOUT,
                  stdin=subprocess.DEVNULL, start_new_session=True)
        finally:
            logf.close()                        # the child keeps its own dup
        log(f"GLB export lanzado para {cid} (Mac, en segundo plano) -> {glb_dir / 'backfill.log'}")
        return True
    except Exception as err:                    # noqa: BLE001 - must never fail the publish
        log(f"GLB export omitido para {cid}: {err}")
        return False


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", action="append", help="clip id (repeatable)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_S, help="seconds per model")
    ap.add_argument("--base-url")
    ap.add_argument("--vault", type=Path, default=VAULT)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--refresh-manifest", action="store_true")
    ap.add_argument("--child", type=Path, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    vault = args.vault
    cids = args.only or candidates(vault)

    if args.child:                                       # single model, in-process
        if not (vault / "models" / cids[0] / "scene.v2.json").exists():
            refresh_manifest(cids[0])                    # the gate harness loads it
        res = process_model(cids[0], vault=vault, force=args.force, base_url=args.base_url)
        atomic_write_json(args.child, res, indent=1)
        if args.refresh_manifest:
            refresh_manifest(cids[0])
        return 0
    if args.report:
        print(table([summarize(c, vault) | {"status": "report"} for c in cids]))
        return 0

    results = []
    for cid in cids:
        print(f"=== {cid}", flush=True)
        res = run_isolated(cid, force=args.force, timeout=args.timeout, base_url=args.base_url,
                           vault=vault, refresh_manifest=args.refresh_manifest)
        print(f"=== {cid}: {res['status']} {res.get('detail', '')} ({res.get('seconds', '?')}s)", flush=True)
        results.append(res)
    print("\n" + table(results))
    qa = Path(vault) / "qa"
    qa.mkdir(parents=True, exist_ok=True)
    atomic_write_json(qa / f"glb_backfill_{time.strftime('%Y%m%d-%H%M%S')}.json", results, indent=1)
    bad = [r["clip_id"] for r in results if r["status"] in ("failed", "timeout")]
    if bad:
        print(f"\nfailed/timeout: {bad}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
