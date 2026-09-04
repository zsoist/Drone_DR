import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from world_compiler.builder import BuildRequest, build_world


FIXTURE = Path(__file__).parent / "fixtures" / "vault"


class CompilerCliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.vault = Path(self.temporary.name) / "vault"
        shutil.copytree(FIXTURE, self.vault)
        model = self.vault / "models/recon_fixture"
        scene_path = self.vault / "manifest/scenes/scene_fixture.json"
        scene = json.loads(scene_path.read_text())
        version = scene["versions"][0]
        version["effective_sources"] = ["clip_a", "clip_b"]
        version["metrics"] = {
            "cameras_reconstructed": 20,
            "cameras_total": 20,
            "gsd_cm_px": 2.5,
        }
        scene_path.write_text(json.dumps(scene))

        shape = (121, 121)
        height = np.zeros(shape, dtype="<f4")
        height[45:76, 45:76] = 8.0
        valid = np.ones(shape, dtype="u1")
        coverage = np.ones(shape, dtype="u1")
        height.tofile(model / "dsm_lod.bin")
        valid.tofile(model / "dsm_lod.mask.bin")
        coverage.tofile(model / "mesh_coverage.bin")
        (model / "dsm_lod.json").write_text(json.dumps({
            "grid": list(shape), "size_m": [120.0, 120.0],
            "spacing_m": [1.0, 1.0], "elev_min": 0.0, "elev_max": 8.0,
            "bin": "dsm_lod.bin", "mask_bin": "dsm_lod.mask.bin",
        }))
        (model / "mesh_coverage.json").write_text(json.dumps({
            "version": 1, "grid": list(shape), "bin": "mesh_coverage.bin",
        }))
        manifest_path = model / "scene.v2.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["world"].update({"size_m": [120.0, 120.0], "grid": list(shape), "spacing_m": [1.0, 1.0]})
        manifest["assets"].update({
            "dsm_lod_mask": "data/models/recon_fixture/dsm_lod.mask.bin",
            "mesh_coverage": "data/models/recon_fixture/mesh_coverage.bin",
            "mesh_coverage_meta": "data/models/recon_fixture/mesh_coverage.json",
        })
        manifest_path.write_text(json.dumps(manifest))
        self.request = BuildRequest("scene_fixture", "recon_fixture", 100.0, "auto", "hero-r0")

    def tearDown(self):
        self.temporary.cleanup()

    def test_dry_run_selects_without_writing_worlds(self):
        summary = build_world(self.vault, self.request, dry_run=True)

        self.assertEqual("dry_run", summary["status"])
        self.assertFalse((self.vault / "worlds").exists())
        self.assertNotIn("wgs84", json.dumps(summary).lower())

    def test_build_twice_reuses_identical_content_addressed_world(self):
        first = build_world(self.vault, self.request)
        manifest_path = Path(first["output"]) / "game_scene.v1.json"
        first_bytes = manifest_path.read_bytes()
        second = build_world(self.vault, self.request)

        self.assertEqual("built", first["status"])
        self.assertEqual("existing", second["status"])
        self.assertEqual(first["hero_id"], second["hero_id"])
        self.assertEqual(first_bytes, manifest_path.read_bytes())
        document = json.loads(first_bytes)
        self.assertEqual(6, len(document["geometry"]))
        self.assertEqual("unavailable", document["reference_cameras"]["status"])
        self.assertAlmostEqual(100.0, sum(json.loads((manifest_path.parent / document["truth_field"]).read_text())["coverage_pct"].values()))


if __name__ == "__main__":
    unittest.main()
