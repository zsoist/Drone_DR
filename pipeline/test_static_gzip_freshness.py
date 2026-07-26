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

    def test_current_sidecar_is_eligible(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "volar.js"
            sidecar = Path(folder) / "volar.js.gz"
            source.write_text("build")
            sidecar.write_bytes(b"gzip")
            os.utime(source, (100, 100))
            os.utime(sidecar, (100, 100))

            self.assertEqual(sidecar, aerobrain_server.fresh_gzip_sidecar(source))

    def test_gzip_timestamp_precision_loss_does_not_reject_fresh_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "style.css"
            sidecar = Path(folder) / "style.css.gz"
            source.write_text("current build")
            source_ns = source.stat().st_mtime_ns
            sidecar.write_bytes(b"fresh gzip")
            rounded_ns = source_ns - (source_ns % 1_000)
            os.utime(sidecar, ns=(rounded_ns, rounded_ns))

            self.assertLess(sidecar.stat().st_mtime_ns, source.stat().st_mtime_ns)
            self.assertEqual(sidecar, aerobrain_server.fresh_gzip_sidecar(source))


if __name__ == "__main__":
    unittest.main()
