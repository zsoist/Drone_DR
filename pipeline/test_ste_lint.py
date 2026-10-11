"""Unit tests for pipeline/ste_lint.py (the ASD-STE100 checker).

Run: python3 -m unittest pipeline.test_ste_lint   (or via pipeline/run_all_tests.py)
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ste_lint as L  # noqa: E402

PROC = {"mode": "procedural"}


def rules(text, cfg=None, advisory=None):
    """Rule IDs found in `text`. advisory=None: all, False: errors only, True: advisory only."""
    res = L.lint_text(text, cfg)
    return [v.rule for v in res.violations if advisory is None or v.advisory == advisory]


def words(text, rule="STE-1"):
    return [v.word.lower() for v in L.lint_text(text).violations if v.rule == rule]


class SheetExamples(unittest.TestCase):
    BAD = "It is imperative that the operator ensures the hydraulic reservoir is replenished prior to commencing operation."
    GOOD = "Make sure that the hydraulic reservoir is full before you start the operation."

    def test_bad_sentence_flags_every_unapproved_word(self):
        found = words(self.BAD)
        for w in ("ensures", "replenished", "prior to", "commencing"):
            self.assertIn(w, found)

    def test_bad_sentence_has_passive_and_ing(self):
        res = L.lint_text(self.BAD)
        self.assertIn("STE-3c", [v.rule for v in res.violations])
        self.assertIn("STE-3a", [v.rule for v in res.violations])

    def test_rewritten_sentence_passes_with_13_words(self):
        res = L.lint_text(self.GOOD)
        self.assertEqual(res.violations, [])
        self.assertEqual(res.words, 13)

    def test_dictionary_pairs_from_the_sheet(self):
        for text, bad in (("Use it to commence the job.", "commence"), ("Start before the job. Do it prior to the job.", "prior to"),
                          ("Utilize the tool.", "utilize"), ("It takes approximately 5 minutes.", "approximately"),
                          ("Use the tool in order to stop the job.", "in order to")):
            self.assertIn(bad, words(text), text)
        self.assertEqual(words("It takes about 5 minutes."), [])
        self.assertEqual(words("Use the tool to stop the job."), [])

    def test_test_is_approved_as_a_verb(self):
        self.assertEqual(rules("Test the gate."), [])


class VerbForms(unittest.TestCase):
    def test_progressive_not_approved(self):
        self.assertEqual(rules("Closing the valve stops the flow."), ["STE-3a"])

    def test_progressive_after_preposition_not_approved(self):
        self.assertIn("STE-3a", rules("Stop the worker before restarting the web."))

    def test_perfect_not_approved(self):
        self.assertEqual(rules("The pilot has closed the valve."), ["STE-3b"])
        self.assertIn("STE-3b", rules("The job had stopped."))

    def test_have_as_main_verb_is_fine(self):
        self.assertEqual(rules("The job has a timeout."), [])

    def test_passive_in_procedure_is_an_error(self):
        self.assertEqual(rules("1. The valve must be closed.", PROC, advisory=False), ["STE-3c"])

    def test_passive_in_description_is_advisory(self):
        self.assertEqual(rules("The valve was closed by the worker.", advisory=False), [])
        self.assertEqual(rules("The valve was closed by the worker.", advisory=True), ["STE-3c"])

    def test_participle_as_adjective_is_fine(self):
        self.assertEqual(rules("The closed valve is safe."), [])
        self.assertEqual(rules("The valve is closed."), [])

    def test_simple_tenses_are_fine(self):
        self.assertEqual(rules("The worker will start the next job. The job stopped."), [])

    def test_technical_ing_noun_allowed(self):
        self.assertEqual(rules("The warning shows the error."), [])

    def test_close_is_a_verb_not_an_adjective(self):
        self.assertEqual(rules("Close the valve."), [])
        self.assertEqual(words("The gate is close to the wall."), ["close"])
        self.assertEqual(words("Do not fly near the wall."), [])


class Limits(unittest.TestCase):
    def sentence(self, n, start="Open"):
        return start + " " + " ".join(["file"] * (n - 1)) + "."

    def test_procedural_20_ok_21_not(self):
        self.assertNotIn("STE-5a", rules(self.sentence(20)))
        self.assertIn("STE-5a", rules(self.sentence(21)))

    def test_descriptive_25_ok_26_not(self):
        ok = "The " + " ".join(["big"] * 23) + " job."          # 25 words
        too_long = "The " + " ".join(["big"] * 24) + " job."    # 26 words
        self.assertNotIn("STE-6a", rules(ok))
        self.assertIn("STE-6a", rules(too_long))

    def test_paragraph_6_ok_7_not(self):
        six = " ".join(["The job runs."] * 6)
        seven = " ".join(["The job runs."] * 7)
        self.assertNotIn("STE-6b", rules(six))
        self.assertIn("STE-6b", rules(seven))

    def test_tech_names_and_code_count_as_one_word(self):
        res = L.lint_text("Run `python3 pipeline/ops_status.py --json` now.")
        self.assertEqual(res.words, 3)

    def test_two_instructions_in_one_sentence(self):
        self.assertEqual(rules("Open the door and start the engine."), ["STE-5b"])
        self.assertEqual(rules("Open the door. Start the engine."), [])
        self.assertEqual(rules("Open the door, then start the engine."), ["STE-5b"])

    def test_one_instruction_with_two_objects_is_fine(self):
        self.assertEqual(rules("Open the door and the window."), [])

    def test_condition_first_is_advisory(self):
        self.assertEqual(rules("Wake the PC if it is off.", advisory=False), [])
        self.assertEqual(rules("Wake the PC if it is off.", advisory=True), ["STE-5c"])
        self.assertEqual(rules("If the PC is off, wake it."), [])


class NounClusters(unittest.TestCase):
    def test_four_nouns_advisory(self):
        res = L.lint_text("The cache index file path is wrong.")
        self.assertEqual([(v.rule, v.advisory) for v in res.violations if v.rule == "STE-2"], [("STE-2", True)])

    def test_three_nouns_ok(self):
        self.assertEqual([r for r in rules("The cache index file is wrong.") if r == "STE-2"], [])

    def test_hyphen_counts_as_one_word(self):
        self.assertEqual([r for r in rules("The cache-index file path is wrong.") if r == "STE-2"], [])


class SafetyFormat(unittest.TestCase):
    def test_good_warning(self):
        self.assertEqual(rules("> **WARNING:** Do not fly over people. A falling drone can cause injury."), [])

    def test_good_caution(self):
        self.assertEqual(rules("> **CAUTION:** Do not stop the server during a publish. You can lose the model data."), [])

    def test_keyword_must_be_capital_and_have_colon(self):
        self.assertIn("STE-7", rules("> **Warning:** Do not fly over people. A falling drone can cause injury.", advisory=False))
        self.assertIn("STE-7", rules("> **WARNING** Do not fly over people. A falling drone can cause injury.", advisory=False))

    def test_must_start_with_a_command(self):
        self.assertIn("STE-7", rules("> **WARNING:** People near the drone can get injury. Keep away.", advisory=False))

    def test_wrong_keyword_for_injury(self):
        self.assertIn("STE-7", rules("> **CAUTION:** Do not fly over people. A falling drone can cause injury.", advisory=False))

    def test_wrong_keyword_for_data_loss(self):
        self.assertIn("STE-7", rules("> **WARNING:** Do not stop the server. You can lose the data.", advisory=False))

    def test_not_an_ste_keyword(self):
        self.assertIn("STE-7", rules("> **IMPORTANT:** Do not stop the server. You can lose the data.", advisory=False))

    def test_risk_sentence_is_expected(self):
        res = L.lint_text("> **WARNING:** Do not fly over people.")
        self.assertEqual([(v.rule, v.advisory) for v in res.violations], [("STE-7", True)])

    def test_note_is_not_a_safety_keyword_but_needs_no_command(self):
        self.assertEqual(rules("NOTE: The job runs on the PC."), [])

    def test_prose_that_starts_with_note_is_not_a_safety_line(self):
        self.assertEqual(rules("Note that the job runs on the PC."), [])


class Immunity(unittest.TestCase):
    def test_fenced_code_is_ignored(self):
        text = "Run the script.\n\n```bash\nensure the file is being utilized prior to commencing\n```\n"
        self.assertEqual(rules(text), [])

    def test_inline_code_is_ignored(self):
        self.assertEqual(rules("Do not use the word `utilize` here."), [])
        self.assertEqual(rules("Set `terminate_after_commencing=1`."), [])

    def test_urls_and_paths_are_ignored(self):
        self.assertEqual(rules("See https://example.com/ensure/utilize-this for details."), [])
        self.assertEqual(rules("Open docs/ensure_prior_to.md now."), [])

    def test_front_matter_is_ignored(self):
        self.assertEqual(rules("---\ntitle: utilize ensure commence\n---\n\nStart the job."), [])

    def test_html_comment_is_ignored(self):
        self.assertEqual(rules("<!-- ensure utilize -->\n\nStart the job."), [])

    def test_headings_get_word_checks_only(self):
        res = L.lint_text("# Utilizing the cache is being tested\n")
        self.assertEqual({v.rule for v in res.violations}, {"STE-1"})

    def test_table_cells_get_word_checks_only(self):
        text = "| Word | Use |\n|---|---|\n| `x` | Utilize the cache, which is being tested. |\n"
        res = L.lint_text(text)
        self.assertEqual({v.rule for v in res.violations}, {"STE-1"})

    def test_technical_names_are_allowed(self):
        self.assertEqual(rules("The worker reads the manifest and the GLB file."), [])
        self.assertEqual(rules("The DJI Neo 2 has a wide lens."), [])

    def test_technical_verbs_are_allowed(self):
        self.assertEqual(rules("Deploy the edge Worker. Publish the scene. Rebake the collider."), [])

    def test_ignore_directive(self):
        text = "<!-- ste-ignore STE-1 -->\n\nUtilize the tool.\n\nUtilize the tool.\n"
        self.assertEqual(len(L.lint_text(text).violations), 1)

    def test_ignore_range(self):
        text = "<!-- ste-ignore-start STE-1 -->\nUtilize the tool.\n\nEnsure it.\n<!-- ste-ignore-end -->\n\nUtilize the tool.\n"
        self.assertEqual(len(L.lint_text(text).violations), 1)

    def test_spanish_block_is_reported_not_linted(self):
        res = L.lint_text("El servicio no puede reiniciar el worker cuando hay un job activo en la cola.\n")
        self.assertEqual([v.rule for v in res.violations], ["STE-0"])
        self.assertEqual(res.skipped_non_english, 1)
        self.assertTrue(res.blocking)

    def test_contractions_and_latin_abbreviations(self):
        self.assertIn("don't", words("Don't stop the job."))
        self.assertIn("e.g", [w.lower().rstrip(".") for w in words("Use a tool (e.g. the linter).")])


class Parsing(unittest.TestCase):
    def test_list_items_are_separate_sentences(self):
        res = L.lint_text("- Stop the worker\n- Start the worker\n")
        self.assertEqual(res.sentences, 2)

    def test_numbered_item_in_procedural_section(self):
        text = "## Steps\n<!-- ste:procedural -->\n\n1. The worker is idle.\n"
        res = L.lint_text(text)
        self.assertEqual(res.procedural, 1)

    def test_numbered_item_in_descriptive_section(self):
        res = L.lint_text("1. The worker is idle.\n")
        self.assertEqual(res.descriptive, 1)

    def test_imperative_detection(self):
        self.assertEqual(L.lint_text("Run `x`.\n").procedural, 1)
        self.assertEqual(L.lint_text("Test results are good.\n").descriptive, 1)
        self.assertEqual(L.lint_text("If the job fails, restart the worker.\n").procedural, 1)
        self.assertEqual(L.lint_text("Do not restart the worker.\n").procedural, 1)

    def test_sentence_split_ignores_abbreviation_and_code_dots(self):
        self.assertEqual(L.lint_text("Run `a.b`. Then stop the worker.\n").sentences, 2)

    def test_symlink_duplicates_are_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "A.md").write_text("Start the job.\n")
            (tmp / "B.md").symlink_to(tmp / "A.md")
            out = subprocess.run([sys.executable, str(HERE / "ste_lint.py"), "--json", str(tmp / "A.md"), str(tmp / "B.md")],
                                 capture_output=True, text=True)
            self.assertEqual(len(json.loads(out.stdout)["files"]), 1)


class Dictionary(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((HERE / "ste_dictionary.json").read_text(encoding="utf-8"))

    def test_sections_exist(self):
        for key in ("unapproved", "technical_names", "technical_verbs", "allowed_exceptions", "approved_words"):
            self.assertTrue(self.data[key], key)

    def test_every_unapproved_entry_has_alternatives_and_basis(self):
        for word, entry in self.data["unapproved"].items():
            self.assertTrue(entry["alternatives"], word)
            self.assertIn(entry["basis"], ("sheet", "ste", "project"), word)
            self.assertTrue(entry["note"], word)

    def test_alternatives_are_not_themselves_unapproved(self):
        for word, entry in self.data["unapproved"].items():
            for alt in entry["alternatives"]:
                if "(" in alt or "..." in alt:
                    continue
                res = L.lint_text(f"Use {alt}.\n")
                self.assertEqual([v.word for v in res.violations if v.rule == "STE-1"], [], f"{word} -> {alt}")

    def test_sheet_pairs_present(self):
        u = self.data["unapproved"]
        for word, alt in (("ensure", "make sure"), ("commence", "start"), ("prior to", "before"), ("replenish", "fill"),
                          ("utilize", "use"), ("approximately", "about"), ("in order to", "to"), ("close", "near")):
            self.assertIn(alt, u[word]["alternatives"], word)
            self.assertEqual(u[word]["basis"], "sheet", word)

    def test_technical_entries_have_definitions(self):
        for key in ("technical_names", "technical_verbs"):
            for cat, items in self.data[key].items():
                for term, definition in items.items():
                    self.assertTrue(definition.strip(), f"{cat}/{term}")


class CommandLine(unittest.TestCase):
    def run_cli(self, text, *args):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.md"
            p.write_text(text)
            return subprocess.run([sys.executable, str(HERE / "ste_lint.py"), *args, str(p)], capture_output=True, text=True)

    def test_strict_exit_code(self):
        self.assertEqual(self.run_cli("Utilize the tool.\n", "--strict").returncode, 1)
        self.assertEqual(self.run_cli("Use the tool.\n", "--strict").returncode, 0)

    def test_report_mode_exit_code_is_zero(self):
        self.assertEqual(self.run_cli("Utilize the tool.\n").returncode, 0)

    def test_advisory_does_not_fail_strict(self):
        out = self.run_cli("The valve was closed by the worker.\n", "--strict")
        self.assertEqual(out.returncode, 0)

    def test_json_output(self):
        out = self.run_cli("Utilize the tool.\n", "--json")
        data = json.loads(out.stdout)
        self.assertEqual(data["errors"], 1)
        self.assertEqual(data["files"][0]["violations"][0]["rule"], "STE-1")

    def test_summary_output(self):
        out = self.run_cli("Use the tool.\n", "--summary")
        self.assertIn("TOTAL errors=0", out.stdout)

    def test_front_matter_flag_sets_level(self):
        res = L.lint_text("---\nste: strict\n---\n\nUse the tool.\n")
        self.assertEqual(res.level, "strict")


if __name__ == "__main__":
    unittest.main()
