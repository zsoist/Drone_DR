# FLIGHTVERSE Touch Workspace Implementation Plan

> **Completed dated plan.** Retained for implementation provenance; current behavior is documented
> in [../../FLIGHTVERSE_IMPLEMENTATION.md](../../FLIGHTVERSE_IMPLEMENTATION.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile flight panels persistent, draggable and preview-friendly, with verified working weapons.

**Architecture:** A focused panel-drag helper manages pointer capture, viewport clamping and saved positions. `volar.js` keeps feature state and uses the helper for Menu, Combat and Image. Browser QA verifies behavior, not only DOM presence.

**Tech Stack:** ES modules, Pointer Events, CSS dynamic viewport units, Python unittest, Chrome DevTools Protocol matrix.

## Global Constraints

- Preserve the existing AeroBrain visual language and current flight physics.
- Minimum interactive target is 44px.
- Panels must remain inside the visual viewport after drag, resize and orientation change.
- Do not treat a synthetic visual change as proof of weapon firing; verify ammunition changes.

---

### Task 1: Lock interaction contracts

**Files:**
- Modify: `pipeline/test_volar_mobile.py`
- Modify: `pipeline/browser_matrix.py`

**Interfaces:**
- Consumes: current `#vl-dock`, `#vl-combat`, `#vl-grade`, `#vl-fire` DOM.
- Produces: failing assertions for persistent controls, draggable panels, preview height and ammo decrement.

- [ ] Add static contract tests for `makeDraggablePanel`, persistent menu behavior and owned fire pointer events.
- [ ] Run `python3 -m unittest pipeline.test_volar_mobile -v` and confirm the new tests fail.
- [ ] Extend `run_volar` to change a menu setting, move a panel, and fire the selected weapon.

### Task 2: Add bounded touch dragging

**Files:**
- Create: `web/flightverse/panels.js`
- Modify: `web/volar.js`
- Modify: `web/style.css`

**Interfaces:**
- Produces: `makeDraggablePanel(panel, handle, storageKey)` returning `{ clamp(), reset() }`.
- Consumes: panel elements and non-interactive header space.

- [ ] Implement pointer capture, interactive-child exclusion, visual viewport clamping and normalized localStorage positions.
- [ ] Mount the helper on Menu, Combat and Image headers.
- [ ] Re-clamp panels on resize and visual viewport resize.
- [ ] Run the static contract tests and confirm they pass.

### Task 3: Fix menu and combat behavior

**Files:**
- Modify: `web/volar.js`
- Modify: `web/style.css`

**Interfaces:**
- Consumes: existing `setMobileSheet`, `setWeapon`, `doFire`.
- Produces: persistent menu actions and a fire gesture that starts and ends deterministically.

- [ ] Remove the coarse-pointer auto-close after ordinary menu buttons.
- [ ] Give weapon buttons full labels and add a visible DISPARAR label.
- [ ] Own fire `pointerdown`, `pointerup`, `pointercancel` and `lostpointercapture`; preserve MG hold behavior.
- [ ] Verify browser QA sees ammo decrease and the menu remain open.

### Task 4: Make Image a compact live inspector

**Files:**
- Modify: `web/style.css`
- Modify: `web/volar.js`

**Interfaces:**
- Consumes: existing live `input` handler and grade state.
- Produces: a compact, scrolling, draggable inspector with the scene visible behind it.

- [ ] Replace the portrait full-screen rule with a maximum 46dvh bottom inspector.
- [ ] Keep the header sticky and draggable while sliders scroll.
- [ ] Ensure outside taps do not close the editor during drag or slider input.
- [ ] Verify at least 45% of the viewport remains outside the panel.

### Task 5: Publish and verify

**Files:**
- Update gzip sidecars for modified web assets.

**Interfaces:**
- Consumes: completed implementation.
- Produces: public build and QA screenshots.

- [ ] Run JS syntax checks and all focused unit tests.
- [ ] Run FLIGHTVERSE browser matrix for mobile and iPad.
- [ ] Capture screenshots and compare with the supplied iPhone reference.
- [ ] Confirm the public HTML serves the new fingerprint.
