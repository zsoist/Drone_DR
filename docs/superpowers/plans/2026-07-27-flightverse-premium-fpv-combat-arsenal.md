# Flightverse Premium FPV, Combat, and 4K Arsenal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a premium, non-overlapping FPV command layout, stable dedicated cameras and gimbal, composite item collision, richer batched impacts, and five fully playable validated 4K GLB weapons.

**Architecture:** Pure camera and collision modules own deterministic math outside the DOM. `volar.js` remains the scene composition root and consumes one composite collision service, one camera controller, one mobile command coordinator, a data-driven nine-weapon registry, and a bounded batched effect renderer. An offline deterministic Python generator produces paired ultra/runtime GLBs and validation metadata; browser gates prove real touch geometry and live combat.

**Tech Stack:** Browser-native ES modules, Three.js r180, Pointer Events, fixed-step simulation, Node `node:test`, Python `unittest`, NumPy/Pillow/trimesh in `/Volumes/SSD/_system/venv`, Chrome DevTools Protocol, existing AeroBrain world/release gates.

## Global Constraints

- Existing keys `mg`, `s`, `m`, and `l` retain their current behavior and save compatibility.
- New keys are exactly `ac`, `sw`, `vx`, `rg`, and `tb`; the complete arsenal has exactly nine entries.
- Touch sizes: Camera 56×56, Menu at least 52×52, Weapon 56×56, Fire 72×72, collapsed Gimbal at least 96×44 CSS px.
- Gimbal range is `-90°..+25°`, defaults to `-7°`, and affects FPV only.
- Cenital roll is below 0.5° and camera matrices/quaternions remain finite.
- Orbit radius remains in 12–28 m and owns resettable per-controller phase.
- Ultra weapon GLBs contain embedded 4096×4096 base-color, normal, and ORM textures; runtime GLBs contain embedded 1024×1024 equivalents.
- Ultra GLBs remain below 15 MB and 120k triangles; runtime GLBs remain below 3 MB and 30k triangles.
- Particle budgets are phone 520, tablet 850, desktop 1400; heavy-impact emission is 96/150/240 respectively.
- No mobile path preloads all ultra assets.
- Every edit under `web/` ends with `python3 pipeline/bump_web_version.py`.
- Do not weaken auth, cache, gzip, world, collision, runtime, or browser gates.
- Commits run with `PATH=/Volumes/SSD/_system/venv/bin:$PATH`; never bypass the smoke hook.

---

### Task 1: Pure stable camera rigs and FPV-only gimbal

**Files:**
- Create: `web/flightverse/camera-rigs.js`
- Create: `pipeline/test_camera_rigs.mjs`
- Modify: `web/flightverse/runtime.js:397-457`
- Modify: `web/volar.js:1007-1045`
- Modify: `web/volar.js:1675-1745`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- Consumes: interpolated drone pose `{ yaw, pitch }`, position, velocity, `dt`, and a Three camera.
- Produces: `createCameraRigController({ THREE, initialKey, topHeadingMode })` with `select`, `cycle`, `setGimbalRadians`, `update`, `snapshot`, and `dispose`.
- Preserves: `RIGS` as immutable metadata exported from `runtime.js` for labels and compatibility; it no longer owns mutable `t` or camera functions.

- [ ] **Step 1: Write the RED camera behavior tests**

Create `pipeline/test_camera_rigs.mjs` with real minimal vector/quaternion test
types or the existing local Three shim and these independent tests:

```js
test('gimbal changes FPV pitch but cannot rotate Cenital or Orbit', () => {
  const ctl = createHarness('fpv');
  ctl.setGimbalRadians(-Math.PI / 3);
  ctl.update(frame());
  const fpv = ctl.snapshot();
  ctl.select('top', frame());
  ctl.update(frame({ dt: 1 }));
  const topA = ctl.snapshot();
  ctl.setGimbalRadians(Math.PI / 8);
  ctl.update(frame({ dt: 1 }));
  assert.deepEqual(ctl.snapshot().quaternion, topA.quaternion);
  assert.notDeepEqual(fpv.quaternion, topA.quaternion);
});

test('Cenital keeps a finite orthonormal basis and less than half-degree roll', () => {
  const ctl = createHarness('fpv');
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    ctl.select('top', frame({ yaw }));
    ctl.update(frame({ yaw, dt: 1 }));
    const s = ctl.snapshot();
    assert.equal(s.finite, true);
    assert.ok(Math.abs(s.rollDegrees) < 0.5);
    assert.ok(Math.abs(s.forward.y + 1) < 1e-6);
  }
});

test('Orbit resets local phase and scales radius with speed inside 12..28m', () => {
  const ctl = createHarness('orbit');
  ctl.update(frame({ speed: 0, dt: 1 }));
  assert.equal(ctl.snapshot().radius, 12);
  ctl.update(frame({ speed: 60, dt: 1 }));
  assert.equal(ctl.snapshot().radius, 28);
  ctl.select('fpv', frame());
  ctl.select('orbit', frame());
  assert.equal(ctl.snapshot().phase, 0);
});
```

- [ ] **Step 2: Run RED and verify the missing-module failure**

Run:

```bash
node --test pipeline/test_camera_rigs.mjs
```

Expected: FAIL because `/flightverse/camera-rigs.js` does not exist.

- [ ] **Step 3: Implement the minimal camera controller**

Implement immutable definitions and a session controller. Build Cenital's
quaternion from an explicit right/up/forward basis, never vertical `lookAt()`.
Use this orbit profile:

```js
const radius = clamp(12 + speed * 0.55, 12, 28);
const height = clamp(4.5 + speed * 0.16, 4.5, 10);
state.phase += dt * (0.22 + Math.min(speed, 30) * 0.006);
const lead = velocity.clone().multiplyScalar(
  Math.min(4, velocity.length() * 0.12) / Math.max(velocity.length(), 1e-6),
);
```

Keep the gimbal only inside the FPV pose builder. Store no mutable values on
exported rig metadata.

- [ ] **Step 4: Wire `volar.js` to one controller**

Replace `rigIx`/`gimbalTilt` math with the controller while keeping:

```js
setRig(indexOrKey);
cycleRig();
setGimbal(radians);
report.camera = controller.snapshot();
```

Do not apply `camera.rotation.x += gimbalTilt` or
`camera.rotateX(gimbalTilt + 0.12)` after controller update. Arrival, Director,
replay, and cinematic branches continue to bypass the gameplay controller.
Apply `resolveCameraCollision()` only after non-FPV gameplay poses.

- [ ] **Step 5: Run GREEN and regression suites**

Run:

```bash
node --test pipeline/test_camera_rigs.mjs pipeline/test_aiming.mjs \
  pipeline/test_mobile_command.mjs pipeline/test_touch_controls.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 -m unittest \
  pipeline.test_volar_mobile pipeline.test_mobile_hud_geometry -v
node --check web/flightverse/camera-rigs.js web/flightverse/runtime.js web/volar.js
```

Expected: all pass.

- [ ] **Step 6: Register the Node suite in smoke and commit**

Add `pipeline/test_camera_rigs.mjs` to the Node group in
`pipeline/test_smoke.py`, run:

```bash
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
git add web/flightverse/camera-rigs.js web/flightverse/runtime.js web/volar.js \
  pipeline/test_camera_rigs.mjs pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "fix: stabilize Flightverse camera rigs"
```

---

### Task 2: Dedicated Camera control and collapsible gimbal tray

**Files:**
- Create: `web/flightverse/flight-tools.js`
- Create: `pipeline/test_flight_tools.mjs`
- Modify: `web/volar.js:90-230`
- Modify: `web/volar.js:860-1210`
- Modify: `web/style.css:5030-5460`
- Modify: `pipeline/test_volar_mobile.py`
- Modify: `pipeline/test_mobile_hud_geometry.py`
- Modify: `pipeline/browser_matrix.py`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- Consumes: controller `select/cycle/setGimbalRadians/snapshot`, overlay change notifications, `orientationchange`, and pointer/keyboard events.
- Produces: `createFlightTools({ cameraTrigger, cameraPicker, cameraItems, gimbalTrigger, gimbalTray, gimbalRange, eventRoot, onCycleCamera, onSelectCamera, onGimbal })`.
- DOM IDs: `#vl-camera-toggle`, `#vl-camera-picker`, `#vl-gimbal-toggle`, `#vl-gimbal-tray`, `#vl-gimbal-range`, and current-value outputs.

- [ ] **Step 1: Write RED interaction tests**

Create `pipeline/test_flight_tools.mjs` with the same event harness pattern as
`test_mobile_command.mjs` and assert:

```js
test('Camera cycles once, exposes current rig, and closes other tools', () => {
  // one pointer activation -> one cycle; aria-expanded and label are exact
});

test('Gimbal opens independently, clamps -90..25, resets to zero, and restores focus', () => {
  // range input and reset emit radians; outside/Escape close exactly once
});

test('overlay, orientation, visibility, pagehide, and dispose close every transient tool', () => {
  // every listener is removed and callbacks cannot fire after dispose
});
```

Add static RED contracts to `pipeline/test_volar_mobile.py`:

```python
self.assertIn('id="vl-camera-toggle"', self.source)
self.assertIn('id="vl-camera-picker"', self.source)
self.assertIn('id="vl-gimbal-toggle"', self.source)
self.assertIn('id="vl-gimbal-tray"', self.source)
self.assertNotIn('class="vl-gwheel"', self.source)
self.assertNotIn('.vl-combat-live', self.style)
self.assertNotIn('.vl-fpv-camera', self.style)
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test pipeline/test_flight_tools.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 -m unittest \
  pipeline.test_volar_mobile pipeline.test_mobile_hud_geometry -v
```

Expected: missing module/DOM assertions fail for Camera and Gimbal.

- [ ] **Step 3: Implement the tool coordinator and DOM**

Add a left command rail containing Camera above Menu, keep Weapon/Fire in the
right combat rail, and add the bottom-center collapsed gimbal control. Camera,
weapon picker, gimbal tray, and overlays are mutually exclusive.

Use exact accessible semantics:

```html
<button id="vl-camera-toggle" aria-haspopup="listbox"
  aria-controls="vl-camera-picker" aria-expanded="false"></button>
<div id="vl-camera-picker" role="listbox" hidden></div>
<button id="vl-gimbal-toggle" aria-controls="vl-gimbal-tray"
  aria-expanded="false">GIM <output>-7°</output></button>
<div id="vl-gimbal-tray" role="group" aria-label="Inclinación de gimbal" hidden>
  <button data-gimbal="-5" aria-label="Bajar gimbal">−</button>
  <input id="vl-gimbal-range" type="range" min="-90" max="25" value="-7">
  <button data-gimbal-reset aria-label="Centrar gimbal">0°</button>
  <button data-gimbal="5" aria-label="Subir gimbal">+</button>
</div>
```

- [ ] **Step 4: Implement safe responsive geometry**

Delete the obsolete vertical `.vl-gwheel`, `.vl-combat-live`, and
`.vl-fpv-camera` blocks. Define portrait and landscape layouts with CSS custom
properties for safe insets and stick heights. Extend
`test_mobile_hud_geometry.py` to calculate rectangles for Camera, Menu,
Weapon, Fire, collapsed/expanded Gimbal, minimap, stick zones/bases, and both
pickers at:

- 390×844;
- 844×390;
- 820×1180;
- 1180×820;
- nonzero safe insets top 17/right 13/bottom 23/left 11.

Assert zero intersection and containment in the resolved safe viewport.

- [ ] **Step 5: Extend browser real-touch acceptance**

In `browser_matrix.py`, add complete active-touch-set interactions for:

- camera cycle while left stick stays held;
- Fire while gimbal opens/closes;
- gimbal range drag;
- orientation while each transient surface is open;
- picker focus restoration;
- screenshots `camera`, `gimbal`, `top`, and `orbit`.

Record `window.__volar.camera` and exact geometry in the report. Fail closed
for non-finite quaternion, Cenital roll ≥0.5°, wrong gimbal owner, or any
control overlap.

- [ ] **Step 6: Run GREEN, smoke, version, and commit**

Run:

```bash
node --test pipeline/test_flight_tools.mjs pipeline/test_mobile_command.mjs \
  pipeline/test_touch_controls.mjs pipeline/test_camera_rigs.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 -m unittest \
  pipeline.test_volar_mobile pipeline.test_mobile_hud_geometry -v
python3 pipeline/bump_web_version.py
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
git add web/flightverse/flight-tools.js web/volar.js web/style.css web/*.gz \
  web/flightverse/*.gz pipeline/test_flight_tools.mjs pipeline/test_volar_mobile.py \
  pipeline/test_mobile_hud_geometry.py pipeline/browser_matrix.py pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: add premium FPV flight tools"
```

---

### Task 3: Composite collision for real scene items

**Files:**
- Create: `web/flightverse/scene-object-collision.js`
- Create: `pipeline/test_scene_object_collision.mjs`
- Modify: `web/flightverse/objects.js`
- Modify: `web/flightverse/runtime.js`
- Modify: `web/flightverse/aiming.js`
- Modify: `web/flightverse/weapons.js`
- Modify: `web/volar.js`
- Modify: `web/flightverse/world-collision-fixture.js`
- Modify: `pipeline/test_world_collision.py`
- Modify: `pipeline/test_collision_math.mjs`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- Consumes: item descriptors `{ node, broadSphere, bounds, dead }` and the existing world query service.
- Produces: `createSceneObjectCollision(items)`,
  `composeCollisionWorld(world, items)`, and
  `createMutableCollisionWorld(world)` with `setItems(items)`. Every returned
  service implements `castSegment`, `sweepSphere`, `recoverSphere`, `qa`, and
  `dispose`.
- Hit result adds `source`, `node`, and `materialClass` while preserving `kind`, `fraction`, `point`, and `normal`.

- [ ] **Step 1: Write RED collision tests**

Create `pipeline/test_scene_object_collision.mjs`:

```js
test('sphere sweep hits the expanded item AABB before visual penetration', () => {
  const items = createSceneObjectCollision([boxItem([-1, 0, -1], [1, 2, 1])]);
  const hit = items.sweepSphere(v(4, 1, 0), v(-4, 1, 0), 0.5);
  assert.equal(hit.fraction, 0.3125);
  assert.deepEqual(hit.normal, v(1, 0, 0));
});

test('composite returns the earliest world or item contact with source metadata', () => {
  const composite = composeCollisionWorld(worldHit(0.8), itemHit(0.25));
  assert.equal(composite.castSegment(v(0,0,0), v(10,0,0)).source, 'item');
});

test('dead item removal makes the former path clear in the same fixed step', () => {
  const node = {};
  const items = createSceneObjectCollision([boxItem([-1,0,-1], [1,2,1], node)]);
  items.remove(node);
  assert.equal(items.castSegment(v(4,1,0), v(-4,1,0)), null);
});
```

Add fixture assertions that the drone, camera boom, MG, all missile sizes, and
one new weapon query the same item collider.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test pipeline/test_scene_object_collision.mjs pipeline/test_collision_math.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 -m unittest pipeline.test_world_collision -v
```

Expected: missing module and missing item-contact fixture assertions fail.

- [ ] **Step 3: Implement broad/narrow phase and composition**

Use broad spheres for rejection and slab intersection against the AABB expanded
by the query radius. For a start inside an expanded box, return fraction zero
and the nearest outward face. `recoverSphere` returns the smallest finite
translation that places the sphere outside all live items.

`loadSceneObjects()` computes bounds after transforms, updates animated bounds,
assigns `materialClass`, and returns `collision`. Its `markDestroyed(node)`
removes collision immediately.

- [ ] **Step 4: Wire one composite service**

In `volar.js`, create the static world first, then update a lightweight
composite wrapper when scene items finish loading:

```js
const collision = createMutableCollisionWorld(world);
// after loadSceneObjects:
collision.setItems(sceneObjects.collision);
```

Pass `collision` to `createDrone`, `resolveCameraCollision`, `resolveAimRay`,
and `createWeapons`. Keep telemetry separate for world/item hits.
`weapons.smash()` calls `sceneObjects.markDestroyed(node)` synchronously.

- [ ] **Step 5: Run GREEN, live fixture, smoke, and commit**

Run:

```bash
node --test pipeline/test_scene_object_collision.mjs pipeline/test_collision_math.mjs \
  pipeline/test_aiming.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 -m unittest pipeline.test_world_collision -v
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
python3 pipeline/flightverse_collision_gate.py recon_b2fbe03239 --stress 100
git add web/flightverse/scene-object-collision.js web/flightverse/objects.js \
  web/flightverse/runtime.js web/flightverse/aiming.js web/flightverse/weapons.js \
  web/flightverse/world-collision-fixture.js web/volar.js \
  pipeline/test_scene_object_collision.mjs pipeline/test_collision_math.mjs \
  pipeline/test_world_collision.py pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: collide flight with real scene items"
```

---

### Task 4: Deterministic five-weapon 4K GLB pipeline

**Files:**
- Create: `pipeline/generate_weapon_arsenal.py`
- Create: `pipeline/weapon_asset_contract.py`
- Create: `pipeline/test_weapon_assets.py`
- Create: `web/assets/weapons/manifest.json`
- Generate: `web/assets/weapons/ultra/*.glb`
- Generate: `web/assets/weapons/runtime/*.glb`
- Generate: `web/assets/weapons/validation/*.json`
- Generate: `web/assets/weapons/previews/*.png`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- Consumes: deterministic seed `20260727`, Pillow, NumPy, trimesh.
- Produces: five ultra and five runtime GLBs for
  `ac30_cannon`, `swarm8_pod`, `viperx_missile`, `railgun_pod`, `nova_bomb`.
- Contract functions:
  - `parse_glb(path) -> GlbDocument`
  - `validate_weapon_glb(path, tier, expected_nodes) -> dict`
  - `audit_weapon_arsenal(root) -> dict`

- [ ] **Step 1: Write RED asset-contract tests**

Create `pipeline/test_weapon_assets.py`:

```python
WEAPONS = {
    "ac": "ac30_cannon",
    "sw": "swarm8_pod",
    "vx": "viperx_missile",
    "rg": "railgun_pod",
    "tb": "nova_bomb",
}

def test_every_weapon_has_ultra_and_runtime_glb(self):
    for stem in WEAPONS.values():
        self.assertTrue((ROOT / "ultra" / f"{stem}.glb").is_file())
        self.assertTrue((ROOT / "runtime" / f"{stem}.glb").is_file())

def test_ultra_has_named_nodes_and_embedded_4k_pbr_maps(self):
    for stem in WEAPONS.values():
        report = validate_weapon_glb(ROOT / "ultra" / f"{stem}.glb", "ultra",
                                     {"mount", "projectile", "muzzle", "collision_proxy"})
        self.assertEqual(report["texture_dimensions"], [[4096, 4096]] * 3)
        self.assertLess(report["bytes"], 15 * 1024 * 1024)
        self.assertLess(report["triangles"], 120_000)

def test_runtime_maps_are_1k_and_models_are_bounded(self):
    # exact 1024 dimensions, <3 MB, <30k triangles, finite accessors
```

- [ ] **Step 2: Run RED**

Run:

```bash
PYTHONPATH=pipeline /Volumes/SSD/_system/venv/bin/python3 \
  -m unittest pipeline.test_weapon_assets -v
```

Expected: FAIL because generator, contract, and assets do not exist.

- [ ] **Step 3: Implement the GLB parser/auditor**

Parse GLB headers/chunks without adding a runtime dependency. Decode embedded
PNG/JPEG dimensions with Pillow. Validate:

- magic/version/declared length;
- JSON and BIN chunks;
- finite accessor min/max and buffer bounds;
- node names and hierarchy;
- Y-up/-Z-forward metadata;
- exactly three embedded PBR images per tier;
- byte/triangle/material budgets;
- SHA-256 and validation sidecar identity.

- [ ] **Step 4: Implement deterministic geometry and 4K PBR generation**

Build distinct silhouettes:

- AC-30: vented barrel cluster, receiver, recoil sleeve, projectile round;
- SWARM-8: eight tube openings, mount frame, micro-rocket projectile;
- VIPER-X: seeker nose, clipped fins, dual exhaust, missile projectile;
- RAIL: twin rails, field coils, power housing, kinetic slug;
- NOVA: faceted casing, tail fins, safety bands, gravity-bomb projectile.

Generate base-color, tangent-space normal, and packed ORM maps at 4096 and
1024. Use original brand-free markings only. Export the node contract and hide
`projectile`/`collision_proxy` by metadata rather than deleting them.

- [ ] **Step 5: Generate, audit, and inspect contact sheets**

Run:

```bash
PYTHONPATH=pipeline /Volumes/SSD/_system/venv/bin/python3 \
  pipeline/generate_weapon_arsenal.py --output web/assets/weapons --seed 20260727
PYTHONPATH=pipeline /Volumes/SSD/_system/venv/bin/python3 \
  -m unittest pipeline.test_weapon_assets -v
```

Inspect all contact sheets for distinct silhouette, correct axes, readable
materials, no missing faces, and no texture stretching. Correct the generator,
not generated files.

- [ ] **Step 6: Register smoke and commit generator plus assets**

Run:

```bash
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
git add pipeline/generate_weapon_arsenal.py pipeline/weapon_asset_contract.py \
  pipeline/test_weapon_assets.py pipeline/test_smoke.py web/assets/weapons
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: generate five 4K weapon GLBs"
```

---

### Task 5: Nine-weapon registry, model loading, and distinct behaviors

**Files:**
- Create: `web/flightverse/weapon-registry.js`
- Create: `web/flightverse/weapon-models.js`
- Create: `pipeline/test_weapon_registry.mjs`
- Modify: `web/flightverse/weapons.js`
- Modify: `web/volar.js`
- Modify: `web/style.css`
- Modify: `web/flightverse/world-collision-fixture.js`
- Modify: `pipeline/test_volar_mobile.py`
- Modify: `pipeline/flightverse_collision_gate.py`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- `WEAPON_PROFILES`: frozen object with exactly nine complete profiles.
- `createWeaponModelLibrary({ quality, loader, root })` with `select(key, mounts)`, `cloneProjectile(key)`, `preload(key)`, `snapshot()`, and `dispose()`.
- `weapons.fire(origin, aim)` consumes profile `kind` and model key.
- `weapons.update(dt, hittables)` advances bullets, rockets, guided missiles, rail slugs, bombs, and bounded swarm schedules.

- [ ] **Step 1: Write RED registry/behavior tests**

Create `pipeline/test_weapon_registry.mjs`:

```js
test('registry exposes nine complete immutable profiles', () => {
  assert.deepEqual(Object.keys(WEAPON_PROFILES), ['mg','s','m','l','ac','sw','vx','rg','tb']);
  for (const p of Object.values(WEAPON_PROFILES)) {
    for (const key of ['kind','label','max','regen','model','effect']) assert.ok(key in p);
    assert.equal(Object.isFrozen(p), true);
  }
});

test('SWARM-8 schedules eight bounded launches instead of one-frame allocation', () => {
  const w = createHarness('sw');
  w.fire(origin(), aim());
  assert.equal(w.state.schedules.length, 1);
  step(w, 1.0);
  assert.equal(w.state.firedProjectiles.sw, 8);
  assert.equal(w.state.schedules.length, 0);
});

test('VIPER-X turns toward a visible target but cannot fuse through an occluder', () => {});
test('RAIL resolves a continuous structure hit without a fireball', () => {});
test('NOVA follows gravity and emits the occlusion-aware heavy profile', () => {});
```

Add static contracts for nine picker items and the 3×3 grid.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test pipeline/test_weapon_registry.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 -m unittest pipeline.test_volar_mobile -v
```

Expected: missing registry/module and only four DOM options.

- [ ] **Step 3: Implement registry and model library**

Move current four values without changing them. Add:

```js
ac: { kind:'bullet', label:'AC-30', auto:true, rate:0.16, max:48,
      regen:2.4, speed:125, dmg:48, model:'ac30_cannon', effect:'kinetic-heavy' },
sw: { kind:'swarm', label:'SWARM-8', cd:3.2, max:4, regen:0.08,
      count:8, interval:0.085, speed:68, dmg:95, model:'swarm8_pod', effect:'micro-rocket' },
vx: { kind:'guided', label:'VIPER-X', cd:2.8, max:4, regen:0.1,
      speed:62, turnRate:1.9, dmg:720, proximity:2.4, model:'viperx_missile', effect:'guided' },
rg: { kind:'rail', label:'RAIL', cd:1.7, max:10, regen:0.28,
      speed:460, dmg:520, model:'railgun_pod', effect:'rail' },
tb: { kind:'bomb', label:'NOVA', cd:4.8, max:2, regen:0.045,
      speed:12, gravity:18, dmg:1200, splash:18, model:'nova_bomb', effect:'heavy' },
```

Load runtime GLB in auto/mobile and ultra only in desktop manual
extra/4k/ultra. Clone named projectile visuals and attach only the selected
mount. Dispose replaced mounts and templates without touching shared loader
resources early.

- [ ] **Step 4: Implement distinct fixed-step behavior**

Keep one projectile collection with profile-specific integration. Swarm launch
schedules contain at most one active schedule per trigger and eight entries.
Guidance selects only a visible target returned by the aim/occlusion service.
RAIL uses continuous segment collision at 460 m/s. NOVA uses gravity and
explodes on first composite contact.

- [ ] **Step 5: Expand UI, fixture, and collision stress**

Populate nine options from `WEAPON_PROFILES`, not duplicated hard-coded HTML.
The picker is a safe scrollable 3×3 grid. Extend the fixture and
`flightverse_collision_gate.py` to fire each new key at structure, terrain,
item, and visible target as appropriate and prove model readiness, ammo
decrement, impact kind, and cleanup.

- [ ] **Step 6: Run GREEN, version, smoke, and commit**

Run:

```bash
node --test pipeline/test_weapon_registry.mjs pipeline/test_collision_math.mjs \
  pipeline/test_aiming.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 -m unittest pipeline.test_volar_mobile -v
python3 pipeline/flightverse_collision_gate.py recon_b2fbe03239 --stress 100
python3 pipeline/bump_web_version.py
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
git add web/flightverse/weapon-registry.js web/flightverse/weapon-models.js \
  web/flightverse/weapons.js web/flightverse/world-collision-fixture.js \
  web/volar.js web/style.css web/*.gz web/flightverse/*.gz \
  pipeline/test_weapon_registry.mjs pipeline/test_volar_mobile.py \
  pipeline/flightverse_collision_gate.py pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: integrate nine-weapon Flightverse arsenal"
```

---

### Task 6: Batched premium smoke, impact falloff, and particle blowout

**Files:**
- Create: `web/flightverse/weapon-effects.js`
- Create: `pipeline/test_weapon_effects.mjs`
- Modify: `web/flightverse/weapons.js`
- Modify: `web/flightverse/world-collision-fixture.js`
- Modify: `pipeline/test_collision_math.mjs`
- Modify: `pipeline/flightverse_collision_gate.py`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- `createWeaponEffects(scene, { tier, textures, heightAt })`
- `effects.emitImpact({ profile, hit, inheritedVelocity, scale })`
- `effects.emitTrail({ profile, position, velocity, dt })`
- `effects.update(dt, camera)`
- `effects.snapshot()`
- `effects.dispose()`
- `radialDamage({ origin, radius, maxDamage, targets, castSegment })`

- [ ] **Step 1: Write RED effect and falloff tests**

Create `pipeline/test_weapon_effects.mjs`:

```js
test('effect tiers expose exact active and heavy-emission budgets', () => {
  assert.deepEqual(effectBudget('phone'), { active:520, heavy:96 });
  assert.deepEqual(effectBudget('tablet'), { active:850, heavy:150 });
  assert.deepEqual(effectBudget('desktop'), { active:1400, heavy:240 });
});

test('heavy impact emits more particles without one scene object per particle', () => {
  const e = createHarness('desktop');
  e.emitImpact(heavyTerrainHit());
  assert.equal(e.snapshot().emitted, 240);
  assert.ok(e.snapshot().drawBatches <= 6);
});

test('blast falloff reaches visible targets and rejects occluded targets', () => {
  const result = radialDamage(fixture());
  assert.ok(result.visible.damage > 0);
  assert.equal(result.occluded.damage, 0);
});

test('shockwave is surface-oriented and capped below 35 percent viewport diameter', () => {});
test('dispose releases batches, materials, geometry, textures, and lights exactly once', () => {});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test pipeline/test_weapon_effects.mjs
```

Expected: missing effect module.

- [ ] **Step 3: Implement fixed-capacity batches**

Use preallocated typed arrays for:

- instanced smoke/fire quads;
- one `THREE.Points` sparks/embers buffer;
- one `THREE.LineSegments` streak buffer;
- instanced debris families.

Maintain a free-list/ring cursor and per-particle age/lifetime without
allocating a Three object per particle. Update active ranges and mark buffer
attributes dirty once per frame.

- [ ] **Step 4: Replace flat explosion composition**

Move emission from `weapons.js` into named profiles. Preserve decals, craters,
lights, and persistent rubble as bounded objects. Remove giant core sprites
and rings above the viewport cap. Use collision material/normal for dust,
sparks, fragments, and decal orientation. Use the composite collision service
for radial-damage occlusion.

- [ ] **Step 5: Extend deterministic fixture and stress telemetry**

Assert:

- heavy emission count per tier;
- `drawBatches <= 6`;
- no square sprite edges in material configuration;
- shockwave visual radius cap;
- visible/occluded target damage;
- stable resource counters after 100 impacts and reloads;
- phone and desktop frame budget.

- [ ] **Step 6: Run GREEN, version, smoke, and commit**

Run:

```bash
node --test pipeline/test_weapon_effects.mjs pipeline/test_weapon_registry.mjs \
  pipeline/test_collision_math.mjs pipeline/test_aiming.mjs
python3 pipeline/flightverse_collision_gate.py recon_b2fbe03239 --stress 100
python3 pipeline/bump_web_version.py
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
git add web/flightverse/weapon-effects.js web/flightverse/weapons.js \
  web/flightverse/world-collision-fixture.js web/flightverse/*.gz \
  pipeline/test_weapon_effects.mjs pipeline/test_collision_math.mjs \
  pipeline/flightverse_collision_gate.py pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: batch premium Flightverse impact effects"
```

---

### Task 7: Complete browser acceptance, visual QA, and regression fixes

**Files:**
- Modify: `pipeline/browser_matrix.py`
- Modify: `pipeline/test_volar_mobile.py`
- Modify: `pipeline/test_mobile_hud_geometry.py`
- Modify: `.gstack/qa-reports/qa-report-world-mobile-2026-07-27.md`
- Create: `.superpowers/sdd/2026-07-27-flightverse-premium-combat/task-7-report.md`

**Interfaces:**
- Consumes: final camera, tool, collision, arsenal, and effect telemetry.
- Produces: screenshots and a fail-closed five-profile report covering every explicit requirement.

- [ ] **Step 1: Add RED browser-contract assertions**

Require screenshot states:

```text
fpv
camera
gimbal
weapons9
top
orbit
nova-impact
rail-impact
```

Require telemetry for camera key, gimbal radians/owner, finite quaternion,
Cenital roll, Orbit radius/phase, item contact, every new weapon's ammo/fired
delta, asset tier/node readiness, effect emission/batches/peak, resource
counters, frame rate, and console errors.

- [ ] **Step 2: Run the focused matrix and record RED failures**

Run:

```bash
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse \
  --viewport mobile_portrait
```

Expected before final wiring: at least one new state/telemetry assertion fails.
Record exact failures in the Task 7 report.

- [ ] **Step 3: Fix only evidence-backed integration findings**

For each finding, add or tighten the focused test that catches it, observe RED,
make the minimal production change, and re-run GREEN. Do not relax geometry,
frame, collision, resource, or asset thresholds.

- [ ] **Step 4: Run the complete five-profile visual matrix**

Run:

```bash
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse
```

Inspect all forty screenshots at original resolution. Record every overlap,
clipping, unreadable label, weak hierarchy, texture/model defect, camera
orientation defect, flat smoke, giant sprite, and material mismatch. Fix every
actionable finding through RED→GREEN.

- [ ] **Step 5: Run all focused and full local gates**

Run:

```bash
PYTHONPATH=.:pipeline python3 -m py_compile pipeline/*.py ai/*.py
node --test pipeline/test_camera_rigs.mjs pipeline/test_flight_tools.mjs \
  pipeline/test_scene_object_collision.mjs pipeline/test_weapon_registry.mjs \
  pipeline/test_weapon_effects.mjs pipeline/test_mobile_command.mjs \
  pipeline/test_touch_controls.mjs pipeline/test_aiming.mjs \
  pipeline/test_collision_math.mjs
PYTHONPATH=pipeline:/tmp/aerobrain-testdeps python3 -m unittest \
  pipeline.test_weapon_assets pipeline.test_volar_mobile \
  pipeline.test_mobile_hud_geometry pipeline.test_world_collision \
  pipeline.test_static_gzip_freshness -v
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
python3 pipeline/audit_world.py
python3 pipeline/world_runtime_sweep.py
python3 pipeline/invasion_runtime_gate.py
python3 pipeline/flightverse_collision_gate.py recon_b2fbe03239 --stress 100
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse
git diff --check origin/main...HEAD
```

Expected: every command exits zero, 9/9 worlds are ready, every browser profile
meets the established frame budget, and there are no unexplained console or
resource errors.

- [ ] **Step 6: Commit reviewed QA evidence**

Run:

```bash
git add pipeline/browser_matrix.py pipeline/test_volar_mobile.py \
  pipeline/test_mobile_hud_geometry.py \
  .gstack/qa-reports/qa-report-world-mobile-2026-07-27.md \
  .superpowers/sdd/2026-07-27-flightverse-premium-combat/task-7-report.md
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "test: gate premium Flightverse combat"
```

---

### Task 8: Version integrity, safe deploy, and production canary

**Files:**
- Create: `.gstack/canary-reports/world-mobile-v314.md`
- Modify: `.gstack/qa-reports/qa-report-world-mobile-2026-07-27.md`
- Modify: PR #1 description

**Interfaces:**
- Consumes: reviewed local candidate and all release gates.
- Produces: one versioned production deployment, canary evidence, and an open draft PR whose head matches the evidence commit.

- [ ] **Step 1: Produce the final web version and exact gzip pairs**

Run:

```bash
python3 pipeline/bump_web_version.py
PYTHONPATH=pipeline:/tmp/aerobrain-testdeps python3 -m unittest \
  pipeline.test_static_gzip_freshness pipeline.test_weapon_assets -v
rg -o '\\?v=[0-9]+' web | sort | uniq -c
```

Expected: one current version, no stale references, and every gzip pair exact
and fresh.

- [ ] **Step 2: Repeat the complete local release suite**

Run the complete Task 7 Step 5 command list on the exact candidate tree. Stop
on the first failure and fix it through RED→GREEN.

- [ ] **Step 3: Push without merging and verify draft PR identity**

Run:

```bash
git push origin codex/scene-ops-stability
gh pr view 1 --json url,state,isDraft,headRefOid,mergeStateStatus
```

Expected: `OPEN`, `isDraft=true`, `CLEAN`, and PR head equals local/origin.

- [ ] **Step 4: Deploy fail-closed**

Run:

```bash
pipeline/safe_restart.sh server
```

Expected: active-world preflight, expanded every-weapon collision stress 100,
restart, and mandatory post-health all pass.

- [ ] **Step 5: Run production canary**

Verify:

```text
loopback /api/healthz = 200 and all checks true
loopback /api/whoami = daniel, dev_mode=true
public /api/healthz = 200 with private/no-store edge policy
public /mundo.html = exact 303 login redirect
public /api/whoami = 401
authenticated manifest and weapon GLBs = 200 private
production phone portrait real-touch = frame budget, no overlap
production phone landscape real-touch = frame budget, no overlap
production iPad portrait/landscape = frame budget, no overlap
production desktop = frame budget
Cenital/Orbit/gimbal/item collision/all five weapons/VFX = live PASS
ephemeral session revoked after canary
```

- [ ] **Step 6: Commit canary evidence and prove immutability**

Commit only canary/QA evidence, push, and verify:

```bash
git status --short
git rev-parse HEAD
git rev-parse origin/codex/scene-ops-stability
gh pr view 1 --json state,isDraft,headRefOid,mergeStateStatus,url
git diff --name-only HEAD^..HEAD
git rev-parse HEAD^:web
git rev-parse HEAD:web
```

Expected: clean worktree; local, origin, and PR head match; the evidence range
contains only Markdown reports; the candidate parent and final HEAD have the same
web tree; PR remains open, draft, and unmerged.
