import unittest

from world_compiler.completion.hypotheses import CompletionHypothesis, select_hypothesis
from world_compiler.completion.missing_views import MissingRegion, rank_missing_views
from world_compiler.completion.validator import ObservationCheck, validate_hypothesis
from world_compiler.evidence.truth_field import TruthClass


class CompletionTests(unittest.TestCase):
    def test_render_to_refute_rejects_observation_contradictions(self):
        hypothesis = CompletionHypothesis("h_bad", "grammar-v1", 7, (0, 0, 0, 5, 8, 5))
        report = validate_hypothesis(
            hypothesis,
            [ObservationCheck("c1", silhouette_iou=0.7, corner_error_m=0.3, occlusion_ok=False)],
        )

        self.assertTrue(report.rejected)
        self.assertEqual(
            ("silhouette_mismatch", "corner_mismatch", "occlusion_contradiction"),
            report.reasons,
        )

    def test_selects_strongest_non_refuted_hypothesis_and_preserves_provenance(self):
        weak = CompletionHypothesis("h1", "grammar-v1", 1, (0, 0, 0, 4, 8, 4))
        strong = CompletionHypothesis("h2", "symmetry-v1", 2, (0, 0, 0, 4, 8, 4))
        observations = {
            "h1": [ObservationCheck("c1", 0.91, 0.12, True, plausibility=0.6)],
            "h2": [ObservationCheck("c1", 0.97, 0.04, True, plausibility=0.9)],
        }

        decision = select_hypothesis([weak, strong], observations)

        self.assertEqual("h2", decision.selected.hypothesis_id)
        self.assertEqual(TruthClass.GENERATED_CONSTRAINED, decision.selected.provenance)
        self.assertEqual(2, len(decision.reports))

    def test_missing_view_ranking_uses_uncertainty_visibility_and_gameplay(self):
        regions = [
            MissingRegion("rare", 0.9, 0.2, 0.1, (0, 10, 0), 8, -45, 90, 12, "unseen"),
            MissingRegion("hero", 0.8, 0.9, 1.0, (5, 12, 3), 10, -35, 180, 18, "facade_gap"),
        ]

        report = rank_missing_views(regions)

        self.assertEqual("hero", report["requests"][0]["target_region"])
        self.assertGreater(report["requests"][0]["expected_information_gain"], report["requests"][1]["expected_information_gain"])
        self.assertIn("safety_legal_note", report["requests"][0])


if __name__ == "__main__":
    unittest.main()
