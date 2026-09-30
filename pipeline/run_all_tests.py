#!/usr/bin/env python3
"""Run every AeroBrain test suite (not only test_smoke.py).

  python3 pipeline/run_all_tests.py           # everything
  python3 pipeline/run_all_tests.py --fast    # skip modules known to take > 60 s
  python3 pipeline/run_all_tests.py -k scenes # only modules whose name contains "scenes"
  python3 pipeline/run_all_tests.py -k scenes -k jobs  # -k repeats: a suite matching ANY needle runs

Python: every pipeline/test_*.py except test_smoke.py, as `python -m unittest <module>`
from pipeline/ with PYTHONPATH="..:." (tests import both `pipeline.x` and bare `x`).
Node: `node --test` over pipeline/test_*.mjs, edge/test_*.mjs and tools/test_*.mjs.
Exit code is non-zero if any suite fails, if a suite runs zero tests, or if a -k needle
matches no suite (a typo must not read as green). test_smoke.py runs this with --fast, so the
pre-commit gate covers these suites too.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
ROOT = PIPELINE.parent
NODE_GROUPS = (
    ("node:pipeline", PIPELINE),
    ("node:edge", ROOT / "edge"),
    ("node:tools", ROOT / "tools"),
)
# Modules that take > 60 s are skipped by --fast. Measured 2026-09-28: the slowest module
# (test_weapon_assets) takes ~16 s and the whole run ~30 s, so nothing qualifies yet.
# Add a module name here if one ever crosses 60 s.
SLOW: frozenset[str] = frozenset()
MODULE_TIMEOUT_S = 180
# test_fv2_hud_contract drives Chrome through the whole fv2 layout audit (3 viewports x 10 scenes, incl. the weapon wheel): ~200 s.
MODULE_TIMEOUTS = {"test_fv2_hud_contract": 420}


_SANDBOX = None


def _sandbox() -> Path:
    """Fresh temp dir shared by every child of this run: tests must never write into the
    live vault (ops/errors.jsonl, ops/job_logs)."""
    global _SANDBOX
    if _SANDBOX is None:
        _SANDBOX = Path(tempfile.mkdtemp(prefix="aerobrain-tests-"))
    return _SANDBOX


def _env() -> dict:
    env = dict(os.environ)
    box = _sandbox()
    env["AEROBRAIN_JOB_LOG_DIR"] = str(box / "job_logs")
    env["AEROBRAIN_ERRLOG"] = str(box / "errors.jsonl")
    # Some tests shell out to a bare `python`: make it resolve to the interpreter running us.
    env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
    env["PYTHONPATH"] = os.pathsep.join([str(ROOT), str(PIPELINE)])
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["AEROBRAIN_NO_REMOTE"] = "1"      # gpu_lane._wsl/_run fail fast instead of ssh to the PC
    return env


def discover(fast: bool, needles: list[str] | None) -> list[tuple[str, list[str] | None, Path]]:
    suites = []
    for path in sorted(PIPELINE.glob("test_*.py")):
        if path.name == "test_smoke.py":
            continue
        name = path.stem
        if fast and name in SLOW:
            continue
        suites.append((name, [sys.executable, "-m", "unittest", name], PIPELINE))
    node = None
    for label, folder in NODE_GROUPS:
        # One suite per file so a file that registers zero tests is reported by name
        # (a combined `node --test a b c` hides an empty file behind its neighbours).
        for file in sorted(folder.glob("test_*.mjs")):
            node = node or _which_node()
            name = f"{label}/{file.stem}"
            if node is None:
                suites.append((name, None, folder))
            else:
                suites.append((name, [node, "--test", "--test-reporter=tap", str(file)], ROOT))
    if needles:
        suites = [s for s in suites if any(n in s[0] for n in needles)]
    return suites


def unmatched_needles(needles: list[str] | None, all_suites) -> list[str]:
    return [n for n in needles or [] if not any(n in s[0] for s in all_suites)]


_RAN = re.compile(r"^Ran (\d+) tests? in", re.M)
_TAP_SUBTEST = re.compile(r"^# Subtest: (.+)$", re.M)


def tests_executed(name: str, out: str) -> int | None:
    """Number of tests the child reports having run (None if it printed no count).

    Node's TAP output reports a file that registers no tests as ONE test titled with the
    file name ("# tests 1"), so count top-level subtests that are not file names instead."""
    if name.startswith("node:"):
        titles = _TAP_SUBTEST.findall(out)
        if not titles and "TAP version" not in out:
            return None
        return sum(1 for t in titles if not re.search(r"\.[cm]?js$", t.strip()))
    m = _RAN.search(out)
    return int(m.group(1)) if m else None


def _which_node() -> str | None:
    for d in os.environ.get("PATH", "").split(os.pathsep):
        cand = Path(d) / "node"
        if cand.is_file() and os.access(cand, os.X_OK):
            return str(cand)
    return None


def run_one(suite) -> dict:
    name, argv, cwd = suite
    if argv is None:
        return {"name": name, "rc": 1, "secs": 0.0, "tail": "node not found on PATH"}
    t0 = time.monotonic()
    try:
        # stdin=DEVNULL: a suite whose mocks read stdin (`$(cat)`) otherwise blocks forever
        # when this runner itself sits on an open pipe (pre-commit hook, CI) — intermittent hang
        p = subprocess.run(argv, cwd=cwd, env=_env(), capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, timeout=MODULE_TIMEOUTS.get(name, MODULE_TIMEOUT_S))
        rc, out = p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        rc, out = 124, f"timeout after {MODULE_TIMEOUTS.get(name, MODULE_TIMEOUT_S)}s"
    if rc == 0:
        ran = tests_executed(name, out)
        if not ran:  # 0 tests, or no count at all: an empty suite is not a passing suite
            rc, out = 1, out + f"\nNO TESTS RAN in {name} (count={ran})"
    return {"name": name, "rc": rc, "secs": time.monotonic() - t0,
            "tail": "\n".join(out.strip().splitlines()[-25:])}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fast", action="store_true", help="skip modules that take > 60 s")
    ap.add_argument("-k", dest="needles", action="append",
                    help="only suites whose name contains this (repeatable; any match runs)")
    ap.add_argument("-j", "--jobs", type=int, default=1, help="suites in parallel (default 1)")
    ap.add_argument("-v", "--verbose", action="store_true", help="print output of passing suites too")
    args = ap.parse_args()

    suites = discover(args.fast, args.needles)
    dead = unmatched_needles(args.needles, discover(args.fast, None))
    if dead or not suites:
        print(f"no suites match -k {', '.join(dead or args.needles or ['(none)'])}; "
              f"running nothing is a failure", file=sys.stderr)
        return 2
    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
        results = list(ex.map(run_one, suites))

    width = max((len(r["name"]) for r in results), default=10)
    for r in results:
        status = "ok  " if r["rc"] == 0 else "FAIL"
        print(f"{status} {r['name']:<{width}} {r['secs']:6.1f}s")
    failed = [r for r in results if r["rc"] != 0]
    for r in failed:
        print(f"\n--- {r['name']} (rc={r['rc']}) ---\n{r['tail']}")
    if args.verbose:
        for r in results:
            if r["rc"] == 0:
                print(f"\n--- {r['name']} ---\n{r['tail']}")
    total = time.monotonic() - t0
    print(f"\n{len(results) - len(failed)}/{len(results)} suites ok in {total:.1f}s"
          + (f"; FAILED: {', '.join(r['name'] for r in failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
