#!/usr/bin/env python3
"""Generate a five-pass, Three.js/Rapier-ready destructible environment GLB kit.

Outputs a production package containing:
- pre-fractured concrete block and brick wall
- breakable pine tree
- deform-looking terrain patch and impact crater
- explosive barrel with radial shards
- debris pack
- five iteration showcase GLBs
- 1K embedded runtime PBR maps and optional 4K source maps
- physics metadata, Three.js/Rapier runtime, demo, validation and previews

Coordinate system: meters, +Y up, -Z forward-compatible with the drone asset.
The asset pack is original and brand-free.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import textwrap
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from trimesh.visual.material import PBRMaterial

ROOT = Path("/mnt/data")
KIT = ROOT / "threejs_destruction_kit"
MODELS = KIT / "models"
PASSES = KIT / "passes"
TEXTURES_1K = KIT / "textures" / "runtime_1k"
TEXTURES_4K = KIT / "textures" / "source_4k"
PHYSICS = KIT / "physics"
DEMO = KIT / "demo"
VALIDATION = KIT / "validation"
PREVIEWS = KIT / "previews"

RUNTIME_TEX_SIZE = 1024
SOURCE_TEX_SIZE = 4096
GLTF_VALIDATOR = Path("/tmp/gltfval/node_modules/gltf-validator")
THREE_NODE = Path("/tmp/threecheck/node_modules/three")


# -----------------------------------------------------------------------------
# Basic transforms and deterministic utilities
# -----------------------------------------------------------------------------


def mat_translate(v: Iterable[float]) -> np.ndarray:
    return trimesh.transformations.translation_matrix(np.asarray(v, dtype=float))


def mat_rotate(angle: float, axis: Iterable[float]) -> np.ndarray:
    return trimesh.transformations.rotation_matrix(angle, np.asarray(axis, dtype=float))


def mat_scale(v: float | Iterable[float]) -> np.ndarray:
    if np.isscalar(v):
        s = np.array([float(v)] * 3)
    else:
        s = np.asarray(v, dtype=float)
    out = np.eye(4)
    out[0, 0], out[1, 1], out[2, 2] = s
    return out


def transformed(mesh: trimesh.Trimesh, matrix: np.ndarray) -> trimesh.Trimesh:
    out = mesh.copy()
    out.apply_transform(matrix)
    return out


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def json_dump(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# -----------------------------------------------------------------------------
# Procedural PBR textures
# -----------------------------------------------------------------------------


def _tile_to_size(tile: np.ndarray, size: int) -> np.ndarray:
    reps_y = math.ceil(size / tile.shape[0])
    reps_x = math.ceil(size / tile.shape[1])
    return np.tile(tile, (reps_y, reps_x, 1))[:size, :size]


def _normal_from_height(height: np.ndarray, strength: float = 2.0) -> np.ndarray:
    h = height.astype(np.float32)
    dx = np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)
    dy = np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(nx)
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-8)
    return np.clip((n * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)


def _save_texture_set(name: str, tile_base: np.ndarray, tile_height: np.ndarray,
                      roughness: float, metallic: float, ao: float = 1.0) -> dict[str, Path]:
    """Save runtime 1K and source 4K maps from repeatable 256px tiles."""
    paths: dict[str, Path] = {}
    normal_tile = _normal_from_height(tile_height)
    orm_tile = np.zeros((*tile_height.shape, 3), dtype=np.uint8)
    orm_tile[:, :, 0] = int(np.clip(ao, 0, 1) * 255)
    orm_tile[:, :, 1] = int(np.clip(roughness, 0, 1) * 255)
    orm_tile[:, :, 2] = int(np.clip(metallic, 0, 1) * 255)

    for size, folder, suffix in (
        (RUNTIME_TEX_SIZE, TEXTURES_1K, "1k"),
        (SOURCE_TEX_SIZE, TEXTURES_4K, "4k"),
    ):
        folder.mkdir(parents=True, exist_ok=True)
        base = _tile_to_size(tile_base, size)
        normal = _tile_to_size(normal_tile, size)
        orm = _tile_to_size(orm_tile, size)

        base_path = folder / f"{name}_basecolor_{suffix}.jpg"
        normal_path = folder / f"{name}_normal_{suffix}.png"
        orm_path = folder / f"{name}_orm_{suffix}.png"
        Image.fromarray(base, mode="RGB").save(base_path, quality=90, optimize=True, progressive=True)
        Image.fromarray(normal, mode="RGB").save(normal_path, optimize=True, compress_level=9)
        Image.fromarray(orm, mode="RGB").save(orm_path, optimize=True, compress_level=9)
        if size == RUNTIME_TEX_SIZE:
            paths = {"base": base_path, "normal": normal_path, "orm": orm_path}
    return paths


def generate_texture_library() -> dict[str, dict[str, Path]]:
    rng = np.random.default_rng(20260712)
    n = 256
    yy, xx = np.mgrid[0:n, 0:n]
    library: dict[str, dict[str, Path]] = {}

    # Concrete: aggregate, subtle pores and hairline cracks.
    noise = rng.normal(0, 1, (n, n))
    aggregate = np.zeros((n, n), dtype=np.float32)
    for _ in range(700):
        cx, cy = rng.integers(0, n, 2)
        r = int(rng.integers(1, 4))
        y0, y1 = max(0, cy-r), min(n, cy+r+1)
        x0, x1 = max(0, cx-r), min(n, cx+r+1)
        aggregate[y0:y1, x0:x1] += rng.uniform(-5, 8)
    crack = np.zeros((n, n), dtype=np.float32)
    for _ in range(12):
        x = int(rng.integers(0, n))
        for y in range(n):
            x = int(np.clip(x + rng.integers(-1, 2), 0, n-1))
            if rng.random() < 0.35:
                crack[y, max(0, x-1):min(n, x+2)] = -18
    concrete_h = noise * 2.2 + aggregate * 0.35 + crack
    concrete_base = np.clip(154 + noise[..., None]*4 + aggregate[..., None]*0.5 + crack[..., None]*0.15, 70, 205)
    concrete_base = np.repeat(concrete_base[:, :, :1], 3, axis=2).astype(np.uint8)
    concrete_base[:, :, 0] = np.clip(concrete_base[:, :, 0] + 3, 0, 255)
    concrete_base[:, :, 2] = np.clip(concrete_base[:, :, 2] - 3, 0, 255)
    library["concrete"] = _save_texture_set("concrete", concrete_base, concrete_h, 0.82, 0.0, 0.93)

    # Brick: staggered masonry pattern with mortar and mottled fired clay.
    brick_base = np.zeros((n, n, 3), dtype=np.uint8)
    brick_h = np.zeros((n, n), dtype=np.float32)
    bh, bw, mortar = 32, 64, 4
    clay_noise = rng.normal(0, 7, (n, n))
    brick_base[:] = [112, 45, 28]
    for row, y0 in enumerate(range(0, n, bh)):
        offset = 0 if row % 2 == 0 else bw // 2
        brick_base[y0:y0+mortar] = [172, 165, 150]
        brick_h[y0:y0+mortar] = -10
        for x0 in range(-offset, n, bw):
            xa = x0 % n
            brick_base[y0:min(n, y0+bh), xa:xa+mortar] = [172, 165, 150]
            brick_h[y0:min(n, y0+bh), xa:xa+mortar] = -10
    brick_base = np.clip(brick_base.astype(np.float32) + clay_noise[..., None], 0, 255).astype(np.uint8)
    brick_h += clay_noise * 0.25
    library["brick"] = _save_texture_set("brick", brick_base, brick_h, 0.76, 0.0, 0.95)

    # Bark: vertical ridges, cracks and color variation.
    ridge = (np.sin(xx * 0.18 + np.sin(yy * 0.045) * 2.2) +
             0.45*np.sin(xx*0.49 + yy*0.035) + rng.normal(0, 0.28, (n, n)))
    bark_h = ridge * 9.0
    bark_base = np.zeros((n, n, 3), dtype=np.float32)
    bark_base[:, :, 0] = 78 + ridge * 9
    bark_base[:, :, 1] = 48 + ridge * 5
    bark_base[:, :, 2] = 28 + ridge * 3
    bark_base = np.clip(bark_base, 0, 255).astype(np.uint8)
    library["bark"] = _save_texture_set("bark", bark_base, bark_h, 0.88, 0.0, 0.90)

    # Foliage: dense needles/clumps without alpha sorting.
    fol = rng.random((n, n))
    fol2 = np.sin(xx*0.13) * np.sin(yy*0.11)
    foliage_base = np.zeros((n, n, 3), dtype=np.float32)
    foliage_base[:, :, 0] = 31 + fol*24 + fol2*4
    foliage_base[:, :, 1] = 76 + fol*54 + fol2*9
    foliage_base[:, :, 2] = 38 + fol*22
    foliage_h = (fol - 0.5) * 12 + fol2 * 5
    library["foliage"] = _save_texture_set("foliage", np.clip(foliage_base, 0, 255).astype(np.uint8), foliage_h, 0.72, 0.0, 0.88)

    # Ground: soil/grass mix with stones and dry patches.
    low = (np.sin(xx*0.031) + np.cos(yy*0.037) + np.sin((xx+yy)*0.019))*0.5
    grain = rng.normal(0, 1, (n, n))
    ground_h = low*5 + grain*2
    ground_base = np.zeros((n, n, 3), dtype=np.float32)
    ground_base[:, :, 0] = 71 + low*13 + grain*3
    ground_base[:, :, 1] = 75 + low*18 + grain*4
    ground_base[:, :, 2] = 45 + low*8 + grain*2
    for _ in range(240):
        cx, cy = rng.integers(0, n, 2)
        r = int(rng.integers(1, 3))
        ground_base[max(0,cy-r):min(n,cy+r+1), max(0,cx-r):min(n,cx+r+1)] += [20, 18, 12]
        ground_h[max(0,cy-r):min(n,cy+r+1), max(0,cx-r):min(n,cx+r+1)] += 6
    library["ground"] = _save_texture_set("ground", np.clip(ground_base, 0, 255).astype(np.uint8), ground_h, 0.91, 0.0, 0.94)

    # Painted metal: yellow-orange coating with scratches/rust.
    metal_base = np.zeros((n, n, 3), dtype=np.float32)
    metal_base[:] = [191, 108, 21]
    metal_h = rng.normal(0, 1.2, (n, n))
    for _ in range(80):
        y = int(rng.integers(0, n))
        x0 = int(rng.integers(0, n-20))
        length = int(rng.integers(8, 60))
        metal_base[max(0,y-1):min(n,y+2), x0:min(n,x0+length)] = [67, 43, 31]
        metal_h[max(0,y-1):min(n,y+2), x0:min(n,x0+length)] -= 6
    rust = np.maximum(0, rng.normal(0.25, 0.35, (n, n)))
    metal_base[:, :, 0] += rust*25
    metal_base[:, :, 1] -= rust*11
    metal_base[:, :, 2] -= rust*8
    library["painted_metal"] = _save_texture_set("painted_metal", np.clip(metal_base, 0, 255).astype(np.uint8), metal_h, 0.46, 0.38, 0.96)

    return library


def load_material(name: str, paths: dict[str, Path], *, roughness=1.0, metallic=1.0,
                  double_sided=False, factor=(255, 255, 255, 255)) -> PBRMaterial:
    return PBRMaterial(
        name=name,
        baseColorFactor=list(factor),
        baseColorTexture=Image.open(paths["base"]).convert("RGB"),
        normalTexture=Image.open(paths["normal"]).convert("RGB"),
        metallicRoughnessTexture=Image.open(paths["orm"]).convert("RGB"),
        roughnessFactor=roughness,
        metallicFactor=metallic,
        doubleSided=double_sided,
    )


# -----------------------------------------------------------------------------
# Geometry and UV helpers
# -----------------------------------------------------------------------------


def rough_superellipsoid(extents: Sequence[float], *, subdivisions: int = 2,
                         power: float = 0.27, noise: float = 0.015, seed: int = 0) -> trimesh.Trimesh:
    mesh = trimesh.creation.icosphere(subdivisions=subdivisions, radius=1.0)
    v = mesh.vertices.copy()
    v = np.sign(v) * np.power(np.abs(v), power)
    v *= np.asarray(extents, dtype=float) / 2.0
    if noise > 0:
        rng = np.random.default_rng(seed)
        scale = 1.0 + rng.normal(0.0, noise, len(v))
        v *= scale[:, None]
    mesh.vertices = v
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    return mesh


def tapered_cylinder_y(radius_bottom: float, radius_top: float, height: float,
                       sections: int = 16, center=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    angles = np.linspace(0.0, 2.0*math.pi, sections, endpoint=False)
    y0, y1 = -height/2.0, height/2.0
    verts = []
    for y, r in ((y0, radius_bottom), (y1, radius_top)):
        verts.extend([[r*math.cos(a), y, r*math.sin(a)] for a in angles])
    verts.extend([[0.0, y0, 0.0], [0.0, y1, 0.0]])
    faces = []
    for i in range(sections):
        j = (i+1) % sections
        faces += [[i, j, sections+j], [i, sections+j, sections+i]]
        faces += [[2*sections, j, i], [2*sections+1, sections+i, sections+j]]
    mesh = trimesh.Trimesh(np.asarray(verts), np.asarray(faces), process=True)
    mesh.apply_translation(center)
    return mesh


def cylinder_y(radius: float, height: float, sections: int = 24, center=(0, 0, 0)) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    mesh.apply_transform(mat_translate(center) @ mat_rotate(math.pi/2, [1, 0, 0]))
    return mesh


def rod(a: Sequence[float], b: Sequence[float], radius: float, sections: int = 10) -> trimesh.Trimesh:
    return trimesh.creation.cylinder(radius=radius, segment=np.asarray([a, b], dtype=float), sections=sections)


def torus_y(major_radius: float, minor_radius: float, major_sections: int = 32,
            minor_sections: int = 8, center=(0, 0, 0)) -> trimesh.Trimesh:
    mesh = trimesh.creation.torus(major_radius=major_radius, minor_radius=minor_radius,
                                  major_sections=major_sections, minor_sections=minor_sections)
    mesh.apply_transform(mat_translate(center) @ mat_rotate(math.pi/2, [1, 0, 0]))
    return mesh


def assign_face_projection_uv(mesh: trimesh.Trimesh, scale: float = 1.0) -> trimesh.Trimesh:
    """Duplicate face vertices and apply box/triplanar UVs without seams."""
    mesh = mesh.copy()
    mesh.unmerge_vertices()
    uv = np.zeros((len(mesh.vertices), 2), dtype=np.float64)
    normals = mesh.face_normals
    for fi, face in enumerate(mesh.faces):
        axis = int(np.argmax(np.abs(normals[fi])))
        pts = mesh.vertices[face]
        if axis == 0:
            coords = pts[:, [2, 1]]
        elif axis == 1:
            coords = pts[:, [0, 2]]
        else:
            coords = pts[:, [0, 1]]
        uv[face] = coords * scale
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv)
    return mesh


def assign_planar_uv(mesh: trimesh.Trimesh, scale: float = 1.0, axes=(0, 2)) -> trimesh.Trimesh:
    mesh = mesh.copy()
    uv = mesh.vertices[:, list(axes)] * scale
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv)
    return mesh


def assign_cylindrical_y_uv(mesh: trimesh.Trimesh, v_scale: float = 1.0, u_scale: float = 1.0) -> trimesh.Trimesh:
    mesh = mesh.copy()
    v = mesh.vertices
    u = (np.arctan2(v[:, 2], v[:, 0]) / (2.0*math.pi) + 0.5) * u_scale
    y0, y1 = float(v[:, 1].min()), float(v[:, 1].max())
    vv = (v[:, 1] - y0) / max(y1-y0, 1e-6) * v_scale
    mesh.visual = trimesh.visual.TextureVisuals(uv=np.column_stack([u, vv]))
    return mesh


def apply_material(mesh: trimesh.Trimesh, material: PBRMaterial) -> trimesh.Trimesh:
    textured = any(getattr(material, key, None) is not None for key in (
        "baseColorTexture", "normalTexture", "metallicRoughnessTexture",
        "occlusionTexture", "emissiveTexture"
    ))
    if not textured:
        mesh = mesh.copy()
        mesh.visual = trimesh.visual.TextureVisuals(material=material)
        return mesh
    uv = getattr(mesh.visual, "uv", None)
    if uv is None or len(uv) != len(mesh.vertices):
        mesh = assign_face_projection_uv(mesh, scale=1.0)
        uv = mesh.visual.uv
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
    return mesh


def make_terrain(size: float = 20.0, resolution: int = 72, seed: int = 7,
                 crater_center=(2.5, -2.0), crater_radius=1.6) -> trimesh.Trimesh:
    rng = np.random.default_rng(seed)
    xs = np.linspace(-size/2, size/2, resolution)
    zs = np.linspace(-size/2, size/2, resolution)
    xx, zz = np.meshgrid(xs, zs)
    heights = (0.16*np.sin(xx*0.34) + 0.11*np.cos(zz*0.29) +
               0.07*np.sin((xx+zz)*0.57) + 0.04*np.sin(xx*1.2)*np.cos(zz*1.1))
    heights += rng.normal(0, 0.018, heights.shape)
    cx, cz = crater_center
    r = np.sqrt((xx-cx)**2 + (zz-cz)**2)
    depression = -0.36*np.exp(-((r/(crater_radius*0.72))**4))
    rim = 0.20*np.exp(-(((r-crater_radius)/(crater_radius*0.18))**2))
    heights += depression + rim
    verts = np.column_stack([xx.ravel(), heights.ravel(), zz.ravel()])
    faces = []
    for z in range(resolution-1):
        for x in range(resolution-1):
            i = z*resolution+x
            faces.append([i, i+resolution, i+1])
            faces.append([i+1, i+resolution, i+resolution+1])
    mesh = trimesh.Trimesh(verts, np.asarray(faces, dtype=np.int64), process=False)
    mesh.visual = trimesh.visual.TextureVisuals(uv=np.column_stack([(xx.ravel()/4.0), (zz.ravel()/4.0)]))
    return mesh


def make_crater(radius: float = 1.5, resolution_r: int = 12, resolution_a: int = 64) -> trimesh.Trimesh:
    verts = []
    for ir in range(resolution_r+1):
        r = radius * ir / resolution_r
        for ia in range(resolution_a):
            a = 2*math.pi*ia/resolution_a
            t = r/radius
            y = -0.30*(1-t)**2 + 0.18*math.exp(-((t-0.88)/0.11)**2)
            verts.append([r*math.cos(a), y, r*math.sin(a)])
    faces = []
    for ir in range(resolution_r):
        for ia in range(resolution_a):
            j = (ia+1)%resolution_a
            a = ir*resolution_a+ia
            b = ir*resolution_a+j
            c = (ir+1)*resolution_a+ia
            d = (ir+1)*resolution_a+j
            faces.extend([[a,c,b],[b,c,d]])
    mesh = trimesh.Trimesh(np.asarray(verts), np.asarray(faces), process=False)
    return assign_planar_uv(mesh, scale=0.6)


def barrel_sector(angle0: float, angle1: float, radius: float, height: float,
                  thickness: float = 0.018, segments: int = 10) -> trimesh.Trimesh:
    angles = np.linspace(angle0, angle1, segments+1)
    y0, y1 = -height/2, height/2
    verts = []
    for r in (radius-thickness, radius):
        for y in (y0, y1):
            verts.extend([[r*math.cos(a), y, r*math.sin(a)] for a in angles])
    ring = segments+1
    faces = []
    # Four surfaces: outer, inner, top, bottom.
    for i in range(segments):
        j=i+1
        # inner low/high indices 0/ring; outer low/high 2ring/3ring
        faces += [[2*ring+i, 2*ring+j, 3*ring+i], [2*ring+j, 3*ring+j, 3*ring+i]]
        faces += [[i, ring+i, j], [j, ring+i, ring+j]]
        faces += [[ring+i, 3*ring+i, ring+j], [ring+j, 3*ring+i, 3*ring+j]]
        faces += [[i, j, 2*ring+i], [j, 2*ring+j, 2*ring+i]]
    # radial end caps
    for idx in (0, segments):
        faces += [[idx, 2*ring+idx, ring+idx], [2*ring+idx, 3*ring+idx, ring+idx]]
    return trimesh.Trimesh(np.asarray(verts), np.asarray(faces), process=True)


# -----------------------------------------------------------------------------
# GLB scene building and post-processing
# -----------------------------------------------------------------------------


class SceneBuilder:
    def __init__(self, root_name: str):
        self.scene = trimesh.Scene(base_frame="world")
        self.root_name = root_name
        self.scene.graph.update(frame_from="world", frame_to=root_name, matrix=np.eye(4))
        self.node_extras: dict[str, dict[str, Any]] = {}

    def group(self, name: str, parent: str | None = None, transform: np.ndarray | None = None,
              extras: dict[str, Any] | None = None) -> str:
        parent = parent or self.root_name
        self.scene.graph.update(frame_from=parent, frame_to=name, matrix=np.eye(4) if transform is None else transform)
        if extras:
            self.node_extras[name] = extras
        return name

    def mesh(self, name: str, mesh: trimesh.Trimesh, material: PBRMaterial, *, parent: str | None = None,
             transform: np.ndarray | None = None, extras: dict[str, Any] | None = None) -> str:
        parent = parent or self.root_name
        geom_name = f"geom__{name}"
        mesh = mesh.copy()
        mesh = apply_material(mesh, material)
        mesh.metadata["name"] = name
        self.scene.geometry[geom_name] = mesh
        self.scene.graph.update(frame_from=parent, frame_to=name,
                                matrix=np.eye(4) if transform is None else transform,
                                geometry=geom_name)
        if extras:
            self.node_extras[name] = extras
        return name


def parse_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Invalid GLB")
    offset = 12
    gltf = None
    binary = b""
    while offset < length:
        clen, ctype = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset+clen]
        offset += clen
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif ctype == 0x004E4942:
            binary = chunk
    if gltf is None:
        raise ValueError("Missing JSON chunk")
    return gltf, binary


def rebuild_glb(gltf: dict, binary: bytes) -> bytes:
    binary += b"\0" * ((4-len(binary)%4)%4)
    gltf.setdefault("buffers", [{"byteLength": len(binary)}])
    gltf["buffers"][0]["byteLength"] = len(binary)
    jb = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    jb += b" " * ((4-len(jb)%4)%4)
    body = struct.pack("<II", len(jb), 0x4E4F534A) + jb
    body += struct.pack("<II", len(binary), 0x004E4942) + binary
    return struct.pack("<4sII", b"glTF", 2, 12+len(body)) + body


_COMPONENT_DTYPES = {
    5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16,
    5125: np.uint32, 5126: np.float32,
}
_TYPE_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(gltf: dict, binary: bytes, idx: int) -> np.ndarray:
    acc = gltf["accessors"][idx]
    view = gltf["bufferViews"][acc["bufferView"]]
    dtype = np.dtype(_COMPONENT_DTYPES[acc["componentType"]])
    width = _TYPE_WIDTH[acc["type"]]
    offset = int(view.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
    stride = int(view.get("byteStride", dtype.itemsize*width))
    count = int(acc["count"])
    if stride == dtype.itemsize*width:
        return np.frombuffer(binary, dtype=dtype, count=count*width, offset=offset).reshape(count, width).copy()
    out = np.empty((count, width), dtype=dtype)
    for i in range(count):
        out[i] = np.frombuffer(binary, dtype=dtype, count=width, offset=offset+i*stride)
    return out


def compute_tangents(positions: np.ndarray, normals: np.ndarray, uv: np.ndarray,
                     indices: np.ndarray) -> np.ndarray:
    """Vectorized tangent generation for indexed triangle meshes."""
    tri = indices.reshape(-1, 3).astype(np.int64, copy=False)
    i1, i2, i3 = tri[:, 0], tri[:, 1], tri[:, 2]
    p1, p2, p3 = positions[i1], positions[i2], positions[i3]
    w1, w2, w3 = uv[i1], uv[i2], uv[i3]
    e1, e2 = p2 - p1, p3 - p1
    d1, d2 = w2 - w1, w3 - w1
    denom = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
    valid = np.abs(denom) > 1e-12
    r = np.zeros_like(denom, dtype=np.float64)
    r[valid] = 1.0 / denom[valid]
    sdir = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) * r[:, None]
    tdir = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) * r[:, None]
    sdir[~valid] = 0.0
    tdir[~valid] = 0.0

    tan1 = np.zeros_like(positions, dtype=np.float64)
    tan2 = np.zeros_like(positions, dtype=np.float64)
    for ids in (i1, i2, i3):
        np.add.at(tan1, ids, sdir)
        np.add.at(tan2, ids, tdir)

    n = normals.astype(np.float64, copy=False)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    t = tan1 - n * np.sum(n * tan1, axis=1, keepdims=True)
    ln = np.linalg.norm(t, axis=1)
    bad = ln < 1e-10
    if np.any(bad):
        axes = np.zeros((bad.sum(), 3), dtype=np.float64)
        bn = n[bad]
        axes[:, 0] = (np.abs(bn[:, 0]) < 0.9).astype(float)
        axes[:, 2] = (np.abs(bn[:, 0]) >= 0.9).astype(float)
        t[bad] = np.cross(axes, bn)
        ln[bad] = np.maximum(np.linalg.norm(t[bad], axis=1), 1e-10)
    t /= ln[:, None]
    handed = np.where(np.sum(np.cross(n, t) * tan2, axis=1) < 0.0, -1.0, 1.0)
    out = np.empty((len(positions), 4), dtype=np.float32)
    out[:, :3] = t.astype(np.float32)
    out[:, 3] = handed.astype(np.float32)
    return out

def postprocess_glb(data: bytes, node_extras: dict[str, dict[str, Any]], asset_extras: dict[str, Any]) -> bytes:
    gltf, binary = parse_glb(data)
    accessors = gltf.get("accessors", [])
    views = gltf.get("bufferViews", [])

    # Required GPU targets and generated tangents for normal-mapped materials.
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            for semantic, acc_idx in prim.get("attributes", {}).items():
                vi = accessors[acc_idx].get("bufferView")
                if vi is not None:
                    views[vi]["target"] = 34962
            if "indices" in prim:
                vi = accessors[prim["indices"]].get("bufferView")
                if vi is not None:
                    views[vi]["target"] = 34963

            attrs = prim.get("attributes", {})
            material_idx = prim.get("material")
            requires_tangent = False
            if material_idx is not None:
                requires_tangent = "normalTexture" in gltf.get("materials", [])[material_idx]
            if requires_tangent and "TANGENT" not in attrs and all(k in attrs for k in ("POSITION", "NORMAL", "TEXCOORD_0")):
                pos = read_accessor(gltf, binary, attrs["POSITION"]).astype(np.float64)
                nor = read_accessor(gltf, binary, attrs["NORMAL"]).astype(np.float64)
                uv = read_accessor(gltf, binary, attrs["TEXCOORD_0"]).astype(np.float64)
                if "indices" in prim:
                    idx = read_accessor(gltf, binary, prim["indices"]).reshape(-1).astype(np.int64)
                else:
                    idx = np.arange(len(pos), dtype=np.int64)
                tangents = compute_tangents(pos, nor, uv, idx)
                binary += b"\0"*((4-len(binary)%4)%4)
                byte_offset = len(binary)
                blob = tangents.tobytes(order="C")
                binary += blob
                view_idx = len(views)
                views.append({"buffer": 0, "byteOffset": byte_offset, "byteLength": len(blob), "target": 34962})
                acc_idx = len(accessors)
                accessors.append({"bufferView": view_idx, "componentType": 5126, "count": len(tangents), "type": "VEC4"})
                attrs["TANGENT"] = acc_idx

    for node in gltf.get("nodes", []):
        name = node.get("name", "")
        if name in node_extras:
            current = node.setdefault("extras", {})
            if isinstance(current, dict):
                current.update(node_extras[name])
            else:
                node["extras"] = node_extras[name]

    gltf.setdefault("asset", {})["generator"] = "MetisLab procedural destruction kit / trimesh"
    gltf["asset"]["extras"] = asset_extras
    gltf.setdefault("extras", {}).update(asset_extras)
    return rebuild_glb(gltf, binary)


def export_builder(builder: SceneBuilder, path: Path, asset_extras: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = trimesh.exchange.gltf.export_glb(builder.scene, include_normals=True)
    raw = postprocess_glb(raw, builder.node_extras, asset_extras)
    path.write_bytes(raw)
    return path


# -----------------------------------------------------------------------------
# Asset builders
# -----------------------------------------------------------------------------


@dataclass
class Materials:
    concrete: PBRMaterial
    brick: PBRMaterial
    bark: PBRMaterial
    foliage: PBRMaterial
    ground: PBRMaterial
    metal: PBRMaterial


def make_material_library(texture_paths: dict[str, dict[str, Path]]) -> Materials:
    return Materials(
        concrete=load_material("mat_concrete_pbr", texture_paths["concrete"]),
        brick=load_material("mat_brick_pbr", texture_paths["brick"]),
        bark=load_material("mat_bark_pbr", texture_paths["bark"]),
        foliage=load_material("mat_foliage_pbr", texture_paths["foliage"], double_sided=False),
        ground=load_material("mat_ground_pbr", texture_paths["ground"]),
        metal=load_material("mat_painted_metal_pbr", texture_paths["painted_metal"]),
    )


def build_concrete_block(materials: Materials, detail: int = 5) -> tuple[SceneBuilder, dict[str, Any]]:
    b = SceneBuilder("concrete_block_root")
    b.node_extras["concrete_block_root"] = {
        "assetId": "concrete_block", "units": "meters", "destructible": True,
        "mode": "swap", "health": 120, "breakImpulse": 12.0, "fractureGroup": "fragments",
        "intactGroup": "intact",
    }
    intact = b.group("intact", extras={"role": "intact", "initialHidden": False})
    fragments = b.group("fragments", extras={"role": "fragments", "initialHidden": True})

    ext = np.array([1.20, 0.62, 0.62])
    subdivisions = 2 if detail >= 3 else 1
    intact_mesh = rough_superellipsoid(ext, subdivisions=subdivisions, power=0.22,
                                        noise=0.009 if detail >= 4 else 0.0, seed=101)
    intact_mesh = assign_face_projection_uv(intact_mesh, scale=1.35)
    b.mesh("block_intact_mesh", intact_mesh, materials.concrete, parent=intact,
           transform=mat_translate([0, ext[1]/2, 0]),
           extras={"role": "intactMesh", "collider": {"type": "box", "halfExtents": (ext/2).tolist()},
                   "friction": 0.84, "restitution": 0.08})

    # 3x2x2 irregular fracture cells with center pivots.
    rng = np.random.default_rng(1776)
    cuts_x = np.array([-ext[0]/2, -0.18, 0.23, ext[0]/2])
    cuts_y = np.array([-ext[1]/2, 0.02, ext[1]/2])
    cuts_z = np.array([-ext[2]/2, 0.015, ext[2]/2])
    chunk_index = 0
    for ix in range(3):
        for iy in range(2):
            for iz in range(2):
                lo = np.array([cuts_x[ix], cuts_y[iy], cuts_z[iz]])
                hi = np.array([cuts_x[ix+1], cuts_y[iy+1], cuts_z[iz+1]])
                size = (hi-lo) * (0.965 + rng.uniform(-0.015, 0.01, 3))
                center = (lo+hi)/2 + rng.uniform(-0.012, 0.012, 3)
                center[1] += ext[1]/2
                mesh = rough_superellipsoid(size, subdivisions=1 if detail < 5 else 2,
                                             power=0.31, noise=0.04 if detail >= 3 else 0.01,
                                             seed=200+chunk_index)
                mesh = assign_face_projection_uv(mesh, scale=1.5)
                mass = float(np.prod(size) * 2100.0 * 0.82)
                b.mesh(f"chunk_{chunk_index:02d}", mesh, materials.concrete, parent=fragments,
                       transform=mat_translate(center), extras={
                           "role": "fragment", "initialHidden": True, "massKg": round(mass, 3),
                           "collider": {"type": "box", "halfExtents": (size*0.44).round(4).tolist()},
                           "friction": 0.82, "restitution": 0.10, "linearDamping": 0.08,
                           "angularDamping": 0.18, "lifetime": 22.0,
                       })
                chunk_index += 1

    # Rebar rods visible after break.
    if detail >= 4:
        for i, z in enumerate((-0.16, 0.16)):
            mesh = cylinder_y(0.012, 1.04, sections=12)
            mesh.apply_transform(mat_rotate(math.pi/2, [0, 0, 1]))
            mesh = assign_cylindrical_y_uv(mesh, v_scale=3)
            b.mesh(f"rebar_{i}", mesh, materials.metal, parent=fragments,
                   transform=mat_translate([0, 0.28, z]), extras={
                       "role": "fragment", "initialHidden": True, "massKg": 1.3,
                       "collider": {"type": "capsule", "halfHeight": 0.50, "radius": 0.012, "axis": "x"},
                       "lifetime": 22.0,
                   })

    manifest = {
        "id": "concrete_block", "file": "models/concrete_block.glb", "mode": "swap",
        "health": 120, "breakImpulse": 12.0, "explosionDamageScale": 1.0,
        "intactGroup": "intact", "fragmentGroup": "fragments",
        "intactColliders": [{"type": "box", "halfExtents": [0.60, 0.31, 0.31], "offset": [0, 0.31, 0]}],
        "material": {"densityKgM3": 2100, "friction": 0.84, "restitution": 0.08},
    }
    return b, manifest


def build_brick_wall(materials: Materials, detail: int = 5) -> tuple[SceneBuilder, dict[str, Any]]:
    b = SceneBuilder("brick_wall_root")
    b.node_extras["brick_wall_root"] = {
        "assetId": "brick_wall", "units": "meters", "destructible": True,
        "mode": "activate", "health": 260, "breakImpulse": 18.0, "fractureGroup": "fragments",
    }
    fragments = b.group("fragments", extras={"role": "fragments", "initialHidden": False})
    width, height, depth = 4.8, 2.45, 0.36
    cols, rows = (10, 7) if detail >= 4 else (8, 5)
    brick_h = height/rows*0.90
    brick_w = width/cols*0.92
    rng = np.random.default_rng(913)
    count = 0
    for row in range(rows):
        offset = 0.5*brick_w if row % 2 else 0.0
        for col in range(cols+1):
            x = -width/2 + (col+0.5)*brick_w + offset
            if x-brick_w/2 < -width/2 or x+brick_w/2 > width/2:
                continue
            y = (row+0.5)*(height/rows)
            size = np.array([brick_w, brick_h, depth]) * rng.uniform(0.985, 1.012, 3)
            mesh = rough_superellipsoid(size, subdivisions=1 if detail < 5 else 2,
                                         power=0.24, noise=0.014, seed=1000+count)
            mesh = assign_face_projection_uv(mesh, scale=2.4)
            mass = float(np.prod(size) * 1850.0)
            b.mesh(f"brick_{count:03d}", mesh, materials.brick, parent=fragments,
                   transform=mat_translate([x, y, 0]), extras={
                       "role": "fragment", "initialHidden": False, "massKg": round(mass, 3),
                       "collider": {"type": "box", "halfExtents": (size*0.45).round(4).tolist()},
                       "friction": 0.78, "restitution": 0.12, "linearDamping": 0.06,
                       "angularDamping": 0.12, "lifetime": 28.0,
                   })
            count += 1

    # Base footing remains static and makes the wall grounded.
    footing = rough_superellipsoid([width+0.25, 0.24, depth+0.20], subdivisions=1,
                                    power=0.2, noise=0.01, seed=88)
    footing = assign_face_projection_uv(footing, scale=1.4)
    b.mesh("wall_footing", footing, materials.concrete,
           transform=mat_translate([0, 0.12, 0]), extras={
               "role": "static", "collider": {"type": "box", "halfExtents": [(width+0.25)/2, 0.12, (depth+0.2)/2]},
           })

    manifest = {
        "id": "brick_wall", "file": "models/brick_wall.glb", "mode": "activate",
        "health": 260, "breakImpulse": 18.0, "fragmentGroup": "fragments",
        "intactColliders": [{"type": "box", "halfExtents": [width/2, height/2, depth/2], "offset": [0, height/2, 0]}],
        "staticNodes": ["wall_footing"], "selectiveFracture": True,
        "material": {"densityKgM3": 1850, "friction": 0.78, "restitution": 0.12},
    }
    return b, manifest


def build_tree(materials: Materials, detail: int = 5) -> tuple[SceneBuilder, dict[str, Any]]:
    b = SceneBuilder("pine_tree_root")
    b.node_extras["pine_tree_root"] = {
        "assetId": "pine_tree", "units": "meters", "destructible": True,
        "mode": "activate", "health": 180, "breakImpulse": 15.5, "fractureGroup": "fragments",
    }
    fragments = b.group("fragments", extras={"role": "fragments", "initialHidden": False})
    height = 6.2
    segment_count = 5 if detail >= 4 else 4
    segment_h = height*0.70/segment_count
    y = 0.0
    for i in range(segment_count):
        y0 = y
        y += segment_h
        r0 = 0.34*(1-i/segment_count*0.62)
        r1 = 0.34*(1-(i+1)/segment_count*0.62)
        mesh = tapered_cylinder_y(r0, r1, segment_h, sections=18 if detail >= 4 else 12)
        mesh = assign_cylindrical_y_uv(mesh, v_scale=2.5, u_scale=2.0)
        body_type = "fixed" if i == 0 else "dynamic"
        mass = math.pi*(r0+r1)**2/4*segment_h*520
        b.mesh(f"trunk_{i:02d}", mesh, materials.bark, parent=fragments,
               transform=mat_translate([0, y0+segment_h/2, 0]), extras={
                   "role": "fragment", "initialHidden": False, "bodyType": body_type,
                   "massKg": round(mass, 2),
                   "collider": {"type": "capsule", "halfHeight": round(segment_h*0.43,4),
                                "radius": round((r0+r1)*0.23,4), "axis": "y"},
                   "friction": 0.72, "restitution": 0.05, "linearDamping": 0.18,
                   "angularDamping": 0.35, "lifetime": 35.0,
               })

    # Branch whorls and closed foliage clusters; no alpha-sorted cards.
    rng = np.random.default_rng(404)
    crown_levels = 5 if detail >= 4 else 4
    for level in range(crown_levels):
        cy = 2.2 + level*0.72
        radial = 1.55 - level*0.20
        cluster_parts = []
        branch_parts = []
        branch_count = 9 if detail >= 5 else 6
        for j in range(branch_count):
            a = 2*math.pi*j/branch_count + level*0.42
            end = np.array([radial*math.cos(a), cy+rng.uniform(-0.08,0.12), radial*math.sin(a)])
            start = np.array([0, cy-0.18, 0])
            branch_parts.append(rod(start, end, radius=0.035*(1-level/crown_levels*0.35), sections=8))
            cluster = rough_superellipsoid([0.72, 0.55, 1.15], subdivisions=1 if detail < 5 else 2,
                                           power=0.58, noise=0.08, seed=5000+level*20+j)
            cluster.apply_transform(mat_rotate(-a, [0,1,0]))
            cluster.apply_translation(np.array([end[0]*0.72, end[1]+0.12, end[2]*0.72]))
            cluster_parts.append(cluster)
        branches = trimesh.util.concatenate(branch_parts)
        branches = assign_face_projection_uv(branches, scale=1.5)
        b.mesh(f"branches_{level:02d}", branches, materials.bark, parent=fragments,
               extras={"role": "visualFragment", "parentFragment": f"crown_{level:02d}", "initialHidden": False})
        foliage = trimesh.util.concatenate(cluster_parts)
        foliage = assign_face_projection_uv(foliage, scale=0.9)
        b.mesh(f"crown_{level:02d}", foliage, materials.foliage, parent=fragments,
               extras={
                   "role": "fragment", "initialHidden": False, "massKg": round(18-level*1.8,2),
                   "collider": {"type": "ball", "radius": round(radial*0.66,3)},
                   "friction": 0.45, "restitution": 0.08, "linearDamping": 0.8,
                   "angularDamping": 1.2, "lifetime": 28.0,
               })

    top = rough_superellipsoid([0.75, 1.35, 0.75], subdivisions=2, power=0.55, noise=0.08, seed=999)
    top = assign_face_projection_uv(top, scale=1.0)
    b.mesh("crown_top", top, materials.foliage, parent=fragments,
           transform=mat_translate([0, 5.65, 0]), extras={
               "role": "fragment", "initialHidden": False, "massKg": 9.0,
               "collider": {"type": "ball", "radius": 0.48}, "linearDamping": 0.9,
               "angularDamping": 1.2, "lifetime": 28.0,
           })

    manifest = {
        "id": "pine_tree", "file": "models/pine_tree.glb", "mode": "activate",
        "health": 180, "breakImpulse": 15.5, "fragmentGroup": "fragments",
        "intactColliders": [
            {"type": "capsule", "halfHeight": 2.0, "radius": 0.30, "offset": [0, 2.15, 0]},
            {"type": "ball", "radius": 1.45, "offset": [0, 4.1, 0]},
        ],
        "breakPlaneY": 0.9, "material": {"densityKgM3": 520, "friction": 0.72, "restitution": 0.05},
    }
    return b, manifest


def build_barrel(materials: Materials, detail: int = 5) -> tuple[SceneBuilder, dict[str, Any]]:
    b = SceneBuilder("explosive_barrel_root")
    b.node_extras["explosive_barrel_root"] = {
        "assetId": "explosive_barrel", "units": "meters", "destructible": True,
        "mode": "swap", "health": 45, "breakImpulse": 7.5, "explosive": True,
        "explosionRadius": 6.5, "explosionImpulse": 34.0, "fractureGroup": "fragments", "intactGroup": "intact",
    }
    intact = b.group("intact", extras={"role": "intact", "initialHidden": False})
    fragments = b.group("fragments", extras={"role": "fragments", "initialHidden": True})
    radius, height = 0.30, 0.91
    shell = cylinder_y(radius, height, sections=48 if detail >= 4 else 24)
    # reinforcing ribs
    parts = [shell]
    for y in (-0.32, 0.0, 0.32):
        parts.append(torus_y(radius*0.96, 0.018, major_sections=48, minor_sections=6, center=[0,y,0]))
    parts.append(cylinder_y(radius*0.94, 0.025, sections=48, center=[0, height/2+0.005, 0]))
    parts.append(cylinder_y(radius*0.94, 0.025, sections=48, center=[0, -height/2-0.005, 0]))
    body = trimesh.util.concatenate(parts)
    body = assign_cylindrical_y_uv(body, v_scale=3.5, u_scale=2.0)
    b.mesh("barrel_intact_mesh", body, materials.metal, parent=intact,
           transform=mat_translate([0, height/2, 0]), extras={
               "role": "intactMesh", "collider": {"type": "cylinder", "halfHeight": height/2, "radius": radius},
               "friction": 0.58, "restitution": 0.18,
           })
    # top cap details
    cap = cylinder_y(0.048, 0.028, sections=20)
    cap = assign_cylindrical_y_uv(cap, v_scale=1.0)
    b.mesh("barrel_cap", cap, materials.metal, parent=intact,
           transform=mat_translate([0.12, height+0.02, 0.03]), extras={"role": "intactDetail"})

    shard_count = 12 if detail >= 4 else 8
    rng = np.random.default_rng(700)
    for i in range(shard_count):
        a0 = 2*math.pi*i/shard_count + rng.uniform(-0.03,0.03)
        a1 = 2*math.pi*(i+1)/shard_count + rng.uniform(-0.03,0.03)
        shard = barrel_sector(a0, a1, radius, height, thickness=0.018, segments=5 if detail >= 4 else 3)
        shard = assign_cylindrical_y_uv(shard, v_scale=3.5, u_scale=2.0)
        mid = (a0+a1)/2
        center = np.array([radius*0.94*math.cos(mid), height/2, radius*0.94*math.sin(mid)])
        shard.apply_translation(-center)
        b.mesh(f"barrel_shard_{i:02d}", shard, materials.metal, parent=fragments,
               transform=mat_translate(center), extras={
                   "role": "fragment", "initialHidden": True, "massKg": 1.25,
                   "collider": {"type": "box", "halfExtents": [0.09, height*0.43, 0.045]},
                   "friction": 0.54, "restitution": 0.20, "linearDamping": 0.06,
                   "angularDamping": 0.08, "lifetime": 24.0,
               })
    for i, y in enumerate((-0.36, 0.0, 0.36)):
        ring = torus_y(radius*0.96, 0.018, major_sections=24, minor_sections=5)
        ring = assign_cylindrical_y_uv(ring, v_scale=1.5)
        b.mesh(f"barrel_ring_{i}", ring, materials.metal, parent=fragments,
               transform=mat_translate([0, height/2+y, 0]), extras={
                   "role": "fragment", "initialHidden": True, "massKg": 0.8,
                   "collider": {"type": "ball", "radius": radius}, "lifetime": 18.0,
               })

    manifest = {
        "id": "explosive_barrel", "file": "models/explosive_barrel.glb", "mode": "swap",
        "health": 45, "breakImpulse": 7.5, "intactGroup": "intact", "fragmentGroup": "fragments",
        "explosive": {"radius": 6.5, "impulse": 34.0, "damage": 180, "upwardBias": 0.28},
        "intactColliders": [{"type": "cylinder", "halfHeight": height/2, "radius": radius, "offset": [0, height/2, 0]}],
        "material": {"densityKgM3": 7800, "friction": 0.58, "restitution": 0.18},
    }
    return b, manifest


def build_terrain(materials: Materials, detail: int = 5) -> tuple[SceneBuilder, dict[str, Any]]:
    b = SceneBuilder("terrain_patch_root")
    b.node_extras["terrain_patch_root"] = {"assetId": "terrain_patch", "units": "meters", "static": True}
    resolution = {1: 32, 2: 44, 3: 56, 4: 64, 5: 72}[detail]
    terrain = make_terrain(size=20.0, resolution=resolution)
    b.mesh("terrain_surface", terrain, materials.ground, extras={
        "role": "staticSurface", "collider": {"type": "trimesh"}, "friction": 0.96, "restitution": 0.02,
    })
    # Rocks use simple convex/box colliders.
    rng = np.random.default_rng(121)
    for i in range(14 if detail >= 4 else 7):
        x, z = rng.uniform(-8.5, 8.5, 2)
        if np.linalg.norm(np.array([x-2.5, z+2.0])) < 2.0:
            x += 3.0
        ext = rng.uniform([0.18,0.12,0.18],[0.65,0.42,0.58])
        rock = rough_superellipsoid(ext, subdivisions=1 if detail < 5 else 2,
                                    power=0.48, noise=0.11, seed=9000+i)
        rock = assign_face_projection_uv(rock, scale=1.2)
        y = 0.18 + 0.16*math.sin(x*0.34)+0.11*math.cos(z*0.29)
        b.mesh(f"terrain_rock_{i:02d}", rock, materials.concrete,
               transform=mat_translate([x, y, z]) @ mat_rotate(rng.uniform(0,math.pi), [0,1,0]), extras={
                   "role": "static", "collider": {"type": "box", "halfExtents": (ext*0.42).round(3).tolist()},
               })
    manifest = {
        "id": "terrain_patch", "file": "models/terrain_patch.glb", "static": True,
        "surfaceNode": "terrain_surface", "collider": {"type": "trimesh"},
        "material": {"friction": 0.96, "restitution": 0.02}, "sizeMeters": [20,20],
    }
    return b, manifest


def build_crater(materials: Materials, detail: int = 5) -> tuple[SceneBuilder, dict[str, Any]]:
    b = SceneBuilder("impact_crater_root")
    b.node_extras["impact_crater_root"] = {"assetId": "impact_crater", "units": "meters", "decalLike": True}
    crater = make_crater(radius=1.55, resolution_r=14 if detail >= 4 else 8,
                         resolution_a=72 if detail >= 4 else 32)
    b.mesh("crater_surface", crater, materials.ground, extras={
        "role": "staticSurface", "collider": {"type": "trimesh"}, "friction": 0.94,
    })
    rng = np.random.default_rng(319)
    for i in range(18 if detail >= 4 else 8):
        a = rng.uniform(0,2*math.pi); r=rng.uniform(0.9,1.9)
        ext = rng.uniform([0.08,0.05,0.08],[0.22,0.16,0.22])
        rock = rough_superellipsoid(ext, subdivisions=1, power=0.48, noise=0.12, seed=400+i)
        rock = assign_face_projection_uv(rock, scale=1.5)
        b.mesh(f"crater_debris_{i:02d}", rock, materials.concrete,
               transform=mat_translate([r*math.cos(a), 0.05+rng.uniform(0,0.12), r*math.sin(a)]), extras={
                   "role": "fragment", "massKg": round(float(np.prod(ext)*2200),2),
                   "collider": {"type": "box", "halfExtents": (ext*0.44).round(3).tolist()},
                   "lifetime": 18.0,
               })
    manifest = {
        "id": "impact_crater", "file": "models/impact_crater.glb", "static": True,
        "surfaceNode": "crater_surface", "radius": 1.55,
    }
    return b, manifest


def build_debris(materials: Materials, detail: int = 5) -> tuple[SceneBuilder, dict[str, Any]]:
    b = SceneBuilder("debris_pack_root")
    b.node_extras["debris_pack_root"] = {"assetId": "debris_pack", "units": "meters", "poolable": True}
    rng = np.random.default_rng(555)
    for i in range(16):
        ext = rng.uniform([0.06,0.04,0.05],[0.34,0.22,0.30])
        mesh = rough_superellipsoid(ext, subdivisions=1 if detail < 5 else 2,
                                    power=rng.uniform(0.35,0.60), noise=0.12, seed=7000+i)
        mesh = assign_face_projection_uv(mesh, scale=2.0)
        material = materials.concrete if i < 10 else materials.brick
        b.mesh(f"debris_{i:02d}", mesh, material,
               transform=mat_translate([(i%8-3.5)*0.55, ext[1]/2, (i//8)*0.8]), extras={
                   "role": "fragment", "massKg": round(float(np.prod(ext)*(2100 if i<10 else 1850)),2),
                   "collider": {"type": "box", "halfExtents": (ext*0.44).round(3).tolist()},
                   "friction": 0.8, "restitution": 0.12, "lifetime": 20.0,
               })
    manifest = {"id": "debris_pack", "file": "models/debris_pack.glb", "poolable": True,
                "nodesPrefix": "debris_", "defaultLifetime": 20.0}
    return b, manifest



def make_flat_materials() -> Materials:
    def mat(name: str, rgba: Sequence[int], rough: float, metal: float = 0.0) -> PBRMaterial:
        return PBRMaterial(name=name, baseColorFactor=list(rgba), roughnessFactor=rough,
                           metallicFactor=metal, doubleSided=False)
    return Materials(
        concrete=mat("mat_concrete_blockout", [150, 153, 158, 255], 0.82),
        brick=mat("mat_brick_blockout", [126, 55, 36, 255], 0.78),
        bark=mat("mat_bark_blockout", [78, 48, 29, 255], 0.88),
        foliage=mat("mat_foliage_blockout", [43, 93, 49, 255], 0.74),
        ground=mat("mat_ground_blockout", [74, 77, 49, 255], 0.92),
        metal=mat("mat_metal_blockout", [188, 104, 21, 255], 0.46, 0.35),
    )


def merge_visual_scene(target: SceneBuilder, source: SceneBuilder, prefix: str,
                       placement: np.ndarray, skip_prefixes: Sequence[str] = ()) -> None:
    """Merge visible geometry from one builder into a showcase scene."""
    for node_name in source.scene.graph.nodes_geometry:
        if any(node_name.startswith(p) for p in skip_prefixes):
            continue
        world, geom_name = source.scene.graph[node_name]
        mesh = source.scene.geometry[geom_name].copy()
        out_geom = f"showcase_geom__{prefix}__{node_name}"
        out_node = f"{prefix}__{node_name}"
        target.scene.geometry[out_geom] = mesh
        target.scene.graph.update(frame_from=target.root_name, frame_to=out_node,
                                  matrix=placement @ world, geometry=out_geom)


def build_showcase(materials: Materials, detail: int) -> SceneBuilder:
    show = SceneBuilder(f"destruction_pass_{detail}_root")
    show.node_extras[show.root_name] = {
        "pass": detail, "units": "meters", "upAxis": "+Y",
        "description": {
            1: "Blockout scale and silhouette",
            2: "Pre-fracture segmentation and pivots",
            3: "PBR surfaces and environment detail",
            4: "Physics-ready colliders and gameplay metadata",
            5: "Final optimized production asset pack",
        }[detail],
    }
    terrain, _ = build_terrain(materials, detail)
    block, _ = build_concrete_block(materials, detail)
    wall, _ = build_brick_wall(materials, detail)
    tree, _ = build_tree(materials, detail)
    barrel, _ = build_barrel(materials, detail)
    crater, _ = build_crater(materials, detail)
    debris, _ = build_debris(materials, detail)

    merge_visual_scene(show, terrain, "terrain", np.eye(4))
    merge_visual_scene(show, block, "block", mat_translate([-2.6, 0.15, -1.2]),
                       skip_prefixes=("chunk_", "rebar_"))
    merge_visual_scene(show, wall, "wall", mat_translate([0.0, 0.0, 4.2]))
    merge_visual_scene(show, tree, "tree", mat_translate([4.3, 0.0, 1.2]))
    merge_visual_scene(show, barrel, "barrel", mat_translate([0.8, 0.0, -2.6]),
                       skip_prefixes=("barrel_shard_", "barrel_ring_"))
    merge_visual_scene(show, crater, "crater", mat_translate([3.0, 0.12, -3.8]))
    merge_visual_scene(show, debris, "debris", mat_translate([-4.6, 0.20, -3.7]))
    return show


# -----------------------------------------------------------------------------
# Validation and rendering
# -----------------------------------------------------------------------------


def triangle_counts(gltf: dict) -> tuple[int, int]:
    accessors = gltf.get("accessors", [])
    mesh_tris = []
    for mesh in gltf.get("meshes", []):
        total = 0
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            if "indices" in prim:
                total += int(accessors[prim["indices"]]["count"]) // 3
            else:
                total += int(accessors[prim["attributes"]["POSITION"]]["count"]) // 3
        mesh_tris.append(total)
    unique = sum(mesh_tris)
    rendered = sum(mesh_tris[node["mesh"]] for node in gltf.get("nodes", []) if "mesh" in node)
    return unique, rendered


def validate_structural(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    gltf, _ = parse_glb(raw)
    unique, rendered = triangle_counts(gltf)
    scene = trimesh.load(path, force="scene", process=False)
    bounds = np.asarray(scene.bounds, dtype=float)
    nodes = [n.get("name", "") for n in gltf.get("nodes", [])]
    prims = [p for m in gltf.get("meshes", []) for p in m.get("primitives", [])]
    tangent_ready = all("TANGENT" in p.get("attributes", {})
                        for p in prims
                        if "normalTexture" in gltf.get("materials", [{}])[p.get("material", 0)])
    return {
        "file": str(path.relative_to(KIT)),
        "bytes": len(raw),
        "sha256": sha256(path),
        "glbVersion": 2,
        "nodes": len(gltf.get("nodes", [])),
        "meshes": len(gltf.get("meshes", [])),
        "materials": len(gltf.get("materials", [])),
        "textures": len(gltf.get("textures", [])),
        "images": len(gltf.get("images", [])),
        "trianglesUnique": unique,
        "trianglesRendered": rendered,
        "boundsMin": bounds[0].round(5).tolist(),
        "boundsMax": bounds[1].round(5).tolist(),
        "extents": (bounds[1]-bounds[0]).round(5).tolist(),
        "animations": len(gltf.get("animations", [])),
        "cameras": len(gltf.get("cameras", [])),
        "tangentSpaceReady": tangent_ready,
        "fragmentNodes": sum(1 for n in nodes if n.startswith(("chunk_", "brick_", "trunk_", "crown_", "barrel_shard_", "debris_"))),
        "nodeNames": nodes,
        "trimeshReload": True,
    }


def run_khronos_validator(paths: Sequence[Path]) -> dict[str, Any]:
    if not GLTF_VALIDATOR.exists():
        return {"available": False, "reason": f"not found: {GLTF_VALIDATOR}"}
    script = VALIDATION / "_run_validator.cjs"
    script.write_text(textwrap.dedent(f"""
        const fs = require('fs');
        const validator = require({json.dumps(str(GLTF_VALIDATOR))});
        const files = process.argv.slice(2);
        (async () => {{
          const result = {{}};
          for (const file of files) {{
            const data = new Uint8Array(fs.readFileSync(file));
            const report = await validator.validateBytes(data, {{ uri: file, maxIssues: 1000 }});
            result[file] = {{ validatorVersion: report.validatorVersion, issues: report.issues, info: report.info }};
          }}
          process.stdout.write(JSON.stringify(result));
        }})().catch(e => {{ console.error(e); process.exit(1); }});
    """), encoding="utf-8")
    proc = subprocess.run(["node", str(script), *map(str, paths)], capture_output=True, text=True, check=True)
    raw = json.loads(proc.stdout)
    summary = {"available": True, "files": {}}
    for file, rep in raw.items():
        rel = str(Path(file).relative_to(KIT))
        issues = rep["issues"]
        summary["files"][rel] = {
            "validatorVersion": rep.get("validatorVersion"),
            "numErrors": issues.get("numErrors", 0),
            "numWarnings": issues.get("numWarnings", 0),
            "numInfos": issues.get("numInfos", 0),
            "numHints": issues.get("numHints", 0),
            "messages": issues.get("messages", []),
        }
    summary["allZeroErrorsWarnings"] = all(
        v["numErrors"] == 0 and v["numWarnings"] == 0 for v in summary["files"].values()
    )
    return summary


def run_three_loader_test(paths: Sequence[Path]) -> dict[str, Any]:
    loader_path = THREE_NODE / "examples/jsm/loaders/GLTFLoader.js"
    if not loader_path.exists():
        return {"available": False, "reason": f"not found: {loader_path}"}
    script = VALIDATION / "_three_loader_test.mjs"
    script.write_text(textwrap.dedent(f"""
        import fs from 'node:fs';
        import {{ GLTFLoader }} from {json.dumps(loader_path.as_uri())};
        globalThis.self = globalThis;
        globalThis.ProgressEvent = class ProgressEvent {{ constructor(type, init={{}}) {{ this.type=type; Object.assign(this, init); }} }};
        globalThis.createImageBitmap = async () => ({{ width: 1, height: 1, close() {{}} }});
        const results = {{}};
        for (const file of process.argv.slice(2)) {{
          try {{
            const buf = fs.readFileSync(file);
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(arrayBuffer, '', resolve, reject));
            let meshes = 0, materials = new Set(), fragments = 0;
            gltf.scene.traverse(o => {{
              if (o.isMesh) {{ meshes++; if (o.material) materials.add(o.material.uuid); }}
              if (o.userData?.role === 'fragment') fragments++;
            }});
            results[file] = {{ ok: true, sceneName: gltf.scene.name, meshes, materials: materials.size, fragments }};
          }} catch (e) {{ results[file] = {{ ok: false, error: String(e?.stack || e) }}; }}
        }}
        process.stdout.write(JSON.stringify(results));
    """), encoding="utf-8")
    proc = subprocess.run(["node", str(script), *map(str, paths)], capture_output=True, text=True)
    if proc.returncode != 0:
        return {"available": True, "processError": proc.stderr, "files": {}}
    raw = json.loads(proc.stdout)
    return {"available": True, "files": {str(Path(k).relative_to(KIT)): v for k, v in raw.items()},
            "allLoadable": all(v.get("ok") for v in raw.values())}


def _look_at(eye: np.ndarray, target: np.ndarray, up=np.array([0.0,1.0,0.0])) -> np.ndarray:
    forward = target-eye
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, up)
    right /= np.linalg.norm(right)
    true_up = np.cross(right, forward)
    pose = np.eye(4)
    pose[:3,0] = right
    pose[:3,1] = true_up
    pose[:3,2] = -forward
    pose[:3,3] = eye
    return pose


def render_preview(glb_path: Path, output: Path, width: int, height: int,
                   camera_eye=(12.2, 8.4, 14.8), target=(0.0,1.2,0.0)) -> None:
    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
    import pyrender
    if not hasattr(np, "infty"):
        np.infty = np.inf  # type: ignore[attr-defined]
    loaded = trimesh.load(glb_path, force="scene", process=False)
    scene = pyrender.Scene(bg_color=[0.025,0.030,0.038,1.0], ambient_light=[0.21,0.22,0.24])
    material_cache: dict[str, Any] = {}
    palette = {
        "concrete": ([0.43,0.45,0.47,1], 0.02, 0.76),
        "brick": ([0.42,0.13,0.07,1], 0.0, 0.75),
        "bark": ([0.20,0.10,0.045,1], 0.0, 0.88),
        "foliage": ([0.045,0.22,0.075,1], 0.0, 0.68),
        "ground": ([0.18,0.20,0.10,1], 0.0, 0.88),
        "metal": ([0.68,0.28,0.025,1], 0.35, 0.40),
    }
    for mesh in loaded.dump(concatenate=False):
        mat_name = str(getattr(getattr(mesh.visual, "material", None), "name", "")).lower()
        key = next((k for k in palette if k in mat_name), "concrete")
        if key not in material_cache:
            color, metal, rough = palette[key]
            material_cache[key] = pyrender.MetallicRoughnessMaterial(
                baseColorFactor=color, metallicFactor=metal, roughnessFactor=rough)
        scene.add(pyrender.Mesh.from_trimesh(mesh, material=material_cache[key], smooth=True))

    camera = pyrender.PerspectiveCamera(yfov=math.radians(38), aspectRatio=width/height, znear=0.05, zfar=80)
    scene.add(camera, pose=_look_at(np.array(camera_eye,dtype=float), np.array(target,dtype=float)))
    key = pyrender.DirectionalLight(color=np.array([1.0,0.95,0.86]), intensity=4.5)
    fill = pyrender.DirectionalLight(color=np.array([0.65,0.78,1.0]), intensity=2.2)
    rim = pyrender.DirectionalLight(color=np.array([1.0,0.62,0.32]), intensity=2.6)
    scene.add(key, pose=_look_at(np.array([7,12,4],dtype=float), np.zeros(3)))
    scene.add(fill, pose=_look_at(np.array([-8,6,9],dtype=float), np.zeros(3)))
    scene.add(rim, pose=_look_at(np.array([-4,8,-10],dtype=float), np.zeros(3)))
    renderer = pyrender.OffscreenRenderer(width, height)
    color, _ = renderer.render(scene, flags=pyrender.RenderFlags.RGBA | pyrender.RenderFlags.SHADOWS_DIRECTIONAL)
    renderer.delete()
    Image.fromarray(color, mode="RGBA").save(output, optimize=True)


def make_five_pass_contact_sheet(pass_images: Sequence[Path], output: Path) -> None:
    canvas = Image.new("RGB", (3840, 2160), (15, 18, 24))
    draw = ImageDraw.Draw(canvas)
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    try:
        font = ImageFont.truetype(font_path, 32)
        title_font = ImageFont.truetype(bold_path, 52)
    except OSError:
        font = ImageFont.load_default()
        title_font = ImageFont.load_default()
    draw.text((110, 54), "THREE.JS DESTRUCTION KIT - FIVE PRODUCTION PASSES",
              fill=(235, 238, 244), font=title_font)
    slots = [
        (80, 150, 1800, 900), (1960, 150, 1800, 900),
        (80, 1160, 1160, 820), (1340, 1160, 1160, 820), (2600, 1160, 1160, 820),
    ]
    labels = [
        "PASS 1 - BLOCKOUT / SCALE",
        "PASS 2 - FRACTURE / PIVOTS",
        "PASS 3 - PBR / SURFACES",
        "PASS 4 - PHYSICS / COLLIDERS",
        "PASS 5 - FINAL / OPTIMIZED",
    ]
    for img_path, (x, y, w, h), label in zip(pass_images, slots, labels):
        img = Image.open(img_path).convert("RGB")
        img.thumbnail((w, h - 64), Image.Resampling.LANCZOS)
        px = x + (w - img.width) // 2
        py = y + 54 + (h - 64 - img.height) // 2
        canvas.paste(img, (px, py))
        draw.rounded_rectangle((x, y, x + w, y + 46), radius=8, fill=(35, 42, 54))
        draw.text((x + 16, y + 7), label, fill=(240, 242, 246), font=font)
    canvas.save(output, quality=94, optimize=True)


# -----------------------------------------------------------------------------
# Runtime and demo files
# -----------------------------------------------------------------------------


def write_runtime_files(manifest: dict[str, Any]) -> None:
    json_dump(PHYSICS / "asset-manifest.json", manifest)
    json_dump(PHYSICS / "material-presets.json", {
        "units": "SI: meters, kilograms, seconds",
        "materials": {
            "concrete": {"densityKgM3": 2100, "friction": 0.84, "restitution": 0.08},
            "brick": {"densityKgM3": 1850, "friction": 0.78, "restitution": 0.12},
            "wood": {"densityKgM3": 520, "friction": 0.72, "restitution": 0.05},
            "soil": {"friction": 0.96, "restitution": 0.02},
            "steel": {"densityKgM3": 7800, "friction": 0.58, "restitution": 0.18},
        },
    })

    (PHYSICS / "destruction-system.js").write_text(textwrap.dedent(r'''
        /** Three.js + Rapier pre-fractured destruction runtime.
         *  GLB extras are preserved by GLTFLoader as Object3D.userData.
         */
        export class DestructionSystem {
          constructor({ THREE, RAPIER, scene, fixedTimeStep = 1 / 60, maxBodies = 320 }) {
            if (!THREE || !RAPIER || !scene) throw new Error('THREE, RAPIER and scene are required');
            this.THREE = THREE;
            this.RAPIER = RAPIER;
            this.scene = scene;
            this.fixedTimeStep = fixedTimeStep;
            this.maxBodies = maxBodies;
            this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
            this.world.timestep = fixedTimeStep;
            this.accumulator = 0;
            this.instances = new Set();
            this.dynamic = [];
            this.objectToInstance = new WeakMap();
            this.tmpPosition = new THREE.Vector3();
            this.tmpQuaternion = new THREE.Quaternion();
            this.tmpScale = new THREE.Vector3();
          }

          async loadManifest(url) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Manifest load failed: ${response.status} ${url}`);
            const data = await response.json();
            this.manifest = data;
            this.assetMap = new Map(data.assets.map(a => [a.id, a]));
            return data;
          }

          async spawn(loader, assetId, url, { position, quaternion, scale = 1 } = {}) {
            const def = this.assetMap?.get(assetId);
            if (!def) throw new Error(`Unknown destruction asset: ${assetId}`);
            const gltf = await loader.loadAsync(url ?? def.file);
            const root = gltf.scene;
            root.name = root.name || `${assetId}_instance`;
            if (position) root.position.copy(position);
            if (quaternion) root.quaternion.copy(quaternion);
            root.scale.setScalar(scale);
            this.scene.add(root);
            root.updateMatrixWorld(true);
            return this.register(root, def);
          }

          register(root, def) {
            const instance = {
              root, def, health: def.health ?? Infinity, fractured: false,
              intactBody: null, intactColliders: [], staticBodies: [], bodies: [], bornAt: performance.now() * 0.001,
            };
            root.userData.destructionInstance = instance;
            root.traverse(o => this.objectToInstance.set(o, instance));

            const fragmentGroup = def.fragmentGroup ? root.getObjectByName(def.fragmentGroup) : null;
            const intactGroup = def.intactGroup ? root.getObjectByName(def.intactGroup) : null;
            instance.fragmentGroup = fragmentGroup;
            instance.intactGroup = intactGroup;
            if (fragmentGroup && def.mode === 'swap') fragmentGroup.visible = false;
            if (intactGroup) intactGroup.visible = true;

            // Bind purely visual branches to their physics fragment before activation.
            if (fragmentGroup) {
              const visuals = [];
              fragmentGroup.traverse(o => { if (o.userData?.role === 'visualFragment') visuals.push(o); });
              for (const visual of visuals) {
                const parent = fragmentGroup.getObjectByName(visual.userData.parentFragment);
                if (parent) parent.attach(visual);
              }
            }

            if (def.static) this.#registerStatic(instance);
            else this.#createIntactBody(instance);
            this.#registerPermanentStatics(instance);
            this.instances.add(instance);
            return instance;
          }

          #rootPose(root) {
            root.updateMatrixWorld(true);
            root.matrixWorld.decompose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
            return {
              position: this.tmpPosition.clone(), quaternion: this.tmpQuaternion.clone(), scale: this.tmpScale.clone()
            };
          }

          #createIntactBody(instance) {
            const { position, quaternion, scale } = this.#rootPose(instance.root);
            const desc = this.RAPIER.RigidBodyDesc.fixed()
              .setTranslation(position.x, position.y, position.z)
              .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
            const body = this.world.createRigidBody(desc);
            instance.intactBody = body;
            for (const shape of instance.def.intactColliders ?? []) {
              const scaledShape = this.#scaledShape(shape, scale);
              const colliderDesc = this.#colliderDesc(scaledShape, shape.massKg);
              const offset = shape.offset ?? [0, 0, 0];
              colliderDesc.setTranslation(offset[0] * scale.x, offset[1] * scale.y, offset[2] * scale.z);
              colliderDesc.setFriction(instance.def.material?.friction ?? 0.7);
              colliderDesc.setRestitution(instance.def.material?.restitution ?? 0.08);
              instance.intactColliders.push(this.world.createCollider(colliderDesc, body));
            }
          }

          #registerStatic(instance) {
            const nodeName = instance.def.surfaceNode;
            if (!nodeName) return this.#createIntactBody(instance);
            const mesh = instance.root.getObjectByName(nodeName);
            if (!mesh?.geometry) return this.#createIntactBody(instance);
            mesh.updateMatrixWorld(true);
            const pos = mesh.geometry.attributes.position;
            const vertices = new Float32Array(pos.count * 3);
            const v = new this.THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
              vertices.set([v.x, v.y, v.z], i * 3);
            }
            const index = mesh.geometry.index;
            const indices = index ? new Uint32Array(index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
            const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed());
            const collider = this.RAPIER.ColliderDesc.trimesh(vertices, indices)
              .setFriction(instance.def.material?.friction ?? 0.95)
              .setRestitution(instance.def.material?.restitution ?? 0.02);
            this.world.createCollider(collider, body);
            instance.intactBody = body;
          }

          #scaledShape(shape, scale) {
            const sx = Math.abs(scale?.x ?? 1);
            const sy = Math.abs(scale?.y ?? 1);
            const sz = Math.abs(scale?.z ?? 1);
            const scaled = { ...shape };
            if (shape.type === 'box' && shape.halfExtents) {
              scaled.halfExtents = [shape.halfExtents[0] * sx, shape.halfExtents[1] * sy, shape.halfExtents[2] * sz];
            } else if (shape.type === 'ball') {
              scaled.radius = shape.radius * Math.max(sx, sy, sz);
            } else if (shape.type === 'capsule') {
              const axis = shape.axis ?? 'y';
              const axial = axis === 'x' ? sx : axis === 'z' ? sz : sy;
              const radial = axis === 'x' ? Math.max(sy, sz) : axis === 'z' ? Math.max(sx, sy) : Math.max(sx, sz);
              scaled.halfHeight = shape.halfHeight * axial;
              scaled.radius = shape.radius * radial;
            } else if (shape.type === 'cylinder') {
              scaled.halfHeight = shape.halfHeight * sy;
              scaled.radius = shape.radius * Math.max(sx, sz);
            }
            return scaled;
          }

          #registerPermanentStatics(instance) {
            const configured = new Set(instance.def.staticNodes ?? []);
            const surfaceNode = instance.def.surfaceNode;
            instance.root.updateMatrixWorld(true);
            instance.root.traverse(node => {
              const data = node.userData;
              const isPermanent = data?.role === 'static' || configured.has(node.name);
              if (!isPermanent || !data?.collider || node.name === surfaceNode) return;
              node.updateMatrixWorld(true);
              node.matrixWorld.decompose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
              const rbDesc = this.RAPIER.RigidBodyDesc.fixed()
                .setTranslation(this.tmpPosition.x, this.tmpPosition.y, this.tmpPosition.z)
                .setRotation({ x: this.tmpQuaternion.x, y: this.tmpQuaternion.y, z: this.tmpQuaternion.z, w: this.tmpQuaternion.w });
              const body = this.world.createRigidBody(rbDesc);
              const shape = this.#scaledShape(data.collider, this.tmpScale);
              const collider = this.#colliderDesc(shape)
                .setFriction(data.friction ?? instance.def.material?.friction ?? 0.8)
                .setRestitution(data.restitution ?? instance.def.material?.restitution ?? 0.05);
              this.world.createCollider(collider, body);
              instance.staticBodies.push(body);
            });
          }

          #colliderDesc(shape, massKg) {
            const R = this.RAPIER;
            let desc;
            switch (shape.type) {
              case 'ball': desc = R.ColliderDesc.ball(shape.radius); break;
              case 'capsule': {
                desc = R.ColliderDesc.capsule(shape.halfHeight, shape.radius);
                const s = Math.SQRT1_2;
                if (shape.axis === 'x') desc.setRotation({ x: 0, y: 0, z: s, w: s });
                if (shape.axis === 'z') desc.setRotation({ x: s, y: 0, z: 0, w: s });
                break;
              }
              case 'cylinder': desc = R.ColliderDesc.cylinder(shape.halfHeight, shape.radius); break;
              case 'box':
              default: desc = R.ColliderDesc.cuboid(...shape.halfExtents); break;
            }
            if (massKg && Number.isFinite(massKg)) desc.setMass(Math.max(0.02, massKg));
            return desc;
          }

          resolveInstance(target) {
            let object = target;
            while (object) {
              const instance = this.objectToInstance.get(object) ?? object.userData?.destructionInstance;
              if (instance) return instance;
              object = object.parent;
            }
            return null;
          }

          reportImpact(target, { impulse = 0, kineticEnergy = 0, point = null } = {}) {
            const instance = this.resolveInstance(target);
            if (!instance || instance.fractured || instance.def.static) return false;
            const damage = kineticEnergy * 0.18 + Math.max(0, impulse - (instance.def.breakImpulse ?? Infinity)) * 4.0;
            instance.health -= damage;
            if (impulse >= (instance.def.breakImpulse ?? Infinity) || instance.health <= 0) {
              this.fracture(instance, point ?? this.#rootPose(instance.root).position, impulse);
              return true;
            }
            return false;
          }

          damage(target, amount, point, impulse = 0) {
            const instance = this.resolveInstance(target);
            if (!instance || instance.fractured || instance.def.static) return false;
            instance.health -= amount;
            if (instance.health <= 0 || impulse >= (instance.def.breakImpulse ?? Infinity)) {
              this.fracture(instance, point ?? this.#rootPose(instance.root).position, impulse);
              return true;
            }
            return false;
          }

          fracture(instance, origin, impulse = 12) {
            if (instance.fractured || instance.def.static) return;
            instance.fractured = true;
            if (instance.intactBody) {
              this.world.removeRigidBody(instance.intactBody);
              instance.intactBody = null;
            }
            if (instance.intactGroup) instance.intactGroup.visible = false;
            if (instance.fragmentGroup) instance.fragmentGroup.visible = true;
            const fragments = [];
            instance.fragmentGroup?.traverse(o => { if (o.userData?.role === 'fragment') fragments.push(o); });
            for (const node of fragments) this.#activateFragment(instance, node, origin, impulse);
            this.#trimBodies();
          }

          #activateFragment(instance, node, origin, impulse) {
            node.updateMatrixWorld(true);
            node.matrixWorld.decompose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
            const bodyType = node.userData.bodyType === 'fixed' ? 'fixed' : 'dynamic';
            const rbDesc = bodyType === 'fixed' ? this.RAPIER.RigidBodyDesc.fixed() : this.RAPIER.RigidBodyDesc.dynamic();
            rbDesc.setTranslation(this.tmpPosition.x, this.tmpPosition.y, this.tmpPosition.z)
              .setRotation({ x: this.tmpQuaternion.x, y: this.tmpQuaternion.y, z: this.tmpQuaternion.z, w: this.tmpQuaternion.w });
            if (bodyType === 'dynamic') {
              rbDesc.setLinearDamping(node.userData.linearDamping ?? 0.08)
                .setAngularDamping(node.userData.angularDamping ?? 0.16)
                .setCanSleep(true)
                .setCcdEnabled(true);
            }
            const body = this.world.createRigidBody(rbDesc);
            const shape = node.userData.collider ?? { type: 'box', halfExtents: [0.1, 0.1, 0.1] };
            const scaledShape = this.#scaledShape(shape, this.tmpScale);
            const collider = this.#colliderDesc(scaledShape, node.userData.massKg)
              .setFriction(node.userData.friction ?? instance.def.material?.friction ?? 0.7)
              .setRestitution(node.userData.restitution ?? instance.def.material?.restitution ?? 0.08);
            this.world.createCollider(collider, body);

            this.scene.attach(node);
            node.visible = true;
            const record = {
              node, body, instance, bornAt: performance.now() * 0.001,
              lifetime: node.userData.lifetime ?? 24, fixed: bodyType === 'fixed'
            };
            instance.bodies.push(record);
            this.dynamic.push(record);

            if (bodyType === 'dynamic') {
              const dir = this.tmpPosition.clone().sub(origin);
              const distance = Math.max(0.22, dir.length());
              dir.normalize();
              dir.y += 0.18;
              dir.normalize();
              const jitter = 0.82 + Math.random() * 0.36;
              const magnitude = Math.max(1.5, impulse) * jitter / Math.sqrt(distance);
              body.applyImpulse({ x: dir.x*magnitude, y: dir.y*magnitude, z: dir.z*magnitude }, true);
              body.applyTorqueImpulse({
                x: (Math.random()-0.5)*magnitude*0.45,
                y: (Math.random()-0.5)*magnitude*0.45,
                z: (Math.random()-0.5)*magnitude*0.45,
              }, true);
            }
          }

          explode(point, { radius = 6, impulse = 30, damage = 160, upwardBias = 0.25 } = {}) {
            const p = point.isVector3 ? point : new this.THREE.Vector3(point.x, point.y, point.z);
            for (const instance of this.instances) {
              if (instance.def.static) continue;
              const center = this.#rootPose(instance.root).position;
              const distance = center.distanceTo(p);
              if (distance > radius) continue;
              const falloff = Math.max(0, 1 - distance / radius);
              if (!instance.fractured) {
                instance.health -= damage * falloff;
                if (instance.health <= 0 || impulse * falloff >= (instance.def.breakImpulse ?? Infinity)) {
                  this.fracture(instance, p, impulse * (0.35 + falloff));
                }
              }
            }
            for (const record of this.dynamic) {
              if (record.fixed) continue;
              const t = record.body.translation();
              const dir = new this.THREE.Vector3(t.x, t.y, t.z).sub(p);
              const distance = dir.length();
              if (distance > radius || distance < 1e-4) continue;
              const falloff = (1 - distance / radius) ** 2;
              dir.normalize(); dir.y += upwardBias; dir.normalize();
              const j = impulse * falloff;
              record.body.applyImpulse({ x: dir.x*j, y: dir.y*j, z: dir.z*j }, true);
            }
          }

          step(deltaSeconds) {
            this.accumulator = Math.min(this.accumulator + Math.min(deltaSeconds, 0.1), 0.25);
            while (this.accumulator >= this.fixedTimeStep) {
              this.world.step();
              this.accumulator -= this.fixedTimeStep;
            }
            const now = performance.now() * 0.001;
            for (let i = this.dynamic.length - 1; i >= 0; i--) {
              const record = this.dynamic[i];
              const t = record.body.translation();
              const r = record.body.rotation();
              record.node.position.set(t.x, t.y, t.z);
              record.node.quaternion.set(r.x, r.y, r.z, r.w);
              if (!record.fixed && now - record.bornAt > record.lifetime && record.body.isSleeping()) {
                this.world.removeRigidBody(record.body);
                record.node.removeFromParent();
                this.dynamic.splice(i, 1);
              }
            }
          }

          #trimBodies() {
            let dynamicCount = this.dynamic.reduce((count, record) => count + (record.fixed ? 0 : 1), 0);
            while (dynamicCount > this.maxBodies) {
              const index = this.dynamic.findIndex(record => !record.fixed);
              if (index < 0) break;
              const [record] = this.dynamic.splice(index, 1);
              this.world.removeRigidBody(record.body);
              record.node.removeFromParent();
              dynamicCount--;
            }
          }

          dispose() {
            for (const record of this.dynamic) this.world.removeRigidBody(record.body);
            for (const instance of this.instances) {
              if (instance.intactBody) this.world.removeRigidBody(instance.intactBody);
              for (const body of instance.staticBodies) this.world.removeRigidBody(body);
            }
            this.dynamic.length = 0;
            this.instances.clear();
          }
        }
    ''').strip() + "\n", encoding="utf-8")

    (PHYSICS / "explosion-vfx.js").write_text(textwrap.dedent(r'''
        export function spawnExplosionVFX(THREE, scene, point, { radius = 2.4, duration = 0.75 } = {}) {
          const group = new THREE.Group();
          group.position.copy(point);
          scene.add(group);

          const flash = new THREE.PointLight(0xff9a45, 28, radius * 5, 2);
          group.add(flash);
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.16, 0.22, 48),
            new THREE.MeshBasicMaterial({ color: 0xffb25f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
          );
          ring.rotation.x = -Math.PI / 2;
          group.add(ring);

          const count = 140;
          const positions = new Float32Array(count * 3);
          const velocities = [];
          for (let i = 0; i < count; i++) {
            const v = new THREE.Vector3().randomDirection();
            v.y = Math.abs(v.y) * 0.9 + 0.1;
            v.normalize().multiplyScalar(radius * (0.8 + Math.random() * 2.2));
            velocities.push(v);
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          const points = new THREE.Points(geometry, new THREE.PointsMaterial({
            color: 0xff8a2a, size: 0.11, transparent: true, opacity: 0.95,
            blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
          }));
          group.add(points);
          const started = performance.now() * 0.001;

          function update() {
            const age = performance.now() * 0.001 - started;
            const t = Math.min(1, age / duration);
            for (let i = 0; i < count; i++) {
              positions[i*3] = velocities[i].x * age;
              positions[i*3+1] = velocities[i].y * age - 2.8 * age * age;
              positions[i*3+2] = velocities[i].z * age;
            }
            geometry.attributes.position.needsUpdate = true;
            ring.scale.setScalar(1 + t * radius * 3.2);
            ring.material.opacity = (1 - t) * 0.8;
            points.material.opacity = (1 - t) ** 1.5;
            flash.intensity = 28 * (1 - t) ** 3;
            if (t < 1) requestAnimationFrame(update);
            else {
              group.removeFromParent();
              geometry.dispose(); points.material.dispose();
              ring.geometry.dispose(); ring.material.dispose();
            }
          }
          update();
        }
    ''').strip() + "\n", encoding="utf-8")

    (PHYSICS / "drone-proxy.js").write_text(textwrap.dedent(r'''
        /** Kinematic Rapier proxy for a Three.js drone controlled by an existing flight loop.
         *  Dynamic debris collides with this body while the visual drone remains authoritative.
         */
        export class RapierDroneProxy {
          constructor({ THREE, RAPIER, system, object3D,
            halfExtents = [0.28, 0.09, 0.24], massKg = 0.8,
            friction = 0.55, restitution = 0.04, collisionGroups = null }) {
            if (!THREE || !RAPIER || !system || !object3D) {
              throw new Error('THREE, RAPIER, system and object3D are required');
            }
            this.THREE = THREE;
            this.RAPIER = RAPIER;
            this.system = system;
            this.object3D = object3D;
            this.massKg = massKg;
            this.previousPosition = new THREE.Vector3();
            this.linearVelocity = new THREE.Vector3();
            this.position = new THREE.Vector3();
            this.quaternion = new THREE.Quaternion();
            this.scale = new THREE.Vector3();
            this.initialized = false;

            const pose = this.#readPose();
            const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
              .setTranslation(pose.position.x, pose.position.y, pose.position.z)
              .setRotation({ x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w });
            this.body = system.world.createRigidBody(bodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(...halfExtents)
              .setFriction(friction)
              .setRestitution(restitution);
            if (collisionGroups != null) colliderDesc.setCollisionGroups(collisionGroups);
            this.collider = system.world.createCollider(colliderDesc, this.body);
            this.previousPosition.copy(pose.position);
            this.initialized = true;
          }

          #readPose() {
            this.object3D.updateMatrixWorld(true);
            this.object3D.matrixWorld.decompose(this.position, this.quaternion, this.scale);
            return { position: this.position, quaternion: this.quaternion };
          }

          /** Call immediately before system.step(dt). */
          sync(deltaSeconds) {
            const pose = this.#readPose();
            const dt = Math.max(1e-4, Math.min(deltaSeconds || 0, 0.1));
            if (this.initialized && dt > 0) {
              this.linearVelocity.copy(pose.position).sub(this.previousPosition).multiplyScalar(1 / dt);
            }
            this.previousPosition.copy(pose.position);
            this.body.setNextKinematicTranslation({ x: pose.position.x, y: pose.position.y, z: pose.position.z });
            this.body.setNextKinematicRotation({
              x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w,
            });
          }

          /** Report a game-side contact using the proxy's measured world velocity. */
          reportImpact(target, point, relativeSpeedMps = this.linearVelocity.length()) {
            const speed = Math.max(0, relativeSpeedMps);
            return this.system.reportImpact(target, {
              impulse: this.massKg * speed,
              kineticEnergy: 0.5 * this.massKg * speed * speed,
              point,
            });
          }

          dispose() {
            if (this.body) this.system.world.removeRigidBody(this.body);
            this.body = null;
            this.collider = null;
          }
        }
    ''').strip() + "\n", encoding="utf-8")

    (PHYSICS / "flightverse-integration.js").write_text(textwrap.dedent(r'''
        import { DestructionSystem } from './destruction-system.js';
        import { spawnExplosionVFX } from './explosion-vfx.js';
        import { RapierDroneProxy } from './drone-proxy.js';

        /** Drop-in adapter for an existing Three.js drone scene.
         *  Call update(dt) from the existing render loop and reportDroneImpact(...)
         *  from the game's collision callback.
         */
        export async function installDestructionKit({ THREE, RAPIER, GLTFLoader, scene,
          baseUrl = './assets/destruction', spawnDefaults = true }) {
          await RAPIER.init();
          const system = new DestructionSystem({ THREE, RAPIER, scene });
          await system.loadManifest(`${baseUrl}/physics/asset-manifest.json`);
          const loader = new GLTFLoader();
          let droneProxy = null;

          const spawn = (id, position, rotationY = 0) => system.spawn(
            loader, id, `${baseUrl}/${system.assetMap.get(id).file}`,
            { position: new THREE.Vector3(...position), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotationY) }
          );

          if (spawnDefaults) {
            await Promise.all([
              spawn('terrain_patch', [0, 0, 0]),
              spawn('brick_wall', [0, 0, -8]),
              spawn('concrete_block', [-3, 0.1, -3]),
              spawn('pine_tree', [5, 0, -1]),
              spawn('explosive_barrel', [1.5, 0, -3.5]),
            ]);
          }

          function attachDroneProxy(droneObject, options = {}) {
            droneProxy?.dispose();
            droneProxy = new RapierDroneProxy({ THREE, RAPIER, system, object3D: droneObject, ...options });
            return droneProxy;
          }

          function reportDroneImpact(hitObject, point, relativeSpeedMps, droneMassKg = 0.8) {
            if (droneProxy && relativeSpeedMps == null) return droneProxy.reportImpact(hitObject, point);
            const speed = Math.max(0, relativeSpeedMps ?? 0);
            const impulse = droneMassKg * speed;
            const kineticEnergy = 0.5 * droneMassKg * speed * speed;
            return system.reportImpact(hitObject, { impulse, kineticEnergy, point });
          }

          function explode(point, options) {
            system.explode(point, options);
            spawnExplosionVFX(THREE, scene, point, options);
          }

          const api = {
            system,
            update: dt => { droneProxy?.sync(dt); system.step(dt); },
            reportDroneImpact, attachDroneProxy, explode, spawn,
            dispose: () => { droneProxy?.dispose(); system.dispose(); },
          };
          globalThis.__destruction = api;
          return api;
        }
    ''').strip() + "\n", encoding="utf-8")


def write_demo_files() -> None:
    DEMO.mkdir(parents=True, exist_ok=True)
    (DEMO / "index.html").write_text(textwrap.dedent('''
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Three.js Destruction Kit</title>
          <link rel="stylesheet" href="./styles.css" />
          <script type="importmap">
          {"imports":{
            "three":"https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
            "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"
          }}
          </script>
        </head>
        <body>
          <div id="hud">
            <strong>DESTRUCTION KIT / RAPIER</strong>
            <span>Click: impact · Space: barrel blast · R: reset camera</span>
            <span id="stats">loading…</span>
          </div>
          <canvas id="app"></canvas>
          <script type="module" src="./main.js"></script>
        </body>
        </html>
    ''').strip()+"\n", encoding="utf-8")
    (DEMO / "styles.css").write_text(textwrap.dedent('''
        *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b0e13;color:#eef2f8;font:13px/1.4 system-ui,sans-serif}
        #app{display:block;width:100%;height:100%}#hud{position:fixed;z-index:5;left:18px;top:18px;display:grid;gap:4px;padding:12px 14px;border:1px solid #ffffff24;border-radius:10px;background:#0a0d13cc;backdrop-filter:blur(12px);pointer-events:none}
        #hud strong{letter-spacing:.12em}#hud span{color:#aeb8c8}
    ''').strip()+"\n", encoding="utf-8")
    (DEMO / "main.js").write_text(textwrap.dedent(r'''
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import RAPIER from 'https://esm.sh/@dimforge/rapier3d-compat@0.19.3';
        import { DestructionSystem } from '../physics/destruction-system.js';
        import { spawnExplosionVFX } from '../physics/explosion-vfx.js';

        await RAPIER.init();
        const canvas = document.querySelector('#app');
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setSize(innerWidth, innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x9db1c4);
        scene.fog = new THREE.FogExp2(0x9db1c4, 0.018);
        const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.05, 150);
        camera.position.set(11, 7, 14);
        const controls = new OrbitControls(camera, canvas);
        controls.target.set(0, 1.5, 0);
        controls.enableDamping = true;
        controls.maxPolarAngle = Math.PI * 0.48;

        scene.add(new THREE.HemisphereLight(0xd9ebff, 0x27301e, 2.2));
        const sun = new THREE.DirectionalLight(0xfff1d4, 4.2);
        sun.position.set(9, 14, 5); sun.castShadow = true;
        sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-18;sun.shadow.camera.right=18;sun.shadow.camera.top=18;sun.shadow.camera.bottom=-18;
        scene.add(sun);

        const system = new DestructionSystem({ THREE, RAPIER, scene, maxBodies: 360 });
        await system.loadManifest('../physics/asset-manifest.json');
        const loader = new GLTFLoader();
        const spawn = async (id, p, ry=0) => {
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),ry);
          const inst = await system.spawn(loader,id,`../${system.assetMap.get(id).file}`,{position:new THREE.Vector3(...p),quaternion:q});
          inst.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
          return inst;
        };
        const assets = await Promise.all([
          spawn('terrain_patch',[0,0,0]),
          spawn('brick_wall',[0,0,-6.2]),
          spawn('concrete_block',[-3.2,0.12,-2.2],0.18),
          spawn('pine_tree',[4.6,0,-0.5],-0.2),
          spawn('explosive_barrel',[1.1,0,-2.6]),
        ]);
        const barrel = assets[4];

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        canvas.addEventListener('pointerdown', e => {
          pointer.x = e.clientX/innerWidth*2-1; pointer.y = -(e.clientY/innerHeight)*2+1;
          raycaster.setFromCamera(pointer,camera);
          const hits = raycaster.intersectObjects(scene.children,true).filter(h=>system.resolveInstance(h.object));
          if(!hits.length) return;
          const hit=hits[0];
          const broke=system.damage(hit.object,70,hit.point,11);
          if(broke) spawnExplosionVFX(THREE,scene,hit.point,{radius:0.75,duration:0.42});
        });
        addEventListener('keydown',e=>{
          if(e.code==='Space'){
            const p=new THREE.Vector3();barrel.root.getWorldPosition(p);
            system.damage(barrel.root,999,p,40);
            const blast=barrel.def.explosive;
            system.explode(p,blast);spawnExplosionVFX(THREE,scene,p,{radius:2.8,duration:0.85});
          }
          if(e.code==='KeyR'){camera.position.set(11,7,14);controls.target.set(0,1.5,0);}
        });

        const clock=new THREE.Clock();
        function frame(){requestAnimationFrame(frame);const dt=clock.getDelta();system.step(dt);controls.update();renderer.render(scene,camera);
          document.querySelector('#stats').textContent=`bodies ${system.dynamic.length} · assets ${system.instances.size}`;}
        frame();
        addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
    ''').strip()+"\n", encoding="utf-8")

    (DEMO / "README.md").write_text(textwrap.dedent('''
        # Demo

        From the kit root, serve the files over HTTP:

        ```bash
        python3 -m http.server 8080
        ```

        Open `http://localhost:8080/demo/`. The demo imports Three.js 0.185.1 and Rapier 0.19.3 from CDNs.
        Click an object to apply impact damage. Press **Space** to detonate the barrel.
    ''').strip()+"\n", encoding="utf-8")


def write_readme(reports: list[dict[str, Any]], validator: dict[str, Any]) -> None:
    table = "\n".join(
        f"| `{r['file']}` | {r['trianglesRendered']:,} | {r['materials']} | {r['bytes']/1024:.1f} KB |"
        for r in reports if r["file"].startswith("models/")
    )
    zero = validator.get("allZeroErrorsWarnings", False)
    (KIT / "README.md").write_text(textwrap.dedent(f'''
        # Three.js Destruction Environment Kit

        Original, brand-free GLB assets for a drone game. All models use **meters**, **+Y up**, and normal glTF 2.0 node hierarchies. The production GLBs embed 1K PBR base-color, normal and ORM maps; editable 4K sources are under `textures/source_4k/`.

        ## Final assets

        | File | Rendered triangles | Materials | Size |
        |---|---:|---:|---:|
        {table}

        Khronos validation: **{'0 errors and 0 warnings for every GLB' if zero else 'see validation/gltf-validator-report.json'}**.

        ## Runtime behavior

        - `concrete_block.glb`: intact shell swaps to 12 centered chunks plus rebar.
        - `brick_wall.glb`: staggered bricks are visible from frame one and become dynamic on fracture.
        - `pine_tree.glb`: fixed stump, dynamic trunk logs, crown bodies and attached branch visuals.
        - `explosive_barrel.glb`: intact barrel swaps to curved shell shards and rings; manifest defines blast radius/impulse.
        - `terrain_patch.glb`: static triangle-mesh surface with rocks; never use its triangle mesh as a dynamic body.
        - `impact_crater.glb`: crater surface and ejecta for persistent blast marks.
        - `debris_pack.glb`: pooled concrete/brick fragments.

        `physics/destruction-system.js` uses simple box, ball, capsule and cylinder colliders for dynamic debris. It runs a fixed 60 Hz Rapier step, enables CCD on fast fragments, allows sleeping, applies radial impulse falloff and removes old sleeping bodies.

        ## Existing Three.js page

        Copy the entire folder to, for example, `web/assets/destruction/`, then import:

        ```js
        import {{ installDestructionKit }} from './assets/destruction/physics/flightverse-integration.js';

        const destruction = await installDestructionKit({{
          THREE,
          RAPIER,
          GLTFLoader,
          scene,
          baseUrl: './assets/destruction'
        }});

        // Existing render loop:
        destruction.update(deltaSeconds);

        // Existing drone/contact callback:
        destruction.reportDroneImpact(hitObject, hitPoint, relativeSpeedMps, droneMassKg);
        ```

        The adapter exposes `window.__destruction` for debugging. Call `__destruction.explode(point, options)` for scripted blasts.

        ## Five passes

        1. Blockout and real-world scale.
        2. Pre-fracture segmentation with centered pivots.
        3. Detailed geometry and PBR surfaces.
        4. Collider metadata, mass, damping, thresholds and cleanup policy.
        5. Final hierarchy, tangents, validation, demo and web optimization.

        ## Regeneration

        ```bash
        python3 generate_destruction_kit.py
        ```
    ''').strip()+"\n", encoding="utf-8")


# -----------------------------------------------------------------------------
# Main build
# -----------------------------------------------------------------------------


def clean_output() -> None:
    if KIT.exists():
        shutil.rmtree(KIT)
    for d in (MODELS, PASSES, TEXTURES_1K, TEXTURES_4K, PHYSICS, DEMO, VALIDATION, PREVIEWS):
        d.mkdir(parents=True, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-preview", action="store_true")
    parser.add_argument("--no-4k", action="store_true", help="Delete optional 4K source maps after generation")
    args = parser.parse_args()

    clean_output()
    textures = generate_texture_library()
    materials = make_material_library(textures)
    flat = make_flat_materials()

    builders_and_manifests = [
        build_concrete_block(materials, 5),
        build_brick_wall(materials, 5),
        build_tree(materials, 5),
        build_barrel(materials, 5),
        build_terrain(materials, 5),
        build_crater(materials, 5),
        build_debris(materials, 5),
    ]
    model_names = [
        "concrete_block.glb", "brick_wall.glb", "pine_tree.glb", "explosive_barrel.glb",
        "terrain_patch.glb", "impact_crater.glb", "debris_pack.glb",
    ]
    asset_defs = []
    model_paths: list[Path] = []
    for (builder, manifest), name in zip(builders_and_manifests, model_names):
        path = MODELS / name
        export_builder(builder, path, {
            "kit": "threejs_destruction_kit", "assetId": manifest["id"], "units": "meters",
            "upAxis": "+Y", "physics": "Rapier-compatible metadata", "brandFree": True,
        })
        model_paths.append(path)
        asset_defs.append(manifest)

    # Five real showcase passes.
    pass_paths: list[Path] = []
    for detail in range(1, 6):
        mats = flat if detail <= 2 else materials
        showcase = build_showcase(mats, detail)
        path = PASSES / f"pass_{detail:02d}_{['blockout','fracture','pbr','physics','final'][detail-1]}.glb"
        export_builder(showcase, path, {
            "kit": "threejs_destruction_kit", "pass": detail, "units": "meters", "upAxis": "+Y",
            "brandFree": True,
        })
        pass_paths.append(path)
    shutil.copy2(pass_paths[-1], MODELS / "environment_showcase.glb")
    model_paths.append(MODELS / "environment_showcase.glb")

    manifest = {
        "schemaVersion": 1,
        "kit": "threejs_destruction_kit",
        "units": "meters",
        "upAxis": "+Y",
        "forwardAxis": "-Z",
        "physicsEngine": "Rapier 3D",
        "fixedTimeStep": 1/60,
        "maxDynamicBodiesRecommended": 320,
        "assets": asset_defs,
    }
    write_runtime_files(manifest)
    write_demo_files()

    all_glbs = model_paths + pass_paths
    structural = [validate_structural(p) for p in all_glbs]
    validator = run_khronos_validator(all_glbs)
    loader_test = run_three_loader_test(model_paths)
    json_dump(VALIDATION / "structural-report.json", {"files": structural})
    json_dump(VALIDATION / "gltf-validator-report.json", validator)
    json_dump(VALIDATION / "threejs-loader-report.json", loader_test)

    pass_report = {
        "process": "five_pass_production",
        "passes": [
            {
                "pass": i+1,
                "file": str(pass_paths[i].relative_to(KIT)),
                "focus": [
                    "blockout, proportions and scale",
                    "fracture segmentation and pivots",
                    "PBR textures and surface detail",
                    "physics metadata and gameplay constraints",
                    "final optimization, tangents and QA",
                ][i],
                "validation": next(r for r in structural if r["file"] == str(pass_paths[i].relative_to(KIT))),
            }
            for i in range(5)
        ],
    }
    json_dump(PASSES / "five-pass-report.json", pass_report)

    if not args.no_preview:
        preview_final = PREVIEWS / "destruction_environment_preview_4k.png"
        render_preview(MODELS / "environment_showcase.glb", preview_final, 3840, 2160)
        smalls = []
        for i, p in enumerate(pass_paths, start=1):
            out = PREVIEWS / f"pass_{i:02d}_preview.png"
            render_preview(p, out, 1280, 720)
            smalls.append(out)
        make_five_pass_contact_sheet(smalls, PREVIEWS / "five_passes_contact_sheet_4k.png")

    if args.no_4k:
        shutil.rmtree(TEXTURES_4K)

    write_readme([r for r in structural if r["file"].startswith("models/")], validator)
    shutil.copy2(Path(__file__), KIT / "generate_destruction_kit.py")

    # Checksums and compact final summary.
    checksums = {str(p.relative_to(KIT)): sha256(p) for p in KIT.rglob("*") if p.is_file()}
    json_dump(KIT / "checksums.sha256.json", checksums)
    summary = {
        "kit": "threejs_destruction_kit",
        "models": [str(p.relative_to(KIT)) for p in model_paths],
        "passes": [str(p.relative_to(KIT)) for p in pass_paths],
        "khronosZeroErrorsWarnings": validator.get("allZeroErrorsWarnings", False),
        "threejsAllLoadable": loader_test.get("allLoadable", False),
        "totalBytes": sum(p.stat().st_size for p in KIT.rglob("*") if p.is_file()),
    }
    json_dump(KIT / "build-summary.json", summary)

    # Full and runtime-only archives.
    full_zip = ROOT / "threejs_destruction_kit_5pass_full.zip"
    runtime_zip = ROOT / "threejs_destruction_kit_runtime.zip"
    for z in (full_zip, runtime_zip):
        if z.exists(): z.unlink()
    with zipfile.ZipFile(full_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=7) as zf:
        for p in KIT.rglob("*"):
            if p.is_file(): zf.write(p, Path(KIT.name) / p.relative_to(KIT))
    with zipfile.ZipFile(runtime_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=7) as zf:
        for sub in ("models", "textures/runtime_1k", "physics", "demo", "README.md", "build-summary.json"):
            p = KIT / sub
            if p.is_file(): zf.write(p, Path(KIT.name) / p.relative_to(KIT))
            elif p.is_dir():
                for f in p.rglob("*"):
                    if f.is_file(): zf.write(f, Path(KIT.name) / f.relative_to(KIT))

    print(json.dumps({
        "summary": summary,
        "fullZip": str(full_zip),
        "runtimeZip": str(runtime_zip),
        "validator": {"allZeroErrorsWarnings": validator.get("allZeroErrorsWarnings")},
        "threejs": {"allLoadable": loader_test.get("allLoadable")},
    }, indent=2))


if __name__ == "__main__":
    main()
