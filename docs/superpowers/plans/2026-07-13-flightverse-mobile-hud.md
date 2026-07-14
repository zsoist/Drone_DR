# FLIGHTVERSE Mobile HUD Implementation Plan

> **Completed dated plan.** Retained for implementation provenance; current behavior is documented
> in [../../FLIGHTVERSE_IMPLEMENTATION.md](../../FLIGHTVERSE_IMPLEMENTATION.md).

> **For Codex:** Execute with test-driven development and verify the rendered touch layout before completion.

**Goal:** Remove mobile HUD collisions and make flight and combat controls readable, reachable, and premium on portrait phones.

**Architecture:** Preserve the existing HUD DOM and visual language, but introduce explicit mobile menu and combat sheets with mutually exclusive state. CSS coarse-pointer media queries own the touch layout; fine-pointer rules remain intact. Browser QA inspects actual rectangles and touch target sizes.

**Tech Stack:** Vanilla JavaScript, CSS media queries, Python CDP browser matrix, unittest.

---

### Task 1: Lock the regression contract

- [x] Add a static mobile HUD contract test for accessible launchers and grouped combat markup.
- [x] Extend `pipeline/browser_matrix.py` to open each sheet and measure stick collisions, horizontal overflow, and target sizes.
- [x] Run the focused tests and confirm they fail against the current overlapping HUD.

### Task 2: Group and control the mobile HUD

- [x] Add labelled Menú and Combate launchers, sheet headings, and close actions.
- [x] Group weapons, fire, kills, and status without changing gameplay event bindings.
- [x] Add mutually exclusive open/close behavior, Escape handling, ARIA state, and close-on-action behavior.

### Task 3: Build the collision-free touch layout

- [x] Reserve the two lower corners for sticks.
- [x] Center minimap and status between sticks.
- [x] Render Menú as a two-column vertical sheet and Combate as a compact control sheet.
- [x] Enforce 44 px minimum targets, safe areas, focus states, and portrait/landscape constraints.

### Task 4: Verify and package

- [x] Regenerate compressed web assets; server-side fingerprint injection supplies the current cache-safe version.
- [x] Run static tests, syntax checks, and mobile/tablet/desktop browser matrix.
- [x] Inspect a combined before/after screenshot and fix visible mismatches.
- [x] Restart the local service safely and confirm the public flight route remains healthy.
