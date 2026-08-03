#!/usr/bin/env python3
"""Reversible geospatial AOI derivation for an existing AeroBrain scene.

The pure geometry helpers are intentionally independent from GDAL/PDAL so their
coordinate and retention contracts can be tested without the heavyweight ODM
container.  The publishing CLI is added below those helpers.
"""
from __future__ import annotations

import math
import os
import json
import hashlib
import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np


SPLAT_RECORD_BYTES = 32
CID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_nerfstudio_normalization_contract(
    splat_meta: dict,
    colmap_images: Path,
    trainer_config: Path,
) -> dict:
    """Require the exact camera/config evidence used by the CUDA trainer.

    AOI cropping maps Gaussian coordinates back through Nerfstudio's pose
    normalization.  That operation is safe only when both registered cameras
    and the training convention are preserved and hash-verified.
    """
    contract = splat_meta.get("normalization_contract")
    if not isinstance(contract, dict):
        raise ValueError("Gaussian source has no normalization provenance contract")
    expected = {
        "trainer": "nerfstudio-splatfacto",
        "method_name": "splatfacto",
        "assume_colmap_world_coordinate_convention": True,
        "auto_scale_poses": True,
        "center_method": "poses",
        "orientation_method": "up",
        "scale_factor": 1.0,
        "downscale_factor": 1,
        "camera_optimizer": "off",
    }
    for key, value in expected.items():
        if contract.get(key) != value:
            raise ValueError(f"unsupported Nerfstudio normalization contract: {key}")
    if splat_meta.get("trainer") != contract["trainer"]:
        raise ValueError("Gaussian trainer metadata does not match normalization contract")
    for key in ("config_sha256", "colmap_images_sha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", str(contract.get(key, ""))):
            raise ValueError(f"normalization contract has no valid {key}")
    colmap_images = Path(colmap_images)
    trainer_config = Path(trainer_config)
    if _sha256_file(colmap_images) != contract["colmap_images_sha256"]:
        raise ValueError("registered COLMAP cameras do not match training provenance")
    if _sha256_file(trainer_config) != contract["config_sha256"]:
        raise ValueError("Nerfstudio config does not match training provenance")
    config_text = trainer_config.read_text(errors="ignore")
    required_config_lines = (
        r"(?m)^method_name:\s+splatfacto\s*$",
        r"(?m)^\s*assume_colmap_world_coordinate_convention:\s+true\s*$",
        r"(?m)^\s*auto_scale_poses:\s+true\s*$",
        r"(?m)^\s*center_method:\s+poses\s*$",
        r"(?m)^\s*orientation_method:\s+up\s*$",
        r"(?m)^\s*scale_factor:\s+1\.0\s*$",
        r"(?m)^\s*downscale_factor:\s+1\s*$",
        r"(?m)^\s*mode:\s+['\"]?off['\"]?\s*$",
    )
    if not all(re.search(pattern, config_text) for pattern in required_config_lines):
        raise ValueError("Nerfstudio config contents violate the normalization contract")
    return dict(contract)


def validate_cid(value: str) -> str:
    value = str(value or "")
    if not CID_RE.fullmatch(value):
        raise ValueError("scene id must contain only letters, numbers, underscores or hyphens")
    return value


def parse_odm_coords_origin(coords_txt: Path) -> tuple[float, float]:
    """Read the projected origin that ODM subtracts from local mesh geometry."""
    lines = Path(coords_txt).read_text(errors="ignore").splitlines()
    if len(lines) < 2 or lines[0].strip() != "WGS84 UTM 18N":
        raise ValueError("AOI publisher currently requires an ODM WGS84 UTM 18N frame")
    fields = lines[1].split()
    if len(fields) < 2:
        raise ValueError("ODM coords.txt has no projected origin")
    return float(fields[0]), float(fields[1])


def utm18_from_wgs84(latitude: float, longitude: float) -> tuple[float, float]:
    """Project WGS84 latitude/longitude to UTM zone 18N in metres."""
    lat = math.radians(float(latitude))
    lon = math.radians(float(longitude))
    lon0 = math.radians(-75.0)
    a = 6378137.0
    ecc_sq = 0.0066943799901413165
    ecc_prime_sq = ecc_sq / (1.0 - ecc_sq)
    k0 = 0.9996
    n = a / math.sqrt(1.0 - ecc_sq * math.sin(lat) ** 2)
    t = math.tan(lat) ** 2
    c = ecc_prime_sq * math.cos(lat) ** 2
    aa = math.cos(lat) * (lon - lon0)
    m = a * (
        (1 - ecc_sq / 4 - 3 * ecc_sq**2 / 64 - 5 * ecc_sq**3 / 256) * lat
        - (3 * ecc_sq / 8 + 3 * ecc_sq**2 / 32 + 45 * ecc_sq**3 / 1024) * math.sin(2 * lat)
        + (15 * ecc_sq**2 / 256 + 45 * ecc_sq**3 / 1024) * math.sin(4 * lat)
        - (35 * ecc_sq**3 / 3072) * math.sin(6 * lat)
    )
    east = k0 * n * (
        aa + (1 - t + c) * aa**3 / 6
        + (5 - 18 * t + t**2 + 72 * c - 58 * ecc_prime_sq) * aa**5 / 120
    ) + 500000.0
    north = k0 * (
        m + n * math.tan(lat) * (
            aa**2 / 2
            + (5 - t + 9 * c + 4 * c**2) * aa**4 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * ecc_prime_sq) * aa**6 / 720
        )
    )
    if latitude < 0:
        north += 10_000_000.0
    return east, north


def _point_segment_distance(point: np.ndarray, start: np.ndarray, end: np.ndarray) -> float:
    delta = end - start
    denom = float(delta @ delta)
    if denom <= 1e-20:
        return float(np.linalg.norm(point - start))
    amount = max(0.0, min(1.0, float((point - start) @ delta) / denom))
    return float(np.linalg.norm(point - (start + amount * delta)))


def _point_in_triangle(point: np.ndarray, triangle: np.ndarray) -> bool:
    a, b, c = triangle
    v0, v1, v2 = c - a, b - a, point - a
    d00, d01, d02 = float(v0 @ v0), float(v0 @ v1), float(v0 @ v2)
    d11, d12 = float(v1 @ v1), float(v1 @ v2)
    denom = d00 * d11 - d01 * d01
    if abs(denom) <= 1e-20:
        return False
    u = (d11 * d02 - d01 * d12) / denom
    v = (d00 * d12 - d01 * d02) / denom
    return u >= 0.0 and v >= 0.0 and u + v <= 1.0


def circle_intersects_triangle(
    triangle_xy: np.ndarray,
    center_xy: tuple[float, float],
    radius_m: float,
) -> bool:
    """Return true when a 2D triangle overlaps a circle, including edge crossings."""
    triangle = np.asarray(triangle_xy, dtype=float)
    if triangle.shape != (3, 2):
        raise ValueError("triangle_xy must be 3x2")
    center = np.asarray(center_xy, dtype=float)
    radius = float(radius_m)
    if radius <= 0:
        raise ValueError("radius_m must be positive")
    if np.any(np.sum((triangle - center) ** 2, axis=1) <= radius * radius):
        return True
    if _point_in_triangle(center, triangle):
        return True
    return any(
        _point_segment_distance(center, triangle[index], triangle[(index + 1) % 3]) <= radius
        for index in range(3)
    )


def crop_splat_circle(
    source: Path,
    output: Path,
    *,
    normalized_to_local: np.ndarray,
    center_local: tuple[float, float],
    radius_m: float,
    chunk_records: int = 250_000,
) -> dict:
    """Crop standard antimatter15 32-byte splat records by metric XY position."""
    source, output = Path(source), Path(output)
    size = source.stat().st_size
    if size % SPLAT_RECORD_BYTES:
        raise ValueError("splat size is not divisible by 32 bytes")
    matrix = np.asarray(normalized_to_local, dtype=float)
    if matrix.shape != (4, 4):
        raise ValueError("normalized_to_local must be 4x4")
    radius = float(radius_m)
    if radius <= 0:
        raise ValueError("radius_m must be positive")
    count = size // SPLAT_RECORD_BYTES
    records = np.memmap(source, dtype=np.uint8, mode="r", shape=(count, SPLAT_RECORD_BYTES))
    xyz = np.ndarray((count, 3), dtype="<f4", buffer=records, strides=(SPLAT_RECORD_BYTES, 4))
    center = np.asarray(center_local, dtype=float)
    temporary = output.with_name(f".{output.name}.tmp")
    kept = 0
    with temporary.open("wb") as handle:
        for start in range(0, count, chunk_records):
            stop = min(count, start + chunk_records)
            local = xyz[start:stop].astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]
            mask = np.sum((local[:, :2] - center) ** 2, axis=1) <= radius * radius
            selected = np.asarray(records[start:stop][mask])
            handle.write(selected.tobytes())
            kept += int(mask.sum())
    if kept == 0:
        temporary.unlink(missing_ok=True)
        raise ValueError("AOI removed every Gaussian")
    os.replace(temporary, output)
    return {
        "input_gaussians": int(count),
        "output_gaussians": kept,
        "retained_pct": round(100.0 * kept / count, 2),
    }


def _obj_index(value: str, size: int) -> int:
    index = int(value)
    return index - 1 if index > 0 else size + index


def crop_obj_circle(
    source: Path,
    output: Path,
    *,
    center_local: tuple[float, float],
    radius_m: float,
) -> dict:
    """Keep OBJ faces intersecting the AOI and compact referenced indices."""
    source, output = Path(source), Path(output)
    vertices: list[str] = []
    vertex_xyz: list[tuple[float, float, float]] = []
    texcoords: list[str] = []
    normals: list[str] = []
    mtllibs: list[str] = []
    faces: list[tuple[str | None, list[tuple[int, int | None, int | None]]]] = []
    current_material = None
    input_faces = 0
    with source.open(errors="ignore") as source_handle:
        for line in source_handle:
            if line.startswith("v "):
                parts = line.split()
                vertices.append(line)
                vertex_xyz.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith("vt "):
                texcoords.append(line)
            elif line.startswith("vn "):
                normals.append(line)
            elif line.startswith("mtllib "):
                mtllibs.append(line)
            elif line.startswith("usemtl "):
                current_material = line.strip().split(maxsplit=1)[1]
            elif line.startswith("f "):
                input_faces += 1
                refs = []
                for token in line.split()[1:]:
                    parts = token.split("/")
                    vi = _obj_index(parts[0], len(vertices))
                    ti = _obj_index(parts[1], len(texcoords)) if len(parts) > 1 and parts[1] else None
                    ni = _obj_index(parts[2], len(normals)) if len(parts) > 2 and parts[2] else None
                    refs.append((vi, ti, ni))
                points = np.asarray([vertex_xyz[ref[0]][:2] for ref in refs], dtype=float)
                intersects = any(
                    circle_intersects_triangle(points[[0, index, index + 1]], center_local, radius_m)
                    for index in range(1, len(points) - 1)
                )
                if intersects:
                    faces.append((current_material, refs))

    used_v = sorted({ref[0] for _, refs in faces for ref in refs})
    used_t = sorted({ref[1] for _, refs in faces for ref in refs if ref[1] is not None})
    used_n = sorted({ref[2] for _, refs in faces for ref in refs if ref[2] is not None})
    map_v = {old: new for new, old in enumerate(used_v, 1)}
    map_t = {old: new for new, old in enumerate(used_t, 1)}
    map_n = {old: new for new, old in enumerate(used_n, 1)}
    temporary = output.with_name(f".{output.name}.tmp")
    with temporary.open("w") as handle:
        handle.writelines(mtllibs)
        handle.writelines(vertices[index] for index in used_v)
        handle.writelines(texcoords[index] for index in used_t)
        handle.writelines(normals[index] for index in used_n)
        emitted_material = object()
        for material, refs in faces:
            if material != emitted_material:
                if material:
                    handle.write(f"usemtl {material}\n")
                emitted_material = material
            tokens = []
            for vi, ti, ni in refs:
                if ni is not None:
                    tokens.append(f"{map_v[vi]}/{map_t[ti] if ti is not None else ''}/{map_n[ni]}")
                elif ti is not None:
                    tokens.append(f"{map_v[vi]}/{map_t[ti]}")
                else:
                    tokens.append(str(map_v[vi]))
            handle.write("f " + " ".join(tokens) + "\n")
    if not faces:
        temporary.unlink(missing_ok=True)
        raise ValueError("AOI removed every mesh face")
    os.replace(temporary, output)
    return {
        "input_vertices": len(vertices),
        "output_vertices": len(used_v),
        "input_faces": input_faces,
        "output_faces": len(faces),
        "retained_pct": round(100.0 * len(faces) / input_faces, 2),
    }


def normalized_to_game_matrix(
    normalized_from_local: np.ndarray,
    *,
    center_local: tuple[float, float],
    elev_min: float,
) -> np.ndarray:
    """Compose normalized Gaussian coordinates into Flightverse local metres."""
    source = np.asarray(normalized_from_local, dtype=float)
    if source.shape != (4, 4):
        raise ValueError("normalized_from_local must be 4x4")
    east, north = map(float, center_local)
    local_to_game = np.array([
        [1.0, 0.0, 0.0, -east],
        [0.0, 0.0, 1.0, -float(elev_min)],
        [0.0, -1.0, 0.0, north],
        [0.0, 0.0, 0.0, 1.0],
    ])
    return local_to_game @ np.linalg.inv(source)


def _qvec_to_rotation(qvec: np.ndarray) -> np.ndarray:
    """COLMAP qw,qx,qy,qz quaternion to a world-to-camera rotation."""
    w, x, y, z = np.asarray(qvec, dtype=float)
    return np.array([
        [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y],
        [2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x],
        [2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y],
    ])


def _rotation_between(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Stable shortest-arc rotation matching Nerfstudio's orientation helper."""
    a = np.asarray(source, dtype=float)
    b = np.asarray(target, dtype=float)
    a /= np.linalg.norm(a)
    b /= np.linalg.norm(b)
    cross = np.cross(a, b)
    dot = float(np.clip(a @ b, -1.0, 1.0))
    norm = float(np.linalg.norm(cross))
    if norm < 1e-12:
        if dot > 0:
            return np.eye(3)
        axis = np.array([1.0, 0.0, 0.0])
        if abs(a[0]) > 0.9:
            axis = np.array([0.0, 1.0, 0.0])
        axis -= a * float(axis @ a)
        axis /= np.linalg.norm(axis)
        return 2.0 * np.outer(axis, axis) - np.eye(3)
    axis = cross / norm
    skew = np.array([[0.0, -axis[2], axis[1]],
                     [axis[2], 0.0, -axis[0]],
                     [-axis[1], axis[0], 0.0]])
    return np.eye(3) + skew * norm + (skew @ skew) * (1.0 - dot)


def normalized_from_colmap_images(images_txt: Path) -> tuple[np.ndarray, dict]:
    """Reproduce the CUDA Nerfstudio COLMAP pose normalization exactly.

    The result maps original OpenSfM/ODM local XYZ coordinates into the
    normalized Gaussian training frame. It mirrors the training config used
    for Dialectica: COLMAP convention conversion, ``orientation_method=up``,
    pose centering and automatic unit scaling.
    """
    lines = Path(images_txt).read_text(errors="ignore").splitlines()
    poses = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line or line.startswith("#"):
            index += 1
            continue
        fields = line.split()
        if len(fields) < 10:
            raise ValueError(f"invalid COLMAP image row at line {index + 1}")
        try:
            qvec = np.asarray([float(value) for value in fields[1:5]])
            translation = np.asarray([float(value) for value in fields[5:8]])
            int(fields[8])
        except ValueError as error:
            raise ValueError(f"invalid COLMAP image row at line {index + 1}") from error
        world_to_camera = np.eye(4)
        world_to_camera[:3, :3] = _qvec_to_rotation(qvec)
        world_to_camera[:3, 3] = translation
        camera_to_world = np.linalg.inv(world_to_camera)
        camera_to_world[:3, 1:3] *= -1.0
        # Nerfstudio's assume_colmap_world_coordinate_convention=True.
        camera_to_world = camera_to_world[[0, 2, 1, 3], :]
        camera_to_world[2, :] *= -1.0
        poses.append(camera_to_world[:3, :4])
        # The following row is POINTS2D and may be empty.
        index += 2
    if not poses:
        raise ValueError("COLMAP images file has no registered cameras")
    pose_array = np.asarray(poses)
    origin = pose_array[:, :3, 3].mean(axis=0)
    up = pose_array[:, :3, 1].mean(axis=0)
    if float(np.linalg.norm(up)) <= 1e-12:
        raise ValueError("camera poses do not define a stable up direction")
    rotation = _rotation_between(up, np.array([0.0, 0.0, 1.0]))
    transform = np.eye(4)
    transform[:3, :3] = rotation
    transform[:3, 3] = rotation @ -origin
    oriented_translations = (
        pose_array[:, :3, 3] @ rotation.T + transform[:3, 3]
    )
    extent = float(np.max(np.abs(oriented_translations)))
    if extent <= 1e-12:
        raise ValueError("camera poses have zero spatial extent")
    scale = 1.0 / extent
    transform[:3, :] *= scale
    applied_world_convention = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ])
    normalized_from_local = transform @ applied_world_convention
    normalized_camera_translations = oriented_translations * scale
    return normalized_from_local, {
        "registered_cameras": len(poses),
        "scale": scale,
        "camera_center_mean_abs": float(np.max(np.abs(normalized_camera_translations.mean(axis=0)))),
        "camera_extent": float(np.max(np.abs(normalized_camera_translations))),
        "origin_after_colmap_convention": origin.tolist(),
        "up_after_colmap_convention": up.tolist(),
    }


def _circle_coordinates_wgs84(
    latitude: float,
    longitude: float,
    radius_m: float,
    vertices: int = 180,
) -> list[list[float]]:
    metres_lat = 111_320.0
    metres_lon = metres_lat * math.cos(math.radians(latitude))
    ring = []
    for index in range(vertices):
        angle = 2.0 * math.pi * index / vertices
        ring.append([
            longitude + radius_m * math.cos(angle) / metres_lon,
            latitude + radius_m * math.sin(angle) / metres_lat,
        ])
    ring.append(ring[0])
    return ring


def _circle_wkt_utm(east: float, north: float, radius_m: float, vertices: int = 180) -> str:
    points = []
    for index in range(vertices):
        angle = 2.0 * math.pi * index / vertices
        points.append(f"{east + radius_m * math.cos(angle):.4f} {north + radius_m * math.sin(angle):.4f}")
    points.append(points[0])
    return "POLYGON((" + ",".join(points) + "))"


def _hardlink_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def _copy_independent(source: Path, destination: Path) -> None:
    """Create a durable copy that cannot mutate with its source inode."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def _write_json_atomic(path: Path, value: dict) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=1))
    os.replace(temporary, path)


def publish_bundle(moves: list[tuple[Path, Path]], after_publish=None) -> None:
    """Move a staged multi-directory version with deterministic rollback."""
    normalized = [(Path(staged), Path(final)) for staged, final in moves]
    for staged, final in normalized:
        if not staged.exists():
            raise FileNotFoundError(staged)
        if final.exists():
            raise FileExistsError(final)
    moved: list[tuple[Path, Path]] = []
    try:
        for staged, final in normalized:
            os.replace(staged, final)
            moved.append((staged, final))
        if after_publish:
            after_publish()
    except Exception:
        rollback_errors = []
        for staged, final in reversed(moved):
            try:
                staged.parent.mkdir(parents=True, exist_ok=True)
                os.replace(final, staged)
            except OSError as rollback_error:
                rollback_errors.append(str(rollback_error))
        if rollback_errors:
            raise RuntimeError("bundle publish failed and rollback was incomplete: "
                               + " | ".join(rollback_errors))
        raise


def derive_scene_aoi(
    *,
    vault: Path,
    source_cid: str,
    target_cid: str,
    latitude: float,
    longitude: float,
    radius_m: float,
    focus_latitude: float,
    focus_longitude: float,
    focus_radius_m: float,
) -> dict:
    """Serialize one target derivation so concurrent runs cannot interleave."""
    vault = Path(vault).resolve()
    target_cid = validate_cid(target_cid)
    lock_dir = vault / "staging"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / f".{target_cid}.scene-aoi.lock"
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise RuntimeError(f"AOI derivation already running for {target_cid}") from error
    try:
        os.write(lock_fd, f"pid={os.getpid()}\n".encode())
        return _derive_scene_aoi_locked(
            vault=vault,
            source_cid=source_cid,
            target_cid=target_cid,
            latitude=latitude,
            longitude=longitude,
            radius_m=radius_m,
            focus_latitude=focus_latitude,
            focus_longitude=focus_longitude,
            focus_radius_m=focus_radius_m,
        )
    finally:
        os.close(lock_fd)
        lock_path.unlink(missing_ok=True)


def _derive_scene_aoi_locked(
    *,
    vault: Path,
    source_cid: str,
    target_cid: str,
    latitude: float,
    longitude: float,
    radius_m: float,
    focus_latitude: float,
    focus_longitude: float,
    focus_radius_m: float,
) -> dict:
    """Build an immutable derived AOI version and atomically publish its assets."""
    vault = Path(vault).resolve()
    source_cid = validate_cid(source_cid)
    target_cid = validate_cid(target_cid)
    if source_cid == target_cid:
        raise ValueError("source and derived scene ids must differ")
    numeric = (latitude, longitude, radius_m, focus_latitude, focus_longitude, focus_radius_m)
    if not all(math.isfinite(float(value)) for value in numeric):
        raise ValueError("AOI coordinates and radii must be finite")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("outer AOI coordinates are invalid")
    if not -90 <= focus_latitude <= 90 or not -180 <= focus_longitude <= 180:
        raise ValueError("focus AOI coordinates are invalid")
    if radius_m <= 0 or focus_radius_m <= 0:
        raise ValueError("AOI radii must be positive")
    source_model = vault / "models" / source_cid
    source_proj = vault / "odm" / f"proj_{source_cid}"
    source_splats = vault / "splats"
    source_splat_meta_path = source_splats / f"{source_cid}.meta.json"
    final_model = vault / "models" / target_cid
    final_project = vault / "odm" / f"proj_{target_cid}"
    if not (source_model / "meta.json").exists():
        raise ValueError(f"source model does not exist: {source_cid}")
    if final_model.exists() or final_project.exists() or any((source_splats / f"{target_cid}{suffix}").exists()
                                   for suffix in (".splat", ".raw.splat", ".clean.sog", ".meta.json")):
        raise FileExistsError(f"derived version already exists: {target_cid}")
    for required in (
        source_proj / "odm_orthophoto" / "odm_orthophoto.tif",
        source_proj / "odm_dem" / "dsm.tif",
        source_proj / "odm_georeferencing" / "odm_georeferenced_model.laz",
        source_proj / "odm_georeferencing" / "coords.txt",
        source_proj / "odm_texturing" / "odm_textured_model_geo.obj",
        source_splats / f"{source_cid}.splat",
        source_splat_meta_path,
        source_proj / "opensfm" / "colmap_export" / "images.txt",
        source_proj / "opensfm" / "nerfstudio-config.yml",
    ):
        if not required.exists():
            raise FileNotFoundError(required)

    source_splat_meta = json.loads(source_splat_meta_path.read_text())
    normalization_contract = validate_nerfstudio_normalization_contract(
        source_splat_meta,
        source_proj / "opensfm" / "colmap_export" / "images.txt",
        source_proj / "opensfm" / "nerfstudio-config.yml",
    )

    staging_root = vault / "staging" / f"scene_aoi_{target_cid}_{time.time_ns()}"
    stage_vault = staging_root / "vault"
    derived_proj = staging_root / f"proj_{target_cid}"
    stage_splats = stage_vault / "splats"
    stage_splats.mkdir(parents=True)
    try:
        # The cutline is a circle, not merely its rectangular bounds. Source
        # rasters/LAZ are hard-linked read-only into this isolated staging tree.
        aoi_geojson = {
            "type": "FeatureCollection",
            "name": "aoi",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": [{
                "type": "Feature",
                "properties": {"radius_m": radius_m},
                "geometry": {"type": "Polygon", "coordinates": [[
                    *(_circle_coordinates_wgs84(latitude, longitude, radius_m))
                ]]},
            }],
        }
        derived_proj.mkdir(parents=True)
        _write_json_atomic(derived_proj / "aoi.geojson", aoi_geojson)
        source_links = derived_proj / "source"
        _hardlink_or_copy(source_proj / "odm_orthophoto" / "odm_orthophoto.tif", source_links / "ortho.tif")
        _hardlink_or_copy(source_proj / "odm_dem" / "dsm.tif", source_links / "dsm.tif")
        _hardlink_or_copy(source_proj / "odm_georeferencing" / "odm_georeferenced_model.laz", source_links / "cloud.laz")
        for directory in ("odm_orthophoto", "odm_dem", "odm_georeferencing", "odm_texturing"):
            (derived_proj / directory).mkdir(parents=True, exist_ok=True)

        # Raster and point-cloud crop run in the pinned ODM image containing
        # GDAL and PDAL. All outputs are new files under staging.
        east, north = utm18_from_wgs84(latitude, longitude)
        pdal_pipeline = {
            "pipeline": [
                "/d/source/cloud.laz",
                {"type": "filters.crop", "polygon": _circle_wkt_utm(east, north, radius_m)},
                {"type": "writers.las", "filename": "/d/odm_georeferencing/odm_georeferenced_model.laz",
                 "compression": "laszip", "forward": "all"},
            ]
        }
        _write_json_atomic(derived_proj / "pdal_pipeline.json", pdal_pipeline)
        import tresd_publish
        tresd_publish.sh_in_odm(derived_proj, r"""set -e
python3 - <<'PY'
from osgeo import gdal
options = dict(
    cutlineDSName='/d/aoi.geojson', cropToCutline=True, multithread=True,
    warpOptions=['NUM_THREADS=ALL_CPUS'],
    creationOptions=['TILED=YES', 'COMPRESS=DEFLATE'],
)
gdal.Warp('/d/odm_orthophoto/odm_orthophoto.tif', '/d/source/ortho.tif', dstNodata=0, **options)
gdal.Warp('/d/odm_dem/dsm.tif', '/d/source/dsm.tif', dstNodata=-9999, **options)
PY
P=/code/SuperBuild/install/bin/pdal
export LD_LIBRARY_PATH=/code/SuperBuild/install/lib
$P pipeline /d/pdal_pipeline.json
""")

        # Crop the actual triangle surface, retaining boundary-crossing faces.
        texture_source = source_proj / "odm_texturing"
        origin_east, origin_north = parse_odm_coords_origin(
            source_proj / "odm_georeferencing" / "coords.txt"
        )
        crop_obj_circle(
            texture_source / "odm_textured_model_geo.obj",
            derived_proj / "odm_texturing" / "odm_textured_model_geo.obj",
            center_local=(east - origin_east, north - origin_north),
            radius_m=radius_m,
        )
        for asset in texture_source.iterdir():
            if asset.name == "odm_textured_model_geo.obj" or not asset.is_file():
                continue
            if asset.suffix.lower() in (".mtl", ".jpg", ".jpeg", ".png"):
                _copy_independent(asset, derived_proj / "odm_texturing" / asset.name)
        for relative in (
            "opensfm/stats/stats.json",
            "opensfm/reconstruction.json",
            "opensfm/image_list.txt",
            "opensfm/colmap_export/images.txt",
            "opensfm/nerfstudio-config.yml",
            "odm_georeferencing/coords.txt",
        ):
            source = source_proj / relative
            if source.exists():
                _copy_independent(source, derived_proj / relative)

        # Reuse the established publisher against an isolated vault so a failed
        # crop can never expose a partial public model.
        previous_vault = tresd_publish.VAULT
        previous_rebuild = tresd_publish.REBUILD_INDEX_AFTER_PUBLISH
        previous_argv = sys.argv[:]
        try:
            tresd_publish.VAULT = stage_vault
            tresd_publish.REBUILD_INDEX_AFTER_PUBLISH = False
            sys.argv = ["tresd_publish.py", target_cid, str(derived_proj)]
            tresd_publish.main()
        finally:
            tresd_publish.VAULT = previous_vault
            tresd_publish.REBUILD_INDEX_AFTER_PUBLISH = previous_rebuild
            sys.argv = previous_argv

        model_dir = stage_vault / "models" / target_cid
        source_meta = json.loads((source_model / "meta.json").read_text())
        meta = json.loads((model_dir / "meta.json").read_text())
        center_local = (east - origin_east, north - origin_north)
        if isinstance(meta.get("mesh_offset"), list) and len(meta["mesh_offset"]) == 3:
            meta["mesh_offset"][0] = round(float(meta["mesh_offset"][0]) - center_local[0], 4)
            meta["mesh_offset"][1] = round(float(meta["mesh_offset"][1]) - center_local[1], 4)
        meta.update({key: source_meta[key] for key in (
            "preset", "preset_requested", "dense_quality", "dense_quality_requested",
            "dense_fallback", "sources", "odm_report", "reconstruction",
        ) if key in source_meta})
        meta["clip_id"] = target_cid
        meta["title"] = "Dialectica · bloque profesional"
        meta["qa"] = {
            **(source_meta.get("qa") or {}),
            "area_m2": round(math.pi * radius_m * radius_m, 1),
            "status": "aoi_verified",
        }
        meta["derived_from"] = source_cid
        meta["derived_project"] = f"odm/proj_{target_cid}"
        meta["aoi"] = {
            "policy": "circular_aoi_with_boundary_triangle_guard",
            "outer": {"lat": latitude, "lon": longitude, "radius_m": radius_m},
            "focus": {"lat": focus_latitude, "lon": focus_longitude, "radius_m": focus_radius_m},
            "mesh_boundary": "retain_faces_intersecting_circle_to_avoid_edge_holes",
            "source_preserved": True,
        }
        _write_json_atomic(model_dir / "meta.json", meta)

        import dsm_lod
        previous_lod_vault = dsm_lod.VAULT
        try:
            dsm_lod.VAULT = stage_vault
            lod = dsm_lod.build(target_cid)
        finally:
            dsm_lod.VAULT = previous_lod_vault

        normalized_from_local, transform_report = normalized_from_colmap_images(
            source_proj / "opensfm" / "colmap_export" / "images.txt"
        )
        if (transform_report["camera_center_mean_abs"] > 1e-9
                or abs(transform_report["camera_extent"] - 1.0) > 1e-9):
            raise ValueError("COLMAP camera normalization failed its frame invariants")
        normalized_to_local = np.linalg.inv(normalized_from_local)
        splat_report = crop_splat_circle(
            source_splats / f"{source_cid}.splat",
            stage_splats / f"{target_cid}.splat",
            normalized_to_local=normalized_to_local,
            center_local=center_local,
            radius_m=radius_m,
        )
        raw_source = source_splats / f"{source_cid}.raw.splat"
        raw_report = None
        if raw_source.exists():
            raw_report = crop_splat_circle(
                raw_source,
                stage_splats / f"{target_cid}.raw.splat",
                normalized_to_local=normalized_to_local,
                center_local=center_local,
                radius_m=radius_m,
            )
        import worker
        sog = worker.export_viewer_sog(stage_splats / f"{target_cid}.splat")
        if not sog:
            raise RuntimeError("failed to export cropped Gaussian to SOG")
        splat_meta = dict(source_splat_meta)
        game_matrix = normalized_to_game_matrix(
            normalized_from_local,
            center_local=center_local,
            elev_min=float(lod["elev_min"]),
        )
        splat_meta.update({
            "clip_id": target_cid,
            "derived_from": source_cid,
            "aoi": meta["aoi"],
            "crop": {"clean": splat_report, "raw": raw_report},
            "normalization": transform_report,
            "normalization_contract": normalization_contract,
            "world_transform": {
                "status": "aligned",
                "matrix": game_matrix.reshape(-1).tolist(),
                "method": "nerfstudio-colmap-exact",
                "source": "hash-verified COLMAP cameras + Nerfstudio CUDA config",
            },
        })
        _write_json_atomic(stage_splats / f"{target_cid}.meta.json", splat_meta)

        # Preserve the audit/republication sources, but never duplicate the
        # read-only hardlinks that pointed back at the original project.
        shutil.rmtree(source_links)
        for temporary in derived_proj.glob(".web_*"):
            if temporary.is_file():
                temporary.unlink()

        # Commit all three product families under an exclusive target lock.
        # The callback publishes the manifest/index; any exception rolls every
        # move back into staging before the staging tree is removed.
        source_splats.mkdir(parents=True, exist_ok=True)
        final_model.parent.mkdir(parents=True, exist_ok=True)
        final_project.parent.mkdir(parents=True, exist_ok=True)
        moves = [(staged, source_splats / staged.name) for staged in sorted(stage_splats.iterdir())]
        moves.extend([(derived_proj, final_project), (model_dir, final_model)])

        def publish_runtime_contracts() -> None:
            import build_index
            import scene_manifest
            previous_scene_vault = scene_manifest.VAULT
            previous_index_vault = build_index.VAULT
            try:
                scene_manifest.VAULT = vault
                build_index.VAULT = vault
                scene_manifest.build(target_cid)
                build_index.main()
            finally:
                scene_manifest.VAULT = previous_scene_vault
                build_index.VAULT = previous_index_vault

        publish_bundle(moves, after_publish=publish_runtime_contracts)
        return {
            "source_cid": source_cid,
            "target_cid": target_cid,
            "aoi": meta["aoi"],
            "model": {
                "cloud_points": meta.get("cloud_points"),
                "mesh": meta.get("mesh_stats"),
                "world_size_m": lod.get("size_m"),
                "elevation_m": [lod.get("elev_min"), lod.get("elev_max")],
            },
            "splat": splat_report,
            "raw_splat": raw_report,
            "odm_project": str(final_project.relative_to(vault)),
            "runtime_manifest": str((final_model / "scene.v2.json").relative_to(vault)),
        }
    finally:
        # This directory is guaranteed to be under vault/staging and contains
        # only newly generated derivatives. Originals and published assets are
        # never targets of cleanup.
        staging_parent = (vault / "staging").resolve()
        if staging_root.exists() and staging_root.resolve().parent == staging_parent:
            shutil.rmtree(staging_root)


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Derive a reversible professional AOI scene")
    parser.add_argument("source_cid")
    parser.add_argument("target_cid")
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--radius", type=float, required=True)
    parser.add_argument("--focus-lat", type=float, required=True)
    parser.add_argument("--focus-lon", type=float, required=True)
    parser.add_argument("--focus-radius", type=float, required=True)
    parser.add_argument("--vault", type=Path, default=Path("/Volumes/SSD/drone-vault"))
    args = parser.parse_args()
    report = derive_scene_aoi(
        vault=args.vault,
        source_cid=args.source_cid,
        target_cid=args.target_cid,
        latitude=args.lat,
        longitude=args.lon,
        radius_m=args.radius,
        focus_latitude=args.focus_lat,
        focus_longitude=args.focus_lon,
        focus_radius_m=args.focus_radius,
    )
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
