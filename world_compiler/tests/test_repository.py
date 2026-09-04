import json
import shutil
import tempfile
import unittest
from pathlib import Path

from world_compiler.aerobrain.repository import RepositoryError, WorldRepository


FIXTURE = Path(__file__).parent / "fixtures" / "vault"


def snapshot(root: Path):
    return {
        str(path.relative_to(root)): (path.stat().st_size, path.stat().st_mtime_ns)
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


class WorldRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.vault = Path(self.temporary.name) / "vault"
        shutil.copytree(FIXTURE, self.vault)

    def tearDown(self):
        self.temporary.cleanup()

    def test_defaults_to_active_ready_version_without_writing(self):
        before = snapshot(self.vault)

        resolved = WorldRepository(self.vault).resolve_scene("scene_fixture")

        self.assertEqual("recon_fixture", resolved.version_id)
        self.assertTrue(resolved.is_active)
        self.assertEqual((260.0, 260.0), resolved.world_size_m)
        self.assertEqual({"terrain", "mesh", "collision"}, resolved.required_capabilities)
        self.assertIn("scene_manifest", resolved.source_hashes)
        self.assertEqual(before, snapshot(self.vault))

    def test_resolves_explicit_historical_version(self):
        resolved = WorldRepository(self.vault).resolve_scene(
            "scene_fixture", "recon_historical"
        )

        self.assertEqual("recon_historical", resolved.version_id)
        self.assertFalse(resolved.is_active)
        self.assertEqual((120.0, 120.0), resolved.world_size_m)

    def test_rejects_missing_required_capability(self):
        manifest_path = self.vault / "models/recon_fixture/scene.v2.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["capabilities"]["collision"] = False
        manifest_path.write_text(json.dumps(manifest))

        with self.assertRaisesRegex(RepositoryError, "missing required capability: collision"):
            WorldRepository(self.vault).resolve_scene("scene_fixture")

    def test_rejects_asset_path_that_escapes_vault(self):
        manifest_path = self.vault / "models/recon_fixture/scene.v2.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["assets"]["collision_bin"] = "../../outside.bin"
        manifest_path.write_text(json.dumps(manifest))

        with self.assertRaisesRegex(RepositoryError, "asset path escapes vault"):
            WorldRepository(self.vault).resolve_scene("scene_fixture")

    def test_rejects_partial_version_even_when_assets_exist(self):
        scene_path = self.vault / "manifest/scenes/scene_fixture.json"
        scene = json.loads(scene_path.read_text())
        scene["versions"][0]["merge_label"] = "PARTIAL"
        scene_path.write_text(json.dumps(scene))

        with self.assertRaisesRegex(RepositoryError, "version is not promotable"):
            WorldRepository(self.vault).resolve_scene("scene_fixture")


if __name__ == "__main__":
    unittest.main()
