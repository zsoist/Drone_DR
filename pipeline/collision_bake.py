#!/usr/bin/env python3
"""Build a FLIGHTVERSE structural collider in the game's world frame.

Preferred input is an explicitly aligned ``collision.collision.glb``. Published
viewer OBJ meshes are the deterministic fallback and use the exact transform
applied by ``web/flightverse/scene.js``. Output is a compact binary containing
Float32 positions followed by Uint32 triangle indices plus a versioned JSON
sidecar.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import sys
from pathlib import Path

import numpy as np

VAULT = Path("/Volumes/SSD/drone-vault")
VERSION = 2
GROUND_MIN_M = -2.0
GROUND_MAX_M = 32.0


def _load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _accessor_array(gltf: dict, binary: bytes, index: int) -> np.ndarray:
    accessor = gltf["accessors"][index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    component = {
        5120: np.int8,
        5121: np.uint8,
        5122: np.int16,
        5123: np.uint16,
        5125: np.uint32,
        5126: np.float32,
    }[accessor["componentType"]]
    width = {
        "SCALAR": 1,
        "VEC2": 2,
        "VEC3": 3,
        "VEC4": 4,
    }[accessor["type"]]
    item_bytes = np.dtype(component).itemsize * width
    stride = int(view.get("byteStride") or item_bytes)
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    if stride == item_bytes:
        values = np.frombuffer(
            binary,
            dtype=component,
            count=int(accessor["count"]) * width,
            offset=start,
        )
        return values.reshape(-1, width) if width > 1 else values
    values = np.ndarray(
        shape=(int(accessor["count"]), width),
        dtype=component,
        buffer=binary,
        offset=start,
        strides=(stride, np.dtype(component).itemsize),
    )
    return values.copy()


def parse_glb(path: Path) -> tuple[np.ndarray, np.ndarray]:
    raw = path.read_bytes()
    if len(raw) < 20:
        raise ValueError(f"{path.name}: GLB truncado")
    magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2 or declared_length != len(raw):
        raise ValueError(f"{path.name}: cabecera GLB inválida")
    offset = 12
    gltf = None
    binary = b""
    while offset + 8 <= len(raw):
        chunk_length, chunk_type = struct.unpack_from("<I4s", raw, offset)
        chunk = raw[offset + 8:offset + 8 + chunk_length]
        if len(chunk) != chunk_length:
            raise ValueError(f"{path.name}: chunk GLB truncado")
        if chunk_type == b"JSON":
            gltf = json.loads(chunk)
        elif chunk_type == b"BIN\x00":
            binary = chunk
        offset += 8 + chunk_length
    if not gltf or not binary:
        raise ValueError(f"{path.name}: faltan chunks JSON/BIN")

    positions = []
    triangles = []
    vertex_base = 0
    for mesh in gltf.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            if primitive.get("mode", 4) != 4:
                continue
            position_index = (primitive.get("attributes") or {}).get("POSITION")
            if position_index is None:
                continue
            current = _accessor_array(gltf, binary, position_index).astype(np.float32)
            if current.ndim != 2 or current.shape[1] != 3:
                raise ValueError(f"{path.name}: POSITION no es VEC3")
            if "indices" in primitive:
                index = _accessor_array(gltf, binary, primitive["indices"])
            else:
                index = np.arange(len(current), dtype=np.uint32)
            index = np.asarray(index, dtype=np.uint32).reshape(-1)
            if len(index) % 3:
                raise ValueError(f"{path.name}: índices no triangulados")
            positions.append(current)
            triangles.append(index + vertex_base)
            vertex_base += len(current)
    if not positions or not triangles:
        raise ValueError(f"{path.name}: no contiene triángulos")
    return np.vstack(positions), np.concatenate(triangles)


def parse_obj(path: Path) -> tuple[np.ndarray, np.ndarray]:
    vertices: list[tuple[float, float, float]] = []
    indices: list[int] = []
    with path.open(errors="ignore") as stream:
        for line_number, line in enumerate(stream, 1):
            if line.startswith("v "):
                fields = line.split()
                if len(fields) < 4:
                    raise ValueError(f"{path.name}:{line_number}: vértice inválido")
                vertex = tuple(float(value) for value in fields[1:4])
                if not all(np.isfinite(vertex)):
                    raise ValueError(f"{path.name}:{line_number}: vértice no finito")
                vertices.append(vertex)
            elif line.startswith("f "):
                face = []
                for field in line.split()[1:]:
                    raw_index = int(field.split("/", 1)[0])
                    resolved = raw_index - 1 if raw_index > 0 else len(vertices) + raw_index
                    if resolved < 0 or resolved >= len(vertices):
                        raise ValueError(f"{path.name}:{line_number}: índice fuera de rango")
                    face.append(resolved)
                for cursor in range(1, len(face) - 1):
                    indices.extend((face[0], face[cursor], face[cursor + 1]))
    if not vertices or not indices:
        raise ValueError(f"{path.name}: OBJ sin triángulos")
    return np.asarray(vertices, dtype=np.float32), np.asarray(indices, dtype=np.uint32)


def _source(cid: str, vault: Path) -> tuple[Path, str, np.ndarray]:
    model_dir = vault / "models" / cid
    manifest = _load_json(model_dir / "scene.v2.json")
    splat_transform = (manifest.get("transforms") or {}).get("splat") or {}
    glb = model_dir / "collision.collision.glb"
    if glb.exists() and splat_transform.get("status") == "aligned":
        matrix = np.asarray(splat_transform.get("matrix"), dtype=np.float64)
        if matrix.size != 16 or not np.isfinite(matrix).all():
            raise ValueError(f"{cid}: matriz splat inválida")
        return glb, glb.name, matrix.reshape(4, 4)

    meta = _load_json(model_dir / "meta.json")
    viewer = meta.get("model_viewer") or "model/odm_textured_model_viewer.obj"
    obj = model_dir / viewer
    if not obj.exists():
        raise ValueError(f"{cid}: sin GLB alineado ni OBJ viewer")
    offset = (manifest.get("transforms") or {}).get("mesh_offset")
    if offset is None:
        offset = meta.get("mesh_offset")
    if not isinstance(offset, list) or len(offset) != 3:
        raise ValueError(f"{cid}: mesh_offset ausente")
    ox, oy, oz = (float(value) for value in offset)
    lod = _load_json(model_dir / "dsm_lod.json")
    elevation_min = float(lod["elev_min"])
    # scene.js: rotation.x=-PI/2 then position=(ox, oz-elev_min, -oy).
    matrix = np.asarray([
        [1, 0, 0, ox],
        [0, 0, 1, oz - elevation_min],
        [0, -1, 0, -oy],
        [0, 0, 0, 1],
    ], dtype=np.float64)
    return obj, str(obj.relative_to(model_dir)), matrix


def _fingerprint(path: Path, source_name: str, matrix: np.ndarray, lod: dict) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    contract = {
        "version": VERSION,
        "source": source_name,
        "matrix": np.asarray(matrix, dtype=np.float64).round(12).tolist(),
        "grid": lod.get("grid"),
        "spacing_m": lod.get("spacing_m"),
        "elev_min": lod.get("elev_min"),
        "ground_band_m": [GROUND_MIN_M, GROUND_MAX_M],
    }
    digest.update(json.dumps(contract, sort_keys=True, separators=(",", ":")).encode())
    return digest.hexdigest()


def _transform(positions: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    homogeneous = np.hstack([
        positions.astype(np.float64),
        np.ones((len(positions), 1), dtype=np.float64),
    ])
    transformed = (matrix @ homogeneous.T).T[:, :3]
    if not np.isfinite(transformed).all():
        raise ValueError("la transformación produjo coordenadas no finitas")
    return transformed.astype(np.float32)


def _filtered_geometry(
    positions: np.ndarray,
    indices: np.ndarray,
    model_dir: Path,
    lod: dict,
) -> tuple[np.ndarray, np.ndarray]:
    if len(indices) % 3:
        raise ValueError("índices no triangulados")
    if len(indices) == 0 or int(indices.max()) >= len(positions):
        raise ValueError("índices vacíos o fuera de rango")
    triangles = indices.reshape(-1, 3)
    triangle_positions = positions[triangles]
    cross = np.cross(
        triangle_positions[:, 1] - triangle_positions[:, 0],
        triangle_positions[:, 2] - triangle_positions[:, 0],
    )
    valid = np.einsum("ij,ij->i", cross, cross) > 1e-12
    centers = triangle_positions.mean(axis=1)

    rows, cols = (int(value) for value in lod["grid"])
    spacing_x, spacing_z = (float(value) for value in lod["spacing_m"])
    elevation_min = float(lod["elev_min"])
    heightfield = np.fromfile(model_dir / lod["bin"], dtype="<f4")
    if heightfield.size != rows * cols:
        raise ValueError("DSM truncado o con grid inconsistente")
    heightfield = heightfield.reshape(rows, cols)
    half_width = spacing_x * (cols - 1) / 2
    half_height = spacing_z * (rows - 1) / 2
    grid_x = np.rint((centers[:, 0] + half_width) / spacing_x).astype(np.int64)
    grid_z = np.rint((centers[:, 2] + half_height) / spacing_z).astype(np.int64)
    inside = (
        (grid_x >= 0) & (grid_x < cols)
        & (grid_z >= 0) & (grid_z < rows)
    )
    safe_x = np.clip(grid_x, 0, cols - 1)
    safe_z = np.clip(grid_z, 0, rows - 1)
    ground = heightfield[safe_z, safe_x] - elevation_min
    valid &= inside & np.isfinite(ground)
    valid &= (
        (centers[:, 1] > ground + GROUND_MIN_M)
        & (centers[:, 1] < ground + GROUND_MAX_M)
    )
    triangles = triangles[valid]
    if len(triangles) == 0:
        raise ValueError("ningún triángulo sobrevivió el filtro estructural")

    used = np.unique(triangles)
    remap = np.full(len(positions), np.iinfo(np.uint32).max, dtype=np.uint32)
    remap[used] = np.arange(len(used), dtype=np.uint32)
    return positions[used], remap[triangles].reshape(-1)


def _atomic_write(path: Path, data: bytes) -> None:
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _metadata(
    positions: np.ndarray,
    indices: np.ndarray,
    source_name: str,
    fingerprint: str,
) -> dict:
    positions_le = positions.astype("<f4", copy=False)
    indices_le = indices.astype("<u4", copy=False)
    minimum = positions_le.min(axis=0)
    maximum = positions_le.max(axis=0)
    return {
        "version": VERSION,
        "source": source_name,
        "source_fingerprint": fingerprint,
        "verts": int(len(positions_le)),
        "tris": int(len(indices_le) // 3),
        "bytes_pos": int(positions_le.nbytes),
        "bytes_idx": int(indices_le.nbytes),
        "bounds": [
            [round(float(value), 4) for value in minimum],
            [round(float(value), 4) for value in maximum],
        ],
        "bounds_y": [
            round(float(minimum[1]), 4),
            round(float(maximum[1]), 4),
        ],
    }


def build(cid: str, *, vault: Path = VAULT) -> dict:
    model_dir = Path(vault) / "models" / cid
    lod = _load_json(model_dir / "dsm_lod.json")
    if not lod:
        raise ValueError(f"{cid}: sin dsm_lod.json")
    source_path, source_name, matrix = _source(cid, Path(vault))
    if source_path.suffix.lower() == ".glb":
        local_positions, indices = parse_glb(source_path)
    else:
        local_positions, indices = parse_obj(source_path)
    positions = _transform(local_positions, matrix)
    positions, indices = _filtered_geometry(positions, indices, model_dir, lod)
    fingerprint = _fingerprint(source_path, source_name, matrix, lod)
    meta = _metadata(positions, indices, source_name, fingerprint)
    payload = positions.astype("<f4", copy=False).tobytes()
    payload += indices.astype("<u4", copy=False).tobytes()
    _atomic_write(model_dir / "collision.bin", payload)
    _atomic_write(
        model_dir / "collision.json",
        json.dumps(meta, sort_keys=True, separators=(",", ":")).encode(),
    )
    return meta


def validate(cid: str, *, vault: Path = VAULT) -> dict:
    model_dir = Path(vault) / "models" / cid
    meta = _load_json(model_dir / "collision.json")
    if meta.get("version") != VERSION:
        raise ValueError(f"{cid}: versión de collider inválida")
    source_path, source_name, matrix = _source(cid, Path(vault))
    lod = _load_json(model_dir / "dsm_lod.json")
    expected_fingerprint = _fingerprint(source_path, source_name, matrix, lod)
    if meta.get("source_fingerprint") != expected_fingerprint:
        raise ValueError(f"{cid}: source fingerprint stale")
    if meta.get("source") != source_name:
        raise ValueError(f"{cid}: fuente de collider inconsistente")
    expected_bytes = int(meta.get("bytes_pos", -1)) + int(meta.get("bytes_idx", -1))
    collision_path = model_dir / "collision.bin"
    if expected_bytes <= 0 or not collision_path.exists():
        raise ValueError(f"{cid}: collision.bin ausente")
    if collision_path.stat().st_size != expected_bytes:
        raise ValueError(f"{cid}: collision.bin truncado")
    if int(meta.get("verts", 0)) < 3 or int(meta.get("tris", 0)) < 1:
        raise ValueError(f"{cid}: collider vacío")
    if int(meta["bytes_pos"]) != int(meta["verts"]) * 3 * 4:
        raise ValueError(f"{cid}: bytes_pos inconsistente")
    if int(meta["bytes_idx"]) != int(meta["tris"]) * 3 * 4:
        raise ValueError(f"{cid}: bytes_idx inconsistente")
    raw = collision_path.read_bytes()
    indices = np.frombuffer(raw[int(meta["bytes_pos"]):], dtype="<u4")
    if len(indices) == 0 or int(indices.max()) >= int(meta["verts"]):
        raise ValueError(f"{cid}: índices inválidos")
    return meta


def bake(cid: str) -> dict:
    """Backward-compatible CLI/API alias."""
    meta = build(cid)
    return {
        "cid": cid,
        **meta,
        "total_mb": round(
            (int(meta["bytes_pos"]) + int(meta["bytes_idx"])) / 1e6,
            1,
        ),
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("uso: collision_bake.py <clip_id>")
    print(json.dumps(bake(sys.argv[1]), indent=1))
