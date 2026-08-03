# FLIGHTVERSE Near-Structure Flight Design

**Status:** Approved by the operator's standing autonomous approval.

## Problem

FLIGHTVERSE normalizes the deployed drone model to an X span of 0.85 m. The
current structural collider is a sphere with a 1.20 m radius. In the deterministic
wall fixture, the drone center stops at x=2.799 for a wall at x=4.0. The visible
model therefore stops roughly 0.78 m before its nearest part reaches the wall.

Chase cameras also accept the rig position without checking the unified world
collider. A wall between the drone and the requested camera position can therefore
fill or clip through the view even though the drone itself collides correctly.

## Goals

- Keep continuous drone collision and tangential sliding.
- Match structural clearance to the loaded visual drone envelope.
- Preserve the existing 1.20 m terrain AGL safety rule.
- Prevent non-FPV gameplay cameras from crossing terrain, structures, or the
  playable boundary between the drone and the desired camera position.
- Preserve 60 FPS gates and avoid multiplying structural sweeps per physics step.
- Expose collision envelope and camera-contact counters in `window.__volar`.

## Considered Approaches

### A. Five-sphere compound collider

Model the body and four rotor zones separately. This gives a close silhouette but
requires up to five BVH sphere sweeps for every contact iteration. It also makes
depenetration and two-contact sliding depend on which probe wins.

### B. Continuous convex collider

Sweep an oriented convex hull through the triangle BVH. This is the most exact
representation but requires a new narrow-phase solver and a much larger regression
surface than this browser engine needs.

### C. Model-derived conservative sphere plus camera boom collision

Use one conservative structural sphere whose radius follows the visual GLB bounding
sphere, with a small safety margin and sane clamps. Keep the independent terrain AGL
rule. Raycast the camera boom through the same unified world collider and pull the
camera in front of the earliest contact.

**Decision:** C. It fixes the measured false gap while preserving the single-sweep
physics architecture and adds the missing visual collision response.

## Architecture

### Drone collision envelope

`createDrone()` owns a mutable, validated `collisionRadius` initialized to 0.59 m,
the conservative envelope for the shipped 0.85 × 0.284 × 0.70 m model. It exposes
`setCollisionRadius(radius)` and rejects non-finite or unsafe values by retaining the
last valid radius.

After the custom GLB is uniformly normalized, `volar.js` derives its bounding-sphere
radius, adds 0.02 m of physical margin, clamps the result to 0.42–0.70 m, and passes
it to the drone. Every embedded check, continuous sweep, and depenetration calculation
uses the same current radius.

The 1.20 m `MIN_AGL` rule remains independent. Lowering structural clearance must not
let the aircraft enter the heightfield.

### Camera collision

`resolveCameraCollision(world, focus, desired, clearance)` is an exported runtime
helper. It casts one segment through the unified collider. When an earliest hit
exists, it moves `desired` along the original boom to `hitDistance - clearance`,
never beyond the contact. It returns the hit for telemetry and returns `null` when
the desired pose is clear.

The helper runs after non-FPV gameplay rigs calculate their desired pose and before
shake/postprocessing. Director, cinematic tour, arrival, and FPV retain their
intentional camera behavior.

## Telemetry

`window.__volar.collision.radius_m` reports the active structural radius.
`window.__volar.camera.collision_hits` counts camera boom corrections. The collision
fixture records the exact near-wall center and verifies camera pull-in coordinates.

## Failure Handling

- Invalid computed GLB bounds keep the validated default radius.
- A missing `castSegment` method disables camera correction without breaking render.
- Collision exceptions leave the requested camera pose unchanged and increment no
  success counter.
- Existing drone sweep failures continue to fail closed at the last safe pose.

## Acceptance Criteria

1. The wall fixture stops the 0.85 m drone center between x=3.38 and x=3.43 for a
   wall at x=4.0, without tunneling and while retaining tangential slide.
2. Spawn depenetration uses the same active envelope and remains deterministic.
3. A desired chase camera at x=6 behind the x=4 wall is resolved to x≤3.82 and
   remains on the drone side of the wall.
4. Terrain AGL protection remains 1.20 m.
5. Collision fixture, focused unit tests, browser matrix, 100-run live collision
   stress, smoke suite, and world audit pass with no console errors or resource growth.
6. The active world maintains at least 50 FPS in the deployment gates.
