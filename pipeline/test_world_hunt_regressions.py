"""Static contracts for the 2026-09-30 World bug hunt (behaviour is verified in-browser by
the gates; these pin the fixes so they cannot silently regress)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOLAR = (ROOT / "web" / "volar.js").read_text()
CSS = (ROOT / "web" / "css" / "volar.css").read_text()
AUDIO = (ROOT / "web" / "flightverse" / "audio.js").read_text()


class WorldHuntRegressions(unittest.TestCase):
    def test_invasion_defeat_is_a_real_screen_not_a_toast(self):
        self.assertIn("showDefeat", VOLAR)
        loop = VOLAR[VOLAR.index("health.hp <= 0"):][:200]
        self.assertIn("showDefeat()", loop)
        self.assertNotIn("DERRIBADO · OLEADA", VOLAR)
        for act in ("inv-retry", "inv-config"):
            self.assertIn(f'data-act="{act}"', VOLAR)

    def test_game_pauses_while_any_overlay_is_open(self):
        self.assertIn("const gamePaused = !!overlayCoordinator?.active()", VOLAR)
        for call in ("invasion.update(dt", "weapons.update(dt", "reto.update(dt"):
            m = re.search(r"if \(!gamePaused\) " + re.escape(call), VOLAR)
            self.assertIsNotNone(m, f"{call} must be skipped while paused")

    def test_qa_url_invasion_starts_only_once(self):
        self.assertIn("!qaInvasionStarted", VOLAR)

    def test_phone_quality_is_capped_and_not_persisted_beyond_cap(self):
        self.assertIn("COARSE_PTR ? ['auto', 'hd', 'extra']", VOLAR)
        self.assertIn("CALIDAD_KEYS.includes(storedCalidad)", VOLAR)

    def test_hud_never_prints_nan_alignment(self):
        self.assertNotIn("(s.rmse * 100).toFixed(0)}cm", VOLAR)
        self.assertIn("splatAlignmentLabel(s)", VOLAR)

    def test_css_audit_fixes(self):
        n = re.sub(r"\s+", " ", CSS)
        self.assertIn('body[data-vl-overlay="image"] .vl-overlay-scrim', n)
        self.assertIn("env(safe-area-inset-bottom)", n[n.index("Auditoría móvil"):])
        self.assertIn("prefers-reduced-motion:reduce", n)
        self.assertIn(".vl-diff button span { white-space:nowrap }", n)

    def test_presentation_animation_uses_real_frame_time(self):
        self.assertIn("const rdt = Number.isFinite(frameMs)", VOLAR)
        self.assertIn("arrival.t += rdt;", VOLAR)
        self.assertNotIn("arrival.t += STEP", VOLAR)
        self.assertIn("Math.pow(0.02, rdt)", VOLAR)

    def test_arcade_degenerate_track_and_gate_rush_priority(self):
        self.assertIn("apilot.len > 1e-3", VOLAR)
        self.assertIn("trackUsable", VOLAR)
        self.assertIn("if (MODES[modeKey]?.autopilot) setMode('asistido');", VOLAR)

    def test_dios_gate_rush_has_its_own_record(self):
        self.assertIn("`${st.difficulty}.dios`", VOLAR)

    def test_audio_unlock_survives_webkit_and_interruptions(self):
        self.assertIn("'touchend'", AUDIO)
        self.assertIn("ctx.state !== 'running'", AUDIO)


if __name__ == "__main__":
    unittest.main()
