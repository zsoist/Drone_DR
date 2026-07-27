"""Regression coverage for stale precompressed assets found in World QA."""
import gzip
import os
import tempfile
import unittest
from pathlib import Path

import aerobrain_server

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
COMPRESSIBLE_SUFFIXES = {".css", ".html", ".js", ".json", ".svg"}


def gzip_pair_issues(web_root: Path) -> list[str]:
    """Return every missing, orphaned, stale, corrupt, or mismatched sidecar."""
    sources = sorted(
        path for path in web_root.rglob("*")
        if path.is_file()
        and path.suffix in COMPRESSIBLE_SUFFIXES
        and "node_modules" not in path.parts
    )
    sidecars = sorted(path for path in web_root.rglob("*.gz") if path.is_file())
    issues = []
    for source in sources:
        sidecar = source.with_name(source.name + ".gz")
        if not sidecar.is_file():
            issues.append(f"missing:{sidecar.relative_to(web_root)}")
    for sidecar in sidecars:
        source = sidecar.with_name(sidecar.name.removesuffix(".gz"))
        relative = sidecar.relative_to(web_root)
        if not source.is_file():
            issues.append(f"orphan:{relative}")
            continue
        try:
            expanded = gzip.decompress(sidecar.read_bytes())
        except (EOFError, OSError):
            issues.append(f"corrupt:{relative}")
            continue
        if expanded != source.read_bytes():
            issues.append(f"mismatch:{relative}")
        if sidecar.stat().st_mtime_ns < source.stat().st_mtime_ns:
            issues.append(f"stale:{relative}")
    return sorted(issues)


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

    def test_repository_sidecars_are_complete_identical_and_not_older(self):
        self.assertEqual(gzip_pair_issues(WEB), [])

    def test_pair_audit_fails_closed_for_missing_orphan_stale_and_mismatched_sidecars(self):
        with tempfile.TemporaryDirectory() as folder:
            web = Path(folder)
            missing = web / "missing.js"
            missing.write_text("missing")

            stale = web / "stale.css"
            stale.write_text("new")
            stale_sidecar = web / "stale.css.gz"
            stale_sidecar.write_bytes(gzip.compress(b"new"))
            os.utime(stale_sidecar, ns=(100, 100))
            os.utime(stale, ns=(200, 200))

            mismatch = web / "mismatch.html"
            mismatch.write_text("current")
            mismatch_sidecar = web / "mismatch.html.gz"
            mismatch_sidecar.write_bytes(gzip.compress(b"different"))
            mismatch_ns = mismatch.stat().st_mtime_ns
            os.utime(mismatch_sidecar, ns=(mismatch_ns, mismatch_ns))

            orphan = web / "orphan.svg.gz"
            orphan.write_bytes(gzip.compress(b"orphan"))

            self.assertEqual(
                gzip_pair_issues(web),
                [
                    "mismatch:mismatch.html.gz",
                    "missing:missing.js.gz",
                    "orphan:orphan.svg.gz",
                    "stale:stale.css.gz",
                ],
            )


if __name__ == "__main__":
    unittest.main()
