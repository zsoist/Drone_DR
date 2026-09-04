"""Single explicit AeroBrain-to-Unreal coordinate conversion boundary."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class CoordinateContract:
    """Map absolute AeroBrain meters to AOI-centered Unreal centimeters."""

    aoi_center_ab_m: tuple[float, float]
    matrix: tuple[tuple[float, ...], ...] = field(init=False)
    inverse: tuple[tuple[float, ...], ...] = field(init=False)
    metadata: dict[str, float | str] = field(init=False)

    def __post_init__(self) -> None:
        center = np.asarray(self.aoi_center_ab_m, dtype=np.float64)
        if center.shape != (2,) or not np.isfinite(center).all():
            raise ValueError("AOI center must contain finite X/Z meters")
        cx, cz = center
        matrix = np.asarray(
            [
                [100.0, 0.0, 0.0, -100.0 * cx],
                [0.0, 0.0, 100.0, -100.0 * cz],
                [0.0, 100.0, 0.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            dtype=np.float64,
        )
        determinant = float(np.linalg.det(matrix[:3, :3]))
        inverse = np.linalg.inv(matrix)
        object.__setattr__(self, "aoi_center_ab_m", (float(cx), float(cz)))
        object.__setattr__(self, "matrix", tuple(tuple(row) for row in matrix))
        object.__setattr__(self, "inverse", tuple(tuple(row) for row in inverse))
        object.__setattr__(
            self,
            "metadata",
            {
                "units": "centimeters",
                "source_units": "meters",
                "handedness": "left-handed" if determinant < 0 else "right-handed",
                "determinant": determinant,
            },
        )

    @staticmethod
    def _validate_points(points: np.ndarray) -> np.ndarray:
        array = np.asarray(points, dtype=np.float64)
        if array.ndim != 2 or array.shape[1] != 3:
            raise ValueError("points must have shape (N, 3)")
        if not np.isfinite(array).all():
            raise ValueError("points must be finite")
        return array

    @staticmethod
    def _transform(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        homogeneous = np.concatenate(
            (points, np.ones((len(points), 1), dtype=np.float64)), axis=1
        )
        return (matrix @ homogeneous.T).T[:, :3]

    def ab_to_ue(self, points: np.ndarray) -> np.ndarray:
        array = self._validate_points(points)
        return self._transform(array, np.asarray(self.matrix))

    def ue_to_ab(self, points: np.ndarray) -> np.ndarray:
        array = self._validate_points(points)
        return self._transform(array, np.asarray(self.inverse))

    def flip_winding(self, indices: np.ndarray) -> np.ndarray:
        array = np.asarray(indices)
        if array.ndim != 1 or len(array) % 3:
            raise ValueError("triangle indices must be a flat multiple of three")
        triangles = array.reshape(-1, 3).copy()
        triangles[:, [1, 2]] = triangles[:, [2, 1]]
        return triangles.reshape(-1)
