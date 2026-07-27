# Task 4 fix round 1 — final interaction review

Status: DONE

## RED

- `pipeline/test_mobile_command.mjs` failed because picker outside dismissal
  restored focus to Weapon and its document `pointerdown` listener was not in
  capture phase.
- `pipeline/test_touch_controls.mjs` failed because the touch-stick controller
  had no explicit `reset()` lifecycle.
- The live phone portrait CDP gate held both sticks and Fire, rotated
  390×844 → 844×390, and observed Fire released/picker closed while flight
  remained stuck at `fwd=0.75` and `lift=0.75`.
- The repository gzip audit initially found 48 defects: two byte-mismatched
  edited sidecars and 46 source-newer sidecars, including
  `mobile-command.js.gz` 221 ns older than its source.
- The first local commit attempt was blocked because the hook's default Python
  environment lacked `skimage`; rerunning the same hook with the documented
  `/tmp/aerobrain-testdeps` path passed. No hook was bypassed.

## GREEN

- Picker outside dismissal now runs in capture with the same option object used
  for removal, so a real Fire touch closes the picker before Fire stops
  bubbling and produces exactly one accepted shot.
- Pointer-driven outside dismissal no longer restores Weapon focus. Escape and
  selection retain focus restoration. The browser gate proves
  picker → real-touch Menu → close restores focus to `#vl-fab`.
- Orientation cleanup explicitly closes the picker, cancels/releases Fire, and
  resets both sticks without relying on `pointercancel`.
- The live two-phase CDP rotation gate holds both sticks plus Fire, asserts Fire
  false and all axes zero after rotation, opens the picker, rotates back,
  asserts it closed, and verifies exact viewport/orientation restoration.
- The gzip gate now scans every compressible source and every repository
  sidecar for missing/orphaned pairs, decompression errors, byte identity, and
  nanosecond freshness. Regeneration validates gzip identity and normalizes
  source/sidecar mtimes exactly.
- Web fingerprint changed once from v311 to v312, and all 92 sidecars were
  regenerated or normalized.

## Verification

- Node focused: 30/30 PASS.
- Python mobile contracts: 36/36 PASS.
- Phone portrait Flightverse: Mundo 9 islands; Volar 60 fps; real-touch PASS.
- Phone landscape Flightverse: Mundo 9 islands; Volar 60 fps; real-touch PASS.
- Python/JavaScript syntax checks: PASS.
- Full smoke suite: PASS.
- Repository gzip suite: 6/6 PASS.
- `git diff --check`: PASS.

## SHA

Implementation commit: `b2e1e544` (`fix: harden mobile command cleanup`).

No push, merge, restart, deployment, or production canary was performed.
