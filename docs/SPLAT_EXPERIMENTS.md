# SPLAT_EXPERIMENTS: measured results (held-out)

> **Frozen experiment dataset (MPS/OpenSplat, 2026-07-11).** The data is still valid evidence for
> those runs. It does not set the current premium backend. The production CUDA backend and its
> tiers are in [SPLAT_PIPELINE.md](SPLAT_PIPELINE.md).
>
> The words `running`, `in progress`, `pending` and `next` describe the log of that day.
> They are not operational status. They are not active work on 2026-07-14.

> Rule: Do not release a quality change without a before/after number from this
> harness. Record negative results. Never delete them. Each row has its
> `run.json` with `params_hash` in `vault/eval/<cid>/<run_id>/`.
>
> Protocol: The split is deterministic (the seed is clip_id, so the split is the same between
> runs of the same scene). The test views are not in the train set (surgery on
> reconstruction.json). The render and the GT come from the internal path of the trainer
> (`--render-cameras`, local patch). PSNR and SSIM are full-res. LPIPS uses AlexNet, with a side of
> at most 1024 px.
>
> The splats published BEFORE the harness trained with all views. Any eval
> on them is train-view reproduction, NOT a baseline.

**Resolution rule (checked 2026-07-11):** The eval ALWAYS compares at full GT
resolution (`render_px` in each eval block shows it). The render mode does not inherit the `-d`
of the train step. So a model trained at half resolution pays for its loss of detail in the
number. Without this rule, fast@full and ultra@half are not comparable. All the deltas of
Phase 2 start contaminated.

**Baseline preset: cinematic** (what production delivers for this class of
scene). The table also records Ultra. The memory ceiling of Ultra IS part of the baseline.

## Baseline (Phase 1): freeze when the 3 scenes are complete

| Scene | Preset | PSNR | SSIM | LPIPS | train s | peak MiB | run_id |
|---|---|---|---|---|---|---|---|
| easy `…133809_0101_D` (30 cams) | cinematic | **BLOCKED: P0 environment regression** (below) | | | | | |
| easy `…133809_0101_D` | ultra (3 tiers) | **FAIL: OOM 3 times.** The flagship preset cannot handle this scene in 16GB (about 200s per tier until the footprint cap 11000) | — | — | 195+241+211 | 11000 (cap) | `20260711-085950-ultra/FAILED.json` |
| large `…133243_0100_D` (214 img) | cinematic | _pending_ | | | | | |
| multi-source test #2 (0103+0104) | cinematic | _pending: regenerate recon_ | | | | | |

Context note: The `peak` values of the failed ultra run are RSS. They underestimate MPS by about 20
times. The live measurement was RSS 489 MiB compared with phys_footprint 10 GB in the same process.
The team corrected PeakTracker to the kernel `phys_footprint_peak` AFTER that run.

All the runs after it report `peak_source: phys_footprint`. The baselines
run with the machine decoupled from the worker (headroom at least equal to production).
`machine_load` in each run.json records this.

## Reference (not baseline)

| Scene | Preset | PSNR | SSIM | LPIPS | train s | peak MiB | run_id | Note |
|---|---|---|---|---|---|---|---|---|
| easy `…133809_0101_D` | fast | 14.41 | 0.3935 | 0.7477 | 50.2 | 672 | `20260711-084640-fast` | shakedown of the harness. The side-by-side comparison showed that the poses are aligned |

## Phase 2 experiments (one per row, one variable per run)

| Lever | Scene | PSNR Δ | LPIPS Δ | train time Δ | peak MiB | Verdict |
|---|---|---|---|---|---|---|
| _2.0 SH 0→N (NaN fix)_ | | | | | | _pending baseline_ |

## Protocol of experiment 2.0 (SH-fix), declared in advance (review 11-jul)

BUDGET COLLISION: SH 0 to 3 means 3 to 48 coefs per Gaussian (about 3-4 times the params plus Adam).
The team measured the cap of 55KB per Gaussian and the whole preflight at SH=0. They are not valid
for SH=3. The order is mandatory:

1. REPRODUCE the NaN (step, tensor, cause). Is it the lr of SH on MPS? Is it fp16? Is it variable
   exposure? Without a diagnosis there is no experiment. There is only roulette.
2. Measure the KB per Gaussian again, with SH active (short instrumented run).
   This gives a new maximum count under the cap.
3. Compare with EQUAL BUDGET: SH=3 under the cap against SH=0 under the cap. Each one uses the
   count that its budget allows (NOT equal count). The real question is this: how much LPIPS does
   view-dependent color buy, at the cost of the lost densification?
4. PRE-DECLARED METRIC: LPIPS decides. PSNR and the side-by-side check by eye VETO.
   If LPIPS is better but new artifacts are visible, the result is a FAIL.
   To decide the metric after you see the results is p-hacking.

## Sweep scene 1 (in progress)

- A: medium gives PSNR 14.14 / SSIM 0.356 / LPIPS 0.572, under the cap: OK (trained_binary
  clean-9fb62fd, annotated). PSNR and LPIPS diverge compared with fast: PSNR rewards blur.
- B: cinematic-bounded (7000 it, thresh 0.0008, refine 300), `running`.
  Projection: a count of about 180k, which is at most 85% of the cap, from the 55KB per Gaussian figure.
- The baseline row for scene 1 is the one that dominates when B ends. Do NOT freeze before that.
- B FAILED: OOM 10925 at step 3430. It GOT PAST the resolution jump of the schedule
  (quarter to half at 3000). Then the buffers (4 times larger) killed it. The count bound bought
  1200 steps compared with cinematic (about 2200). Memory is a function of count times resolution.
  The JUMP of the schedule is a driver.
- Candidate point C: B plus `--num-downscales 3` or `--resolution-schedule 8000`
  (never doubles in 7000 iters). The trade-off is the final detail.
- The provisional baseline row for scene 1 is medium (the only preset better than fast under the cap today).

## Functional form of the budget (instrumented series, 11-jul)

`peak(step) ≈ count×g(res) + B(res)`.
MEASURED in a re-run of B: before the jump the slope is 2.39 MiB/step. The jump from quarter
to half is a one-time rise of +1336 MiB (additive). It is ALSO a slope increase of 1.55 times, to 3.71 MiB/step
(multiplicative). BOTH terms exist. serieB/series.csv is the evidence.

- C (7000 it, never doubles) is PRE-CONDEMNED by arithmetic. The slope alone reaches the cap at
  about step 3700. This saves a night. C does not run.
- D (derived from the curve): 3000 steps, bounded, schedule 8000, projected 84% of the cap.
  RUNNING. It is the "sharpened C": extra steps inside the quarter regime.
- FOURTH ROW (review): "early resolution under the cap". The jump to half is at step about 500,
  with an aggressive bounded count. The budget is about 4GB + 1336 + 3.7/step, which gives about 1700 steps
  at half. It is BUILDABLE (full-res does NOT fit: it adds a second rise and the slope). It runs after D.
  - If it wins in LPIPS, resolution was the dominant lever.
  - If it loses, the quarter regime is the real ceiling. Then SH and appearance stay as the
    only levers, by elimination (structural branch).
  - The third suspect: PSNR of about 14 can come from quarter resolution against full GT.
    This is cheaper to test than the NaN.
- TABLE RULE: each row carries train_res_regime (quarter | half@N | full@N). The number
  travels with its measurement regime.

## Scene 1 row: CLOSED provisionally (11-jul, 5 points measured)

| point | regime | PSNR/SSIM/LPIPS | peak (proj→obs) |
|---|---|---|---|
| fast 1000 | quarter | 14.41/.394/.748 | — |
| **medium 2000** | quarter | **14.14/.356/.572** ← ROW | — |
| D 3000 bounded | quarter | 14.23/.375/.640 | 9240→7449 (−24%) |
| B 7000 bounded | quarter, then half@3000 | OOM @3430 | ≤85%→10925 |
| E 2000 bounded | whole half | 14.30/.386/.696 | 6749 (61%) |

MEASURED LESSONS:

1. Count matters more than steps. D loses against medium with +1000 steps.
2. Count matters more than resolution at this budget. E at half loses against medium at quarter.
3. The MiB/step slope depends on the config. The projection for D missed by −24% (conservative).

OPEN CELL: E' combines half resolution with aggressive densification (E left 4GB unused). It is a
candidate if a Phase 2 lever needs it. The THIRD SUSPECT of PSNR about 14 (res quarter) is WEAKENED:
LPIPS got worse when the run paid for half resolution. So SH=0 and exposure stay in front, by partial
elimination. Experiment 2.0 stays as the next one, with its pre-declared protocol. After it:
scenes 2-3 (with their own half point by design), then the frozen table.

## E' (equal budget, closes scene 1 FOR REAL): running 11-jul

E' combines full use of half resolution with aggressive densification (0.0003/150). The target is about 85% of the cap.
The readings come first, before the result:

- E' loses: "densification is the dominant use of the budget" is DEMONSTRATED with equal budgets.
  No one can attack the medium row. The bar for 2.0 RISES. The SH-fix competes for the same budget
  as the dominant lever. It must buy more LPIPS than it loses when it gives up count.
- E' wins: THE ROW changes. The third suspect (res quarter) revives.
- Scenes 2-3: the points aim to FALSIFY the laws. They do not repeat the sweep. The questions are:
  does a medium-equivalent fit with 214 img? Does the stratified split protect the sources?
  Use 2-3 points per scene, projected.
- CANARY: the plan lists it explicitly as item 1 of the fresh session (end of limbo).

## SCENE 1: CLOSED (11-jul, equal budget met)

The medium instrumented re-run has peak 6992 (63.6%). It is the SAME class of spend as E' (6763, 61.5%).
The LAW is DEMONSTRATED with equal budgets: **at the same spend, aggressive densification at quarter resolution beats
the half-resolution run** (LPIPS 0.567 compared with 0.630).

FINAL ROW: medium. LPIPS 0.567 plus or minus 0.005 (reproduced: 0.572/0.567),
PSNR 14.2 plus or minus 0.13, peak about 7GB, quarter regime, trained clean-9fb62fd.

The reproducibility of the harness is plus or minus 1% LPIPS between identical runs (this is the
uncertainty of the table).

Model note (5th correction): ALL presets under the cap land at 61-64%.
The densification limits itself at 2000 iters. The pressure of the cap comes from LONG runs, where the count
compounds. The bar for 2.0 is HIGH (the SH-fix competes against the dominant lever that the data shows).
Next: scenes 2-3 as directed falsification, then the frozen table, then 2.0. The canary is item 1 of the fresh session.

## Closing precisions (review 11-jul night)

1. EXACT WORDING of the law: "at the spend that both configs reach NATURALLY (about 7GB), densification
   at quarter resolution is better than half resolution". The region from 64% to 85% is still open.
   IMPLICIT FINDING: **the cap does NOT limit the presets of the medium class in this scene**.
   All the OOMs of the arc came from the resolution jump. None came from pure count at quarter resolution.
   The scene saturates its densification under the budget. Scene 2 (214 img) is the first test with the cap BITING.
2. Reproducibility of plus or minus 1% LPIPS: n=2, PRELIMINARY estimate. A third point is free with the
   control re-run of scenes 2-3.
3. THE BAR FOR 2.0 DROPPED. The cap does not limit the count. So SH degree 3 (3 to 48 coefs + Adam) over the
   count of medium probably FITS in the 4GB of headroom. That gives case (a): comparison at EQUAL COUNT.
   This is the purest version: the same Gaussians with and without view-dependent color, and LPIPS answers
   the clean question. If the projection of the model (5 clauses) says it does not fit, case (b) applies.
   Case (b) gives up count and has a high bar. The projection decides the case BEFORE the run uses the
   budget. This is the 6th test of the model. The NaN still goes FIRST: nothing matters if the divergence
   has no fixable cause. Table: for each row, note the natural spend and the cap.

## GUARD for scenes 2-3 (closing review, 11-jul)

"It is only execution" came before the P0, before the budget collision and before the correction of the
series. This is the pattern of the arc. The treatment is mandatory:

- Scene 2 (214 img): the projection is WRITTEN IN ADVANCE (7 times the first points). The 5 clauses of the
  model come from measurements with 30 cams, so this is new territory. The event has the key figures wired in.
  The budget includes at least 1 unplanned cell.
- Scene 3: the multi-source regen is the FIRST real exercise of the merge gate after the refactor.
  It is a test of its own, BEFORE any train run. It has the same treatment.

If the scenes are dull, you lose 10 min. If not, the diagnosis already has a frame.

## Scene 2 (214 img): THIRD TERM of the model + regime decided (11-jul)

The guard paid off BEFORE the job entered the queue. Probes of 50 iters showed that OpenSplat loads ALL the
images upfront as tensors (about 64MB per img float32 at 3072px). **At full-res, scene 2 dies in the
middle of the load step** (214×64MB≈13.7GB, which is more than the cap). The log stops in the middle of the load with no
error. This is a SIGKILL. With `-d 2` it completes.

VERDICT: the regime of scene 2 is `-d 2`, from the load step. The hardware decided it. Note it as the
condition of all its rows.

The MEMORY MODEL gets its 3rd term:
`base_imgs ≈ n_train × px_w × px_h × 12B / d²`.
This term dominates in large scenes. It is invisible in scene 1 (22 imgs, 1.4GB).
The "PASS" of 7-jul for this scene before the cap (55MB splat) was another swap-swim.

U1.3 (preflight) inherits the term. It is the FIRST check, before densification (cheap and deterministic).
Scene 2 cell: (c-extreme). Row 1 is medium@-d2. Its run is in progress.

## Scene 2: CLOSED (2 directed points, 11-jul)

| row | LPIPS | PSNR | peak | verdict |
|---|---|---|---|---|
| medium@-d2 (aggressive) | **0.615** ← ROW | 13.53 | 8354 (76%) | dominant error: high frequency (facades/vegetation), no floaters and no exposure drift. This is the signature of the -d2 regime |
| bounded@-d2 | 0.628 | 13.57 | 8085 | THE LAW TRAVELS with a SHRUNKEN margin (Δ0.013 compared with Δ0.058 in scene 1): in a biting regime the base flattens the advantage |

Regime: `-d2` from the load (hardware). Split 193/21. The check of the GT render at full-res passed.

## Scene 3: IN PROGRESS: double gate (laws + entity E2E)

The job entered the queue through the real /api/odm: **recon_c97cd120a1** (0103+0104, standard).
It is the first combined scene with its own identity in production.
The E2E checklist at completion:

- merge_label FULL expected (test #2: 17,006 matches)
- the card renders (null-safe join)
- share `?m=recon_…`
- the viewer
- the splat

After this comes the eval row, with a split stratified by source (by_source in the eval block).

### Reading rules for scene 3: WRITTEN IN ADVANCE (review, before the verdict)

1. ORDER: merge_label first (gate entity/pipeline), eval after (quality gate). Do NOT mix them.
   If the label is FULL but the by_source numbers differ a lot, the result is "merge OK, quality not uniform".
   If the label is PARTIAL but the global LPIPS is good, the result is "good for what REMAINED". If the label is not FULL, suspect 1 is the recon_/--proj-id wiring
   (prefixes/geotag). It is NOT the geometry. Test #2 cleared the geometry (17,006 matches, these exact
   sources, through the harness). This run goes through production.
2. by_source gets a provisional imbalance rule at its first use. The repro is plus or minus 1% (n=2), and
   there are about 4-6 views per source. A per-source ΔLPIPS under 0.03 is probable noise from the small sample.
   A ΔLPIPS over 0.08 is a signal (a source that is worse reconstructed). For a value in between, note it
   and draw no conclusion. Known confound: the views of each source look at DIFFERENT parts of the scene
   (content, not only source).
3. E2E that the fixtures do not cover: card, then share ?m=recon_…, then viewer, then splat load. This is the full
   production path. If it passes, the entity is EXERCISED, not only migrated.
4. Table: check the regime (-d) that production chose, BEFORE you compare LPIPS.
   Header: deltas compare WITHIN a scene. Across scenes, only qualitative signatures travel.

### Scene 3: two addenda before the verdict (mid-flight review)

5. SILENT OWN REGIME: production chose 2688px (balanced profile). It chose neither 3072 (origin of
   scenes 1-2) nor 1536 (-d2). Row 3 is the first to use train_input_px:2688. Its eval GT has the 2688 size.
   The expected render_px is [2687,~1511], NOT [3071,1727]. Check this WHEN the eval runs, not after you
   read the LPIPS. If GT and render are consistent with each other, the result is valid. "Full GT" means
   something else in this row (note it).
6. The verdict tests the pruning, not only the entity: 81 frames (23+58, pruning active) against 169 in
   test #2 (no pruning, on purpose). THIRD BRANCH written in advance: FULL with 81 is a STRONGER result
   than test #2. The merge survives the pruning. The amendment "never dedup cross-source" holds in
   production. PARTIAL gives a new suspect: the pruning removes anchor frames of one source (hypothesis of
   review #4, session 1). It is neither wiring (cleared in advance with artifacts) nor geometry (test #2).

# ══════════ FROZEN BASELINE TABLE, 2026-07-11 ══════════

Header rule: deltas compare WITHIN a scene. Across scenes, only qualitative signatures travel.
All runs use the same settings:

- a deterministic split with seed=cid
- test views not in the train set
- render and GT from the internal path of the trainer
- GT at the resolution of the regime (render_px in each eval block)
- preset=medium (the one that fits under the cap)

| Scene | LPIPS | PSNR | SSIM | peak (cap%) | regime | dominant error (eye) | run_id |
|---|---|---|---|---|---|---|---|
| 1 easy 30cams | **0.567±0.005** (n=2) | 14.2±0.13 | 0.357 | 6992 (64%) | quarter-schedule @3072 | uniform global blur | 20260711-135601-medium |
| 2 large 214img | **0.615** | 13.53 | 0.355 | 8354 (76%) | -d2 from the load (hardware) | high frequency (facades/vegetation), 0 floaters, 0 exposure drift | 20260711-142911-medium_d2 |
| 3 multi 0103+0104 | **0.667** | 11.16 | 0.255 | 8801 (80%) | 2688 balanced (production) | pose/parallax shift in cross-source views + peripheral blur; NO exposure bands | 20260711-144810-medium |

Scene 3 extra: the merge is FULL under pruning (22/23+57/58). The by_source Δ is noise (ΔPSNR 0.07,
ΔSSIM 0.024, n=2/6, under the threshold of 0.03). Note: by_source has no per-view LPIPS yet. Add it
before 2.0. Identity recon_c97cd120a1 (entity E2E passed).

LAWS (validity noted):

- At equal budget, aggressive densification beats more steps, and more steps beat resolution (scene 1).
  Scene 2 shows the same law with a shrunken margin of Δ0.013.
- The cap does not bind in small scenes (scene 1: 64%). It bites in large scenes (scenes 2-3: 76-80%).

PHASE 2 SUSPECTS BY SCENE (from the eye, not from the average):

- Scene 1: SH=0 and resolution quarter (E' weakened resolution).
- Scene 2: load resolution (blocked by hardware and cap).
- Scene 3: cross-source POSE (2.1) more than appearance (2.2). The multi-source scene points to pose
  refinement, which OpenSplat does NOT expose (migration).

2.0 (SH) runs in scene 1 with its pre-declared protocol. The case for 2.1 just won its first product evidence.

# ═══════════════════════════════════════════════════════════

### Protocol 2.0: addendum to the "survival" branch of the NaN-repro (written in advance)

Suppose the repro survives 3000 steps. This does NOT mean "the ghost died". It clears THIS cell only
(this config, this scene, this count, MPS). It does not clear cinematic@7000 with full densification, where
production runs and can hit the NaN. The record does not name the cell of the first diagnosis for the workaround.

Conclusion: "not reproduced in the tested cell, so SH is RELEASED for 2.0 with NaN-WATCH active".
The NaN-WATCH detects nan in the loss and stops with step and context. It does not crash silently.
The abort_re of run_tracked already does this in production, and the harness inherits it.

If the full 2.0 also survives, the workaround dies with evidence from TWO cells. The watch stays as a
cheap permanent guard. Canary: runs 1-4 CALIBRATE and do not alert (a-priori thresholds, to re-derive from the series after one month).

### NaN-repro: SURVIVED (11-jul): cell cleared, ghost not dead

The test ran 3000 steps, SH degree 3, jump at 1000, MPS. The result is ZERO nan in the loss (0.081 final,
model 67MB: the 48 coefs are visible, compared with about 13-25MB at SH=0).

Process note: the monitor
shouted "NaN" because it matched the NAME of the dir nan-repro/. The name I chose caused this false positive.
I corrected it after I read the log. 2.0 runs with NaN-watch (abort_re already exists in
production, and the harness inherits it). Step 1 of the protocol: passed.

Next in 2.0: the memory projection with the model of 3 terms (67MB@3000steps already hints at the term
count×48coefs). Then case a/b, then the run.

# ═══ Phase 2: experiments compared with baseline-v1 ═══

## 2.0 SH released: VERDICT: NEGATIVE with named mechanism (11-jul)

| cell | LPIPS↓ | PSNR | peak (proj→obs) | n | regime | eye |
|---|---|---|---|---|---|---|
| SH=0 (baseline-v1) | 0.567±0.005 | 14.2 | 6992 | 8 | quarter@3072, 2000it | blurry, CLEAN |
| SH=3, interval 1000 | 0.5675 (tie) | 14.18 | 7032→6668 (−5%, test no. 7 passed) | 8 | same | VETOED: directional streaks |
| SH=1, interval 1000 | 0.648 | 11.2 | 7005→6290 | 8 | same | TOTAL DESTRUCTION (shards) |

READING (pre-declared, branch 3 ran, mandatory CLAUSE): the workaround protected quality
**in OpenSplat, at 2000 iters, with a mid-run transition**. The evidence condemns the violent transition
in this trainer. It does not condemn SH itself.

SH from step 0 is NOT tested, *because OpenSplat does not expose it*.
This is how splatfacto and gsplat train it, with their own LR schedule for coefs. This is a reason to
migrate. It is not a conclusion about SH.

Mechanism: the TRANSITION (turn on the SH coefs in the middle of
the run, at step 1000) destabilizes the optimization. A lower degree does NOT soften it (SH=1 is much worse
than SH=3 in quality). On MPS it no longer diverges (repro: 0 nan/3000 steps), but it still wrecks the
result.

The veto by eye saved the conclusion. LPIPS averaged the streaks of SH=3 against the color gain
and reported a "harmless tie". This is the perceptual version of the false 82%.

IMPLICATIONS (written in advance, they run):

- (a) Appearance and exposure (2.2) RISE to main suspect of the quality ceiling.
- (b) The trainer MIGRATION revives with a double reason. One reason is 2.1 pose (named by scene 3).
  The other is SH-from-step-0 and LR-warmup of coefs (surgery that OpenSplat does not expose).
- (c) The workaround STAYS (with a documented reason, no longer folklore).

NEXT candidate 2.0b (NOT run today, zero extra levers): SH active from step 0 through a minimal
--sh-degree-interval. That semantic does NOT exist in OpenSplat (interval=1 raises the degree at every
step: 3 times the transitions). Check the semantics before you design it. It probably falls into the same
surgery. Total cost of the experiment: 2 cells of about 95s each, plus the evals.

### Evidence for the "cross-source pose" reason (full trail, asked by the review)

Origin: the EYE signature of row 3 of baseline-v1. In the side-by-side
`eval/recon_c97cd120a1/20260711-144810-medium/renders/sxs_0_s0_f_0003.jpg.jpg`, view s0_ (source 0103) shows
a SHIFT of frame position and pose against GT (correct content, shifted position) plus peripheral blur.
There are NO exposure bands, in spite of two light conditions.

Weak numeric corroboration: the PSNR of the
scene is 11.16 (compared with 13.5-14.2 for single-source), with an even by_source. This is consistent with
a GLOBAL pose error of the fusion. It is not consistent with one bad source.

Status: one eye signature (n=1) and
indirect corroboration. It is a VALID reason for the migration matrix, with its honest weight. It is not a
measured pose delta. To measure it needs re-optimization of poses, which is the blocked lever.

Case study, 2nd edition: "the cheap negative is the final product of the expensive
infrastructure" (line from the review).

## W2 - CUDA baseline + MCMC (Gaussian cap) A/B on Dialectica (2026-09-29)

Plan: `docs/WORLD_UPGRADE_PLAN.md` W2. This is the first **CUDA** baseline. The sections above are the frozen
Mac/OpenSplat baseline on other scenes, so the numbers are not comparable. Then the test uses gsplat
MCMC with a cap. All runs used the PC RTX 4060 Ti 8 GB.

**Setup (identical for every arm).**

- Scene `recon_4e4245a1f4_aoi130`: 428 frames, 3072x1728. The OpenSfM->COLMAP export is the one the worker
  ships (`opensfm/colmap_export` of the parent project `proj_recon_4e4245a1f4`). The aoi130 project has a
  byte-identical `images.txt` and identical shots, but it has no images.
- `prep_dataset` converts FULL_OPENCV to OPENCV, as in production.
- Held-out split: the default split of nerfstudio for colmap: `eval-mode interval, eval-interval 8` (54 eval / 374 train
  views). All arms use the same split. Production trains with it anyway.
- 15,000 iterations, input `d1` (full res), image cache on CPU (production `image_cache_policy`).
- Env: nerfstudio 1.1.5, gsplat 1.4.0+pt24cu124, torch 2.4.1+cu124, driver 610.74.
- Metrics: the PSNR / SSIM / LPIPS(alex) of nerfstudio itself, through `model.get_image_metrics_and_images`.
  The script computes them on the raw (before auto-clean) model at full res. The same script runs every arm
  (`experiments/w2-mcmc-2026-09-29/lib/w2_eval.py`).
- Size: the numbers come from the production chain: `ply_to_splat`, then `autoclean.mjs --preset aerial`, then `splat-transform` SOG.

**Trainer.**

- The installed splatfacto has `DefaultStrategy` hardcoded. It has no `strategy=mcmc` and no cap.
  It does expose `rasterize_mode=antialiased` and `use_bilateral_grid`.
- The team did not add `simple_trainer.py` of gsplat, because it has a different data path, undistort and
  metrics. That confounds the A/B.
- Instead, `pipeline/splatfacto_mcmc.py` subclasses splatfacto with `gsplat.MCMCStrategy`. It uses the
  `simple_trainer mcmc` recipe of gsplat. The recipe values are: init opacity 0.5, init scale x0.1,
  opacity/scale reg 0.01, noise_lr 5e5. The other values are: min opacity 0.005,
  +5% per refine step up to the cap, refine 500..12,500.
- The dataparser, losses, optimizers, LR schedule and export are the same as the baseline.
  Only the densification strategy changes. The run does not change the installed env.

| arm | flags (on top of `--max-num-iterations 15000 ... colmap ... --downscale-factor 1`) |
|---|---|
| base | `ns-train splatfacto --pipeline.model.sh-degree 0 --pipeline.model.stop-split-at 15000` (= gpu_lane `_cuda_config`) |
| mcmc1m | `splatfacto-mcmc --pipeline.model.cap-max 1000000 --pipeline.model.sh-degree 0 --pipeline.model.stop-split-at 12500` |
| mcmc3m | same, `--pipeline.model.cap-max 3000000` |

Results on 54 held-out views. PSNR, SSIM and LPIPS are means. The SOG column is the size after auto-clean:

| arm | PSNR | SSIM | LPIPS | Gaussians (trainer / after clean) | peak VRAM (nvidia-smi) | train | .splat clean | SOG clean |
|---|---|---|---|---|---|---|---|---|
| base (Ultra-15K recipe) | 21.21 | 0.685 | 0.339 | 1.68M / 1.48M | 6.2 GB | 33.4 min | 47.5 MB | 18.4 MB |
| mcmc1m (default allocator) | 21.82 | 0.697 | 0.326 | 1.00M / 0.83M | **7.9 GB** | 35.7 min | 26.5 MB | 10.6 MB |
| mcmc1m + expandable_segments | 21.76 | 0.696 | 0.327 | 1.00M / 0.83M | **2.7 GB** | 36.6 min | 26.5 MB | 10.6 MB |
| mcmc3m (default allocator) | stalled | | | 3M | 7.9 GB, thrashing 6 s/iter at step 12.5K; killed. Ckpt@12K only: 22.19 / 0.717 / 0.294 | | | | |
| mcmc3m + expandable_segments | **22.61** | **0.734** | **0.270** | 3.00M / 2.23M | 4.8 GB | 53.4 min | 71.3 MB | 27.9 MB |

Findings.

- MCMC beats the baseline on every quality metric at the same iterations. The 1M cap gives +0.55-0.61 dB
  PSNR and LPIPS -0.012, with 40% fewer Gaussians and a **42% smaller SOG**. The 3M cap gives +1.40 dB,
  SSIM +0.05 and LPIPS -0.069 (-20%), but the SOG is 52% larger.
- The 7.9 GB peaks with the default allocator come from fragmentation. The reallocations for cap growth cause it.
  Live tensors do not cause it. `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` gives the same quality at
  2.7 GB (1M) and 4.8 GB (3M). The MCMC launcher now always sets it. Without it, 3M is unusable on 8 GB.
- Eye check (GT | base | mcmc, `scratchpad/worlds/w2/sxs_*.jpg`, eval views 2,9,16,23,30,37,44,51):
  MCMC has crisper facade mullions and roof-garden texture, and sharper edges. Base is softer.
  No arm shows visible floaters or sky problems. Trees stay soft in all arms. Cars that move are absent
  in all arms (dynamic objects).
- Caveats:
  - There is one scene and one seed.
  - The metrics are on the raw model, not on the cleaned/SOG model.
  - The run is 15K iterations with the stock LR schedule (the means LR decays over 30K in the method
    config of splatfacto). So the absolute numbers are below a 30K run.
  - The peak of the baseline includes memory of WDDM and of other processes.
  - The test did **not run** arm (d) (antialiased / bilateral grid / SH>0). Antialiased PLYs are not compatible with
    the classic-mode web viewer. The chain for `.splat` and SOG drops SH. So neither can transfer to the product.
  - Not tested: rural scene, d2 fallback of an MCMC preset.
- Verdict: MCMC wins. `mcmc1m` is the "better and smaller" option. It wins PSNR, LPIPS and SOG size.
  `mcmc3m` is the quality tier: best metrics, larger SOG, fits in 4.8 GB. The change adds the presets `mcmc1m` and
  `mcmc3m` as opt-in (`select_only`). The system never resolves them from a bare `iters`, and they are
  never the default. The decision to promote waits for a rural scene.

To reproduce, run these commands on the Mac. The artifacts are in `/Volumes/SSD/drone-vault/experiments/w2-mcmc-2026-09-29/`.
Afterwards, the team removed the scratch directory in WSL: `/root/gpu-jobs/experiments/w2/`.
```
python3 w2_run.py base 15000
python3 w2_run.py mcmc1m-es 15000 --mcmc 1000000 --alloc expandable_segments:True
python3 w2_run.py mcmc3m-es 15000 --mcmc 3000000 --alloc expandable_segments:True
python3 w2_chain.py <arm>            # ply -> .splat -> autoclean(aerial) -> SOG sizes
./w2_pull_renders.sh <arm> && python3 w2_montage.py 16,44 base,mcmc1m-es,mcmc3m-es
```
`w2_run.py` builds the script with `gpu_lane.train_script` (paths rebased to the sandbox). Then it runs eval and `ns-export`.
In production, use `{"preset": "mcmc1m"}`. The `train_args` carry `--pipeline.model.cap-max`. This makes `gpu_lane`
start `splatfacto_mcmc` and ship the module to `/root/gpu-jobs/lib`. `finalize_train` exports either method.

## W2b - MCMC on a rural / vegetation-heavy scene, then promotion of mcmc1m to default (2026-09-30)

This follows W2, which used one urban scene.

- The harness is the same. The team copied it to `experiments/w2b-rural-2026-09-30/` (`w2_run.py`, `w2_chain.py`,
  `w2_montage.py`, `lib/w2_eval.py`, and `lib/splatfacto_mcmc.py`, identical to `pipeline/`).
- The stack is the same: nerfstudio 1.1.5, gsplat 1.4.0, RTX 4060 Ti 8 GB.
- The settings are 15,000 iterations, input d1, image cache on CPU (production policy).
- The eval uses every 8th image (15 eval / 102 train views).
- **All** arms use `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`. The flags are the same as W2.

**Scene: `recon_d77ef7af86`** (117 frames 3072x1728, OpenSfM->COLMAP export as shipped by the worker).

- The selection measured the greenness of `ortho_thumb.webp` at 400 px.
  Greenness is the share of pixels where G is more than 1.05 times R and more than 1.05 times B. d77 scores **0.80**. The next is 0.50 (`DJI_20260706133243_0100_D`, a sports park with
  lawns, urban). The rest score 0.17-0.33. d77 is pasture, forest edges and a few farm buildings.
  Dialectica scored 0.27.
- Caveat compared with the "prefer full_3d" rule: the system publishes d77 as `ortho_25d` (nadir-biased flight,
  117 cameras). It is the only truly rural scene with a ready `colmap_export`. No full_3d scene is rural.
  The greenest full_3d scene (0100_D, 0.50) needs Docker for the export.
- So the held-out views include some ground-level frames (s0/s2). No arm reconstructs them well.

| arm | PSNR | SSIM | LPIPS | Gaussians (trainer / after clean) | peak VRAM | train | SOG clean |
|---|---|---|---|---|---|---|---|
| base (gpu_lane splatfacto flags) | 20.93 | 0.529 | 0.587 | 0.95M / 0.82M | 2.6 GB | 32.1 min | 10.30 MB |
| mcmc1m | **21.64** | **0.536** | **0.535** | 1.00M / 0.76M | 4.7 GB | 51.1 min | **9.75 MB** |
| mcmc3m | crashed twice | | | | 7.6 GB | | |

- mcmc1m compared with base: +0.71 dB PSNR, LPIPS -0.052 (-9%), SSIM +0.007, SOG -5% (Dialectica: +0.55 dB,
  -0.012, -42%). The decision rule holds on the second scene, too. The rule is: PSNR and LPIPS are better AND
  the SOG is not larger than base.
- The SOG gain is small here. Plain splatfacto reached only 0.95M Gaussians on this smaller scene (nothing to
  cap). The win is quality per Gaussian, not size. The costs compared with base are +59% train time (51 and
  32 min) and a 4.7 GB peak. W2 measured 2.7 GB on the larger scene. 4.7 GB is still far below the 8 GB card.
- mcmc3m **failed twice** at step about 7.3K (48%) with `CUDA driver error: device not ready` inside gsplat
  `isect_tiles`. Telemetry showed 7.6 GB used just before. On this scene the 3M cap does not fit reliably on
  the 8 GB card. It did fit on Dialectica, at 4.8 GB. The team tried no mitigation. Treat `mcmc3m` as
  scene-dependent and unsafe on 8 GB until you measure it for each scene.
- Eye check (6 held-out views, GT | base | mcmc1m, `scratchpad/worlds/w2b/sxs_*.jpg`, eval idx 1,3,5,8,10,13):
  - Base shows directional streaks and smears in the grass and pasture (it looks like motion blur).
  - mcmc1m renders grass as a cleaner texture. It keeps roofs, car, fences and pond edges sharper.
  - Trees are soft in both arms. mcmc1m is slightly muddier in some dense canopy, but it has no dropouts,
    holes or floaters.
  - Neither arm has sky problems (aerial views, sky barely visible). The 1M cap does not hurt vegetation here.
  - The ground-level eval view (terrace, id 3) is poor for both arms. A nadir-biased flight explains this.
- The test did **not measure** 30K against 15K for mcmc1m. It takes about 100 min on this scene, which is over
  the 1.5 h budget. So the default ships at the measured 15K schedule (`stop-split-at 12500`).
  `frontier` and `grandmaster` stay selectable for the long schedule.
- Caveats: two scenes, single seed, raw-model metrics, 15 eval views.

**Promotion.** `mcmc1m` is now the interactive default for new splat jobs (`splat_presets.DEFAULT_SPLAT_PRESET`,
exposed as `default: true` in `/api/splat_profiles`). The UI label is `Equilibrado (MCMC 1M)`. The UI label of
`mcmc3m` is `Calidad (MCMC 3M)`. These items stay the same, on purpose:

- bare `{"iters": N}` and preset-less API requests (still `select_only`)
- every other preset
- splats that already exist
- the campaign allow-list (ultra/ultra20/frontier/grandmaster)
- the server fallback of the phased ODM->splat flow

Reproduce: use the same commands as W2 with the scripts of `w2b-rural-2026-09-30/`.
Dataset name `rural`, `EVAL_IDX="1,3,5,8,10,13"`, `--alloc expandable_segments:True`.
The artifacts stay there: `chain/*/*.clean.sog`, `results/` (timing, metrics, telemetry, mcmc3m crash tail), `renders/`.
