import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import jobs as jobstore
import worker


class SceneFramePreflightTests(unittest.TestCase):
    def test_exact_post_selection_counts_split_viable_and_sparse_sources(self):
        with tempfile.TemporaryDirectory() as td:
            project = Path(td)
            images = project / "images"
            images.mkdir()
            sources = ["A", "B", "C"]
            for prefix, count in (("s0_", 8), ("s1_", 4), ("s2_", 5)):
                for index in range(count):
                    (images / f"{prefix}f_{index:04d}.jpg").touch()
            (project / "frames_manifest.json").write_text(json.dumps({
                "sources": [
                    {"cid": "A", "prefix": "s0_"},
                    {"cid": "B", "prefix": "s1_"},
                    {"cid": "C", "prefix": "s2_"},
                ]
            }))

            result = worker.odm_frame_preflight(project, sources)

        self.assertEqual(["A", "C"], result["viable_sources"])
        self.assertEqual(["B"], result["sparse_sources"])
        self.assertEqual(4, result["by_source"]["B"]["submitted"])
        self.assertIn("4/5", result["by_source"]["B"]["reason"])

    def test_recovery_spec_retargets_scene_and_nested_splat_to_viable_identity(self):
        parent = {
            "clip_id": "recon_old",
            "version_id": "recon_old",
            "primary_cid": "A",
            "scene_id": "scene_fixture",
            "sources": ["A", "B", "C"],
            "photos": ["photo.jpg"],
            "preset": "ultra",
            "backend": "cuda",
            "then_splat": True,
            "splat": {
                "clip_id": "recon_old",
                "version_id": "recon_old",
                "scene_id": "scene_fixture",
                "preset": "frontier",
                "backend": "cuda",
                "resolution": "auto",
            },
        }

        recovery = worker.frame_viable_recovery_spec(parent, ["A", "C"])
        expected_id = jobstore.recon_id_for(["A", "C"], ["photo.jpg"])

        self.assertEqual(expected_id, recovery["clip_id"])
        self.assertEqual(expected_id, recovery["version_id"])
        self.assertEqual(["A", "C"], recovery["sources"])
        self.assertEqual("A", recovery["primary_cid"])
        self.assertEqual(expected_id, recovery["splat"]["clip_id"])
        self.assertEqual(expected_id, recovery["splat"]["version_id"])
        self.assertEqual("frontier", recovery["splat"]["preset"])


if __name__ == "__main__":
    unittest.main()
