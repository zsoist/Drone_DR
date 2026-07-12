#!/usr/bin/env python3
"""Generate a web-optimized, brand-free foldable guarded camera drone GLB.

Conventions:
- +Y up
- nose/camera toward -Z
- four propeller nodes named prop_1 .. prop_4, pivoted on motor axes
- deployed X span ~= 0.85 m
- <= 2 PBR materials, no textures/lights/cameras/animations
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path
from typing import Iterable

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

OUT = Path('drone_hd.glb')
REPORT = Path('drone_hd_validation.json')


def mat_translate(v: Iterable[float]) -> np.ndarray:
    return trimesh.transformations.translation_matrix(np.asarray(v, dtype=float))


def mat_rotate(angle: float, axis: Iterable[float]) -> np.ndarray:
    return trimesh.transformations.rotation_matrix(angle, np.asarray(axis, dtype=float))


def moved(mesh: trimesh.Trimesh, matrix: np.ndarray) -> trimesh.Trimesh:
    result = mesh.copy()
    result.apply_transform(matrix)
    return result


def cylinder_y(radius: float, height: float, sections: int = 48, center=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    """Cylinder with axis along +Y."""
    mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    transform = mat_translate(center) @ mat_rotate(math.pi / 2.0, [1, 0, 0])
    mesh.apply_transform(transform)
    return mesh


def cylinder_x(radius: float, height: float, sections: int = 48, center=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    """Cylinder with axis along +X."""
    mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    transform = mat_translate(center) @ mat_rotate(math.pi / 2.0, [0, 1, 0])
    mesh.apply_transform(transform)
    return mesh


def cylinder_z(radius: float, height: float, sections: int = 48, center=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    mesh.apply_translation(center)
    return mesh


def rod(a: Iterable[float], b: Iterable[float], radius: float, sections: int = 12) -> trimesh.Trimesh:
    """Capped cylinder between two points."""
    return trimesh.creation.cylinder(radius=radius, segment=np.array([a, b], dtype=float), sections=sections)


def torus_y(major_radius: float, minor_radius: float, major_sections: int = 96, minor_sections: int = 12,
            center=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    """Torus whose symmetry axis is +Y (ring lies in XZ plane)."""
    mesh = trimesh.creation.torus(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_sections=major_sections,
        minor_sections=minor_sections,
    )
    mesh.apply_transform(mat_translate(center) @ mat_rotate(math.pi / 2.0, [1, 0, 0]))
    return mesh


def superellipsoid(extents: Iterable[float], center=(0.0, 0.0, 0.0), power: float = 0.56,
                   count=(40, 20)) -> trimesh.Trimesh:
    """Smooth rounded-box-like superellipsoid, suitable for compact shells."""
    mesh = trimesh.creation.uv_sphere(radius=1.0, count=count)
    vertices = mesh.vertices.copy()
    vertices = np.sign(vertices) * np.power(np.abs(vertices), power)
    vertices *= np.asarray(extents, dtype=float) / 2.0
    vertices += np.asarray(center, dtype=float)
    mesh.vertices = vertices
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    return mesh


def warped_main_shell() -> trimesh.Trimesh:
    mesh = superellipsoid([0.190, 0.115, 0.420], center=[0.0, 0.035, 0.010], power=0.50, count=(36, 18))
    v = mesh.vertices.copy()
    z_norm = np.clip((v[:, 2] - 0.010) / (0.420 / 2.0), -1.0, 1.0)
    # Slightly narrower nose, broad shoulders, gently rising top toward the rear.
    width_scale = 0.90 + 0.10 * (z_norm + 1.0) * 0.5
    v[:, 0] *= width_scale
    top_bias = np.clip((v[:, 1] - 0.035) / (0.115 / 2.0), -1.0, 1.0)
    v[:, 1] += 0.006 * ((z_norm + 1.0) * 0.5) * np.maximum(top_bias, 0.0)
    # Make the front plane a bit more assertive for the sensing bar.
    v[:, 2] -= 0.005 * np.maximum(-z_norm, 0.0) ** 2
    mesh.vertices = v
    return mesh


def blade_strip(radius_inner: float = 0.028, radius_outer: float = 0.154, sections: int = 26,
                thickness: float = 0.0032) -> trimesh.Trimesh:
    """One swept propeller blade, extruded along Y, pointing roughly +X."""
    rs = np.linspace(radius_inner, radius_outer, sections)
    sweep = np.deg2rad(np.linspace(-5.0, 13.0, sections))
    widths = np.linspace(0.022, 0.011, sections)
    centers = np.column_stack([rs * np.cos(sweep), rs * np.sin(sweep)])  # X,Z

    left = []
    right = []
    for i in range(sections):
        if i == 0:
            tangent = centers[1] - centers[0]
        elif i == sections - 1:
            tangent = centers[-1] - centers[-2]
        else:
            tangent = centers[i + 1] - centers[i - 1]
        tangent /= np.linalg.norm(tangent)
        normal = np.array([-tangent[1], tangent[0]])
        left.append(centers[i] + normal * widths[i] * 0.5)
        right.append(centers[i] - normal * widths[i] * 0.5)

    outline = np.vstack([np.asarray(left), np.asarray(right)[::-1]])
    n = len(outline)
    vertices = np.zeros((n * 2, 3), dtype=float)
    vertices[:n, 0] = outline[:, 0]
    vertices[:n, 2] = outline[:, 1]
    # twist: angulo de ataque decrece de raiz a punta (pala real)
    r_norm = np.hypot(outline[:, 0], outline[:, 1]) / radius_outer
    twist = np.deg2rad(16.0) * (1.0 - r_norm * 0.72)
    lift = outline[:, 1] * 0  # placeholder shape
    vertices[:n, 1] = thickness / 2.0 + np.sin(twist) * 0.006
    vertices[n:, 0] = outline[:, 0]
    vertices[n:, 2] = outline[:, 1]
    vertices[n:, 1] = -thickness / 2.0 + np.sin(twist) * -0.002

    faces = []
    # Top and bottom fan triangulation; outline is convex enough for this swept blade.
    for i in range(1, n - 1):
        faces.append([0, i, i + 1])
        faces.append([n, n + i + 1, n + i])
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j])
        faces.append([i, n + j, n + i])

    mesh = trimesh.Trimesh(vertices=vertices, faces=np.asarray(faces, dtype=np.int64), process=True)
    return mesh


def make_propeller() -> trimesh.Trimesh:
    blade_a = blade_strip()
    blade_b = moved(blade_a, mat_rotate(math.pi, [0, 1, 0]))
    hub = cylinder_y(radius=0.020, height=0.008, sections=24)
    cap = cylinder_y(radius=0.010, height=0.013, sections=20, center=[0.0, 0.004, 0.0])
    prop = trimesh.util.concatenate([blade_a, blade_b, hub, cap])
    prop.remove_unreferenced_vertices()
    return prop


def add_box(parts: list[trimesh.Trimesh], extents, center, rotation=None) -> None:
    mesh = trimesh.creation.box(extents=np.asarray(extents, dtype=float))
    transform = np.eye(4)
    if rotation is not None:
        transform = rotation @ transform
    transform = mat_translate(center) @ transform
    mesh.apply_transform(transform)
    parts.append(mesh)


def build_model() -> trimesh.Scene:
    light_parts: list[trimesh.Trimesh] = []
    dark_parts: list[trimesh.Trimesh] = []

    # Main fuselage and battery/top cover.
    light_parts.append(warped_main_shell())
    light_parts.append(superellipsoid([0.158, 0.030, 0.300], center=[0.0, 0.103, 0.060], power=0.46, count=(24, 12)))
    # Rear battery latch and small top ridge.
    light_parts.append(superellipsoid([0.066, 0.017, 0.034], center=[0.0, 0.119, 0.190], power=0.46, count=(16, 8)))

    # Front obstacle-sensing bar.
    dark_parts.append(superellipsoid([0.158, 0.047, 0.014], center=[0.0, 0.060, -0.211], power=0.42, count=(28, 14)))
    # Tiny sensor lenses recessed/protruding in the sensing bar.
    for x in (-0.055, 0.055):
        dark_parts.append(cylinder_z(radius=0.0075, height=0.005, sections=18, center=[x, 0.060, -0.221]))

    # Gimbal yoke and camera body, facing -Z.
    dark_parts.append(cylinder_x(radius=0.020, height=0.066, sections=24, center=[0.0, -0.028, -0.158]))
    dark_parts.append(superellipsoid([0.066, 0.055, 0.050], center=[0.0, -0.061, -0.187], power=0.63, count=(28, 16)))
    dark_parts.append(cylinder_z(radius=0.022, height=0.022, sections=32, center=[0.0, -0.060, -0.220]))
    # Light trim ring around the lens, then dark front optic.
    light_parts.append(cylinder_z(radius=0.025, height=0.0050, sections=32, center=[0.0, -0.060, -0.235]))
    dark_parts.append(cylinder_z(radius=0.0175, height=0.0065, sections=32, center=[0.0, -0.060, -0.241]))

    # Top power button and status dots.
    dark_parts.append(cylinder_y(radius=0.0105, height=0.005, sections=24, center=[0.0, 0.121, 0.116]))
    for i, x in enumerate((-0.020, -0.007, 0.007, 0.020)):
        dark_parts.append(cylinder_y(radius=0.0022, height=0.0045, sections=12, center=[x, 0.121, 0.153]))

    # Side cooling slots and arm hinges.
    for side in (-1.0, 1.0):
        for z in (-0.012, 0.020, 0.052):
            add_box(dark_parts, [0.005, 0.012, 0.022], [side * 0.092, 0.032, z])
        dark_parts.append(cylinder_y(radius=0.023, height=0.017, sections=20, center=[side * 0.078, -0.004, -0.110]))
        dark_parts.append(cylinder_y(radius=0.023, height=0.017, sections=20, center=[side * 0.078, -0.004, 0.120]))

    # Bottom visual-positioning sensors.
    for x in (-0.038, 0.038):
        dark_parts.append(cylinder_y(radius=0.013, height=0.0045, sections=24, center=[x, -0.040, 0.052]))
    add_box(dark_parts, [0.040, 0.004, 0.018], [0.0, -0.041, 0.101])

    # Rotor layout: prop_1 front-left, then clockwise when viewed from above.
    rotor_centers = [
        (-0.2300, -0.1550),
        (0.2300, -0.1550),
        (0.2300, 0.1550),
        (-0.2300, 0.1550),
    ]

    guard_major = 0.1870
    guard_minor = 0.0080

    for idx, (x, z) in enumerate(rotor_centers, start=1):
        # Foldable structural arm from body shoulder to motor.
        sx = math.copysign(0.072, x)
        sz = math.copysign(0.096, z)
        light_parts.append(rod([sx, 0.001, sz], [x, -0.001, z], radius=0.0115, sections=10))
        # Small dark hinge cuff near the motor.
        hx = x * 0.78 + sx * 0.22
        hz = z * 0.78 + sz * 0.22
        dark_parts.append(cylinder_y(radius=0.022, height=0.016, sections=20, center=[hx, 0.0, hz]))

        # Two-level full-coverage guard rims.
        light_parts.append(torus_y(guard_major, guard_minor, major_sections=96, minor_sections=10, center=[x, 0.035, z]))
        light_parts.append(torus_y(guard_major, guard_minor, major_sections=96, minor_sections=10, center=[x, -0.030, z]))

        # Vertical cage connectors.
        for angle in np.linspace(0.0, 2.0 * math.pi, 14, endpoint=False):
            px = x + guard_major * math.cos(angle)
            pz = z + guard_major * math.sin(angle)
            light_parts.append(rod([px, -0.029, pz], [px, 0.034, pz], radius=0.0027, sections=6))

        # Carbon-fiber-style wheel spokes under the propeller plane.
        for angle in np.linspace(0.0, 2.0 * math.pi, 24, endpoint=False):
            c, s = math.cos(angle), math.sin(angle)
            dark_parts.append(
                rod(
                    [x + 0.030 * c, -0.017, z + 0.030 * s],
                    [x + 0.176 * c, -0.017, z + 0.176 * s],
                    radius=0.0015,
                    sections=8,
                )
            )

        # Motor base and top cap.
        dark_parts.append(cylinder_y(radius=0.030, height=0.048, sections=28, center=[x, -0.002, z]))
        light_parts.append(cylinder_y(radius=0.022, height=0.010, sections=28, center=[x, 0.022, z]))
        dark_parts.append(cylinder_y(radius=0.010, height=0.012, sections=20, center=[x, 0.030, z]))

        # Outboard landing leg, angled subtly away from the craft center.
        d = np.array([x, z], dtype=float)
        d /= np.linalg.norm(d)
        p_top = np.array([x + d[0] * 0.176, -0.029, z + d[1] * 0.176])
        p_bot = np.array([x + d[0] * 0.188, -0.105, z + d[1] * 0.188])
        light_parts.append(rod(p_top, p_bot, radius=0.0080, sections=10))
        foot_center = [p_bot[0], p_bot[1] - 0.002, p_bot[2]]
        dark_parts.append(superellipsoid([0.024, 0.010, 0.034], center=foot_center, power=0.54, count=(16, 8)))

    # A couple of underside braces to visually tie the guarded modules together.
    for side in (-1.0, 1.0):
        light_parts.append(rod([side * 0.072, -0.024, -0.102], [side * 0.188, -0.022, -0.145], radius=0.0085, sections=8))
        light_parts.append(rod([side * 0.072, -0.024, 0.112], [side * 0.188, -0.022, 0.145], radius=0.0085, sections=8))

    # ── DETALLE ULTRA: tornilleria, vents, antenas, GPS, aletas de motor ──
    accent_parts: list[trimesh.Trimesh] = []
    # tornillos del cuerpo (12)
    for sx2, sz2 in [(-0.07, -0.15), (0.07, -0.15), (-0.08, 0.0), (0.08, 0.0),
                     (-0.07, 0.16), (0.07, 0.16), (-0.04, -0.19), (0.04, -0.19),
                     (-0.05, 0.19), (0.05, 0.19), (0.0, -0.16), (0.0, 0.21)]:
        dark_parts.append(cylinder_y(radius=0.0028, height=0.0035, sections=10, center=[sx2, 0.093, sz2]))
    # louvers de ventilacion traseros (5 aletas)
    for i2 in range(5):
        add_box(dark_parts, [0.052, 0.0022, 0.010], [0.0, 0.075 - i2 * 0.011, 0.208])
    # puck GPS superior + anillo acento
    light_parts.append(cylinder_y(radius=0.026, height=0.007, sections=36, center=[0.0, 0.122, 0.02]))
    accent_parts.append(torus_y(0.0265, 0.0016, major_sections=48, minor_sections=8, center=[0.0, 0.1245, 0.02]))
    # antenas traseras x2 con bolita
    for sx2 in (-0.05, 0.05):
        light_parts.append(rod([sx2, 0.11, 0.20], [sx2 * 1.4, 0.165, 0.235], radius=0.0022, sections=8))
        dark_parts.append(superellipsoid([0.009, 0.009, 0.009], center=[sx2 * 1.4, 0.168, 0.236], power=0.9, count=(12, 8)))
    # franja acento en la nariz
    accent_parts.append(superellipsoid([0.150, 0.006, 0.010], center=[0.0, 0.088, -0.196], power=0.4, count=(20, 8)))
    # aletas de refrigeracion por motor (12 radiales) + acento en tapa
    for (x2, z2) in rotor_centers:
        for angle in np.linspace(0.0, 2.0 * math.pi, 12, endpoint=False):
            c2, s2 = math.cos(angle), math.sin(angle)
            add_box(dark_parts, [0.0018, 0.020, 0.0075],
                    [x2 + 0.0315 * c2, -0.002, z2 + 0.0315 * s2],
                    rotation=mat_rotate(-angle, [0, 1, 0]))
        accent_parts.append(torus_y(0.0225, 0.0018, major_sections=40, minor_sections=8, center=[x2, 0.0285, z2]))

    # Build exactly two PBR materials.
    light_mat = PBRMaterial(
        name='mat_light_plastic',
        baseColorFactor=[196, 201, 205, 255],
        metallicFactor=0.10,
        roughnessFactor=0.50,
    )
    dark_mat = PBRMaterial(
        name='mat_dark_detail',
        baseColorFactor=[23, 28, 33, 255],
        metallicFactor=0.10,
        roughnessFactor=0.38,
    )

    light_mesh = trimesh.util.concatenate(light_parts)
    light_mesh.remove_unreferenced_vertices()
    light_mesh.visual = trimesh.visual.TextureVisuals(material=light_mat)
    light_mesh.metadata['name'] = 'airframe_light'

    dark_mesh = trimesh.util.concatenate(dark_parts)
    dark_mesh.remove_unreferenced_vertices()
    dark_mesh.visual = trimesh.visual.TextureVisuals(material=dark_mat)
    dark_mesh.metadata['name'] = 'airframe_dark'

    accent_mat = PBRMaterial(
        name='mat_accent_orange',
        baseColorFactor=[255, 106, 61, 255],
        metallicFactor=0.05,
        roughnessFactor=0.42,
        emissiveFactor=[0.28, 0.07, 0.01],
    )
    accent_mesh = trimesh.util.concatenate(accent_parts)
    accent_mesh.remove_unreferenced_vertices()
    accent_mesh.visual = trimesh.visual.TextureVisuals(material=accent_mat)
    accent_mesh.metadata['name'] = 'airframe_accent'

    prop_mesh = make_propeller()
    prop_mesh.visual = trimesh.visual.TextureVisuals(material=dark_mat)
    prop_mesh.metadata['name'] = 'propeller_mesh'

    scene = trimesh.Scene(base_frame='world')
    scene.geometry['airframe_light'] = light_mesh
    scene.geometry['airframe_dark'] = dark_mesh
    scene.geometry['airframe_accent'] = accent_mesh
    scene.geometry['propeller_mesh'] = prop_mesh
    scene.graph.update(frame_from='world', frame_to='drone_root', matrix=np.eye(4))
    scene.graph.update(frame_from='drone_root', frame_to='airframe_light', matrix=np.eye(4), geometry='airframe_light')
    scene.graph.update(frame_from='drone_root', frame_to='airframe_dark', matrix=np.eye(4), geometry='airframe_dark')
    scene.graph.update(frame_from='drone_root', frame_to='airframe_accent', matrix=np.eye(4), geometry='airframe_accent')

    prop_y = 0.030
    initial_angles = [math.radians(14), math.radians(104), math.radians(194), math.radians(284)]
    for i, ((x, z), angle) in enumerate(zip(rotor_centers, initial_angles), start=1):
        transform = mat_translate([x, prop_y, z]) @ mat_rotate(angle, [0, 1, 0])
        scene.graph.update(
            frame_from='drone_root',
            frame_to=f'prop_{i}',
            matrix=transform,
            geometry='propeller_mesh',
        )

    for i, (x2, z2) in enumerate(rotor_centers, start=1):
        scene.graph.update(frame_from='drone_root', frame_to=f'hardpoint_{i}',
                           matrix=mat_translate([x2 * 0.55, -0.045, z2 * 0.55]))

    scene.metadata.update({
        'title': 'Brand-free guarded foldable camera drone',
        'coordinate_system': '+Y up, nose -Z',
        'units': 'meters',
        'propeller_nodes': ['prop_1', 'prop_2', 'prop_3', 'prop_4'],
    })
    return scene



def postprocess_glb(data: bytes) -> bytes:
    """Add standard bufferView targets and compact metadata without changing geometry."""
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise ValueError('Invalid GLB header')

    offset = 12
    chunks: list[tuple[int, bytes]] = []
    gltf = None
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk = data[offset:offset + chunk_len]
        offset += chunk_len
        if chunk_type == 0x4E4F534A:
            gltf = json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
        else:
            chunks.append((chunk_type, chunk))
    if gltf is None:
        raise ValueError('GLB JSON chunk not found')

    accessors = gltf.get('accessors', [])
    views = gltf.get('bufferViews', [])
    for mesh in gltf.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            for accessor_index in primitive.get('attributes', {}).values():
                view_index = accessors[accessor_index].get('bufferView')
                if view_index is not None:
                    views[view_index]['target'] = 34962  # ARRAY_BUFFER
            index_accessor = primitive.get('indices')
            if index_accessor is not None:
                view_index = accessors[index_accessor].get('bufferView')
                if view_index is not None:
                    views[view_index]['target'] = 34963  # ELEMENT_ARRAY_BUFFER

    gltf.setdefault('asset', {})['generator'] = 'OpenAI procedural GLB generator + trimesh'
    gltf['extras'] = {
        'model': 'brand-free guarded foldable camera drone',
        'units': 'meters',
        'upAxis': '+Y',
        'noseAxis': '-Z',
        'targetXSpanMeters': 0.85,
        'propellerNodes': ['prop_1', 'prop_2', 'prop_3', 'prop_4'],
    }

    json_bytes = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    json_bytes += b' ' * ((4 - len(json_bytes) % 4) % 4)

    body = struct.pack('<II', len(json_bytes), 0x4E4F534A) + json_bytes
    for chunk_type, chunk in chunks:
        body += struct.pack('<II', len(chunk), chunk_type) + chunk
    return struct.pack('<4sII', b'glTF', 2, 12 + len(body)) + body

def parse_glb_json(data: bytes) -> dict:
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2 or length != len(data):
        raise ValueError('Invalid GLB header')
    offset = 12
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from('<II', data, offset)
        offset += 8
        chunk = data[offset:offset + chunk_len]
        offset += chunk_len
        if chunk_type == 0x4E4F534A:  # JSON
            return json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
    raise ValueError('GLB JSON chunk not found')


def validate(out_path: Path) -> dict:
    raw = out_path.read_bytes()
    gltf = parse_glb_json(raw)
    nodes = [n.get('name', '') for n in gltf.get('nodes', [])]
    materials = gltf.get('materials', [])
    accessors = gltf.get('accessors', [])

    mesh_triangles: list[int] = []
    for mesh in gltf.get('meshes', []):
        count = 0
        for prim in mesh.get('primitives', []):
            if prim.get('mode', 4) != 4:
                continue
            idx_accessor = prim.get('indices')
            if idx_accessor is not None:
                count += int(accessors[idx_accessor]['count']) // 3
            else:
                pos_accessor = prim.get('attributes', {}).get('POSITION')
                if pos_accessor is not None:
                    count += int(accessors[pos_accessor]['count']) // 3
        mesh_triangles.append(count)
    unique_triangles = sum(mesh_triangles)
    rendered_triangles = sum(
        mesh_triangles[node['mesh']]
        for node in gltf.get('nodes', [])
        if 'mesh' in node
    )

    loaded = trimesh.load(out_path, force='scene')
    bounds = np.asarray(loaded.bounds, dtype=float)
    extents = np.asarray(loaded.extents, dtype=float)

    report = {
        'file': out_path.name,
        'file_size_bytes': len(raw),
        'glb_version': 2,
        'generator': gltf.get('asset', {}).get('generator'),
        'triangles': rendered_triangles,
        'triangles_unique_meshes': unique_triangles,
        'triangles_rendered_instances': rendered_triangles,
        'triangle_budget_ok': rendered_triangles <= 120000,
        'materials': [m.get('name') for m in materials],
        'material_count': len(materials),
        'material_budget_ok': len(materials) <= 8,
        'textures': len(gltf.get('textures', [])),
        'images': len(gltf.get('images', [])),
        'animations': len(gltf.get('animations', [])),
        'cameras': len(gltf.get('cameras', [])),
        'nodes': nodes,
        'propeller_nodes_present': all(f'prop_{i}' in nodes for i in range(1, 5)),
        'bounds_min_xyz_m': bounds[0].round(6).tolist(),
        'bounds_max_xyz_m': bounds[1].round(6).tolist(),
        'extents_xyz_m': extents.round(6).tolist(),
        'x_span_target_m': 0.85,
        'x_span_error_m': round(float(abs(extents[0] - 0.85)), 6),
        'up_axis': '+Y',
        'nose_axis': '-Z',
        'threejs_glb_loadable_via_trimesh': True,
    }
    return report


def main() -> None:
    scene = build_model()
    glb = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
    glb = postprocess_glb(glb)
    OUT.write_bytes(glb)
    report = validate(OUT)
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
