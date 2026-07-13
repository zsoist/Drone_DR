import sys
import unittest
import inspect
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import worker


class SplatAttemptPolicyTests(unittest.TestCase):
    def test_ultra_large_scene_skips_guaranteed_full_resolution_attempt(self):
        plan = worker.splat_attempt_plan({
            "preset": "ultra",
            "best_available": True,
            "preflight": {"recommended_d": 2},
        })

        self.assertEqual("ultra", plan[0]["preset"])
        self.assertEqual(2, plan[0]["d"])
        self.assertNotIn(1, [item["d"] for item in plan])
        self.assertIn("cinematic", {item["preset"] for item in plan})
        self.assertIn("medium", {item["preset"] for item in plan})

    def test_strict_mode_never_changes_preset(self):
        plan = worker.splat_attempt_plan({
            "preset": "ultra",
            "best_available": False,
            "preflight": {"recommended_d": 1},
        })

        self.assertEqual({"ultra"}, {item["preset"] for item in plan})
        self.assertEqual([1, 2], [item["d"] for item in plan])

    def test_medium_never_falls_below_medium(self):
        plan = worker.splat_attempt_plan({
            "preset": "medium",
            "best_available": True,
            "preflight": {"recommended_d": 2},
        })

        self.assertEqual([{"preset": "medium", "d": 2,
                           "reason": "preflight_input_floor"}], plan)

    def test_attempt_outcome_is_an_immutable_job_event(self):
        source = inspect.getsource(worker.run_splat)
        self.assertIn('"splat_attempt_failed"', source)
        self.assertIn('"splat_attempt_succeeded"', source)


if __name__ == "__main__":
    unittest.main()
