import tempfile
import unittest
from pathlib import Path

from world_compiler.storage import WorldPaths, atomic_world_build


class WorldStorageTests(unittest.TestCase):
    def test_rejects_identifiers_that_escape_worlds_root(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                WorldPaths(Path(directory), "../scene", "hero_0123456789abcdef")

    def test_failed_build_does_not_replace_accepted_world(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = WorldPaths(
                Path(directory), "scene_fixture", "hero_0123456789abcdef"
            )
            paths.target.mkdir(parents=True)
            (paths.target / "accepted.txt").write_text("accepted")

            with self.assertRaisesRegex(RuntimeError, "synthetic failure"):
                with atomic_world_build(paths) as staging:
                    (staging / "partial.txt").write_text("partial")
                    raise RuntimeError("synthetic failure")

            self.assertEqual("accepted", (paths.target / "accepted.txt").read_text())
            self.assertFalse((paths.target / "partial.txt").exists())
            self.assertEqual([], list(paths.scene_root.glob(".staging-*")))

    def test_successful_build_promotes_complete_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = WorldPaths(
                Path(directory), "scene_fixture", "hero_0123456789abcdef"
            )

            with atomic_world_build(
                paths, validator=lambda staging: (staging / "complete.json").is_file()
            ) as staging:
                (staging / "complete.json").write_text("{}")

            self.assertTrue((paths.target / "complete.json").is_file())
            self.assertEqual([], list(paths.scene_root.glob(".staging-*")))
            self.assertEqual(paths.vault / "worlds", paths.output_root)

    def test_validator_failure_never_promotes_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = WorldPaths(
                Path(directory), "scene_fixture", "hero_0123456789abcdef"
            )

            with self.assertRaisesRegex(ValueError, "validation failed"):
                with atomic_world_build(paths, validator=lambda _staging: False) as staging:
                    (staging / "incomplete.json").write_text("{}")

            self.assertFalse(paths.target.exists())
            self.assertEqual([], list(paths.scene_root.glob(".staging-*")))


if __name__ == "__main__":
    unittest.main()
