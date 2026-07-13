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


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _unique(values) -> list[str]:
    out = []
    for value in values or []:
        value = str(value).strip()
        if value and value not in out:
            out.append(value)
    return out


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


def create_scene(title: str, anchor: dict | None, sources=None, photos=None) -> dict:
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
            inv = scene.setdefault("source_inventory", {"videos": [], "photos": []})
            inv["videos"] = _unique([*inv.get("videos", []), *_unique(sources)])
            inv["photos"] = _unique([*inv.get("photos", []), *_unique(photos)])
            scene["updated_at"] = _now()
            _write(scene)
            return scene
        now = _now()
        scene = {
            "schema": 1,
            "id": scene_id,
            "title": title,
            "anchor": {"lat": lat, "lon": lon} if lat is not None and lon is not None else {},
            "created_at": now,
            "updated_at": now,
            "active_version": None,
            "source_inventory": {"videos": _unique(sources), "photos": _unique(photos)},
            "versions": [],
        }
        _write(scene)
        return scene


def add_version(scene_id: str, reconstruction_id: str, sources, photos,
                status: str = "processing", *, merge_label: str | None = None,
                required_artifacts_ok: bool = False, metrics: dict | None = None) -> dict:
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
        scene["versions"].append(version)
        inv = scene.setdefault("source_inventory", {"videos": [], "photos": []})
        inv["videos"] = _unique([*inv.get("videos", []), *sources])
        inv["photos"] = _unique([*inv.get("photos", []), *photos])
        scene["updated_at"] = _now()
        _write(scene)
        return version


def update_version(scene_id: str, reconstruction_id: str, **fields) -> dict:
    allowed = {"status", "merge_label", "required_artifacts_ok", "metrics", "artifact",
               "requested_preset", "effective_preset", "completed_at", "job_id"}
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
