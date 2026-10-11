#!/usr/bin/env python3
"""Compare an STE rewrite with the original: nothing technical may get lost.

  python3 pipeline/ste_factcheck.py docs/RUNBOOKS.md                # compare with git HEAD
  python3 pipeline/ste_factcheck.py docs/RUNBOOKS.md --against HEAD~3

It lists items that exist in the OLD file and do not exist in the NEW file:
  code     fenced code blocks and inline code spans (whitespace is ignored)
  number   numbers (the separators "," and "." inside a number are ignored, so 37.473.907 = 37,473,907)
  link     link targets and bare URLs
Items that you removed on purpose are fine (for example a Spanish word inside code). Read the list.
Exit code 1 when something is missing, so a script can use it.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})[^\n]*\n(.*?)^\s*\2\s*$", re.S | re.M)
INLINE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)")
LINK = re.compile(r"\]\(([^)\s]+)")
URL = re.compile(r"https?://[^\s)>\]`]+")
NUM = re.compile(r"(?<![\w.])[-+]?\d[\d.,]*\d|\d")


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def extract(text: str) -> dict[str, set[str]]:
    items = {"code": set(), "number": set(), "link": set()}
    for m in FENCE.finditer(text):
        items["code"].add(norm_ws(m.group(3)))
    stripped = FENCE.sub(" ", text)
    for m in INLINE.finditer(stripped):
        items["code"].add(norm_ws(m.group(2)))
    for m in LINK.finditer(stripped):
        items["link"].add(m.group(1))
    for m in URL.finditer(stripped):
        items["link"].add(m.group(0).rstrip(".,;:"))
    prose = INLINE.sub(" ", stripped)
    prose = LINK.sub(" ", prose)
    for m in NUM.finditer(prose):
        items["number"].add(re.sub(r"[.,]", "", m.group(0)))
    return items


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--against", default="HEAD")
    a = ap.parse_args(argv)
    path = Path(a.path)
    rel = path.resolve().relative_to(ROOT).as_posix()
    old = subprocess.run(["git", "show", f"{a.against}:{rel}"], cwd=ROOT, capture_output=True, text=True)
    if old.returncode != 0:
        print(old.stderr, file=sys.stderr)
        return 2
    o, n = extract(old.stdout), extract(path.read_text(encoding="utf-8"))
    missing = 0
    for kind in ("code", "link", "number"):
        gone = sorted(o[kind] - n[kind])
        if gone:
            missing += len(gone)
            print(f"-- {kind}: {len(gone)} in the old file, not in the new file")
            for g in gone:
                print(f"   {g[:200]}")
    print(f"missing items: {missing}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
