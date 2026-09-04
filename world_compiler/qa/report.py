"""Machine-readable and human-readable acceptance reports."""

from __future__ import annotations

from pathlib import Path

from world_compiler.ids import canonical_json


def acceptance_verdict(compiler_passes: bool, unreal_status: str, performance_passes: bool) -> str:
    if not compiler_passes:
        return "blocked"
    if unreal_status == "passed" and performance_passes:
        return "accepted"
    return "partially accepted"


def write_acceptance_report(root: Path, metrics: dict) -> str:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    verdict = acceptance_verdict(
        bool(metrics.get("compiler_passes")),
        str(metrics.get("unreal_status") or "unmeasured"),
        bool((metrics.get("performance") or {}).get("passes")),
    )
    document = dict(metrics) | {"verdict": verdict}
    (root / "metrics.json").write_bytes(canonical_json(document) + b"\n")
    geometry = document.get("geometry") or {}
    performance = document.get("performance") or {}
    provenance = document.get("provenance") or {}
    route_coverage = provenance.get("route_coverage_pct") or {}
    materials = document.get("materials") or {}
    blockers = document.get("blockers") or []
    route_rows = ", ".join(
        f"{name}={value}%" for name, value in sorted(route_coverage.items())
    ) or "unmeasured"
    blocker_rows = "\n".join(f"  - {value}" for value in blockers) or "  - none"
    markdown = f"""# Hero Cell R0 acceptance

Verdict: **{verdict}**

- Hero ID: {document.get('hero_id')}
- Scene/version: {document.get('scene_id')} / {document.get('version_id')}
- Compiler gates: {'pass' if document.get('compiler_passes') else 'fail'}
- Unreal gate: {document.get('unreal_status')}
- Geometry median/p95: {geometry.get('median_m')} / {geometry.get('p95_m')} m
- Source silhouette proxy IoU: {(geometry.get('source_silhouette_proxy') or {}).get('median_iou')}
- Route-weighted provenance: {route_rows}
- Materials: {materials.get('status')}; Unreal relighting validated={materials.get('unreal_relighting_validated')}
- RTX avg/1% low/VRAM: {performance.get('avg_fps')} / {performance.get('one_percent_low_fps')} / {performance.get('vram_mib')} MiB
- Route completed: {performance.get('route_completed')}

## Blockers

{blocker_rows}
"""
    (root / "acceptance.md").write_text(markdown, encoding="utf-8")
    return verdict
