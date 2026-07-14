import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SplatFrontierUiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tresd = (ROOT / "web" / "tresd.js").read_text()
        cls.shell = (ROOT / "web" / "shell.js").read_text()

    def test_ui_loads_canonical_profiles_instead_of_a_three_tier_copy(self):
        self.assertIn("/api/splat_profiles", self.tresd)
        self.assertIn("data-splat-profile", self.tresd)
        for key in ("fast", "medium", "cinematic", "ultra", "ultra20",
                    "frontier", "grandmaster"):
            self.assertIn(key, self.tresd)

    def test_ui_exposes_strict_cuda_resolution_and_truthful_eta_sources(self):
        for token in ("data-splat-resolution", "projected_from_measured",
                      "Primera medición", "CUDA estricto", "Sin fallback local"):
            self.assertIn(token, self.tresd)

    def test_stale_silent_fallback_copy_is_gone(self):
        self.assertNotIn("worker en curso", self.tresd)
        self.assertNotIn("cae solo a Metal/MPS", self.tresd)
        self.assertNotIn("si el nodo falla, cada fase cae sola a local", self.tresd)

    def test_job_cards_show_requested_and_effective_resolution(self):
        self.assertIn("requested_resolution", self.shell)
        self.assertIn("effective_resolution", self.shell)
        self.assertIn("attempts", self.shell)


if __name__ == "__main__":
    unittest.main()
