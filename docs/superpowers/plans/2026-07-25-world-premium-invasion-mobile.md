# World Premium Invasion and Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AeroBrain World deployment collision-safe, upgrade Invasion to performant GLB enemies with deliberate AI, and make all flight/combat flows predictable on touch devices.

**Architecture:** Collision and deployment correctness remain Python-owned gates. Invasion is decomposed into pure AI/LOD policy modules plus a Three.js scene adapter. Touch input and overlay coordination expose small stateful controllers that can be unit-tested without rendering.

**Tech Stack:** Python 3, unittest, glTF 2.0/GLB, ES modules, Node test runner, Three.js r180, Chrome CDP.

## Global Constraints

- Active World browser gates must sustain at least 50 fps.
- Touch targets must be at least 44 CSS pixels.
- Enemy and projectile counts must be bounded by device tier.
- Candidate validation happens before the live service restart.
- Existing procedural enemies remain a recovery fallback.

---

### Task 1: Collision asset correctness

**Files:**
- Modify: `pipeline/collision_bake.py`
- Modify: `pipeline/test_world_collision.py`

**Interfaces:**
- Consumes: glTF JSON, binary buffers, default scene nodes.
- Produces: `parse_glb(path) -> tuple[vertices, faces]` in world coordinates.

- [ ] Write tests that create translated, rotated, scaled, and repeated-node GLBs and assert all transformed instances are present.
- [ ] Run `python3 -m unittest pipeline.test_world_collision -v` and confirm the new cases fail.
- [ ] Traverse the active glTF scene, accumulate parent matrices, transform vertex positions, and append faces per node instance.
- [ ] Replace centroid-only vertical rejection with triangle/band intersection checks that preserve the in-band section of tall walls.
- [ ] Run the collision unit tests and `python3 pipeline/audit_world.py`.
- [ ] Commit the collision parser and filtering fix.

### Task 2: Fail-closed deployment gates

**Files:**
- Modify: `pipeline/aerobrain_server.py`
- Modify: `pipeline/test_static_gzip_freshness.py`
- Modify: `pipeline/safe_restart.sh`
- Modify: `pipeline/flightverse_collision_gate.py`
- Modify: `pipeline/test_deploy_world_gate.py`
- Modify: `pipeline/world_runtime_sweep.py`
- Modify: `pipeline/test_world_runtime_sweep.py`

**Interfaces:**
- Produces: freshness decision based only on sidecar mtime equality/newness.
- Produces: preflight gate that runs before `launchctl kickstart`.
- Produces: browser stress actions with fire and reload evidence.

- [ ] Add failing regressions for restored stale gzip, preflight ordering, real stress actions, terrain-only collision, and preferred-mesh activation.
- [ ] Run the focused Python tests and record expected failures.
- [ ] Remove ctime freshness, validate candidate assets/runtime before restart, and add post-restart health verification.
- [ ] Make live stress perform deterministic weapon actions and scene reloads, then validate fired/exploded deltas.
- [ ] Align terrain-only and preferred-mesh runtime contracts.
- [ ] Run focused tests, smoke, World audit, runtime sweep, and collision gate.
- [ ] Commit deployment safety.

### Task 3: Invasion policy and AI

**Files:**
- Create: `web/flightverse/invasion-policy.js`
- Create: `pipeline/test_invasion_policy.mjs`
- Modify: `web/flightverse/invasion.js`
- Modify: `web/volar.js`

**Interfaces:**
- Produces: `selectEnemyLod(type, distance, tier, budget)`.
- Produces: `steerGroundEnemy(input)` and `nextEnemyState(input)`.
- Produces: bounded device budgets and QA telemetry.

- [ ] Write Node tests for LOD thresholds, caps, attack bands, blocked-route steering, separation, predictive aim, state transitions, and deterministic seeded decisions.
- [ ] Run `node --test pipeline/test_invasion_policy.mjs` and confirm failure.
- [ ] Implement pure policy functions with no Three.js dependency.
- [ ] Load catalog-declared LODs, preload selected enemies, swap detail only within budget, and expose fallback/LOD telemetry.
- [ ] Replace direct pursuit with state-driven ground and air behavior; cap enemies, timers, and shots.
- [ ] Add difficulty selection, countdown, score/combo feedback, and full cleanup.
- [ ] Run Node tests, syntax checks, and Invasion browser QA.
- [ ] Commit Invasion.

### Task 4: Adaptive mobile controls and sheets

**Files:**
- Modify: `web/flightverse/touch.js`
- Create: `pipeline/test_touch_controls.mjs`
- Modify: `web/volar.js`
- Modify: `web/style.css`
- Modify: `pipeline/test_volar_mobile.py`
- Modify: `pipeline/browser_matrix.py`

**Interfaces:**
- Produces: touch controller with `sample()`, `setEnabled(bool)`, and `dispose()`.
- Produces: one exclusive overlay coordinator and scrim.

- [ ] Write failing tests for dynamic stick origins, clamping, cancellation, disable/reset, disposal, sheet exclusivity, outside dismissal, and accessibility state.
- [ ] Implement the controller and overlay coordinator.
- [ ] Replace fixed mobile panels with safe-area bottom sheets and preserve desktop draggable panels.
- [ ] Add phone/iPad portrait and landscape overlap assertions plus screenshots to the browser matrix.
- [ ] Run Python/Node tests and all device profiles.
- [ ] Commit mobile UX.

### Task 5: Release verification

**Files:**
- Modify: generated web version references and gzip sidecars.
- Modify: `.gstack/qa-reports/qa-report-world-2026-07-25.md`
- Modify: `.gstack/benchmark-reports/2026-07-25-world-v291-benchmark.md`
- Create: `.gstack/canary-reports/world-v295.md`

**Interfaces:**
- Produces: one reviewed, pushed PR and production evidence.

- [ ] Run `python3 pipeline/bump_web_version.py`.
- [ ] Run compile, smoke, focused tests, asset audits, every-map runtime sweep, collision stress, and mobile browser matrix.
- [ ] Review the complete diff and remediate actionable findings.
- [ ] Commit generated assets, push the branch, and update the draft PR evidence.
- [ ] Deploy with `pipeline/safe_restart.sh server`.
- [ ] Verify public health/login boundary and authenticated loopback World, then update QA, benchmark, and canary reports.

