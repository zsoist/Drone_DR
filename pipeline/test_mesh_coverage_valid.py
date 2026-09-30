import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mesh_coverage  # noqa: E402


class ValidCoveragePctTests(unittest.TestCase):
    """covered_pct divides by the whole rectangular DSM grid; an AOI circle only fills ~78% of
    it, so a correctly cropped mesh looked 7 pts worse than its parent (2026-09-30). The
    comparable figure is coverage over cells where the DSM has data."""

    def test_counts_only_cells_with_valid_dsm(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            valid = np.zeros((4, 4), np.uint8); valid[:2, :] = 1          # half the grid has DSM
            (d / "dsm_lod256.mask.bin").write_bytes(valid.tobytes())
            mask = np.zeros((4, 4), np.uint8); mask[0, :] = 1; mask[3, :] = 1   # 1 valid row + 1 corner row
            self.assertEqual(50.0, mesh_coverage.valid_coverage_pct(d, mask))

    def test_missing_or_mismatched_validity_mask_returns_none(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            mask = np.ones((4, 4), np.uint8)
            self.assertIsNone(mesh_coverage.valid_coverage_pct(d, mask))
            (d / "dsm_lod256.mask.bin").write_bytes(b"\x01" * 3)
            self.assertIsNone(mesh_coverage.valid_coverage_pct(d, mask))


if __name__ == "__main__":
    unittest.main()
