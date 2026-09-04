import tempfile
import unittest
from pathlib import Path

import numpy as np

from world_compiler.qa.geometry_metrics import (
    route_visibility_weighted_coverage,
    source_surface_agreement,
    source_vertex_agreement,
    summarize_errors,
)
from world_compiler.qa.performance import evaluate_performance
from world_compiler.qa.report import acceptance_verdict, write_acceptance_report


class QualityAcceptanceTests(unittest.TestCase):
    def test_route_visibility_weights_near_screen_space_more_than_far_geometry(self):
        triangle = np.asarray([[0, 1, 2]], dtype=np.uint32)
        near = np.asarray([[-1.0, 0.0, -1.0], [1.0, 0.0, -1.0], [0.0, 0.0, 1.0]])
        far = near + np.asarray([30.0, 0.0, 0.0])

        report = route_visibility_weighted_coverage(
            [
                ("OBSERVED_WEAK", near, triangle),
                ("GEOMETRICALLY_INFERRED", far, triangle),
            ],
            np.asarray([[0.0, 10.0, 0.0]]),
            heightfield=np.zeros((11, 51)),
            world_size_m=(50.0, 10.0),
            valid_mask=np.ones((11, 51), dtype=bool),
            provenance_classes=(
                "OBSERVED_MULTI_VIEW",
                "OBSERVED_WEAK",
                "GEOMETRICALLY_INFERRED",
                "GENERATED_CONSTRAINED",
                "UNKNOWN",
            ),
        )

        self.assertTrue(report["route_visibility_weighted"])
        self.assertGreater(
            report["coverage_pct"]["OBSERVED_WEAK"],
            report["coverage_pct"]["GEOMETRICALLY_INFERRED"],
        )
        self.assertFalse(report["camera_frustum_applied"])
        self.assertEqual(
            {
                "OBSERVED_MULTI_VIEW",
                "OBSERVED_WEAK",
                "GEOMETRICALLY_INFERRED",
                "GENERATED_CONSTRAINED",
                "UNKNOWN",
            },
            set(report["coverage_pct"]),
        )

    def test_source_vertex_proxy_is_measured_but_never_independent_ground_truth(self):
        candidate = np.asarray([[0, 1, 0], [1, 1, 0]], dtype=float)
        source = np.asarray([[0, 1.1, 0], [1, 1.2, 0], [99, 99, 99]], dtype=float)

        result = source_vertex_agreement(
            candidate, source, center_ab_m=(0.0, 0.0), size_m=10.0
        )

        self.assertEqual(2, result["source_vertex_count_in_aoi"])
        self.assertAlmostEqual(0.15, result["proxy"]["median_m"])
        self.assertFalse(result["independent_ground_truth"])
        self.assertFalse(result["acceptance_gate_eligible"])

    def test_surface_proxy_measures_triangles_and_deduplicates_candidate_vertices(self):
        source = np.asarray([[0, 0, 0], [2, 0, 0], [0, 0, 2]], dtype=float)
        faces = np.asarray([[0, 1, 2]], dtype=np.uint32)
        candidate = np.asarray([[0.5, 0.2, 0.5], [0.5, 0.2, 0.5]], dtype=float)

        result = source_surface_agreement(
            candidate,
            source,
            faces,
            center_ab_m=(0.0, 0.0),
            size_m=10.0,
        )

        self.assertEqual(1, result["candidate_vertex_count"])
        self.assertAlmostEqual(0.2, result["proxy"]["median_m"])
        self.assertFalse(result["acceptance_gate_eligible"])

    def test_geometry_distribution_uses_literal_median_and_p95(self):
        result = summarize_errors([0.05, 0.10, 0.15, 0.20, 0.40])

        self.assertEqual(0.15, result["median_m"])
        self.assertAlmostEqual(0.36, result["p95_m"])
        self.assertTrue(result["passes_median"])
        self.assertTrue(result["passes_p95"])

    def test_missing_performance_measurements_cannot_pass(self):
        result = evaluate_performance(None, None, None, route_completed=None)

        self.assertEqual("blocked_external", result["status"])
        self.assertFalse(result["passes"])

    def test_performance_requires_all_thresholds_and_route(self):
        passing = evaluate_performance(62.0, 48.0, 7000, route_completed=True)
        failing = evaluate_performance(62.0, 40.0, 7000, route_completed=True)

        self.assertTrue(passing["passes"])
        self.assertFalse(failing["passes"])

    def test_compiler_pass_with_external_unreal_blocker_is_only_partial(self):
        self.assertEqual("partially accepted", acceptance_verdict(True, "blocked_external", False))
        self.assertEqual("blocked", acceptance_verdict(False, "blocked_external", False))
        self.assertEqual("accepted", acceptance_verdict(True, "passed", True))

    def test_report_serializes_unknown_metrics_without_inventing_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metrics = {
                "compiler_passes": True,
                "unreal_status": "blocked_external",
                "geometry": {"median_m": None, "p95_m": None},
                "performance": evaluate_performance(None, None, None, route_completed=None),
            }

            verdict = write_acceptance_report(root, metrics)

            self.assertEqual("partially accepted", verdict)
            self.assertIn('"median_m":null', (root / "metrics.json").read_text())
            self.assertIn("partially accepted", (root / "acceptance.md").read_text())


if __name__ == "__main__":
    unittest.main()
