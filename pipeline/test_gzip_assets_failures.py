import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

PIPE = Path(__file__).resolve().parent


class GzipAssetsExitCodes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "pipeline").mkdir()
        (root / "web").mkdir()
        shutil.copy(PIPE / "gzip_assets.sh", root / "pipeline" / "gzip_assets.sh")
        (root / "web" / "a.css").write_text("body{}" * 50)
        (root / "web" / "with space.js").write_text("var x=1;" * 50)
        self.root = root

    def tearDown(self):
        for p in self.root.rglob("*"):
            try:
                p.chmod(0o644)
            except OSError:
                pass
        self.tmp.cleanup()

    def run_script(self, env=None):
        return subprocess.run(["bash", str(self.root / "pipeline" / "gzip_assets.sh")],
                              capture_output=True, text=True, env=env or os.environ.copy(), timeout=60)

    def test_success_exit_zero_and_sidecars_including_spaces(self):
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.root / "web" / "a.css.gz").exists())
        self.assertTrue((self.root / "web" / "with space.js.gz").exists())

    @unittest.skipIf(os.geteuid() == 0, "root ignora permisos")
    def test_gzip_failure_propagates(self):
        (self.root / "web" / "a.css").chmod(0)
        r = self.run_script()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("a.css", r.stderr)
        # el resto sí se procesó (no aborta a mitad) pero el estado global es fallo
        self.assertTrue((self.root / "web" / "with space.js.gz").exists())

    def test_python_mtime_step_failure_propagates(self):
        fake = self.root / "bin"
        fake.mkdir()
        (fake / "python3").write_text("#!/bin/bash\nexit 1\n")
        (fake / "python3").chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{fake}:{env['PATH']}"
        r = self.run_script(env)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("mtimes", r.stderr)


class RunTimeoutHelper(unittest.TestCase):
    @staticmethod
    def helper_source():
        src = (PIPE / "safe_restart.sh").read_text()
        m = re.search(r"^run_timeout\(\) \{.*?^\}\n", src, re.S | re.M)
        assert m, "run_timeout no encontrado en safe_restart.sh"
        return m.group(0)

    def run_bash(self, body, path=None):
        env = os.environ.copy()
        if path:
            env["PATH"] = path
        return subprocess.run(["bash", "-c", self.helper_source() + body], capture_output=True,
                              text=True, env=env, timeout=30)

    def test_expires_with_124_and_passes_through(self):
        r = self.run_bash("run_timeout 1 sleep 10; echo rc=$?")
        self.assertIn("rc=124", r.stdout)
        r = self.run_bash("run_timeout 5 bash -c 'exit 7'; echo rc=$?")
        self.assertIn("rc=7", r.stdout)

    def test_perl_fallback_when_no_timeout_binary(self):
        if not Path("/usr/bin/perl").exists():
            self.skipTest("sin perl")
        d = tempfile.mkdtemp()
        for tool in ("bash", "sleep", "perl", "dirname"):
            found = shutil.which(tool)
            if found:
                os.symlink(found, os.path.join(d, tool))
        try:
            r = self.run_bash("command -v timeout >/dev/null && echo HAS_TIMEOUT; "
                              "run_timeout 1 sleep 10; echo rc=$?", path=d)
            self.assertNotIn("HAS_TIMEOUT", r.stdout)
            self.assertIn("rc=124", r.stdout)
            r = self.run_bash("run_timeout 5 bash -c 'exit 7'; echo rc=$?", path=d)
            self.assertIn("rc=7", r.stdout)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_gates_are_wrapped(self):
        src = (PIPE / "safe_restart.sh").read_text()
        for script in ("audit_world.py", "world_runtime_sweep.py", "flightverse_collision_gate.py"):
            self.assertRegex(src, rf"run_timeout \d+ python3 \"\$ROOT/pipeline/{script}\"")


if __name__ == "__main__":
    unittest.main()
