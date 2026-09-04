"""Reality Sandwich materials allocated by perceptual value per byte."""

from __future__ import annotations

from dataclasses import dataclass


REALITY_SANDWICH = (
    "physical_base",
    "source_microdetail",
    "procedural_variation",
    "decals_wetness",
)
MAP_COUNT = 4
CHANNEL_BYTES = 4


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
