#!/usr/bin/env python3
"""Generate five original, deterministic Flightverse weapon GLBs.

Each weapon is exported twice: an ultra asset with three embedded 4K PBR maps
and a mobile/runtime asset with the equivalent 1K maps. Geometry is in meters,
+Y is up, and the firing direction is -Z.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from trimesh.visual.material import PBRMaterial

from weapon_asset_contract import validate_weapon_glb


WEAPONS = {
    "ac": {
        "stem": "ac30_cannon",
        "label": "AC-30",
        "accent": (79, 156, 181),
        "builder": "build_ac30",
    },
    "sw": {
        "stem": "swarm8_pod",
        "label": "SWARM-8",
        "accent": (181, 126, 55),
        "builder": "build_swarm8",
    },
    "vx": {
        "stem": "viperx_missile",
        "label": "VIPER-X",
        "accent": (70, 160, 121),
        "builder": "build_viperx",
    },
    "rg": {
        "stem": "railgun_pod",
        "label": "RAIL",
        "accent": (110, 102, 188),
        "builder": "build_railgun",
    },
    "tb": {
        "stem": "nova_bomb",
        "label": "NOVA",
        "accent": (183, 78, 62),
        "builder": "build_nova",
    },
}
REQUIRED_NODES = {"mount", "projectile", "muzzle", "collision_proxy"}


def translate(x: float, y: float, z: float) -> np.ndarray:
    return trimesh.transformations.translation_matrix([x, y, z])


def box(extents, center=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=np.asarray(extents, dtype=float))
    mesh.apply_translation(center)
    return mesh


def cylinder(
    radius: float,
    length: float,
    center=(0.0, 0.0, 0.0),
    sections: int = 24,
) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(radius=radius, height=length, sections=sections)
    mesh.apply_translation(center)
    return mesh


def cone(
    radius: float,
    length: float,
    center=(0.0, 0.0, 0.0),
    sections: int = 24,
    reverse: bool = False,
) -> trimesh.Trimesh:
    mesh = trimesh.creation.cone(radius=radius, height=length, sections=sections)
    # trimesh cone spans z=0..height; center it, with its point facing -Z.
    mesh.apply_translation([0, 0, -length / 2])
    if reverse:
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0])
        )
    mesh.apply_translation(center)
    return mesh


def torus(
    major_radius: float,
    minor_radius: float,
    center=(0.0, 0.0, 0.0),
    major_sections: int = 28,
    minor_sections: int = 8,
) -> trimesh.Trimesh:
    mesh = trimesh.creation.torus(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_sections=major_sections,
        minor_sections=minor_sections,
    )
    mesh.apply_translation(center)
    return mesh


def ellipsoid(extents, center=(0.0, 0.0, 0.0), subdivisions=2) -> trimesh.Trimesh:
    mesh = trimesh.creation.icosphere(subdivisions=subdivisions, radius=1.0)
    mesh.apply_scale(np.asarray(extents, dtype=float) / 2)
    mesh.apply_translation(center)
    return mesh


def _uv(mesh: trimesh.Trimesh, scale: float = 0.7) -> trimesh.Trimesh:
    """Face-projected UVs with duplicated seam vertices."""
    mesh = mesh.copy()
    mesh.unmerge_vertices()
    uv = np.zeros((len(mesh.vertices), 2), dtype=np.float64)
    for index, face in enumerate(mesh.faces):
        normal = mesh.face_normals[index]
        points = mesh.vertices[face]
        axis = int(np.argmax(np.abs(normal)))
        axes = (2, 1) if axis == 0 else (0, 2) if axis == 1 else (0, 1)
        uv[face] = points[:, axes] * scale
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv)
    return mesh


def _material_image(image: Image.Image, image_format: str) -> Image.Image:
    output = image.copy()
    output.format = image_format
    return output


def texture_set(
    size: int,
    seed: int,
    accent: tuple[int, int, int],
) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Create compressible, original panel/brushed-metal PBR maps."""
    rng = np.random.default_rng(seed)
    tile_size = 256
    yy, xx = np.mgrid[0:tile_size, 0:tile_size]
    brushed = (
        np.sin(xx * 0.24) * 2.5
        + np.sin((xx + yy) * 0.055) * 2.0
        + np.cos(yy * 0.09) * 1.3
    )
    low = rng.normal(0, 1, (32, 32)).astype(np.float32)
    low_image = Image.fromarray(
        np.clip(low * 28 + 128, 0, 255).astype(np.uint8),
        mode="L",
    ).resize((tile_size, tile_size), Image.Resampling.BICUBIC)
    low_noise = (np.asarray(low_image, dtype=np.float32) - 128) * 0.08
    panel = np.zeros((tile_size, tile_size), dtype=np.float32)
    panel[(xx % 64) < 3] -= 11
    panel[(yy % 64) < 3] -= 9
    panel[((xx + yy + seed) % 127) < 2] += 7
    height = brushed + low_noise + panel
    base = np.empty((tile_size, tile_size, 3), dtype=np.float32)
    neutral = np.asarray(accent, dtype=np.float32) * 0.62 + 38
    base[:] = neutral
    base += (brushed + low_noise)[..., None]
    seams = panel < -5
    base[seams] *= 0.58
    stripe = ((yy + seed) % 128) < 13
    base[stripe] = base[stripe] * 0.55 + np.array([28, 32, 36]) * 0.45
    base = np.clip(base, 0, 255).astype(np.uint8)

    dx = np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)
    dy = np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)
    normals = np.stack([-dx * 0.045, -dy * 0.045, np.ones_like(dx)], axis=-1)
    normals /= np.maximum(np.linalg.norm(normals, axis=-1, keepdims=True), 1e-8)
    normal = np.clip((normals * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    orm = np.empty_like(base)
    orm[..., 0] = np.clip(228 + panel * 0.6, 180, 255)
    orm[..., 1] = np.clip(112 - brushed * 1.2 - panel * 0.8, 70, 180)
    orm[..., 2] = np.clip(205 + panel * 0.25, 150, 235)

    resize = lambda array: Image.fromarray(array, mode="RGB").resize(
        (size, size),
        Image.Resampling.BICUBIC,
    )
    base_image = resize(base)
    # Force JPEG preservation in trimesh for the largest/color map.
    encoded = io.BytesIO()
    base_image.save(encoded, format="JPEG", quality=88, optimize=True)
    encoded.seek(0)
    base_image = Image.open(encoded).copy()
    base_image.format = "JPEG"
    return (
        base_image,
        _material_image(resize(normal), "PNG"),
        _material_image(resize(orm), "PNG"),
    )


def pbr_material(size: int, seed: int, accent: tuple[int, int, int]) -> PBRMaterial:
    base, normal, orm = texture_set(size, seed, accent)
    return PBRMaterial(
        name=f"flightverse_weapon_pbr_{size}",
        baseColorFactor=[255, 255, 255, 255],
        baseColorTexture=base,
        normalTexture=normal,
        metallicRoughnessTexture=orm,
        metallicFactor=0.9,
        roughnessFactor=0.55,
        doubleSided=False,
    )


class SceneBuilder:
    def __init__(self, stem: str, material: PBRMaterial):
        self.stem = stem
        self.material = material
        self.root = f"{stem}_root"
        self.scene = trimesh.Scene(base_frame="world")
        self.scene.graph.update(
            frame_from="world",
            frame_to=self.root,
            matrix=np.eye(4),
        )
        self.extras: dict[str, dict[str, Any]] = {}
        self.group("mount")
        self.group("projectile", extras={"defaultHidden": True, "role": "projectile"})
        self.group("muzzle", extras={"role": "muzzle", "forward": [0, 0, -1]})
        self.group(
            "collision_proxy",
            extras={"defaultHidden": True, "role": "collision_proxy"},
        )

    def group(
        self,
        name: str,
        *,
        parent: str | None = None,
        matrix: np.ndarray | None = None,
        extras: dict[str, Any] | None = None,
    ) -> str:
        self.scene.graph.update(
            frame_from=parent or self.root,
            frame_to=name,
            matrix=np.eye(4) if matrix is None else matrix,
        )
        if extras:
            self.extras[name] = dict(extras)
        return name

    def mesh(
        self,
        name: str,
        geometry: trimesh.Trimesh,
        *,
        parent: str = "mount",
        extras: dict[str, Any] | None = None,
    ) -> str:
        geometry = _uv(geometry)
        geometry.visual = trimesh.visual.TextureVisuals(
            uv=geometry.visual.uv,
            material=self.material,
        )
        geometry.metadata["name"] = name
        geometry_name = f"geom__{name}"
        self.scene.geometry[geometry_name] = geometry
        self.scene.graph.update(
            frame_from=parent,
            frame_to=name,
            matrix=np.eye(4),
            geometry=geometry_name,
        )
        if extras:
            self.extras[name] = dict(extras)
        return name

    def finish(self) -> None:
        bounds = np.asarray(self.scene.bounds, dtype=float)
        self.extras["collision_proxy"].update({
            "boundsMin": bounds[0].round(5).tolist(),
            "boundsMax": bounds[1].round(5).tolist(),
        })


def add_projectile(
    builder: SceneBuilder,
    *,
    radius: float,
    length: float,
    fins: bool = False,
) -> None:
    builder.mesh(
        "projectile_body",
        cylinder(radius, length, (0, 0, -length / 2)),
        parent="projectile",
    )
    builder.mesh(
        "projectile_nose",
        cone(radius, radius * 2.2, (0, 0, -length)),
        parent="projectile",
    )
    if fins:
        for index, angle in enumerate((0, math.pi / 2)):
            fin = box((radius * 3.0, 0.045, length * 0.26), (0, 0, -length * 0.18))
            fin.apply_transform(
                trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
            )
            builder.mesh(f"projectile_fin_{index}", fin, parent="projectile")


def build_ac30(material: PBRMaterial) -> SceneBuilder:
    builder = SceneBuilder("ac30_cannon", material)
    builder.mesh("receiver", box((0.78, 0.46, 1.12), (0, 0, 0.12)))
    builder.mesh("recoil_sleeve", cylinder(0.29, 0.72, (0, 0, -0.62), 32))
    for index, (x, y) in enumerate(((0.0, 0.15), (-0.13, -0.08), (0.13, -0.08))):
        builder.mesh(
            f"barrel_{index}",
            cylinder(0.055, 1.34, (x, y, -1.55), 18),
        )
        for vent in range(4):
            builder.mesh(
                f"barrel_{index}_vent_{vent}",
                torus(0.062, 0.012, (x, y, -1.05 - vent * 0.22), 18, 6),
            )
    builder.mesh("mount_plate", box((0.96, 0.17, 0.70), (0, -0.31, 0.24)))
    builder.mesh("feed_housing", box((0.32, 0.58, 0.48), (0.48, 0.03, 0.13)))
    builder.scene.graph.update(frame_from=builder.root, frame_to="muzzle", matrix=translate(0, 0, -2.22))
    add_projectile(builder, radius=0.045, length=0.32)
    builder.finish()
    return builder


def build_swarm8(material: PBRMaterial) -> SceneBuilder:
    builder = SceneBuilder("swarm8_pod", material)
    builder.mesh("pod_shell", box((1.18, 0.72, 1.16), (0, 0, -0.12)))
    builder.mesh("mount_frame", box((1.36, 0.15, 0.72), (0, -0.48, 0.10)))
    positions = [
        (x, y)
        for y in (-0.22, 0.22)
        for x in (-0.42, -0.14, 0.14, 0.42)
    ]
    for index, (x, y) in enumerate(positions):
        builder.mesh(
            f"tube_{index}",
            cylinder(0.105, 1.30, (x, y, -0.25), 20),
        )
        builder.mesh(
            f"tube_lip_{index}",
            torus(0.112, 0.022, (x, y, -0.91), 20, 6),
        )
    builder.mesh("rear_bus", box((1.06, 0.60, 0.22), (0, 0, 0.56)))
    builder.scene.graph.update(frame_from=builder.root, frame_to="muzzle", matrix=translate(0, 0, -0.95))
    add_projectile(builder, radius=0.055, length=0.48, fins=True)
    builder.finish()
    return builder


def build_viperx(material: PBRMaterial) -> SceneBuilder:
    builder = SceneBuilder("viperx_missile", material)
    builder.mesh("launch_rail", box((0.28, 0.16, 2.30), (0, -0.28, -0.25)))
    builder.mesh("missile_body", cylinder(0.18, 1.92, (0, 0, -0.42), 32))
    builder.mesh("seeker", cone(0.18, 0.46, (0, 0, -1.38), 32))
    builder.mesh("exhaust", cylinder(0.135, 0.22, (0, 0, 0.65), 24))
    for index, angle in enumerate((0, math.pi / 2)):
        fin = box((0.66, 0.045, 0.48), (0, 0, 0.34))
        fin.apply_transform(trimesh.transformations.rotation_matrix(angle, [0, 0, 1]))
        builder.mesh(f"clipped_fin_{index}", fin)
    for x in (-0.075, 0.075):
        builder.mesh(f"dual_exhaust_{x}", cylinder(0.055, 0.16, (x, 0, 0.79), 16))
    builder.scene.graph.update(frame_from=builder.root, frame_to="muzzle", matrix=translate(0, 0, -1.62))
    add_projectile(builder, radius=0.18, length=1.70, fins=True)
    builder.finish()
    return builder


def build_railgun(material: PBRMaterial) -> SceneBuilder:
    builder = SceneBuilder("railgun_pod", material)
    builder.mesh("power_housing", box((0.94, 0.58, 0.92), (0, 0, 0.20)))
    for index, x in enumerate((-0.22, 0.22)):
        builder.mesh(f"rail_{index}", box((0.12, 0.17, 2.20), (x, 0.05, -0.86)))
    for index, z in enumerate(np.linspace(-0.05, -1.62, 7)):
        builder.mesh(
            f"field_coil_{index}",
            torus(0.37, 0.045, (0, 0.05, float(z)), 30, 8),
        )
    builder.mesh("lower_spine", box((0.54, 0.12, 2.05), (0, -0.27, -0.78)))
    builder.mesh("capacitor_left", cylinder(0.12, 0.72, (-0.47, 0, 0.22), 18))
    builder.mesh("capacitor_right", cylinder(0.12, 0.72, (0.47, 0, 0.22), 18))
    builder.scene.graph.update(frame_from=builder.root, frame_to="muzzle", matrix=translate(0, 0.05, -1.98))
    add_projectile(builder, radius=0.065, length=0.58)
    builder.finish()
    return builder


def build_nova(material: PBRMaterial) -> SceneBuilder:
    builder = SceneBuilder("nova_bomb", material)
    builder.mesh("mount_yoke", box((0.84, 0.17, 0.58), (0, 0.55, 0.25)))
    builder.mesh("faceted_casing", ellipsoid((0.82, 0.82, 1.82), (0, 0, -0.38), 2))
    builder.mesh("nose_cap", cone(0.34, 0.52, (0, 0, -1.28), 24))
    builder.mesh("tail_shaft", cylinder(0.20, 0.50, (0, 0, 0.73), 20))
    for index, angle in enumerate((0, math.pi / 2)):
        fin = box((0.88, 0.055, 0.58), (0, 0, 0.78))
        fin.apply_transform(trimesh.transformations.rotation_matrix(angle, [0, 0, 1]))
        builder.mesh(f"tail_fin_{index}", fin)
    for index, z in enumerate((-0.54, -0.22, 0.12)):
        builder.mesh(f"safety_band_{index}", torus(0.39, 0.025, (0, 0, z), 28, 7))
    builder.scene.graph.update(frame_from=builder.root, frame_to="muzzle", matrix=translate(0, 0, -1.55))
    builder.mesh(
        "projectile_casing",
        ellipsoid((0.66, 0.66, 1.48), (0, 0, -0.68), 2),
        parent="projectile",
    )
    builder.mesh(
        "projectile_tail",
        cylinder(0.15, 0.36, (0, 0, 0.18), 18),
        parent="projectile",
    )
    builder.finish()
    return builder


def _parse_glb_bytes(data: bytes) -> tuple[dict[str, Any], bytes]:
    magic, version, declared = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or declared != len(data):
        raise ValueError("invalid generated GLB")
    offset = 12
    gltf = None
    binary = b""
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if chunk_type == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif chunk_type == 0x004E4942:
            binary = bytes(chunk)
    if gltf is None:
        raise ValueError("generated GLB JSON missing")
    return gltf, binary


def _rebuild_glb(gltf: dict[str, Any], binary: bytes) -> bytes:
    binary += b"\0" * ((4 - len(binary) % 4) % 4)
    gltf["buffers"][0]["byteLength"] = len(binary)
    encoded = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode()
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    body = struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    body += struct.pack("<II", len(binary), 0x004E4942) + binary
    return struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", checksum)
    )


def _canonical_png(image: Image.Image) -> bytes:
    """Encode RGB PNG bytes without Pillow's process-global filter heuristics."""
    bitmap = image.convert("RGB")
    width, height = bitmap.size
    pixels = bitmap.tobytes()
    stride = width * 3
    scanlines = b"".join(
        b"\0" + pixels[row * stride:(row + 1) * stride]
        for row in range(height)
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(scanlines, level=9))
        + _png_chunk(b"IEND", b"")
    )


def _canonicalize_embedded_pngs(
    gltf: dict[str, Any],
    binary: bytes,
) -> bytes:
    """Repack buffer views with deterministic PNG payloads and 4-byte alignment."""
    views = gltf.get("bufferViews") or []
    replacements: dict[int, bytes] = {}
    for image in gltf.get("images") or []:
        if image.get("mimeType") != "image/png":
            continue
        view_index = image.get("bufferView")
        if not isinstance(view_index, int) or not 0 <= view_index < len(views):
            raise ValueError("embedded PNG bufferView missing")
        view = views[view_index]
        start = int(view.get("byteOffset", 0))
        end = start + int(view["byteLength"])
        with Image.open(io.BytesIO(binary[start:end])) as bitmap:
            replacements[view_index] = _canonical_png(bitmap)

    rebuilt = bytearray()
    previous_end = 0
    for view_index, view in sorted(
        enumerate(views),
        key=lambda entry: int(entry[1].get("byteOffset", 0)),
    ):
        start = int(view.get("byteOffset", 0))
        end = start + int(view["byteLength"])
        if start < previous_end or end > len(binary):
            raise ValueError("overlapping or out-of-bounds generated bufferView")
        rebuilt.extend(b"\0" * ((4 - len(rebuilt) % 4) % 4))
        payload = replacements.get(view_index, binary[start:end])
        view["byteOffset"] = len(rebuilt)
        view["byteLength"] = len(payload)
        rebuilt.extend(payload)
        previous_end = end
    return bytes(rebuilt)


def export_glb(
    builder: SceneBuilder,
    path: Path,
    *,
    tier: str,
    seed: int,
) -> None:
    raw = trimesh.exchange.gltf.export_glb(builder.scene, include_normals=True)
    gltf, binary = _parse_glb_bytes(raw)
    for node in gltf.get("nodes") or []:
        extras = builder.extras.get(node.get("name", ""))
        if extras:
            node.setdefault("extras", {}).update(extras)
    metadata = {
        "weapon": builder.stem,
        "tier": tier,
        "seed": seed,
        "units": "meters",
        "coordinateSystem": "+Y up, -Z forward",
        "license": "Original MetisLab procedural asset",
    }
    gltf.setdefault("asset", {})["generator"] = "MetisLab Flightverse arsenal"
    gltf["asset"]["extras"] = metadata
    gltf.setdefault("extras", {}).update(metadata)
    binary = _canonicalize_embedded_pngs(gltf, binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_rebuild_glb(gltf, binary))


def render_preview(scene: trimesh.Scene, path: Path, label: str) -> None:
    """Small deterministic software preview; no OpenGL dependency."""
    mesh = scene.to_geometry()
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    rotation = (
        trimesh.transformations.rotation_matrix(math.radians(-24), [1, 0, 0])
        @ trimesh.transformations.rotation_matrix(math.radians(34), [0, 1, 0])
    )
    points = trimesh.transform_points(vertices, rotation)
    xy = points[:, [0, 1]]
    lo, hi = xy.min(axis=0), xy.max(axis=0)
    scale = 570 / max(float(np.max(hi - lo)), 1e-6)
    projected = (xy - (lo + hi) / 2) * scale
    projected[:, 0] += 384
    projected[:, 1] = 396 - projected[:, 1]
    face_depth = points[faces, 2].mean(axis=1)
    order = np.argsort(face_depth)
    canvas = Image.new("RGB", (768, 768), (8, 13, 20))
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.load_default(size=30)
    detail_font = ImageFont.load_default(size=17)
    draw.rounded_rectangle((22, 22, 746, 746), radius=34, fill=(15, 24, 35), outline=(49, 69, 86), width=2)
    light = np.array([0.25, 0.72, 0.64])
    light /= np.linalg.norm(light)
    normals = mesh.face_normals @ rotation[:3, :3].T
    for face_index in order:
        polygon = [tuple(projected[index]) for index in faces[face_index]]
        shade = float(np.clip(np.dot(normals[face_index], light) * 0.45 + 0.55, 0.18, 1))
        color = tuple(int(value * shade) for value in (103, 164, 184))
        draw.polygon(polygon, fill=color)
    draw.text((48, 45), label, font=title_font, fill=(225, 238, 246))
    draw.text(
        (48, 686),
        "+Y UP  ·  FIRE −Z  ·  4K PBR",
        font=detail_font,
        fill=(114, 180, 170),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80)).save(path)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def generate(output: Path, seed: int) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "version": 1,
        "seed": seed,
        "coordinateSystem": "+Y up, -Z forward",
        "weapons": {},
    }
    summary = {"seed": seed, "weapons": {}}
    for weapon_index, (key, spec) in enumerate(WEAPONS.items()):
        stem = spec["stem"]
        tier_reports = {}
        preview_scene = None
        for tier, texture_size in (("ultra", 4096), ("runtime", 1024)):
            material = pbr_material(
                texture_size,
                seed + weapon_index * 101,
                spec["accent"],
            )
            builder_fn: Callable[[PBRMaterial], SceneBuilder] = globals()[spec["builder"]]
            builder = builder_fn(material)
            if tier == "runtime":
                preview_scene = builder.scene
            target = output / tier / f"{stem}.glb"
            export_glb(builder, target, tier=tier, seed=seed)
            tier_reports[tier] = validate_weapon_glb(
                target,
                tier,
                REQUIRED_NODES,
            )
        preview = output / "previews" / f"{stem}.png"
        render_preview(preview_scene, preview, spec["label"])
        sidecar = {
            "weapon": stem,
            "key": key,
            "seed": seed,
            "nodes": sorted(REQUIRED_NODES),
            "tiers": {
                tier: {
                    "path": f"{tier}/{stem}.glb",
                    "sha256": report["sha256"],
                    "bytes": report["bytes"],
                    "triangles": report["triangles"],
                    "texture_dimensions": report["texture_dimensions"],
                    "bounds": report["bounds"],
                }
                for tier, report in tier_reports.items()
            },
            "preview": {
                "path": f"previews/{stem}.png",
                "sha256": sha256(preview),
            },
        }
        write_json(output / "validation" / f"{stem}.json", sidecar)
        manifest["weapons"][key] = {
            "stem": stem,
            "label": spec["label"],
            "runtime": f"runtime/{stem}.glb",
            "ultra": f"ultra/{stem}.glb",
            "preview": f"previews/{stem}.png",
            "validation": f"validation/{stem}.json",
        }
        summary["weapons"][key] = sidecar
    contact = Image.new("RGB", (1200, 820), (5, 9, 14))
    contact_draw = ImageDraw.Draw(contact)
    contact_title_font = ImageFont.load_default(size=30)
    contact_label_font = ImageFont.load_default(size=19)
    contact_draw.text(
        (40, 24),
        "FLIGHTVERSE · FIVE-WEAPON 4K ARSENAL",
        font=contact_title_font,
        fill=(225, 238, 246),
    )
    for index, (key, spec) in enumerate(WEAPONS.items()):
        preview = Image.open(
            output / "previews" / f"{spec['stem']}.png"
        ).convert("RGB")
        preview.thumbnail((360, 340), Image.Resampling.LANCZOS)
        column, row = index % 3, index // 3
        x, y = 30 + column * 390, 72 + row * 365
        contact.paste(preview, (x, y))
        contact_draw.text(
            (x + 12, y + 316),
            f"{key.upper()} · {spec['label']}",
            font=contact_label_font,
            fill=(125, 196, 185),
        )
    contact_path = output / "previews" / "contact-sheet.png"
    contact.save(contact_path)
    manifest["contactSheet"] = "previews/contact-sheet.png"
    write_json(output / "manifest.json", manifest)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "web" / "assets" / "weapons",
    )
    parser.add_argument("--seed", type=int, default=20260727)
    args = parser.parse_args()
    summary = generate(args.output.resolve(), args.seed)
    print(json.dumps({
        "ok": True,
        "seed": args.seed,
        "output": str(args.output.resolve()),
        "weapons": {
            key: {
                tier: data["tiers"][tier]["bytes"]
                for tier in ("ultra", "runtime")
            }
            for key, data in summary["weapons"].items()
        },
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
