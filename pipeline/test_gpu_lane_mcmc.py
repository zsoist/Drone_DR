"""W2: MCMC (Gaussian-capped) trainer plumbing in gpu_lane. No GPU/SSH: argv and script text only."""
import ast
import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gpu_lane  # noqa: E402
import splat_presets  # noqa: E402

CAP = ["--pipeline.model.cap-max", "1000000"]


class TrainerSelectionTests(unittest.TestCase):
    def test_only_a_gaussian_cap_selects_mcmc(self):
        self.assertEqual("splatfacto", gpu_lane.trainer_for_args(None))
        self.assertEqual("splatfacto", gpu_lane.trainer_for_args([]))
        self.assertEqual("splatfacto", gpu_lane.trainer_for_args(
            ["--pipeline.model.sh-degree", "0", "--pipeline.model.stop-split-at", "15000"]))
        self.assertEqual("splatfacto-mcmc", gpu_lane.trainer_for_args(CAP))

    def test_default_script_is_unchanged_stock_ns_train(self):
        script = gpu_lane.train_script("w2-default", 15000, 1, "run-a", train_args=[
            "--pipeline.model.sh-degree", "0", "--pipeline.model.stop-split-at", "15000"])
        self.assertIn('yes | "$VIRTUAL_ENV/bin/ns-train" splatfacto ', script)
        self.assertNotIn("splatfacto_mcmc", script)
        self.assertNotIn("PYTHONPATH", script)

    def test_mcmc_script_uses_launcher_module_and_keeps_every_flag(self):
        args = [*CAP, "--pipeline.model.sh-degree", "0",
                "--pipeline.model.stop-split-at", "12500",
                "--pipeline.datamanager.cache-images", "cpu"]
        script = gpu_lane.train_script("w2-mcmc", 15000, 1, "run-b", train_args=args)
        self.assertIn(f"env PYTHONPATH={gpu_lane.REMOTE_LIB} ", script)
        self.assertIn("PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True", script)
        self.assertIn('-c "import splatfacto_mcmc; splatfacto_mcmc.main()" splatfacto-mcmc', script)
        self.assertNotIn("ns-train", script.split("set +e")[1])
        for token in ("--max-num-iterations 15000", "--pipeline.model.cap-max 1000000",
                      "--pipeline.model.stop-split-at 12500", "--downscale-factor 1",
                      "--pipeline.datamanager.cache-images cpu",
                      "colmap --colmap-path sparse/0 --images-path images"):
            self.assertIn(token, script)
        # the trainer's real exit status must still come from PIPESTATUS[1] (yes | trainer)
        self.assertIn("RC=${PIPESTATUS[1]}", script)


class InstallAndExportTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self._orig = gpu_lane._wsl
        gpu_lane._wsl = lambda script, timeout, label: self.calls.append(script) or ""

    def tearDown(self):
        gpu_lane._wsl = self._orig

    def test_mcmc_install_ships_the_module_default_does_not(self):
        gpu_lane.install_train_script("w2-a", 100, 1, "r", train_args=list(CAP))
        gpu_lane.install_train_script("w2-b", 100, 1, "r", train_args=[])
        with_module, without = self.calls
        self.assertIn(f"{gpu_lane.REMOTE_LIB}/splatfacto_mcmc.py", with_module)
        self.assertNotIn("splatfacto_mcmc.py", without)
        encoded = with_module.split("printf %s ")[1].split(" |")[0].strip("'")
        self.assertEqual(gpu_lane.MCMC_MODULE_FILE.read_bytes(), base64.b64decode(encoded))

    def test_finalize_exports_stock_config_first_then_mcmc_fallback(self):
        self.calls.clear()
        gpu_lane._wsl = lambda script, timeout, label: (
            self.calls.append(script) or "BYTES=10 PEAK_MIB=1 SAMPLES=1\n")
        gpu_lane.finalize_train("w2-x", "run-1")
        script = self.calls[0]
        stock = script.index("ns-export gaussian-splat")
        fallback = script.index("splatfacto_mcmc.export()")
        self.assertLess(stock, fallback)
        self.assertIn("/w2-x/splatfacto/run-1/config.yml", script)
        self.assertIn("/w2-x/splatfacto-mcmc/run-1/config.yml", script)


class ModuleSourceTests(unittest.TestCase):
    def test_module_parses_and_declares_the_gsplat_recipe(self):
        src = gpu_lane.MCMC_MODULE_FILE.read_text()
        ast.parse(src)
        for token in ("MCMCStrategy", "cap_max", "init_opacity: float = 0.5",
                      "init_scale: float = 0.1", "opacity_reg: float = 0.01",
                      "scale_reg: float = 0.01", "sh_degree: int = 0",
                      'METHOD_NAME = "splatfacto-mcmc"'):
            self.assertIn(token, src)


class MCMCPresetTests(unittest.TestCase):
    def test_mcmc1m_is_cuda_only_and_yields_the_capped_argv(self):
        spec = splat_presets.resolve_splat_spec({"preset": "mcmc1m"})
        self.assertEqual("mcmc1m", spec["key"])
        self.assertEqual(("cuda",), tuple(spec["supported_backends"]))
        args = spec["cuda"]["train_args"]
        self.assertEqual("splatfacto-mcmc", gpu_lane.trainer_for_args(args))
        script = gpu_lane.train_script("w2-p", spec["iters"], 1, "run-p", train_args=args)
        self.assertIn("--pipeline.model.cap-max 1000000", script)
        self.assertIn("--pipeline.model.sh-degree 0", script)
        self.assertIn("--max-num-iterations 15000", script)
        with self.assertRaises(ValueError):
            splat_presets.validate_splat_backend("mcmc1m", "metal")

    def test_mcmc3m_caps_at_three_million(self):
        args = splat_presets.resolve_splat_spec({"preset": "mcmc3m"})["cuda"]["train_args"]
        self.assertIn("--pipeline.model.cap-max 3000000",
                      gpu_lane.train_script("w2-q", 15000, 1, "run-q", train_args=args))

    def test_mcmc_preset_never_captures_legacy_iteration_requests(self):
        # 15000 must keep resolving to Ultra; MCMC is opt-in by name only
        self.assertEqual("ultra", splat_presets.resolve_splat_spec({"iters": 15000})["key"])
        self.assertEqual("ultra", splat_presets.resolve_splat_spec({"preset": "15k"})["key"])

    def test_existing_cuda_presets_stay_on_stock_splatfacto(self):
        for key, preset in splat_presets.SPLAT_PRESETS.items():
            if key.startswith("mcmc"):
                continue
            with self.subTest(key=key):
                self.assertEqual("splatfacto", gpu_lane.trainer_for_args(
                    preset.get("cuda", {}).get("train_args")))

    def test_mcmc_is_not_the_default_or_a_normalized_request_by_accident(self):
        self.assertEqual("frontier", splat_presets.resolve_splat_spec({"iters": 30000})["key"])
        self.assertEqual("mcmc1m", splat_presets.normalize_splat_request({"preset": "mcmc1m"})["preset"])


if __name__ == "__main__":
    unittest.main()
