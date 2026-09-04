import unittest

from world_compiler.appearance.pbr import SurfacePriority, allocate_materials


class MaterialAllocationTests(unittest.TestCase):
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
