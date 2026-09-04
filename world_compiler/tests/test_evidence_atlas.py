import unittest

from world_compiler.appearance.camera_selection import (
    CameraObservation,
    rank_observations,
    select_compatible_blend,
)
from world_compiler.appearance.evidence_atlas import (
    build_evidence_atlas,
    build_raster_evidence_atlas,
)


class EvidenceAtlasTests(unittest.TestCase):
    def test_sharp_frontal_clean_observation_outranks_bad_samples(self):
        good = CameraObservation("cam_good", True, 0.9, 0.9, 0.9, 0.9, 0.9, 0.95, 0.5)
        blurred = CameraObservation("cam_blur", True, 0.1, 0.9, 0.9, 0.9, 0.9, 0.95, 0.5)
        oblique = CameraObservation("cam_oblique", True, 0.9, 0.9, 0.1, 0.9, 0.9, 0.95, 0.5)
        dynamic = CameraObservation("cam_dynamic", True, 0.9, 0.9, 0.9, 0.9, 0.9, 0.05, 0.5)
        occluded = CameraObservation("cam_hidden", False, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5)

        ranked = rank_observations([blurred, oblique, dynamic, occluded, good])

        self.assertEqual("cam_good", ranked[0].observation.camera_id)
        self.assertEqual(0.0, ranked[-1].score)

    def test_incompatible_exposures_do_not_blend(self):
        observations = [
            CameraObservation("cam_base", True, 0.9, 0.9, 0.9, 1.0, 0.9, 0.9, 0.5),
            CameraObservation("cam_match", True, 0.8, 0.9, 0.9, 1.0, 0.9, 0.9, 0.58),
            CameraObservation("cam_clipped", True, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.95),
        ]

        blend = select_compatible_blend(rank_observations(observations), exposure_tolerance=0.2)

        self.assertEqual(["cam_base", "cam_match"], [row.observation.camera_id for row in blend])

    def test_atlas_preserves_dominant_camera_weights_and_masks(self):
        patches = {
            "roof_1": [CameraObservation("c1", True, 0.9, 0.9, 0.9, 1.0, 0.9, 0.9, 0.5)],
            "hidden_1": [],
        }

        atlas = build_evidence_atlas(patches, generated_patches={"hidden_1"})

        self.assertEqual("c1", atlas["patches"]["roof_1"]["dominant_camera"])
        self.assertAlmostEqual(1.0, sum(atlas["patches"]["roof_1"]["weights"].values()))
        self.assertTrue(atlas["patches"]["hidden_1"]["generated_mask"])
        self.assertTrue(atlas["patches"]["hidden_1"]["repair_mask"])

    def test_raster_atlas_never_claims_unmeasured_camera_weights_or_pbr_maps(self):
        atlas = build_raster_evidence_atlas(
            shape=(10, 12),
            source_color="materials/source_color.png",
            confidence="truth/confidence.png",
            dominant_camera_index="truth/camera_index.png",
            generated_or_repair_mask="semantics/masks/replacement.png",
        )

        self.assertEqual("measured_orthomosaic_proxy", atlas["status"])
        self.assertFalse(atlas["per_texel_camera_weights_available"])
        self.assertIn("capture illumination", " ".join(atlas["limitations"]))


if __name__ == "__main__":
    unittest.main()
