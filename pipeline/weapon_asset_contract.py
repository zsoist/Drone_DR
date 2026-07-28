"""Strict offline contract for Flightverse weapon GLBs.

The browser never imports this module. It validates generated binary assets
before they can be committed or deployed.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from PIL import Image


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENT_BYTES = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
}
TYPE_WIDTH = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}
FLOAT_COMPONENT = 5126
EXPECTED_STEMS = {
    "ac30_cannon",
    "swarm8_pod",
    "viperx_missile",
    "railgun_pod",
    "nova_bomb",
}


@dataclass(frozen=True)
class GlbDocument:
    path: Path
    gltf: dict[str, Any]
    binary: bytes
    byte_length: int


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_glb(path: str | Path) -> GlbDocument:
    source = Path(path)
    raw = source.read_bytes()
    if len(raw) < 20:
        raise ValueError(f"{source}: GLB truncated")
    magic, version, declared = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2 or declared != len(raw):
        raise ValueError(f"{source}: invalid GLB header")
    offset = 12
    gltf = None
    binary = None
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise ValueError(f"{source}: truncated chunk header")
        length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        end = offset + length
        if end > len(raw) or length % 4:
            raise ValueError(f"{source}: invalid chunk bounds")
        chunk = raw[offset:end]
        offset = end
        if chunk_type == JSON_CHUNK:
            if gltf is not None:
                raise ValueError(f"{source}: duplicate JSON chunk")
            gltf = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif chunk_type == BIN_CHUNK:
            if binary is not None:
                raise ValueError(f"{source}: duplicate BIN chunk")
            binary = bytes(chunk)
    if gltf is None or binary is None:
        raise ValueError(f"{source}: JSON or BIN chunk missing")
    buffers = gltf.get("buffers") or []
    if len(buffers) != 1 or int(buffers[0].get("byteLength", -1)) > len(binary):
        raise ValueError(f"{source}: invalid embedded buffer")
    return GlbDocument(source, gltf, binary, len(raw))


def _accessor_bounds(document: GlbDocument) -> tuple[bool, bool]:
    gltf = document.gltf
    views = gltf.get("bufferViews") or []
    all_bounded = True
    all_finite = True
    for accessor in gltf.get("accessors") or []:
        view_index = accessor.get("bufferView")
        component_type = accessor.get("componentType")
        width = TYPE_WIDTH.get(accessor.get("type"))
        component_bytes = COMPONENT_BYTES.get(component_type)
        count = int(accessor.get("count", -1))
        if (
            not isinstance(view_index, int)
            or not 0 <= view_index < len(views)
            or width is None
            or component_bytes is None
            or count < 0
        ):
            all_bounded = False
            continue
        view = views[view_index]
        view_start = int(view.get("byteOffset", 0))
        view_length = int(view.get("byteLength", -1))
        accessor_offset = int(accessor.get("byteOffset", 0))
        element_bytes = component_bytes * width
        stride = int(view.get("byteStride", element_bytes))
        required = accessor_offset + (
            0 if count == 0 else (count - 1) * stride + element_bytes
        )
        if (
            view_start < 0
            or view_length < 0
            or accessor_offset < 0
            or stride < element_bytes
            or required > view_length
            or view_start + required > len(document.binary)
        ):
            all_bounded = False
            continue
        for key in ("min", "max"):
            values = accessor.get(key, [])
            if any(not math.isfinite(float(value)) for value in values):
                all_finite = False
        if component_type == FLOAT_COMPONENT:
            unpack = struct.Struct("<" + "f" * width).unpack_from
            start = view_start + accessor_offset
            for index in range(count):
                values = unpack(document.binary, start + index * stride)
                if any(not math.isfinite(value) for value in values):
                    all_finite = False
                    break
    return all_bounded, all_finite


def _image_dimensions(document: GlbDocument) -> list[list[int]]:
    views = document.gltf.get("bufferViews") or []
    dimensions = []
    for image in document.gltf.get("images") or []:
        view_index = image.get("bufferView")
        if not isinstance(view_index, int) or not 0 <= view_index < len(views):
            raise ValueError(f"{document.path}: image is not embedded")
        view = views[view_index]
        start = int(view.get("byteOffset", 0))
        end = start + int(view.get("byteLength", -1))
        if start < 0 or end <= start or end > len(document.binary):
            raise ValueError(f"{document.path}: image buffer is out of bounds")
        with Image.open(io.BytesIO(document.binary[start:end])) as bitmap:
            bitmap.verify()
            dimensions.append([int(bitmap.width), int(bitmap.height)])
    return sorted(dimensions)


def _triangles(gltf: dict[str, Any]) -> int:
    accessors = gltf.get("accessors") or []
    total = 0
    for mesh in gltf.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            if primitive.get("mode", 4) != 4:
                continue
            accessor_index = primitive.get("indices")
            if accessor_index is None:
                accessor_index = (primitive.get("attributes") or {}).get("POSITION")
            if not isinstance(accessor_index, int) or not 0 <= accessor_index < len(accessors):
                raise ValueError("primitive accessor missing")
            total += int(accessors[accessor_index].get("count", 0)) // 3
    return total


def _position_bounds(gltf: dict[str, Any]) -> list[float]:
    accessors = gltf.get("accessors") or []
    mins: list[list[float]] = []
    maxs: list[list[float]] = []
    for mesh in gltf.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            index = (primitive.get("attributes") or {}).get("POSITION")
            if not isinstance(index, int) or not 0 <= index < len(accessors):
                continue
            accessor = accessors[index]
            if len(accessor.get("min") or []) == 3 and len(accessor.get("max") or []) == 3:
                mins.append([float(value) for value in accessor["min"]])
                maxs.append([float(value) for value in accessor["max"]])
    if not mins:
        raise ValueError("POSITION bounds missing")
    extent = [
        max(values[axis] for values in maxs) - min(values[axis] for values in mins)
        for axis in range(3)
    ]
    if any(not math.isfinite(value) or value <= 0 for value in extent):
        raise ValueError("invalid weapon bounds")
    return [round(value, 6) for value in extent]


def validate_weapon_glb(
    path: str | Path,
    tier: str,
    expected_nodes: Iterable[str],
) -> dict[str, Any]:
    if tier not in {"ultra", "runtime"}:
        raise ValueError(f"invalid weapon tier: {tier}")
    document = parse_glb(path)
    gltf = document.gltf
    node_names = {
        str(node.get("name"))
        for node in gltf.get("nodes") or []
        if node.get("name")
    }
    missing = sorted(set(expected_nodes) - node_names)
    if missing:
        raise ValueError(f"{document.path}: required nodes missing: {missing}")
    buffer_bounds, finite_accessors = _accessor_bounds(document)
    if not buffer_bounds or not finite_accessors:
        raise ValueError(f"{document.path}: invalid accessor data")
    dimensions = _image_dimensions(document)
    expected_size = 4096 if tier == "ultra" else 1024
    if dimensions != [[expected_size, expected_size]] * 3:
        raise ValueError(
            f"{document.path}: expected three {expected_size}px maps, got {dimensions}"
        )
    asset_extras = (gltf.get("asset") or {}).get("extras") or {}
    axis_contract = (
        asset_extras.get("coordinateSystem") == "+Y up, -Z forward"
        and asset_extras.get("units") == "meters"
        and asset_extras.get("tier") == tier
    )
    if not axis_contract:
        raise ValueError(f"{document.path}: coordinate/tier metadata missing")
    triangles = _triangles(gltf)
    byte_budget = 15 * 1024 * 1024 if tier == "ultra" else 3 * 1024 * 1024
    triangle_budget = 120_000 if tier == "ultra" else 30_000
    if document.byte_length >= byte_budget or triangles >= triangle_budget:
        raise ValueError(f"{document.path}: asset budget exceeded")
    return {
        "path": str(document.path),
        "tier": tier,
        "bytes": document.byte_length,
        "sha256": _sha256(document.path),
        "triangles": triangles,
        "materials": len(gltf.get("materials") or []),
        "images": len(gltf.get("images") or []),
        "texture_dimensions": dimensions,
        "nodes": sorted(node_names),
        "buffer_bounds": buffer_bounds,
        "finite_accessors": finite_accessors,
        "axis_contract": axis_contract,
        "bounds": _position_bounds(gltf),
    }


def audit_weapon_arsenal(root: str | Path) -> dict[str, Any]:
    base = Path(root)
    failures: list[str] = []
    try:
        manifest = json.loads((base / "manifest.json").read_text())
    except (OSError, ValueError) as error:
        return {"ok": False, "weapons": [], "failures": [f"manifest: {error}"]}
    stems: list[str] = []
    for key, entry in (manifest.get("weapons") or {}).items():
        stem = str(entry.get("stem", ""))
        stems.append(stem)
        try:
            sidecar = json.loads(
                (base / "validation" / f"{stem}.json").read_text()
            )
            for tier in ("ultra", "runtime"):
                path = base / tier / f"{stem}.glb"
                report = validate_weapon_glb(
                    path,
                    tier,
                    {"mount", "projectile", "muzzle", "collision_proxy"},
                )
                expected = (sidecar.get("tiers") or {}).get(tier) or {}
                if expected.get("sha256") != report["sha256"]:
                    failures.append(f"{key}/{tier}: sidecar sha256 mismatch")
                if expected.get("bytes") != report["bytes"]:
                    failures.append(f"{key}/{tier}: sidecar byte count mismatch")
        except (OSError, ValueError, KeyError) as error:
            failures.append(f"{key}: {error}")
    if set(stems) != EXPECTED_STEMS:
        failures.append(f"weapon stems mismatch: {sorted(stems)}")
    return {
        "ok": not failures,
        "weapons": stems,
        "failures": failures,
        "seed": manifest.get("seed"),
    }
