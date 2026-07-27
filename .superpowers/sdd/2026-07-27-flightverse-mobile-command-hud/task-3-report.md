# Task 3 — Real-touch browser gate

Status: DONE

## RED

The Task 3 tests were added before the implementation. The focused run failed
with two missing helper errors (`touch_point` and
`command_hud_screenshot_path`) and a missing
`Input.dispatchTouchEvent` contract.

The review-fix RED added behavioral/helper tests for partial release, restored
base acceptance, real safe-area resolution, and result formatting. The four
tests failed on the intentionally missing helpers. Runtime RED then showed:

- omitting Fire from `touchMove` did not release it;
- the early return had removed the established overlay/hotkey/sheet/chase gates;
- phone-landscape weapon geometry crossed a real emulated top inset by 2.8 px.

## GREEN

`pipeline/browser_matrix.py` now:

- dispatches complete active CDP touch-point sets;
- releases only Fire with `touchEnd([fire])` and proves the original two stick
  IDs remain active without a restart;
- uses real touch for Fire, weapon selection, hold/repeat, cancellation,
  ownership, rapid taps, missile lock/rearm, and a three-pointer scenario;
- records owner/secondary pointer event order and verifies owner ID,
  press/accepted counters, secondary release, and final owner release;
- records the result as `touchCommandHud`;
- measures closed, weapon-picker, and Menu geometry against the visual
  viewport, safe areas, collisions, and minimum targets;
- blocks zoom, text selection, and tap-highlight regressions;
- emulates and resolves safe insets of 17/13/23/11 px through CDP;
- restores the complete Menu/overlay, hotkey, sheet, image-drag, camera-cycle,
  and chase-HUD acceptance that existed before Task 3;
- captures the 12 required state screenshots;
- retains a desktop mouse Fire gate.

Verification:

- `python3 -m unittest pipeline.test_volar_mobile -v` — 35/35 PASS
- `python3 -m py_compile pipeline/browser_matrix.py pipeline/test_volar_mobile.py` — PASS
- `git diff --check` — PASS
- Focused phone landscape — PASS at 60 FPS on v311
- Default Flightverse matrix — four real-touch viewports plus desktop PASS at
  60 FPS; every Mundo run returned nine islands
- Twelve regenerated v311 screenshots inspected — PASS with the qualified
  minor occlusion below

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

Chrome 150 treats `touchEnd` points as the contacts being lifted. The
three-pointer gate therefore sends `touchEnd([fire])`, observes Fire
`pointerup` plus `touchend changed=[903]`, and keeps original stick IDs
`[901,902]` active through the following movement. No stick restart occurs.

The weapon picker covers part of the telemetry/world imagery in both landscape
profiles and in iPad portrait. It remains bounded, readable, and free of
interactive-control collisions, so this is a minor non-blocking occlusion.
