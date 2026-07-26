# FLIGHTVERSE Near-Structure Flight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the drone's structural contact match its visible 3D envelope and keep gameplay cameras in front of real world geometry.

**Architecture:** Retain the unified BVH collider and its continuous single-sphere sweep, but replace the unrelated 1.20 m structural radius with a validated model-derived radius. Add one reusable camera-boom segment resolver and invoke it only for non-FPV gameplay rigs. Browser fixtures and live gates prove contact coordinates, telemetry, frame rate, and resource stability.

**Tech Stack:** JavaScript ES modules, Three.js r180, three-mesh-bvh, Python unittest/CDP gates, AeroBrain safe restart pipeline.

## Global Constraints

- Preserve the independent `MIN_AGL = 1.2` terrain rule.
- Preserve continuous swept collision, tangential sliding, two-contact resolution, and fail-closed recovery.
- Do not add a second visible world representation or a second collision layer.
- Keep one sphere sweep per drone contact attempt, not one sweep per model part.
- Camera collision is disabled for FPV, Director, cinematic tour, and arrival.
- Every `web/` edit requires `python3 pipeline/bump_web_version.py`.
- Deployment uses `pipeline/safe_restart.sh web`; never bypass the world gate.

---

### Task 1: Model-Sized Drone Contact

**Files:**
- Modify: `web/flightverse/world-collision-fixture.js`
- Modify: `web/flightverse/runtime.js`

**Interfaces:**
- Consumes: `WorldCollision.sweepSphere(start, end, radius)`.
- Produces: `Drone.collisionRadius: number`.
- Produces: `Drone.setCollisionRadius(radius: number): number`.

- [ ] **Step 1: Write the failing wall-clearance test**

Update the boosted-drone fixture so it asserts all of the following observable
behavior:

```js
check(
  'drone structural envelope matches the visible 0.85m aircraft',
  boosted.collisionRadius >= 0.57
    && boosted.collisionRadius <= 0.60
    && boosted.pos.x >= 3.38
    && boosted.pos.x <= 3.43
    && boosted.pos.z > -1.5,
  JSON.stringify({
    radius: boosted.collisionRadius,
    position: boosted.pos.toArray(),
    collisionHits: boosted.collisionHits,
  }),
);
```

Change the corner upper bounds to `3.43`, and make spawn depenetration assert that
the final center-to-wall distance equals `collisionRadius + 0.003` within 0.01 m.
The production mutation caught by these assertions is restoring the 1.20 m radius
or using a different radius for depenetration than for sweep.

- [ ] **Step 2: Run the fixture and verify RED**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py \
  --fixture --base-url http://127.0.0.1:8790 --timeout 60
```

Expected: failure because `collisionRadius` is absent and the center remains near
x=2.799 instead of x=3.41.

- [ ] **Step 3: Implement the validated mutable radius**

In `runtime.js`:

```js
const DEFAULT_DRONE_COLLISION_RADIUS = 0.59;
const MIN_DRONE_COLLISION_RADIUS = 0.42;
const MAX_DRONE_COLLISION_RADIUS = 0.70;
```

Initialize `d.collisionRadius` to the default and add:

```js
d.setCollisionRadius = (value) => {
  const radius = Number(value);
  if (!Number.isFinite(radius)) return d.collisionRadius;
  d.collisionRadius = THREE.MathUtils.clamp(
    radius,
    MIN_DRONE_COLLISION_RADIUS,
    MAX_DRONE_COLLISION_RADIUS,
  );
  return d.collisionRadius;
};
```

Replace every structural `DRONE_R` use in embedded recovery, sweep, and
depenetration with `d.collisionRadius`. Leave `MIN_AGL` unchanged.

- [ ] **Step 4: Serve the worktree fixture and verify GREEN**

Start a temporary loopback static server rooted at `web/` on port 8791 and run the
fixture gate with `--base-url http://127.0.0.1:8791`. Expected: all fixture
assertions pass and the wall center is in the 3.38–3.43 m range. Stop the temporary
server after Task 3. Do not restart production during an incomplete TDD cycle.

---

### Task 2: Camera Boom Collision

**Files:**
- Modify: `web/flightverse/world-collision-fixture.js`
- Modify: `web/flightverse/runtime.js`
- Modify: `web/volar.js`

**Interfaces:**
- Consumes: `WorldCollision.castSegment(start, end, radius)`.
- Produces: `resolveCameraCollision(world, focus, desired, clearance = 0.18) -> null | hit`.

- [ ] **Step 1: Write the failing camera resolver test**

Import `resolveCameraCollision` from `runtime.js`, request a camera at x=6 from a
focus at x=0 through the fixture wall at x=4, and assert:

```js
const cameraPosition = new THREE.Vector3(6, 2, 0);
const cameraHit = resolveCameraCollision(
  world,
  new THREE.Vector3(0, 2, 0),
  cameraPosition,
);
check(
  'camera boom stays on the drone side of real structure',
  cameraHit?.kind === 'structure'
    && cameraPosition.x >= 3.80
    && cameraPosition.x <= 3.82,
  JSON.stringify({ kind: cameraHit?.kind, position: cameraPosition.toArray() }),
);
```

Also assert a clear camera segment remains bit-for-bit unchanged. The production
mutations caught are skipping the unified collider, placing the camera past the
surface, or altering clear poses.

- [ ] **Step 2: Run the fixture and verify RED**

Run the fixture gate. Expected: module import failure because
`resolveCameraCollision` does not exist.

- [ ] **Step 3: Implement the minimal resolver**

Add the exported helper in `runtime.js`. It must:

1. Return `null` when `world.castSegment` is unavailable or boom length is zero.
2. Cast from `focus` to `desired`.
3. Return `null` and leave `desired` untouched when clear.
4. Move `desired` to `max(0.05, hit.fraction * boomLength - clearance)` along the
   original normalized boom.
5. Catch collider exceptions and leave `desired` untouched.

- [ ] **Step 4: Integrate only into gameplay chase rigs**

In `volar.js`, after `rig.fn()` and before shake:

```js
if (!rig.hideDrone) {
  const cameraHit = resolveCameraCollision(world, P, camera.position);
  if (cameraHit) cameraCollisionHits += 1;
}
```

Do not invoke it in the Director, arrival, cinematic-tour, or FPV branches. Report
the counter through `window.__volar.camera.collision_hits`.

- [ ] **Step 5: Rerun the worktree fixture and verify GREEN**

Rerun the fixture gate against port 8791. Expected: all assertions pass, camera x
is 3.80–3.82, and the clear camera pose is unchanged.

---

### Task 3: Bind the Collider to the Loaded GLB

**Files:**
- Modify: `web/volar.js`
- Modify: `pipeline/flightverse_collision_gate.py`
- Modify: `pipeline/test_deploy_world_gate.py`

**Interfaces:**
- Consumes: `Drone.setCollisionRadius(radius)`.
- Produces: `window.__volar.collision.radius_m`.
- Produces: live collision-gate sample field `collisionRadius`.

- [ ] **Step 1: Add the failing live-gate contract**

Extend the live CDP sample with:

```python
"collisionRadius:r?.collision?.radius_m,"
"cameraCollisionHits:r?.camera?.collision_hits,"
```

Reject samples whose radius is not between 0.42 and 0.70 or whose camera counter is
not a finite non-negative number. Add unittest coverage that a malformed sample is
reported as `collision_envelope` or `camera_telemetry`.

- [ ] **Step 2: Run the gate tests and verify RED**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest \
  pipeline.test_deploy_world_gate -v
```

Then run a one-sample live gate. Expected: the current runtime does not publish
`collision.radius_m` or `camera.collision_hits`.

- [ ] **Step 3: Derive the radius from the normalized visual model**

After scaling the loaded GLB and before replacing the procedural model:

```js
const visualSphere = bb.getBoundingSphere(new THREE.Sphere());
drone.setCollisionRadius(visualSphere.radius + 0.02);
```

If the model is absent or invalid, the validated default remains active. Publish
the current value in `report.collision.radius_m` every report refresh and initialize
`report.camera`.

- [ ] **Step 4: Verify the live contract GREEN**

Rebuild/restart, run the unit test and a one-sample live collision gate. Expected:
radius 0.42–0.70, finite camera counter, one world group, zero runtime errors.

---

### Task 4: Documentation, Deployment, and Full Verification

**Files:**
- Modify: `docs/GAME_ENGINE.md`
- Generated: versioned `web/**/*.gz` sidecars

**Interfaces:**
- Consumes: all earlier runtime and gate contracts.
- Produces: deployed version and reproducible verification evidence.

- [ ] **Step 1: Document near-structure behavior**

Add the model-derived structural envelope, independent terrain AGL, unified camera
boom query, telemetry fields, and failure behavior to `docs/GAME_ENGINE.md`.

- [ ] **Step 2: Regenerate exact web artifacts**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/bump_web_version.py
```

Verify `git diff --check` and run `node --check` over all edited JS.

- [ ] **Step 3: Run focused and full local suites**

Run:

```bash
node --test pipeline/test_render_quality.mjs pipeline/test_collision_math.mjs
/Volumes/SSD/_system/venv/bin/python3 -m unittest \
  pipeline.test_volar_mobile \
  pipeline.test_world_collision \
  pipeline.test_deploy_world_gate -v
/Volumes/SSD/_system/venv/bin/python3 pipeline/test_smoke.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_world.py
```

Expected: zero failures.

- [ ] **Step 4: Restart through the mandatory gate**

Confirm no active or queued 3D jobs, then run:

```bash
pipeline/safe_restart.sh web
```

Expected: automatic world audit and 100× FLIGHTVERSE deployment gate pass.

- [ ] **Step 5: Run browser matrix and live stress**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/browser_matrix.py \
  recon_b2fbe03239 --base-url http://127.0.0.1:8790 --flightverse
/Volumes/SSD/_system/venv/bin/python3 pipeline/flightverse_collision_gate.py \
  recon_b2fbe03239 --base-url http://127.0.0.1:8790 --stress 100 --timeout 120
```

Inspect mobile, iPad, and desktop screenshots. Expected: ≥50 FPS, one world group,
no duplicate mesh+splat structural layers, no console errors, no geometry/texture
growth, valid collision radius, and valid camera telemetry.

- [ ] **Step 6: Commit and publish**

Review the exact diff, commit atomically, push `codex/scene-ops-stability`, and probe
the public login/auth boundary without exposing credentials.
