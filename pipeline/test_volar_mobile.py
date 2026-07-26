import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class VolarMobileHudContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "web" / "volar.js").read_text()
        cls.styles = (ROOT / "web" / "style.css").read_text()

    def test_mobile_launchers_are_named_and_control_real_sheets(self):
        for contract in (
            'id="vl-fab"',
            'aria-controls="vl-dock"',
            'aria-expanded="false"',
            'id="vl-combat-fab"',
            'aria-controls="vl-combat"',
            'id="vl-dock-close"',
            'id="vl-combat-close"',
            'role="dialog"',
        ):
            self.assertIn(contract, self.source)

    def test_combat_controls_are_grouped_and_status_is_separate(self):
        self.assertIn('class="vl-combat" id="vl-combat"', self.source)
        self.assertIn('class="vl-flight-status"', self.source)
        self.assertIn("const setMobileSheet", self.source)
        self.assertIn("'vl-mobile-sheet-open'", self.source)

    def test_touch_layout_uses_grid_sheets_and_minimum_targets(self):
        self.assertIn(".vl-dock-head", self.styles)
        self.assertIn(".vl-combat.open", self.styles)
        self.assertIn("grid-template-columns:repeat(2,minmax(0,1fr))", self.styles)
        self.assertIn("min-height:44px", self.styles)
        self.assertNotIn("dock horizontal scrolleable", self.styles)

    def test_mobile_panels_are_mutually_exclusive(self):
        self.assertIn("const closeFlightOverlays", self.source)
        self.assertIn("closeFlightOverlays(name)", self.source)
        self.assertIn("setMobileSheet('', false)", self.source)

    def test_legacy_touch_dom_cannot_restore_overlapping_combat_controls(self):
        self.assertIn(".vl-corner.br > .vl-weps", self.styles)
        self.assertIn(".vl-corner.br > .vl-fire", self.styles)
        self.assertIn("display:none !important", self.styles)

    def test_bfcache_restore_checks_the_current_fingerprinted_build(self):
        for contract in ("import.meta.url", "refreshStaleBuild", "pageshow",
                         "event.persisted", "cache: 'no-store'", "location.reload()"):
            self.assertIn(contract, self.source)

    def test_fpv_has_an_explicit_non_duplicated_hud_state(self):
        self.assertIn("classList.toggle('fpv-active'", self.source)
        self.assertIn(".vl-hud.fpv-active .vl-corner.tl", self.styles)
        self.assertIn(".vl-hud.fpv-active .vl-corner.tr", self.styles)
        self.assertIn(".vl-hud.fpv-active .vl-flight-status", self.styles)

    def test_sound_control_arms_on_pointerdown_without_immediate_remute(self):
        self.assertIn("#vl-sound').addEventListener('pointerdown'", self.source)
        audio = (ROOT / "web" / "flightverse" / "audio.js").read_text()
        self.assertIn("ctx.resume()", audio)
        self.assertIn("if (!ctx)", audio)

    def test_mobile_auto_quality_can_load_the_full_ortho(self):
        self.assertIn("const preferFullOrtho", self.source)
        self.assertIn("man.assets.ortho_full", self.source)

    def test_auto_quality_uses_frame_time_governor_and_scalar_renderer_metrics(self):
        runtime = (ROOT / "web" / "flightverse" / "runtime.js").read_text()
        for contract in (
            "createRenderQualityGovernor",
            "qualityGovernor.sample(frameMs",
            "qualityGovernor.reset()",
            "renderer.info.render.calls",
            "renderer.info.render.triangles",
            "report.render",
        ):
            self.assertIn(contract, self.source)
        self.assertIn("render(acc / STEP, dt * 1000)", runtime)
        self.assertNotIn("setInterval(() => {\n    if (calidad !== 'auto')", self.source)

    def test_loop_visibility_callbacks_reset_quality_without_physics_catchup(self):
        runtime = (ROOT / "web" / "flightverse" / "runtime.js").read_text()
        self.assertIn("export function createLoop({ update, render, onPause, onResume })", runtime)
        self.assertIn("onPause?.()", runtime)
        self.assertIn("onResume?.()", runtime)
        self.assertIn("last = 0", runtime)
        self.assertIn("pauses:", self.source)
        self.assertIn("resumes:", self.source)

    def test_browser_matrix_gates_real_render_budget_counters(self):
        matrix = (ROOT / "pipeline" / "browser_matrix.py").read_text()
        for contract in (
            "render: r.render",
            '"p95Ms"',
            '"calls"',
            '"triangles"',
            "telemetría de render inválida",
        ):
            self.assertIn(contract, matrix)

    def test_flight_uses_detailed_mesh_as_visual_layer_only(self):
        scene = (ROOT / "web" / "flightverse" / "scene.js").read_text()
        self.assertIn("export async function attachVisualMesh", scene)
        self.assertIn("mesh_mtl_low", scene)
        self.assertIn("attachVisualMesh(man, worldGroup", self.source)
        self.assertIn("terrain.heightAt", self.source)

    def test_mobile_menu_actions_do_not_auto_close_the_sheet(self):
        self.assertNotIn("b.id !== 'vl-dock-close'", self.source)
        self.assertIn("$('#vl-dock-close').addEventListener", self.source)

    def test_touch_panels_use_bounded_persistent_dragging(self):
        panels = (ROOT / "web" / "flightverse" / "panels.js").read_text()
        self.assertIn("export function makeDraggablePanel", panels)
        for contract in ("setPointerCapture", "visualViewport", "localStorage", "clamp"):
            self.assertIn(contract, panels)
        self.assertGreaterEqual(self.source.count("makeDraggablePanel("), 3)

    def test_fire_control_owns_pointer_gesture_and_is_clearly_named(self):
        self.assertIn('<strong>DISPARAR</strong>', self.source)
        self.assertIn("const triggerBtn = $('#vl-trigger')", self.source)
        self.assertIn("for (const button of [fireBtn, triggerBtn])", self.source)
        self.assertIn("button.setPointerCapture(e.pointerId)", self.source)
        self.assertIn("e.preventDefault()", self.source)
        self.assertIn("'pointercancel'", self.source)

    def test_image_editor_is_a_compact_live_inspector_on_touch(self):
        for contract in (
            'id="gr-expand"',
            'aria-expanded="false"',
            'class="vl-grade-body"',
            "matchMedia('(pointer:coarse)').matches",
            "gradePanel.classList.add('compact')",
        ):
            self.assertIn(contract, self.source)
        self.assertIn("max-height:min(44dvh,410px)", self.styles)
        self.assertIn(".vl-grade.compact .vl-grade-body", self.styles)
        self.assertIn("overflow-y:auto", self.styles)
        self.assertIn("min-height:44px", self.styles)
        self.assertIn(".vl-grade-drag", self.styles)
        self.assertIn("const gradePanel = $('#vl-grade')", self.source)
        self.assertNotIn("const grade = $('#vl-grade')", self.source)
        self.assertNotIn("bottom:calc(12px + env(safe-area-inset-bottom)); width:auto; max-height:none", self.styles)

    def test_world_representation_is_exclusive_and_respects_preference(self):
        self.assertIn("const representation =", self.source)
        self.assertIn("preferredRenderer", self.source)
        self.assertIn("active: 'terrain'", self.source)
        self.assertIn("visualMesh.object.visible = active === 'mesh'", self.source)
        self.assertIn("splat.object.visible = active === 'splat'", self.source)
        self.assertNotIn("terrain.mesh.visible = visualMesh ? false", self.source)
        self.assertIn("visibleStructuralLayers", self.source)

    def test_mesh_mode_uses_grid_coverage_fallback_instead_of_a_circle(self):
        scene = (ROOT / "web" / "flightverse" / "scene.js").read_text()
        self.assertIn("man.assets.mesh_coverage", scene)
        self.assertIn("uMeshOn", scene)
        self.assertIn("uMeshCoverage", scene)
        self.assertIn("terrain.meshMask", self.source)
        self.assertNotIn("footprint: { x: c.x, z: c.z, r:", self.source)

    def test_terrain_frontier_is_atmospheric_and_never_discards_more_geometry(self):
        scene = (ROOT / "web" / "flightverse" / "scene.js").read_text()
        for contract in (
            "uFrontierOn",
            "uFrontierWidth",
            "uFrontierColor",
            "float fvEdge",
            "smoothstep(0.0, uFrontierWidth",
            "diffuseColor.rgb = mix(uFrontierColor",
            "frontier:",
        ):
            self.assertIn(contract, scene)
        self.assertIn("Q.get('diagnostic') !== '1'", self.source)
        self.assertNotIn("if (fvEdge", scene)

    def test_scene_generation_disposes_stale_async_layers(self):
        scene = (ROOT / "web" / "flightverse" / "scene.js").read_text()
        self.assertIn("export function createSceneGeneration", scene)
        self.assertIn("generation.isCurrent()", self.source)
        self.assertIn("disposedStaleLoads", self.source)
        self.assertIn("generation.invalidate()", self.source)
        self.assertIn("'pagehide'", self.source)


if __name__ == "__main__":
    unittest.main()
