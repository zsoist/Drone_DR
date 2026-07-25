# FLIGHTVERSE World Collision and Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every published FLIGHTVERSE world collision-complete, visually continuous, duplicate-free, and deterministic for the drone, bullets, missiles, proximity fuses, and boundaries.

**Architecture:** A pure collision-math module supplies independently testable segment and boundary primitives. A browser world-query service owns the structural BVH, terrain, boundary, and sweep queries used by both the fixed-step drone runtime and weapons. Publication builds and audits versioned colliders and mesh coverage masks; rendering uses one structural representation plus a masked terrain fallback.

**Tech Stack:** Vanilla JavaScript ES modules, three.js r180, three-mesh-bvh r180, Python 3.14 with NumPy/Pillow, unittest, Chrome DevTools Protocol, existing no-build web pipeline.

## Global Constraints

- No runtime npm dependency, CDN, build step, CSP expansion, or new physics engine.
- Game physics and projectile decisions run at the fixed `1/120`-second step.
- God mode remains noclip; every other mode fails closed on physical collision.
- Photogrammetry remains immutable; gameplay destruction affects only game terrain and explicit destructibles.
- Every batch that edits `web/` runs `python3 pipeline/bump_web_version.py`.
- Browser acceptance requires zero console errors and sustained `fps >= 50`.
- Python commands that need scientific dependencies use `/Volumes/SSD/_system/venv/bin/python3`.
- Commits run with `PATH=/Volumes/SSD/_system/venv/bin:$PATH`; never bypass the smoke hook.

---

## File Structure

- `web/flightverse/collision-math.js`: dependency-free segment, target, boundary, and earliest-hit math.
- `web/flightverse/world-collision.js`: collider loading, BVH/terrain casts, conservative drone sweeps, QA state, and disposal.
- `web/flightverse/runtime.js`: fixed-step drone sweep/slide/depenetration integration.
- `web/flightverse/weapons.js`: fixed-step swept bullets/missiles and target-only proximity.
- `web/flightverse/objects.js`: normalized target radius contract and owned-resource teardown.
- `web/flightverse/invasion.js`: normalized enemy target radius contract.
- `web/flightverse/scene.js`: scene generation token, representation handles, coverage-mask loading, idempotent teardown.
- `web/volar.js`: world-query wiring, fixed-step weapons/invasion, explicit representation state, native boundary, lifecycle QA.
- `pipeline/collision_bake.py`: GLB/OBJ collider source parsing, transformation, filtering, fingerprinting, atomic output.
- `pipeline/mesh_coverage.py`: rasterized XZ triangle coverage aligned to the DSM grid.
- `pipeline/scene_manifest.py`: automatic collider/mask build and versioned capability publication.
- `pipeline/audit_world.py`: active-world publication audit.
- `pipeline/test_world_collision.py`: Python collider builder, manifest, audit, and source-contract tests.
- `pipeline/test_collision_math.mjs`: Node behavioral tests for pure collision math.
- `pipeline/flightverse_collision_gate.py`: deterministic browser collision scenarios and 100-run stress mode.
- `pipeline/browser_matrix.py`: world representation, uniqueness, visual-continuity, and 50-fps assertions.
- `docs/GAME_ENGINE.md`, `docs/FLIGHTVERSE_IMPLEMENTATION.md`, `docs/README.md`: current collision and gate contracts.

---

### Task 1: Pure swept-collision math

**Files:**
- Create: `web/flightverse/collision-math.js`
- Create: `pipeline/test_collision_math.mjs`

**Interfaces:**
- Produces: `segmentSphereHit(start, end, center, radius) -> null | {fraction, point, normal}`
- Produces: `segmentCircleBoundaryHit(start, end, radius) -> null | {fraction, point, normal}`
- Produces: `segmentSquareBoundaryHit(start, end, halfExtent) -> null | {fraction, point, normal}`
- Produces: `earliestHit(hits) -> null | hit`
- Produces: `normalizeTargetRadius(target) -> number`

- [ ] **Step 1: Write failing literal-fixture tests**

Cover hit, miss, tangent, starting-inside, earliest-hit ordering, circle crossing, square crossing, and the legacy enemy `r2` double-square regression. Expected fractions and points must be hand-derived literals.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test pipeline/test_collision_math.mjs
```

Expected: failure because `web/flightverse/collision-math.js` does not exist.

- [ ] **Step 3: Implement minimal dependency-free math**

Use plain `{x,y,z}` inputs and return fresh plain vectors so Node can import the module without browser shims. Clamp roots to `[0,1]`, reject non-finite/negative radii, and return the inward boundary normal.

- [ ] **Step 4: Verify GREEN and mutation resistance**

Run:

```bash
node --test pipeline/test_collision_math.mjs
```

Temporarily invert the quadratic discriminant branch, confirm the suite fails, then restore and confirm it passes.

- [ ] **Step 5: Commit**

```bash
git add web/flightverse/collision-math.js pipeline/test_collision_math.mjs
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "test: define swept collision primitives"
```

---

### Task 2: Publication-grade collider and coverage builders

**Files:**
- Modify: `pipeline/collision_bake.py`
- Create: `pipeline/mesh_coverage.py`
- Create: `pipeline/test_world_collision.py`

**Interfaces:**
- Produces: `collision_bake.build(cid, *, vault=VAULT) -> dict`
- Produces: `collision_bake.validate(cid, *, vault=VAULT) -> dict`
- Produces: `mesh_coverage.build(cid, *, vault=VAULT) -> dict`
- Collision metadata schema: `{version, source, source_fingerprint, verts, tris, bytes_pos, bytes_idx, bounds, bounds_y}`
- Coverage metadata schema: `{version, bin, grid, covered_pct, source_fingerprint}`

- [ ] **Step 1: Write failing temporary-vault tests**

Create literal DSM, OBJ, and GLB fixtures. Assert OBJ-to-world mapping `(x,y,z) -> (x+offsetX, z+offsetZ-elevMin, -y-offsetY)`, triangulation of quads, degenerate removal, vertical-band filtering, compact indices, atomic files, stale fingerprint rejection, and triangle-rasterized coverage cells.

- [ ] **Step 2: Verify RED**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_world_collision -v
```

Expected: failures for missing `build/validate` signatures and missing `mesh_coverage`.

- [ ] **Step 3: Implement source parsing and atomic collider output**

Preserve aligned GLB support, add streaming OBJ parsing, apply the exact viewer transform, validate finite values, and write sibling temporary files followed by `os.replace`.

- [ ] **Step 4: Implement mesh XZ coverage rasterization**

Rasterize each accepted triangle into the DSM grid using bounded barycentric tests, dilate by one grid cell, and write a `Uint8` mask plus metadata. Do not infer coverage from a bounding circle.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_world_collision -v
/Volumes/SSD/_system/venv/bin/python3 -m py_compile pipeline/collision_bake.py pipeline/mesh_coverage.py
```

- [ ] **Step 6: Commit**

```bash
git add pipeline/collision_bake.py pipeline/mesh_coverage.py pipeline/test_world_collision.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: build structural colliders from published meshes"
```

---

### Task 3: Manifest fail-closed contract and active-world audit

**Files:**
- Modify: `pipeline/scene_manifest.py`
- Create: `pipeline/audit_world.py`
- Modify: `pipeline/test_world_collision.py`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- `scene.v2.json.capabilities.collision: boolean`
- `scene.v2.json.assets.collision_bin`, `collision_meta`, `mesh_coverage`, `mesh_coverage_meta`
- Produces: `audit_world.audit(*, vault=VAULT, active_only=True) -> {ok, worlds, failures}`

- [ ] **Step 1: Add failing manifest and audit tests**

Assert that a flyable mesh triggers automatic build, invalid/stale collision never publishes `capabilities.collision`, terrain-only worlds remain valid, and an active mesh world without collision fails the audit with its exact clip ID.

- [ ] **Step 2: Verify RED**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_world_collision -v
```

- [ ] **Step 3: Integrate builders and manifest schema**

Run collider and coverage validation/build before manifest serialization. Surface explicit build errors and keep incomplete worlds out of the collision-ready contract.

- [ ] **Step 4: Implement active-world audit and smoke integration**

Resolve active site versions plus standalone flyable models using the same deduplication rule as Mundo. Exit nonzero when an active mesh lacks a valid current collider or coverage mask.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_world_collision -v
PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 pipeline/test_smoke.py
```

- [ ] **Step 6: Commit**

```bash
git add pipeline/scene_manifest.py pipeline/audit_world.py pipeline/test_world_collision.py pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: block worlds without current collision assets"
```

---

### Task 4: Browser world-query service

**Files:**
- Create: `web/flightverse/world-collision.js`
- Create: `web/flightverse/world-collision-fixture.html`
- Create: `web/flightverse/world-collision-fixture.js`
- Create: `pipeline/flightverse_collision_gate.py`

**Interfaces:**
- Produces: `createWorldCollision(man, {heightAt, boundary, report}) -> Promise<WorldCollision>`
- `WorldCollision.castSegment(start, end, radius=0) -> null | hit`
- `WorldCollision.sweepSphere(start, end, radius) -> null | hit`
- `WorldCollision.closest(point, maxDistance) -> null | hit`
- `WorldCollision.dispose() -> void` idempotently

- [ ] **Step 1: Build a failing deterministic browser fixture**

Serve literal wall, terrain, and boundary fixtures. Assert structure-before-ground ordering, a fast segment crossing a thin wall, conservative sphere sweep, terrain crossing between endpoints, native boundary crossing, malformed byte rejection, and idempotent disposal.

- [ ] **Step 2: Verify RED**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py --fixture
```

Expected: fail because the module/fixture does not exist.

- [ ] **Step 3: Implement load, query, and teardown**

Validate metadata byte lengths before constructing geometry. Use BVH `raycastFirst` for zero/small-radius projectiles, bounded conservative closest-point samples for the drone sphere, bisection to contact, DSM segment subdivision+bisection, and the pure boundary functions. Return the earliest normalized hit.

- [ ] **Step 4: Verify GREEN and performance**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py --fixture
```

Expected: all scenarios pass and 10,000 fixture queries remain inside the recorded budget.

- [ ] **Step 5: Commit**

```bash
git add web/flightverse/world-collision.js web/flightverse/world-collision-fixture.html web/flightverse/world-collision-fixture.js pipeline/flightverse_collision_gate.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: add unified Flightverse world queries"
```

---

### Task 5: Fixed-step drone, weapons, and proximity integration

**Files:**
- Modify: `web/flightverse/runtime.js`
- Modify: `web/flightverse/weapons.js`
- Modify: `web/flightverse/objects.js`
- Modify: `web/flightverse/invasion.js`
- Modify: `web/volar.js`
- Modify: `pipeline/test_collision_math.mjs`
- Modify: `pipeline/flightverse_collision_gate.py`

**Interfaces:**
- `createDrone({world, spawn})`
- `createWeapons(scene, {world, heightAt, audio, onShake, crater})`
- Targets use `{center, radius, radiusSq, enemy, hp, ...}`
- `weapons.update(STEP, hittables)` runs only from the fixed update loop

- [ ] **Step 1: Add failing browser scenarios**

Cover boosted drone wall impact, sliding, corner contact, spawn penetration recovery, MG thin-wall impact, S/M/L missile wall impact, ground hit between endpoints, visible-target proximity, occluded-target non-trigger, target-radius regression, and boundary impacts.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test pipeline/test_collision_math.mjs
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py --fixture
```

- [ ] **Step 3: Integrate drone sweep and remove collision disabling**

Sweep from the saved position to the proposed pose, resolve contact+slide with at most two contacts, depenetrate deterministically, and restore the last safe pose if resolution cannot converge.

- [ ] **Step 4: Integrate projectile segment casts and proximity**

Use exact segment-sphere hits for dynamic targets and `world.castSegment` for the environment. Pick the earliest fraction, require structural line of sight for proximity, record scalar hit/fuse counters, and remove render-clock weapon updates.

- [ ] **Step 5: Normalize target radii**

Objects and enemies calculate `radius` once and `radiusSq = radius * radius`. Remove all `r2 * r2` comparisons.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
node --test pipeline/test_collision_math.mjs
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py --fixture
node --check web/flightverse/runtime.js web/flightverse/weapons.js web/flightverse/objects.js web/flightverse/invasion.js web/volar.js
```

- [ ] **Step 7: Commit**

```bash
git add web/flightverse/runtime.js web/flightverse/weapons.js web/flightverse/objects.js web/flightverse/invasion.js web/volar.js pipeline/test_collision_math.mjs pipeline/flightverse_collision_gate.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: make flight and weapons collide continuously"
```

---

### Task 6: Exclusive representation, mesh-hole fallback, and lifecycle

**Files:**
- Modify: `web/flightverse/scene.js`
- Modify: `web/volar.js`
- Modify: `pipeline/browser_matrix.py`
- Modify: `pipeline/test_volar_mobile.py`

**Interfaces:**
- `createSceneGeneration() -> {token, isCurrent(), invalidate()}`
- Layer handles expose idempotent `dispose()`
- Representation state is one of `terrain | mesh | splat`
- `window.__volar.representation = {preferred, active, fallbackReason, visibleStructuralLayers}`
- `window.__volar.lifecycle = {generation, groups, disposedStaleLoads}`

- [ ] **Step 1: Add failing lifecycle and representation tests**

Assert preferred terrain at 1000 m, mesh at 400 m, aligned splat at 100/200 m, deterministic fallback for unaligned splats, never-visible mesh+splat, exactly one named scene group, stale completion disposal, and terrain fallback visible outside the mesh mask.

- [ ] **Step 2: Verify RED**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_volar_mobile -v
/Volumes/SSD/_system/venv/bin/python3 pipeline/browser_matrix.py recon_60b23208db --flightverse
```

- [ ] **Step 3: Implement explicit representation state**

Respect coverage preference, select deterministic fallbacks, and drive visibility from one reducer. The terrain shader samples the mesh coverage mask and discards only covered cells while active mesh rendering is enabled.

- [ ] **Step 4: Implement generation tokens and teardown**

Guard every asynchronous layer completion, dispose stale assets, refcount the shared Spark renderer, add a single boot promise, and tear down on `pagehide`.

- [ ] **Step 5: Verify GREEN and inspect screenshots**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_volar_mobile -v
/Volumes/SSD/_system/venv/bin/python3 pipeline/browser_matrix.py recon_60b23208db --flightverse
```

Inspect all six generated screenshots. The 1000 m view must show continuous terrain, no floating mesh border, and no duplicate structures.

- [ ] **Step 6: Commit**

```bash
git add web/flightverse/scene.js web/volar.js pipeline/browser_matrix.py pipeline/test_volar_mobile.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "fix: keep world representations continuous and unique"
```

---

### Task 7: Backfill current worlds and enforce the 100-run gate

**Files:**
- Modify: `pipeline/flightverse_collision_gate.py`
- Modify: `pipeline/audit_world.py`
- Modify: `AGENTS.md`
- Modify: `docs/GAME_ENGINE.md`
- Modify: `docs/FLIGHTVERSE_IMPLEMENTATION.md`
- Modify: `docs/README.md`
- Generated vault artifacts: `models/*/collision.bin`, `collision.json`, `mesh_coverage.bin`, `mesh_coverage.json`, refreshed `scene.v2.json`

**Interfaces:**
- `flightverse_collision_gate.py <cid> --stress 100`
- `audit_world.py --all` and default active-only mode

- [ ] **Step 1: Add failing stress assertions**

Stress mode records all 100 classifications, hit coordinates, group counts, projectile counts, stale-load count, renderer memory counters, errors, and fps. It fails on any drift, leak, duplicate, missing collision, or sustained fps below 50.

- [ ] **Step 2: Verify RED on the current active world**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_world.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py recon_60b23208db --stress 100
```

Expected before backfill: active world fails for missing collider/coverage.

- [ ] **Step 3: Build and publish assets for every current flyable mesh**

Run:

```bash
for cid in $(find /Volumes/SSD/drone-vault/models -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort); do
  /Volumes/SSD/_system/venv/bin/python3 pipeline/scene_manifest.py "$cid"
done
```

The builder skips non-publishable directories explicitly and writes each valid asset atomically.

- [ ] **Step 4: Bump web assets once**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/bump_web_version.py
```

- [ ] **Step 5: Run the complete verification gate**

Run each command separately and preserve exit codes:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m py_compile pipeline/*.py ai/*.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 pipeline/test_smoke.py
node --test pipeline/test_collision_math.mjs
node --check web/icons.js web/tresd.js web/share.js web/splatview.js web/splatlab.js web/volar.js web/flightverse/*.js
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_vault.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_splats.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_world.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py recon_60b23208db --stress 100
/Volumes/SSD/_system/venv/bin/python3 pipeline/browser_matrix.py recon_60b23208db --flightverse
/Volumes/SSD/_system/venv/bin/python3 pipeline/ops_status.py
```

- [ ] **Step 6: Restart only the web service and verify local production**

Run:

```bash
pipeline/safe_restart.sh server
/Volumes/SSD/_system/venv/bin/python3 pipeline/external_probe.py
```

Do not deploy the edge worker; no edge contract changes are in scope.

- [ ] **Step 7: Update documentation with measured results**

Record collider counts, stress iterations, viewport fps, active representation, and the exact gate commands. Do not write aspirational results.

- [ ] **Step 8: Commit final source and generated web sidecars**

```bash
git add AGENTS.md docs/GAME_ENGINE.md docs/FLIGHTVERSE_IMPLEMENTATION.md docs/README.md web pipeline
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "test: gate Flightverse world collision for future deploys"
```

---

## Plan Self-Review

- Every design requirement maps to a task and an executable gate.
- Runtime interfaces are defined before their consumers.
- Dynamic targets use one radius convention.
- Visual continuity and duplicate prevention are tested independently of canvas existence.
- Current-world backfill is separated from source-code behavior and runs only after builders pass fixture tests.
- Deployment remains excluded; local production is restarted only after all source and asset gates pass.
- No task contains a placeholder, deferred behavior, or unspecified error handling.

