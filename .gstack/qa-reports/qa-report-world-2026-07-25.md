# QA Report: AeroBrain World v305

| Field | Value |
|-------|-------|
| **Verification date** | 2026-07-26 |
| **URL** | `http://127.0.0.1:8790` |
| **Branch** | `codex/scene-ops-stability` |
| **Release base** | `8f98c907` |
| **PR** | [#1](https://github.com/zsoist/Drone_DR/pull/1) |
| **Tier** | Exhaustive |
| **Scope** | Mundo and Volar, phone/iPad portrait+landscape and desktop |
| **Status** | Local release gates passed; production canary recorded separately |
| **Browser profiles** | 5 |
| **Pages exercised** | 10 matrix surfaces, 9 runtime worlds, Invasion and collision fixture |
| **Fresh screenshots** | 11 |
| **Framework** | Vanilla ES modules, Three.js r180, MapLibre |

## Health Score: 100/100

| Category | Score |
|----------|------:|
| Console | 100 |
| Links | 100 |
| Visual | 100 |
| Functional | 100 |
| UX | 100 |
| Performance | 100 |
| Content | 100 |
| Accessibility | 100 |

## Release evidence

- `world_runtime_sweep.py`: 9/9 active worlds passed at 60 fps. The mesh-preferred
  world activated exactly one mesh request; all eight terrain-preferred worlds
  kept the visual mesh deferred with zero OBJ requests.
- `invasion_runtime_gate.py`: 60 fps, eight live GLB enemies across zombie,
  soldier and UFO, preload 6/6, zero procedural fallback, zero spawn/load
  failures, every runtime cap respected and each GLB fetched once.
- `flightverse_collision_gate.py --stress 100`: 100/100 samples passed at
  60 fps with 20 observed fires, 20 observed explosions, four reloads, zero
  console errors and zero FPV camera collision work.
- Deterministic collision fixture: 28/28 assertions and 10,000 queries in
  8.9 ms. Every projectile/explosion pool evicted under pressure; rendered
  memory returned from 428 peak geometries to the 150 persistent baseline and
  then to the two renderer-owned baseline geometries after teardown.
- Full browser matrix: Mundo showed nine islands and Volar reported 60 fps on
  phone portrait, phone landscape, iPad portrait, iPad landscape and desktop.
  Every touch profile passed target sizing, safe-area/overlap, sheet
  exclusivity, scrim dismissal, neutral input ownership, blocked hotkeys,
  focus trap, record resume and trigger re-press checks.
- Visual inspection of all ten matrix captures found no clipped sheets,
  overlapping controls, duplicate world cards or broken navigation. The
  Invasion evidence capture also rendered cleanly.

Screenshot evidence:

- `/Volumes/SSD/drone-vault/qa/matrix-mundo-mobile_portrait.png`
- `/Volumes/SSD/drone-vault/qa/matrix-mundo-mobile_landscape.png`
- `/Volumes/SSD/drone-vault/qa/matrix-mundo-ipad_portrait.png`
- `/Volumes/SSD/drone-vault/qa/matrix-mundo-ipad_landscape.png`
- `/Volumes/SSD/drone-vault/qa/matrix-mundo-desktop.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-mobile_portrait.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-mobile_landscape.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-ipad_portrait.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-ipad_landscape.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-desktop.png`
- `/Volumes/SSD/drone-vault/qa/recon_c97cd120a1-invasion-runtime.png`

## Regression closure

All five v291 baseline findings are closed:

1. Inactive visual meshes are deferred. The exact baseline scene made zero OBJ
   requests and reduced startup from 124 to 47 requests.
2. Mobile HUD controls and touch sheets passed geometric overlap checks in both
   orientations on phone and iPad.
3. Mundo reduced initial requests from 26 to 19 and no longer initiates all
   orthophoto cards as image elements.
4. Every-map runtime sweep and the five-profile browser matrix completed with
   no product JavaScript errors.
5. World cards and modal controls expose keyboard/focus ownership; the matrix
   verifies trapped focus, Escape/scrim behavior and restored launch focus.

Chromium emitted only the known screenshot-time `ReadPixels` GPU stall warning.
It is produced by capture and is excluded from product console health.

## Ship readiness

Local release verification is green. No actionable product issue was found in
the v305 candidate. Production health and login-boundary evidence live in
`.gstack/canary-reports/world-v305.md`.
