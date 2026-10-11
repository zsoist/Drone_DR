# AeroBrain STE style guide

This guide tells you how to write English technical documents for AeroBrain in Simplified Technical English (STE). The guide uses STE itself. Each rule here follows the rule it states.

The guide has a checker: `python3 pipeline/ste_lint.py <file>`. The dictionary of the project is in `pipeline/ste_dictionary.json`. The tables of the dictionary in this guide come from that file.

## 1. What STE is

STE is a controlled language. It has a small set of rules and a small dictionary. The goal is one meaning for each word and one way to say each thing. A reader who does not speak English well can then understand the text. A program can also check it.

The history is short:

- 1979: AECMA, the European association of aerospace industries, starts work on a simple English for maintenance manuals.
- 1986: AECMA publishes the first guide, "AECMA Simplified English". Some sources give 1985.
- 2004 and 2005: AECMA joins ASD, the AeroSpace and Defence Industries Association of Europe. The standard gets the name ASD-STE100.
- Today: the STEMG (the STE maintenance group) keeps the standard. Issue 9 came out in January 2025.

ASD-STE100 has two parts. Part 1 has the rules, in nine sections. Part 2 has the dictionary of about 900 approved words. The owner of the standard publishes both parts at asd-ste100.org.

This project does not copy the official dictionary. It keeps its own **project dictionary** (section 8). The project dictionary lists the words that the project forbids, the words to use instead, and the technical names and verbs of AeroBrain. If you have a doubt, use the official ASD-STE100 dictionary to decide.

## 2. Which documents follow STE

| Document type | Rule |
|---|---|
| All documents in `docs/` (top level and `docs/qa/`), the root `README.md`, `SPEC.md`, `ROADMAP.md`, `CLAUDE.md`, `pipeline/README.md` | STRICT. The checker must find 0 errors. |
| `docs/archive/` and `docs/superpowers/` | Historical. They are REPORT-ONLY. The freshness rules in `docs/README.md` say that historical files stay as they are. |
| User interface text | Out of scope. It is in Spanish. |
| Code comments and commit messages | Out of scope. |

`AGENTS.md` is a link to `CLAUDE.md`. Codex and Claude Code read the same file.

The file `docs/.ste.json` sets the level of each file: `strict` or `report`. A file can also set `ste: strict` in its front matter.

### Procedural and descriptive text

STE uses different limits for two kinds of text.

- **Procedural text** tells the reader to do something. It is a step, a command or a safety instruction. A procedural sentence has at most 20 words.
- **Descriptive text** tells the reader how something works or why. A descriptive sentence has at most 25 words.

These documents are mostly procedural: `docs/RUNBOOKS.md`, `docs/CAPTURE_PROTOCOL.md` and the step lists in `CLAUDE.md`. These documents are mostly descriptive: `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `docs/AUTH_SECURITY.md` and the specifications.

The checker finds the kind of each sentence. A sentence is procedural if it starts with an imperative verb. The first sentence of a list item is also procedural when the section has the comment `<!-- ste:procedural -->` after its heading. Write `<!-- ste:descriptive -->` to go back.

## 3. The rules

### Numeric limits

| Rule | Limit | Checker rule |
|---|---|---|
| Words in a procedural sentence | 20 at most | `STE-5a` |
| Words in a descriptive sentence | 25 at most | `STE-6a` |
| Sentences in a paragraph | 6 at most | `STE-6b` |
| Words in a noun cluster | 3 at most | `STE-2` (advisory) |
| Instructions in a procedural sentence | 1 (two only for actions at the same time) | `STE-5b` |
| Topics in a paragraph | 1 | review by a person |

A technical name, a code span, a path and a number each count as one word. A hyphenated word counts as one word.

### Section 1: words

- Use only approved words. Use each word for one meaning and one part of speech. Section 8 lists the words that the project forbids.
- Use the same word for the same thing. Do not use `job` in one place and `task` in another place for the same object.
- Use technical names and technical verbs as they appear in section 8. A technical name keeps its form. Do not change `splat` to `gaussian blob`.
- Do not omit the articles `the`, `a`, `an` and `this`. Write `Open the file`, not `Open file`.
- When you talk about a forbidden word, put it in backticks. The checker does not read code spans.
- Do not use contractions. Write `do not`, not `don't`.
- Do not use Latin abbreviations. Write `for example`, not `e.g.`.

### Section 2: noun clusters

A noun cluster is a group of nouns, or of nouns and adjectives, that work as one noun. Use at most three words. If you need more, use one of these methods:

- Use a preposition: write `the lane of the GPU job`, not `the GPU job lane config`.
- Join two words with a hyphen: "post-ODM gate".
- Break the cluster into a short sentence.

The checker cannot know the part of speech of each word. It reports four or more nouns, adjectives and names in a row. This rule is advisory.

### Section 3: verbs

| Form | Status | Example |
|---|---|---|
| Imperative | Approved | Close the valve. |
| Simple present | Approved | The worker takes one job. |
| Simple past | Approved | The job stopped. |
| Simple future | Approved | The worker will start the next job. |
| Infinitive | Approved | Use `-k` to run one suite. |
| Past participle as an adjective | Approved | The closed valve is safe. |
| Progressive (-ing) | Not approved | `is closing`, `before starting` |
| Perfect (has, have, had + participle) | Not approved | `has closed`, `had stopped` |
| Passive in a procedure | Not approved | `must be closed` |
| Passive in descriptive text | Only if you must | `The valve was closed by the worker.` |

STE approves the words `can`, `must` and `will`. STE does not approve `may`, `might`, `could`, `would`, `should` and `shall`. Use `can` for a possibility, `must` for a rule and `will` for the future.

An -ing word is allowed inside a technical name, for example `landing gear`. The checker lists such words in the allowed exceptions of section 8.

To remove a passive, name the doer. Write `The worker closes the file`, not `The file is closed`. To remove an -ing form, use the infinitive or a noun. Write `Stop the worker. Then restart the web.`, not `Stop the worker before restarting the web.`

### Section 4: sentences

- Write one topic in each sentence.
- Do not join two statements with a semicolon or a dash. Write two sentences.
- Do not use "and/or". Choose `and` or `or`.
- Write numbers and units in short form: `20 m`, `8 m/s`.

### Section 5: procedures

- Write each step in the imperative form: `Stop the worker.`
- Write one instruction in each sentence. If two actions happen at the same time, you can join them in one sentence.
- Use at most 20 words in each sentence.
- Put a condition first: `If the PC is off, wake it.` Do not write `Wake the PC if it is off.`
- Use a numbered list for steps in a fixed order. Use a bulleted list for steps in any order.
- Put the result of a step in a separate descriptive sentence: `The page shows the job state.`
- Put a warning or a caution before the step it applies to.

### Section 6: descriptive writing

- Use at most 25 words in each sentence and at most 6 sentences in each paragraph.
- Write one topic in each paragraph. Put the most important information first.
- Use the active voice. Say who does the action.

### Section 7: safety instructions

A safety instruction has two keywords:

- `WARNING` tells the reader about a risk of injury or death.
- `CAUTION` tells the reader about a risk of damage to equipment or to data.

The format:

1. Write the keyword in capital letters, then a colon.
2. Start with a clear, simple command. Use `Do not` for a prohibition.
3. Then give the risk or the reason in a second sentence.
4. Put the safety instruction before the step it applies to.

Examples for AeroBrain:

> **WARNING:** Do not fly over people. A falling drone can cause injury.

> **WARNING:** If you lose sight of the drone, land it at once. A drone that you cannot see can hit a person.

> **CAUTION:** Do not stop the server during a publish. You can lose the model data.

> **CAUTION:** Do not delete the `raw/` folder. You cannot get the original videos again.

Use `NOTE:` for information that is not a safety instruction. Do not use `DANGER`, `IMPORTANT` or `ATTENTION`.

The checker looks at the keyword, the colon, the first command and the risk words. It reports `CAUTION` for a text about injury, and it reports `WARNING` for a text about damage only.

### Section 8: punctuation and word counts

- End each sentence with a period. Do not use semicolons.
- Do not use symbols in prose. Write `about`, `at least` and `to`, not `~`, `≥` and `→`.
- Count every word in the sentence, also the words in parentheses.
- Use a colon only to start a list or to give a label.

### Section 9: writing practices

- Use the active voice.
- Use a vertical list when a sentence has more than three items or more than one step.
- Use the same term every time. Spell a technical name in one way.
- Do not use one long sentence to link two facts. Use two short sentences.
- Keep every command, path, number and flag exact. Put them in backticks.

## 4. How to write a technical name or a technical verb

A technical name names one thing in the system. Examples: `worker`, `manifest`, `splat`, `GLB`, `DSM`, `ortho`, `mesh`, `collider`, `Flightverse`, `RTX 4060 Ti`, `DJI Flip`, `DJI Neo 2`. A technical verb names one action in the system. Examples: `deploy`, `publish`, `bump`, `rebake`, `render`, `train`, `commit`, `push`, `restart`.

Use the helper to add a new term. Write the meaning in STE.

```bash
python3 pipeline/ste_dict_add.py name "Brotli" "A compression format." --category "Tools and platforms"
python3 pipeline/ste_dict_add.py verb "rebake" "Make a baked file again." --category "Release and deploy"
python3 pipeline/ste_dictionary_md.py --write
```

Do not add an ordinary word to hide a problem. Rewrite the sentence.

## 5. The checker

Run the checker on one file or on all files of the configuration:

```bash
python3 pipeline/ste_lint.py docs/RUNBOOKS.md            # report one file
python3 pipeline/ste_lint.py --strict docs/RUNBOOKS.md   # exit code 1 if there is an error
python3 pipeline/ste_lint.py --summary                   # one line for each file in docs/.ste.json
python3 pipeline/ste_lint.py --json docs/RUNBOOKS.md     # machine-readable output
python3 pipeline/ste_factcheck.py docs/RUNBOOKS.md       # compare a rewrite with git HEAD
```

With no file name, the checker reads `docs/.ste.json`. It exits with code 1 if a STRICT file has an error. The test `pipeline/test_ste_docs.py` runs this check, so a later edit cannot break a STRICT file.

### What the checker ignores

It ignores front matter, fenced code, inline code, URLs, file paths, identifiers, HTML comments and acronyms in capital letters. It checks headings and table cells for unapproved words only. It skips a block that looks Spanish and reports it as `STE-0`. A STRICT file must have no `STE-0` report.

### Rules of the checker

| Rule | Section | What it finds | Type |
|---|---|---|---|
| `STE-0` | - | A block or heading in Spanish | Error in STRICT files |
| `STE-1` | 1 | Unapproved word, contraction, Latin abbreviation | Error |
| `STE-2` | 2 | Noun cluster of four or more words | Advisory |
| `STE-3a` | 3 | -ing form outside a technical name | Error |
| `STE-3b` | 3 | Perfect tense | Error |
| `STE-3c` | 3 | Passive voice | Error in procedures, advisory in descriptive text |
| `STE-4` | 4 | Semicolon or dash between two statements | Advisory |
| `STE-5a` | 5 | Procedural sentence of more than 20 words | Error |
| `STE-5b` | 5 | More than one instruction in a sentence | Error |
| `STE-5c` | 5 | Condition after the instruction | Advisory |
| `STE-6a` | 6 | Descriptive sentence of more than 25 words | Error |
| `STE-6b` | 6 | Paragraph of more than 6 sentences | Error |
| `STE-7` | 7 | Wrong safety format or wrong keyword | Error. A missing risk sentence is advisory. |
| `STE-8` | 8 | `and/or`, symbols such as `~` and `≥` | Advisory |

### Markers in a document

- `<!-- ste:procedural -->` after a heading: list items in this section are steps.
- `<!-- ste:descriptive -->` after a heading: go back to descriptive text.
- `<!-- ste-ignore STE-3c -->` before a block: ignore one rule in the next block. Use it only for a false report of the checker. Do not use it to hide a problem.
- `<!-- ste-ignore-start STE-1 -->` and `<!-- ste-ignore-end -->` ignore one rule in a range.

### Precision

The checker has no tagger for the part of speech. The `nltk` package is in the environment, but the tagger data is not there. The checker uses word lists and simple patterns. Know its limits.

- **It checks a blocklist.** It finds the words in the dictionary of forbidden words. It does not know the 900 words that the official dictionary approves. A word that is not on the list passes, also when the official dictionary does not approve it.
- **It cannot check the part of speech or the meaning.** STE allows a word for one meaning only. Only `close` has a check for this (the adjective).
- **It does not check articles.** A person must check that the text does not omit `the`, `a` and `this`.
- **It cannot check "one topic".** A person must check this for sentences and paragraphs.
- **Passive voice** is a pattern: a form of `be` and a past participle. The checker can report a state as a passive (for example "is stopped"). A short list of participle adjectives is exempt.
- **An -ing word** is an error if it is not in the allowed list. An -ing noun that the list does not have is a false report. Add it with `ste_dict_add.py ing <word>`. Do this only for a real technical name.
- **Noun clusters** are advisory. A verb in the third person can look like a noun.
- **The kind of a sentence** (procedural or descriptive) comes from its first word. A noun that is also a verb at the start of a sentence can confuse the checker. The checker looks at the next word to decide.
- **The language check** counts Spanish and English function words. It can fail on very short text.

## 6. Status

The numbers below come from `python3 pipeline/ste_lint.py --summary`. They show the errors and the advisory reports of each file.

Snapshot of 2026-10-11. Run `python3 pipeline/ste_lint.py --summary` for the live numbers.

| File | Level | Errors before | Spanish blocks before | Errors now | Advisory now |
|---|---|---|---|---|---|
| `README.md` | strict | 0 | 27 | 0 | 9 |
| `CLAUDE.md` | strict | 15 | 16 | 0 | 0 |
| `pipeline/README.md` | strict | 14 | 0 | 0 | 0 |
| `pipeline/archive/README.md` | strict | 6 | 0 | 0 | 0 |
| `docs/README.md` | strict | 11 | 0 | 0 | 26 |
| `docs/ARCHITECTURE.md` | strict | 11 | 0 | 0 | 0 |
| `docs/AUTH_SECURITY.md` | strict | 42 | 0 | 0 | 0 |
| `docs/BUGHUNT_BACKLOG.md` | strict | 25 | 54 | 0 | 2 |
| `docs/CAPTURE_PROTOCOL.md` | strict | 57 | 0 | 0 | 0 |
| `docs/DRONE_MODEL_SPEC.md` | strict | 1 | 15 | 0 | 0 |
| `docs/ENEMY_MODEL_SPEC.md` | strict | 6 | 16 | 0 | 0 |
| `docs/FLIGHTVERSE_DESIGN_SPEC.md` | strict | 128 | 0 | 0 | 0 |
| `docs/FLIGHTVERSE_IMPLEMENTATION.md` | strict | 3 | 130 | 0 | 0 |
| `docs/FLIGHTVERSE_RENDERER_DECISION.md` | strict | 0 | 10 | 0 | 0 |
| `docs/GAME_ENGINE.md` | strict | 0 | 21 | 0 | 1 |
| `docs/MULTISOURCE_3D.md` | strict | 0 | 25 | 0 | 4 |
| `docs/OPERATIONS.md` | strict | 0 | 62 | 0 | 0 |
| `docs/PHYSICS_V2.md` | strict | 49 | 0 | 0 | 1 |
| `docs/RUNBOOKS.md` | strict | 27 | 0 | 0 | 0 |
| `docs/SCENE_OBJECTS.md` | strict | 0 | 11 | 0 | 0 |
| `docs/SPLATLAB_V2_PLAN.md` | strict | 124 | 0 | 0 | 3 |
| `docs/SPLAT_EXPERIMENTS.md` | strict | 36 | 53 | 0 | 0 |
| `docs/SPLAT_PIPELINE.md` | strict | 0 | 36 | 0 | 0 |
| `docs/WORLD_CONTEXT_PROMPT.md` | strict | 24 | 5 | 0 | 0 |
| `docs/WORLD_UPGRADE_PLAN.md` | strict | 68 | 0 | 0 | 1 |
| `docs/qa/design-qa.md` | strict | 17 | 0 | 0 | 2 |
| `SPEC.md` | strict | 1 | 13 | 0 | 0 |
| `ROADMAP.md` | strict | 2 | 14 | 0 | 0 |
| **Total of STRICT files** |  | 667 | 508 | 0 | 51 |

The column "Errors before" counts the errors that the checker found in the old file. A Spanish block is not an error of the checker, so the old Spanish files had few errors. They had text that the checker did not read. The column "Spanish blocks before" shows how many blocks were in Spanish. The rewrite translated all of them. `AGENTS.md` is now a link to `CLAUDE.md`, so the checker reads it once.

The advisory reports that stay are noun clusters (`STE-2`) and a few descriptive passives (`STE-3c`). They do not fail a STRICT file. Many are false reports. The checker reads a verb as a noun, or the cluster is the title of a document.

REPORT-ONLY files (historical):

| Group | Files | Errors | Advisory |
|---|---|---|---|
| `docs/archive/` (historical snapshots) | 8 | 138 | 375 |
| `docs/superpowers/` (dated plans and specs) | 32 | 1491 | 1115 |

The freshness rules of `docs/README.md` say that historical documents stay as they are, so the project does not rewrite them. `SPEC.md` and `ROADMAP.md` were Spanish. They are now English and STRICT.

## 7. Examples of rewrites

| Before | After |
|---|---|
| `It is imperative that the operator ensures the hydraulic reservoir is replenished prior to commencing operation.` (the example of the reference sheet) | `Make sure that the hydraulic reservoir is full before you start the operation.` (13 words) |

## 8. The project dictionary

The project dictionary has four parts: approved general words, unapproved words, technical names and technical verbs. The file `pipeline/ste_dictionary.json` is the source.

<!-- ste-dictionary:begin (generated by pipeline/ste_dictionary_md.py; do not edit by hand) -->
<!-- ste-ignore-start STE-1 -->

### Approved words that this project uses a lot

| Word | Part of speech | Meaning | Example |
|---|---|---|---|
| about | adv/prep | Near to a number. Also: on the subject of. | The job takes about 10 minutes. |
| after | prep/conj | At a later time. | After the job ends, check the log. |
| allow | v | Make possible. | The route allows only GET. |
| also | adv | In addition. | Also check the log. |
| because of | prep | For the reason of. | The job stops because of an error. |
| before | prep/conj | At an earlier time. | Before you start, stop the worker. |
| can | v | It is possible to. | You can cancel a job. |
| change | v/n | Make different. | Change the option. |
| check | v | Look at something to see its state. | Check the log. |
| close | v | Shut something. (Not an adjective: use `near`.) | Close the file. |
| do | v | Carry out an action. | Do the check again. |
| enough | adj | As much as you need. | The disk has enough space. |
| fill | v | Make something full. | Fill the disk with the data. |
| find | v | Get a value by a search. | Find the job in the log. |
| full | adj | With no more space. | The disk is full. |
| get | v | Receive or fetch a value. | Get the job state. |
| give | v | Supply. | Give the job ID. |
| help | v/n | Make easier. | The log helps you find the error. |
| if | conj | In the condition that. | If the PC is off, wake it. |
| keep | v | Do not lose or change. | Keep the raw files. |
| make sure | v | Do an action or a check so that the result is certain. | Make sure that the worker is idle. |
| many | adj | A large number of. | Many jobs are in the queue. |
| more | adj | A larger number or amount. | Add more photos. |
| must | v | It is a rule. | You must not delete `raw/`. |
| near | prep/adj | A short distance from something. | Do not fly near a building. |
| need | v | Must have something. | The job needs 8 GB. |
| now | adv | At this time. | The default is PC-only now. |
| remove | v | Take away. | Remove the old file. |
| save | v | Write data to disk. | Save the file. |
| show | v | Make something visible. | The page shows the job state. |
| so | adv | For this reason. | The key is wrong, so the request fails. |
| start | v | Cause a process to begin. | Start the worker. |
| stop | v | Cause a process to end. | Stop the job. |
| test | v/n | Run a check on a function. | Test the new gate. |
| then | adv | At the next time. | Stop the worker. Then restart the web. |
| to | prep | For the purpose of (replaces `in order to`). | Use `-k` to run one suite. |
| try | v | Do an action that can fail. | Try the request again. |
| turn off | v | Make a switch or a flag not active. | Turn off the flag. |
| turn on | v | Make a switch or a flag active. | Turn on the flag. |
| use | v | Do work with a tool or a value. | Use the `--fast` flag. |
| when | conj | At the time that. | When the job ends, the worker takes the next one. |
| will | v | Future. | The worker will start the next job. |

### Unapproved words and the words to use instead

The column Basis shows where a pair comes from. `sheet` is the reference sheet of the owner. `ste` is a pair that public STE summaries show. `project` is a decision of this project. It follows the rule of one word for one meaning. Use the official ASD-STE100 dictionary to settle a doubt.

| Unapproved | Use | Basis | Note |
|---|---|---|---|
| `a lot of` (det) | many / much | project | MANY or MUCH. |
| `a number of` (det) | some / many | project | SOME or MANY. |
| `abort` (v) | stop | project | STOP is the approved word. |
| `accomplish` (v) | do | project | DO is the approved word. |
| `achieve` (v) | get | project | GET a result. Do not use ACHIEVE. |
| `acquire` (v) | get | project | GET is the approved word. |
| `activate` (v) | turn on / start | project | TURN ON a switch. START a process. |
| `actually` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `additional` (adj) | more / extra | ste | MORE is the approved word. |
| `additionally` (adv) | also | project | ALSO is the approved word. |
| `adequate` (adj) | enough | project | ENOUGH is the approved word. |
| `adjacent` (adj) | next to | project | NEXT TO is the approved phrase. |
| `alter` (v) | change | project | CHANGE is the approved word. |
| `appropriate` (adj) | correct / applicable | project | CORRECT is the approved word. |
| `approximately` (adv) | about | sheet | ABOUT is the approved word. |
| `are able to` (phr) | can | project | CAN is the approved word. |
| `as well as` (conj) | and | project | AND is the approved word. |
| `ascertain` (v) | find | project | FIND is the approved word. |
| `assist` (v) | help | ste | HELP is the approved word. |
| `assistance` (n) | help | project | HELP is the approved word. |
| `assure` (v) | make sure | project | Same meaning as ENSURE. Use MAKE SURE. |
| `at the present time` (adv) | now | project | NOW is the approved word. |
| `at this time` (adv) | now | project | NOW is the approved word. |
| `attempt` (v) | try | ste | TRY is the approved word. |
| `basically` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `be able to` (phr) | can | project | CAN is the approved word. |
| `begin` (v) | start | ste | One word for one meaning: START. |
| `carry out` (phr) | do | project | DO is the approved word. |
| `cease` (v) | stop | ste | STOP is the approved word. |
| `close` (adj) | near | sheet | CLOSE is approved only as a verb (to close a valve). As an adjective, use NEAR. |
| `commence` (v) | start | sheet | START is the approved word. |
| `concerning` (prep) | about | project | ABOUT is the approved word. |
| `configure` (v) | set / set up | project | SET an option. Use `config` for the name of the file. |
| `confirm` (v) | make sure / check | project | Same decision as VERIFY. |
| `confirmation` (n) | check | project | CHECK is the approved word. |
| `consequently` (adv) | so | project | SO is the approved word. |
| `could` (modal) | can | project | Use CAN. For a past event, use the simple past. |
| `currently` (adv) | now | project | NOW is the approved word. |
| `deactivate` (v) | turn off | project | TURN OFF is the approved phrase. |
| `demonstrate` (v) | show | ste | SHOW is the approved word. |
| `determine` (v) | find / decide | project | FIND a value. DECIDE a choice. |
| `disable` (v) | turn off | project | Use TURN OFF for a switch or a flag. |
| `discontinue` (v) | stop | ste | STOP is the approved word. |
| `display` (v) | show | project | SHOW is the approved word (verb). |
| `due to` (prep) | because of | ste | BECAUSE OF is the approved phrase. |
| `due to the fact that` (conj) | because | ste | BECAUSE is the approved word. |
| `e.g.` (abbr) | for example | project | Do not use Latin abbreviations. |
| `easily` (adv) | (delete it) | project | Vague. State the real condition or delete the word. |
| `eliminate` (v) | remove | project | REMOVE is the approved word. |
| `employ` (v) | use | ste | USE is the approved word. |
| `enable` (v) | turn on | project | Use TURN ON for a switch or a flag. ENABLE is jargon. |
| `endeavor` (v) | try | project | TRY is the approved word. |
| `endeavour` (v) | try | project | TRY is the approved word. |
| `ensure` (v) | make sure | sheet | MAKE SURE is the approved phrase for this meaning. |
| `essentially` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `etc` (abbr) | and so on | project | Give the full list, or say what the other items are. |
| `etc.` (abbr) | and so on | project | Give the full list, or say what the other items are. |
| `exceed` (v) | be more than / go above | project | Say what is more than what. |
| `execute` (v) | run | project | RUN a program, script or command. |
| `facilitate` (v) | help / make easier | ste | HELP is the approved word. |
| `fall back` (v) | use ... instead / go back to | project | Write what the system uses instead. |
| `fetch` (v) | get | project | GET is the approved word. |
| `figure out` (v) | find / decide | project | Jargon. FIND or DECIDE. |
| `fire up` (v) | start | project | Jargon. Use START. |
| `functionality` (n) | function / feature | project | FUNCTION or FEATURE. |
| `furthermore` (adv) | also | project | ALSO is the approved word. |
| `halt` (v) | stop | project | STOP is the approved word. |
| `hence` (adv) | so | project | SO is the approved word. |
| `hook up` (v) | connect | project | Jargon. Use CONNECT. |
| `however` (adv) | but / (new sentence) | project | Use BUT or start a new sentence. |
| `i.e.` (abbr) | that is | project | Do not use Latin abbreviations. |
| `identify` (v) | find | project | FIND is the approved word. |
| `implement` (v) | make / build | project | MAKE or BUILD. |
| `in addition` (adv) | also | project | ALSO is the approved word. |
| `in addition to` (prep) | and / also | project | Use AND or ALSO. |
| `in case of` (prep) | if | project | IF is the approved word. |
| `in conjunction with` (prep) | with | project | WITH is the approved word. |
| `in order to` (prep) | to | sheet | TO is enough. |
| `in the case of` (prep) | if / for | project | IF or FOR. |
| `in the event of` (prep) | if | ste | IF is the approved word. |
| `in the event that` (conj) | if | ste | IF is the approved word. |
| `incorporate` (v) | put in / include | project | PUT IN is the approved phrase. |
| `indicate` (v) | show | ste | SHOW is the approved word. |
| `inform` (v) | tell | project | TELL is the approved word. |
| `initial` (adj) | first | project | FIRST is the approved word. |
| `initialise` (v) | start / set | project | START a program. SET a first value. |
| `initialize` (v) | start / set | project | START a program. SET a first value. |
| `initiate` (v) | start | ste | START is the approved word. |
| `invoke` (v) | run / start | project | RUN a program or command. START a service. |
| `is able to` (phr) | can | project | CAN is the approved word. |
| `kick off` (v) | start | project | Jargon. Use START. |
| `launch` (v) | start | project | Use START for a process. For a drone, use TAKE OFF. |
| `leverage` (v) | use | ste | Business jargon. Use USE. |
| `lots of` (det) | many / much | project | MANY or MUCH. |
| `maintain` (v) | keep / do maintenance on | project | KEEP a state. DO MAINTENANCE ON equipment. |
| `make use of` (phr) | use | ste | USE is the approved word. |
| `may` (modal) | can / it is possible to | project | CAN shows a possibility. MAY is not approved. |
| `might` (modal) | can | project | CAN shows a possibility. |
| `modification` (n) | change | project | CHANGE is the approved word. |
| `modify` (v) | change | ste | CHANGE is the approved word. |
| `moreover` (adv) | also | project | ALSO is the approved word. |
| `multiple` (adj) | many | project | MANY is the approved word. Use `multi-source` as a technical name. |
| `necessitate` (v) | need | project | NEED is the approved word. |
| `notify` (v) | tell / send a message to | project | TELL is the approved word. |
| `numerous` (adj) | many | ste | MANY is the approved word. |
| `obtain` (v) | get | ste | GET is the approved word. |
| `obviously` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `occur` (v) | happen | project | HAPPEN is the approved word. |
| `of course` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `once` (conj) | after / when | project | ONCE means one time only. Use AFTER or WHEN for time order. |
| `optimal` (adj) | best | project | BEST is the approved word. |
| `optimum` (adj) | best | project | BEST is the approved word. |
| `ought` (modal) | must | project | MUST shows a rule. |
| `perform` (v) | do | ste | DO is the approved word. |
| `permit` (v) | allow | project | ALLOW is the approved word. |
| `persist` (v) | save / keep | project | SAVE data to disk. KEEP a value. |
| `possess` (v) | have | project | HAVE is the approved word. |
| `presently` (adv) | now | project | NOW is the approved word. |
| `previously` (adv) | before / earlier | project | BEFORE is the approved word. |
| `prior to` (prep) | before | sheet | BEFORE is the approved word. |
| `proceed` (v) | continue / go | project | CONTINUE or GO. |
| `prohibit` (v) | do not allow / do not | project | Write the prohibition as a command: Do not ... |
| `provide` (v) | give / supply | project | GIVE or SUPPLY. For a feature, use HAVE. |
| `quite` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `really` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `receive` (v) | get | project | GET is the approved word. |
| `regarding` (prep) | about | project | ABOUT is the approved word. |
| `remainder` (n) | rest | project | REST is the approved word. |
| `replenish` (v) | fill | sheet | FILL is the approved word. |
| `require` (v) | need | ste | NEED is the approved word. Write: The job needs 8 GB. |
| `reside` (v) | be | project | Write: The file is in ... Do not use RESIDE. |
| `retain` (v) | keep | project | KEEP is the approved word. |
| `retrieve` (v) | get | project | GET is the approved word. |
| `roughly` (adv) | about | project | ABOUT is the approved word. |
| `shall` (modal) | must / will | project | MUST shows a rule. WILL shows the future. |
| `should` (modal) | must / (imperative) | project | MUST shows a rule. For advice, write an imperative or state the condition. |
| `simply` (adv) | (delete it) | project | Filler word. It adds no information. Delete it. |
| `specify` (v) | give / set / say | project | GIVE a value. SET an option. |
| `spin up` (v) | start | project | Jargon. Use START. |
| `subsequent` (adj) | next / after | project | NEXT is the approved word. |
| `subsequently` (adv) | then / after that | ste | THEN or AFTER THAT. |
| `substantial` (adj) | large | project | LARGE is the approved word. |
| `substitute` (v) | replace | project | REPLACE is the approved word. |
| `sufficient` (adj) | enough | ste | ENOUGH is the approved word. |
| `supplement` (v) | add to | project | ADD TO is the approved phrase. |
| `take place` (phr) | happen | project | HAPPEN is the approved word. |
| `tear down` (v) | remove / stop | project | Jargon. REMOVE or STOP. |
| `terminate` (v) | stop | ste | STOP is the approved word. |
| `the majority of` (det) | most | project | MOST is the approved word. |
| `therefore` (adv) | so | project | SO is the approved word. |
| `thus` (adv) | so | project | SO is the approved word. |
| `transmit` (v) | send | project | SEND is the approved word. |
| `trigger` (v) | start / cause | project | START a process. CAUSE an effect. |
| `unless` (conj) | if ... not | project | Write the condition with IF. |
| `upon` (prep) | on / when | project | ON or WHEN. |
| `usage` (n) | use | project | USE is the approved word. |
| `utilisation` (n) | use | project | USE is the approved word. |
| `utilise` (v) | use | sheet | USE is the approved word. |
| `utilization` (n) | use | project | USE is the approved word. |
| `utilize` (v) | use | sheet | USE is the approved word. |
| `validate` (v) | check / make sure | project | Same decision as VERIFY. A gate that checks a rule is a CHECK. |
| `validation` (n) | check | project | CHECK is the approved word. |
| `various` (adj) | different / many | project | DIFFERENT or MANY. |
| `verification` (n) | check | project | CHECK is the approved word. |
| `verify` (v) | make sure / check | project | Use MAKE SURE when you state the result you expect. Use CHECK when you name the action (check the log). VERIFY has more than one meaning. |
| `via` (prep) | through / with / by | project | THROUGH a path. WITH a tool. |
| `vs` (abbr) | and / or / compared with | project | Write the full words. |
| `vs.` (abbr) | and / or / compared with | project | Write the full words. |
| `whereas` (conj) | but | project | BUT, or two sentences. |
| `with regard to` (prep) | about | project | ABOUT is the approved word. |
| `with respect to` (prep) | about | project | ABOUT is the approved word. |
| `would` (modal) | will | project | Use the simple future (WILL). |

### Technical names

#### Software components

| Name | Meaning |
|---|---|
| AeroBrain | The name of this project and of its web application. |
| auto-clean | The Splat Lab function that removes floaters from a splat. |
| clip | One video recording with its SRT file. |
| edge Worker | The Cloudflare Worker in `edge/` that signs the session cookie for the origin. |
| Flightverse | The 3D flight and game mode of the web application. |
| floater | A stray splat or point that floats in the air and does not belong to the scene. |
| gate | An automatic check that a result must pass before the next step starts. |
| gz | A gzip-compressed file. |
| job | One unit of work in the queue, for example an ODM job or a splat job. |
| jobs console | The page 3D, Trabajos in the web application. |
| jobs.db | The SQLite file that stores the job queue. |
| LaunchAgent | A macOS background service that `launchd` starts for one user. |
| launchd | The macOS service manager. |
| manifest | The JSON file or index that lists the clips, scenes and models in the vault. |
| preflight | A set of checks that run before a restart or a publish. |
| proxy | A small, low-resolution copy of a video. |
| queue | The list of jobs in `jobs.db`. The worker takes one job at a time. |
| scene | A 3D site with one or more versions. |
| scene version | One reconstruction of a scene, for example `recon_<hash>`. |
| sidecar | A file next to another file, for example a `.gz` file next to a web asset. |
| Splat Lab | The web page where you edit and clean a splat. |
| SQLite | The file database that the project uses. |
| SuperSplat | The splat editor that the project hosts. The project keeps its own fork. |
| thumbnail | A small preview image. |
| tunnel | The Cloudflare Tunnel process (`cloudflared`) that connects the web origin to the Internet. |
| vault | The folder `/Volumes/SSD/drone-vault` that holds all drone data. |
| watchdog | The LaunchAgent that checks the web, the worker and the tunnel and starts them again. |
| web origin | The Python web server on 127.0.0.1:8790. It serves the web files, the APIs and the video. |
| worker | The one background process that takes jobs from the queue and runs them. |

#### 3D and capture

| Name | Meaning |
|---|---|
| AGL | Above Ground Level. |
| collider | A simple shape that the game uses to find hits between the drone and the world. |
| doming | A model error where flat ground bends like a bowl. |
| DSM | Digital Surface Model. A raster of the height of the ground and of all objects on it. |
| DTM | Digital Terrain Model. A raster of the height of the bare ground. |
| EXIF | The metadata in a photo file, for example the GPS position. |
| Gaussian splat | The full name of a splat. |
| GCP | Ground Control Point. A target with known coordinates. |
| gimbal | The part that holds and turns the camera. |
| GLB | A binary glTF 3D model file. |
| GNSS | Satellite positioning, for example GPS. |
| heightmap | A raster image where each pixel is a height. |
| lawnmower | A flight pattern of parallel straight lines. |
| LOD | Level Of Detail. A simpler version of a model for far views. |
| mesh | A 3D surface that is made of triangles. |
| nadir | Straight down. A nadir photo has the camera at -90 degrees. |
| oblique | At an angle. An oblique photo has the camera not straight down. |
| ortho | The orthophoto. A top view image of the site with no perspective distortion. |
| orthophoto | The full name of ortho. |
| overlap | The share of one photo that other photos also show. |
| point cloud | A set of 3D points that ODM makes from the photos. |
| rolling shutter | A camera effect. The sensor reads the image line by line, so fast motion bends straight lines. |
| splat | A 3D model that is made of many Gaussian blobs. The file types are `.ply`, `.splat` and `.ksplat`. |
| SRT | The subtitle file that a DJI drone writes next to a video. It holds the GPS track. |

#### Tools and platforms

| Name | Meaning |
|---|---|
| API | Application Programming Interface. |
| Cloudflare | The company and the network service that carries the public traffic. |
| COLMAP | A structure-from-motion program and file format. |
| CSRF | Cross-site request forgery. An attack that the project blocks. |
| CUDA | The NVIDIA GPU compute platform. |
| Docker | The container system. |
| endpoint | One URL path of the API. |
| Fetch Metadata | A web standard. The browser adds Sec-Fetch headers to a request. The headers show where the request comes from. |
| ffmpeg | The video command-line tool. |
| GDAL | The raster data library. |
| GitHub | The code host. |
| gsplat | The CUDA library that trains a splat. |
| HMAC | A signature method with a shared key. |
| JSON | A text data format. |
| LLM | Large Language Model. |
| Markdown | The text format of the docs. |
| Node | The JavaScript runtime. |
| npm | The Node package manager. |
| ODM | OpenDroneMap. The photogrammetry program that makes the point cloud, the DSM and the ortho. |
| OOM | Out Of Memory. |
| OpenMVS | The dense reconstruction part of ODM. |
| OpenSfM | The structure-from-motion part of ODM. |
| OpenSplat | The older splat trainer that ran on the Mac. |
| OrbStack | The macOS program that runs Docker containers. |
| PDAL | The point cloud data library. |
| Pixel Streaming | A product of Unreal Engine. It sends the rendered image of an Unreal application from a server GPU to a web browser. |
| Python | The programming language of the pipeline. |
| SLO | Service Level Objective. |
| SSH | The secure remote shell. |
| STE | Simplified Technical English. |
| Supabase | The hosted database service. |
| Vercel | The web hosting service. |
| WoL | Wake-on-LAN. A network packet that wakes a sleeping computer. |
| Wrangler | The Cloudflare command-line tool. |
| WSL | Windows Subsystem for Linux. |

#### Hardware and drones

| Name | Meaning |
|---|---|
| DJI Flip | A small DJI camera drone. It flies by hand only. |
| DJI Neo 2 | A small DJI camera drone. It has a wide lens and flies by hand only. |
| FileVault | The macOS disk encryption. |
| Mac Mini M4 | The Mac that runs the web, the worker and the tunnel. |
| RPAS | Remotely Piloted Aircraft System. A drone. |
| RTX 4060 Ti | The NVIDIA GPU in the PC. It has 8 GB of memory. |
| SD card | The memory card of the drone. |
| the PC | The Windows computer with the GPU. You reach it with `ssh pc`. |
| UPS | Uninterruptible Power Supply. |
| VLOS | Visual Line Of Sight. The pilot sees the drone with the eyes. |

#### Files, paths and products

| Name | Meaning |
|---|---|
| AGENTS.md | The file of access and acceptance rules for coding agents. |
| ALERT | The file `~/Library/Logs/AeroBrain/ALERT`. It exists only while a check fails. |
| CLAUDE.md | The file of pitfalls for coding agents. |
| gcp_list.txt | The ground control point file for ODM. |
| ops_status.py | The script that prints the PASS or FAIL status of the system. |
| reconstruction.json | The OpenSfM result file. |
| run_all_tests.py | The script that runs all the test suites. |
| safe_restart.sh | The script that restarts a service in a safe way. |

### Technical verbs

#### Release and deploy

| Verb | Meaning |
|---|---|
| bake | Calculate a result once and save it in a file. |
| bump | Increase a version number. For example `bump_web_version.py` increases `?v=N`. |
| deploy | Put a new version of the code on a live service. |
| generate | Make a file or data with a program. |
| promote | Make a scene version the active version. |
| publish | Make a result visible in the web application. It also means: send a file to the vault. |
| rebake | Make a baked file again, for example a collision file. |
| rebuild | Build a program or an index again from its sources. |
| regenerate | Make a generated file again. |
| roll back | Go back to the last good version. |

#### Version control

| Verb | Meaning |
|---|---|
| commit | Save a set of changes in the Git history. |
| merge | Join two Git branches, or join the data of two sources. |
| pull | Get Git commits from the remote. |
| push | Send Git commits to the remote on GitHub. |
| tag | Put a label on a Git commit. |

#### Process control

| Verb | Meaning |
|---|---|
| cancel | Stop a job before it is finished. |
| drain | Take all the jobs out of a queue and run them. |
| enqueue | Put a job in the queue. |
| kickstart | Start a LaunchAgent now with `launchctl kickstart`. |
| kill | Stop a process at once with a signal. |
| poll | Ask a service for its state again and again. |
| probe | Send a small test request to see if a service answers. |
| re-enqueue | Put a job in the queue again. |
| rerun | Run a job or a command again. |
| restart | Stop a service and start it again. |
| retry | Try a failed action again. |
| stage | Copy files to a temporary place before a job. |
| tail | Show the last lines of a log file. |
| wake | Wake a sleeping computer with WoL. |

#### Data and files

| Verb | Meaning |
|---|---|
| convert | Change a file from one format to another. |
| crop | Cut a part out of a model or an image. |
| delete | Remove a file or a record. |
| download | Get a file from a server. |
| export | Write data in a file format for use in another tool. |
| extract | Take frames or files out of a video or an archive. |
| gzip | Compress a file with the gzip program. |
| import | Read data from another tool or format. |
| ingest | Copy files from the SD card into the vault and register them. |
| parse | Read a text file and split it into its parts. |
| purge | Delete files for good to free disk space. |
| register | Add an item to a list or an index. |
| rotate | Replace a key or a log file with a new one. |
| sync | Make two copies of data the same. |
| trash | Move a file to the trash folder. It is not deleted. |
| upload | Send a file from the browser or the Mac to a server. |

#### 3D and compute

| Verb | Meaning |
|---|---|
| align | Move a model so that it fits a reference. |
| bundle | Join many files into one file. |
| clean | Remove floaters and noise from a splat. |
| downsample | Make a copy of the data with fewer points. |
| filter | Remove points or data that do not pass a rule. |
| reconstruct | Make a 3D model from photos. |
| render | Draw an image from a 3D model. |
| retrain | Train a splat again. |
| sample | Take a part of the data for a test. |
| train | Run an optimizer that makes a splat from photos. |

#### Software testing

| Verb | Meaning |
|---|---|
| gate | Stop a step until a check passes. |
| lint | Run a program that checks the style of files. |
| mock | Replace a real part with a fake part in a test. |
| stress | Run a test with a high load. |
| typecheck | Run the type checker. |

### Allowed exceptions

These words end in -ing and are nouns or names. The checker accepts them:

```text
anything, bearing, bring, building, buildings, caching, ceiling, damping, drawing, ducking, during, engineering, evening, everything, falling, heading, headings, housing, king, landing, mapping, meaning, meanings, meshing, morning, nothing, onboarding, packing, padding, pending, ping, polling, pricing, pruning, rendering, ring, rings, routing, setting, settings, sing, something, spring, string, strings, texturing, thing, things, tiling, timing, training, tubing, tunnelling, warning, warnings, wing, wiring
```

These past participles work as adjectives after is, are, was and were. The checker accepts them:

```text
closed, locked, unlocked, open, enabled, disabled, connected, disconnected, loaded, charged, discharged, finished, damaged, broken, stuck, paused, stopped, idle, ready, done, empty, sorted, unused, used, given, known, fixed, frozen, dead, queued, running, failed, cancelled, canceled, archived, deprecated, pinned, private, signed, shared
```

<!-- ste-ignore-end -->
<!-- ste-dictionary:end -->
