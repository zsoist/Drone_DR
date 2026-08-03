# FLIGHTVERSE Adaptive Visual Performance and Flight UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep real-world FLIGHTVERSE scenes fluid and visually intentional while making touch flight controls readable and non-blocking.

**Architecture:** A dependency-free render-quality state machine controls the existing renderer/composer DPR using stable frame windows and hysteresis. The flight runtime adds visibility-aware lifecycle and scalar GPU telemetry; existing terrain shaders own an atmospheric edge treatment, and the existing Image inspector becomes a bounded progressive touch sheet.

**Tech Stack:** Vanilla JavaScript ES modules, three.js r180, postprocessing r180, CSS, Node test runner, Python unittest, Chrome DevTools Protocol, existing no-build web pipeline.

## Global Constraints

- No runtime dependency, CDN, build step, CSP expansion, renderer rewrite, or invented world geometry.
- Manual render-quality modes bypass Auto; Auto stays within DPR `1.00..min(2.00, devicePixelRatio)`.
- Browser acceptance requires zero console errors and sustained `fps >= 50`.
- Exactly one world group and one active structural representation remain visible.
- Touch Image controls consume at most `44dvh`, scroll internally, and preserve 44px targets.
- Every batch that edits `web/` runs `python3 pipeline/bump_web_version.py`.
- Commits run with `PATH=/Volumes/SSD/_system/venv/bin:$PATH`; never bypass the smoke hook.

---

## File Structure

- `web/flightverse/render-quality.js`: pure adaptive tier state machine and frame statistics.
- `pipeline/test_render_quality.mjs`: literal governor behavior tests.
- `web/volar.js`: governor wiring, visibility lifecycle, renderer telemetry, and touch inspector state.
- `web/flightverse/scene.js`: terrain-edge uniforms and diagnostic opt-out.
- `web/style.css`: compact touch Image sheet and presentation states.
- `pipeline/test_volar_mobile.py`: runtime/CSS source contracts.
- `pipeline/browser_matrix.py`: live frame/render/UI overlap assertions and screenshots.
- `docs/GAME_ENGINE.md`: adaptive performance and presentation contract.

### Task 1: Pure adaptive quality governor

**Files:**
- Create: `web/flightverse/render-quality.js`
- Create: `pipeline/test_render_quality.mjs`

**Interfaces:**
- Produces: `createRenderQualityGovernor({deviceDpr, initialDpr, now})`
- Produces method: `sample(frameMs, timestamp) -> {changed, dpr, reason, stats}`
- Produces method: `reset(timestamp) -> void`
- Produces method: `snapshot() -> {dpr, tier, changes, reason, avgMs, p95Ms, samples}`

- [ ] **Step 1: Write failing tests**

Use deterministic sequences: sixty `16.7ms` samples stay stable, isolated
`45ms` spikes do not downgrade, sustained `24ms` windows downgrade one tier,
cooldown blocks a second immediate change, a longer `15ms` recovery upgrades,
and reset clears samples without changing DPR.

- [ ] **Step 2: Verify RED**

Run `node --test pipeline/test_render_quality.mjs`.
Expected: module-not-found failure.

- [ ] **Step 3: Implement the state machine**

Use fixed tier values, bounded samples, p95 sorting on a copied array, separate
slow/recovery window counters, and timestamp cooldowns. Reject non-finite or
non-positive samples.

- [ ] **Step 4: Verify GREEN**

Run `node --test pipeline/test_render_quality.mjs`.
Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit `web/flightverse/render-quality.js` and `pipeline/test_render_quality.mjs`
as `feat: add stable adaptive render governor`.

### Task 2: Runtime lifecycle and renderer telemetry

**Files:**
- Modify: `web/volar.js`
- Modify: `pipeline/test_volar_mobile.py`

**Interfaces:**
- Consumes: `createRenderQualityGovernor`
- Produces: `report.render = {dpr,tier,changes,reason,avgMs,p95Ms,calls,triangles,geometries,textures,pauses,resumes}`

- [ ] **Step 1: Add failing source-contract tests**

Assert the governor import, renderer/composer size parity, visibility handler,
loop timing reset, finite scalar counters, and no legacy two-second FPS
interval.

- [ ] **Step 2: Verify RED**

Run `/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_volar_mobile -v`.

- [ ] **Step 3: Wire Auto quality**

Feed actual render-frame duration to the governor once per rendered frame.
Apply changed DPR once, keep manual modes fixed, and update the visible FPS
label with the actual Auto DPR only when diagnostics are enabled.

- [ ] **Step 4: Add visibility lifecycle**

On hidden, stop the loop and increment pauses. On visible, reset governor and
loop timing before restart; remove the listener on pagehide.

- [ ] **Step 5: Publish scalar telemetry**

Refresh `report.render` at one-second cadence from governor snapshot and
`renderer.info`, then include it in the automated completion report.

- [ ] **Step 6: Verify GREEN**

Run the Python contract and Node governor tests.

- [ ] **Step 7: Commit**

Commit runtime and tests as `feat: adapt flight rendering to sustained load`.

### Task 3: Compact progressive touch Image sheet

**Files:**
- Modify: `web/volar.js`
- Modify: `web/style.css`
- Modify: `pipeline/test_volar_mobile.py`
- Modify: `pipeline/browser_matrix.py`

**Interfaces:**
- Produces DOM state: `#vl-grade.compact` and `#gr-expand[aria-expanded]`
- Browser report: `imageSheet = {heightRatio, viewportVisibleRatio, launchersReachable, documentOverflow}`

- [ ] **Step 1: Add failing contract and matrix assertions**

Assert expand control, coarse-pointer compact default, `max-height:44dvh`,
internal `overflow-y:auto`, 44px actions, mobile-sheet mutual exclusion, and
live geometry ratios.

- [ ] **Step 2: Verify RED**

Run the mobile unit test.

- [ ] **Step 3: Implement progressive DOM state**

Put advanced sliders in an inner body, add a 44px expand button, persist only
the expanded preference, and close menu/combat before opening Image.

- [ ] **Step 4: Implement touch layout**

Use a fixed bottom sheet with safe-area padding. Compact mode shows the header
and three presets; expanded mode is capped and internally scrollable. Preserve
desktop dragging unchanged.

- [ ] **Step 5: Verify unit and browser geometry**

Run the mobile test and the Volar slice of `pipeline/browser_matrix.py`.

- [ ] **Step 6: Commit**

Commit UI, CSS, and tests as `fix: keep image controls clear of touch flight`.

### Task 4: Honest atmospheric world frontier

**Files:**
- Modify: `web/flightverse/scene.js`
- Modify: `web/volar.js`
- Modify: `pipeline/test_volar_mobile.py`

**Interfaces:**
- Produces terrain uniforms: `uFrontierOn`, `uFrontierWidth`, `uFrontierColor`
- Consumes query flag: `diagnostic=1` disables the visual treatment.

- [ ] **Step 1: Add failing shader-contract tests**

Assert the three uniforms, UV-edge factor, color mix without fragment discard,
diagnostic opt-out, and unchanged one-representation contracts.

- [ ] **Step 2: Verify RED**

Run the mobile/source contract suite.

- [ ] **Step 3: Extend the terrain shader**

Compute `edge = smoothstep(0.0, uFrontierWidth, min(min(vFvUv.x,
vFvUv.y), min(1.0-vFvUv.x, 1.0-vFvUv.y)))` and mix a scene-matched haze into
the final diffuse color only near the edge. Do not change alpha, depth, masks,
or geometry.

- [ ] **Step 4: Wire presets and opt-out**

Day, sunset, and night update frontier color through the same sky preset path.
`diagnostic=1` sets `uFrontierOn` to zero.

- [ ] **Step 5: Verify GREEN**

Run unit/source tests and capture desktop plus mobile screenshots for visual
inspection.

- [ ] **Step 6: Commit**

Commit shader and tests as `fix: soften real-world capture frontiers`.

### Task 5: Full gates, versioning, and documentation

**Files:**
- Modify: `pipeline/browser_matrix.py`
- Modify: `docs/GAME_ENGINE.md`
- Regenerate: changed `web/*.gz` and web version references.

**Interfaces:**
- Browser pass requires `fps >= 50`, finite `p95Ms`, finite render counters,
  `imageSheet.viewportVisibleRatio >= 0.56`, one world group, and one active
  representation.

- [ ] **Step 1: Finish browser assertions**

Record Auto DPR transitions, render counters, visibility resume, UI geometry,
console errors, and structural uniqueness in the matrix JSON.

- [ ] **Step 2: Bump and regenerate web assets**

Run `python3 pipeline/bump_web_version.py`.

- [ ] **Step 3: Run focused and full verification**

Run Node tests, Python unit tests, JavaScript syntax checks, smoke, Volar
browser gate, and all three matrix viewports.

- [ ] **Step 4: Inspect screenshots**

Confirm the world remains dominant, no sheet/button overlap exists, the
frontier is subtle rather than opaque, and no representation duplicates.

- [ ] **Step 5: Document and commit**

Document thresholds and diagnostics in `docs/GAME_ENGINE.md`, commit all
generated assets as `ops: gate adaptive world presentation`, and push the
branch.
