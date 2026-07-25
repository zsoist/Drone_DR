#!/usr/bin/env python3
"""Deterministic Chrome gate for FLIGHTVERSE world collision behavior."""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse

from browser_gate import DEFAULT_BASE_URL, launch_chrome, new_page


def fixture_gate(base_url: str, timeout: int = 30) -> dict:
    proc, profile, port = launch_chrome()
    cdp = None
    try:
        cdp = new_page(port)
        url = f"{base_url.rstrip('/')}/flightverse/world-collision-fixture.html"
        cdp.send("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        report = None
        while time.time() < deadline:
            cdp.pump(0.25)
            try:
                report = cdp.eval(
                    "window.__worldCollisionFixture?.done"
                    " ? window.__worldCollisionFixture : null"
                )
            except RuntimeError:
                continue
            if report:
                break
        if not report:
            raise RuntimeError(
                f"fixture no terminó en {timeout}s · console={cdp.errors[:6]}"
            )
        report["console_errors"] = cdp.errors[:6]
        if cdp.errors:
            report["ok"] = False
        if not report.get("ok"):
            raise RuntimeError(json.dumps(report, ensure_ascii=False))
        if int(report.get("queries", 0)) != 10_000:
            raise RuntimeError(f"fixture no ejecutó 10k queries: {report}")
        if float(report.get("query_ms", 1e9)) > 2_000:
            raise RuntimeError(f"10k queries excedieron presupuesto: {report}")
        return report
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        profile.cleanup()


def live_world_gate(cid: str, base_url: str, stress: int, timeout: int = 120) -> dict:
    """Sample one fully loaded world repeatedly and reject drift or resource growth."""
    if stress < 1 or stress > 1_000:
        raise ValueError("--stress debe estar entre 1 y 1000")
    proc, profile, port = launch_chrome()
    cdp = None
    try:
        cdp = new_page(port)
        url = (
            f"{base_url.rstrip('/')}/volar.html"
            f"?m={urllib.parse.quote(cid)}&autotest=1&rig=3"
        )
        cdp.send("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        ready = None
        while time.time() < deadline:
            cdp.pump(0.25)
            try:
                ready = cdp.eval(
                    "(() => { const r=window.__volar;"
                    " return r?.done && r?.visualMesh ? r : null; })()"
                )
            except RuntimeError:
                continue
            if ready:
                break
        if not ready:
            raise RuntimeError(
                f"mundo vivo no terminó en {timeout}s · console={cdp.errors[:6]}"
            )

        samples = []
        for index in range(stress):
            cdp.pump(0.025)
            sample = cdp.eval(
                "(() => { const r=window.__volar; return {"
                "ok:r?.ok, fps:r?.fps, errors:[...(r?.errors||[])],"
                "classification:r?.collision?.structure,"
                "collisionReady:r?.collision?.ready,"
                "hitCoordinates:r?.pos,"
                "groups:r?.lifecycle?.groups,"
                "disposedStaleLoads:r?.lifecycle?.disposedStaleLoads,"
                "representation:r?.representation,"
                "projectiles:r?.weapons?.projectiles,"
                "fired:r?.weapons?.fired, exploded:r?.weapons?.exploded,"
                "memory:r?.rendererMemory"
                "}; })()"
            )
            sample["run"] = index + 1
            samples.append(sample)

        failures = []
        for sample in samples:
            layers = (sample.get("representation") or {}).get(
                "visibleStructuralLayers"
            ) or []
            if not sample.get("ok") or sample.get("fps", 0) < 50:
                failures.append({"run": sample["run"], "reason": "fps_or_autotest"})
            if not sample.get("collisionReady") or not sample.get("classification"):
                failures.append({"run": sample["run"], "reason": "collision_missing"})
            if sample.get("groups") != 1 or sample.get("disposedStaleLoads") != 0:
                failures.append({"run": sample["run"], "reason": "scene_lifecycle"})
            if sample.get("errors"):
                failures.append({"run": sample["run"], "reason": "runtime_errors"})
            if "mesh" in layers and "splat" in layers:
                failures.append({"run": sample["run"], "reason": "duplicate_layers"})
            if sample.get("projectiles") is None:
                failures.append({"run": sample["run"], "reason": "projectile_count_missing"})

        memories = [row.get("memory") or {} for row in samples]
        for key in ("geometries", "textures"):
            values = [int(row.get(key, 0)) for row in memories]
            if values and values[-1] > values[0]:
                failures.append({
                    "run": stress,
                    "reason": f"renderer_{key}_growth",
                    "first": values[0],
                    "last": values[-1],
                })
        if cdp.errors:
            failures.append({"run": stress, "reason": "console", "errors": cdp.errors[:6]})
        report = {
            "ok": not failures,
            "clip_id": cid,
            "stress_runs": stress,
            "failures": failures,
            "samples": samples,
            "console_errors": cdp.errors[:6],
        }
        if failures:
            raise RuntimeError(json.dumps(report, ensure_ascii=False))
        return report
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        profile.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("clip_id", nargs="?")
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--stress", type=int)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    if args.fixture:
        report = fixture_gate(args.base_url, min(args.timeout, 60))
    else:
        if not args.clip_id or args.stress is None:
            parser.error("usa <clip_id> --stress N o --fixture")
        fixture = fixture_gate(args.base_url, min(args.timeout, 60))
        report = live_world_gate(
            args.clip_id, args.base_url, args.stress, args.timeout
        )
        report["fixture"] = {
            "queries": fixture["queries"],
            "query_ms": fixture["query_ms"],
            "assertions": len(fixture["assertions"]),
        }
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
