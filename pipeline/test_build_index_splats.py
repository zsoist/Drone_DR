import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_index  # noqa: E402


class BuildIndexSplatTests(unittest.TestCase):
    def test_archived_edit_inherits_training_provenance_and_raw_source_is_hidden(self):
        with tempfile.TemporaryDirectory() as td:
            vault = Path(td)
            splats = vault / "splats"
            history = splats / "history"
            history.mkdir(parents=True)
            (splats / "clip.meta.json").write_text(json.dumps({
                "preset": "ultra", "last_step": 15000, "cameras": 42,
                "duration_s": 90.0, "backend": "Metal/MPS",
            }))
            (history / "clip-20260725-120000.clean.sog").write_bytes(b"x" * 120_000)
            (splats / "clip.raw.splat").write_bytes(b"x" * 120_000)
            old_vault = build_index.VAULT
            build_index.VAULT = vault
            try:
                rows = build_index.all_splats(splats)
            finally:
                build_index.VAULT = old_vault

        self.assertEqual(1, len(rows))
        self.assertEqual("ultra", rows[0]["preset"])
        self.assertEqual(42, rows[0]["cameras"])
        self.assertTrue(rows[0]["metadata_inherited"])


if __name__ == "__main__":
    unittest.main()
