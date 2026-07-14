import sys
import inspect
import tempfile
import unittest
from pathlib import Path

from PIL import Image

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
        command = gpu_lane.train_script(
            "frontier-fixture", 30_000, 1, "run-fixture",
            train_args=[
                "--pipeline.model.sh-degree", "0",
                "--pipeline.model.stop-split-at", "15000",
            ],
        )

        self.assertIn("--max-num-iterations 30000", command)
        self.assertIn("--pipeline.model.sh-degree 0", command)
        self.assertIn("--pipeline.model.stop-split-at 15000", command)
        self.assertIn("--downscale-factor 1", command)
        self.assertIn("nvidia-smi", command)
        self.assertIn("telemetry-frontier-fixture.csv", command)

    def test_resume_command_loads_exact_checkpoint_without_resetting_target(self):
        command = gpu_lane.train_script(
            "frontier-recovery", 30_000, 1, "resume-run",
            resume_checkpoint=(
                "/root/gpu-jobs/checkpoints/splat-safe/step-000004000.ckpt"),
        )

        self.assertIn("--load-checkpoint /root/gpu-jobs/checkpoints/splat-safe/step-000004000.ckpt", command)
        self.assertIn("--max-num-iterations 30000", command)
        self.assertIn("--downscale-factor 1", command)

    def test_resume_checkpoint_is_confined_to_checkpoint_vault(self):
        valid = "/root/gpu-jobs/checkpoints/splat-safe/step-000004000.ckpt"
        self.assertEqual(valid, gpu_lane.validate_resume_checkpoint(valid))
        for invalid in ("/tmp/model.ckpt", "../../model.ckpt",
                        "/root/gpu-jobs/checkpoints/a/../escape.ckpt"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                gpu_lane.validate_resume_checkpoint(invalid)

    def test_failed_cuda_attempt_archives_latest_checkpoint_before_cleanup(self):
        source = inspect.getsource(worker.run_splat_cuda)

        self.assertIn("archive_latest_checkpoint", source)
        self.assertIn('"cuda_checkpoint"', source)
        self.assertIn("checkpoint=checkpoint", source)

    def test_cuda_environment_is_activated_before_telemetry_is_backgrounded(self):
        command = gpu_lane.train_script(
            "frontier-fixture", 30_000, 1, "run-fixture")

        self.assertIn("source splat-env/bin/activate\n", command)
        self.assertIn("$VIRTUAL_ENV/bin/ns-train", command)
        self.assertNotIn("source splat-env/bin/activate &&", command)
        self.assertLess(command.index("source splat-env/bin/activate\n"),
                        command.index("while true;"))

    def test_tracked_argv_contains_no_windows_expandable_shell_state(self):
        command = " ".join(gpu_lane.train_argv(
            "frontier-fixture", 30_000, 1, "run-fixture"))

        self.assertEqual(
            "ssh pc wsl -d Ubuntu -- bash "
            "/root/gpu-jobs/runs/.scripts/train-frontier-fixture.sh",
            command,
        )
        self.assertNotIn("$", command)
        self.assertNotIn("PIPESTATUS", command)

    def test_install_train_script_uses_stdin_boundary_and_returns_exact_path(self):
        calls = []
        original = gpu_lane._wsl
        gpu_lane._wsl = lambda script, timeout, label: calls.append(
            (script, timeout, label)) or ""
        try:
            path = gpu_lane.install_train_script(
                "frontier-fixture", 30_000, 1, "run-fixture")
        finally:
            gpu_lane._wsl = original

        self.assertEqual(
            "/root/gpu-jobs/runs/.scripts/train-frontier-fixture.sh", path)
        self.assertEqual("instalar script CUDA", calls[0][2])
        self.assertIn("base64 -d", calls[0][0])
        self.assertIn("chmod 700", calls[0][0])

    def test_large_decoded_image_cache_stays_on_cpu_to_preserve_vram(self):
        with tempfile.TemporaryDirectory() as td:
            images = Path(td) / "images"
            images.mkdir()
            for index in range(4):
                Image.new("RGB", (4000, 3000)).save(images / f"{index}.jpg")

            policy = gpu_lane.image_cache_policy(Path(td), downscale=1,
                                                  vram_total_mb=160)

        self.assertEqual("cpu", policy["device"])
        self.assertGreater(policy["decoded_mib"], policy["gpu_cache_budget_mib"])

    def test_small_or_downscaled_cache_uses_gpu_fast_path(self):
        with tempfile.TemporaryDirectory() as td:
            images = Path(td) / "images"
            images.mkdir()
            Image.new("RGB", (1600, 900)).save(images / "one.jpg")

            policy = gpu_lane.image_cache_policy(Path(td), downscale=2,
                                                  vram_total_mb=8192)

        self.assertEqual("gpu", policy["device"])
        self.assertLess(policy["decoded_mib"], policy["gpu_cache_budget_mib"])

    def test_cpu_cache_flag_is_added_once_without_changing_resolution(self):
        args = gpu_lane.with_image_cache_policy(
            ["--pipeline.model.sh-degree", "0"], {"device": "cpu"})
        args = gpu_lane.with_image_cache_policy(args, {"device": "cpu"})

        self.assertEqual(1, args.count("--pipeline.datamanager.cache-images"))
        self.assertEqual("cpu", args[args.index("--pipeline.datamanager.cache-images") + 1])
        self.assertNotIn("--downscale-factor", args)

    def test_worker_applies_and_records_measured_cuda_cache_policy(self):
        source = inspect.getsource(worker.run_splat_cuda)

        self.assertIn("gpu_lane.image_cache_policy", source)
        self.assertIn("gpu_lane.with_image_cache_policy", source)
        self.assertIn('"cuda_image_cache"', source)
        self.assertIn('"image_cache"', source)
        self.assertIn('"image_cache_device"', inspect.getsource(worker.run_splat))
        self.assertIn("image_cache_device", worker._SPLAT_RUN_FIELDS)
        self.assertIn("resumed_from_step", worker._SPLAT_RUN_FIELDS)

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
