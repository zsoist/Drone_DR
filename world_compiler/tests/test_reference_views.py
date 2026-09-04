import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from world_compiler.qa.reference_views import (
    crop_source_ortho,
    render_dsm_hillshade,
    render_truth_debug,
)


class ReferenceViewTests(unittest.TestCase):
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
