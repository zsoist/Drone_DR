import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import browser_matrix


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
            'id="vl-armamento"',
            'id="vl-dock-close"',
            'id="vl-combat-close"',
            'role="dialog"',
        ):
            self.assertIn(contract, self.source)
        self.assertNotIn('id="vl-combat-fab"', self.source)
        dock = self.source[
            self.source.index('id="vl-dock"'):
            self.source.index('<div class="vl-corner br">')
        ]
        self.assertIn('id="vl-rig"', dock)
        self.assertIn('id="vl-armamento"', dock)

    def test_combat_controls_are_grouped_and_status_is_separate(self):
        self.assertIn('class="vl-combat" id="vl-combat"', self.source)
        self.assertIn('class="vl-flight-status"', self.source)
        self.assertIn("overlayCoordinator = createOverlayCoordinator", self.source)
        self.assertIn("'vl-mobile-sheet-open'", self.source)

    def test_touch_layout_uses_grid_sheets_and_minimum_targets(self):
        self.assertIn(".vl-dock-head", self.styles)
        self.assertIn(".vl-combat.open", self.styles)
        self.assertIn("grid-template-columns:repeat(2,minmax(0,1fr))", self.styles)
        self.assertIn("min-height:44px", self.styles)
        self.assertNotIn("dock horizontal scrolleable", self.styles)

    def test_mobile_panels_are_mutually_exclusive(self):
        self.assertIn("createOverlayCoordinator", self.source)
        self.assertEqual(self.source.count("createOverlayCoordinator({"), 1)
        self.assertIn('id="vl-overlay-scrim"', self.source)
        for name in ("menu", "combat", "image", "guide", "invasion", "difficulty", "result"):
            self.assertIn(f"{name}:", self.source)
        self.assertIn("overlayCoordinator.toggle('menu')", self.source)
        self.assertIn("overlayCoordinator.toggle('combat')", self.source)

    def test_touch_controller_is_lifecycle_owned_by_the_flight_scene(self):
        touch = (ROOT / "web" / "flightverse" / "touch.js").read_text()
        for contract in (
            "sample()",
            "setEnabled(active)",
            "dispose()",
            "pointercancel",
            "lostpointercapture",
            "getBoundingClientRect()",
        ):
            self.assertIn(contract, touch)
        self.assertIn("sticks?.dispose()", self.source)

    def test_mobile_sheets_share_one_safe_area_scrim(self):
        for contract in (
            ".vl-overlay-scrim",
            ".vl-overlay-scrim.open",
            "env(safe-area-inset-bottom)",
            "border-radius:22px 22px 0 0",
        ):
            self.assertIn(contract, self.styles)

    def test_overlay_ownership_cancels_and_gates_every_flight_input(self):
        for contract in (
            "releaseFiring()",
            "input.setEnabled(!active)",
            "const globalHotkeyAllowed = event =>",
            "if (!globalHotkeyAllowed(e)) return",
            "overlayCoordinator?.active()",
            "lastFlightInput",
        ):
            self.assertIn(contract, self.source)
        self.assertEqual(self.source.count("addEventListener('keydown'"), 1)
        auto_input = self.source.index("if (auto && simT < auto.until)")
        overlay_neutral = self.source.index("if (overlayCoordinator?.active())", auto_input)
        sampled_input = self.source.index("lastFlightInput = { ...inp }", overlay_neutral)
        drone_step = self.source.index("drone.step(dt, inp, modeKey)", sampled_input)
        self.assertLess(auto_input, overlay_neutral)
        self.assertLess(overlay_neutral, sampled_input)
        self.assertLess(sampled_input, drone_step)
        self.assertTrue(callable(browser_matrix.run_mobile_base_acceptance))
        self.assertEqual(
            browser_matrix.base_acceptance_failures({
                "focusTrap": {},
                "inert": {},
                "hotkeys": {},
                "scrim": {},
                "sheets": {},
                "chaseHud": {},
            }),
            [
                "focus trap incompleto",
                "canvas/combate no quedaron inert",
                "held MG no fue cancelado al abrir Menú",
                "input de vuelo no quedó neutral bajo overlay",
                "hotkeys no se bloquearon/restauraron",
                "Fire no aceptó repress tras cerrar Menú",
                "scrim/cierre exterior inválido",
                "acciones/tap targets de sheets incompletos",
                "overlays no fueron exclusivos",
                "ciclo de cámara móvil inválido",
            ],
        )

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

    def test_camera_cycle_moves_into_the_single_mobile_menu(self):
        for contract in (
            'id="vl-rig"',
            'aria-label="Cambiar cámara"',
            "$('#vl-rig').addEventListener('click', cycleRig)",
        ):
            self.assertIn(contract, self.source)
        self.assertNotIn('id="vl-fpv-camera"', self.source)

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

    def test_browser_matrix_covers_phone_and_ipad_in_both_orientations(self):
        matrix = (ROOT / "pipeline" / "browser_matrix.py").read_text()
        for profile in ("mobile_portrait", "mobile_landscape", "ipad_portrait", "ipad_landscape"):
            self.assertIn(f'"{profile}"', matrix)
        for contract in ("safeArea", "sheetScrim", "orientation", "touchCommandHud"):
            self.assertIn(contract, matrix)

    def test_cdp_touch_helpers_dispatch_the_complete_active_touch_set(self):
        class FakeCdp:
            def __init__(self):
                self.calls = []

            def send(self, method, params):
                self.calls.append((method, params))

        cdp = FakeCdp()
        points = [
            browser_matrix.touch_point(11, 24.5, 81.25),
            browser_matrix.touch_point(12, 340, 690),
            browser_matrix.touch_point(13, 300, 512),
        ]
        browser_matrix.dispatch_touches(cdp, "touchMove", points)

        self.assertEqual(
            cdp.calls,
            [(
                "Input.dispatchTouchEvent",
                {"type": "touchMove", "touchPoints": points},
            )],
        )
        self.assertEqual(
            points[0],
            {
                "id": 11,
                "x": 24.5,
                "y": 81.25,
                "radiusX": 8,
                "radiusY": 8,
                "force": 1,
            },
        )
        self.assertEqual([point["id"] for point in points], [11, 12, 13])

    def test_rotation_metrics_swap_orientation_and_can_restore_the_exact_profile(self):
        portrait = browser_matrix.device_metrics_for("mobile_portrait")
        rotated = browser_matrix.device_metrics_for("mobile_portrait", rotated=True)

        self.assertEqual(
            (portrait["width"], portrait["height"], portrait["screenOrientation"]),
            (390, 844, {"type": "portraitPrimary", "angle": 0}),
        )
        self.assertEqual(
            (rotated["width"], rotated["height"], rotated["screenOrientation"]),
            (844, 390, {"type": "landscapePrimary", "angle": 90}),
        )
        self.assertEqual(
            browser_matrix.device_metrics_for("mobile_portrait"),
            portrait,
            "reapplying the original profile must be an exact restoration",
        )

    def test_partial_touch_release_dispatches_only_the_lifted_contact(self):
        class FakeCdp:
            def __init__(self):
                self.calls = []

            def send(self, method, params):
                self.calls.append((method, params))

        cdp = FakeCdp()
        fire = browser_matrix.touch_point(13, 300, 512)
        browser_matrix.release_touches(cdp, [fire])

        self.assertEqual(
            cdp.calls,
            [(
                "Input.dispatchTouchEvent",
                {"type": "touchEnd", "touchPoints": [fire]},
            )],
        )

    def test_task3_validators_reject_missing_runtime_acceptance(self):
        valid_base = {
            "focusTrap": {"forward": True, "backward": True, "reentry": True},
            "inert": {"canvas": True, "combat": True},
            "heldMgCancelled": True,
            "neutralWhileOpen": True,
            "hotkeys": {"blocked": True, "restored": True},
            "repressWorked": True,
            "scrim": {"visible": True, "outsideDismissed": True},
            "sheets": {"actionsComplete": True, "targetsLarge": True},
            "exclusiveOverlays": True,
            "cameraCycle": True,
            "chaseHud": {"collisions": [], "outOfBounds": []},
        }
        self.assertEqual(browser_matrix.base_acceptance_failures(valid_base), [])

        broken = {**valid_base, "heldMgCancelled": False}
        self.assertEqual(
            browser_matrix.base_acceptance_failures(broken),
            ["held MG no fue cancelado al abrir Menú"],
        )

    def test_safe_area_validator_requires_resolved_nonzero_insets(self):
        valid = {
            "supported": True,
            "resolved": {"top": 17, "right": 13, "bottom": 23, "left": 11},
            "violations": [],
        }
        self.assertEqual(browser_matrix.safe_area_failures(valid), [])
        self.assertEqual(
            browser_matrix.safe_area_failures({**valid, "resolved": {}}),
            ["safe-area env no resolvió insets no-cero"],
        )

    def test_flightverse_result_summary_has_no_legacy_overlay_lookup(self):
        summary = browser_matrix.format_flightverse_result({
            "surface": "volar",
            "viewport": "mobile_portrait",
            "fps": 60,
            "touchCommandHud": {"realTouch": True},
        })
        self.assertEqual(
            summary,
            "volar/mobile_portrait: ok · 60fps · touch=real",
        )

    def test_command_hud_screenshot_names_cover_all_touch_states(self):
        for viewport in (
            "mobile_portrait",
            "mobile_landscape",
            "ipad_portrait",
            "ipad_landscape",
        ):
            for state in ("closed", "weapons", "menu"):
                path = browser_matrix.command_hud_screenshot_path(viewport, state)
                self.assertEqual(
                    path.name,
                    f"matrix-volar-{viewport}-{state}.png",
                )

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
        self.assertIn("createFirePointerBindings", self.source)
        self.assertIn("const firePointers = createFirePointerBindings({", self.source)
        self.assertIn("elements: [fireBtn, triggerBtn]", self.source)
        self.assertIn("firePointers.cancel('overlay')", self.source)
        self.assertIn("firePointers.dispose()", self.source)
        self.assertNotIn(
            "addEventListener('pointerup', e => releaseFiring('pointer', e))",
            self.source,
        )

    def test_compact_command_hud_replaces_the_live_weapon_carousel(self):
        for contract in (
            'id="vl-command-hud"',
            'id="vl-weapon-toggle"',
            'id="vl-weapon-picker"',
            'id="vl-weapon-code"',
            'id="vl-weapon-status"',
            'id="vl-trigger"',
            'role="listbox"',
            'role="option"',
            "createWeaponPicker",
        ):
            self.assertIn(contract, self.source)
        self.assertNotIn('id="vl-weapon-carousel"', self.source)

    def test_touch_command_geometry_and_gesture_hardening_are_mobile_only(self):
        coarse = self.styles[self.styles.index("@media (pointer:coarse)"):]
        for contract in (
            "-webkit-tap-highlight-color:transparent",
            "-webkit-touch-callout:none",
            "-webkit-user-select:none",
            "user-select:none",
            "overscroll-behavior:none",
            ".vl-command-hud",
            "width:72px",
            "height:72px",
            "width:56px",
            "height:56px",
            "min-height:48px",
            "touch-action:none",
        ):
            self.assertIn(contract, coarse)
        before_coarse = self.styles[:self.styles.index("@media (pointer:coarse)")]
        self.assertNotIn("-webkit-tap-highlight-color:transparent", before_coarse)

    def test_trigger_exposes_hold_lock_and_release_telemetry(self):
        for contract in (
            "locked: false",
            "beginFiring",
            "releaseFiring",
            "trigger: { ...triggerState }",
            "LIBERA PARA REARMAR",
        ):
            self.assertIn(contract, self.source)

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
