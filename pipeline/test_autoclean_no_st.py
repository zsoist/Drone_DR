import json
import os
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
STRIDE = 32


def make_splat(n=200) -> bytes:
    out = bytearray()
    for i in range(n):
        pos = struct.pack("<3f", (i % 10) * 0.1, (i // 10 % 10) * 0.1, (i // 100) * 0.1)
        scale = struct.pack("<3f", 0.05, 0.05, 0.05)
        out += pos + scale + bytes([200, 100, 50, 255]) + bytes([128, 128, 128, 255])
    return bytes(out)


class AutocleanWithoutSplatTransform(unittest.TestCase):
    def run_ac(self, st):
        with tempfile.TemporaryDirectory(dir="/private/tmp/claude-501") as td:
            src, dst = Path(td) / "in.splat", Path(td) / "out.splat"
            src.write_bytes(make_splat())
            r = subprocess.run(["node", str(HERE / "autoclean.mjs"), str(src), str(dst),
                                "--st", st, "--json"], capture_output=True, text=True, timeout=60)
            exists = dst.exists()
            size = dst.stat().st_size if exists else 0
            leftovers = [p.name for p in Path(td).iterdir() if "tmp" in p.name]
        return r, exists, size, leftovers

    def test_missing_st_still_produces_output(self):
        r, exists, size, leftovers = self.run_ac("/nonexistent/cli.mjs")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(exists, "outFile no se produjo (ENOENT en statSync)")
        self.assertGreater(size, 0)
        self.assertEqual(size % STRIDE, 0)
        rep = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(rep["voxel_note"], "splat-transform ausente")
        self.assertEqual(rep["output"] * STRIDE, size)
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
