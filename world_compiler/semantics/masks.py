"""Compose static and replacement masks without inventing detector output."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np


class SemanticClass(str, Enum):
    GROUND_SURFACE = "ground_surface"
    BUILDING = "building"
    WALL = "wall"
    ROOF = "roof"
    ROAD = "road"
    SIDEWALK = "sidewalk"
    SOIL = "soil"
    VEGETATION = "vegetation"
    VEHICLE = "vehicle"
    MOTORCYCLE = "motorcycle"
    PERSON = "person"
    POLE = "pole"
    CABLE = "cable"
    SIGN = "sign"
    GLASS = "glass"
    WATER = "water"
    SKY_NO_DATA = "sky_no_data"


TRANSIENT = {
    SemanticClass.VEGETATION,
    SemanticClass.VEHICLE,
    SemanticClass.MOTORCYCLE,
    SemanticClass.PERSON,
}
STATIC = {
    SemanticClass.GROUND_SURFACE,
    SemanticClass.BUILDING,
    SemanticClass.WALL,
    SemanticClass.ROOF,
    SemanticClass.ROAD,
    SemanticClass.SIDEWALK,
    SemanticClass.SOIL,
    SemanticClass.POLE,
    SemanticClass.CABLE,
    SemanticClass.SIGN,
    SemanticClass.GLASS,
    SemanticClass.WATER,
}


@dataclass(frozen=True)
class MaskComposition:
    static: np.ndarray
    replacement: np.ndarray
    method: str
    evidence_classes: tuple[str, ...]


def conservative_semantic_masks(
    heightfield: np.ndarray,
    valid_mask: np.ndarray,
    vegetation_mask: np.ndarray | None,
    *,
    structure_threshold_m: float = 2.0,
) -> dict[SemanticClass, np.ndarray]:
    """Derive only classes supported by DSM validity and a measured ortho color proxy."""
    height = np.asarray(heightfield, dtype=np.float64)
    valid = np.asarray(valid_mask, dtype=bool)
    vegetation = (
        np.zeros(height.shape, dtype=bool)
        if vegetation_mask is None
        else np.asarray(vegetation_mask, dtype=bool)
    )
    if height.ndim != 2 or valid.shape != height.shape or vegetation.shape != height.shape:
        raise ValueError("semantic evidence rasters must share one 2D shape")
    if not np.isfinite(height).all():
        raise ValueError("semantic heightfield must be finite")
    vegetation &= valid
    ground_ceiling = float(np.percentile(height[valid], 60)) if valid.any() else float(height.min())
    elevated = valid & (height - np.minimum(height, ground_ceiling) > structure_threshold_m)
    roof = elevated & ~vegetation
    ground_surface = valid & ~elevated & ~vegetation
    return {
        SemanticClass.GROUND_SURFACE: ground_surface,
        SemanticClass.ROOF: roof,
        SemanticClass.VEGETATION: vegetation,
        SemanticClass.SKY_NO_DATA: ~valid,
    }


def compose_static_mask(
    class_masks: dict[SemanticClass, np.ndarray],
    *,
    shape: tuple[int, int] | None = None,
) -> MaskComposition:
    if not class_masks:
        if shape is None or len(shape) != 2:
            raise ValueError("shape is required without semantic evidence")
        empty = np.zeros(shape, dtype=bool)
        return MaskComposition(empty.copy(), empty.copy(), "no_semantic_evidence", ())
    arrays = {SemanticClass(key): np.asarray(value, dtype=bool) for key, value in class_masks.items()}
    inferred_shape = next(iter(arrays.values())).shape
    if len(inferred_shape) != 2 or any(value.shape != inferred_shape for value in arrays.values()):
        raise ValueError("semantic masks must share one 2D shape")
    replacement = np.zeros(inferred_shape, dtype=bool)
    static = np.zeros(inferred_shape, dtype=bool)
    for semantic_class, mask in arrays.items():
        if semantic_class in TRANSIENT:
            replacement |= mask
        elif semantic_class in STATIC:
            static |= mask
    static &= ~replacement
    return MaskComposition(
        static,
        replacement,
        "composed_semantic_evidence",
        tuple(sorted(semantic_class.value for semantic_class in arrays)),
    )
