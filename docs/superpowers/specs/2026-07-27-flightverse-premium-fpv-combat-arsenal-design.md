# Flightverse Premium FPV, Cameras, Combat, and 4K Arsenal Design

**Date:** 2026-07-27  
**Status:** Approved for implementation by the operator's explicit full-approval instruction  
**Release target:** Flightverse web runtime after v313

## Problem

Seven real iPhone captures and the current v313 source prove five separate
failures:

1. FPV puts the vertical gimbal range in the same right-side lane as the
   selected weapon and Fire control.
2. Camera switching is hidden inside the Menu sheet. A stale
   `.vl-fpv-camera` style exists, but there is no corresponding control in the
   DOM.
3. Cenital places the camera almost exactly on the world-up axis and calls
   `lookAt()`, then applies the gimbal rotation a second time. This creates a
   near-singular orientation, visible roll/flip behavior, and unstable framing.
4. Orbit stores mutable time on the exported global rig record, uses a small
   fixed world-axis circle, and also receives the gimbal rotation. It neither
   frames the vehicle's motion nor resets cleanly when re-entered.
5. The drone sweeps only against the static world collision service.
   Destructible scene objects are exposed only as weapon hittables, so the
   drone can intersect a barrel, wall, tree, or primitive prop that a missile
   can hit.

The explosion in the captures is dominated by very large translucent sprites
and full-screen rings. The current particle cap is 460 individual scene
objects, so adding more particles directly would add draw calls and make the
effect slower rather than richer. The current arsenal has four procedural
projectiles and no authored weapon GLB catalog.

## Product outcome

Flightverse must feel like a premium drone combat game without hiding flight
controls or weakening the existing world gates:

- Camera, Menu, weapon selection, Fire, and gimbal are immediately reachable
  and occupy independent touch lanes.
- FPV gimbal is precise, collapsible, and never changes Chase, Cenital, Orbit,
  Director, arrival, or cinematic camera orientation.
- Cenital is a stable north/drone-heading-up top view with no roll singularity.
- Orbit is a cinematic, speed-aware 360-degree rig with stable entry, obstacle
  avoidance, and a visible sense of parallax.
- The drone and every weapon collide continuously with both the published
  world collider and live scene items.
- Smoke and impacts have volume, material response, directional falloff, and
  substantially more particles with fewer draw calls.
- Five additional authored weapons ship as validated 4K GLBs and are fully
  selectable, fireable, collision-aware, and covered by runtime QA.

## Interaction layout

### Persistent touch controls

The two stick zones remain unchanged. Four controls live outside those zones:

- **Left command rail**
  - Camera: 56×56 CSS px, current rig code and camera glyph.
  - Menu: 52×52 CSS px.
- **Right combat rail**
  - Weapon: 56×56 CSS px, selected weapon code and integer ammunition.
  - Fire: 72×72 CSS px, independent pointer ownership.
- **Bottom-center gimbal tray**
  - Collapsed button: at least 96×44 CSS px, `GIM -44°`.
  - Expanded tray: 184×52 CSS px on phone and 224×52 on tablet.
  - Horizontal range, minus/reset/plus affordances, current value, and a
    one-tap `0°` reset.
  - The tray sits above the minimap/stick bases and below the reticle. It is
    visible only for FPV and closes on camera change, overlay open, orientation
    change, Escape, pagehide, or explicit collapse.

Camera tap cycles through the gameplay rigs. Its adjacent picker opens with a
second deliberate activation and lists named rigs in a bounded, safe-area
aware surface. Keyboard `C` retains cycle behavior. Menu keeps the full camera
row as a secondary route.

The weapon picker becomes a scrollable 3×3 grid for nine weapons. The selected
weapon remains visible while the picker is closed. Opening Camera, Weapon,
Gimbal, Menu, or any modal closes the other transient surfaces.

### Desktop controls

Desktop keeps the Menu and combat panel. It receives a compact camera control
and horizontal gimbal strip near the lower center, without changing pointer
lock or hotkeys. Fire remains available from the existing desktop combat
panel and keyboard.

### Visual language

Controls use one graphite glass system with restrained cyan for navigation,
amber for weapon selection, orange/red for Fire, and mint for healthy/ready
states. Labels use the existing UI font, telemetry uses the mono font, and
button state is conveyed by text/shape in addition to color.

## Camera and gimbal architecture

Create `web/flightverse/camera-rigs.js` with no DOM dependencies:

- `createCameraRigController({ THREE, initialKey })`
- `controller.select(key, pose)`
- `controller.cycle(direction, pose)`
- `controller.update({ dronePosition, dronePose, velocity, dt, camera })`
- `controller.setGimbalRadians(value)`
- `controller.snapshot()`

Every controller owns its own orbit phase and transition state. The exported
rig definitions are immutable configuration.

### FPV

FPV sets position at the drone's front camera anchor and constructs its
quaternion from drone yaw/pitch plus the clamped gimbal pitch. Gimbal range is
`-90°..+25°`; the default is `-7°`. No later render stage rotates the camera.

### Cenital

Cenital uses an explicit stable basis rather than a nearly vertical
`lookAt()`:

- forward is world down `(0,-1,0)`;
- screen up is either world north or the drone's projected forward vector,
  selected by the saved top-view preference;
- right is the normalized cross product of screen-up and forward;
- the camera quaternion is built from that orthonormal basis.

Altitude eases between 45 and 90 metres based on horizontal speed and world
scale. It never receives gimbal pitch. Entering Cenital resets transition
velocity, so a prior FPV or Orbit quaternion cannot roll it.

### Orbit

Orbit owns a local phase reset on entry. Radius is
`clamp(12 + speed * 0.55, 12, 28)` metres and height is
`clamp(4.5 + speed * 0.16, 4.5, 10)` metres. Angular velocity is
`0.22 + min(speed, 30) * 0.006` radians/second. The focus point leads the drone
by up to four metres along velocity, producing parallax and motion framing.
The existing non-FPV camera collision resolver clamps the final boom against
the composite collision service.

### Transitions

Rig changes use critically damped position and quaternion interpolation for
0.28 seconds. There is no interpolation through an invalid up vector. Arrival,
Director, replay, and cinematic mode retain exclusive camera ownership.

## Composite item collision

Create `web/flightverse/scene-object-collision.js`.

`loadSceneObjects()` will expose:

- exact world-space `THREE.Box3` bounds for static props;
- a conservative sphere only as broad phase;
- `castSegment(start, end, radius)`;
- `sweepSphere(start, end, radii)`;
- `recoverSphere(position, radii)`;
- `remove(node)` when a destructible object becomes dead.

Primitive boxes and kit assets use transformed AABBs. Rings and beacons use
explicit primitive bounds. Animated items update their bounds before queries.
The broad phase rejects distant objects; the narrow phase uses expanded AABB
slab intersection and returns the earliest contact fraction, point, and
outward normal.

Create `composeCollisionWorld(staticWorld, objectCollision)` with the same
query surface as `createWorldCollision()`. It returns the earliest hit across
the static world and item service and preserves source metadata
`source: "world" | "item"` plus `node`.

The drone, camera boom, aim resolver, bullets, missiles, rockets, rail slugs,
and bombs all receive the composite service. Destroyed props are removed from
item collision in the same fixed step in which their intact geometry is
disabled. Continuous sweeps remain fail-closed and preserve the existing
model-derived drone radii.

## Nine-weapon registry

Refactor the current `ARSENAL` into immutable profiles. The existing four
weapons retain their keys and ammunition behavior:

- `mg` — MG
- `s` — Missile S
- `m` — Missile M
- `l` — Missile L

Add five profiles and assets:

| Key | Label | GLB | Behavior |
| --- | --- | --- | --- |
| `ac` | AC-30 | `ac30_cannon.glb` | 20 mm automatic cannon, slower than MG, stronger material impact |
| `sw` | SWARM-8 | `swarm8_pod.glb` | one press launches a timed fan of eight micro-rockets |
| `vx` | VIPER-X | `viperx_missile.glb` | agile guided missile with target-only proximity fuse |
| `rg` | RAIL | `railgun_pod.glb` | ultra-fast kinetic slug, no explosive splash, deep sparks and debris |
| `tb` | NOVA | `nova_bomb.glb` | gravity bomb with the largest occlusion-aware blast and dust column |

Each GLB contains named nodes:

- `mount` — equipment visible on the selected drone hardpoint;
- `projectile` — cloneable projectile visual;
- `muzzle` — launch origin;
- `exhaust` — trail origin where applicable;
- `collision_proxy` — hidden dimensions used to validate the gameplay radius.

The registry declares `kind`, cooldown/rate, magazine, regeneration, speed,
gravity, direct damage, splash radius, proximity radius, model key, effect
profile, and camera shake. One generic projectile state machine consumes the
profile. SWARM-8 stores a bounded launch schedule rather than creating all
rockets in one frame. VIPER-X applies capped proportional steering toward the
locked visible target. NOVA uses gravity and no proximity fuse. RAIL resolves
with continuous segment collision and material-specific impact, never a
full-size fireball.

## 4K GLB asset pipeline

Add `pipeline/generate_weapon_arsenal.py`, using the repository's calibrated
Python environment, `trimesh`, NumPy, and Pillow.

For each weapon the generator produces:

- `web/assets/weapons/ultra/<name>.glb` with embedded 4096×4096 base-color,
  normal, and ORM maps;
- `web/assets/weapons/runtime/<name>.glb` with the same named-node contract,
  simplified geometry, and embedded 1024×1024 maps;
- `web/assets/weapons/validation/<name>.json` containing dimensions,
  triangle count, node names, material count, texture dimensions, byte size,
  and SHA-256;
- contact-sheet PNGs under `web/assets/weapons/previews/`.

Desktop manual `extra`, `4k`, and `ultra` quality may load the ultra asset.
Auto/mobile loads runtime GLBs to avoid five decompressed 4K texture sets
residing in mobile GPU memory. Selection preloads only the chosen weapon;
unselected mounts use runtime geometry or remain unloaded.

The generator is deterministic for a fixed seed. Full GLBs remain under
15 MB each, runtime GLBs under 3 MB, full models under 120k triangles, and
runtime models under 30k triangles. Validation rejects missing named nodes,
non-finite accessors, incorrect axes, textures other than 4096×4096 in ultra,
or 1024×1024 in runtime, and malformed GLB chunks.

## Premium impact and smoke renderer

Create `web/flightverse/weapon-effects.js` with fixed-capacity batches:

- smoke/fire sprites in one instanced quad batch;
- sparks/embers in one `THREE.Points` batch;
- streaks in one line-segment batch;
- debris in one instanced mesh batch per material family;
- bounded decals, scorch marks, lights, and shockwave rings.

Effect budgets are:

| Tier | Active particles | Heavy-impact emission |
| --- | ---: | ---: |
| phone | 520 | 96 |
| tablet | 850 | 150 |
| desktop | 1400 | 240 |

This exceeds the current visual density while reducing per-particle scene
objects and draw calls. Pools evict oldest effects and expose active, emitted,
evicted, and peak counters.

Impact profiles use the collision result:

- `structure`: concrete/brick dust, sparks, fragments, oriented scorch;
- `terrain`: low dust ring, dirt fragments, crater, residual smoke;
- `item-metal`: hot sparks, short smoke, no dirt crater;
- `target`: blood/energy response as currently classified;
- `air`: fireball and smoke without surface decal.

Blast damage uses radial falloff and a segment occlusion test from explosion
to target. The visual normal, decal normal, debris impulse, and recorded impact
normal all come from the same collision result. Shockwave rings are thin,
surface-oriented, and capped below 35% viewport diameter; no opaque or
full-screen sprite may represent an explosion.

Smoke uses deterministic multi-lobe textures, soft depth write, velocity
inheritance, buoyancy, drag, gradual color cooling, and size/opacity curves
that do not expose square sprite edges. Phone uses the same effect phases with
lower counts, never a different flat fallback.

## State, accessibility, and lifecycle

- Camera, gimbal, and selected weapon persist in versioned local-storage keys.
- Invalid stored values fall back to FPV, `-7°`, and Missile M.
- Every transient picker has accurate `aria-expanded`, current selection,
  Escape/outside close, focus restoration, and orientation cleanup.
- Fire pointer ownership remains independent of Camera, Gimbal, Menu, and both
  sticks.
- Overlays cancel Fire and collapse Camera/Gimbal/Weapon surfaces before
  disabling input.
- `pagehide` and scene disposal release GLB templates, batches, textures,
  listeners, schedules, and collision bounds exactly once.
- Reduced-motion keeps combat feedback but removes camera transition flourish
  and nonessential animated control effects.

## Verification

### Unit and contract tests

- camera rig controller: FPV gimbal isolation, stable Cenital basis, Orbit
  reset/radius/lead, transition finite matrices;
- scene-item collision: broad-phase reject, exact expanded-AABB sweep,
  penetration recovery, earliest world/item ordering, dead-item removal;
- arsenal registry: nine complete profiles and five distinct new behaviors;
- GLB validation: ten generated files, named-node contract, finite accessors,
  4K/1K texture dimensions, size and triangle budgets;
- impact renderer: tier budgets, pool eviction, material profile, falloff,
  occlusion, cleanup;
- mobile DOM/CSS contracts: Camera, collapsed Gimbal, 3×3 weapon grid, safe
  target sizes, and no stale `.vl-combat-live`/`.vl-fpv-camera` path.

Every production change starts with a focused failing test and a witnessed
failure for the missing or broken behavior.

### Browser acceptance

Run real CDP touch on:

- phone portrait and landscape;
- iPad portrait and landscape;
- desktop pointer/keyboard.

For each touch profile capture and inspect:

- FPV default;
- Camera picker;
- Gimbal collapsed and expanded;
- Weapon picker with all nine choices;
- Cenital after FPV;
- Orbit after Cenital;
- heavy NOVA impact;
- RAIL structure impact.

Geometry checks assert no overlap among stick zones/bases, Camera, Menu,
Weapon, Fire, Gimbal, minimap, picker surfaces, and safe-area bounds. Runtime
checks assert exact camera key/gimbal value, finite normalized camera
quaternion, Cenital roll below 0.5 degrees, Orbit radius within its profile,
all five new weapons decrement ammunition and create the intended projectile,
item collision contact before visual penetration, no console errors, bounded
effects, and no resource growth after repeated switching/firing.

### Release gates

- Python compilation and full smoke;
- all Node suites and static contracts;
- weapon asset audit and GLB loader gate;
- world audit 9/9;
- world runtime sweep;
- Invasion runtime;
- collision stress 100 with every weapon family;
- five-profile Flightverse browser matrix at the existing frame budget;
- web version bump, exact gzip pairs, fingerprint audit, safe restart, and
  authenticated production canary.

## Explicit non-goals

- Do not replace the published photogrammetry mesh with synthetic geometry.
- Do not introduce a general physics-engine dependency in this release.
- Do not make decorative scene fragments authoritative world colliders.
- Do not preload all five ultra 4K models on mobile.
- Do not weaken existing authentication, cache, collision, or deployment
  gates to make the new release pass.
