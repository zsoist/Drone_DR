"""browser_gate: teardown de árbol completo, reaper de huérfanos y deadline de arranque."""
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import browser_gate as bg


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # zombie sin reap cuenta como muerto
    st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(st) and not st.startswith("Z")


def wait_dead(pid: int, timeout=6.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        if not alive(pid):
            return True
        time.sleep(0.1)
    return not alive(pid)


FAKE_OK = """#!/bin/bash
# fake chrome: hijos de larga vida + línea DevTools
sleep 300 &
echo $! > "$FAKE_CHILD_PIDFILE"
sleep 300 &
echo "DevTools listening on ws://127.0.0.1:45871/devtools/browser/x" >&2
wait
"""
FAKE_SILENT = """#!/bin/bash
sleep 300 &
echo $! > "$FAKE_CHILD_PIDFILE"
wait
"""


class GateLifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pidfile = self.root / "child.pid"
        os.environ["FAKE_CHILD_PIDFILE"] = str(self.pidfile)
        self._chrome = bg.CHROME
        self._deadline = bg.STARTUP_DEADLINE_S

    def tearDown(self):
        bg.CHROME = self._chrome
        bg.STARTUP_DEADLINE_S = self._deadline
        bg._cleanup_all()
        self.tmp.cleanup()

    def fake(self, body):
        p = self.root / "fake-chrome.sh"
        p.write_text(body)
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
        bg.CHROME = p

    def child_pid(self):
        end = time.time() + 3
        while time.time() < end and not (self.pidfile.exists() and self.pidfile.read_text().strip()):
            time.sleep(0.05)
        return int(self.pidfile.read_text())

    def test_teardown_kills_whole_group_and_profile(self):
        self.fake(FAKE_OK)
        proc, profile, port = bg.launch_chrome()
        self.assertEqual(port, 45871)
        child = self.child_pid()
        self.assertTrue(alive(child))
        self.assertEqual(os.getpgid(proc.pid), proc.pid)       # grupo propio
        self.assertTrue(os.path.isdir(profile.name))
        bg.teardown_chrome(proc, profile)
        self.assertTrue(wait_dead(proc.pid))
        self.assertTrue(wait_dead(child), "el hijo de Chrome sobrevivió al teardown")
        self.assertFalse(os.path.exists(profile.name))

    def test_terminate_kill_compat_reach_children(self):
        # los callers externos (browser_matrix, spike_gate) llaman proc.terminate()/kill()
        self.fake(FAKE_OK)
        proc, profile, _ = bg.launch_chrome()
        child = self.child_pid()
        proc.terminate()
        proc.wait(timeout=5)
        proc.kill()
        self.assertTrue(wait_dead(child))
        profile.cleanup()
        profile.cleanup()                                       # idempotente
        self.assertFalse(os.path.exists(profile.name))

    def test_silent_chrome_honors_deadline_and_cleans_up(self):
        self.fake(FAKE_SILENT)
        bg.STARTUP_DEADLINE_S = 1.5
        before = set(Path(tempfile.gettempdir()).glob(bg.PROFILE_PREFIX + "*"))
        t0 = time.time()
        with self.assertRaises(RuntimeError):
            bg.launch_chrome()
        self.assertLess(time.time() - t0, 8)                    # antes: bloqueaba para siempre
        child = self.child_pid()
        self.assertTrue(wait_dead(child), "hijo huérfano tras arranque fallido")
        after = set(Path(tempfile.gettempdir()).glob(bg.PROFILE_PREFIX + "*"))
        self.assertEqual(after - before, set(), "perfil temporal filtrado")

    def test_chrome_exit_before_devtools(self):
        self.fake("#!/bin/bash\nexit 3\n")
        with self.assertRaisesRegex(RuntimeError, "terminó antes"):
            bg.launch_chrome()

    def test_reaper_filters_rows(self):
        tmp = tempfile.gettempdir()
        mine = f"/x/Chrome --headless=new --user-data-dir={tmp}{os.sep}{bg.PROFILE_PREFIX}abc --no-first-run"
        rows = [
            (100, 1, 100, mine),                                              # huérfano nuestro
            (101, 100, 100, mine),                                            # hijo (no raíz)
            (200, 55, 200, mine),                                             # padre vivo
            (300, 1, 300, "/x/Chrome --user-data-dir=/Users/me/Library/Chrome"),   # Chrome real
            (301, 1, 301, f"/x/Chrome --headless=new --user-data-dir=/Users/me/other"),
            (302, 1, 302, f"/x/Chrome --user-data-dir={tmp}{os.sep}{bg.PROFILE_PREFIX}zzz"),  # no headless
        ]
        self.assertEqual(bg.reap_stale_chrome(rows=rows, kill=False), [100])

    def _orphan(self, new_session: bool):
        prof = Path(tempfile.gettempdir()) / f"{bg.PROFILE_PREFIX}reaptest{os.getpid()}{int(new_session)}"
        prof.mkdir(exist_ok=True)
        code = "import time; time.sleep(120)"
        cmd = (f"({'exec ' if False else ''}{sys.executable} -c '{code}' --headless "
               f"--user-data-dir={prof} >/dev/null 2>&1 & echo $!)")
        out = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True,
                             start_new_session=new_session).stdout.strip()
        pid = int(out)
        end = time.time() + 5
        while time.time() < end:
            ppid = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True,
                                  text=True).stdout.strip()
            if ppid == "1":
                break
            time.sleep(0.1)
        return pid, prof

    def test_reaper_kills_real_orphan_group_leader(self):
        pid, prof = self._orphan(new_session=True)
        try:
            self.assertIn(pid, bg.reap_stale_chrome())
            self.assertTrue(wait_dead(pid))
            self.assertFalse(prof.exists())
        finally:
            if alive(pid):
                os.kill(pid, signal.SIGKILL)
            prof.mkdir(exist_ok=True)
            prof.rmdir()

    def test_reaper_orphan_in_shared_group_kills_only_the_tree(self):
        # versión vieja: comparte pgid con el padre muerto → NO se mata el grupo (mataría al worker)
        pid, prof = self._orphan(new_session=False)
        try:
            self.assertIn(pid, bg.reap_stale_chrome())
            self.assertTrue(wait_dead(pid))
            self.assertTrue(alive(os.getpid()))
        finally:
            if alive(pid):
                os.kill(pid, signal.SIGKILL)
            if prof.exists():
                prof.rmdir()


if __name__ == "__main__":
    unittest.main()
