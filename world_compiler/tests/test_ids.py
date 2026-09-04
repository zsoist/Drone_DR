import math
import tempfile
import unittest
from pathlib import Path

from world_compiler.ids import canonical_json, hero_id, tree_hash


class HeroIdentityTests(unittest.TestCase):
    def test_hero_id_is_order_independent_and_changes_with_source_hash(self):
        first = hero_id(
            {"scene_id": "scene_a", "size_m": 100},
            {"manifest": "aa"},
            {},
        )
        reordered = hero_id(
            {"size_m": 100, "scene_id": "scene_a"},
            {"manifest": "aa"},
            {},
        )
        changed = hero_id(
            {"scene_id": "scene_a", "size_m": 100},
            {"manifest": "bb"},
            {},
        )

        self.assertEqual(first, reordered)
        self.assertNotEqual(first, changed)
        self.assertTrue(first.startswith("hero_"))
        self.assertEqual(21, len(first))

    def test_canonical_json_rejects_non_finite_numbers(self):
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    canonical_json({"value": value})

    def test_tree_hash_tracks_content_and_ignores_cache_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "module.py").write_text("VALUE = 1\n")
            first = tree_hash(root)
            (root / "__pycache__").mkdir()
            (root / "__pycache__/module.pyc").write_bytes(b"unstable")
            self.assertEqual(first, tree_hash(root))
            (root / "module.py").write_text("VALUE = 2\n")
            self.assertNotEqual(first, tree_hash(root))


if __name__ == "__main__":
    unittest.main()
