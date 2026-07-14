"""Stable real-world scenes with immutable reconstruction-version membership."""

import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path


SCENES_DIR = Path("/Volumes/SSD/drone-vault/manifest/scenes")
_LOCK = threading.RLock()
_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
ALTITUDE_BANDS_M = (100, 200, 400, 600, 1000)
SOURCE_STATUSES = {"integrated", "eligible", "duplicate", "insufficient_overlap",
                   "registration_failed"}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _unique(values) -> list[str]:
    out = []
    for value in values or []:
        value = str(value).strip()
        if value and value not in out:
            out.append(value)
    return out


def altitude_band(altitude_m) -> int:
    """Bucket measured capture altitude without treating it as map coverage."""
    try:
        altitude = max(0.0, float(altitude_m or 0))
    except (TypeError, ValueError):
        altitude = 0.0
    return min(ALTITUDE_BANDS_M, key=lambda target: (abs(target - altitude), target))


def _evidence(row: dict) -> dict:
    row = row if isinstance(row, dict) else {}
    clip_id = _validate_id(row.get("clip_id"), "source")
    try:
        altitude = round(float(row.get("altitude_m") or 0), 1)
    except (TypeError, ValueError):
        altitude = 0.0
    status = str(row.get("status") or "eligible")
    if status not in SOURCE_STATUSES:
        status = "eligible"
    out = {
        "clip_id": clip_id,
        "altitude_m": altitude,
        "altitude_band_m": altitude_band(altitude),
        "status": status,
    }
    for key in ("capture_at", "coverage_bbox", "distance_m", "reason", "last_version",
                "submitted", "registered", "registration_ratio", "attempts"):
        if row.get(key) is not None:
            out[key] = row[key]
    return out


def _merge_evidence(existing, incoming) -> list[dict]:
    rows = {row.get("clip_id"): dict(row) for row in existing or []
            if isinstance(row, dict) and row.get("clip_id")}
    order = [row.get("clip_id") for row in existing or []
             if isinstance(row, dict) and row.get("clip_id")]
    for raw in incoming or []:
        row = _evidence(raw)
        clip_id = row["clip_id"]
        if clip_id not in order:
            order.append(clip_id)
        previous = rows.get(clip_id, {})
        # A later measured record may enrich an old inventory row. Registration
        # status only changes through record_contributions(), not mere discovery.
        if previous.get("status") in ("integrated", "registration_failed"):
            row["status"] = previous["status"]
            if previous.get("reason") and not row.get("reason"):
                row["reason"] = previous["reason"]
        rows[clip_id] = {**previous, **row}
    return [rows[clip_id] for clip_id in order if clip_id in rows]


def _validate_id(value: str, kind: str) -> str:
    value = str(value or "")
    if not _ID_RE.fullmatch(value):
        raise ValueError(f"invalid {kind} id")
    return value


def _path(scene_id: str) -> Path:
    scene_id = _validate_id(scene_id, "scene")
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    return SCENES_DIR / f"{scene_id}.json"


def _write(scene: dict):
    path = _path(scene["id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(scene, ensure_ascii=False, indent=1))
    os.replace(tmp, path)


def get_scene(scene_id: str) -> dict:
    path = _path(scene_id)
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise KeyError(f"scene not found: {scene_id}")
    except ValueError as exc:
        raise ValueError(f"corrupt scene manifest: {scene_id}") from exc


def list_scenes() -> list[dict]:
    if not SCENES_DIR.exists():
        return []
    rows = []
    for path in SCENES_DIR.glob("scene_*.json"):
        try:
            rows.append(json.loads(path.read_text()))
        except (OSError, ValueError):
            continue
    return sorted(rows, key=lambda item: item.get("updated_at", ""), reverse=True)


def model_metrics(meta: dict) -> dict:
    """Truthful requested/effective provenance for a scene-version summary."""
    meta = meta if isinstance(meta, dict) else {}
    qa = meta.get("qa") or {}
    recon = meta.get("reconstruction") or {}
    metrics = {
        "cameras_reconstructed": qa.get("cameras_reconstructed"),
        "cameras_total": qa.get("cameras_total"),
        "sparse_points": qa.get("sparse_points"),
        "gsd_cm_px": qa.get("gsd_cm_px"),
        "area_m2": qa.get("area_m2"),
        "pipeline_mode": meta.get("pipeline_mode") or qa.get("status"),
        "requested_preset": recon.get("requested_preset") or meta.get("preset_requested"),
        "effective_preset": recon.get("effective_preset") or meta.get("preset"),
        "dense_quality_requested": meta.get("dense_quality_requested"),
        "dense_quality": meta.get("dense_quality"),
    }
    runs = recon.get("splat_runs") or []
    if runs:
        latest = runs[-1]
        metrics["splat"] = {key: latest.get(key) for key in
                            ("job_id", "requested_preset", "effective_preset", "input_scale",
                             "target_iters", "final_loss", "peak_mib", "mem_cap_mib",
                             "backend", "fallback") if latest.get(key) is not None}
    return {key: value for key, value in metrics.items() if value is not None}


def create_scene(title: str, anchor: dict | None, sources=None, photos=None,
                 source_evidence=None) -> dict:
    title = str(title or "Escena").strip()[:80] or "Escena"
    anchor = anchor if isinstance(anchor, dict) else {}
    try:
        lat = round(float(anchor.get("lat")), 6)
        lon = round(float(anchor.get("lon")), 6)
    except (TypeError, ValueError):
        lat = lon = None
    key = f"{title.casefold()}|{lat}|{lon}"
    scene_id = "scene_" + hashlib.sha1(key.encode()).hexdigest()[:10]
    with _LOCK:
        path = _path(scene_id)
        if path.exists():
            scene = get_scene(scene_id)
            scene["schema"] = max(2, int(scene.get("schema") or 1))
            inv = scene.setdefault("source_inventory", {"videos": [], "photos": []})
            inv["videos"] = _unique([*inv.get("videos", []), *_unique(sources)])
            inv["photos"] = _unique([*inv.get("photos", []), *_unique(photos)])
            scene["source_evidence"] = _merge_evidence(scene.get("source_evidence"), source_evidence)
            scene["updated_at"] = _now()
            _write(scene)
            return scene
        now = _now()
        scene = {
            "schema": 2,
            "id": scene_id,
            "title": title,
            "anchor": {"lat": lat, "lon": lon} if lat is not None and lon is not None else {},
            "created_at": now,
            "updated_at": now,
            "active_version": None,
            "source_inventory": {"videos": _unique(sources), "photos": _unique(photos)},
            "source_evidence": _merge_evidence([], source_evidence),
            "versions": [],
        }
        _write(scene)
        return scene


def add_version(scene_id: str, reconstruction_id: str, sources, photos,
                status: str = "processing", *, merge_label: str | None = None,
                required_artifacts_ok: bool = False, metrics: dict | None = None,
                source_evidence=None) -> dict:
    reconstruction_id = _validate_id(reconstruction_id, "reconstruction")
    sources = _unique(sources)
    photos = _unique(photos)
    with _LOCK:
        scene = get_scene(scene_id)
        existing = next((v for v in scene["versions"] if v["id"] == reconstruction_id), None)
        if existing:
            if existing.get("sources") != sources or existing.get("photos") != photos:
                raise ValueError("version source membership is immutable")
            return existing
        version = {
            "id": reconstruction_id,
            "created_at": _now(),
            "status": status,
            "sources": sources,
            "photos": photos,
            "merge_label": merge_label,
            "required_artifacts_ok": bool(required_artifacts_ok),
            "metrics": metrics or {},
        }
        evidence = _merge_evidence(scene.get("source_evidence"), source_evidence)
        version["source_evidence"] = [dict(row) for row in evidence
                                      if row.get("clip_id") in sources]
        version["altitude_bands_m"] = sorted({row["altitude_band_m"]
                                               for row in version["source_evidence"]})
        scene["versions"].append(version)
        inv = scene.setdefault("source_inventory", {"videos": [], "photos": []})
        inv["videos"] = _unique([*inv.get("videos", []), *sources])
        inv["photos"] = _unique([*inv.get("photos", []), *photos])
        scene["schema"] = max(2, int(scene.get("schema") or 1))
        scene["source_evidence"] = evidence
        scene["updated_at"] = _now()
        _write(scene)
        return version


def update_version(scene_id: str, reconstruction_id: str, **fields) -> dict:
    allowed = {"status", "merge_label", "required_artifacts_ok", "metrics", "artifact",
               "requested_preset", "effective_preset", "completed_at", "job_id",
               "contributions", "effective_sources", "dropped_sources", "altitude_products",
               "coverage_products"}
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"unknown version fields: {sorted(unknown)}")
    with _LOCK:
        scene = get_scene(scene_id)
        version = next((v for v in scene["versions"] if v["id"] == reconstruction_id), None)
        if not version:
            raise KeyError(f"version not found: {reconstruction_id}")
        version.update(fields)
        scene["updated_at"] = _now()
        _write(scene)
        return version


def update_source_evidence(scene_id: str, rows) -> dict:
    with _LOCK:
        scene = get_scene(scene_id)
        scene["schema"] = max(2, int(scene.get("schema") or 1))
        scene["source_evidence"] = _merge_evidence(scene.get("source_evidence"), rows)
        scene["updated_at"] = _now()
        _write(scene)
        return scene


def record_contributions(scene_id: str, reconstruction_id: str, contributions) -> dict:
    """Persist actual per-video registration without rewriting requested membership."""
    with _LOCK:
        scene = get_scene(scene_id)
        version = next((v for v in scene["versions"] if v["id"] == reconstruction_id), None)
        if not version:
            raise KeyError(f"version not found: {reconstruction_id}")
        membership_order = list(version.get("sources") or [])
        membership = set(membership_order)
        normalized = []
        evidence_by_id = {row.get("clip_id"): dict(row)
                          for row in scene.get("source_evidence") or []}
        for raw in contributions or []:
            clip_id = _validate_id(raw.get("clip_id"), "source")
            if clip_id not in membership:
                raise ValueError("contribution is outside immutable version membership")
            submitted = max(0, int(raw.get("submitted") or 0))
            registered = max(0, int(raw.get("registered") or 0))
            merged = bool(raw.get("merged"))
            reason = str(raw.get("reason") or ("registered in shared component" if merged
                                                else "no shared registration component"))
            contribution = {"clip_id": clip_id, "submitted": submitted,
                            "registered": registered, "merged": merged, "reason": reason}
            if submitted:
                contribution["registration_ratio"] = round(registered / submitted, 4)
            normalized.append(contribution)
            row = evidence_by_id.get(clip_id, _evidence({"clip_id": clip_id}))
            attempt = {"version_id": reconstruction_id, "at": _now(), **contribution}
            row["attempts"] = [*(row.get("attempts") or []), attempt][-12:]
            row.update({"status": "integrated" if merged else "registration_failed",
                        "reason": reason, "last_version": reconstruction_id,
                        "submitted": submitted, "registered": registered})
            if submitted:
                row["registration_ratio"] = contribution["registration_ratio"]
            evidence_by_id[clip_id] = row
        order = [row.get("clip_id") for row in scene.get("source_evidence") or []]
        order.extend(cid for cid in membership_order if cid not in order)
        scene["source_evidence"] = [evidence_by_id[cid] for cid in order if cid in evidence_by_id]
        version["contributions"] = normalized
        version["effective_sources"] = [row["clip_id"] for row in normalized if row["merged"]]
        version["dropped_sources"] = [row["clip_id"] for row in normalized if not row["merged"]]
        scene["updated_at"] = _now()
        _write(scene)
        return version


def promote(scene_id: str, reconstruction_id: str) -> dict:
    with _LOCK:
        scene = get_scene(scene_id)
        version = next((v for v in scene["versions"] if v["id"] == reconstruction_id), None)
        if not version:
            raise KeyError(f"version not found: {reconstruction_id}")
        if version.get("status") != "ready":
            raise ValueError("only a ready version can be promoted")
        if version.get("merge_label") not in ("SINGLE", "FULL"):
            raise ValueError("partial source registration cannot be promoted")
        if not version.get("required_artifacts_ok"):
            raise ValueError("required artifacts are missing")
        scene["active_version"] = reconstruction_id
        scene["updated_at"] = _now()
        _write(scene)
        return scene
