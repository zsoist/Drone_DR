import math
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
import flightverse_collision_gate  # noqa: E402


class DeployWorldGateTests(unittest.TestCase):
    def test_web_restart_runs_world_audit_and_100_sample_live_gate(self):
        source = (ROOT / "pipeline" / "safe_restart.sh").read_text()
        self.assertIn('audit_world.py', source)
        self.assertIn('flightverse_collision_gate.py', source)
        self.assertIn('--stress 100', source)
        self.assertIn('AEROBRAIN_SKIP_WORLD_GATE', source)
        self.assertIn('ACTIVE_WORLD', source)

    def test_live_sample_requires_model_sized_collision_envelope(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 1.2,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": 4,
        }

        failures = flightverse_collision_gate.validate_live_sample(sample)

        self.assertIn("collision_envelope", [row["reason"] for row in failures])

    def test_live_sample_requires_finite_camera_collision_telemetry(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": math.nan,
        }

        failures = flightverse_collision_gate.validate_live_sample(sample)

        self.assertIn("camera_telemetry", [row["reason"] for row in failures])

    def test_live_sample_requires_glb_bound_envelope_and_active_chase_camera(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "fallback",
            "customDrone": False,
            "cameraRig": "fpv",
            "cameraCollisionChecks": 0,
            "cameraCollisionHits": 0,
        }

        reasons = [
            row["reason"]
            for row in flightverse_collision_gate.validate_live_sample(sample)
        ]

        self.assertIn("collision_envelope_source", reasons)
        self.assertIn("camera_integration", reasons)

    def test_fpv_camera_requires_zero_collision_work(self):
        self.assertEqual(
            [],
            flightverse_collision_gate.validate_fpv_camera({
                "cameraRig": "fpv",
                "cameraCollisionChecks": 0,
                "cameraCollisionHits": 0,
            }),
        )
        reasons = [
            row["reason"]
            for row in flightverse_collision_gate.validate_fpv_camera({
                "cameraRig": "fpv",
                "cameraCollisionChecks": 1,
                "cameraCollisionHits": 1,
            })
        ]
        self.assertIn("fpv_camera_isolation", reasons)

    def test_valid_live_sample_has_no_failures(self):
        sample = {
            "run": 1,
            "ok": True,
            "fps": 60,
            "errors": [],
            "classification": True,
            "collisionReady": True,
            "groups": 1,
            "disposedStaleLoads": 0,
            "representation": {"visibleStructuralLayers": ["mesh", "terrain-fallback"]},
            "projectiles": 0,
            "collisionRadius": 0.59,
            "collisionRadiusSource": "glb",
            "customDrone": True,
            "cameraRig": "muycerca",
            "cameraCollisionChecks": 120,
            "cameraCollisionHits": 4,
        }

        self.assertEqual(
            [],
            flightverse_collision_gate.validate_live_sample(sample),
        )


if __name__ == "__main__":
    unittest.main()
