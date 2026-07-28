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
SAFE_INSETS = {"top": 17, "right": 13, "bottom": 23, "left": 11}


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
    def test_premium_flight_tools_clear_safe_areas_sticks_and_each_other(self):
        stick_bottom = number(
            r"\.vl-stick\{[^}]*bottom:(\d+(?:\.\d+)?)px"
        )
        portrait_clearance = number(
            r"\.vl-command-hud,\.vl-flight-tools-left,\.vl-gimbal-tools\{"
            r"[^}]*bottom:calc\("
            r"min\(34vh,300px\) \+ (\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        gimbal_portrait_clearance = number(
            r"\n\s*\.vl-gimbal-tools\{\s*bottom:calc\("
            r"min\(34vh,300px\) \+ (\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        landscape_tools_top = number(
            r"orientation:landscape\)\{\s*"
            r"\.vl-command-hud,\.vl-flight-tools-left,\.vl-gimbal-tools\{"
            r"[^}]*top:calc\((\d+(?:\.\d+)?)px "
            r"\+ env\(safe-area-inset-top\)\);[^}]*bottom:auto",
            COMMAND_STYLES,
        )
        fire_width = number(
            r"\.vl-trigger\{[^}]*width:(\d+(?:\.\d+)?)px",
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
        camera_size = number(
            r"\.vl-camera-toggle\{\s*width:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        camera_picker_toggle_size = number(
            r"\.vl-camera-picker-toggle\{\s*width:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        menu_size = number(
            r"\.vl-flight-tools-left \.vl-fab\{[^}]*width:"
            r"(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        gimbal_width = number(
            r"\.vl-gimbal-toggle\{\s*width:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )
        gimbal_height = number(
            r"\.vl-gimbal-toggle\{[^}]*height:(\d+(?:\.\d+)?)px",
            COMMAND_STYLES,
        )

        self.assertGreaterEqual(fire_width, 72)
        self.assertGreaterEqual(fire_height, 72)
        self.assertGreaterEqual(camera_size, 56)
        self.assertGreaterEqual(camera_picker_toggle_size, 44)
        self.assertGreaterEqual(menu_size, 52)
        self.assertGreaterEqual(gimbal_width, 96)
        self.assertGreaterEqual(gimbal_height, 44)

        for profile, (width, height) in TOUCH_PROFILES.items():
            landscape = width > height
            safe_top = SAFE_INSETS["top"]
            safe_bottom = SAFE_INSETS["bottom"]
            safe_left = SAFE_INSETS["left"]
            safe_right = SAFE_INSETS["right"]
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

            command_right = width - 14 - safe_right
            left = 14 + safe_left
            if landscape:
                tools_top = safe_top + landscape_tools_top
                weapon_top = tools_top
                weapon = Rect(
                    command_right - weapon_width,
                    weapon_top,
                    command_right,
                    weapon_top + weapon_height,
                )
                fire_top = weapon.bottom + 10
                fire = Rect(
                    command_right - fire_width,
                    fire_top,
                    command_right,
                    fire_top + fire_height,
                )
            else:
                command_bottom = (
                    stick_height + portrait_clearance + safe_bottom
                )
                fire_bottom = height - command_bottom
                fire = Rect(
                    command_right - fire_width,
                    fire_bottom - fire_height,
                    command_right,
                    fire_bottom,
                )
                weapon_bottom = fire.top - 10
                weapon = Rect(
                    command_right - weapon_width,
                    weapon_bottom - weapon_height,
                    command_right,
                    weapon_bottom,
                )

            if landscape:
                camera = Rect(left, tools_top, left + camera_size, tools_top + camera_size)
                camera_list = Rect(
                    camera.right + 8,
                    tools_top,
                    camera.right + 8 + camera_picker_toggle_size,
                    tools_top + camera_picker_toggle_size,
                )
                menu = Rect(
                    left,
                    camera.bottom + 8,
                    left + menu_size,
                    camera.bottom + 8 + menu_size,
                )
                gimbal = Rect(
                    width / 2 - gimbal_width / 2,
                    tools_top,
                    width / 2 + gimbal_width / 2,
                    tools_top + gimbal_height,
                )
            else:
                tools_bottom = height - command_bottom
                menu = Rect(
                    left,
                    tools_bottom - menu_size,
                    left + menu_size,
                    tools_bottom,
                )
                camera = Rect(
                    left,
                    menu.top - 8 - camera_size,
                    left + camera_size,
                    menu.top - 8,
                )
                camera_list = Rect(
                    camera.right + 8,
                    camera.top,
                    camera.right + 8 + camera_picker_toggle_size,
                    camera.top + camera_picker_toggle_size,
                )
                gimbal_bottom = height - (
                    stick_height + gimbal_portrait_clearance + safe_bottom
                )
                gimbal = Rect(
                    width / 2 - gimbal_width / 2,
                    gimbal_bottom - gimbal_height,
                    width / 2 + gimbal_width / 2,
                    gimbal_bottom,
                )

            controls = {
                "fire": fire,
                "weapon": weapon,
                "camera": camera,
                "camera-list": camera_list,
                "menu": menu,
                "gimbal": gimbal,
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
                for left_name in ("camera", "camera-list", "menu"):
                    for right_name in ("weapon", "fire"):
                        self.assertFalse(
                            overlaps(controls[left_name], controls[right_name]),
                            f"{profile}: {left_name} overlaps {right_name}",
                        )
                for side_name in ("camera", "camera-list", "menu", "weapon", "fire"):
                    self.assertFalse(
                        overlaps(controls["gimbal"], controls[side_name]),
                        f"{profile}: gimbal overlaps {side_name}",
                    )
                reticle_y = height / 2
                aim_clearance = (
                    reticle_y - controls["gimbal"].bottom
                    if controls["gimbal"].bottom <= reticle_y
                    else controls["gimbal"].top - reticle_y
                )
                self.assertGreaterEqual(
                    aim_clearance,
                    20,
                    f"{profile}: gimbal leaves only {aim_clearance:.2f}px "
                    "around the aiming reticle",
                )


if __name__ == "__main__":
    unittest.main()
