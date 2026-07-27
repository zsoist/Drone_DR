"""Static geometry contracts for the coarse-pointer Flightverse command HUD."""
from __future__ import annotations

import re
import unittest
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STYLES = (ROOT / "web" / "style.css").read_text()
COMMAND_STYLES = STYLES[STYLES.index("BLOQUE 55d"):]

TOUCH_PROFILES = {
    "mobile_portrait": (390, 844),
    "mobile_landscape": (844, 390),
    "ipad_portrait": (820, 1180),
    "ipad_landscape": (1180, 820),
}


@dataclass(frozen=True)
class Rect:
    left: float
    top: float
    right: float
    bottom: float


def number(pattern: str, source: str = STYLES) -> float:
    match = re.search(pattern, source, re.S)
    if not match:
        raise AssertionError(f"missing CSS geometry contract: {pattern}")
    return float(match.group(1))


def overlaps(a: Rect, b: Rect) -> bool:
    return (
        a.left < b.right
        and a.right > b.left
        and a.top < b.bottom
        and a.bottom > b.top
    )


def vertical_clearance(control: Rect, zone: Rect) -> float:
    if control.right <= zone.left or control.left >= zone.right:
        return float("inf")
    return zone.top - control.bottom


class MobileHudGeometryContractTests(unittest.TestCase):
    def test_persistent_controls_clear_stick_zones_and_bases(self):
        stick_bottom = number(
            r"\.vl-stick\{[^}]*bottom:(\d+(?:\.\d+)?)px"
        )
        portrait_command_clearance = number(
            r"\.vl-command-hud\{[^}]*bottom:calc\("
            r"min\(34vh,300px\) \+ (\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        portrait_menu_clearance = number(
            r"\.vl-fab\{ left:[^}]*bottom:calc\("
            r"min\(34vh, 300px\) \+ (\d+(?:\.\d+)?)px"
        )
        landscape_command_vh = number(
            r"orientation:landscape\)\{\s*\.vl-command-hud\{"
            r"[^}]*bottom:calc\((\d+(?:\.\d+)?)vh",
            COMMAND_STYLES,
        )
        landscape_command_px = number(
            r"orientation:landscape\)\{\s*\.vl-command-hud\{"
            r"[^}]*bottom:calc\([^+]+\+ (\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        landscape_picker_top = number(
            r"orientation:landscape\)\{\s*\.vl-command-hud\{[^}]*\}\s*"
            r"\.vl-weapon-picker\{[^}]*position:fixed;[^}]*"
            r"top:calc\((\d+(?:\.\d+)?)px \+ env\(safe-area-inset-top\)\);"
            r"[^}]*left:50%;[^}]*right:auto;[^}]*bottom:auto;"
            r"[^}]*transform:translateX\(-50%\)",
            COMMAND_STYLES,
        )
        landscape_menu_vh = number(
            r"orientation:landscape\)\{[^}]*"
            r"\.vl-fab,\.vl-combat-fab\{ bottom:calc\("
            r"(\d+(?:\.\d+)?)vh"
        )
        landscape_menu_px = number(
            r"orientation:landscape\)\{[^}]*"
            r"\.vl-fab,\.vl-combat-fab\{ bottom:calc\("
            r"[^+]+\+ (\d+(?:\.\d+)?)px"
        )
        fire_width = number(
            r"\.vl-trigger\{\s*width:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        fire_height = number(
            r"\.vl-trigger\{[^}]*height:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        weapon_width = number(
            r"\.vl-weapon-toggle\{\s*width:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        weapon_height = number(
            r"\.vl-weapon-toggle\{[^}]*height:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )

        self.assertGreaterEqual(fire_width, 72)
        self.assertGreaterEqual(fire_height, 72)

        for profile, (width, height) in TOUCH_PROFILES.items():
            landscape = width > height
            safe_top = 0
            safe_bottom = 0
            safe_left = 0
            safe_right = 0
            stick_height = (
                0.40 * height if landscape else min(0.34 * height, 300)
            )
            stick_width = (
                min(0.32 * width, 300)
                if landscape
                else min(0.38 * width, 260)
            )
            zone_top = height - stick_bottom - stick_height
            zones = {
                "left": Rect(8, zone_top, 8 + stick_width, height - stick_bottom),
                "right": Rect(
                    width - 8 - stick_width,
                    zone_top,
                    width - 8,
                    height - stick_bottom,
                ),
            }

            base_size = 156 if width >= 900 else (112 if width <= 600 else 132)
            bases = {
                side: Rect(
                    zone.left + (stick_width - base_size) / 2,
                    height - stick_bottom - 26 - base_size,
                    zone.left + (stick_width + base_size) / 2,
                    height - stick_bottom - 26,
                )
                for side, zone in zones.items()
            }

            if landscape:
                command_bottom = (
                    landscape_command_vh / 100 * height + landscape_command_px
                )
                menu_bottom = (
                    landscape_menu_vh / 100 * height + landscape_menu_px
                )
            else:
                command_bottom = stick_height + portrait_command_clearance
                menu_bottom = stick_height + portrait_menu_clearance

            fire_bottom = height - command_bottom
            fire = Rect(
                width - 14 - fire_width,
                fire_bottom - fire_height,
                width - 14,
                fire_bottom,
            )
            weapon_bottom = fire.top - 10
            weapon = Rect(
                width - 14 - weapon_width,
                weapon_bottom - weapon_height,
                width - 14,
                weapon_bottom,
            )
            picker_bottom = weapon.top - 10
            picker_height = 2 + 2 * 6 + 4 * 48 + 3 * 4
            if landscape:
                picker_left = width / 2 - 132 / 2
                picker = Rect(
                    picker_left,
                    safe_top + landscape_picker_top,
                    picker_left + 132,
                    safe_top + landscape_picker_top + picker_height,
                )
            else:
                picker = Rect(
                    width - 14 - 132,
                    picker_bottom - picker_height,
                    width - 14,
                    picker_bottom,
                )
            menu_bottom_y = height - menu_bottom
            menu = Rect(14, menu_bottom_y - 52, 66, menu_bottom_y)
            controls = {
                "fire": fire,
                "weapon": weapon,
                "picker": picker,
                "menu": menu,
            }

            with self.subTest(profile=profile):
                for control_name, control in controls.items():
                    self.assertGreaterEqual(
                        control.left,
                        safe_left,
                        f"{profile}: {control_name} escapes left of the safe area",
                    )
                    self.assertLessEqual(
                        control.right,
                        width - safe_right,
                        f"{profile}: {control_name} escapes right of the safe area",
                    )
                    self.assertGreaterEqual(
                        control.top,
                        safe_top,
                        f"{profile}: {control_name} escapes above the safe area",
                    )
                    self.assertLessEqual(
                        control.bottom,
                        height - safe_bottom,
                        f"{profile}: {control_name} escapes below the safe area",
                    )
                    for zone_name, zone in zones.items():
                        self.assertFalse(
                            overlaps(control, zone),
                            f"{profile}: {control_name} overlaps {zone_name} zone",
                        )
                        clearance = vertical_clearance(control, zone)
                        if clearance != float("inf"):
                            self.assertGreaterEqual(
                                clearance,
                                12,
                                f"{profile}: {control_name} has only "
                                f"{clearance:.2f}px clearance from {zone_name} zone",
                            )
                    for base_name, base in bases.items():
                        self.assertFalse(
                            overlaps(control, base),
                            f"{profile}: {control_name} overlaps {base_name} base",
                        )


if __name__ == "__main__":
    unittest.main()
