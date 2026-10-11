# Bug Hunt Backlog per tab (checked findings, not critical, still open)

> Status checked on 2026-07-14. The P0 and MPS sections are the forensic record. They end in
> **RESOLVED**. They are not active incidents. The real open items are only the items that
> are not closed or reclassified, and the CUDA and scene gates linked from [README.md](../README.md).
>
> Some location notes below stop in the middle of a word. The original note ends at that
> point. The cut text stays as it is.

## Closed history: P0 MPS memory (2026-07-11)

> **RESOLVED / not operational.** This investigation belongs to the old OpenSplat/MPS trainer.
> The current product limits the Mac to Fast 1K and Medium 2K. It runs 7K–40K in strict CUDA.
> The original text stays as evidence of how the team isolated the cap that started on 9-jul.

- [P0][historical] **The MPS pipeline of that date did not reproduce the artifact that shipped on 7-jul.**
  - Cinematic on proj_...133809_0101_D passed on 7-jul (3502s, 7000 steps, about 950k gaussians, under the cap 11000).
  - Today the same job fails with OOM in 7 tries.
    - The tries are: eval 22cam on 3 rungs, verbatim on 3 rungs, and the discriminator 30cam full.
    - The discriminator 30cam full is the EXACT replica of production.
    - Its peak was 10715 MiB, and it died at about step 2200 with only about 200k gaussians.
    - So the memory for each gaussian or the MPS allocator grew. The count did not grow.
  - Evidence clears these causes:
    - The inputs (recon and frames mtime of 7-jul are intact).
    - The binary (the build recompiled only opensplat.cpp.o that day, and model.cpp.o is from 5-jul).
    - The libtorch (oct-2025).
    - The split (30cam also dies).
    - `--save-every`.
    - The OS (no updates since March).
    - The reboot (the SAME boot: the uptime of 8d19h covers 7-jul).
  - REMAINING SUSPECT: the accumulated state of the system (5 more days of uptime, swap 2.8GB, Metal driver, fragmentation, pressure).
  - REBOOT DISCRIMINATOR EXECUTED 11-jul 13:0x: OOM AGAIN (10732 MiB, swap 0, fresh boot). The accumulated state is CLEARED.
  - The forensics from before the reboot are in `eval/logs/pre_reboot_forensics.txt` (the swap was 5263/6144MB).
  - NEXT: job splat-1783791846718 is in the worker queue. It is the real PRODUCTION path (launchd env + run_tracked) on the same cid and preset.
    - If it passes, the delta is in the env or the invocation of the eval harness.
    - If it fails, production itself is broken today.
  - After that:
    1. Do a medium run with 2000 iters to find the ceiling of TODAY.
    2. The experiment `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.4` was inconclusive (a crash in `Model::Model`, the wrong tool).
  - Evidence: `eval/DJI_...0101_D/{20260711-*-ultra/FAILED.json, discriminator-30cam/}` and `eval/logs/*.log`.
  - BLOCKS: the Phase 1 baseline (cinematic/ultra) and new production splats above fast.

## Closed history: P1 MPS OOM ladder (2026-07-11)

> **SUPERSEDED BY ARCHITECTURE.** These local rungs no longer exist for premium tiers. The current
> policy keeps the CUDA tier and allows only `d1→d2` after a classified OOM.

- [P1][historical] **The MPS ladder of that date did not reduce the real driver of memory.**
  - Evidence: ultra caused OOM on all 3 rungs, about 200s for each, on the easy scene (22 cameras, `eval/DJI_20260706133809_0101_D/20260711-085950-ultra/FAILED.json`).
  - The rungs lower the resolution (`-d 2`). But the COUNT of gaussians from densification sets the peak.
    - This count grows early and does not depend on the downscale.
    - The comment in `worker.py:672-674` already said this for rung 3.
    - The data now show that it applies to the whole ladder in dense scenes.
  - Current user experience:
    1. The user picks ultra.
    2. The system spends about 10 min of compute on 3 tries that must fail.
    3. The user gets a short, honest error. The text is `usa el preset Cinematic` and it means "use the Cinematic preset" (`worker.py:777`).
  - The fix has two parts (AFTER the baseline, not now):
    1. The rungs must degrade densification (`densify-grad-thresh`, `refine-every`, `stop-screen-size-at`), not only the resolution.
    2. A memory preflight must reject ultra BEFORE the system burns the 10 min. The prediction `capture_quality.memory_risk` exists. Connect it to the enqueue step.
  - Effect on Phase 2.5: the sweep changes the densification parameters, not the resolution. The data showed this before the team designed the sweep.

The snapshot of a large hunt for bugs counted 72 findings. The team closed the HIGH findings, the crashes, the XSS and the UX defects with large impact.
The dated lists below keep their own `VERIFIED/CLOSED` mark. Only the sections with **pending** in the name show open work.

## `dron`
✅ VERIFIED 2026-07-10 (hunt `Inicio`+`Vuelos`+`Dron`): the 8 findings below were ALREADY fixed in the code.
New fixes on 2026-07-10:
- Scan diff: the search box no longer loses focus every 10s.
- Protection against double submit for import and optimize, and server dedupe of ingest.
- Drop captures the files before the await.
- A 403 response still draws the stats.
- `/api/sd` handles an SD card that the user removes during a scan.

- [medium] After `scan()`, the debounced search and filter handlers use an old volume snapshot and a detached DOM node.
  · `renderBrowser()` closures: lines 234-275. The `[data-bq]` input debounce: lines 270-274. The note stops at: `st._t setTim`.
- [medium] `renderBrowser()` dereferences a null `querySelector` result after the card set changes.
  · `renderBrowser()`, lines 236-237. The note stops at: `const box = document.querySelector([data-browser=...]); if (!st.open`.
- [medium] The search input of the browser changes to lowercase by force. It also loses the caret and the focus while the user types.
  · `renderBrowser()` lines 245, 252, 270-274. The filter uses `x.name.toLowerCase().includes(st.q)`. The note stops at: `the debou`.
- [low] The ETA and speed math in the `xhr.upload.onprogress` handler uses an old closure.
  It can divide by a total of zero. The result is NaN or Infinity.
  · `upStart` `onprogress` handler, lines 480-490 (`item.eta` computation at line 485, `item.pct` at line 488).
- [low] Division by zero and NaN in the SD use gauge when the total is 0 or absent.
  · `scan()`, line 185: `const pct = Math.round((v.total - v.free) / v.total * 100)`.
- [low] The `scan()` render crashes if any SD file entry has a null or undefined name.
  · `lastFlight(v)`, line 135: `.map(x => (x.name.match(/DJI_(\d{4})(\d{2})(\d{2})/) || []).slice(1))`.
- [low] For a file of zero bytes, the upload progress math gives NaN% and an Infinity ETA.
  · `upStart` `xhr.upload.onprogress`, line 488: `item.pct = Math.round((e.loaded / e.total) * 100);` and `upMe`. The note stops at `upMe`.
- [low] The card gauge and the optimize percentages give NaN when a card reports total=0.
  · `scan()` line 185 (`const pct = Math.round((v.total - v.free) / v.total * 100)`). The note stops at: `same divide-by-v.total`.

## `home`
✅ CLOSED 2026-07-15: Home V2 replaced the renderer that caused these findings.
`.dc-cloud` no longer exists. The separate rAF families and the DOM smash no longer exist.

The GLB uses one loop with teardown, `IntersectionObserver` and a pause when the page is not visible.
The empty state uses a bounded canvas.
`home-data.js` normalizes the duration and the partial states.
Tests prevent `NaN:NaN` and invented zeros.

## `shell`
✅ CLOSED 2026-07-09:
- [x] `api()`: a race between concurrent 403 responses. Fix: `ensureAuth` uses `authInFlight` to allow only one call at a time (single-flight).
- [x] `attachScrub`: the code saves the `touchend` timer and cancels it (it does not reset in the middle of a scrub).
- [x] Stale older-jobs list: the structural key uses the identities (ids), not only the count.

## `sistema`
✅ VERIFIED 2026-07-10: both were already fixed (`try/catch` in `getFlights`, and `jobCard` accepts a null `label` since 2026-07-10 in `shell.js`).
- [medium] When `flights.json` fails to load, an unhandled promise rejection freezes the entire tab.
  · `system.js` line 73, top-level async IIFE: `const flights = await getFlights();`
- [medium] A job without a `label` crashes the feed render. The blast radius is the same: it kills all the filter and table listeners.
  · IIFE, the feed `feed de trabajos recientes` (recent jobs feed), line 143: `esc(j.label.length > 26 ? j.label.slice(-16) : j.lab`. The note stops at: `j.lab`.

## `splatlab`
✅ CLOSED in commit 5f300ca (drag and drop over the iframe publishes).
- [medium] Drag and drop over the editor does nothing. The iframe takes the drag events, so they never reach `#lab-drop`.
  · The drag-and-drop handlers on `drop` (`#lab-drop`), lines 106–112, with the `<iframe id="lab-frame">` as a child.
- [medium] Drag and drop over the iframe never gives drop events. The feature is dead over its visible area.
  · The drag-and-drop handlers on `drop` (`#lab-drop`), lines 106–112, together with the iframe at line 35.

## `studio`
✅ VERIFIED 2026-07-10 (complete hunt): the 9 findings below are FIXED in the current code.
New fixes on 2026-07-10:
- Reverse with input trim (A1).
- A tmp file for each job, and a guard against double submit (A2).
- An explicit cap of 120s (A3).
- Normalized fps for xfade, and the timeline does NOT empty when the job enters the queue (A4).
- The ffmpeg stderr is visible, and a timeout of 30min (M1/M3).
- Progress for each cut (M4).
- The reel appears by itself through `onDone` (M5).
- `tl-video` pauses when the module changes (M6).
- The carousel scrub works again (M9).
- The projects modal now opens in the center (M10).

- [medium] The preview `<video>` elements of the reels continue to play and decode after the module tab changes. The grid re-render orphans them.
  · `renderGrid()`, reels branch, `mouseenter`/`mouseleave` handlers (lines 493-501). It interacts with `showMod()`. The note stops at: `showMod() (`.
- [medium] `pause()` and `clearTL()`/`delClip()` do not cancel the `seek()` load cycle that is in progress.
  Then a stale `canplay`/`loadeddata` handler calls `video.play()`. It also sets `video.currentTime=target`.
  This happens after the user pauses or empties the timeline.
  · `seek()` load cycle (lines 882-903) compared with `pause()` (lines 941-945) and `clearTL()`/`delClip()`/`magic()`/`deep-li`. The note stops at: `deep-li`.
- [medium] A deep-link `?a=`/`?b=` with non-numeric values inserts a segment with a NaN range. This breaks the timeline geometry.
  · The deep-link block, lines 1438-1441: `const a = params.get('a') != null ? Math.max(0, +params.get('a')) :`.
- [medium] `restoreProject` trusts `clip_id` from `localStorage`. Nothing checks an orphaned or malicious `clip_id` against `byId`.
  · `restoreProject(p)` line 1375: `tl = (p.tl || []).map(s => ({ ...s, id: uid() }));`. The note stops at: `(no filter on s.clip`.
- [medium] Undo cannot revert changes to the title size or to the transition duration. The code takes the snapshot AFTER the change.
  · Editor IIFE, inspector bindings: `$('tli-title-size')` input and change (lines 1216-1217) and `$('tli-tran`. The note stops at: `$('tli-tran`.
- [medium] Undo does not capture a typed title. It also does not capture a change of the title color.
  · Editor IIFE: `$('tli-title')` `'input'` (line 1214) and `$('tli-title-color')` `'input'` (line 1218).
- [medium] `restoreProject` restores the `edFps` variable but leaves the FPS chip UI on the wrong selection.
  · Editor IIFE, `restoreProject()`, line 1381 (`if (g.fps != null) edFps = g.fps;`).
- [medium] `segDur()` ignores freeze. So the timeline length, the size estimate and the playback all differ from the exported reel.
  · Editor IIFE: `segDur` (line 636). The UI creates freeze at lines 1189/146. The code sends freeze to the export at line 1333. The note stops after line 1333.
- [low] The safety timeout in `seek()` (`setTimeout(start,1500)`) fires against a timeline state that can be different.
  `start` runs with the old captured `target`/`andPlay`.
  This is true if the user seeks inside the same clip during the 1.5s window. It is also true if the user edits the clip in that window.
  · `seek()`, lines 882-903 (`safety = setTimeout(start,1500)`, and `start` sets `video.currentTime=target`).

## `viajes`
✅ VERIFIED 2026-07-10: the 5 were already fixed.
The code keeps the caret, catches `AbortError`, uses `||0` for durations, cancels the debounce on back navigation, and does not change `q`.
- [medium] On every keystroke, the caret of the search input jumps to the end. Also, the page scrolls to the top.
  · `renderDetail()`: the debounce of the `#d-q` `'input'` handler (lines 191-195) combined with other code. The note stops at: `the trailing window`.
- [low] If the user interrupts the `#city-back` WAAPI animation, an unhandled `AbortError` happens.
  Also, `renderCities` races against a re-entrant `renderDetail`.
  · `renderDetail`: the `#city-back` click handler, `el.animate(...).finished.then(...)` (lines 180-189).
- [low] When `duration_s` is absent, the UI shows "NaN min" everywhere (no `|| 0` fallback).
  · `trips.js` line 54 (`c.dur`) and line 151 (`dur` for each day). The UI renders it at lines 95, 131, 157.
- [low] On back navigation, the timer for the search debounce stays active. The app then pulls the user back to the detail view.
  · `renderDetail`: `#city-back` click handler (lines 180-190) and `#d-q` input handler (lines 191-195).
- [low] The code forces the search input text to lowercase on re-render.
  So the uppercase characters that the user typed change in front of the user.
  · `renderDetail`: line 192 of the input handler for `#d-q` stores `dstate.q = e.target.value.toLowerCase()`. The note stops at: `echoed`.

## Hunt pipelines 2026-07-09 (after the fixes): pending items of lower priority
✅ CLOSED 2026-07-10: `browser_gate` drains stderr. `build_index` tolerates a stat race and a corrupt manifest.
`splat_quality` uses tail=60 (the gate no longer runs out of Step lines). The code removes the stages of failed splats when they fail.
Only these remain: pid identity in `init()`, orphan artifacts after prune, atomic pending, and efficiency work (double rebuild, OBJ in RAM).
- [medium] `jobs.py` `init()`: kills saved pids without a check of the identity. A pid that the system reused after a reboot can belong to an innocent process. Fix: compare `lstart` and `comm` before the signal.
- [medium] `browser_gate.py:165`: nobody drains the Chrome stderr after the handshake. The process hangs if it fills the 64KB PIPE. Fix: a drain thread.
- [low] Worker `run_splat`: intermediate updates overwrite a cancel after the training. The worker removes the `.training/` stages of failed jobs only when it restarts.
- [low] `prune_splat_history` can delete versions that done jobs point to after `retarget`. The `Abrir` card (it means "Open") is then dead. Fix: blank the artifacts when it prunes.
- [low] `build_index`: `p.stat()` does not tolerate a file that disappears (a race with prune). Also, `main()` crashes when it reads one corrupt manifest. Fix: `try/except` for each file.
- [low] `splat_quality`: the metrics come from the tail of 12 lines. If the tail ends in saves, the code skips the convergence checks without a message.
- [low] `jobs.pending()` check-then-enqueue is not atomic (a double tap makes 2 jobs). Fix: `BEGIN IMMEDIATE`.
- [low] Efficiency: a double `rebuild_index` for each 3D job. `tresd_publish` copies the OBJ with `read_bytes` (RAM) and parses it 3 times. The `image_list.txt` write is not atomic.

## Hunt Studio 2026-07-10: minor pending items
- [medium] M7: the preview of freeze and reverse differs from the export (the playhead is out of sync on those clips).
- [medium] M8: if the user deletes a clip or does an undo DURING playback, the player freezes. Fix: call `pause()` at the start of `delClip`/`undo`/`redo`.
- [medium] M3b: 'edit' jobs have no Cancel button (this needs the move of `run_edit` to `run_tracked`).
- [low] B2-B4: reorder multi-undo, a tap on the handle gives a false undo, and `tli-freeze` has no JS clamp.
- [low] B5: the apostrophes, the ':' and the '%' of the title disappear without a message.
- [low] B6: the estimate of the size ignores xfade, limits and audio.
- [low] B7/B8: for a 500 response, `authGate` says `Inicia sesión` (it means "Sign in"). A cancel of the login gives an unhandled rejection.
- [low] B10: `Nuevo proyecto` (it means "New project") does not reset the title, LUT, fps and bitrate. The timeline has no `beforeunload` guard.

## Hunt 3D 2026-07-10: minor deferred items
- [low] `selectedSplatByClip` (localStorage) does not prune the keys of deleted clips.
- [low] `/api/capture_report` has no lock (fast clicks start parallel analyses). The client cache limits the effect.
- [low] `/upload` and `/api/splat_upload` answer 4xx without a drain of the body (the browser reports a network error).
- [low] `pending()` then `enqueue()` is not atomic in `/api/odm` and `/api/splat` (2 clients at the same time).
- [low] `maximum-scale=1.0` blocks the pinch-zoom of the page on Android (on purpose, because of the viewers).

## Hunt `Inicio`+`Vuelos`+`Dron` 2026-07-10: deferred items
- [low] The hero drone of `Inicio` intercepts taps on the jobs chip or the title when it flies over them. This is a design trade-off: the drone is interactive on purpose.
- [low] `/api/highlight`: the code reads, changes and writes without a lock (2 fast marks lose 1).

### P0: binary discriminator (pre-written readings, 11-jul afternoon)
A clean worker gives OOM 3 times. So production is broken today.
The team kept the suspect binary in `eval/logs/opensplat-suspect-20260711` (sha cec01b29).
THREE BUILDS:
1. (a) Clean 9fb62fd without the patch. If it PASSES, the binary of yesterday was the problem.
2. (b) Apply the patch again and rebuild.
   - If it PASSES, the culprit is the link of yesterday (rebuild and done).
   - If it FAILS, the culprit is the patch itself (redesign).
   - The check of "additive post-load" was by intention, not by behavior.
   - Permanent gate: a known cinematic run after ANY patch to the trainer.
3. If (a) FAILS, bisect the inputs.

Timeline: EVERY failure comes after the patch. The only pass after the patch is fast (minimum densification, where the overhead for each gaussian is not visible).

### P0: full cross matrix and marginality hypothesis (11-jul afternoon)
| binary | env | path | result |
|---|---|---|---|
| patched | shell (MallocNanoZone=0) | nohup | OOM ×N |
| patched | clean launchd | worker run_tracked | OOM ×3 |
| clean 9fb62fd | shell | nohup | OOM (10766, identical) |

The matrix clears the binary, the patch and the re-link by behavior. The matrix also clears the env (crossed test).

ACTIVE HYPOTHESIS: MARGINALITY, not a regression.
- All the deaths fall in 10210-11000 MiB (5% above or below the cap, never 6GB, never 15GB).
- Cinematic in this scene always needed about 10.5-11+ GB.
- On 7-jul it passed just under the cap, and no instrumentation saw it (the peak recorder started on 11-jul).
- A noise of 3% above or below (random init, allocator, number of cameras) flips the result.
- No cliff appeared. The system was always at the edge.
- Support: the DeepSeek report of 9-jul already flagged splat anomalies on 8-9 jul (PRE-patch) and an "06/07 inflection point".

DISCRIMINATOR IN PROGRESS: the same run with `taskpolicy -m 12500`.
- If it completes with a peak of about 11-12GB, the data support the hypothesis.
  - Then the team rewrites the P0 as "preset at the edge of the cap".
  - The fixes are those of the P1 (rungs on densification, and margin and preflight).
  - The sidecar peak becomes a permanent guard.
- If it gives OOM at 12500, the growth has no limit. Then a real bisection follows.

### P0: cap-12500 FAILED (11-jul): simple marginality REJECTED
The run died at step about 2980/7000 (loss 0.032, healthy) while it crossed 12.5GB.
The memory GROWS with densification. It does not flatten at the edge of the cap.

THE QUANTIFIED ANOMALY: today about 200-300k gaussians use more than 12.5GB. On 7-jul 950k gaussians used less than 11GB.
The memory for each gaussian is about 5 times larger. The full matrix above clears the binary, env, inputs, path and boot.

NEXT DISCRIMINATORS (fresh session):
1. Count the exact gaussians in the `model_2000.ply` of today. Correlate the peak against the count for each step. The curve of memory for each gaussian IS the evidence.
2. Do a short run on the CPU backend (`--cpu`, same preset, about 1000 measured steps). If the CPU shows a normal memory for each gaussian, the culprit is the MPS allocator or rasterizer, and the team bisects there.
3. Look in `/Library/Updates` for receipts of Metal or GPU driver components. The `softwareupdate` command already said no. The receipts can show an update of macOS or Metal between 7-11 jul.

Deaths: always during densification at resolution 1/4 (step<3000, the schedule doubles at 3000). The run dies BEFORE the jump of resolution.

### P0: RESOLVED (11-jul, discriminator zero: git forensics of the enforcement)
**THERE IS NO REGRESSION. The `taskpolicy -m 11000` cap started on 9-jul 19:25 (0d5151a, "adaptive resource governance"). The successful production run was on 7-jul 09:44, TWO DAYS BEFORE the cap.**

On 7-jul cinematic ran WITHOUT a limit.
It used 13-15GB+ for 3502s. Nobody measured this real footprint.

It swam in 5GB of swap. This is the signature of the forensics from before the reboot.
All the "failures" after 11-jul come from the cap. The cap does its job on a preset that was ALWAYS over budget in dense scenes.

The "5×" dissolves (the team measured the denominator against infinity).
First -9 in `errors.jsonl`: 9-jul 23:41, hours after the cap commit.
Eleven clearances, because there was no culprit. The question assumed a break that never happened.

RECLASSIFICATION: this feeds the P1.
- Cinematic and ultra need a real measured budget (a curve of peak against count from the saved .ply files).
- They need rungs on densification.
- They need a preflight that rejects presets over budget.

BASELINE IS UNBLOCKED: the honest row for each scene is the largest preset that fits under the cap TODAY (the sweep finds it).
`cinematic: over budget (cap 9-jul)` is a table datum, not a block.

Lesson on the instrument for the writeup:
If you change the meter and the reality "changes" on the same day, suspect the meter first.
And the git log of the enforcement costs less than eleven clearances.

### Post-P0: unblocked plan (sequence for a fresh session, review 11-jul)
✅ DONE: 12 retroactive sidecars (`trained_pre_cap` / `trained_uninstrumented`).
A historical "completed" hides conditions. Nobody uses them as a reference.
1. A curve of peak against count from the saved .ply files (`eval/.../discriminator-30cam`, `replica-cleanbin`, `cap12500-model_*.ply`). The curve DEFINES where to sample.
2. A sweep that the curve guides (2-3 points). The result is the largest preset with a peak of at most 85% of the cap. The P0 showed that a change of 3% decides life or death at the edge.
3. DECISION MADE (review criterion): the baseline is the preset that fits under the PRODUCTION cap (reproducible in the real worker).
   Cinematic without a cap enters as an informative row: "what the system delivered before the cap".
   If the preflight raises the cap with evidence, the team reruns the baseline and keeps the old one.
4. Baselines 1-2-3 through the worker, with the machine alone. The team records the boot and `machine_load`.
5. Dual-series CANARY (weekly launchd): the fixed splat gate of Phase 0, tracked over time on `peak_mib` AND `duration_s`.
   A duration of twice the normal value with no change of inputs means that the system swims in swap, even if it completes.
   The system cannot again operate over budget in silence.
6. Frozen table, then the choice between the SH-fix branch and the migration.

- [P2][worker] Suspicion after the rewrite of the orphan test (4th red, 11-jul): the polling is now robust.
  If the test is still red UNDER LOAD, `_proc_ours` can fail safe. A slow `ps` or a timeout leaves the identity unchecked, so `init` does NOT kill the orphan.
  In that case the test reports the real behavior of the system under load. It is not a flake.
  To investigate: add a retry in `_proc_ours` and reproduce with stress.
  - 5th datum (11-jul 14:3x): red with `medium_d2` training, green at rest. The correlation between load and red is now 5/5.
    The hypothesis that `_proc_ours` fails safe under load moves from suspicion to probable.
    It stays P2 (it does not block). To open it, start with the `ps` timeout in `_proc_ours`.
  - 6th datum + NAMED HYPOTHESIS (falsifiable, for when the team attacks the problem).
    The hypothesis: "MPS/unified-memory contention during training degrades the subprocess timing of the smoke test".
    Red correlates with active opensplat/MPS (5/5). Green correlates with a docker ODM job that runs (n=1) and with rest.

## Phase items (not bugs, 11-jul, Phase 1 close)
- [method] A separate document for the replicable protocol (shorter than the case study, more useful for more people).
  The protocol has six parts, in this order:
  1. A pre-written projection.
  2. An event with hard-wired figures.
  3. A surprise budget.
  4. Pre-decided readings.
  5. A retroactive correction of attributions.
  6. A cold reader as a held-out check.
  It is not about splats. It is about how to work with agents when the numbers can lie.
- [agenda] "When does the team show it to someone?" The portfolio does not work in a private repo.
  This is a decision for Daniel, not for commits. The case study already survived its cold reader.
  Candidates: a public writeup (blog or LinkedIn) after the 2.0, or with Phase 2 complete.
  The team names the risk of a delay with no end.
- [criterion U1-U3] The nature of the risk in the UI stretch changes: from "does the number lie?" to "does the scope grow?"
  The criterion to close is the GATES of the spec v2, not visual satisfaction.
- [2.0] The first experiment where the arc can FAIL honestly.
  If SH does not move LPIPS, the suspect narrows to appearance and exposure. Then the trainer migration revives.
  The negative result goes into the table with the same rigor.
  - 10th datum (refines): red about 1 min AFTER the LPIPS scorer ended, with residual load 3.3 and zero MPS processes. 3/3 runs were green in immediate isolation.
    The cause of the red correlates with RESIDUAL LOAD (load above about 3), not strictly with concurrent MPS.
    Statement v2: "residual pressure on the system degrades the subprocess timing of the test".
  - P2 RESOLVED (11-jul night): the mechanism is a race against the re-exec window of the python3 of Homebrew.
    In that window (about 10-50ms) argv shows "python3" before the process rewrites itself to the framework binary.
    If `init` runs inside the window, it matches, kills, and the test is green.
    Under load, the latency from spawn to init is longer than the window. So there is no match, no kill, and the test is red.
    The mechanism explains 11/11 data points (the correlation with load was the latency, not MPS and not the scorer).
    Production was safe BY CHANCE (script names in argv survive the re-exec).
    The term `python.app/contents/macos/python` closes the real gap: a bare-python3 orphan worker was NOT killed.
