"""Read OpenSfM poses and project local AeroBrain surfaces into real cameras."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np


METERS_PER_DEGREE_LATITUDE = 111_320.0


def _rodrigues(rotation: object) -> np.ndarray:
    vector = np.asarray(rotation, dtype=np.float64)
    if vector.shape != (3,) or not np.isfinite(vector).all():
        raise ValueError("OpenSfM rotation must be a finite Rodrigues vector")
    theta = float(np.linalg.norm(vector))
    if theta < 1e-12:
        return np.eye(3, dtype=np.float64)
    axis = vector / theta
    x, y, z = axis
    skew = np.asarray([[0, -z, y], [z, 0, -x], [-y, x, 0]], dtype=np.float64)
    return np.eye(3) + math.sin(theta) * skew + (1.0 - math.cos(theta)) * (skew @ skew)


@dataclass(frozen=True)
class CameraPose:
    camera_id: str
    center_ab_m: tuple[float, float, float]
    forward_ab: tuple[float, float, float]
    rotation_topocentric_to_camera: tuple[tuple[float, ...], ...]
    translation: tuple[float, float, float]
    focal_x: float
    focal_y: float
    principal_x: float
    principal_y: float
    image_width: int
    image_height: int

    def as_dict(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "center_ab_m": list(self.center_ab_m),
            "forward_ab": list(self.forward_ab),
            "image_size": [self.image_width, self.image_height],
            "intrinsics": {
                "focal_x": self.focal_x,
                "focal_y": self.focal_y,
                "principal_x": self.principal_x,
                "principal_y": self.principal_y,
            },
        }


@dataclass(frozen=True)
class CameraSet:
    poses: tuple[CameraPose, ...]
    east_offset_m: float
    north_offset_m: float
    elevation_origin_m: float
    projection_method: str = "opensfm_brown_pinhole_proxy_v1"


@dataclass(frozen=True)
class CameraSupportGrid:
    visible_count: np.ndarray
    angular_diversity: np.ndarray
    dominant_camera_index: np.ndarray
    nearest_distance_m: np.ndarray
    method: str = "opensfm_frustum_no_occlusion_v1"


def load_opensfm_cameras(path: Path, world: dict) -> CameraSet:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        reconstruction = payload[0]
        reference = reconstruction["reference_lla"]
        models = reconstruction["cameras"]
        shots = reconstruction["shots"]
        center_lon, center_lat = (float(value) for value in world["center_wgs84"])
        elevation_origin = float(world["elev_min"])
    except (OSError, ValueError, TypeError, KeyError, IndexError) as error:
        raise ValueError("invalid OpenSfM camera reconstruction") from error
    east_offset = (
        (float(reference["longitude"]) - center_lon)
        * METERS_PER_DEGREE_LATITUDE
        * math.cos(math.radians(center_lat))
    )
    north_offset = (
        (float(reference["latitude"]) - center_lat) * METERS_PER_DEGREE_LATITUDE
    )
    poses: list[CameraPose] = []
    for camera_id, shot in sorted(shots.items()):
        try:
            model = models[shot["camera"]]
            rotation = _rodrigues(shot["rotation"])
            translation = np.asarray(shot["translation"], dtype=np.float64)
            if translation.shape != (3,) or not np.isfinite(translation).all():
                raise ValueError
            center_topo = -rotation.T @ translation
            forward_topo = rotation.T @ np.asarray([0.0, 0.0, 1.0])
            center_ab = (
                center_topo[0] + east_offset,
                center_topo[2] - elevation_origin,
                -center_topo[1] - north_offset,
            )
            forward_ab = (forward_topo[0], forward_topo[2], -forward_topo[1])
            pose = CameraPose(
                str(camera_id),
                tuple(float(value) for value in center_ab),
                tuple(float(value) for value in forward_ab),
                tuple(tuple(float(value) for value in row) for row in rotation),
                tuple(float(value) for value in translation),
                float(model.get("focal_x") or model.get("focal") or 0.0),
                float(model.get("focal_y") or model.get("focal") or 0.0),
                float(model.get("c_x") or 0.0),
                float(model.get("c_y") or 0.0),
                int(model["width"]),
                int(model["height"]),
            )
        except (ValueError, TypeError, KeyError) as error:
            raise ValueError(f"invalid OpenSfM shot: {camera_id}") from error
        if pose.focal_x <= 0 or pose.focal_y <= 0 or min(pose.image_width, pose.image_height) <= 0:
            raise ValueError(f"invalid OpenSfM camera model: {shot['camera']}")
        poses.append(pose)
    if not poses:
        raise ValueError("OpenSfM reconstruction contains no shots")
    return CameraSet(tuple(poses), east_offset, north_offset, elevation_origin)


def camera_support_grid(
    cameras: CameraSet,
    *,
    x_ab_m: np.ndarray,
    y_ab_m: np.ndarray,
    z_ab_m: np.ndarray,
) -> CameraSupportGrid:
    x = np.asarray(x_ab_m, dtype=np.float64)
    y = np.asarray(y_ab_m, dtype=np.float64)
    z = np.asarray(z_ab_m, dtype=np.float64)
    if x.shape != y.shape or x.shape != z.shape or x.ndim != 2:
        raise ValueError("surface coordinate grids must share one 2D shape")
    if not np.isfinite(x).all() or not np.isfinite(y).all() or not np.isfinite(z).all():
        raise ValueError("surface coordinate grids must be finite")
    topo = np.stack(
        (
            x - cameras.east_offset_m,
            -z - cameras.north_offset_m,
            y + cameras.elevation_origin_m,
        ),
        axis=-1,
    )
    count = np.zeros(x.shape, dtype=np.uint16)
    dominant = np.full(x.shape, -1, dtype=np.int32)
    nearest = np.full(x.shape, np.inf, dtype=np.float64)
    azimuth_x = np.zeros(x.shape, dtype=np.float64)
    azimuth_z = np.zeros(x.shape, dtype=np.float64)
    for index, pose in enumerate(cameras.poses):
        rotation = np.asarray(pose.rotation_topocentric_to_camera)
        translation = np.asarray(pose.translation)
        projected = np.einsum("ij,...j->...i", rotation, topo) + translation
        depth = projected[..., 2]
        safe_depth = np.where(depth > 1e-9, depth, 1.0)
        image_x = projected[..., 0] / safe_depth
        image_y = projected[..., 1] / safe_depth
        half_x = 0.5 / pose.focal_x
        half_y = 0.5 * (pose.image_height / pose.image_width) / pose.focal_y
        visible = (
            (depth > 0)
            & (np.abs(image_x - pose.principal_x) <= half_x)
            & (np.abs(image_y - pose.principal_y) <= half_y)
        )
        count += visible.astype(np.uint16)
        cx, _, cz = pose.center_ab_m
        dx = cx - x
        dz = cz - z
        horizontal = np.hypot(dx, dz)
        unit_x = np.divide(dx, horizontal, out=np.zeros_like(dx), where=horizontal > 1e-9)
        unit_z = np.divide(dz, horizontal, out=np.zeros_like(dz), where=horizontal > 1e-9)
        azimuth_x += np.where(visible, unit_x, 0.0)
        azimuth_z += np.where(visible, unit_z, 0.0)
        distance = np.linalg.norm(np.asarray(pose.center_ab_m) - np.stack((x, y, z), axis=-1), axis=-1)
        better = visible & (distance < nearest)
        nearest = np.where(better, distance, nearest)
        dominant = np.where(better, index, dominant)
    safe_count = np.maximum(count, 1)
    concentration = np.hypot(azimuth_x / safe_count, azimuth_z / safe_count)
    diversity = np.where(count >= 2, np.clip(1.0 - concentration, 0.0, 1.0), 0.0)
    nearest = np.where(np.isfinite(nearest), nearest, -1.0)
    return CameraSupportGrid(count, diversity.astype(np.float32), dominant, nearest.astype(np.float32))
