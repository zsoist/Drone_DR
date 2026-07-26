"""Regression coverage for stale precompressed assets found in World QA."""
import os
import tempfile
import unittest
from pathlib import Path

import aerobrain_server


class StaticGzipFreshnessTests(unittest.TestCase):
    def test_stale_sidecar_is_rejected_after_source_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "volar.js"
            sidecar = Path(folder) / "volar.js.gz"
            source.write_text("new build")
            sidecar.write_bytes(b"old gzip")
            os.utime(sidecar, (100, 100))
            os.utime(source, (200, 200))

            self.assertIsNone(aerobrain_server.fresh_gzip_sidecar(source))

    def test_current_sidecar_is_eligible(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "volar.js"
            sidecar = Path(folder) / "volar.js.gz"
            source.write_text("build")
            sidecar.write_bytes(b"gzip")
            os.utime(source, (100, 100))
            os.utime(sidecar, (100, 100))

            self.assertEqual(sidecar, aerobrain_server.fresh_gzip_sidecar(source))


if __name__ == "__main__":
    unittest.main()
