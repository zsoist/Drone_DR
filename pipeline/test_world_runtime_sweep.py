"""Regression coverage for the all-map World runtime deployment sweep."""
import unittest

import world_runtime_sweep


class WorldRuntimeSweepTests(unittest.TestCase):
    def test_healthy_terrain_world_passes_without_loading_inactive_mesh(self):
        report = {
            "ok": True,
            "fps": 60,
            "errors": [],
            "customDrone": True,
            "visualMesh": False,
            "visualMeshState": "deferred",
            "collision": {
                "ready": True,
                "structure": True,
                "radius_source": "glb",
            },
            "lifecycle": {"groups": 1, "disposedStaleLoads": 0},
            "representation": {
                "preferred": "terrain",
                "active": "terrain",
                "visibleStructuralLayers": ["terrain"],
            },
        }

        self.assertEqual(
            [],
            world_runtime_sweep.validate_world_runtime(
                "map-a", report, {"mesh_obj_requests": 0}),
        )

    def test_eager_or_duplicate_visual_layers_fail_the_sweep(self):
        report = {
            "ok": True,
            "fps": 60,
            "errors": [],
            "customDrone": True,
            "visualMesh": True,
            "visualMeshState": "ready",
            "collision": {
                "ready": True,
                "structure": True,
                "radius_source": "glb",
            },
            "lifecycle": {"groups": 1, "disposedStaleLoads": 0},
            "representation": {
                "preferred": "terrain",
                "active": "terrain",
                "visibleStructuralLayers": ["mesh", "splat", "terrain-fallback"],
            },
        }

        reasons = {
            row["reason"] for row in world_runtime_sweep.validate_world_runtime(
                "map-a", report, {"mesh_obj_requests": 1})
        }

        self.assertEqual(
            {
                "inactive_mesh_loaded",
                "duplicate_structural_layers",
                "visual_mesh_unclipped",
            },
            reasons,
        )

    def test_collision_lifecycle_and_console_failures_are_independent(self):
        report = {
            "ok": False,
            "fps": 42,
            "errors": ["objects: broken"],
            "customDrone": False,
            "visualMesh": False,
            "visualMeshState": "deferred",
            "collision": {
                "ready": False,
                "structure": False,
                "radius_source": "fallback",
            },
            "lifecycle": {"groups": 2, "disposedStaleLoads": 1},
            "representation": {
                "preferred": "terrain",
                "active": "terrain",
                "visibleStructuralLayers": ["terrain"],
            },
        }

        reasons = {
            row["reason"] for row in world_runtime_sweep.validate_world_runtime(
                "map-b", report, {"mesh_obj_requests": 0})
        }

        self.assertTrue({
            "autotest_failed",
            "fps_below_50",
            "runtime_errors",
            "custom_drone_missing",
            "world_collision_not_ready",
            "drone_envelope_not_glb",
            "scene_group_leak",
            "stale_load_disposal",
        }.issubset(reasons))


if __name__ == "__main__":
    unittest.main()
