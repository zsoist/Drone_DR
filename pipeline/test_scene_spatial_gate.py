import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server


class SceneSpatialGateTests(unittest.TestCase):
    def test_sources_must_have_measured_coverage_within_same_site_radius(self):
        scene = {"anchor": {"lat": 4.7512, "lon": -74.0630}}
        evidence = {
            "NEAR": {"clip_id": "NEAR", "coverage_bbox": [-74.064, 4.751, -74.063, 4.752]},
            "FAR": {"clip_id": "FAR", "coverage_bbox": [-74.080, 4.760, -74.079, 4.761]},
            "UNKNOWN": {"clip_id": "UNKNOWN", "coverage_bbox": None},
        }

        result = server.scene_source_compatibility(
            scene, ["NEAR", "FAR", "UNKNOWN"],
            evidence_fn=evidence.__getitem__, max_distance_m=500)

        self.assertEqual(["NEAR"], result["accepted"])
        rejected = {row["clip_id"]: row for row in result["rejected"]}
        self.assertEqual("outside_site_radius", rejected["FAR"]["reason"])
        self.assertGreater(rejected["FAR"]["distance_m"], 500)
        self.assertEqual("coverage_unknown", rejected["UNKNOWN"]["reason"])

    def test_anchorless_scene_uses_first_measured_source_as_truthful_anchor(self):
        evidence = {
            "A": {"clip_id": "A", "coverage_bbox": [-74.0641, 4.7510, -74.0639, 4.7512]},
            "B": {"clip_id": "B", "coverage_bbox": [-74.0642, 4.7511, -74.0640, 4.7513]},
        }

        result = server.scene_source_compatibility(
            {"anchor": {}}, ["A", "B"], evidence_fn=evidence.__getitem__)

        self.assertEqual(["A", "B"], result["accepted"])
        self.assertEqual("source:A", result["anchor_source"])


if __name__ == "__main__":
    unittest.main()
