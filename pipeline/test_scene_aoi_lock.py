import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import scene_aoi


def dead_pid() -> int:
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


class LockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.lock = Path(self.tmp.name) / ".x.scene-aoi.lock"

    def tearDown(self):
        self.tmp.cleanup()

    def test_fresh_lock(self):
        fd = scene_aoi._acquire_lock(self.lock)
        os.close(fd)
        self.assertTrue(self.lock.exists())

    def test_live_owner_blocks(self):
        self.lock.write_text(f"pid={os.getpid()}\n")
        with self.assertRaises(FileExistsError):
            scene_aoi._acquire_lock(self.lock)

    def test_dead_owner_is_taken_over(self):
        self.lock.write_text(f"pid={dead_pid()}\n")
        fd = scene_aoi._acquire_lock(self.lock)
        os.close(fd)
        self.assertTrue(self.lock.exists())

    def test_too_old_lock_is_taken_over_even_if_pid_alive(self):
        self.lock.write_text(f"pid={os.getpid()}\n")
        old = time.time() - scene_aoi.LOCK_MAX_AGE_S - 10
        os.utime(self.lock, (old, old))
        os.close(scene_aoi._acquire_lock(self.lock))

    def test_pidless_lock_fresh_blocks_old_takes_over(self):
        self.lock.write_text("")
        with self.assertRaises(FileExistsError):
            scene_aoi._acquire_lock(self.lock)
        old = time.time() - 120
        os.utime(self.lock, (old, old))
        os.close(scene_aoi._acquire_lock(self.lock))

    def test_derive_recovers_from_stale_lock_and_releases(self):
        vault = Path(self.tmp.name)
        lock = vault / "staging" / ".DJI_TARGET.scene-aoi.lock"
        lock.parent.mkdir()
        lock.write_text(f"pid={dead_pid()}\n")
        with mock.patch.object(scene_aoi, "_derive_scene_aoi_locked", return_value={"ok": 1}) as m:
            out = scene_aoi.derive_scene_aoi(
                vault=vault, source_cid="DJI_SRC", target_cid="DJI_TARGET", latitude=1, longitude=1,
                radius_m=1, focus_latitude=1, focus_longitude=1, focus_radius_m=1)
        self.assertEqual(out, {"ok": 1})
        self.assertTrue(m.called)
        self.assertFalse(lock.exists())

    def test_derive_live_lock_still_refuses(self):
        vault = Path(self.tmp.name)
        lock = vault / "staging" / ".DJI_TARGET.scene-aoi.lock"
        lock.parent.mkdir()
        lock.write_text(f"pid={os.getpid()}\n")
        with self.assertRaisesRegex(RuntimeError, "already running"):
            scene_aoi.derive_scene_aoi(
                vault=vault, source_cid="DJI_SRC", target_cid="DJI_TARGET", latitude=1, longitude=1,
                radius_m=1, focus_latitude=1, focus_longitude=1, focus_radius_m=1)
        self.assertTrue(lock.exists())   # no borra el lock ajeno


if __name__ == "__main__":
    unittest.main()
