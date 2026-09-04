"""Reality Sandwich materials allocated by perceptual value per byte."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter


REALITY_SANDWICH = (
    "physical_base",
    "source_microdetail",
    "procedural_variation",
    "decals_wetness",
)
MAP_COUNT = 4
CHANNEL_BYTES = 4


def _blur_scalar(values: np.ndarray, radius: float) -> np.ndarray:
    image = Image.fromarray(np.rint(np.clip(values, 0.0, 1.0) * 255.0).astype(np.uint8))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(radius=radius)), dtype=np.float64) / 255.0


def generate_reality_sandwich_maps(
    source_color_rgb: np.ndarray,
    heightfield_m: np.ndarray,
    *,
    spacing_m: tuple[float, float],
    semantic_masks: dict[str, np.ndarray],
) -> tuple[dict[str, np.ndarray], dict]:
    """Generate deterministic AOI-aligned PBR proxy maps from measured raster evidence."""
    color = np.asarray(source_color_rgb, dtype=np.uint8)
    height = np.asarray(heightfield_m, dtype=np.float64)
    if color.ndim != 3 or color.shape[2] != 3 or height.shape != color.shape[:2]:
        raise ValueError("PBR source color and heightfield shapes are incompatible")
    if not np.isfinite(height).all() or min(float(value) for value in spacing_m) <= 0:
        raise ValueError("PBR heightfield or spacing is invalid")
    masks = {name: np.asarray(mask, dtype=bool) for name, mask in semantic_masks.items()}
    if any(mask.shape != height.shape for mask in masks.values()):
        raise ValueError("PBR semantic masks must match the heightfield")

    rgb = color.astype(np.float64) / 255.0
    luma = np.einsum("...i,i->...", rgb, np.asarray([0.2126, 0.7152, 0.0722]))
    illumination_radius = max(2.0, min(height.shape) / 8.0)
    low_frequency = _blur_scalar(luma, illumination_radius)
    target = float(np.median(low_frequency))
    correction = target / np.maximum(low_frequency, 0.08)
    delighted_float = np.clip(rgb * correction[..., None], 0.0, 1.0)
    delighted = np.rint(delighted_float * 255.0).astype(np.uint8)
    delighted_luma = np.einsum(
        "...i,i->...", delighted_float, np.asarray([0.2126, 0.7152, 0.0722])
    )

    sx, sz = (float(value) for value in spacing_m)
    gradient_z, gradient_x = np.gradient(height, sz, sx)
    normal_vectors = np.stack((-gradient_x, -gradient_z, np.ones_like(height)), axis=-1)
    normal_vectors /= np.maximum(np.linalg.norm(normal_vectors, axis=-1, keepdims=True), 1e-9)
    normal = np.rint(np.clip(normal_vectors * 0.5 + 0.5, 0.0, 1.0) * 255.0).astype(np.uint8)

    roughness = np.full(height.shape, 190, dtype=np.uint8)
    roughness[masks.get("ground_surface", np.zeros_like(height, dtype=bool))] = 210
    roughness[masks.get("roof", np.zeros_like(height, dtype=bool))] = 165
    roughness[masks.get("vegetation", np.zeros_like(height, dtype=bool))] = 235

    height_span = float(np.ptp(height))
    normalized_height = (height - float(height.min())) / max(height_span, 1e-9)
    local_mean = _blur_scalar(normalized_height, 2.0)
    cavity = np.maximum(local_mean - normalized_height, 0.0)
    cavity_scale = max(float(np.percentile(cavity, 95)), 1e-6)
    ambient_occlusion = np.rint(255.0 * (1.0 - 0.5 * np.clip(cavity / cavity_scale, 0.0, 1.0))).astype(np.uint8)

    source_detail = luma - _blur_scalar(luma, 1.5)
    detail_scale = max(float(np.percentile(np.abs(source_detail), 95)), 1e-6)
    microdetail = np.rint(
        np.clip(0.5 + 0.5 * source_detail / detail_scale, 0.0, 1.0) * 255.0
    ).astype(np.uint8)
    report = {
        "version": 1,
        "method": "retinex_dsm_semantic_pbr_proxy_v1",
        "delighting_method": "single_scale_luma_retinex_with_median_exposure",
        "photometrically_calibrated": False,
        "low_frequency_luma_std_before": round(float(_blur_scalar(luma, illumination_radius).std()), 9),
        "low_frequency_luma_std_after": round(
            float(_blur_scalar(delighted_luma, illumination_radius).std()), 9
        ),
        "normal_basis": "aoi_planar_uv_tangent_space_from_dsm_gradient",
        "roughness_basis": "conservative_semantic_class_constants",
        "ambient_occlusion_basis": "local_height_cavity_proxy",
        "microdetail_basis": "source_orthomosaic_high_pass_luma",
        "limitations": [
            "basecolor correction is not calibrated intrinsic-image decomposition",
            "normal and AO are DSM-derived and do not encode facade microgeometry",
            "roughness is semantic-class prior, not measured BRDF",
        ],
    }
    return {
        "delighted_basecolor": delighted,
        "normal": normal,
        "roughness": roughness,
        "ambient_occlusion": ambient_occlusion,
        "microdetail": microdetail,
    }, report


@dataclass(frozen=True)
class SurfacePriority:
    surface_id: str
    max_projected_area: float
    minimum_distance_m: float
    view_frequency: float
    route_relevance: float
    material_class: str

    @property
    def score(self) -> float:
        distance = max(0.0, min(1.0, 1.0 - self.minimum_distance_m / 100.0))
        return (
            max(0.0, min(1.0, self.max_projected_area)) * 0.35
            + distance * 0.25
            + max(0.0, min(1.0, self.view_frequency)) * 0.15
            + max(0.0, min(1.0, self.route_relevance)) * 0.25
        )


@dataclass(frozen=True)
class MaterialRecipe:
    surface_id: str
    material_class: str
    tier: str
    resolution: int
    resident_bytes: int
    layers: tuple[str, ...] = REALITY_SANDWICH


def _tier(surface: SurfacePriority) -> str:
    if surface.minimum_distance_m <= 20 and surface.max_projected_area >= 0.1:
        return "A"
    if surface.minimum_distance_m <= 50 or surface.view_frequency >= 0.25:
        return "B"
    return "C"


def _bytes(resolution: int) -> int:
    return resolution * resolution * CHANNEL_BYTES * MAP_COUNT


def allocate_materials(
    surfaces: list[SurfacePriority],
    *,
    resident_budget_bytes: int,
    max_4k: int = 1,
) -> list[MaterialRecipe]:
    if resident_budget_bytes <= 0:
        raise ValueError("resident texture budget must be positive")
    ordered = sorted(surfaces, key=lambda row: (-row.score, row.surface_id))
    recipes: list[MaterialRecipe] = []
    used = 0
    used_4k = 0
    for index, surface in enumerate(ordered):
        tier = _tier(surface)
        desired = 2048 if tier == "A" else 1024 if tier == "B" else 512
        candidates = [desired, 1024, 512, 256]
        if tier == "A" and used_4k < max_4k:
            candidates.insert(0, 4096)
        resolution = 256
        remaining_surfaces = len(ordered) - index - 1
        reserve = remaining_surfaces * _bytes(256)
        for candidate in dict.fromkeys(candidates):
            if used + _bytes(candidate) + reserve <= resident_budget_bytes:
                resolution = candidate
                break
        resident = _bytes(resolution)
        if used + resident > resident_budget_bytes:
            raise ValueError("texture budget cannot fit minimum recipes")
        used += resident
        if resolution == 4096:
            used_4k += 1
        recipes.append(
            MaterialRecipe(
                surface.surface_id,
                surface.material_class,
                tier,
                resolution,
                resident,
            )
        )
    return recipes
