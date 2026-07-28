#!/usr/bin/env python3
"""Deterministic Chrome gate for FLIGHTVERSE world collision behavior."""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse
from pathlib import Path

from browser_gate import DEFAULT_BASE_URL, launch_chrome, new_page


VAULT = Path("/Volumes/SSD/drone-vault")
NEW_WEAPON_KEYS = ("ac", "sw", "vx", "rg", "tb")
WEAPON_SETTLE_SECONDS = {
    "ac": 1.5,
    "sw": 6.5,
    "vx": 3.0,
    "rg": 1.9,
    "tb": 5.0,
}


def _finite_number(value) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_live_sample(
    sample: dict,
    *,
    requires_structural_collision: bool = True,
    expected_camera_rig: str = "muycerca",
) -> list[dict]:
    failures = []
    run = sample.get("run")
    layers = (sample.get("representation") or {}).get(
        "visibleStructuralLayers"
    ) or []
    if not sample.get("ok") or sample.get("fps", 0) < 50:
        failures.append({"run": run, "reason": "fps_or_autotest"})
    if not sample.get("collisionReady") or (
            requires_structural_collision and not sample.get("classification")):
        failures.append({"run": run, "reason": "collision_missing"})
    if sample.get("groups") != 1 or sample.get("disposedStaleLoads") != 0:
        failures.append({"run": run, "reason": "scene_lifecycle"})
    if sample.get("errors"):
        failures.append({"run": run, "reason": "runtime_errors"})
    if "mesh" in layers and "splat" in layers:
        failures.append({"run": run, "reason": "duplicate_layers"})
    if sample.get("projectiles") is None:
        failures.append({"run": run, "reason": "projectile_count_missing"})
    radius = sample.get("collisionRadius")
    if not _finite_number(radius) or not 0.42 <= radius <= 0.70:
        failures.append({"run": run, "reason": "collision_envelope"})
    if (
        sample.get("collisionRadiusSource") != "glb"
        or sample.get("customDrone") is not True
    ):
        failures.append({"run": run, "reason": "collision_envelope_source"})
    camera_checks = sample.get("cameraCollisionChecks")
    camera_hits = sample.get("cameraCollisionHits")
    if not _finite_number(camera_hits) or camera_hits < 0:
        failures.append({"run": run, "reason": "camera_telemetry"})
    if expected_camera_rig == "fpv":
        failures.extend(validate_fpv_camera(sample))
    elif (
        sample.get("cameraRig") != expected_camera_rig
        or not _finite_number(camera_checks)
        or camera_checks <= 0
        or not _finite_number(camera_hits)
        or camera_hits < 0
    ):
        failures.append({"run": run, "reason": "camera_integration"})
    failures.extend(validate_effect_snapshot(sample))
    return failures


def validate_fpv_camera(sample: dict) -> list[dict]:
    if (
        sample.get("cameraRig") == "fpv"
        and sample.get("cameraCollisionChecks") == 0
        and sample.get("cameraCollisionHits") == 0
    ):
        return []
    return [{"run": sample.get("run"), "reason": "fpv_camera_isolation"}]


def validate_effect_snapshot(sample: dict) -> list[dict]:
    effects = sample.get("effects") or {}
    budget = effects.get("budget") or {}
    active = effects.get("active")
    peak = effects.get("peak")
    active_budget = budget.get("active")
    if (
        not _finite_number(active_budget)
        or not _finite_number(active)
        or not _finite_number(peak)
        or active < 0
        or peak < 0
        or active > active_budget
        or peak > active_budget
        or effects.get("drawBatches") != 5
        or effects.get("softAlpha") is not True
        or effects.get("shockwaveViewportCap") != 0.35
    ):
        return [{"run": sample.get("run"), "reason": "weapon_effect_budget"}]
    return []


def validate_stress_actions(actions: dict) -> list[dict]:
    failures = []
    if actions.get("attempts", 0) < 1 or actions.get("fired_delta", 0) < 1:
        failures.append({"reason": "fire_not_observed", **actions})
    if actions.get("exploded_delta", 0) < 1:
        failures.append({"reason": "explosion_not_observed", **actions})
    if actions.get("reloads", 0) < 1:
        failures.append({"reason": "reload_not_observed", **actions})
    return failures


def validate_arsenal_actions(rows: list[dict]) -> list[dict]:
    failures = []
    by_key = {row.get("key"): row for row in rows}
    for key in NEW_WEAPON_KEYS:
        row = by_key.get(key)
        if not row:
            failures.append({"weapon": key, "reason": "weapon_not_exercised"})
            continue
        if row.get("selected") != key:
            failures.append({"weapon": key, "reason": "weapon_not_selected"})
        before = row.get("ammo_before")
        after = row.get("ammo_after")
        if (
            not _finite_number(before)
            or not _finite_number(after)
            or after >= before
        ):
            failures.append({"weapon": key, "reason": "ammo_not_consumed"})
        expected = 8 if key == "sw" else 1
        if row.get("fired_delta", 0) < expected:
            failures.append({"weapon": key, "reason": "projectile_not_observed"})
        if not row.get("model_ready"):
            failures.append({"weapon": key, "reason": "weapon_model_not_ready"})
        if row.get("impact_delta", 0) < 1 or row.get("impact_kind") not in {
            "structure", "terrain", "boundary", "target",
        }:
            failures.append({"weapon": key, "reason": "weapon_impact_not_observed"})
        if row.get("projectiles") != 0:
            failures.append({"weapon": key, "reason": "projectile_cleanup"})
        if (
            row.get("effect_emitted_delta", 0) < 1
            or row.get("effect_draw_batches") != 5
            or row.get("effect_peak", 0) > row.get("effect_budget", -1)
        ):
            failures.append({"weapon": key, "reason": "weapon_effect_not_observed"})
    return failures


def cdp_click(cdp, selector: str) -> bool:
    """Click a visible element through CDP input, rather than synthetic counters."""
    box = cdp.eval(
        "(() => { const e=document.querySelector("
        f"{json.dumps(selector)}"
        "); if (!e) return null; const r=e.getBoundingClientRect();"
        " return r.width > 0 && r.height > 0 ? {x:r.left+r.width/2,y:r.top+r.height/2} : null; })()"
    )
    if not box:
        return False
    for event_type in ("mousePressed", "mouseReleased"):
        cdp.send("Input.dispatchMouseEvent", {
            "type": event_type,
            "x": box["x"],
            "y": box["y"],
            "button": "left",
            "clickCount": 1,
        })
    return True


def aim_fire_control_at_ground(cdp) -> bool:
    """Use the real FPV gimbal control so each fire click can reach terrain."""
    return bool(cdp.eval("""(() => {
      const control = document.querySelector('#vl-gimbal-range');
      if (!control) return false;
      control.value = control.min;
      control.dispatchEvent(new Event('input', {bubbles:true}));
      return control.value === control.min;
    })()"""))


def _wait_for_world_ready(cdp, timeout: int) -> dict | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        cdp.pump(0.25)
        try:
            ready = cdp.eval(
                "(() => { const r=window.__volar;"
                " return r?.done && r?.customDrone"
                " && r?.collision?.radius_source === 'glb' ? r : null; })()"
            )
        except RuntimeError:
            continue
        if ready:
            return ready
    return None


def _weapon_counts(cdp) -> dict:
    return cdp.eval(
        "(() => { const w=window.__volar?.weapons || {}; return {"
        "fired:w.fired || 0, exploded:w.exploded || 0}; })()"
    ) or {"fired": 0, "exploded": 0}


def _arsenal_sample(cdp, key: str) -> dict:
    return cdp.eval(
        "(() => {"
        f" const key={json.dumps(key)};"
        " const r=window.__volar || {};"
        " const w=r.weapons || {};"
        " const state=r.weaponState || {};"
        " const fired=w.fired_projectiles || {};"
        " const models=w.models || {};"
        " const effects=w.effects || {};"
        " const impacts=(w.structure_hits||0)+(w.terrain_hits||0)"
        " +(w.boundary_hits||0)+(w.item_hits||0)+(w.target_hits||0);"
        " return {selected:state.weapon||null, ammo:state.ammo?.[key],"
        " fired:fired[key]||0, impacts,"
        " impactKind:w.impact?.kind||null,"
        " modelReady:(models.ready||[]).includes(key),"
        " modelTier:models.tier||null, projectiles:w.projectiles||0,"
        " effectEmitted:effects.emitted||0, effectPeak:effects.peak||0,"
        " effectBudget:effects.budget?.active||0,"
        " effectDrawBatches:effects.drawBatches||0};"
        " })()"
    ) or {}


def exercise_weapon_arsenal(cdp, timeout: int = 20) -> list[dict]:
    """Select and fire all new weapons through the real HUD controls."""
    rows = []
    for key in NEW_WEAPON_KEYS:
        # Desktop exposes the combat-panel grid. Coarse layouts expose the
        # compact picker. Always drive whichever real control is visible.
        selected = cdp_click(cdp, f'#vl-weps button[data-w="{key}"]')
        if not selected:
            if cdp_click(cdp, "#vl-weapon-toggle"):
                selected = cdp_click(
                    cdp, f'#vl-weapon-picker button[data-w="{key}"]')
        if not selected:
            rows.append({"key": key, "error": "weapon_option_missing"})
            continue
        deadline = time.time() + timeout
        before = {}
        while time.time() < deadline:
            cdp.pump(0.1)
            before = _arsenal_sample(cdp, key)
            if before.get("selected") == key and before.get("modelReady"):
                break
        if before.get("selected") != key or not before.get("modelReady"):
            rows.append({
                "key": key,
                "selected": before.get("selected"),
                "model_ready": before.get("modelReady", False),
                "error": "weapon_selection_timeout",
            })
            continue
        fired = cdp_click(cdp, "#vl-trigger")
        if not fired:
            fired = cdp_click(cdp, "#vl-fire")
        if not fired:
            rows.append({"key": key, "error": "weapon_trigger_missing"})
            continue
        cdp.pump(0.08)
        immediate = _arsenal_sample(cdp, key)
        cdp.pump(WEAPON_SETTLE_SECONDS[key])
        after = _arsenal_sample(cdp, key)
        rows.append({
            "key": key,
            "selected": after.get("selected"),
            "ammo_before": before.get("ammo"),
            "ammo_after": immediate.get("ammo"),
            "fired_delta": (after.get("fired") or 0) - (before.get("fired") or 0),
            "impact_delta": (
                (after.get("impacts") or 0) - (before.get("impacts") or 0)
            ),
            "impact_kind": after.get("impactKind"),
            "model_ready": after.get("modelReady", False),
            "model_tier": after.get("modelTier"),
            "projectiles": after.get("projectiles"),
            "effect_emitted_delta": (
                (after.get("effectEmitted") or 0)
                - (before.get("effectEmitted") or 0)
            ),
            "effect_peak": after.get("effectPeak"),
            "effect_budget": after.get("effectBudget"),
            "effect_draw_batches": after.get("effectDrawBatches"),
        })
    return rows


def _live_sample(cdp) -> dict:
    return cdp.eval(
        "(() => { const r=window.__volar; return {"
        "ok:r?.ok, fps:r?.fps, errors:[...(r?.errors||[])],"
        "classification:r?.collision?.structure,"
        "collisionReady:r?.collision?.ready,"
        "collisionRadius:r?.collision?.radius_m,"
        "collisionRadiusSource:r?.collision?.radius_source,"
        "customDrone:r?.customDrone,"
        "cameraRig:r?.camera?.rig,"
        "cameraCollisionChecks:r?.camera?.collision_checks,"
        "cameraCollisionHits:r?.camera?.collision_hits,"
        "hitCoordinates:r?.pos,"
        "groups:r?.lifecycle?.groups,"
        "disposedStaleLoads:r?.lifecycle?.disposedStaleLoads,"
        "representation:r?.representation,"
        "projectiles:r?.weapons?.projectiles,"
        "effects:r?.weapons?.effects,"
        "fired:r?.weapons?.fired, exploded:r?.weapons?.exploded,"
        "memory:r?.rendererMemory"
        "}; })()"
    )


def requires_structural_collision(cid: str) -> bool:
    path = VAULT / "models" / cid / "scene.v2.json"
    try:
        manifest = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise RuntimeError(f"manifest de mundo inválido para {cid}: {error}") from error
    return bool((manifest.get("capabilities") or {}).get("mesh"))


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
            f"?m={urllib.parse.quote(cid)}&autotest=1&rig=0"
        )
        cdp.send("Page.navigate", {"url": url})
        ready = _wait_for_world_ready(cdp, timeout)
        if not ready:
            raise RuntimeError(
                f"mundo vivo no terminó en {timeout}s · console={cdp.errors[:6]}"
            )
        needs_structure = requires_structural_collision(cid)
        camera_integration = _live_sample(cdp)
        camera_integration["run"] = "camera:muycerca"

        fpv_url = (
            f"{base_url.rstrip('/')}/volar.html"
            f"?m={urllib.parse.quote(cid)}&autotest=1&rig=3"
        )
        cdp.send("Page.navigate", {"url": fpv_url})
        if not _wait_for_world_ready(cdp, timeout):
            raise RuntimeError(
                f"FPV vivo no terminó en {timeout}s · console={cdp.errors[:6]}"
            )
        if not aim_fire_control_at_ground(cdp):
            raise RuntimeError("control de gimbal no disponible para stress de fuego")

        samples = []
        actions = {"attempts": 0, "fired_delta": 0, "exploded_delta": 0, "reloads": 0}
        generation = 1
        previous_weapon_counts = _weapon_counts(cdp)
        reload_every = max(1, stress // 4)
        for index in range(stress):
            if not cdp_click(cdp, "#vl-fire"):
                failures = [{"run": index + 1, "reason": "fire_control_missing"}]
                break
            actions["attempts"] += 1
            cdp.pump(0.15)
            sample = _live_sample(cdp)
            sample["run"] = index + 1
            sample["generation"] = generation
            samples.append(sample)
            weapon_counts = {
                "fired": sample.get("fired") or 0,
                "exploded": sample.get("exploded") or 0,
            }
            actions["fired_delta"] += max(
                0, weapon_counts["fired"] - previous_weapon_counts["fired"])
            actions["exploded_delta"] += max(
                0, weapon_counts["exploded"] - previous_weapon_counts["exploded"])
            previous_weapon_counts = weapon_counts
            if (index + 1) % reload_every == 0:
                cdp.pump(3)
                settled = _weapon_counts(cdp)
                actions["fired_delta"] += max(
                    0, settled["fired"] - previous_weapon_counts["fired"])
                actions["exploded_delta"] += max(
                    0, settled["exploded"] - previous_weapon_counts["exploded"])
                cdp.send("Page.reload")
                if not _wait_for_world_ready(cdp, timeout):
                    failures = [{"run": index + 1, "reason": "reload_timeout"}]
                    break
                actions["reloads"] += 1
                generation += 1
                if not aim_fire_control_at_ground(cdp):
                    failures = [{"run": index + 1, "reason": "gimbal_control_missing"}]
                    break
                for phase, delay in (("reload", 0), ("settled", 0.5)):
                    cdp.pump(delay)
                    post_reload = _live_sample(cdp)
                    post_reload["run"] = f"{index + 1}:{phase}"
                    post_reload["generation"] = generation
                    samples.append(post_reload)
                previous_weapon_counts = _weapon_counts(cdp)

        else:
            failures = []
        failures.extend(validate_live_sample(
            camera_integration,
            requires_structural_collision=needs_structure,
            expected_camera_rig="muycerca",
        ))
        for sample in samples:
            failures.extend(validate_live_sample(
                sample,
                requires_structural_collision=needs_structure,
                expected_camera_rig="fpv",
            ))
        failures.extend(validate_stress_actions(actions))

        for current_generation in range(1, generation + 1):
            memories = [
                row.get("memory") or {} for row in samples
                if row.get("generation") == current_generation
            ]
            for key in ("geometries", "textures"):
                values = [int(row.get(key, 0)) for row in memories]
                if values and values[-1] > values[0]:
                    failures.append({
                        "run": stress,
                        "generation": current_generation,
                        "reason": f"renderer_{key}_growth",
                        "first": values[0],
                        "last": values[-1],
                    })

        cdp.send("Page.navigate", {"url": fpv_url})
        ready = _wait_for_world_ready(cdp, timeout)
        fpv_camera = None
        arsenal = []
        if ready:
            arsenal = exercise_weapon_arsenal(cdp)
            failures.extend(validate_arsenal_actions(arsenal))
            fpv_camera = cdp.eval(
                "(() => { const r=window.__volar; return {cameraRig:r.camera?.rig,"
                " cameraCollisionChecks:r.camera?.collision_checks,"
                " cameraCollisionHits:r.camera?.collision_hits}; })()"
            )
        if not fpv_camera:
            failures.append({"run": stress, "reason": "fpv_camera_timeout"})
            fpv_camera = {}
        else:
            failures.extend(validate_fpv_camera(fpv_camera))
        if cdp.errors:
            failures.append({"run": stress, "reason": "console", "errors": cdp.errors[:6]})
        report = {
            "ok": not failures,
            "clip_id": cid,
            "stress_runs": stress,
            "failures": failures,
            "actions": actions,
            "camera_integration": camera_integration,
            "samples": samples,
            "fpv_camera": fpv_camera,
            "arsenal": arsenal,
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
