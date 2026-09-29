"""run_all_tests.py: sandboxed child env, env overrides, fail-closed selection."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ai"))


import run_all_tests  # noqa: E402


class TestIsolationTests(unittest.TestCase):
    def test_run_all_tests_and_perf_honor_env_overrides(self):
        code = ("import jobs, perf; print(jobs.JOB_LOG_DIR); print(perf.ERRLOG)")
        with tempfile.TemporaryDirectory() as td:
            env = dict(os.environ, AEROBRAIN_JOB_LOG_DIR=f"{td}/jl", AEROBRAIN_ERRLOG=f"{td}/e.jsonl",
                       PYTHONPATH=str(HERE))
            out = subprocess.run([sys.executable, "-c", code], env=env, cwd=HERE,
                                 capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual([f"{td}/jl", f"{td}/e.jsonl"], out)

    def test_run_all_tests_child_env_points_at_a_temp_sandbox(self):
        import run_all_tests
        env = run_all_tests._env()
        self.assertNotIn("drone-vault", env["AEROBRAIN_JOB_LOG_DIR"])
        self.assertNotIn("drone-vault", env["AEROBRAIN_ERRLOG"])


class SelectionFailClosedTests(unittest.TestCase):
    def _main(self, *argv):
        with mock.patch.object(sys, "argv", ["run_all_tests.py", *argv]):
            return run_all_tests.main()

    def test_k_with_no_match_exits_nonzero_without_running_anything(self):
        with mock.patch.object(run_all_tests, "run_one") as run_one:
            self.assertNotEqual(0, self._main("-k", "definitely_no_such_suite"))
        run_one.assert_not_called()

    def test_k_accepts_multiple_values_and_keeps_all_of_them(self):
        names = [s[0] for s in run_all_tests.discover(False, ["test_fsutil", "test_paths"])]
        self.assertEqual(["test_fsutil", "test_paths"], names)

    def test_one_dead_needle_fails_even_if_another_matches(self):
        self.assertEqual(["nope"], run_all_tests.unmatched_needles(
            ["test_fsutil", "nope"], run_all_tests.discover(False, None)))
        with mock.patch.object(run_all_tests, "run_one") as run_one:
            self.assertNotEqual(0, self._main("-k", "test_fsutil", "-k", "nope"))
        run_one.assert_not_called()

    def test_node_files_are_separate_suites(self):
        names = [s[0] for s in run_all_tests.discover(False, ["node:"])]
        self.assertTrue(names)
        self.assertTrue(all("/" in n for n in names), names)


class ZeroTestsAreFailuresTests(unittest.TestCase):
    def test_tests_executed_parses_unittest_and_tap_counts(self):
        self.assertEqual(7, run_all_tests.tests_executed("test_x", "\nRan 7 tests in 0.1s\n\nOK"))
        self.assertEqual(1, run_all_tests.tests_executed("test_x", "Ran 1 test in 0.0s"))
        self.assertEqual(0, run_all_tests.tests_executed("test_x", "Ran 0 tests in 0.0s\nNO TESTS RAN"))
        tap = "TAP version 13\n# Subtest: first\nok 1 - first\n# Subtest: second\nok 2 - second\n1..2\n# tests 2\n"
        self.assertEqual(2, run_all_tests.tests_executed("node:tools/test_a", tap))
        empty = "TAP version 13\n# Subtest: test_a.mjs\nok 1 - test_a.mjs\n1..1\n# tests 1\n"
        self.assertEqual(0, run_all_tests.tests_executed("node:tools/test_a", empty))
        self.assertIsNone(run_all_tests.tests_executed("test_x", "nothing"))

    def test_empty_python_and_node_suites_fail_even_with_rc_zero(self):
        node = run_all_tests._which_node()
        with tempfile.TemporaryDirectory() as td:
            empty_py = Path(td) / "test_empty_case.py"
            empty_py.write_text("import unittest\n")
            r = run_all_tests.run_one(("test_empty_case", [sys.executable, "-c", "print('Ran 0 tests in 0.0s')"], Path(td)))
            self.assertNotEqual(0, r["rc"])
            self.assertIn("NO TESTS RAN", r["tail"])
            if node:
                empty_js = Path(td) / "test_empty.mjs"
                empty_js.write_text("// no tests registered\n")
                r = run_all_tests.run_one(("node:tools/test_empty", [node, "--test", "--test-reporter=tap", str(empty_js)], Path(td)))
                self.assertNotEqual(0, r["rc"])
                full_js = Path(td) / "test_full.mjs"
                full_js.write_text("import test from 'node:test';\ntest('one', () => {});\n")
                r = run_all_tests.run_one(("node:tools/test_full", [node, "--test", "--test-reporter=tap", str(full_js)], Path(td)))
                self.assertEqual(0, r["rc"], r["tail"])


if __name__ == "__main__":
    unittest.main()
