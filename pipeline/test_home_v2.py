import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_commonjs(relative_path, function_name, args):
    script = """
const mod = require(process.argv[1]);
const name = process.argv[2];
const args = JSON.parse(process.argv[3]);
Promise.resolve(mod[name](...args)).then(value => process.stdout.write(JSON.stringify(value)));
"""
    result = subprocess.run(
        ["node", "-e", script, str(ROOT / relative_path), function_name, json.dumps(args)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


class HomeDataTests(unittest.TestCase):
    def sample_flight(self):
        return {
            "clip_id": "DJI_SAMPLE",
            "date": "2026-07-15",
            "time": "10:30:00",
            "duration_s": 120,
            "has_proxy": True,
            "stats": {"distance_m": 850},
        }

    def test_partial_system_failure_keeps_all_module_cards(self):
        vm = run_commonjs(
            "web/home-data.js",
            "buildHomeViewModel",
            [[self.sample_flight()], {}, [], "2026-07-15T10:00:00-05:00"],
        )
        self.assertEqual(7, len(vm["cards"]))
        self.assertEqual("Sin datos", vm["telemetry"][3]["value"])

    def test_empty_flights_do_not_invent_zero_distance(self):
        vm = run_commonjs(
            "web/home-data.js",
            "buildHomeViewModel",
            [[], {"storage": {"raw": 1024}}, [], "2026-07-15T10:00:00-05:00"],
        )
        self.assertEqual("Sin datos", vm["telemetry"][1]["value"])
        self.assertEqual("Sin datos", vm["telemetry"][2]["value"])
        self.assertIsNone(vm["latest"])

    def test_jobs_403_is_a_quiet_public_state(self):
        data = run_commonjs("web/home-data.js", "classifyJobsResponse", [403, None])
        self.assertEqual({"state": "public", "jobs": []}, data)

    def test_manifest_url_uses_explicit_data_root(self):
        data = run_commonjs("web/home-data.js", "manifestUrl", ["/vault/data/"])
        self.assertEqual("/vault/data/manifest/system.json", data)

    def test_latest_flight_uses_date_and_time_not_input_order(self):
        older = self.sample_flight()
        newer = {**older, "clip_id": "DJI_NEW", "date": "2026-07-16", "time": "08:00:00"}
        vm = run_commonjs(
            "web/home-data.js",
            "buildHomeViewModel",
            [[newer, older], {}, [], "2026-07-16T10:00:00-05:00"],
        )
        self.assertEqual("DJI_NEW", vm["latest"]["clip_id"])


class HomeMarkupTests(unittest.TestCase):
    def test_home_loads_data_before_renderer(self):
        html = (ROOT / "web/home.html").read_text()
        self.assertLess(html.index("home-data.js"), html.index("home.js"))

    def test_renderer_exposes_seven_full_card_links(self):
        source = (ROOT / "web/home.js").read_text()
        self.assertIn('class="hv2-card', source)
        self.assertIn('class="hv2-go"', source)
        self.assertIn("HomeData.buildHomeViewModel", source)

    def test_home_v2_has_keyboard_focus_and_responsive_mobile_rules(self):
        css = (ROOT / "web/style.css").read_text()
        self.assertIn(".hv2-card:focus-visible", css)
        self.assertIn("@media (max-width: 680px)", css)
        self.assertIn(".hv2-telemetry", css)

    def test_void_effect_is_bounded_by_viewport_and_motion_preference(self):
        self.assertEqual(0, run_commonjs("web/home-effects.js", "particleBudget", [1440, True]))
        self.assertEqual(100, run_commonjs("web/home-effects.js", "particleBudget", [390, False]))
        self.assertEqual(160, run_commonjs("web/home-effects.js", "particleBudget", [820, False]))
        self.assertEqual(260, run_commonjs("web/home-effects.js", "particleBudget", [1440, False]))
        self.assertEqual(420, run_commonjs("web/home-effects.js", "particleBudget", [2200, False]))
        self.assertLessEqual(run_commonjs("web/home-effects.js", "navigationDelay", [False]), 620)

    def test_drone_module_uses_real_model_and_visibility_guards(self):
        source = (ROOT / "web/home-drone.js").read_text()
        self.assertIn("assets/drone.glb", source)
        self.assertIn("IntersectionObserver", source)
        self.assertIn("visibilitychange", source)
        self.assertIn("GLTFLoader", source)


if __name__ == "__main__":
    unittest.main()
