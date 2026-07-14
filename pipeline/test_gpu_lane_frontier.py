import sys
import inspect
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gpu_lane  # noqa: E402
import worker  # noqa: E402


class CudaAttemptPolicyTests(unittest.TestCase):
    def test_cuda_resolution_plans_never_lower_quality_or_backend(self):
        expected = {
            "auto": [("frontier", 1), ("frontier", 2)],
            "full": [("frontier", 1)],
            "half": [("frontier", 2)],
        }

        for resolution, plan in expected.items():
            with self.subTest(resolution=resolution):
                actual = worker.splat_attempt_plan({
                    "preset": "frontier", "backend": "cuda",
                    "backend_policy": "strict", "resolution": resolution,
                    "requested_downscale": 2 if resolution == "half" else 1,
                    "best_available": False,
                })
                self.assertEqual(plan, [(row["preset"], row["d"]) for row in actual])
                self.assertTrue(all(row["reason"].startswith("cuda_") for row in actual))

    def test_only_classified_oom_can_advance_auto_from_d1_to_d2(self):
        self.assertTrue(gpu_lane.should_retry_cuda("oom", "auto", 1))
        for failure in ("connectivity", "cancelled", "disk", "export", "trainer"):
            with self.subTest(failure=failure):
                self.assertFalse(gpu_lane.should_retry_cuda(failure, "auto", 1))
        self.assertFalse(gpu_lane.should_retry_cuda("oom", "full", 1))
        self.assertFalse(gpu_lane.should_retry_cuda("oom", "auto", 2))

    def test_failure_classification_is_typed(self):
        cases = (
            (137, "torch.OutOfMemoryError: CUDA out of memory", "oom"),
            (1, "RuntimeError: CUDA error: out of memory", "oom"),
            (255, "ssh: connect to host timed out", "connectivity"),
            (1, "No space left on device", "disk"),
            (-15, "cancelled by user", "cancelled"),
            (1, "ns-export failed to write splat.ply", "export"),
            (1, "Traceback from ns-train", "trainer"),
        )

        for rc, output, expected in cases:
            with self.subTest(output=output):
                self.assertEqual(expected, gpu_lane.classify_cuda_failure(rc, output))


class CudaCommandAndLifecycleTests(unittest.TestCase):
    def test_worker_exposes_exact_cuda_odm_feature_progress_observer(self):
        self.assertTrue(hasattr(worker, "odm_cuda_feature_progress"))

    def test_cuda_odm_feature_progress_uses_completed_images_not_log_tail_size(self):
        observe = worker.odm_cuda_feature_progress(4)

        self.assertIsNone(observe("Extracting ROOT_DSPSIFT features for image a.jpg"))
        self.assertEqual(0.2375, observe("Found 10000 points in 11.2s"))
        self.assertEqual(0.2750, observe("Found 9876 points in 12.1s"))
        self.assertEqual(0.3125, observe("Found 10000 points in 11.9s"))
        self.assertEqual(0.3500, observe("Found 10000 points in 10.8s"))
        self.assertEqual(0.3500, observe("Found 10000 points in 10.7s"))

    def test_remote_odm_wires_exact_feature_progress_into_tracked_process(self):
        source = inspect.getsource(worker.run_odm_cuda)
        self.assertIn("line_progress=odm_cuda_feature_progress(n)", source)
        self.assertIn('stage="odm-features", progress=0.20', source)

    def test_command_preserves_exact_frontier_schedule_and_scale(self):
        argv = gpu_lane.train_argv(
            "frontier-fixture", 30_000, 1, "run-fixture",
            train_args=[
                "--pipeline.model.sh-degree", "0",
                "--pipeline.model.stop-split-at", "15000",
            ],
        )
        command = " ".join(argv)

        self.assertIn("--max-num-iterations 30000", command)
        self.assertIn("--pipeline.model.sh-degree 0", command)
        self.assertIn("--pipeline.model.stop-split-at 15000", command)
        self.assertIn("--downscale-factor 1", command)
        self.assertIn("nvidia-smi", command)
        self.assertIn("telemetry-frontier-fixture.csv", command)

    def test_cuda_environment_is_activated_before_telemetry_is_backgrounded(self):
        command = " ".join(gpu_lane.train_argv(
            "frontier-fixture", 30_000, 1, "run-fixture"))

        self.assertIn("source splat-env/bin/activate;", command)
        self.assertIn("$VIRTUAL_ENV/bin/ns-train", command)
        self.assertNotIn("source splat-env/bin/activate &&", command)
        self.assertLess(command.index("source splat-env/bin/activate;"),
                        command.index("(while true;"))

    def test_cleanup_is_bounded_and_refuses_active_names(self):
        with self.assertRaisesRegex(ValueError, "activo"):
            gpu_lane.cleanup_script("job-active", success=True,
                                    active_names={"job-active"})
        script = gpu_lane.cleanup_script("job-finished", success=True,
                                         active_names=set())

        self.assertIn("/root/gpu-jobs/data/job-finished", script)
        self.assertIn("/root/gpu-jobs/runs/job-finished", script)
        self.assertIn("/mnt/c/Users/reyes/gpu-transfer/in-job-finished", script)
        self.assertIn("/mnt/c/Users/reyes/gpu-transfer/out-job-finished", script)
        self.assertNotIn("/root/gpu-jobs/data/*", script)
        self.assertNotIn("/root/gpu-jobs/runs/*", script)

    def test_failed_cleanup_marks_24_hour_retention_instead_of_deleting_wsl(self):
        script = gpu_lane.cleanup_script("job-failed", success=False,
                                         active_names=set(), now=1_000)

        self.assertIn("retain-until", script)
        self.assertIn("87400", script)
        self.assertNotIn("rm -rf /root/gpu-jobs/data/job-failed", script)
        self.assertNotIn("rm -rf /root/gpu-jobs/runs/job-failed", script)


if __name__ == "__main__":
    unittest.main()
