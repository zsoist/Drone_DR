# Task 2 report — Compact command HUD and weapon picker

## Result

Implemented Task 2 on `codex/scene-ops-stability` from base
`32f02672b7ce0e3d7f2a87e80c4725a461887501`.

Implementation commit:
`bf722fad` (`feat: compact Flightverse mobile HUD`).

Review correction commit:
`075e78e8` (`fix: preserve Flightverse fire pointer ownership`).

The coarse-pointer Flightverse surface now has:

- a compact `#vl-command-hud`;
- a 56×56 weapon control with live weapon code and ammo;
- a collapsible four-option picker with 48px minimum targets;
- a persistent 72×72 fire trigger using the Task 1 pointer-owner controller;
- one 52×52 Menu launcher;
- Camera and Armamento access through Menu;
- overlay, orientation, pagehide, and disposal cleanup;
- Flightverse-scoped gesture guards and coarse-pointer-only selection, callout,
  tap-highlight, overscroll, and touch-action hardening.

The redundant mobile combat launcher, live carousel, and separate FPV camera
control were removed. Desktop layout rules and combat behavior remain on their
existing paths. Physics, damage, collision, and Invasion AI were not changed.

## RED evidence

Tests were written before production changes.

Command:

```text
node --test pipeline/test_mobile_command.mjs
python3 -m unittest pipeline.test_volar_mobile -v
```

Observed expected failures:

- four picker tests failed with
  `TypeError: createWeaponPicker is not a function`;
- mobile layout contracts failed because `#vl-command-hud`,
  `#vl-weapon-toggle`, `#vl-weapon-picker`, controller integration, Menu
  Armamento access, and coarse-pointer gesture CSS were absent.

The pre-existing Task 1 tests remained green during RED.

## GREEN evidence

Focused verification after implementation and again after the v307 bump:

```text
node --test pipeline/test_mobile_command.mjs pipeline/test_touch_controls.mjs
python3 -m unittest pipeline.test_volar_mobile -v
node --check web/volar.js web/flightverse/mobile-command.js
```

Result: 27 Node tests passed, 29 Python mobile HUD contracts passed, and both
JavaScript syntax checks exited 0.

Full verification:

```text
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
PYTHONPATH=pipeline:/tmp/aerobrain-testdeps \
  python3 -m unittest pipeline.test_static_gzip_freshness -v
git diff --check
```

Result:

- full smoke: `TODOS LOS TESTS PASAN`;
- gzip freshness: 4 tests passed;
- diff check: clean;
- pre-commit smoke hook: green.

## Review correction — multitouch fire ownership

Review found that `volar.js` still registered a window-level pointer-up handler.
While Fire pointer A was held, a stick/secondary pointer B could bubble its
release to that handler and clear the active fire state.

The correction replaced the global release path with
`createFirePointerBindings()`, the binding used directly by `volar.js` for both
the desktop `#vl-fire` button and mobile `#vl-trigger`. Each binding releases
only its own captured pointer. `releaseFiring()` also rejects a pointer event
whose ID differs from `triggerState.pointerId`. Keyboard ownership remains a
separate source and was not changed.

Review RED:

```text
node --test pipeline/test_mobile_command.mjs
python3 -m unittest \
  pipeline.test_volar_mobile.VolarMobileHudContractTests.test_fire_control_owns_pointer_gesture_and_is_clearly_named -v
```

Observed expected failures:

- `TypeError: createFirePointerBindings is not a function`;
- the volar wiring contract found the old global unowned pointer-up path.

Review GREEN after the single v307→v308 bump:

```text
node --test pipeline/test_mobile_command.mjs pipeline/test_touch_controls.mjs
python3 -m unittest pipeline.test_volar_mobile -v
node --check web/volar.js web/flightverse/mobile-command.js
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
PYTHONPATH=pipeline:/tmp/aerobrain-testdeps \
  python3 -m unittest pipeline.test_static_gzip_freshness -v
git diff --check
```

Result:

- 28 Node tests passed, including
  `Flightverse fire wiring keeps Fire A held when stick B releases`;
- 29 Python mobile HUD contracts passed;
- JavaScript syntax checks passed;
- full smoke reported `TODOS LOS TESTS PASAN`;
- gzip freshness passed 4/4;
- diff check and pre-commit smoke passed.

## Files

Behavior and tests:

- `web/flightverse/mobile-command.js`
- `web/volar.js`
- `web/style.css`
- `pipeline/test_mobile_command.mjs`
- `pipeline/test_volar_mobile.py`

Release mechanics:

- initial implementation fingerprint bumped exactly once from v306 to v307;
- review correction fingerprint bumped exactly once from v307 to v308;
- all fingerprint-bearing files under `web/` were updated mechanically;
- gzip sidecars were regenerated, including
  `web/flightverse/mobile-command.js.gz`, `web/volar.js.gz`, and
  `web/style.css.gz`.

## Concerns and follow-up

- This task proves picker/controller behavior and static layout contracts.
  Real-touch dispatch, four-profile geometry/overlap measurements, rotation
  screenshots, and the expanded browser matrix remain Task 3 scope.
- No server restart, deployment, push, merge, collision gate, or production
  canary was run because Task 2 explicitly excludes deployment.
