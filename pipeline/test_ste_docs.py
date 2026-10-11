"""Every STRICT document must pass the STE checker (pipeline/ste_lint.py).

The suite runs the checker as a program (the same command a person runs), so a later edit of a
document cannot break the STE rules without a red test. The levels come from docs/.ste.json.
Run: python3 -m unittest pipeline.test_ste_docs   (or via pipeline/run_all_tests.py)
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONFIG = ROOT / "docs" / ".ste.json"
LINT = HERE / "ste_lint.py"

# Documents in docs/ (top level) that are allowed to stay REPORT-ONLY, with the reason.
REPORT_ONLY_REASON: dict[str, str] = {}


def run(*args):
    return subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True, cwd=ROOT)


class SteDocs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads(CONFIG.read_text(encoding="utf-8"))
        cls.strict = [p for p, c in cls.config["files"].items() if c.get("level") == "strict"]
        out = run(LINT, "--json")
        cls.exit_code = out.returncode
        cls.report = json.loads(out.stdout)
        cls.by_path = {f["path"]: f for f in cls.report["files"]}

    def test_config_lists_strict_files_that_exist(self):
        self.assertGreater(len(self.strict), 10)
        for rel in self.strict:
            self.assertTrue((ROOT / rel).exists(), rel)

    def test_every_top_level_doc_is_strict(self):
        for p in sorted((ROOT / "docs").glob("*.md")):
            rel = p.relative_to(ROOT).as_posix()
            if rel in REPORT_ONLY_REASON:
                continue
            self.assertIn(rel, self.strict, f"{rel} must be STRICT (or have a reason in REPORT_ONLY_REASON)")

    def test_key_entry_points_are_strict(self):
        for rel in ("README.md", "SPEC.md", "ROADMAP.md", "CLAUDE.md", "pipeline/README.md", "docs/README.md", "docs/STE_STYLE_GUIDE.md",
                    "docs/RUNBOOKS.md", "docs/OPERATIONS.md", "docs/CAPTURE_PROTOCOL.md"):
            self.assertIn(rel, self.strict, rel)

    def test_checker_exit_code_is_zero(self):
        self.assertEqual(self.exit_code, 0, "run: python3 pipeline/ste_lint.py --no-advisory")

    def test_strict_files_have_no_errors(self):
        for rel in self.strict:
            f = self.by_path.get(rel)
            if f is None:       # a symlink to a file that the list already has (AGENTS.md -> CLAUDE.md)
                self.assertTrue((ROOT / rel).is_symlink(), rel)
                continue
            errors = [v for v in f["violations"] if not v["advisory"] or v["rule"] == "STE-0"]
            detail = "; ".join(f"{v['rule']} line {v['line']}: {v['message'][:80]}" for v in errors[:5])
            self.assertEqual(errors, [], f"{rel}: {detail}")

    def test_strict_files_are_english(self):
        for rel, f in self.by_path.items():
            if rel in self.strict:
                self.assertEqual(f["skipped_non_english"], 0, rel)

    def test_agents_md_is_a_link_to_claude_md(self):
        agents = ROOT / "AGENTS.md"
        self.assertTrue(agents.is_symlink(), "AGENTS.md must be a symlink to CLAUDE.md")
        self.assertEqual(agents.resolve(), (ROOT / "CLAUDE.md").resolve())

    def test_style_guide_dictionary_is_in_sync(self):
        out = run(HERE / "ste_dictionary_md.py", "--check")
        self.assertEqual(out.returncode, 0, out.stderr)

    def test_docs_index_points_to_the_guide(self):
        text = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")
        self.assertIn("STE_STYLE_GUIDE.md", text)
        self.assertIn("ste_lint.py", text)

    def test_claude_md_has_the_working_rules(self):
        text = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        for needle in ("Working rules (Karpathy)", "Think before you code", "Keep it simple", "surgical", "goal"):
            self.assertIn(needle, text)

    def test_checker_is_deterministic(self):
        again = json.loads(run(LINT, "--json").stdout)
        self.assertEqual(again["errors"], self.report["errors"])


if __name__ == "__main__":
    unittest.main()
