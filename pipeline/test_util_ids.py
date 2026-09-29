"""util_ids.py: filename/id sanitizers."""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import util_ids  # noqa: E402


HOSTILE = [
    "", "clip_0104", "a-b_c", "../../etc/passwd", "..\\..\\x", "a\x00b", "a/b.mp4",
    "my file.mp3", "  lead trail  ", "...", ".hidden", "ñandú día.mp3", "日本語-01",
    "a;rm -rf /", "tab\tnew\nline", "emoji\U0001F681x", "a" * 300, 123, None, 4.5, ["x", "y"],
]



class UtilIdsTests(unittest.TestCase):
    def check(self, fn, pattern, repl):
        for s in HOSTILE:
            with self.subTest(fn=fn.__name__, s=s):
                self.assertEqual(fn(s), re.sub(pattern, repl, str(s)))

    def test_safe_id(self):
        self.check(util_ids.safe_id, r"[^\w-]", "")

    def test_safe_name(self):
        self.check(util_ids.safe_name, r"[^\w.\- ]", "")

    def test_safe_upload_name(self):
        self.check(util_ids.safe_upload_name, r"[^\w.\-]", "_")

    def test_safe_upload_name_spaces(self):
        self.check(util_ids.safe_upload_name_spaces, r"[^\w.\- ]", "_")

    def test_no_path_separators_survive(self):
        for fn in (util_ids.safe_id, util_ids.safe_name, util_ids.safe_upload_name):
            out = fn("../../a/b\\c\x00")
            self.assertNotIn("/", out)
            self.assertNotIn("\\", out)
            self.assertNotIn("\x00", out)


if __name__ == "__main__":
    unittest.main()
