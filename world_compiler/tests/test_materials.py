import unittest

import numpy as np

from world_compiler.appearance.pbr import (
    SurfacePriority,
    allocate_materials,
    generate_reality_sandwich_maps,
)


class MaterialAllocationTests(unittest.TestCase):
    def test_reality_sandwich_generates_maps_and_reduces_low_frequency_lighting(self):
        rows, cols = 32, 32
        illumination = np.linspace(0.35, 1.0, cols)[None, :, None]
        albedo = np.full((rows, cols, 3), (180, 120, 80), dtype=np.float64)
        source = np.rint(albedo * illumination).astype(np.uint8)
        height = np.zeros((rows, cols), dtype=np.float64)
        height[8:24, 8:24] = 5.0
        roof = np.zeros((rows, cols), dtype=bool)
        roof[8:24, 8:24] = True
        ground = ~roof

        maps, report = generate_reality_sandwich_maps(
            source,
            height,
            spacing_m=(1.0, 1.0),
            semantic_masks={"roof": roof, "ground_surface": ground},
        )

        self.assertEqual(
            {"delighted_basecolor", "normal", "roughness", "ambient_occlusion", "microdetail"},
            set(maps),
        )
        self.assertTrue(all(value.shape[:2] == (rows, cols) for value in maps.values()))
        self.assertTrue(all(value.dtype == np.uint8 for value in maps.values()))
        self.assertLess(
            report["low_frequency_luma_std_after"],
            report["low_frequency_luma_std_before"],
        )
        self.assertEqual(3, maps["normal"].shape[2])
        np.testing.assert_allclose(maps["normal"][0, 0], [128, 128, 255], atol=1)
        self.assertGreater(int(maps["roughness"][ground].mean()), int(maps["roughness"][roof].mean()))

    def test_unique_texture_budget_caps_4k_and_total_residency(self):
        surfaces = [
            SurfacePriority("hero_roof", 0.45, 8.0, 0.9, 1.0, "concrete"),
            SurfacePriority("facade", 0.18, 14.0, 0.6, 0.8, "brick"),
            SurfacePriority("far_ground", 0.02, 70.0, 0.2, 0.1, "asphalt"),
        ]

        recipes = allocate_materials(surfaces, resident_budget_bytes=400 * 1024 * 1024, max_4k=1)

        self.assertLessEqual(sum(recipe.resident_bytes for recipe in recipes), 400 * 1024 * 1024)
        self.assertLessEqual(sum(recipe.resolution == 4096 for recipe in recipes), 1)
        self.assertEqual("A", recipes[0].tier)
        self.assertEqual("C", recipes[-1].tier)
        self.assertEqual(
            ("physical_base", "source_microdetail", "procedural_variation", "decals_wetness"),
            recipes[0].layers,
        )

    def test_budget_failure_downgrades_instead_of_overcommitting(self):
        surfaces = [SurfacePriority("hero", 0.5, 5.0, 1.0, 1.0, "roof_membrane")]

        recipes = allocate_materials(surfaces, resident_budget_bytes=20 * 1024 * 1024, max_4k=1)

        self.assertLessEqual(recipes[0].resident_bytes, 20 * 1024 * 1024)
        self.assertLess(recipes[0].resolution, 4096)


if __name__ == "__main__":
    unittest.main()
