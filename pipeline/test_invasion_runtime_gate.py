import unittest

import invasion_runtime_gate


def healthy_sample():
    return {
        "ok": True,
        "fps": 60,
        "errors": [],
        "invasion": {
            "on": True,
            "phase": "running",
            "wave": 1,
            "alive": 9,
            "types": ["zombie", "soldado", "ufo"],
            "difficulty": "dificil",
            "telemetry": {
                "modelSource": {"glb": 9, "procedural": 0},
                "ai": {"spawn": 0, "pursue": 4, "strafe": 2, "attack": 3},
                "activeByType": {"zombie": 3, "soldado": 3, "ufo": 3},
                "spawnFailures": 0,
                "fallbackTotal": 0,
                "loadRejected": 0,
                "preload": {"requested": 6, "ready": 6, "failed": 0},
                "caps": {"enemies": 30, "shots": 48, "bursts": 120, "modelCache": 9},
                "runtimeCounts": {"enemies": 9, "shots": 8, "bursts": 2, "modelCache": 9},
                "withinCaps": True,
            },
        },
        "model_request_counts": {
            "zombie_lod1.glb": 1,
            "zombie_lod2.glb": 1,
            "soldado_lod1.glb": 1,
            "soldado_lod2.glb": 1,
            "ufo_lod1.glb": 1,
            "ufo_lod2.glb": 1,
        },
    }


class LongTaskBudgetTests(unittest.TestCase):
    def test_no_longtask_data_does_not_fail_synthetic_samples(self):
        self.assertEqual([], invasion_runtime_gate.validate_longtasks(healthy_sample()))

    def test_freeze_after_invasion_start_fails(self):
        sample = healthy_sample()
        sample["longtasks"] = {"invasion_started_at": 5000, "tasks": [[100, 900], [5020, 3838]]}
        failures = invasion_runtime_gate.validate_invasion_sample(sample)
        self.assertEqual(["longtask_budget"], [f["reason"] for f in failures])
        self.assertEqual(3838, failures[0]["worst_ms"])

    def test_world_load_tasks_before_the_start_and_short_tasks_pass(self):
        sample = healthy_sample()
        sample["longtasks"] = {"invasion_started_at": 5000, "tasks": [[100, 900], [5030, 60], [5200, 199]]}
        self.assertEqual([], invasion_runtime_gate.validate_invasion_sample(sample))


class InvasionRuntimeGateTests(unittest.TestCase):
    def test_healthy_mixed_invasion_passes(self):
        self.assertEqual([], invasion_runtime_gate.validate_invasion_sample(healthy_sample()))

    def test_fps_fallback_retry_and_cap_failures_are_independent(self):
        sample = healthy_sample()
        sample["fps"] = 49
        telemetry = sample["invasion"]["telemetry"]
        telemetry["modelSource"] = {"glb": 7, "procedural": 2}
        telemetry["fallbackTotal"] = 2
        telemetry["withinCaps"] = False
        telemetry["runtimeCounts"]["shots"] = 49
        sample["model_request_counts"]["zombie_lod1.glb"] = 4

        reasons = {
            row["reason"]
            for row in invasion_runtime_gate.validate_invasion_sample(sample)
        }

        self.assertTrue({
            "fps_below_50",
            "procedural_fallback",
            "runtime_cap_breach",
            "model_retry_storm",
        }.issubset(reasons))

    def test_missing_mixed_types_or_ai_telemetry_fails_closed(self):
        sample = healthy_sample()
        sample["invasion"]["telemetry"]["activeByType"] = {"zombie": 9}
        sample["invasion"]["telemetry"]["ai"] = {}

        reasons = {
            row["reason"]
            for row in invasion_runtime_gate.validate_invasion_sample(sample)
        }

        self.assertIn("mixed_types_missing", reasons)
        self.assertIn("ai_telemetry_missing", reasons)


if __name__ == "__main__":
    unittest.main()
