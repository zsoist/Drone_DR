import unittest
from types import SimpleNamespace

import numpy as np

from world_compiler.selection.hero_cell import (
    CandidateEvidence,
    SCORE_WEIGHTS,
    enumerate_grid,
    raster_candidate_evidence,
    score_candidate,
    select_hero_cell,
)


class HeroCellSelectionTests(unittest.TestCase):
    def test_weights_sum_to_one_and_all_full_evidence_scores_one(self):
        self.assertAlmostEqual(1.0, sum(SCORE_WEIGHTS.values()))
        score = score_candidate({name: 1.0 for name in SCORE_WEIGHTS})
        self.assertAlmostEqual(1.0, score.total)
        self.assertTrue(all(row.available for row in score.components.values()))

    def test_missing_metrics_earn_zero_and_remain_unavailable(self):
        score = score_candidate({"multi_view_coverage": 1.0})

        self.assertAlmostEqual(0.25, score.total)
        self.assertFalse(score.components["angular_diversity"].available)
        self.assertEqual(0.0, score.components["angular_diversity"].weighted)

    def test_grid_is_centered_and_contained_by_square_extent(self):
        centers = enumerate_grid((120.0, 120.0), size_m=100.0, step_m=10.0)

        self.assertEqual(
            [
                (-10.0, -10.0), (-10.0, 0.0), (-10.0, 10.0),
                (0.0, -10.0), (0.0, 0.0), (0.0, 10.0),
                (10.0, -10.0), (10.0, 0.0), (10.0, 10.0),
            ],
            centers,
        )

    def test_rejects_nodata_and_diameter_only_candidate(self):
        scene = SimpleNamespace(world_size_m=(120.0, 120.0))
        evidence = [
            CandidateEvidence((0.0, 0.0), {name: 0.7 for name in SCORE_WEIGHTS}, 0.7),
            CandidateEvidence((30.0, 0.0), {name: 1.0 for name in SCORE_WEIGHTS}, 1.0),
            CandidateEvidence((10.0, 10.0), {name: 0.8 for name in SCORE_WEIGHTS}, 1.0),
        ]

        report = select_hero_cell(scene, evidence, size_m=100.0)

        self.assertEqual((10.0, 10.0), report.selected.center_ab_m)
        reasons = {row.center_ab_m: row.rejection_reason for row in report.rejected}
        self.assertEqual("excessive_nodata", reasons[(0.0, 0.0)])
        self.assertEqual("outside_verified_square_extent", reasons[(30.0, 0.0)])

    def test_ties_sort_by_local_center(self):
        scene = SimpleNamespace(world_size_m=(200.0, 200.0))
        metrics = {name: 0.5 for name in SCORE_WEIGHTS}

        report = select_hero_cell(
            scene,
            [
                CandidateEvidence((10.0, 0.0), metrics, 1.0),
                CandidateEvidence((-10.0, 0.0), metrics, 1.0),
            ],
            size_m=100.0,
        )

        self.assertEqual((-10.0, 0.0), report.selected.center_ab_m)

    def test_raster_evidence_rewards_measured_mesh_and_valid_ground(self):
        valid = np.ones((10, 10), dtype=np.uint8)
        valid[:, :5] = 0
        mesh = np.zeros((10, 10), dtype=np.uint8)
        mesh[:, 5:] = 255
        height = np.zeros((10, 10), dtype=np.float32)
        height[:, 5:] = np.linspace(0, 12, 5)

        rows = raster_candidate_evidence(
            centers=[(-25.0, 0.0), (25.0, 0.0)],
            world_size_m=(100.0, 100.0),
            size_m=50.0,
            valid_mask=valid,
            mesh_coverage=mesh,
            heightfield=height,
            global_metrics={"multi_view_coverage": {"value": 1.0, "source": "5 sources"}},
        )

        self.assertLess(rows[0].valid_fraction, rows[1].valid_fraction)
        self.assertLess(
            rows[0].metrics["geometry_completeness"]["value"],
            rows[1].metrics["geometry_completeness"]["value"],
        )

    def test_planar_roof_candidate_outranks_equally_tall_rough_canopy(self):
        height = np.zeros((100, 100), dtype=np.float32)
        height[35:65, 15:35] = 8.0
        checker = np.indices((30, 20)).sum(axis=0) % 2
        height[35:65, 65:85] = checker * 8.0
        evidence = raster_candidate_evidence(
            centers=[(-25.0, 0.0), (25.0, 0.0)],
            world_size_m=(100.0, 100.0),
            size_m=40.0,
            valid_mask=np.ones_like(height, dtype=np.uint8),
            mesh_coverage=np.ones_like(height, dtype=np.uint8),
            heightfield=height,
        )

        self.assertGreater(
            evidence[0].metrics["roof_and_vertical_surface_mix"]["value"],
            evidence[1].metrics["roof_and_vertical_surface_mix"]["value"],
        )

    def test_measured_vegetation_proxy_reduces_route_playability(self):
        height = np.zeros((50, 100), dtype=np.float32)
        vegetation = np.zeros_like(height, dtype=bool)
        vegetation[:, 50:] = True
        evidence = raster_candidate_evidence(
            centers=[(-25.0, 0.0), (25.0, 0.0)],
            world_size_m=(100.0, 50.0),
            size_m=40.0,
            valid_mask=np.ones_like(height, dtype=np.uint8),
            mesh_coverage=np.ones_like(height, dtype=np.uint8),
            heightfield=height,
            vegetation_mask=vegetation,
        )

        self.assertGreater(
            evidence[0].metrics["route_playability"]["value"],
            evidence[1].metrics["route_playability"]["value"],
        )
        self.assertEqual(
            "ortho green-dominance vegetation proxy",
            evidence[1].metrics["route_playability"]["source"],
        )


if __name__ == "__main__":
    unittest.main()
