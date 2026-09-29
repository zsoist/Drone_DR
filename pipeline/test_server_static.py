"""Static route resolution: supersplat routes."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aerobrain_server as server


class Base(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.vault = Path(self._td.name)
        self._patch = mock.patch.object(server, "VAULT", self.vault)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        self._td.cleanup()


class StaticRouteTests(Base):
    def test_supersplat_mobile_css_resolves_from_web(self):
        h = server.H.__new__(server.H)
        h.path = "/supersplat-mobile.css"
        h.headers = {}
        f = h.resolve()
        self.assertIsNotNone(f)
        self.assertEqual(server.WEB.resolve() / "supersplat-mobile.css", f)

    def test_supersplat_prefix_still_maps_to_editor_dir(self):
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / "index.html").write_text("x")
            with mock.patch.object(server, "SUPERSPLAT", Path(td)):
                for path in ("/supersplat", "/supersplat/", "/supersplat/index.html"):
                    h = server.H.__new__(server.H)
                    h.path = path
                    h.headers = {}
                    self.assertEqual(Path(td).resolve() / "index.html", h.resolve(), path)


if __name__ == "__main__":
    unittest.main()
