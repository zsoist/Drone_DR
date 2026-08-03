#!/usr/bin/env python3
"""Authoritative GPU-Chrome gate for a mixed FLIGHTVERSE Invasion."""
from __future__ import annotations

import argparse
import base64
import json
import math
import subprocess
import time
import urllib.parse

import audit_world
from browser_gate import DEFAULT_BASE_URL, QA_DIR, launch_chrome, new_page


SELECTED_TYPES = ("zombie", "soldado", "ufo")


def _failure(reason: str, **detail) -> dict:
    return {"reason": reason, **detail}


def validate_invasion_sample(sample: dict) -> list[dict]:
    failures = []
    fps = sample.get("fps")
    if not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps < 50:
        failures.append(_failure("fps_below_50", fps=fps))
    if not sample.get("ok") or sample.get("errors"):
        failures.append(_failure("world_autotest_failed", errors=sample.get("errors") or []))

    invasion = sample.get("invasion") or {}
    telemetry = invasion.get("telemetry") or {}
    if not invasion.get("on") or invasion.get("phase") != "running" or invasion.get("wave", 0) < 1:
        failures.append(_failure("invasion_not_running", invasion=invasion))
    if invasion.get("difficulty") != "dificil":
        failures.append(_failure("difficulty_mismatch", difficulty=invasion.get("difficulty")))

    active_types = {
        key for key, value in (telemetry.get("activeByType") or {}).items() if value > 0
    }
    if not set(SELECTED_TYPES).issubset(active_types):
        failures.append(_failure("mixed_types_missing", active=sorted(active_types)))

    alive = invasion.get("alive", 0)
    source = telemetry.get("modelSource") or {}
    if source.get("procedural", 0) or telemetry.get("fallbackTotal", 0):
        failures.append(_failure(
            "procedural_fallback",
            model_source=source,
            fallback_total=telemetry.get("fallbackTotal"),
        ))
    if source.get("glb") != alive or alive < len(SELECTED_TYPES):
        failures.append(_failure("glb_enemy_count", alive=alive, model_source=source))

    ai = telemetry.get("ai") or {}
    if sum(ai.values()) != alive or not any(ai.values()):
        failures.append(_failure("ai_telemetry_missing", alive=alive, ai=ai))

    preload = telemetry.get("preload") or {}
    if (
        preload.get("requested") != len(SELECTED_TYPES) * 2
        or preload.get("ready") != preload.get("requested")
        or preload.get("failed") != 0
    ):
        failures.append(_failure("preload_failed", preload=preload))
    if telemetry.get("spawnFailures", 0) or telemetry.get("loadRejected", 0):
        failures.append(_failure(
            "runtime_admission_failure",
            spawn_failures=telemetry.get("spawnFailures"),
            load_rejected=telemetry.get("loadRejected"),
        ))

    caps = telemetry.get("caps") or {}
    counts = telemetry.get("runtimeCounts") or {}
    cap_breach = not telemetry.get("withinCaps")
    cap_breach = cap_breach or any(
        not isinstance(counts.get(key), int) or counts[key] < 0 or counts[key] > limit
        for key, limit in caps.items()
    )
    if cap_breach or set(counts) != {"enemies", "shots", "bursts", "modelCache"}:
        failures.append(_failure("runtime_cap_breach", counts=counts, caps=caps))

    repeated = {
        name: count for name, count in (sample.get("model_request_counts") or {}).items()
        if count > 1
    }
    if repeated:
        failures.append(_failure("model_retry_storm", repeated=repeated))
    return failures


def _choose_active_world() -> str:
    result = audit_world.audit(active_only=True)
    candidates = [
        row for row in result.get("worlds", [])
        if row.get("terrain") and row.get("collision")
    ]
    if not result.get("ok") or not candidates:
        raise RuntimeError(f"no active World available: {result.get('failures')}")
    return min(candidates, key=lambda row: row.get("tris") or math.inf)["clip_id"]


def _wait_for_sample(cdp, timeout: int) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        cdp.pump(0.25)
        try:
            sample = cdp.eval("""(() => {
              const r = window.__volar;
              const inv = r?.invasion;
              const t = inv?.telemetry;
              const active = Object.entries(t?.activeByType || {}).filter(([,n]) => n > 0);
              const aiTotal = Object.values(t?.ai || {}).reduce((sum,n) => sum + n, 0);
              if (!r?.done || !inv?.on || inv.phase !== 'running' || inv.wave < 1
                  || inv.alive < 3 || active.length < 3 || t?.modelSource?.glb !== inv.alive
                  || aiTotal !== inv.alive) return null;
              const requestCounts = {};
              for (const entry of performance.getEntriesByType('resource')) {
                if (!/\\/assets\\/enemies\\/[^/?]+\\.glb(?:\\?|$)/.test(entry.name)) continue;
                const name = entry.name.split('/').pop().split('?')[0];
                requestCounts[name] = (requestCounts[name] || 0) + 1;
              }
              return {
                ok:r.ok, fps:r.fps, errors:[...(r.errors || [])],
                invasion:inv, model_request_counts:requestCounts,
              };
            })()""")
        except RuntimeError:
            continue
        if sample:
            return sample
    raise RuntimeError(f"mixed Invasion did not become observable within {timeout}s")


def run_gate(
    *,
    cid: str | None = None,
    base_url: str = DEFAULT_BASE_URL,
    timeout: int = 90,
) -> dict:
    target = cid or _choose_active_world()
    proc, profile, port = launch_chrome()
    cdp = None
    try:
        cdp = new_page(port)
        query = urllib.parse.urlencode({
            "m": target,
            "autotest": "1",
            "rig": "0",
            "invasion": ",".join(SELECTED_TYPES),
            "invDifficulty": "dificil",
        })
        cdp.send("Page.navigate", {"url": f"{base_url.rstrip('/')}/volar.html?{query}"})
        sample = _wait_for_sample(cdp, timeout)
        sample["console_errors"] = cdp.errors[:8]
        if cdp.errors:
            sample.setdefault("errors", []).extend(cdp.errors[:8])
        failures = validate_invasion_sample(sample)
        QA_DIR.mkdir(parents=True, exist_ok=True)
        screenshot = QA_DIR / f"{target}-invasion-runtime.png"
        shot = cdp.send("Page.captureScreenshot", {
            "format": "png",
            "captureBeyondViewport": False,
        })
        screenshot.write_bytes(base64.b64decode(shot["data"]))
        result = {
            "ok": not failures,
            "clip_id": target,
            "fps": sample.get("fps"),
            "invasion": sample.get("invasion"),
            "model_request_counts": sample.get("model_request_counts"),
            "console_errors": sample.get("console_errors"),
            "screenshot": str(screenshot),
            "failures": failures,
        }
        if failures:
            raise RuntimeError(json.dumps(result, ensure_ascii=False))
        return result
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        profile.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cid")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout", type=int, default=90)
    args = parser.parse_args()
    result = run_gate(cid=args.cid, base_url=args.base_url, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
