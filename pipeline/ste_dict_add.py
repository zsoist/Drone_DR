#!/usr/bin/env python3
"""Add an entry to pipeline/ste_dictionary.json (safe for parallel use: it takes a file lock).

  python3 pipeline/ste_dict_add.py name "Brotli" "A compression format." [--category "Tools and platforms"]
  python3 pipeline/ste_dict_add.py verb "rebake" "Make a baked file again." [--category "Release and deploy"]
  python3 pipeline/ste_dict_add.py ing rendering caching          # -ing words that are technical nouns
  python3 pipeline/ste_dict_add.py participle closed locked       # participles that act as adjectives
  python3 pipeline/ste_dict_add.py unapproved utilise v "use" "USE is the approved word." [--basis project]

After a change, run: python3 pipeline/ste_dictionary_md.py --write   (updates docs/STE_STYLE_GUIDE.md).
Write the definition in STE (it appears in the style guide).
"""
import argparse
import fcntl
import json
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parent / "ste_dictionary.json"
DEFAULT_NAME_CATEGORY = "Software components"
DEFAULT_VERB_CATEGORY = "Process control"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["name", "verb", "ing", "participle", "unapproved"])
    ap.add_argument("args", nargs="+")
    ap.add_argument("--category")
    ap.add_argument("--basis", default="project")
    a = ap.parse_args(argv)
    with open(PATH, "r+", encoding="utf-8") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        data = json.load(fh)
        if a.kind in ("name", "verb"):
            if len(a.args) != 2:
                print("need: TERM DEFINITION", file=sys.stderr)
                return 2
            term, definition = a.args
            key = "technical_names" if a.kind == "name" else "technical_verbs"
            cat = a.category or (DEFAULT_NAME_CATEGORY if a.kind == "name" else DEFAULT_VERB_CATEGORY)
            data[key].setdefault(cat, {})[term] = definition
        elif a.kind == "ing":
            data["allowed_exceptions"]["ing_words"] = sorted(set(data["allowed_exceptions"]["ing_words"]) | {w.lower() for w in a.args})
        elif a.kind == "participle":
            data["allowed_exceptions"]["participle_adjectives"] = sorted(set(data["allowed_exceptions"]["participle_adjectives"]) | {w.lower() for w in a.args})
        else:
            if len(a.args) != 4:
                print("need: WORD POS ALTERNATIVES(|-separated) NOTE", file=sys.stderr)
                return 2
            word, pos, alts, note = a.args
            data["unapproved"][word] = {"pos": pos, "alternatives": alts.split("|"), "basis": a.basis, "note": note}
            data["unapproved"] = dict(sorted(data["unapproved"].items()))
        fh.seek(0)
        fh.truncate()
        json.dump(data, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
