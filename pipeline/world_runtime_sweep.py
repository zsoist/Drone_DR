#!/usr/bin/env python3
"""Open every active World in Chrome and fail closed on runtime drift."""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.parse

import audit_world
from browser_gate import DEFAULT_BASE_URL, launch_chrome, new_page


def _failure(cid: str, reason: str, **detail) -> dict:
    return {"clip_id": cid, "reason": reason, **detail}


def validate_world_runtime(
    cid: str,
    report: dict,
    resources: dict,
    *,
    requires_structural_collision: bool = True,
) -> list[dict]:
    failures = []
    if not report.get("ok"):
        failures.append(_failure(cid, "autotest_failed"))
    fps = report.get("fps")
    if not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps < 50:
        failures.append(_failure(cid, "fps_below_50", fps=fps))
    if report.get("errors"):
        failures.append(_failure(cid, "runtime_errors", errors=report["errors"][:8]))
    if not report.get("customDrone"):
        failures.append(_failure(cid, "custom_drone_missing"))

    collision = report.get("collision") or {}
    if not collision.get("ready") or (
            requires_structural_collision and not collision.get("structure")):
        failures.append(_failure(cid, "world_collision_not_ready", collision=collision))
    if collision.get("radius_source") != "glb":
        failures.append(_failure(
            cid, "drone_envelope_not_glb", source=collision.get("radius_source")))

    lifecycle = report.get("lifecycle") or {}
    if lifecycle.get("groups") != 1:
        failures.append(_failure(cid, "scene_group_leak", groups=lifecycle.get("groups")))
    if lifecycle.get("disposedStaleLoads") != 0:
        failures.append(_failure(
            cid, "stale_load_disposal", count=lifecycle.get("disposedStaleLoads")))

    representation = report.get("representation") or {}
    preferred = representation.get("preferred")
    active = representation.get("active")
    layers = set(representation.get("visibleStructuralLayers") or [])
    if "mesh" in layers and "splat" in layers:
        failures.append(_failure(
            cid, "duplicate_structural_layers", layers=sorted(layers)))
    if preferred != "mesh" and (
            report.get("visualMesh")
            or report.get("visualMeshState") not in {"deferred", "unavailable"}
            or resources.get("mesh_obj_requests", 0) != 0):
        failures.append(_failure(
            cid,
            "inactive_mesh_loaded",
            state=report.get("visualMeshState"),
                requests=resources.get("mesh_obj_requests", 0),
        ))
    if preferred == "terrain" and active != "terrain":
        failures.append(_failure(
            cid, "terrain_preference_not_active", active=active))
    if preferred == "mesh" and (
            active != "mesh"
            or not report.get("visualMesh")
            or not report.get("visualMeshCoverageClipped")):
        failures.append(_failure(
            cid,
            "preferred_mesh_inactive",
            active=active,
            visual_mesh=report.get("visualMesh"),
            coverage_clipped=report.get("visualMeshCoverageClipped"),
        ))
    if report.get("visualMesh") and not report.get("visualMeshCoverageClipped"):
        failures.append(_failure(cid, "visual_mesh_unclipped"))
    return failures


def _runtime_snapshot(
    cdp,
    timeout: int,
    *,
    require_mesh: bool = False,
) -> tuple[dict, dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        cdp.pump(0.25)
        try:
            value = cdp.eval("""(() => {
              const r = window.__volar;
              if (!r?.done) return null;
              if (""" + ("true" if require_mesh else "false") + """
                  && !(r.visualMesh && r.visualMeshCoverageClipped
                       && r.representation?.active === 'mesh')) return null;
              return {
                ok:r.ok, fps:r.fps, errors:[...(r.errors || [])],
                customDrone:r.customDrone, visualMesh:r.visualMesh,
                visualMeshState:r.visualMeshState,
                visualMeshCoverageClipped:r.visualMeshCoverageClipped,
                collision:r.collision, lifecycle:r.lifecycle,
                representation:r.representation,
              };
            })()""")
        except RuntimeError:
            continue
        if value:
            resources = cdp.eval("""(() => ({
              mesh_obj_requests: performance.getEntriesByType('resource')
                .filter(e => /odm_textured_model_viewer\\.obj(?:\\?|$)/.test(e.name)).length
            }))()""")
            return value, resources
    raise RuntimeError(f"World no terminó en {timeout}s")


def _activate_preferred_mesh(cdp, timeout: int) -> tuple[dict, dict]:
    requested = cdp.eval("""(() => {
      const r = window.__volar;
      const button = document.querySelector('#vl-vista');
      for (let attempt = 0; attempt < 3
           && r?.representation?.requested !== 'mesh'; attempt += 1) {
        button?.click();
      }
      return r?.representation?.requested;
    })()""")
    if requested != "mesh":
        raise RuntimeError(f"no se pudo solicitar la malla preferida: {requested!r}")
    return _runtime_snapshot(cdp, timeout, require_mesh=True)


def run_sweep(
    *,
    base_url: str = DEFAULT_BASE_URL,
    timeout_per_world: int = 45,
    only: list[str] | None = None,
) -> dict:
    disk_audit = audit_world.audit(active_only=True)
    if not disk_audit["ok"]:
        return {
            "ok": False,
            "worlds": [],
            "failures": disk_audit["failures"],
            "disk_audit": disk_audit,
        }
    candidates = [
        row for row in disk_audit["worlds"]
        if row.get("terrain") and row.get("collision")
    ]
    if only:
        requested = set(only)
        candidates = [row for row in candidates if row["clip_id"] in requested]
        missing = sorted(requested - {row["clip_id"] for row in candidates})
        if missing:
            return {
                "ok": False,
                "worlds": [],
                "failures": [
                    _failure(cid, "active_world_not_found") for cid in missing
                ],
                "disk_audit": disk_audit,
            }

    proc, profile, port = launch_chrome()
    cdp = None
    worlds = []
    failures = []
    try:
        cdp = new_page(port)
        for candidate in candidates:
            cid = candidate["clip_id"]
            cdp.errors.clear()
            cdp.warnings.clear()
            url = (
                f"{base_url.rstrip('/')}/volar.html"
                f"?m={urllib.parse.quote(cid)}&autotest=1&rig=0"
            )
            cdp.send("Page.navigate", {"url": url})
            try:
                report, resources = _runtime_snapshot(cdp, timeout_per_world)
                if (report.get("representation") or {}).get("preferred") == "mesh":
                    report, resources = _activate_preferred_mesh(
                        cdp, timeout_per_world)
            except RuntimeError as error:
                failures.append(_failure(cid, "runtime_timeout", error=str(error)))
                continue
            row_failures = validate_world_runtime(
                cid,
                report,
                resources,
                requires_structural_collision=bool(candidate.get("mesh")),
            )
            if cdp.errors:
                row_failures.append(_failure(
                    cid, "browser_console_errors", errors=cdp.errors[:8]))
            deprecated = [
                warning for warning in cdp.warnings
                if "maxLeafTris" in warning or "maxLeafSize" in warning
            ]
            if deprecated:
                row_failures.append(_failure(
                    cid, "deprecated_bvh_api", warnings=deprecated[:8]))
            worlds.append({
                "clip_id": cid,
                "ok": not row_failures,
                "fps": report.get("fps"),
                "preferred": (report.get("representation") or {}).get("preferred"),
                "active": (report.get("representation") or {}).get("active"),
                "visual_mesh_state": report.get("visualMeshState"),
                "mesh_obj_requests": resources.get("mesh_obj_requests", 0),
            })
            failures.extend(row_failures)
    finally:
        if cdp:
            cdp.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        profile.cleanup()
    return {
        "ok": not failures and len(worlds) == len(candidates),
        "worlds": worlds,
        "failures": failures,
        "disk_audit": {"ok": True, "count": len(disk_audit["worlds"])},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--timeout-per-world", type=int, default=45)
    parser.add_argument("--cid", action="append")
    args = parser.parse_args()
    result = run_sweep(
        base_url=args.base_url,
        timeout_per_world=args.timeout_per_world,
        only=args.cid,
    )
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
