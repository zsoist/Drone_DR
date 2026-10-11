#!/usr/bin/env python3
"""Markdown-aware checker for ASD-STE100 Simplified Technical English (STE).

  python3 pipeline/ste_lint.py docs/RUNBOOKS.md             # report one file
  python3 pipeline/ste_lint.py --strict docs/RUNBOOKS.md    # exit 1 on any non-advisory violation
  python3 pipeline/ste_lint.py                              # lint every file in docs/.ste.json;
                                                            # exit 1 if a STRICT file fails
  python3 pipeline/ste_lint.py --summary                    # one line per file
  python3 pipeline/ste_lint.py --json docs/RUNBOOKS.md      # machine readable

Rules (the IDs map to the sections of the STE writing rules; see docs/STE_STYLE_GUIDE.md):
  STE-0   a block or heading that looks Spanish: the checker skips it, and STRICT files must have none
  STE-1   unapproved word, contraction, Latin abbreviation (dictionary: pipeline/ste_dictionary.json)
  STE-2   noun cluster of 4 or more words (ADVISORY, heuristic)
  STE-3a  -ing form outside a technical name
  STE-3b  perfect tense (has/have/had + past participle)
  STE-3c  passive voice (violation in procedures, ADVISORY in descriptive text)
  STE-4   two statements in one sentence: semicolon or spaced dash (ADVISORY)
  STE-5a  procedural sentence of more than 20 words
  STE-5b  more than one instruction in one procedural sentence
  STE-5c  condition after the instruction instead of first (ADVISORY)
  STE-6a  descriptive sentence of more than 25 words
  STE-6b  descriptive paragraph of more than 6 sentences
  STE-7   safety instruction format (WARNING / CAUTION)
  STE-8   symbol or form that STE does not use, for example "and/or", "~", ">=" (ADVISORY)

The checker has no third-party dependency. It does not use a POS tagger, so the checks that
need grammar (STE-2, STE-3c, "is this sentence an instruction?") are heuristics. See the
"Precision" section of docs/STE_STYLE_GUIDE.md.

Suppress a finding with an HTML comment before a block:
  <!-- ste-ignore STE-3c -->            next block only ("all" or no rule = every rule)
  <!-- ste-ignore-start STE-1 --> ... <!-- ste-ignore-end -->
Mark the mode of a section with <!-- ste:procedural --> or <!-- ste:descriptive --> after its heading.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DICT_PATH = HERE / "ste_dictionary.json"
DEFAULT_CONFIG = ROOT / "docs" / ".ste.json"

MAX_PROCEDURAL = 20
MAX_DESCRIPTIVE = 25
MAX_PARAGRAPH_SENTENCES = 6
MAX_NOUN_CLUSTER = 3

PH0 = 0xE000  # private-use code points stand for protected inline text (code, URLs)

RULES = {
    "STE-0": "text is not English (the checker skipped it)",
    "STE-1": "unapproved word",
    "STE-2": "noun cluster of more than 3 words",
    "STE-3a": "progressive or -ing form",
    "STE-3b": "perfect tense",
    "STE-3c": "passive voice",
    "STE-4": "two statements in one sentence",
    "STE-5a": "procedural sentence is too long",
    "STE-5b": "more than one instruction in a sentence",
    "STE-5c": "condition must come first",
    "STE-6a": "descriptive sentence is too long",
    "STE-6b": "paragraph has too many sentences",
    "STE-7": "safety instruction format",
    "STE-8": "punctuation or symbol",
}

# ---------------------------------------------------------------------------------------------
# Dictionary
# ---------------------------------------------------------------------------------------------


def _inflect(lemma: str, pos: str) -> set[str]:
    """Regular inflected forms of one dictionary word (over-generation is harmless)."""
    forms = {lemma}
    if pos not in ("v", "n"):
        return forms
    forms.add(lemma + "s")
    if lemma.endswith(("s", "x", "z", "ch", "sh")):
        forms.add(lemma + "es")
    if lemma.endswith("y") and len(lemma) > 2 and lemma[-2] not in "aeiou":
        forms.update({lemma[:-1] + "ies", lemma[:-1] + "ied"})
    if pos == "v":
        forms.update({lemma + "ed", lemma + "d", lemma + "ing"})
        if lemma.endswith("e"):
            forms.add(lemma[:-1] + "ing")
        if re.search(r"[^aeiou][aeiou][bdgmnprt]$", lemma):
            forms.update({lemma + lemma[-1] + "ed", lemma + lemma[-1] + "ing"})
    return forms


class Dictionary:
    def __init__(self, path: Path = DICT_PATH):
        data = json.loads(path.read_text(encoding="utf-8"))
        self.data = data
        self.unapproved_words: dict[str, tuple[str, dict]] = {}
        self.unapproved_phrases: list[tuple[tuple[str, ...], str, dict]] = []
        for lemma, entry in data["unapproved"].items():
            pos = entry.get("pos", "")
            words = lemma.split()
            if len(words) == 1:
                for form in _inflect(lemma, pos):
                    self.unapproved_words.setdefault(form, (lemma, entry))
            else:
                firsts = _inflect(words[0], "v") if pos == "v" else {words[0]}
                for first in firsts:
                    self.unapproved_phrases.append((tuple([first] + words[1:]), lemma, entry))
        self.unapproved_phrases.sort(key=lambda x: -len(x[0]))
        # technical names: single words and phrases
        self.name_words: set[str] = set()
        self.name_phrases: list[tuple[str, ...]] = []
        for names in data["technical_names"].values():
            for name in names:
                parts = tuple(p.lower() for p in name.split())
                if len(parts) == 1:
                    self.name_words.add(parts[0])
                    self.name_words.add(parts[0] + "s")
                else:
                    self.name_phrases.append(parts)
                    self.name_phrases.append(parts[:-1] + (parts[-1] + "s",))
        self.name_phrases.sort(key=lambda x: -len(x))
        # technical verbs: base forms and inflections
        self.tech_verb_forms: set[str] = set()
        tech_bases: set[str] = set()
        for verbs in data["technical_verbs"].values():
            for verb in verbs:
                first = verb.split()[0].lower()
                tech_bases.add(first)
                self.tech_verb_forms |= _inflect(first, "v")
        ex = data["allowed_exceptions"]
        self.ing_words = {w.lower() for w in ex["ing_words"]}
        self.participle_adjectives = {w.lower() for w in ex["participle_adjectives"]}
        self.allowed_words = {w.lower() for w in ex["words"]}
        self.ed_not_participle = {w.lower() for w in ex["ed_not_participle"]}
        self.irregular_participles = {w.lower() for w in ex["irregular_participles"]}
        self.homographs = {w.lower() for w in data["verb_noun_homographs"]}
        verbs = {w.lower() for w in data["imperative_verbs"]} | tech_bases
        verbs |= {lemma for lemma, e in data["unapproved"].items() if e.get("pos") == "v" and " " not in lemma}
        self.verbs = verbs


_DICT: Dictionary | None = None


def get_dictionary() -> Dictionary:
    global _DICT
    if _DICT is None:
        _DICT = Dictionary()
    return _DICT


# ---------------------------------------------------------------------------------------------
# Word lists for the heuristics (closed-class words are small and stable)
# ---------------------------------------------------------------------------------------------

BE_FORMS = {"is", "are", "was", "were", "be", "been", "being", "am"}
HAVE_FORMS = {"has", "have", "had"}
ADVERBS_BETWEEN = {"not", "also", "always", "never", "only", "then", "automatically", "still", "first", "already",
                   "usually", "just", "often", "later", "again", "now", "once", "all", "both", "ever", "even"}
DETERMINERS = {"the", "a", "an", "this", "that", "these", "those", "each", "every", "any", "all", "no", "some",
               "its", "their", "your", "our", "my", "his", "her", "one", "both", "either", "other", "another",
               "which", "what", "whose", "same", "such", "more", "most", "many", "much", "few", "several"}
PRONOUNS = {"it", "they", "you", "we", "he", "she", "i", "them", "us", "him", "me", "there", "here", "who",
            "whom", "itself", "themselves", "something", "nothing", "anything", "everything", "someone"}
FUNCTION_WORDS = {"of", "in", "on", "at", "by", "for", "from", "with", "without", "to", "into", "onto", "over",
                  "under", "above", "below", "between", "among", "through", "during", "before", "after", "until",
                  "since", "about", "against", "around", "near", "next", "up", "down", "out", "off", "per", "than",
                  "as", "like", "inside", "outside", "across", "along", "within", "toward", "towards", "behind",
                  "beyond", "because", "while", "if", "when", "where", "unless", "whether", "so", "then", "but",
                  "and", "or", "nor", "yet", "also", "how", "why", "not", "n't", "is", "are", "was", "were", "be",
                  "been", "being", "has", "have", "had", "do", "does", "did", "can", "will", "must", "may", "might",
                  "could", "would", "should", "shall", "cannot", "very", "too", "only", "just", "still", "even",
                  "already", "always", "never", "often", "now", "again", "first", "last", "later", "usually",
                  "neither", "am"}
LEAD_ADVERBS = {"then", "next", "first", "second", "third", "finally", "also", "now", "again", "always",
                "never", "only", "just", "later"}
STOP_FOR_CLUSTER = DETERMINERS | PRONOUNS | FUNCTION_WORDS
ABBREVIATIONS = {"e.g", "i.e", "etc", "vs", "approx", "cf"}
SPANISH_WORDS = {"el", "la", "los", "las", "de", "del", "que", "en", "por", "con", "para", "una", "un", "es", "se",
                 "sin", "sobre", "como", "más", "pero", "también", "cuando", "si", "ya", "al", "lo", "su", "sus",
                 "son", "está", "están", "hay", "entre", "desde", "hasta", "sólo", "solo", "esta", "este", "esto",
                 "nunca", "siempre", "después", "antes", "cada", "donde", "porque", "tras", "ni",
                 "puede", "debe", "deben", "usar", "todo", "toda", "todos", "todas", "ese", "esa"}
ENGLISH_WORDS = {"the", "of", "and", "to", "is", "in", "that", "for", "with", "are", "be", "this", "it", "as", "on",
                 "not", "or", "by", "from", "an", "if", "when", "do", "you", "can", "will", "must", "at",
                 "which", "after", "before", "then", "each", "all", "no", "has", "have", "was", "were", "use"}
INJURY_RE = re.compile(r"\b(injur\w*|death|die|dies|kill\w*|hurt\w*|harm\w*|bystanders?|people|persons?|pedestrians?|"
                       r"crowds?|fire|burns?|burned|burnt|shock|electrocut\w*|explo\w*|children|child|animals?|"
                       r"blind\w*)\b", re.I)
DAMAGE_RE = re.compile(r"\b(damag\w*|lose|lost|loss|corrupt\w*|delet\w*|overwrit\w*|destroy\w*|break|breaks|broken|"
                       r"data|downtime|crash\w*|fail\w*|wrong|waste\w*|bricked?)\b", re.I)
BAD_SAFETY_KEYWORDS = {"DANGER", "ATTENTION", "IMPORTANT", "WARN", "ALERT"}


# ---------------------------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------------------------


@dataclass
class Violation:
    rule: str
    line: int
    message: str
    text: str = ""
    advisory: bool = False
    suggestion: str = ""
    word: str = ""

    def as_dict(self) -> dict:
        return {"rule": self.rule, "line": self.line, "advisory": self.advisory, "message": self.message,
                "word": self.word, "suggestion": self.suggestion, "text": self.text}


@dataclass
class Tok:
    text: str            # core text without edge punctuation
    low: str
    kind: str            # w (word), tech (code, path, URL, acronym), num, name (technical name), punct
    nw: int = 1          # words counted
    pre: str = ""
    post: str = ""
    line: int = 0
    raw: str = ""


@dataclass
class Sentence:
    toks: list
    line: int
    raw: str
    role: str = "descriptive"   # procedural | descriptive


@dataclass
class Block:
    kind: str                       # heading, para, item, table, directive
    line: int
    text: str = ""
    level: int = 0
    ordered: bool = False
    in_list: bool = False
    rows: list = field(default_factory=list)
    directive: str = ""
    arg: str = ""


@dataclass
class FileResult:
    path: str
    level: str = "report"
    violations: list = field(default_factory=list)
    sentences: int = 0
    procedural: int = 0
    descriptive: int = 0
    skipped_non_english: int = 0
    words: int = 0

    @property
    def errors(self) -> list:
        return [v for v in self.violations if not v.advisory]

    @property
    def blocking(self) -> list:
        """Errors plus untranslated blocks (STE-0): what makes a STRICT file fail."""
        return [v for v in self.violations if not v.advisory or v.rule == "STE-0"]

    @property
    def advisories(self) -> list:
        return [v for v in self.violations if v.advisory]

    def counts(self) -> dict:
        out: dict[str, int] = {}
        for v in self.violations:
            key = v.rule + ("*" if v.advisory else "")
            out[key] = out.get(key, 0) + 1
        return dict(sorted(out.items()))

    def as_dict(self) -> dict:
        return {"path": self.path, "level": self.level, "errors": len(self.errors),
                "advisories": len(self.advisories), "sentences": self.sentences,
                "procedural": self.procedural, "descriptive": self.descriptive,
                "skipped_non_english": self.skipped_non_english, "words": self.words, "counts": self.counts(),
                "violations": [v.as_dict() for v in self.violations]}


# ---------------------------------------------------------------------------------------------
# Markdown parsing (line based; no third-party parser)
# ---------------------------------------------------------------------------------------------

FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
LIST_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
HR_RE = re.compile(r"^\s*([-*_]\s*){3,}$")
COMMENT_RE = re.compile(r"<!--(.*?)-->", re.S)
CHECKBOX_RE = re.compile(r"^\[[ xX]\]\s+")
DIRECTIVE_RE = re.compile(r"^(ste:(?:procedural|descriptive)|ste-ignore-start|ste-ignore-end|ste-ignore-file|ste-ignore)\b\s*(.*)$")


def _strip_front_matter(lines: list[str]) -> tuple[list[str], int, dict]:
    meta: dict[str, str] = {}
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                for ln in lines[1:i]:
                    if ":" in ln:
                        k, v = ln.split(":", 1)
                        meta[k.strip().lower()] = v.strip().strip("'\"")
                return lines[i + 1:], i + 1, meta
    return lines, 0, meta


def parse_markdown(text: str) -> tuple[list[Block], dict]:
    lines, offset, meta = _strip_front_matter(text.split("\n"))
    items: list[tuple[int, str]] = []
    for idx, ln in enumerate(lines):
        m = re.match(r"^\s*((?:>\s?)+)(.*)$", ln)
        items.append((idx + offset + 1, m.group(2) if m else ln))
    blocks: list[Block] = []
    para: list[tuple[int, str]] = []
    cur_item: dict | None = None
    blank_since_item = False

    def make(kind: str, lns: list[tuple[int, str]], ordered: bool, in_list: bool) -> Block:
        body = "\n".join(t for _, t in lns)
        if in_list:
            body = CHECKBOX_RE.sub("", body)
        return Block(kind, lns[0][0], text=body, ordered=ordered, in_list=in_list)

    def flush_para():
        nonlocal para
        if para:
            blocks.append(make("para", para, False, False))
            para = []

    def flush_item():
        nonlocal cur_item
        if cur_item:
            blocks.append(make("item", cur_item["lines"], cur_item["ordered"], True))
            cur_item = None

    def flush_all():
        flush_para()
        flush_item()

    i = 0
    n = len(items)
    in_fence = None
    while i < n:
        no, ln = items[i]
        fm = FENCE_RE.match(ln)
        if in_fence:
            if fm and fm.group(1)[0] == in_fence[0] and len(fm.group(1)) >= len(in_fence):
                in_fence = None
            i += 1
            continue
        if fm:
            flush_all()
            in_fence = fm.group(1)
            i += 1
            continue
        if ln.strip().startswith("<!--"):
            flush_all()
            chunk = ln
            j = i
            while "-->" not in chunk and j + 1 < n:
                j += 1
                chunk += "\n" + items[j][1]
            for cm in COMMENT_RE.finditer(chunk):
                dm = DIRECTIVE_RE.match(cm.group(1).strip())
                if dm:
                    blocks.append(Block("directive", no, directive=dm.group(1), arg=dm.group(2).strip()))
            i = j + 1
            continue
        if not ln.strip():
            flush_para()
            if cur_item:
                blank_since_item = True
            i += 1
            continue
        hm = HEADING_RE.match(ln)
        if hm:
            flush_all()
            blocks.append(Block("heading", no, text=hm.group(2), level=len(hm.group(1))))
            i += 1
            blank_since_item = False
            continue
        if HR_RE.match(ln):
            flush_all()
            i += 1
            continue
        if ln.lstrip().startswith("|") or ("|" in ln and i + 1 < n and TABLE_SEP_RE.match(items[i + 1][1])):
            flush_all()
            rows = []
            while i < n and items[i][1].strip() and "|" in items[i][1]:
                rno, rln = items[i]
                if not TABLE_SEP_RE.match(rln):
                    rows.append((rno, [c.strip() for c in re.split(r"(?<!\\)\|", rln.strip().strip("|"))]))
                i += 1
            blocks.append(Block("table", no, rows=rows))
            blank_since_item = False
            continue
        lm = LIST_RE.match(ln)
        if lm:
            flush_all()
            indent = len(lm.group(1).expandtabs(4))
            marker = lm.group(2)
            cur_item = {"lines": [(no, lm.group(3))], "ordered": marker[0].isdigit(), "indent": indent,
                        "content_indent": indent + len(marker) + 1}
            blank_since_item = False
            i += 1
            continue
        indent = len(ln) - len(ln.lstrip())
        if cur_item:
            if not blank_since_item:
                cur_item["lines"].append((no, ln.strip()))
                i += 1
                continue
            if indent >= cur_item["content_indent"]:
                ordered = cur_item["ordered"]
                flush_item()
                para = [(no, ln.strip())]
                i += 1
                while i < n and items[i][1].strip() and not LIST_RE.match(items[i][1]) \
                        and not FENCE_RE.match(items[i][1]) and not HEADING_RE.match(items[i][1]):
                    para.append((items[i][0], items[i][1].strip()))
                    i += 1
                blocks.append(make("item", para, ordered, True))
                para = []
                continue
            flush_item()
            blank_since_item = False
        para.append((no, ln.strip()))
        i += 1
    flush_all()
    return blocks, meta


# ---------------------------------------------------------------------------------------------
# Inline processing and tokenizing
# ---------------------------------------------------------------------------------------------

PROTECT_RE = re.compile(r"(`+)(.+?)\1|<https?://[^>\s]+>|https?://[^\s)>\]]+|\bwww\.[^\s)>\]]+", re.S)
IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
REFLINK_RE = re.compile(r"\[([^\]]*)\]\[[^\]]*\]")
HTML_TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")
LEAD_PUNCT = "([{\"'“‘<*_"
TRAIL_PUNCT = ")]}\"'”’.,;:!?>*_…"
NUM_RE = re.compile(r"^[±<>≥≤~≈+\-−–]?\d")
TECH_CHARS_RE = re.compile(r"[/\\_=@]|::|→|->|←|^-{1,2}[A-Za-z]|^[$~.#]|\w\.\w|\w:\d")
CAMEL_RE = re.compile(r"[a-z][A-Z]|^[A-Z][a-z]+[A-Z]")


def protect_inline(text: str) -> tuple[str, list[str]]:
    protected: list[str] = []

    def sub(m: re.Match) -> str:
        protected.append(m.group(0))
        return chr(PH0 + len(protected) - 1)

    text = PROTECT_RE.sub(sub, text)
    text = IMG_RE.sub(" ", text)
    text = LINK_RE.sub(r"\1", text)
    text = REFLINK_RE.sub(r"\1", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = re.sub(r"(\*\*|__|~~)", "", text)
    text = re.sub(r"(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)", "", text)
    return text, protected


def _is_ph(c: str) -> bool:
    return PH0 <= ord(c) < PH0 + 6000


def restore_inline(text: str, protected: list[str]) -> str:
    return "".join(protected[ord(c) - PH0] if _is_ph(c) and ord(c) - PH0 < len(protected) else c for c in text)


def tokenize(text: str, first_line: int) -> list[Tok]:
    clean, protected = protect_inline(text)
    toks: list[Tok] = []
    for m in re.finditer(r"\S+", clean):
        chunk = m.group(0)
        line = first_line + clean.count("\n", 0, m.start())
        raw = restore_inline(chunk, protected)
        pre = ""
        post = ""
        core = chunk
        while core and core[0] in LEAD_PUNCT:
            pre += core[0]
            core = core[1:]
        while core and core[-1] in TRAIL_PUNCT:
            post = core[-1] + post
            core = core[:-1]
        has_ph = any(_is_ph(c) for c in core)
        if not core or (not has_ph and not re.search(r"[A-Za-z0-9]", core)):
            toks.append(Tok(core or chunk, core or chunk, "punct", 0, pre, post, line, raw))
            continue
        if has_ph:
            toks.append(Tok(core, core, "tech", 1, pre, post, line, raw))
            continue
        low = core.lower()
        if low in ABBREVIATIONS:
            toks.append(Tok(core, low + ".", "w", 1, pre, post, line, raw))
        elif NUM_RE.match(core):
            toks.append(Tok(core, low, "num", 1, pre, post, line, raw))
        elif TECH_CHARS_RE.search(core) or CAMEL_RE.search(core):
            toks.append(Tok(core, low, "tech", 1, pre, post, line, raw))
        else:
            letters = re.sub(r"[^A-Za-z]", "", core)
            if len(letters) >= 2 and letters.isupper():
                toks.append(Tok(core, low, "tech", 1, pre, post, line, raw))
            else:
                toks.append(Tok(core, low, "w", 1, pre, post, line, raw))
    return toks


def split_sentences(toks: list[Tok]) -> list[list[Tok]]:
    out: list[list[Tok]] = []
    cur: list[Tok] = []
    for i, t in enumerate(toks):
        cur.append(t)
        ends = bool(re.search(r"[.!?]", t.post)) and "…" not in t.post
        if t.kind == "w" and t.low in ("e.g.", "i.e.", "vs.", "approx.", "cf."):
            ends = False
        if ends:
            nxt = toks[i + 1] if i + 1 < len(toks) else None
            if nxt is None or nxt.kind in ("tech", "num") or nxt.text[:1].isupper() or nxt.pre.startswith(("(", "<")):
                out.append(cur)
                cur = []
    if cur:
        out.append(cur)
    return [s for s in out if any(t.kind != "punct" for t in s)]


def merge_names(toks: list[Tok], d: Dictionary) -> list[Tok]:
    """Merge technical names into one `name` token (case-insensitive phrase match)."""
    out: list[Tok] = []
    i = 0
    n = len(toks)
    while i < n:
        t = toks[i]
        if t.kind == "w":
            matched = False
            for phrase in d.name_phrases:
                k = len(phrase)
                if i + k <= n and all(toks[i + j].kind == "w" and toks[i + j].low == phrase[j] for j in range(k)):
                    last = toks[i + k - 1]
                    out.append(Tok(" ".join(x.text for x in toks[i:i + k]), " ".join(phrase), "name", k,
                                   t.pre, last.post, t.line, " ".join(x.raw for x in toks[i:i + k])))
                    i += k
                    matched = True
                    break
            if matched:
                continue
            if t.low in d.name_words:
                out.append(Tok(t.text, t.low, "name", 1, t.pre, t.post, t.line, t.raw))
                i += 1
                continue
        out.append(t)
        i += 1
    return out


def looks_non_english(text: str) -> bool:
    words = re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]+", text.lower())
    if len(words) < 5:
        return False
    es = sum(1 for w in words if w in SPANISH_WORDS and w not in ENGLISH_WORDS)
    en = sum(1 for w in words if w in ENGLISH_WORDS)
    accents = len(re.findall(r"[áéíóúñ¿¡]", text.lower()))
    return (es >= 2 and es > en) or (accents >= 2 and es >= 1 and es >= en)


def heading_looks_non_english(toks: list[Tok]) -> bool:
    plain = [t for t in toks if t.kind == "w"]
    if any(re.search(r"[áéíóúñ¿¡]", t.text.lower()) for t in plain):
        return True
    return sum(1 for t in plain if t.low in SPANISH_WORDS and t.low not in ENGLISH_WORDS
               and t.low not in ("solo", "no", "a", "si", "o")) >= 1


# ---------------------------------------------------------------------------------------------
# Grammar helpers
# ---------------------------------------------------------------------------------------------

MODALS = {"can", "will", "must", "does", "did", "may", "might", "could", "would", "should", "shall", "cannot"}
IMPERATIVE_NEXT_OK = {"to", "for", "from", "with", "in", "on", "at", "by", "that", "if", "whether", "only", "first",
                      "also", "again", "always", "never", "both", "all", "up", "down", "out", "off", "over",
                      "through", "into", "after", "before", "until", "when", "how", "which", "what", "every"}
COND_START = {"if", "when", "before", "after", "unless", "until", "while", "once", "as", "because", "since", "for",
              "on", "in", "at", "with", "without", "during", "to"}


def is_participle(low: str, d: Dictionary) -> bool:
    if low in d.irregular_participles:
        return True
    return low.endswith("ed") and len(low) > 3 and low not in d.ed_not_participle


def _is_imperative_at(toks: list[Tok], i: int, d: Dictionary) -> bool:
    """Does an imperative (base verb) start at toks[i]?"""
    if i >= len(toks):
        return False
    t = toks[i]
    if t.kind != "w":
        return False
    low = t.low
    nxt = toks[i + 1] if i + 1 < len(toks) else None
    if low == "do" and nxt is not None and nxt.low in ("not", "n't"):
        return True
    if low in ("never", "always", "only") and nxt is not None and nxt.kind == "w" and nxt.low in d.verbs:
        return True
    if low == "make" and nxt is not None and nxt.low in ("sure", "certain"):
        return True
    if low not in d.verbs:
        return False
    if nxt is None:
        return True
    if t.post and t.post[0] in ",;:" and low in d.homographs:
        return False
    nl = nxt.low
    if nxt.kind == "w" and (nl in BE_FORMS or nl in HAVE_FORMS or nl in MODALS):
        return False                      # "Run is ..." is not an instruction
    if nxt.kind == "w" and nl in ("and", "or", "but"):
        return low not in d.homographs    # "Stop and start" is an instruction; "Test and ..." is not sure
    if low in d.homographs:
        if nxt.kind in ("tech", "num", "name"):
            return True
        return nxt.kind == "w" and (nl in DETERMINERS or nl in PRONOUNS or nl in IMPERATIVE_NEXT_OK)
    return True


def imperative_start_index(toks: list[Tok], d: Dictionary) -> int:
    """Index (in toks) of the first token of the main instruction, or -1."""
    work = [(i, t) for i, t in enumerate(toks) if t.kind != "punct"]
    only = [t for _, t in work]
    if not only:
        return -1
    k = 0
    while k < len(only) - 1 and only[k].kind == "w" and only[k].low in LEAD_ADVERBS:
        k += 1
    if _is_imperative_at(only, k, d):
        return work[k][0]
    if only[k].kind == "w" and only[k].low in COND_START:
        for j in range(k, len(only) - 1):
            if "," in only[j].post:
                m = j + 1
                while m < len(only) - 1 and only[m].kind == "w" and only[m].low in LEAD_ADVERBS:
                    m += 1
                if _is_imperative_at(only, m, d):
                    return work[m][0]
                break
    return -1


def starts_imperative(toks: list[Tok], d: Dictionary) -> bool:
    return imperative_start_index(toks, d) >= 0


# ---------------------------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------------------------

CONTRACTION_RE = re.compile(r"(n't|'re|'ve|'ll|'d|'m)$|^(it|that|there|here|what|let|he|she|who)'s$", re.I)
ADJ_PREV = BE_FORMS | {"very", "too", "so", "quite", "more", "most", "a", "an", "the", "this", "that", "any", "its",
                       "their", "not", "extremely", "fairly", "pretty", "less", "least", "how", "as"}
CONJ_NEXT = {"the", "it", "they", "you", "we", "he", "she", "this", "that", "these", "those", "its", "their",
             "your", "our", "there", "all", "no"}


def _word_entry_hit(tok: Tok, prev: Tok | None, nxt: Tok | None, d: Dictionary):
    """Return (lemma, entry) when `tok` is an unapproved single word in this context."""
    low = tok.low
    cands = [low] + ([low[:-2]] if low.endswith("'s") else [])
    for c in cands:
        hit = d.unapproved_words.get(c)
        if not hit:
            continue
        lemma, entry = hit
        if c in d.allowed_words or (c in d.tech_verb_forms and entry.get("pos") in ("v", "n")):
            continue
        only_as = entry.get("only_as")
        if only_as == "adj":
            if not (prev is not None and prev.low in ADJ_PREV):
                continue
        elif only_as == "conj":
            if not (nxt is not None and nxt.low in CONJ_NEXT):
                continue
        return lemma, entry
    return None


def _unapproved_violation(word: str, lemma: str, entry: dict, line: int, text: str) -> Violation:
    alts = " / ".join(entry["alternatives"])
    return Violation("STE-1", line, f"unapproved word '{word}'. Use: {alts}. {entry.get('note', '')}".strip(),
                     text, False, alts, word)


def check_words(toks: list[Tok], d: Dictionary, text_of) -> list[Violation]:
    """STE-1: unapproved words, phrases, contractions, Latin abbreviations. Used for all text."""
    out: list[Violation] = []
    n = len(toks)
    consumed: set[int] = set()
    for i in range(n):
        if i in consumed or toks[i].kind != "w":
            continue
        for phrase, lemma, entry in d.unapproved_phrases:
            k = len(phrase)
            if i + k <= n and all(toks[i + j].kind == "w" and toks[i + j].low == phrase[j] for j in range(k)):
                out.append(_unapproved_violation(" ".join(t.text for t in toks[i:i + k]), lemma, entry,
                                                 toks[i].line, text_of(toks[i])))
                consumed.update(range(i, i + k))
                break
    for i, t in enumerate(toks):
        if i in consumed or t.kind != "w":
            continue
        if CONTRACTION_RE.search(t.text):
            out.append(Violation("STE-1", t.line, f"contraction '{t.text}': write both words (for example 'do not')",
                                 text_of(t), False, "write the full words", t.text))
            continue
        prev = toks[i - 1] if i > 0 else None
        nxt = toks[i + 1] if i + 1 < n else None
        hit = _word_entry_hit(t, prev, nxt, d)
        if hit is None and "-" in t.low:
            for part in t.low.split("-"):
                if len(part) > 3:
                    hit = _word_entry_hit(Tok(part, part, "w", 1, "", "", t.line, t.raw), None, None, d)
                    if hit:
                        break
        if hit:
            out.append(_unapproved_violation(t.text, hit[0], hit[1], t.line, text_of(t)))
    return out


def _cluster_member(t: Tok, d: Dictionary) -> bool:
    if t.kind in ("name", "tech"):
        return True
    if t.kind != "w":
        return False
    low = t.low
    if low in STOP_FOR_CLUSTER or low.endswith("ly") or low.endswith("'s"):
        return False
    if low in d.verbs and low not in d.homographs:
        return False
    for cut in (1, 2):
        stem = low[:-cut]
        if low.endswith("s") and stem in d.verbs and stem not in d.homographs:
            return False
    hit = d.unapproved_words.get(low)
    if hit and hit[1].get("pos") in ("v", "modal", "adv"):
        return False
    return True


def check_noun_clusters(toks: list[Tok], d: Dictionary, text: str) -> list[Violation]:
    out: list[Violation] = []
    run: list[Tok] = []

    def close_run():
        nonlocal run
        if len(run) > MAX_NOUN_CLUSTER:
            words = " ".join(t.raw.strip("*_()[],.;:") for t in run)
            out.append(Violation("STE-2", run[0].line,
                                 f"noun cluster of {len(run)} words '{words}': rewrite with 'of' or 'for', or use a hyphen",
                                 text, True, "", words))
        run = []

    for t in toks:
        if t.kind == "punct":
            close_run()
            continue
        if t.pre.startswith(("(", "[")):
            close_run()
        if _cluster_member(t, d):
            run.append(t)
            if t.post:
                close_run()
        else:
            close_run()
    close_run()
    return out


def check_sentence(sent: Sentence, d: Dictionary) -> list[Violation]:
    out: list[Violation] = []
    toks = sent.toks
    procedural = sent.role == "procedural"
    words = [t for t in toks if t.kind != "punct"]
    count = sum(max(t.nw, 1) for t in words)
    text = sent.raw if len(sent.raw) < 160 else sent.raw[:157] + "..."
    line = sent.line

    # STE-5a / STE-6a: length
    if procedural and count > MAX_PROCEDURAL:
        out.append(Violation("STE-5a", line, f"procedural sentence has {count} words (maximum {MAX_PROCEDURAL})", text))
    if not procedural and count > MAX_DESCRIPTIVE:
        out.append(Violation("STE-6a", line, f"descriptive sentence has {count} words (maximum {MAX_DESCRIPTIVE})", text))

    # STE-3: verb forms
    wl = [t for t in toks if t.kind in ("w", "name", "tech", "num")]
    for i, t in enumerate(wl):
        if t.kind != "w":
            continue
        low = t.low
        if low.endswith("ing") and len(low) >= 5 and "-" not in low and low not in d.ing_words \
                and low not in d.allowed_words:
            out.append(Violation("STE-3a", t.line,
                                 f"'-ing' form '{t.text}': use the simple present, the imperative or a noun",
                                 text, False, "", t.text))
        if low in HAVE_FORMS or low in BE_FORMS:
            j = i + 1
            while j < len(wl) and wl[j].kind == "w" and wl[j].low in ADVERBS_BETWEEN and j - i <= 2:
                j += 1
            if not (j < len(wl) and wl[j].kind == "w" and is_participle(wl[j].low, d)):
                continue
            part = wl[j]
            pair = f"{t.text} {part.text}"
            if low in HAVE_FORMS:
                out.append(Violation("STE-3b", t.line,
                                     f"perfect tense '{pair}': use the simple past or the simple present",
                                     text, False, "", pair))
                continue
            has_agent = any(x.low == "by" for x in wl[j + 1:j + 4] if x.kind == "w")
            if part.low in d.participle_adjectives and not has_agent and low in ("is", "are", "was", "were", "am"):
                continue
            out.append(Violation("STE-3c", t.line,
                                 f"passive voice '{pair}': " + ("write an active instruction" if procedural
                                                                else "use the active voice if you can"),
                                 text, not procedural, "", pair))

    # STE-5b / STE-5c: procedural structure
    if procedural:
        start = imperative_start_index(toks, d)
        low_text = " ".join(t.low for t in toks)
        if start >= 0 and "at the same time" not in low_text and "simultaneous" not in low_text:
            for i in range(start + 1, len(toks)):
                t = toks[i]
                if t.kind != "w":
                    continue
                prev = toks[i - 1]
                if t.low in ("and", "then"):
                    j = i + 1
                elif prev.post and prev.post[-1] in ",;":
                    j = i
                else:
                    continue
                while j < len(toks) and toks[j].kind == "w" and toks[j].low in ("then", "also", "next", "again"):
                    j += 1
                if j < len(toks) and _is_imperative_at(toks, j, d):
                    out.append(Violation("STE-5b", toks[j].line,
                                         f"second instruction '{toks[j].text}' in the same sentence: use one sentence for each instruction",
                                         text, False, "", toks[j].text))
                    break
            for i in range(start + 1, len(toks)):
                if start == 0 and toks[i].kind == "w" and toks[i].low in ("if", "unless"):
                    out.append(Violation("STE-5c", toks[i].line, "write the condition first: 'If ..., do ...'", text, True))
                    break

    # STE-4 / STE-8: advisory punctuation
    for t in toks:
        if ";" in t.post:
            out.append(Violation("STE-4", t.line, "semicolon: write one sentence for each statement", text, True))
            break
    for i, t in enumerate(toks):
        if t.kind == "punct" and t.text in ("—", "–", "--", "-") and 0 < i < len(toks) - 1:
            out.append(Violation("STE-4", t.line, "dash joins two statements: use two sentences", text, True))
            break
    for t in toks:
        if t.kind == "w" and t.low == "and/or":
            out.append(Violation("STE-8", t.line, "'and/or' is not clear: use 'and' or 'or'", text, True))
        elif t.kind == "punct" and re.fullmatch(r"[~≈≥≤→←&×<>=]+", t.text):
            out.append(Violation("STE-8", t.line, f"symbol '{t.text}': write it with words", text, True))
            break
        elif t.kind == "num" and re.match(r"^[~≈≥≤]", t.text):
            out.append(Violation("STE-8", t.line, f"symbol in '{t.text}': write 'about', 'at least' or 'at most'",
                                 text, True))
            break

    out.extend(check_noun_clusters(toks, d, text))
    return out


# ---------------------------------------------------------------------------------------------
# Safety instructions (STE-7)
# ---------------------------------------------------------------------------------------------

SAFETY_RE = re.compile(r"^\s*[*_]*\s*(warning|caution|danger|attention|important|note|warn|alert)\b\s*[*_]*\s*(:?)\s*[*_]*\s*(.*)$",
                       re.I | re.S)


def parse_safety(text: str):
    """Return (keyword as written, has colon, body) when the block is a safety or note line."""
    flat = text.replace("\n", " ")
    m = SAFETY_RE.match(flat)
    if not m:
        return None
    word, colon, body = m.group(1), m.group(2), m.group(3)
    stripped = flat.strip()
    if not (colon or word.isupper() or stripped.startswith(("**", "__"))):
        return None            # an ordinary sentence that starts with "Note" or "Warning"
    return word, colon, body


def check_safety(block: Block, ps) -> list[Violation]:
    word, colon, body = ps
    upper = word.upper()
    snippet = block.text.replace("\n", " ")[:120]
    out: list[Violation] = []
    if upper in BAD_SAFETY_KEYWORDS:
        return [Violation("STE-7", block.line,
                          f"'{word}' is not an STE safety keyword: use WARNING (injury or death) or CAUTION (damage to equipment or data)",
                          snippet)]
    if word != upper:
        out.append(Violation("STE-7", block.line, f"write the safety keyword in capital letters: {upper}:", snippet))
    if not colon:
        out.append(Violation("STE-7", block.line, f"put a colon after {upper}", snippet))
    if upper in ("WARNING", "CAUTION"):
        injury = bool(INJURY_RE.search(body))
        damage = bool(DAMAGE_RE.search(body))
        if upper == "CAUTION" and injury:
            out.append(Violation("STE-7", block.line, "risk of injury or death: use WARNING, not CAUTION", snippet))
        elif upper == "WARNING" and damage and not injury:
            out.append(Violation("STE-7", block.line,
                                 "risk of damage to equipment or data only: use CAUTION, not WARNING", snippet))
    return out


# ---------------------------------------------------------------------------------------------
# File linting
# ---------------------------------------------------------------------------------------------


def _rules_from_arg(arg: str) -> set[str]:
    arg = arg.strip()
    if not arg or arg.lower() == "all":
        return {"*"}
    return {r.strip() for r in re.split(r"[,\s]+", arg) if r.strip()}


def _mode_for_heading(text: str, cfg: dict) -> str | None:
    for pat in cfg.get("procedural_sections", []):
        if re.search(pat, text, re.I):
            return "procedural"
    for pat in cfg.get("descriptive_sections", []):
        if re.search(pat, text, re.I):
            return "descriptive"
    return None


def _snip(s: str) -> str:
    return s if len(s) < 160 else s[:157] + "..."


def lint_text(text: str, cfg: dict | None = None, path: str = "<text>", lang_skip: bool = True) -> FileResult:
    cfg = cfg or {}
    d = get_dictionary()
    result = FileResult(path=path, level=cfg.get("level", "report"))
    blocks, meta = parse_markdown(text)
    if meta.get("ste") in ("strict", "report"):
        result.level = meta["ste"]
    file_ignore = set(cfg.get("ignore_rules", []))
    default_mode = "procedural" if cfg.get("mode") == "procedural" else "descriptive"
    stack: list[list] = []       # [heading level, mode or None]
    pending_ignore: set[str] = set()
    range_ignore: set[str] = set()
    found: list[Violation] = []

    def current_mode() -> str:
        for _, m in reversed(stack):
            if m:
                return m
        return default_mode

    for b in blocks:
        if b.kind == "directive":
            if b.directive in ("ste:procedural", "ste:descriptive"):
                if not stack:
                    stack.append([0, None])
                stack[-1][1] = b.directive.split(":")[1]
            elif b.directive == "ste-ignore":
                pending_ignore = _rules_from_arg(b.arg)
            elif b.directive == "ste-ignore-start":
                range_ignore = _rules_from_arg(b.arg)
            elif b.directive == "ste-ignore-end":
                range_ignore = set()
            elif b.directive == "ste-ignore-file":
                file_ignore |= _rules_from_arg(b.arg)
            continue
        block_v: list[Violation] = []
        if b.kind == "heading":
            while stack and stack[-1][0] >= b.level:
                stack.pop()
            stack.append([b.level, _mode_for_heading(b.text, cfg)])
            toks = merge_names(tokenize(b.text, b.line), d)
            block_v += check_words(toks, d, lambda t, s=b.text: s)
            if lang_skip and heading_looks_non_english(toks):
                block_v.append(Violation("STE-0", b.line, "this heading is not English: translate it to STE",
                                         b.text, True))
        elif b.kind == "table":
            for rno, cells in b.rows:
                for cell in cells:
                    if lang_skip and looks_non_english(cell):
                        continue
                    toks = merge_names(tokenize(cell, rno), d)
                    block_v += check_words(toks, d, lambda t, s=cell: s)
        else:
            clean, _ = protect_inline(b.text)
            if lang_skip and looks_non_english(re.sub(r"[\ue000-\uf8ff]", " ", clean)):
                result.skipped_non_english += 1
                found.append(Violation("STE-0", b.line, "this block is not English: translate it to STE",
                                       _snip(b.text.replace("\n", " ")), True))
                continue
            toks = merge_names(tokenize(b.text, b.line), d)
            ps = parse_safety(b.text)
            keyword = ""
            if ps:
                block_v += check_safety(b, ps)
                keyword = ps[0].upper()
                while toks and (toks[0].low == keyword.lower() or toks[0].kind == "punct"):
                    toks = toks[1:]
            mode = current_mode()
            sents: list[Sentence] = []
            for si, st in enumerate(split_sentences(toks)):
                if not any(t.kind in ("w", "name") for t in st):
                    continue
                s = Sentence(st, st[0].line, " ".join(t.raw for t in st))
                if starts_imperative(st, d):
                    s.role = "procedural"
                elif ps and si == 0 and keyword in ("WARNING", "CAUTION"):
                    s.role = "procedural"
                elif b.in_list and mode == "procedural" and si == 0:
                    s.role = "procedural"
                sents.append(s)
            if ps and keyword in ("WARNING", "CAUTION") and sents:
                if not starts_imperative(sents[0].toks, d):
                    block_v.append(Violation("STE-7", b.line,
                                             f"{keyword} must start with a clear command (for example 'Do not ...')",
                                             _snip(sents[0].raw)))
                if len(sents) == 1:
                    block_v.append(Violation("STE-7", b.line, "give the risk after the command (one more sentence)",
                                             _snip(sents[0].raw), True))
            for s in sents:
                result.sentences += 1
                result.words += sum(max(t.nw, 1) for t in s.toks if t.kind != "punct")
                if s.role == "procedural":
                    result.procedural += 1
                else:
                    result.descriptive += 1
                block_v += check_words(s.toks, d, lambda t, s=s: _snip(s.raw))
                block_v += check_sentence(s, d)
            if b.kind == "para" and not ps and len(sents) > MAX_PARAGRAPH_SENTENCES:
                block_v.append(Violation("STE-6b", b.line,
                                         f"paragraph has {len(sents)} sentences (maximum {MAX_PARAGRAPH_SENTENCES})",
                                         _snip(sents[0].raw)))
        ignore = pending_ignore | range_ignore | file_ignore
        pending_ignore = set()
        found += [v for v in block_v if "*" not in ignore and v.rule not in ignore]
    seen = set()
    for v in found:
        key = (v.rule, v.line, v.word, v.message)
        if key not in seen:
            seen.add(key)
            result.violations.append(v)
    result.violations.sort(key=lambda v: (v.line, v.rule))
    return result


# ---------------------------------------------------------------------------------------------
# Config and CLI
# ---------------------------------------------------------------------------------------------


def load_config(path: Path | None) -> dict:
    if path and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def file_config(config: dict, rel: str) -> dict:
    cfg = dict(config.get("defaults", {}))
    cfg.update(config.get("files", {}).get(rel, {}))
    return cfg


def config_files(config: dict) -> list[str]:
    files = list(config.get("files", {}))
    for pat in config.get("include", []):
        for p in sorted(ROOT.glob(pat)):
            rel = p.relative_to(ROOT).as_posix()
            if any(fnmatch.fnmatch(rel, ex) for ex in config.get("exclude", [])):
                continue
            if rel not in files:
                files.append(rel)
    out: list[str] = []
    seen: set[Path] = set()
    for rel in files:
        real = (ROOT / rel).resolve()
        if real in seen:      # a symlink to a file that is already in the list (AGENTS.md -> CLAUDE.md)
            continue
        seen.add(real)
        out.append(rel)
    return out


def lint_file(path: Path, config: dict, force_level: str | None = None, lang_skip: bool = True) -> FileResult:
    try:
        rel = path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        rel = str(path)
    res = lint_text(path.read_text(encoding="utf-8"), file_config(config, rel), rel, lang_skip)
    if force_level:
        res.level = force_level
    return res


def print_human(results: list[FileResult], show_advisory: bool) -> None:
    for r in results:
        print(f"{r.path}  [{r.level}]  errors={len(r.errors)} advisory={len(r.advisories)} "
              f"sentences={r.sentences} (procedural {r.procedural}, descriptive {r.descriptive}) "
              f"non-English blocks skipped={r.skipped_non_english}")
        for v in r.violations:
            if v.advisory and not show_advisory:
                continue
            print(f"  {r.path}:{v.line}: {v.rule} {'advisory' if v.advisory else 'error'}: {v.message}")
            if v.text:
                print(f"      > {v.text}")


def print_summary(results: list[FileResult]) -> None:
    width = max([len(r.path) for r in results] + [10])
    print(f"{'file'.ljust(width)}  level   errors  advisory  words  skipped  by rule (* = advisory)")
    for r in results:
        print(f"{r.path.ljust(width)}  {r.level:<6}  {len(r.errors):>6}  {len(r.advisories):>8}  {r.words:>5}  "
              f"{r.skipped_non_english:>7}  {r.counts()}")
    print(f"TOTAL errors={sum(len(r.errors) for r in results)} advisory={sum(len(r.advisories) for r in results)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="STE (ASD-STE100) checker for Markdown files")
    ap.add_argument("paths", nargs="*", help="Markdown files. With none, lint every file in the config.")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--strict", action="store_true",
                    help="exit 1 on any non-advisory violation (every file you name is treated as strict)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--summary", action="store_true", help="one line per file")
    ap.add_argument("--no-advisory", action="store_true", help="hide advisory findings")
    ap.add_argument("--no-lang-skip", action="store_true", help="also lint blocks that look Spanish")
    ap.add_argument("--rules", help="comma list of rule IDs to show, for example STE-1,STE-3a")
    args = ap.parse_args(argv)

    config = load_config(args.config)
    from_config = not args.paths
    if from_config:
        paths = [ROOT / p for p in config_files(config)]
        if not paths:
            print("no files: give paths or a config", file=sys.stderr)
            return 2
    else:
        paths = [Path(p) for p in args.paths]
    results = []
    seen_real: set[Path] = set()
    for p in paths:
        if not p.exists():
            print(f"missing file: {p}", file=sys.stderr)
            return 2
        if p.resolve() in seen_real:
            continue
        seen_real.add(p.resolve())
        results.append(lint_file(p, config, "strict" if args.strict and not from_config else None,
                                 not args.no_lang_skip))
    if args.rules:
        wanted = {r.strip() for r in args.rules.split(",")}
        for r in results:
            r.violations = [v for v in r.violations if v.rule in wanted]
    if args.json:
        print(json.dumps({"files": [r.as_dict() for r in results],
                          "errors": sum(len(r.errors) for r in results),
                          "advisories": sum(len(r.advisories) for r in results)}, indent=1, ensure_ascii=False))
    elif args.summary:
        print_summary(results)
    else:
        print_human(results, not args.no_advisory)
    if args.strict or from_config:
        failing = [r for r in results if r.level == "strict" and r.blocking]
        if failing:
            if not args.json:
                print("STE STRICT FAIL: " + ", ".join(f"{r.path} ({len(r.blocking)})" for r in failing),
                      file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
