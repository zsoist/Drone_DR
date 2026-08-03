# Task 7 report — premium Flightverse browser acceptance

Status: PASS
Final local web build: v331

## Evidence-backed findings and fixes

1. The nine-weapon panel could collide with landscape combat controls.
   The weapon coordinator now publishes active state; opening it closes flight
   tools, hides gimbal, and uses a bounded top-band grid.
2. Camera/Menu and Weapon/Fire overlapped general chase telemetry in
   landscape Top/Orbit. Non-FPV rails now form compact horizontal rows below
   Mundo/Share and ALT/VEL/VS. Browser geometry includes every chase corner,
   compass, challenge, and go-to surface.
3. Expanded gimbal was vertical, covered FPV status, and nearly touched the
   stick zones. It is now a horizontal lane at the upper center. The browser
   gate fails below 8 px clearance as well as on an actual intersection.
4. Orbit was mathematically finite but visually too distant. RED camera tests
   changed its contract to FOV 48°, radius 5.5–16 m, height 2–6 m, and a
   faster local phase. Original screenshots now show a legible drone.
5. The browser gate previously accepted cameras, weapons, and impacts without
   enough live evidence. It now records camera ownership/quaternion, real
   gimbal drag, all five new weapon deltas, selected asset tier/nodes,
   composite contact, five effect batches, particle peak/budget, resource
   counters, FPS, geometry, and console state.
6. The final Python suite exposed GLB byte nondeterminism caused by Pillow PNG
   filter heuristics changing with import order. A deterministic RGB PNG
   encoder and aligned buffer-view repacker fixed it. Two opposite import
   orders and the repository seed rebuild are byte-identical.

Every production fix was preceded by a failing focused assertion and was
re-run green without relaxing frame, collision, geometry, asset, or particle
thresholds.

## Final browser matrix

```text
mundo/mobile_portrait: ok · 9 islas
volar/mobile_portrait: ok · 60fps · touch=real
mundo/mobile_landscape: ok · 9 islas
volar/mobile_landscape: ok · 60fps · touch=real
mundo/ipad_portrait: ok · 9 islas
volar/ipad_portrait: ok · 60fps · touch=real
mundo/ipad_landscape: ok · 9 islas
volar/ipad_landscape: ok · 60fps · touch=real
mundo/desktop: ok · 9 islas
volar/desktop: ok · 60fps
```

Touch screenshots:

- `matrix-volar-mobile_portrait-{fpv,camera,gimbal,weapons9,top,orbit,nova-impact,rail-impact}.png`
- `matrix-volar-mobile_landscape-{fpv,camera,gimbal,weapons9,top,orbit,nova-impact,rail-impact}.png`
- `matrix-volar-ipad_portrait-{fpv,camera,gimbal,weapons9,top,orbit,nova-impact,rail-impact}.png`
- `matrix-volar-ipad_landscape-{fpv,camera,gimbal,weapons9,top,orbit,nova-impact,rail-impact}.png`

All were generated under `/Volumes/SSD/drone-vault/qa/`. Targeted
original-resolution inspection covered every state across the four layout
classes, with final reinspection of landscape gimbal, Top, Orbit, NOVA, and
RAIL after the last geometry and camera changes.

## Regression gates

- Python compile: PASS.
- Node: 78/78 PASS.
- Python: 75/75 PASS, including ten deterministic 4K/runtime GLBs and exact
  gzip freshness.
- Full smoke: PASS.
- World audit: 9/9 current colliders.
- World sweep: 9/9 at 60 fps.
- Invasion: 60 fps, GLB preload 6/6, within all runtime caps.
- Collision fixture/stress: 100/100, 60 fps, no failures.
- Final five-profile browser matrix on exact v331 tree: PASS.

Task 7 is complete. Task 8 owns candidate commit identity, push, safe restart,
production canary, and immutable evidence.
