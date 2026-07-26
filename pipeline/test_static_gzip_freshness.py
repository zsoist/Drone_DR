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
            sidecar.write_bytes(b"old gzip")
            os.utime(sidecar, (100, 100))
            source.write_text("new build")

            self.assertIsNone(aerobrain_server.fresh_gzip_sidecar(source))

    def test_restored_stale_sidecar_is_rejected_despite_new_ctime(self):
        """A restored .gz gets a new ctime without representing this source."""
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "volar.js"
            sidecar = Path(folder) / "volar.js.gz"
            source.write_text("current build")
            os.utime(source, (200, 200))
            sidecar.write_bytes(b"restored old gzip")
            os.utime(sidecar, (100, 100))

            self.assertGreater(sidecar.stat().st_ctime_ns, source.stat().st_mtime_ns)
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

    def test_gzip_mtime_equal_to_source_is_eligible(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "style.css"
            sidecar = Path(folder) / "style.css.gz"
            source.write_text("current build")
            sidecar.write_bytes(b"fresh gzip")
            source_ns = source.stat().st_mtime_ns
            os.utime(sidecar, ns=(source_ns, source_ns))

            self.assertEqual(sidecar.stat().st_mtime_ns, source.stat().st_mtime_ns)
            self.assertEqual(sidecar, aerobrain_server.fresh_gzip_sidecar(source))


if __name__ == "__main__":
    unittest.main()
