"""Regression coverage for the Home hero drone framing and motion."""
import json
import math
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MOTION_MODULE = ROOT / "web/home-drone-motion.js"


def read_motion_state(seconds: float, reduced_motion: bool = False):
    if not MOTION_MODULE.is_file():
        return None
    script = """
const { homeDroneFrame, HOME_DRONE_VIEW } = await import(process.argv[1]);
const seconds = Number(process.argv[2]);
const reduced = process.argv[3] === 'true';
process.stdout.write(JSON.stringify({
  view: HOME_DRONE_VIEW,
  frame: homeDroneFrame(seconds, reduced),
}));
"""
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            MOTION_MODULE.as_uri(),
            str(seconds),
            str(reduced_motion).lower(),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


class HomeDroneRegressionTests(unittest.TestCase):
    # Regression: ISSUE-001 — Inicio offset the GLB and left its propellers static.
    # Found by /qa on 2026-08-02.
    # Report: .gstack/qa-reports/qa-report-home-drone-2026-08-02.md
    def test_rest_pose_projects_model_origin_to_exact_stage_center(self):
        state = read_motion_state(0)
        self.assertIsNotNone(state, "Home drone motion contract is missing")

        view = state["view"]
        width, height = 267.0, 328.0
        aspect = width / height
        focal_y = 1 / math.tan(math.radians(view["camera"]["fov"]) / 2)
        depth = view["camera"]["z"] - view["rig"]["z"]
        ndc_x = (view["rig"]["x"] - view["camera"]["x"]) * focal_y / (aspect * depth)
        ndc_y = (view["rig"]["y"] - view["camera"]["y"]) * focal_y / depth

        self.assertAlmostEqual(width / 2, (ndc_x + 1) * width / 2, places=6)
        self.assertAlmostEqual(height / 2, (1 - ndc_y) * height / 2, places=6)

    def test_idle_frame_spins_four_propellers_in_opposite_pairs(self):
        state = read_motion_state(0.5)
        self.assertIsNotNone(state, "Home drone motion contract is missing")

        angles = state["frame"]["rotorAngles"]
        self.assertEqual(4, len(angles))
        self.assertAlmostEqual((0.5 * 32) % math.tau, angles[0], places=6)
        self.assertAlmostEqual(angles[0], -angles[1], places=6)
        self.assertAlmostEqual(angles[0], angles[2], places=6)
        self.assertAlmostEqual(angles[1], angles[3], places=6)

    def test_reduced_motion_keeps_drone_and_propellers_static(self):
        state = read_motion_state(3.75, reduced_motion=True)
        self.assertIsNotNone(state, "Home drone motion contract is missing")

        self.assertEqual(0, state["frame"]["offsetY"])
        self.assertEqual(0, state["frame"]["roll"])
        self.assertEqual([0, 0, 0, 0], state["frame"]["rotorAngles"])


if __name__ == "__main__":
    unittest.main()
