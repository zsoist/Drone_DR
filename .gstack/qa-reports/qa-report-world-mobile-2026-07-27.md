# Flightverse world + mobile premium QA — 2026-07-27

Status: PRODUCTION PASS
Candidate web build: v331
Target: `recon_c97cd120a1` on `http://127.0.0.1:8790`

## Outcome

The final five-profile matrix passes at 60 fps with no console errors:

| Profile | Mundo | Volar | Input |
| --- | ---: | ---: | --- |
| Phone portrait | 9 islands | 60 fps | real touch |
| Phone landscape | 9 islands | 60 fps | real touch |
| iPad portrait | 9 islands | 60 fps | real touch |
| iPad landscape | 9 islands | 60 fps | real touch |
| Desktop | 9 islands | 60 fps | mouse |

The four touch profiles capture and validate eight premium states each:
`fpv`, `camera`, `gimbal`, `weapons9`, `top`, `orbit`, `nova-impact`, and
`rail-impact`. The 32 original-resolution artifacts live under
`/Volumes/SSD/drone-vault/qa/matrix-volar-<profile>-<state>.png`.

## Mobile and camera acceptance

- Camera, camera picker, Menu, weapon, Fire, gimbal, sticks, FPV status,
  chase HUD, compass, challenge, and go-to controls have zero measured
  intersections and remain inside the visual viewport with emulated safe
  insets 17/13/23/11 px.
- Fire is at least 72×72, weapon/camera 56×56, Menu 52×52, collapsed gimbal
  96×44, and picker rows meet the 44 px touch floor.
- Expanded landscape gimbal is a horizontal lane and stays at least 8 px from
  both stick zones/bases. It no longer covers the FPV status strip.
- The nine-weapon landscape picker occupies the top band and mutually closes
  camera, gimbal, and Menu surfaces.
- `gesturestart/change/end`, selection, context menu, callout, tap highlight,
  and page zoom are blocked on the flight surface without disabling form
  controls.
- Real CDP touch proves one-shot, MG hold/release, three simultaneous
  contacts, owner isolation, partial Fire release while both sticks remain
  active, cancellation, rotation cleanup, focus restoration, and no ghost
  shot.
- FPV alone owns the gimbal. A real range drag reaches approximately −83°.
  Cenital has a finite normalized quaternion and roll below 0.5°. Orbit uses
  FOV 48° and a close-action 5.5–16 m radius with resettable finite phase.

## World, collision, weapons, and effects

- `audit_world.py`: 9/9 active worlds expose valid mesh, terrain, and current
  collision metadata.
- `world_runtime_sweep.py`: 9/9 worlds pass at 60 fps; each owns one active
  structural representation and no duplicated mesh/splat layer.
- Composite collision records drone sweeps, camera casts, and weapon casts
  against scene items and the real world collider. This map has zero authored
  destructible items, so acceptance correctly requires world contact plus a
  weapon hit against either photogrammetric structure or DSM terrain instead
  of inventing an item hit.
- Collision stress: 100/100 passes at 60 fps, 17 shots, 17 explosions, four
  reloads, no stale scene generation, and no console error.
- The arsenal is exactly `mg,s,m,l,ac,sw,vx,rg,tb`. AC-30, SWARM-8, VIPER-X,
  RAIL, and NOVA each select through the visible picker, load the runtime GLB,
  expose the four named nodes, consume exact ammo, fire, and impact.
- Effects use five draw batches with soft alpha. Active budgets are
  phone 520, tablet 850, desktop 1400; heavy emission is 96/150/240 and the
  shockwave diameter cap is 35% of the viewport.
- Original-resolution review confirms localized sparks/debris for NOVA and a
  soft smoke trail for RAIL. The former giant full-screen explosion ring is
  absent.

## Weapon asset integrity

The five original assets each have embedded base-color, normal, and ORM maps:
4096² in ultra and 1024² in runtime. Ultra files are 5.18–5.58 MB (limit
15 MB); runtime files are 0.86–1.10 MB (limit 3 MB).

The generator now canonicalizes embedded PNG streams and aligns/rebuilds GLB
buffer views. Opposite module-import orders produce identical bytes, and the
seed rebuild gate passes for all ten GLBs.

## Local release evidence

```text
Python compilation                                      PASS
Focused Node suites                                     78/78 PASS
Focused Python suites                                   75/75 PASS
Full smoke suite                                        PASS
World audit                                             9/9 PASS
World runtime sweep                                     9/9 at 60 fps
Invasion runtime                                        60 fps, preload 6/6
Collision stress                                        100/100 PASS
Flightverse browser matrix v331                         10/10 PASS
```

## Production release evidence

- Candidate `b6e2623122bc78e963bfe346e284ae176f414687` was pushed to
  draft PR #1 and deployed with `pipeline/safe_restart.sh server`; no world
  gate bypass was used.
- Public health and login boundary passed twice. `/mundo.html` returned the
  exact unauthenticated 303 login redirect and `/api/whoami` returned 401 with
  private/no-store edge policy.
- A revocable production session proved `/manifest.json`, the weapon manifest,
  and all five runtime GLBs return authenticated 200 with private/no-store
  edge policy.
- The production matrix passed Mundo + Volar on phone portrait/landscape,
  iPad portrait/landscape, and desktop. Every flight profile settled at
  60 fps; all four mobile profiles used real CDP touch.
- The live contact diagnostic measured 5,102 world-collider contacts and
  12 weapon terrain impacts with zero console errors. This exposed and fixed
  a canary classification bug that had only counted `structure`, not the
  equally real DSM `terrain` half of the collider.
- Every temporary production session was deleted in `finally` and then
  verified invalid.

Detailed canary: `.gstack/canary-reports/2026-07-28-canary.md`.
