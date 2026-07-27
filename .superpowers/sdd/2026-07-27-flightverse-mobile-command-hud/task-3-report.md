# Task 3 — Real-touch browser gate

Status: DONE

## RED

The Task 3 tests were added before the implementation. The focused run failed
with two missing helper errors (`touch_point` and
`command_hud_screenshot_path`) and a missing
`Input.dispatchTouchEvent` contract.

## GREEN

`pipeline/browser_matrix.py` now:

- dispatches complete active CDP touch-point sets;
- uses real touch for Fire, weapon selection, hold/repeat, cancellation,
  ownership, rapid taps, missile lock/rearm, and a three-pointer scenario;
- records the result as `touchCommandHud`;
- measures closed, weapon-picker, and Menu geometry against the visual
  viewport, safe areas, collisions, and minimum targets;
- blocks zoom, text selection, and tap-highlight regressions;
- captures the 12 required state screenshots;
- retains a desktop mouse Fire gate.

Verification:

- `python3 -m unittest pipeline.test_volar_mobile -v` — 32/32 PASS
- `python3 -m py_compile pipeline/browser_matrix.py pipeline/test_volar_mobile.py` — PASS
- `git diff --check` — PASS
- Four-profile Flightverse touch matrix — PASS at 60 FPS
- Focused phone portrait and landscape runs — PASS
- Twelve screenshots inspected at original resolution — PASS

## Artifacts

- `.gstack/qa-reports/qa-report-world-mobile-2026-07-27.md`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-mobile_portrait-{closed,weapons,menu}.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-mobile_landscape-{closed,weapons,menu}.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-ipad_portrait-{closed,weapons,menu}.png`
- `/Volumes/SSD/drone-vault/qa/matrix-volar-ipad_landscape-{closed,weapons,menu}.png`

## Commit

The implementation and this report are committed together. The authoritative
SHA is reported in the Task 3 handoff because a commit cannot contain its own
final SHA.

## Concerns

CDP requires empty touch-point lists for `touchEnd` and `touchCancel`, so it
cannot lift only one contact while retaining other contacts in the same
dispatch. The three-pointer gate ends the physical set and immediately
restarts the two logical stick contacts with identical IDs and coordinates
before sampling continued flight input. This limitation and the restart are
recorded explicitly in `touchCommandHud`.

The phone-landscape weapon picker partially covers the FPV telemetry strip
while open. It remains bounded, readable, collision-free, and leaves the world
visible, so this is non-blocking.
