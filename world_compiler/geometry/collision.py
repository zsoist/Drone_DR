"""Collision geometry is material-free and derived from clean structure."""

from __future__ import annotations

import numpy as np


def merge_meshes(meshes: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    vertices: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0
    for mesh_vertices, mesh_faces in meshes:
        current_vertices = np.asarray(mesh_vertices, dtype=np.float64)
        current_faces = np.asarray(mesh_faces, dtype=np.uint32).reshape(-1, 3)
        vertices.append(current_vertices)
        faces.append(current_faces + offset)
        offset += len(current_vertices)
    if not vertices:
        return np.empty((0, 3), dtype=np.float64), np.empty((0, 3), dtype=np.uint32)
    return np.vstack(vertices), np.vstack(faces)
