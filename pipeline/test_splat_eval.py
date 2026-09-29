import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import splat_eval


class PickEvenTests(unittest.TestCase):
    def test_non_positive_k_returns_empty_set_instead_of_dividing_by_zero(self):
        names = [f"s{i}" for i in range(20)]
        self.assertEqual(splat_eval._pick_even(names, 0, "k"), set())
        self.assertEqual(splat_eval._pick_even(names, -3, "k"), set())
        self.assertEqual(splat_eval._pick_even([], 4, "k"), set())

    def test_picks_k_distinct_deterministic_names(self):
        names = [f"s{i:02d}" for i in range(30)]
        a = splat_eval._pick_even(names, 6, "seed")
        self.assertEqual(len(a), 6)
        self.assertEqual(a, splat_eval._pick_even(names, 6, "seed"))
        self.assertEqual(splat_eval._pick_even(names, 99, "seed"), set(names))


class ParamsHashTests(unittest.TestCase):
    def test_hash_ignores_run_specific_paths_but_not_real_params(self):
        views = ["a", "b"]
        one = splat_eval.params_hash(["bin", "/v/eval/c/2026-1-x/train", "-n", "3000"], views, Path("/v/eval/c/2026-1-x"))
        two = splat_eval.params_hash(["bin", "/v/eval/c/2026-2-x/train", "-n", "3000"], views, Path("/v/eval/c/2026-2-x"))
        other = splat_eval.params_hash(["bin", "/v/eval/c/2026-2-x/train", "-n", "9000"], views, Path("/v/eval/c/2026-2-x"))
        self.assertEqual(one, two)
        self.assertNotEqual(one, other)


class MakeSplitAtomicTests(unittest.TestCase):
    def test_split_files_are_written_via_atomic_helper_and_readable(self):
        with tempfile.TemporaryDirectory() as folder:
            proj, out = Path(folder) / "proj", Path(folder) / "out"
            (proj / "opensfm").mkdir(parents=True)
            shots = {f"img_{i:03d}.jpg": {"rotation": [0, 0, 0]} for i in range(40)}
            (proj / "opensfm" / "reconstruction.json").write_text(json.dumps([{"shots": shots}]))
            (proj / "opensfm" / "image_list.txt").write_text("/datasets/code/images/x.jpg\n")
            with mock.patch.object(splat_eval, "atomic_write_json", wraps=splat_eval.atomic_write_json) as aw:
                split = splat_eval.make_split(proj, out, "cid")
            self.assertGreaterEqual(aw.call_count, 3)
            self.assertEqual(json.loads((out / "split.json").read_text())["n_test"], split["n_test"])
            self.assertEqual([p for p in out.rglob("*.tmp")], [])
            self.assertIn(str(proj), (out / "train" / "image_list.txt").read_text())


if __name__ == "__main__":
    unittest.main()
