import unittest
import json
import re
import subprocess
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import worker


class TresdInitializationTests(unittest.TestCase):
    def test_scene_improvement_card_resolves_the_active_reconstruction_model(self):
        root = Path(__file__).resolve().parent.parent
        script = """
const policy = require('./web/scene-improve-policy.js');
const requested = {clip_id: 'DJI_BASE', qa: {cameras_reconstructed: 221}};
const active = {clip_id: 'recon_full', qa: {cameras_reconstructed: 428}};
const scene = {active_version: 'recon_full', versions: [
  {id: 'recon_full', sources: ['DJI_BASE', 'DJI_NEW']},
]};
console.log(JSON.stringify(policy.resolveActiveModel([requested, active], requested, scene)));
"""
        result = subprocess.run(
            ["node", "-e", script], cwd=root, text=True,
            capture_output=True, check=False,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(428, json.loads(result.stdout)["qa"]["cameras_reconstructed"])

    def test_scene_improvement_workspace_is_dedicated_semantic_and_budget_visible(self):
        root = Path(__file__).resolve().parent.parent
        html = (root / "web" / "scene-improve.html").read_text()
        source = (root / "web" / "scene-improve.js").read_text()
        tresd = (root / "web" / "tresd.js").read_text()

        self.assertIn('<main id="scene-improve-root"', html)
        self.assertIn('aria-live="polite"', html)
        self.assertIn('scene-improve-policy.js', html)
        self.assertIn('class="si-review"', source)
        self.assertIn('<details class="si-advanced"', source)
        self.assertIn('Versión actual protegida', source)
        self.assertIn('max_duration_s', source)
        self.assertIn('<option value="grandmaster">Grandmaster 40K</option>', source)
        self.assertIn('<option value="extra">Extra 3D · edificio</option>', source)
        self.assertNotIn('option value="media"', source)
        self.assertNotIn('option value="rapida"', source)
        self.assertIn('/api/scene_create', source)
        self.assertIn('/api/scene_improve', source)
        self.assertIn('scene-improve.html?id=', tresd)

    def test_building_presets_request_a_true_volumetric_mesh(self):
        for preset in ("extra", "ultra"):
            args = worker.PRESETS[preset]["args"]
            self.assertIn("--use-3dmesh", args)
            self.assertNotIn("--skip-3dmodel", args)

    def test_splat_controls_exist_before_first_combined_render(self):
        source = (Path(__file__).resolve().parent.parent / "web" / "tresd.js").read_text()
        self.assertLess(source.index("const splatChk"), source.index("renderCombined();"))

    def test_operator_quality_estimates_match_measured_presets(self):
        source = (Path(__file__).resolve().parent.parent / "web" / "tresd.js").read_text()
        self.assertEqual("~15 min-4 h", worker.PRESETS["alta"]["eta"])
        self.assertIn("t: '~15 min-4 h'", source)
        self.assertIn("d: 'Malla 600k · octree 11 · 2 cm/px'", source)
        self.assertIn("/api/splat_profiles", source)
        self.assertIn("Medium 2K", source)
        self.assertIn("~4-12 min", source)
        self.assertIn("projected_from_measured", source)

    def test_jobs_console_has_summary_search_and_type_filters(self):
        source = (Path(__file__).resolve().parent.parent / "web" / "tresd.js").read_text()
        self.assertIn('id="job-summary"', source)
        self.assertIn('id="job-search"', source)
        self.assertIn('data-job-kind="3d"', source)
        self.assertIn('data-job-kind="splat"', source)
        self.assertIn('data-job-kind="ingest"', source)
        self.assertIn("new URLSearchParams(location.search).get('tab')", source)

    def test_jobs_rows_expose_truth_and_accessible_progress(self):
        source = (Path(__file__).resolve().parent.parent / "web" / "shell.js").read_text()
        self.assertIn("requested_preset", source)
        self.assertIn("effective_preset", source)
        self.assertIn('role="progressbar"', source)
        self.assertIn('aria-valuenow="${pct}"', source)
        self.assertNotIn("min restantes", source)

    def test_full_log_mode_has_operational_controls(self):
        source = (Path(__file__).resolve().parent.parent / "web" / "shell.js").read_text()
        for contract in ("/api/job_log", "job-log-drawer", "data-log-search",
                         "data-log-wrap", "data-log-pause", "data-log-copy",
                         "data-log-download"):
            self.assertIn(contract, source)

    def test_scene_can_be_improved_without_overwriting_active_version(self):
        source = (Path(__file__).resolve().parent.parent / "web" / "tresd.js").read_text()
        self.assertIn("Mejorar esta escena", source)
        self.assertIn("/api/scene_create", source)
        self.assertIn("/api/scene_improve", source)
        self.assertIn("/api/scene_promote", source)
        self.assertIn("Sitio estable", source)
        self.assertIn("currentChoices.concat", source)
        self.assertIn("Splat solicitado", source)
        self.assertIn("dense_quality_requested", source)

    def test_scene_similarity_is_visible_and_cross_site_sources_are_disabled(self):
        root = Path(__file__).resolve().parent.parent
        source = (root / "web" / "tresd.js").read_text()
        css = (root / "web" / "style.css").read_text()
        self.assertIn("const sameSite =", source)
        self.assertIn("same-site", source)
        self.assertIn("cross-site", source)
        self.assertIn("otro sitio", source)
        self.assertIn("input.disabled", source)
        self.assertIn(".scene-source.cross-site", css)

    def test_deepseek_reports_use_authenticated_reader_not_private_static_path(self):
        web = (Path(__file__).resolve().parent.parent / "web" / "system.js").read_text()
        server = (Path(__file__).resolve().parent / "aerobrain_server.py").read_text()
        self.assertIn("/api/error_report_content", web)
        self.assertIn("/api/error_report_content", server)
        self.assertNotIn('href="data/ops/reports/', web)
        self.assertIn('id="pf-report-body"', web)

    def test_system_feed_uses_authoritative_job_times_and_never_future_queue_time(self):
        web = (Path(__file__).resolve().parent.parent / "web" / "system.js").read_text()
        match = re.search(
            r"function jobRelativeTime\(job, now\)\s*\{.*?\n\}", web, re.DOTALL)
        self.assertIsNotNone(match, "system.js must expose a testable job time formatter")
        jobs = [
            {"status": "queued", "started": 2000},
            {"status": "running", "started": 940},
            {"status": "done", "started": 100, "finished": 880},
        ]
        script = (match.group(0) + "\nconsole.log(JSON.stringify(" +
                  json.dumps(jobs) + ".map(j => jobRelativeTime(j, 1000000))));\n")
        result = subprocess.run(["node", "-e", script], capture_output=True,
                                text=True, check=True)
        self.assertEqual(["en cola", "hace 1 min", "hace 2 min"],
                         json.loads(result.stdout))
        self.assertNotIn("split('-').pop()", web)
        self.assertIn("orderJobsForDisplay(jobs).slice(0, 9)", web)

    def test_modern_sog_viewer_asset_is_generated_and_visible_everywhere(self):
        root = Path(__file__).resolve().parent.parent
        tresd = (root / "web" / "tresd.js").read_text()
        share = (root / "web" / "share.js").read_text()
        self.assertIn("sog|spz|ksplat|splat|ply", tresd)
        self.assertIn("sog|spz|ksplat|splat|ply", share)
        self.assertIn("export_viewer_sog", (root / "pipeline" / "worker.py").read_text())
        self.assertTrue(worker.SPLAT_TRANSFORM.is_file())

    def test_project_uses_one_semantic_viewer_for_cloud_mesh_and_gaussian(self):
        root = Path(__file__).resolve().parent.parent
        source = (root / "web" / "tresd.js").read_text()

        self.assertIn("unified-viewer-state.js", source)
        self.assertEqual(1, source.count('id="scene-viewer-box"'))
        self.assertIn('id="scene-viewer-tabs"', source)
        self.assertIn('role="tablist"', source)
        self.assertIn('data-viewer-mode="cloud"', source)
        self.assertIn('data-viewer-mode="mesh"', source)
        self.assertIn('data-viewer-mode="splat"', source)
        self.assertIn('id="viewer-load"', source)
        self.assertIn('data-no-collapse', source)
        self.assertNotIn('id="cloud-box"', source)
        self.assertNotIn('id="mesh-box"', source)
        self.assertNotIn('id="splat-box"', source)
        shell = (root / "web" / "shell.js").read_text()
        self.assertIn("ph.dataset.noCollapse", shell)

    def test_unified_viewer_has_responsive_and_accessible_visual_contract(self):
        css = (Path(__file__).resolve().parent.parent / "web" / "style.css").read_text()

        self.assertIn(".scene-viewer-box", css)
        self.assertIn("height: 64dvh", css)
        self.assertIn("min-height: 520px", css)
        self.assertIn(".scene-viewer-tabs button[aria-selected=\"true\"]", css)
        self.assertIn(".scene-viewer-tabs button:focus-visible", css)
        self.assertIn("overflow-x: auto", css)
        self.assertIn("min-height: 420px", css)

    def test_gaussian_uses_the_same_navigation_rail_and_gentle_zoom(self):
        source = (Path(__file__).resolve().parent.parent / "web" / "splatview.js").read_text()
        tresd = (Path(__file__).resolve().parent.parent / "web" / "tresd.js").read_text()

        self.assertIn("viewer-tools sv-nav", source)
        self.assertIn("dolly(0.72)", source)
        self.assertIn("dolly(1.38)", source)
        self.assertNotIn("dolly(0.08)", source)
        self.assertNotIn("dolly(0.25)", source)
        self.assertIn("dolly(0.72)", tresd)
        self.assertIn("dolly(1.38)", tresd)


if __name__ == "__main__":
    unittest.main()
