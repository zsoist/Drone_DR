# QA Report: Home hero drone

| Field | Value |
| --- | --- |
| Date | 2026-08-02 |
| URL | `http://127.0.0.1:8790/home.html` |
| Branch | `codex/scene-ops-stability` |
| Scope | Inicio, hero drone, desktop and mobile |
| Framework | Vanilla HTML/CSS/JavaScript + Three.js |
| Issues | 1 found, 1 verified, 0 deferred |
| Health score | 93 before, 100 after |
| Status | DONE |

## ISSUE-001: Drone fragmented, static and off-center

**Severity:** High

**Categories:** Visual, functional, UX

**Fix status:** Verified

### Reproduction

1. Open Inicio at 1024×609 CSS pixels, matching the supplied Retina capture.
2. Wait for `#home-drone-stage canvas`.
3. Observe that the animated WebGL model is shifted left inside its stage.
4. Capture an animated frame. Chrome's compositor fragments the canvas while
   its CSS `drop-shadow()` is active.
5. Open at 390×844. The whole drone stage is shifted 91.8 px to the right and
   clips the model.

Before evidence:

- `screenshots/issue-001-home-drone-before-retina-css.png`
- `screenshots/issue-001-filter-disabled-experiment.png`

The controlled experiment removed only the canvas filter at runtime. The next
frame rendered the complete GLB, identifying the filter/compositor boundary as
the corruption source.

### Root cause

- `.hv2-drone-stage canvas` applied a CSS `drop-shadow()` to a continuously
  animated transparent WebGL canvas.
- `home-drone.js` set `rig.position.x = -0.3` and camera Y to `0.22`, so the
  model origin projected away from the stage center.
- The GLB exposes `prop_1` through `prop_4`, but Inicio never advanced those
  rotor nodes.
- Phone CSS positioned the entire stage at `right: -15%`.

### Fix

- Removed the compositor filter from the WebGL canvas.
- Centered camera and rig on the same origin and explicitly aimed the camera.
- Added deterministic, counter-rotating motion for all four GLB propellers.
- Disabled ambient/rotor movement for `prefers-reduced-motion`.
- Centered the entire stage on phone/tablet without transforms or clipping.

### Verification

- TDD red: 3/3 motion/framing regressions failed before implementation.
- TDD green: 3/3 motion/framing regressions pass.
- Real browser gate: desktop 1024×609 and phone 390×844 pass.
- Desktop stage/canvas centers match exactly.
- Mobile hero/stage center delta: `-0.0078125 px`.
- CSS canvas filter: `none` on both profiles.
- Horizontal overflow: zero.
- WebGL stage ready: true.
- Browser application errors: zero.
- Home + gzip focused suite: 20/20.

After evidence:

- `screenshots/issue-001-home-drone-after-desktop-v333.png`
- `screenshots/issue-001-home-drone-after-mobile-centered-v333.png`

The GPU warnings emitted only while the QA tool performs screenshot
`ReadPixels`; they are Chrome performance diagnostics, not application errors.

## Score

| Category | Before | After |
| --- | ---: | ---: |
| Console | 100 | 100 |
| Links | 100 | 100 |
| Visual | 85 | 100 |
| Functional | 85 | 100 |
| UX | 85 | 100 |
| Performance | 100 | 100 |
| Content | 100 | 100 |
| Accessibility | 100 | 100 |

Weighted health score: **93 → 100**.

## PR summary

QA found 1 Home hero issue, fixed 1, health score 93 → 100. The real GLB is
centered on desktop and phone, all four propellers animate in opposite pairs,
reduced motion is static, and the WebGL compositor corruption is gone.
