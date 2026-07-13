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

    def test_flight_uses_detailed_mesh_as_visual_layer_only(self):
        scene = (ROOT / "web" / "flightverse" / "scene.js").read_text()
        self.assertIn("export async function attachVisualMesh", scene)
        self.assertIn("mesh_mtl_low", scene)
        self.assertIn("attachVisualMesh(man, scene", self.source)
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
        self.assertIn("fireBtn.setPointerCapture", self.source)
        self.assertIn("e.preventDefault()", self.source)
        self.assertIn("'pointercancel'", self.source)

    def test_image_editor_is_a_compact_live_inspector_on_touch(self):
        self.assertIn("max-height:min(46dvh,430px)", self.styles)
        self.assertIn(".vl-grade-drag", self.styles)
        self.assertNotIn("bottom:calc(12px + env(safe-area-inset-bottom)); width:auto; max-height:none", self.styles)


if __name__ == "__main__":
    unittest.main()
