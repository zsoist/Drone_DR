"""Contratos del HUD v2 (?fv=2, WS A): elementos borrados ausentes del marcado, texto >= 12 px en el CSS,
targets de 44 px, sin gradientes en controles, y (si el servidor local responde) auditoría de layout en Chrome."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
UI = ROOT / "web" / "flightverse" / "ui"
V2_FILES = ("hud2.js", "weapons2.js", "menu2.js", "screens2.js", "onboarding.js", "v2.js")
# Spec §2.6: clases del HUD heredado que NO pueden existir en el marcado v2
DELETED_CLASSES = (
    "vl-fpv-head", "vl-osd-home", "vl-osd-gimbal", "vl-fpv-br", "vl-fpv-sig", "vl-fpv-rec", "vl-fpv-cross",
    "vl-corner", "vl-metric", "vl-fps", "vl-trigger", "vl-fire", "vl-command-hud", "vl-weapon-toggle",
    "vl-gimbal-tools", "vl-flight-tools-left", "vl-fab", "vl-dock", "vl-combat", "vl-help", "vl-kills",
    "vl-goto", "vl-compass", "vl-solo-fino", "vl-dockmin",
)


def v2_source() -> str:
    return "\n".join((UI / f).read_text() for f in V2_FILES)


class Fv2MarkupContract(unittest.TestCase):
    def test_deleted_elements_absent_from_v2_markup(self):
        src = v2_source()
        classes = set()
        for m in re.finditer(r'class="([^"]*)"', src):
            classes.update(m.group(1).split())
        bad = sorted(set(DELETED_CLASSES) & classes)
        self.assertEqual(bad, [], f"clases heredadas en el marcado v2: {bad}")

    def test_no_production_fps_badge_no_h_hint_on_touch(self):
        src = v2_source()
        self.assertNotIn('id="vl-fps"', src)
        self.assertNotIn("60 fps", src)
        css = (ROOT / "web" / "css" / "hud.css").read_text()
        # los atajos de teclado solo se muestran con puntero fino
        self.assertRegex(css, r"\.fv2\.hx-fine \.hx-keys\s*\{\s*display:\s*block")
        self.assertRegex(css, r"\.hx-wstrip, \.hx-heat, \.hx-keys \{ display: none; \}")

    def test_every_icon_button_has_an_accessible_name(self):
        src = v2_source()
        for m in re.finditer(r'<(?:button|a)\b[^>]*class="[^"]*hx-ibtn[^"]*"[^>]*>', src):
            self.assertIn("aria-label", m.group(0), m.group(0))
        self.assertIn('id="hx-fire"', src)
        self.assertRegex(src, r'id="hx-fire"[^>]*aria-label="Disparar"')

    def test_compat_ids_for_other_workstreams_exist(self):
        src = v2_source()
        for ident in ("vl-rig", "vl-mode", "vl-goto", "vl-ghost", "vl-scene", "vl-vista", "vl-calidad", "vl-gimbal-toggle",
                      "vl-camera-toggle", "vl-camera-picker", "vl-gimbal-tray", "vl-gimbal-range", "osd-gimbal", "vl-challenge",
                      "vl-fpv", "vl-result", "vl-inv", "vl-diff", "vl-director", "vl-cine", "vl-count", "vl-minimap"):
            self.assertIn(f'id="{ident}"', src, ident)


class Fv2CssContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.css = {n: (ROOT / "web" / "css" / n).read_text() for n in ("hud.css", "screens.css")}

    def test_no_text_below_12px(self):
        small = []
        for name, css in self.css.items():
            for m in re.finditer(r"font(?:-size)?:\s*(?:[0-9]{3}\s+)?(?:calc\()?\s*([0-9.]+)px", css):
                if float(m.group(1)) < 12:
                    small.append((name, m.group(0)))
        self.assertEqual(small, [], f"texto < 12 px: {small}")

    def test_touch_targets_are_44px(self):
        css = self.css["hud.css"]
        self.assertRegex(css, r"\.hx-ibtn \{[^}]*width: 44px; height: 44px")
        self.assertRegex(css, r"\.hx-fire \{[^}]*width: 76px; height: 76px")
        scr = self.css["screens.css"]
        self.assertRegex(scr, r"\.hx-btn \{[^}]*min-height: 48px")
        self.assertRegex(scr, r"\.hx-seg button \{[^}]*min-height: 44px")
        self.assertRegex(scr, r"\.hx-actions-col \.hx-btn \{[^}]*min-height: 48px")

    def test_results_stack_full_width_on_phone(self):
        scr = self.css["screens.css"]
        self.assertRegex(scr, r"\.hx-actions-col \{[^}]*flex-direction: column")

    def test_no_gradients_on_controls_and_no_transition_all(self):
        for name, css in self.css.items():
            self.assertNotIn("transition: all", css, name)
        btn = re.findall(r"\.hx-(?:btn|ibtn|chip|fire|wchip|seg)[^{]*\{[^}]*\}", self.css["screens.css"] + self.css["hud.css"])
        for rule in btn:
            self.assertNotIn("linear-gradient", rule, rule)

    def test_reduced_motion_honoured(self):
        self.assertIn('html[data-rm="1"]', self.css["hud.css"])
        self.assertIn("prefers-reduced-motion: reduce", self.css["hud.css"])


class Fv2LayoutAudit(unittest.TestCase):
    def test_live_layout(self):
        import fv2_layout_audit as audit
        if not audit.server_up():
            self.skipTest("servidor local :8790 no disponible")
        try:
            fails = audit.audit("http://localhost:8790", audit.DEFAULT_CID)
        except RuntimeError as exc:                 # Chrome / mundo no disponible en este entorno
            self.skipTest(str(exc))
        self.assertEqual(fails, {}, fails)


if __name__ == "__main__":
    unittest.main()
