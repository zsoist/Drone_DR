import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SplatFrontierUiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tresd = (ROOT / "web" / "tresd.js").read_text()
        cls.shell = (ROOT / "web" / "shell.js").read_text()
        cls.mundo = (ROOT / "web" / "mundo.js").read_text()
        cls.volar = (ROOT / "web" / "volar.js").read_text()
        cls.server = (ROOT / "pipeline" / "aerobrain_server.py").read_text()

    def test_ui_loads_canonical_profiles_instead_of_a_three_tier_copy(self):
        self.assertIn("/api/splat_profiles", self.tresd)
        self.assertIn("data-splat-profile", self.tresd)
        for key in ("fast", "medium", "cinematic", "ultra", "ultra20",
                    "frontier", "grandmaster"):
            self.assertIn(key, self.tresd)

    def test_ui_exposes_strict_cuda_resolution_and_truthful_eta_sources(self):
        for token in ("data-splat-resolution", "projected_from_measured",
                      "Primera medición", "CUDA estricto", "Sin fallback local",
                      "iterations_per_second", "iteration_time_ms"):
            self.assertIn(token, self.tresd)

    def test_stale_silent_fallback_copy_is_gone(self):
        self.assertNotIn("worker en curso", self.tresd)
        self.assertNotIn("cae solo a Metal/MPS", self.tresd)
        self.assertNotIn("si el nodo falla, cada fase cae sola a local", self.tresd)
        self.assertNotIn("puede continuar local en el Mac", self.tresd)
        self.assertIn("Alta/Extra/Ultra: CUDA estricto", self.tresd)

    def test_job_cards_show_requested_and_effective_resolution(self):
        self.assertIn("requested_resolution", self.shell)
        self.assertIn("effective_resolution", self.shell)
        self.assertIn("attempts", self.shell)

    def test_job_cards_show_live_iteration_rate_and_trainer_eta(self):
        for token in ("current_iteration", "target_iterations",
                      "iterations_per_second", "eta_remaining_s", "ETA TRAINER"):
            self.assertIn(token, self.shell)

    def test_job_cards_explain_image_cache_without_implying_downscale(self):
        for token in ("image_cache_device", "decoded_image_cache_mib",
                      "CACHE IMÁGENES", "VRAM libre para gaussianas"):
            self.assertIn(token, self.shell)

    def test_job_cards_show_checkpoint_recovery_and_resumed_step(self):
        for token in ("resume_available", "checkpoint_step", "resumed_from_step",
                      "CHECKPOINT SEGURO", "REANUDADO DESDE"):
            self.assertIn(token, self.shell)

    def test_cuda_only_copy_never_promises_a_mac_fallback(self):
        self.assertNotIn("lane hace fallback honesto a Metal local", self.tresd)
        self.assertIn("7K–40K permanece CUDA estricto", self.tresd)

    def test_scene_improvement_uses_the_same_seven_profile_contract(self):
        self.assertIn("renderSplatProfiles(splatProfiles, 'frontier')", self.tresd)
        self.assertIn("selectedSplatRequest(sceneSplatConfig)", self.tresd)
        self.assertNotIn("data-scene-splat-preset", self.tresd)

    def test_cuda_campaign_has_dry_run_and_all_or_nothing_confirm(self):
        self.assertIn("/api/splat_campaign", self.tresd)
        self.assertIn('u.path == "/api/splat_campaign"', self.server)
        self.assertIn("ready_to_enqueue", self.server)
        self.assertIn("campaña bloqueada por preflight; no se encoló ningún job", self.server)

    def test_mundo_uses_active_site_versions_and_five_verified_diameters(self):
        self.assertIn("stableSites", self.mundo)
        self.assertIn("site.active_version", self.mundo)
        for diameter in (100, 200, 400, 600, 1000):
            self.assertIn(str(diameter), self.mundo)
        self.assertIn("row.ready", self.mundo)

    def test_scene_ui_distinguishes_preflight_view_shortage(self):
        self.assertIn("insufficient_views: 'pocas vistas'", self.tresd)

    def test_volar_enforces_explicit_circle_or_square_coverage(self):
        self.assertIn("COVERAGE_REQUEST", self.volar)
        self.assertIn("COVERAGE_SHAPE", self.volar)
        self.assertIn("coverageProduct.area_m2", self.volar)
        self.assertIn("boundary_hits", self.volar)


if __name__ == "__main__":
    unittest.main()
