import unittest

from world_compiler.evidence.truth_field import (
    Calibration,
    SurfaceEvidence,
    TruthClass,
    build_truth_field,
    classify_surface,
    validate_truth_field_document,
)


class TruthFieldTests(unittest.TestCase):
    def test_dense_multiview_scores_above_weak_and_occluded_surfaces(self):
        calibration = Calibration()
        dense = classify_surface(
            SurfaceEvidence.observed(
                camera_ids=("c1", "c2", "c3", "c4"),
                angular_diversity=0.9,
                sharpness=0.9,
                projected_density=0.9,
                exposure_consistency=0.9,
                reprojection_quality=0.9,
                occlusion_confidence=0.9,
                geometry_agreement=0.9,
                dynamic_cleanliness=0.9,
                boundary_support=0.9,
            ),
            calibration,
        )
        weak = classify_surface(
            SurfaceEvidence.observed(
                camera_ids=("c1",),
                angular_diversity=0.1,
                sharpness=0.6,
                projected_density=0.5,
                exposure_consistency=0.6,
                reprojection_quality=0.5,
                occlusion_confidence=0.7,
                geometry_agreement=0.6,
                dynamic_cleanliness=0.8,
                boundary_support=0.5,
            ),
            calibration,
        )
        occluded = classify_surface(
            SurfaceEvidence.observed(
                camera_ids=("c1", "c2"),
                angular_diversity=0.2,
                sharpness=0.7,
                projected_density=0.7,
                exposure_consistency=0.7,
                reprojection_quality=0.6,
                occlusion_confidence=0.05,
                geometry_agreement=0.6,
                dynamic_cleanliness=0.8,
                boundary_support=0.3,
            ),
            calibration,
        )

        self.assertEqual(TruthClass.OBSERVED_MULTI_VIEW, dense.truth_class)
        self.assertEqual(TruthClass.OBSERVED_WEAK, weak.truth_class)
        self.assertEqual(TruthClass.OBSERVED_WEAK, occluded.truth_class)
        self.assertGreater(dense.confidence, weak.confidence)
        self.assertGreater(weak.confidence, occluded.confidence)

    def test_generated_and_inferred_surfaces_never_become_observed(self):
        calibration = Calibration()
        generated = classify_surface(
            SurfaceEvidence.generated(confidence_inputs=1.0, method="grammar-v1"),
            calibration,
        )
        inferred = classify_surface(
            SurfaceEvidence.inferred(confidence_inputs=0.95, method="plane-fit-v1"),
            calibration,
        )

        self.assertEqual(TruthClass.GENERATED_CONSTRAINED, generated.truth_class)
        self.assertEqual(TruthClass.GEOMETRICALLY_INFERRED, inferred.truth_class)
        self.assertEqual((), generated.source_camera_ids)
        self.assertEqual((), inferred.source_camera_ids)

    def test_unseen_surface_is_unknown_without_camera_references(self):
        sample = classify_surface(SurfaceEvidence.unknown(), Calibration())

        self.assertEqual(TruthClass.UNKNOWN, sample.truth_class)
        self.assertEqual(0.0, sample.confidence)
        self.assertEqual((), sample.source_camera_ids)

    def test_build_document_has_complete_coverage_and_valid_legend(self):
        field = build_truth_field(
            [
                SurfaceEvidence.generated(0.7, "grammar-v1"),
                SurfaceEvidence.inferred(0.6, "plane-fit-v1"),
                SurfaceEvidence.unknown(),
                SurfaceEvidence.observed(
                    camera_ids=("c1", "c2", "c3"),
                    angular_diversity=0.8,
                    sharpness=0.8,
                    projected_density=0.8,
                    exposure_consistency=0.8,
                    reprojection_quality=0.8,
                    occlusion_confidence=0.8,
                    geometry_agreement=0.8,
                    dynamic_cleanliness=0.8,
                    boundary_support=0.8,
                ),
            ],
            Calibration(calibration_id="fixture-v1"),
        )

        validate_truth_field_document(field)
        self.assertEqual(4, field["sample_count"])
        self.assertAlmostEqual(100.0, sum(field["coverage_pct"].values()))
        self.assertEqual("#000000", field["legend"][TruthClass.UNKNOWN.value])

    def test_document_validator_rejects_observed_sample_without_camera(self):
        field = build_truth_field([SurfaceEvidence.unknown()], Calibration())
        field["samples"][0]["class"] = TruthClass.OBSERVED_MULTI_VIEW.value

        with self.assertRaisesRegex(ValueError, "observed sample requires cameras"):
            validate_truth_field_document(field)

    def test_spatial_document_requires_complete_raster_contract(self):
        field = build_truth_field([], Calibration())
        field["raster"] = {"confidence": "truth/confidence.png"}
        field["shape"] = [10, 10]

        with self.assertRaisesRegex(ValueError, "spatial truth raster"):
            validate_truth_field_document(field)


if __name__ == "__main__":
    unittest.main()
