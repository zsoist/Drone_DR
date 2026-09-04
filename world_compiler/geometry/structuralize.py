"""Deterministic structural baseline from an AOI heightfield."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from world_compiler.evidence.truth_field import TruthClass

from .collision import merge_meshes


class HallucinationFirewallError(ValueError):
    """Generated geometry contradicts high-confidence observed structure."""


@dataclass(frozen=True)
class GeometryLayer:
    role: str
    provenance: TruthClass
    vertices: np.ndarray
    faces: np.ndarray
    confidence: float
    material: str | None = "default"

    @classmethod
    def empty(cls, role: str, provenance: TruthClass) -> "GeometryLayer":
        return cls(
            role,
            provenance,
            np.empty((0, 3), dtype=np.float64),
            np.empty((0, 3), dtype=np.uint32),
            0.0,
            None,
        )

    @classmethod
    def box(
        cls,
        role: str,
        provenance: TruthClass,
        *,
        minimum: tuple[float, float, float],
        maximum: tuple[float, float, float],
        confidence: float,
        material: str | None = "structure",
    ) -> "GeometryLayer":
        x0, y0, z0 = minimum
        x1, y1, z1 = maximum
        if not (x1 > x0 and y1 > y0 and z1 > z0):
            raise ValueError("box bounds must have positive volume")
        vertices = np.asarray(
            [
                [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
                [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
            ],
            dtype=np.float64,
        )
        faces = np.asarray(
            [
                [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
                [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
                [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
            ],
            dtype=np.uint32,
        )
        return cls(role, provenance, vertices, faces, float(confidence), material)

    @property
    def bounds(self) -> tuple[np.ndarray, np.ndarray] | None:
        if not len(self.vertices):
            return None
        return self.vertices.min(axis=0), self.vertices.max(axis=0)


@dataclass(frozen=True)
class GeometryBundle:
    observed_reference: GeometryLayer
    ground: GeometryLayer
    clean_observed: GeometryLayer
    inferred: GeometryLayer
    generated: GeometryLayer
    collision: GeometryLayer


def _compact_faces(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if not len(faces):
        return (
            np.empty((0, 3), dtype=np.float64),
            np.empty((0, 3), dtype=np.uint32),
        )
    used = np.unique(faces)
    remap = np.full(len(vertices), np.iinfo(np.uint32).max, dtype=np.uint32)
    remap[used] = np.arange(len(used), dtype=np.uint32)
    return vertices[used].copy(), remap[faces]


def split_by_source_support(
    layer: GeometryLayer,
    vertex_distance_m: np.ndarray,
    *,
    tolerance_m: float,
) -> tuple[GeometryLayer, GeometryLayer, dict]:
    """Keep source-supported faces observed and escrow the remainder as inferred."""
    distances = np.asarray(vertex_distance_m, dtype=np.float64)
    if distances.shape != (len(layer.vertices),) or not np.isfinite(distances).all():
        raise ValueError("vertex support distances must match the geometry layer")
    if tolerance_m <= 0:
        raise ValueError("source support tolerance must be positive")
    supported_mask = np.all(distances[layer.faces] <= tolerance_m, axis=1)
    observed_vertices, observed_faces = _compact_faces(layer.vertices, layer.faces[supported_mask])
    inferred_vertices, inferred_faces = _compact_faces(layer.vertices, layer.faces[~supported_mask])
    observed = GeometryLayer(
        layer.role,
        TruthClass.OBSERVED_WEAK,
        observed_vertices,
        observed_faces,
        layer.confidence if len(observed_faces) else 0.0,
        layer.material,
    )
    inferred = GeometryLayer(
        "geometrically_inferred_structure",
        TruthClass.GEOMETRICALLY_INFERRED,
        inferred_vertices,
        inferred_faces,
        min(layer.confidence, 0.49) if len(inferred_faces) else 0.0,
        layer.material,
    )
    total = len(layer.faces)
    report = {
        "version": 1,
        "method": "all_face_vertices_within_source_surface_tolerance",
        "tolerance_m": round(float(tolerance_m), 9),
        "observed_faces": int(supported_mask.sum()),
        "inferred_faces": int((~supported_mask).sum()),
        "observed_pct": round(100.0 * float(supported_mask.mean()), 8) if total else 0.0,
    }
    return observed, inferred, report


def _grid_mesh(height: np.ndarray, spacing_m: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    rows, cols = height.shape
    sx, sz = spacing_m
    x = (np.arange(cols) - (cols - 1) / 2.0) * sx
    z = (np.arange(rows) - (rows - 1) / 2.0) * sz
    xx, zz = np.meshgrid(x, z)
    vertices = np.column_stack((xx.ravel(), height.ravel(), zz.ravel()))
    faces = []
    for row in range(rows - 1):
        for col in range(cols - 1):
            first = row * cols + col
            faces.extend(
                ((first, first + cols + 1, first + 1),
                 (first, first + cols, first + cols + 1))
            )
    return vertices, np.asarray(faces, dtype=np.uint32)


def _components(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    remaining = set(map(tuple, np.argwhere(mask)))
    components: list[list[tuple[int, int]]] = []
    while remaining:
        seed = min(remaining)
        remaining.remove(seed)
        stack = [seed]
        component = []
        while stack:
            row, col = stack.pop()
            component.append((row, col))
            for neighbor in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    stack.append(neighbor)
        components.append(component)
    return components


def _extrude_component(
    component: list[tuple[int, int]],
    *,
    shape: tuple[int, int],
    spacing_m: tuple[float, float],
    base: float,
    roof: float,
) -> GeometryLayer:
    """Extrude the measured raster footprint without filling its bounding box."""
    rows, cols = shape
    sx, sz = spacing_m
    occupied = set(component)
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []

    def quad(points: list[tuple[float, float, float]]) -> None:
        start = len(vertices)
        vertices.extend(points)
        faces.extend(((start, start + 2, start + 1), (start, start + 3, start + 2)))

    for row, col in sorted(component):
        x0 = (col - (cols - 1) / 2.0 - 0.5) * sx
        x1 = x0 + sx
        z0 = (row - (rows - 1) / 2.0 - 0.5) * sz
        z1 = z0 + sz
        quad([(x0, roof, z0), (x1, roof, z0), (x1, roof, z1), (x0, roof, z1)])
        if (row - 1, col) not in occupied:
            quad([(x0, base, z0), (x0, roof, z0), (x1, roof, z0), (x1, base, z0)])
        if (row + 1, col) not in occupied:
            quad([(x1, base, z1), (x1, roof, z1), (x0, roof, z1), (x0, base, z1)])
        if (row, col - 1) not in occupied:
            quad([(x0, base, z1), (x0, roof, z1), (x0, roof, z0), (x0, base, z0)])
        if (row, col + 1) not in occupied:
            quad([(x1, base, z0), (x1, roof, z0), (x1, roof, z1), (x1, base, z1)])
    return GeometryLayer(
        "clean_observed_structure",
        TruthClass.OBSERVED_WEAK,
        np.asarray(vertices, dtype=np.float64),
        np.asarray(faces, dtype=np.uint32),
        0.6,
        "structure",
    )


def structuralize_heightfield(
    heightfield: np.ndarray,
    *,
    spacing_m: tuple[float, float],
    structure_threshold_m: float = 2.0,
    exclusion_mask: np.ndarray | None = None,
    minimum_component_cells: int = 4,
    minimum_planar_fraction: float = 0.3,
) -> GeometryBundle:
    height = np.asarray(heightfield, dtype=np.float64)
    if height.ndim != 2 or min(height.shape) < 2 or not np.isfinite(height).all():
        raise ValueError("heightfield must be finite and at least 2x2")
    excluded = (
        np.zeros(height.shape, dtype=bool)
        if exclusion_mask is None
        else np.asarray(exclusion_mask, dtype=bool)
    )
    if excluded.shape != height.shape:
        raise ValueError("exclusion mask must match the heightfield")
    ground_ceiling = float(np.percentile(height, 60))
    ground_height = np.minimum(height, ground_ceiling)
    ground_vertices, ground_faces = _grid_mesh(ground_height, spacing_m)
    reference_vertices, reference_faces = _grid_mesh(height, spacing_m)
    ground = GeometryLayer(
        "ground", TruthClass.OBSERVED_WEAK, ground_vertices, ground_faces, 0.6, "ground"
    )
    reference = GeometryLayer(
        "observed_reference_geometry",
        TruthClass.OBSERVED_WEAK,
        reference_vertices,
        reference_faces,
        0.6,
        "source_reference",
    )

    sx, sz = spacing_m
    rows, cols = height.shape
    structures: list[GeometryLayer] = []
    roughness = np.zeros_like(height)
    roughness[1:, :] = np.maximum(
        roughness[1:, :], np.abs(height[1:, :] - height[:-1, :])
    )
    roughness[:-1, :] = np.maximum(
        roughness[:-1, :], np.abs(height[:-1, :] - height[1:, :])
    )
    roughness[:, 1:] = np.maximum(
        roughness[:, 1:], np.abs(height[:, 1:] - height[:, :-1])
    )
    roughness[:, :-1] = np.maximum(
        roughness[:, :-1], np.abs(height[:, :-1] - height[:, 1:])
    )
    structure_mask = (height - ground_height > structure_threshold_m) & ~excluded
    for component in _components(structure_mask):
        if len(component) < minimum_component_cells:
            continue
        component_rows = np.asarray([row for row, _ in component])
        component_cols = np.asarray([col for _, col in component])
        component_height = height[component_rows, component_cols]
        component_median = float(np.median(component_height))
        planar = (
            (roughness[component_rows, component_cols] < 1.0)
            | (np.abs(component_height - component_median) < 1.0)
        )
        if float(planar.mean()) < minimum_planar_fraction:
            continue
        neighbors = []
        occupied = set(component)
        for row, col in component:
            for neighbor in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
                nr, nc = neighbor
                if neighbor not in occupied and 0 <= nr < rows and 0 <= nc < cols:
                    neighbors.append(height[nr, nc])
        base = float(
            np.median(neighbors)
            if neighbors
            else np.median(ground_height[component_rows, component_cols])
        )
        roof = float(np.median(height[component_rows[planar], component_cols[planar]]))
        if roof - base <= structure_threshold_m:
            continue
        structures.append(
            _extrude_component(
                component,
                shape=height.shape,
                spacing_m=spacing_m,
                base=base,
                roof=roof,
            )
        )
    structure_vertices, structure_faces = merge_meshes(
        [(structure.vertices, structure.faces) for structure in structures]
    )
    clean = GeometryLayer(
        "clean_observed_structure",
        TruthClass.OBSERVED_WEAK,
        structure_vertices,
        structure_faces,
        0.6 if len(structure_faces) else 0.0,
        "structure",
    )
    collision_vertices, collision_faces = merge_meshes(
        [(ground.vertices, ground.faces), (clean.vertices, clean.faces)]
    )
    collision = GeometryLayer(
        "collision_geometry",
        TruthClass.GEOMETRICALLY_INFERRED,
        collision_vertices,
        collision_faces,
        0.6,
        None,
    )
    return GeometryBundle(
        reference,
        ground,
        clean,
        GeometryLayer.empty("geometrically_inferred_structure", TruthClass.GEOMETRICALLY_INFERRED),
        GeometryLayer.empty("generated_completion", TruthClass.GENERATED_CONSTRAINED),
        collision,
    )


def validate_layer_separation(
    observed: GeometryLayer,
    generated: GeometryLayer,
    *,
    high_confidence: float = 0.8,
    tolerance_m: float = 1e-6,
) -> None:
    if observed.confidence < high_confidence or observed.bounds is None or generated.bounds is None:
        return
    observed_min, observed_max = observed.bounds
    generated_min, generated_max = generated.bounds
    overlap = np.minimum(observed_max, generated_max) - np.maximum(observed_min, generated_min)
    if np.all(overlap > tolerance_m):
        raise HallucinationFirewallError(
            "generated geometry overlaps high-confidence observed structure"
        )
