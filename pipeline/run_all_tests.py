#!/usr/bin/env python3
"""Run every AeroBrain test suite (not only test_smoke.py).

  python3 pipeline/run_all_tests.py           # everything
  python3 pipeline/run_all_tests.py --fast    # skip modules known to take > 60 s
  python3 pipeline/run_all_tests.py -k scenes # only modules whose name contains "scenes"

Python: every pipeline/test_*.py except test_smoke.py, as `python -m unittest <module>`
from pipeline/ with PYTHONPATH="..:." (tests import both `pipeline.x` and bare `x`).
Node: `node --test` over pipeline/test_*.mjs, edge/test_*.mjs and tools/test_*.mjs.
Exit code is non-zero if any suite fails. test_smoke.py runs this with --fast, so the
pre-commit gate covers these suites too.
"""
import argparse
import os
import subprocess
import sys
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


def _env() -> dict:
    env = dict(os.environ)
    # Some tests shell out to a bare `python`: make it resolve to the interpreter running us.
    env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
    env["PYTHONPATH"] = os.pathsep.join([str(ROOT), str(PIPELINE)])
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def discover(fast: bool, needle: str | None) -> list[tuple[str, list[str], Path]]:
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
        files = sorted(folder.glob("test_*.mjs"))
        if not files:
            continue
        node = node or _which_node()
        if node is None:
            suites.append((label, None, folder))
            continue
        suites.append((label, [node, "--test", *map(str, files)], ROOT))
    if needle:
        suites = [s for s in suites if needle in s[0]]
    return suites


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
        p = subprocess.run(argv, cwd=cwd, env=_env(), capture_output=True, text=True,
                           timeout=MODULE_TIMEOUT_S)
        rc, out = p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        rc, out = 124, f"timeout after {MODULE_TIMEOUT_S}s"
    return {"name": name, "rc": rc, "secs": time.monotonic() - t0,
            "tail": "\n".join(out.strip().splitlines()[-25:])}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fast", action="store_true", help="skip modules that take > 60 s")
    ap.add_argument("-k", dest="needle", help="only suites whose name contains this")
    ap.add_argument("-j", "--jobs", type=int, default=1, help="suites in parallel (default 1)")
    ap.add_argument("-v", "--verbose", action="store_true", help="print output of passing suites too")
    args = ap.parse_args()

    suites = discover(args.fast, args.needle)
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
