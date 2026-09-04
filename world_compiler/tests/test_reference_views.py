import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from world_compiler.qa.reference_views import (
    compare_mesh_silhouettes,
    crop_source_ortho,
    render_dsm_hillshade,
    silhouette_edge_support,
    render_truth_debug,
)
from world_compiler.aerobrain.cameras import CameraPose, CameraSet


class ReferenceViewTests(unittest.TestCase):
    def test_source_image_edges_support_aligned_silhouette_more_than_shifted_one(self):
        image = Image.new("RGB", (96, 64), "black")
        draw = ImageDraw.Draw(image)
        polygon = [(20, 50), (48, 12), (76, 50)]
        draw.line(polygon + [polygon[0]], fill="white", width=2)
        mask_image = Image.new("1", image.size, 0)
        ImageDraw.Draw(mask_image).polygon(polygon, fill=1)
        mask = np.asarray(mask_image, dtype=bool)

        aligned, _ = silhouette_edge_support(np.asarray(image), mask, tolerance_px=2)
        shifted, _ = silhouette_edge_support(
            np.asarray(image), np.roll(mask, 10, axis=1), tolerance_px=2
        )

        self.assertGreater(aligned["edge_support"], 0.9)
        self.assertGreater(aligned["edge_support"], shifted["edge_support"])
        self.assertGreater(aligned["support_lift_over_edge_density"], 1.0)

    def test_mesh_silhouette_iou_uses_full_opensfm_projection(self):
        camera = CameraPose(
            "camera-1",
            (0.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            (0.0, 0.0, 0.0),
            1.0,
            1.0,
            0.0,
            0.0,
            100,
            100,
        )
        cameras = CameraSet((camera,), 0.0, 0.0, 0.0)
        vertices = np.asarray([
            [-2.0, 10.0, -2.0],
            [2.0, 10.0, -2.0],
            [0.0, 10.0, 2.0],
        ])
        faces = np.asarray([[0, 1, 2]])

        identical = compare_mesh_silhouettes(
            cameras, vertices, faces, vertices, faces, output_size=(100, 100)
        )
        shifted = compare_mesh_silhouettes(
            cameras,
            vertices,
            faces,
            vertices + np.asarray([1.0, 0.0, 0.0]),
            faces,
            output_size=(100, 100),
        )

        self.assertEqual(1.0, identical["median_iou"])
        self.assertLess(shifted["median_iou"], 1.0)
        self.assertEqual("camera-1", identical["cameras"][0]["camera_id"])

    def test_ortho_crop_uses_local_aoi_bounds(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "ortho.png"
            pixels = np.zeros((100, 100, 3), dtype=np.uint8)
            pixels[:, :50] = (255, 0, 0)
            pixels[:, 50:] = (0, 0, 255)
            Image.fromarray(pixels).save(source)

            crop = crop_source_ortho(source, (25.0, 0.0), (100.0, 100.0), 50.0)

            self.assertEqual((50, 50), crop.size)
            self.assertGreater(np.asarray(crop)[..., 2].mean(), np.asarray(crop)[..., 0].mean())

    def test_hillshade_and_truth_debug_are_finite_renderable_images(self):
        height = np.zeros((16, 16), dtype=np.float32)
        height[4:12, 4:12] = 8.0
        hillshade = render_dsm_hillshade(height, (1.0, 1.0), output_size=128)
        classes = np.zeros((16, 16, 3), dtype=np.uint8)
        classes[:, :] = (255, 212, 0)
        confidence = np.full((16, 16), 100, dtype=np.uint8)

        debug = render_truth_debug(classes, confidence, output_size=128)

        self.assertEqual((128, 128), hillshade.size)
        self.assertEqual((256, 128), debug.size)
        self.assertGreater(np.asarray(hillshade).std(), 0)


if __name__ == "__main__":
    unittest.main()
