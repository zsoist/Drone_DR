import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from world_compiler.aerobrain.cameras import camera_support_grid, load_opensfm_cameras


class CameraEvidenceTests(unittest.TestCase):
    def test_opensfm_pose_maps_to_local_ab_without_exporting_geography(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reconstruction.json"
            path.write_text(json.dumps([{
                "reference_lla": {"latitude": 0.0, "longitude": 0.0, "altitude": 0.0},
                "cameras": {"cam": {
                    "projection_type": "brown", "width": 1000, "height": 1000,
                    "focal_x": 1.0, "focal_y": 1.0, "c_x": 0.0, "c_y": 0.0,
                }},
                "shots": {"frame.jpg": {
                    "camera": "cam", "rotation": [math.pi, 0.0, 0.0],
                    "translation": [0.0, 0.0, 10.0],
                }},
            }]))

            cameras = load_opensfm_cameras(path, {
                "center_wgs84": [0.0, 0.0], "elev_min": 0.0,
            })

            self.assertEqual(1, len(cameras.poses))
            self.assertTrue(np.allclose([0.0, 10.0, 0.0], cameras.poses[0].center_ab_m))
            self.assertTrue(np.allclose([0.0, -1.0, 0.0], cameras.poses[0].forward_ab))
            self.assertNotIn("latitude", cameras.poses[0].as_dict())
            self.assertNotIn("longitude", cameras.poses[0].as_dict())

    def test_projection_grid_records_real_camera_support_and_unknowns(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reconstruction.json"
            path.write_text(json.dumps([{
                "reference_lla": {"latitude": 0.0, "longitude": 0.0, "altitude": 0.0},
                "cameras": {"cam": {
                    "projection_type": "brown", "width": 1000, "height": 1000,
                    "focal_x": 1.0, "focal_y": 1.0, "c_x": 0.0, "c_y": 0.0,
                }},
                "shots": {"frame.jpg": {
                    "camera": "cam", "rotation": [math.pi, 0.0, 0.0],
                    "translation": [0.0, 0.0, 10.0],
                }},
            }]))
            cameras = load_opensfm_cameras(path, {"center_wgs84": [0.0, 0.0], "elev_min": 0.0})
            support = camera_support_grid(
                cameras,
                x_ab_m=np.array([[-1.0, 100.0]]),
                y_ab_m=np.array([[0.0, 0.0]]),
                z_ab_m=np.array([[0.0, 0.0]]),
            )

            self.assertEqual(1, int(support.visible_count[0, 0]))
            self.assertEqual(0, int(support.visible_count[0, 1]))
            self.assertEqual(0, int(support.dominant_camera_index[0, 0]))
            self.assertEqual(-1, int(support.dominant_camera_index[0, 1]))


if __name__ == "__main__":
    unittest.main()
