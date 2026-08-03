# Unified 3D Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate cloud, mesh, and Gaussian panels with one responsive viewer whose navigation matches the private Share viewer.

**Architecture:** A small pure state module defines modes, availability fallback, and header copy. `tresd.js` renders one panel and mounts exactly one existing renderer into one host, disposing it on every mode/project/version change. `style.css` supplies the unified layout and responsive toolbar behavior.

**Tech Stack:** Browser ES modules, Three.js r180, Spark Gaussian renderer, Python unittest, Node test runner, CSS.

## Global Constraints

- Preserve the Share viewer behavior as the navigation reference.
- Keep map, reports, downloads, and scene-improvement behavior unchanged.
- Never keep more than one active WebGL renderer in the unified viewport.
- Preserve load-token guards for async race safety.
- Run `python3 pipeline/bump_web_version.py` after editing `web/`.

---

### Task 1: Pure viewer mode contract

**Files:**
- Create: `web/unified-viewer-state.js`
- Create: `tools/test_unified_viewer_state.mjs`

**Interfaces:**
- Produces: `VIEWER_MODES`, `normalizeViewerMode(mode, availability)`, and `viewerHeaderState(mode, context)`.

- [x] **Step 1: Write failing Node tests** for valid selection, weak mesh fallback, missing Gaussian fallback, and contextual labels.
- [x] **Step 2: Run `node --test tools/test_unified_viewer_state.mjs`** and verify it fails because the module is missing.
- [x] **Step 3: Implement the minimal pure module** with no DOM dependencies.
- [x] **Step 4: Run the Node test again** and verify all cases pass.

### Task 2: One panel and one lifecycle

**Files:**
- Modify: `web/tresd.js`
- Modify: `pipeline/test_tresd_static.py`

**Interfaces:**
- Consumes: the Task 1 state module.
- Produces: one `#scene-viewer-box`, a `#scene-viewer-tabs` tablist, and `activateViewerMode(mode, {autoload})`.

- [x] **Step 1: Add failing static tests** asserting one unified viewport, three semantic tabs, one contextual load action, and removal of the legacy `fl-layout` viewer pair.
- [x] **Step 2: Run `python3 -m unittest pipeline.test_tresd_static`** and verify the new test fails.
- [x] **Step 3: Replace the three panel templates** with the unified panel and stable header controls.
- [x] **Step 4: Refactor cloud, mesh, and Gaussian loaders** to mount into the shared host, guard by active mode and token, and dispose before switching.
- [x] **Step 5: Update project selection, splat version switching, splat-card deep links, and delete refreshes** to target the unified lifecycle.
- [x] **Step 6: Run Node syntax and both focused test suites** until green.

### Task 3: Responsive workspace styling

**Files:**
- Modify: `web/style.css`
- Modify: `pipeline/test_tresd_static.py`

**Interfaces:**
- Consumes: unified viewer classes and accessibility attributes from Task 2.
- Produces: desktop/mobile sizing, tab states, contextual status layout, and non-obscuring HUD behavior.

- [x] **Step 1: Add failing CSS contract assertions** for unified desktop height, mobile height, tab focus/selected states, and horizontal HUD overflow.
- [x] **Step 2: Run the static suite** and verify failure.
- [x] **Step 3: Add scoped `.scene-viewer-*` styles** and remove obsolete per-panel sizing rules.
- [x] **Step 4: Run the focused tests** and verify green.

### Task 4: Integration and visual QA

**Files:**
- Modify generated gzip/version sidecars under `web/` using the repository script.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: cache-safe web assets and browser evidence.

- [x] **Step 1: Run `python3 pipeline/bump_web_version.py`.**
- [x] **Step 2: Run `node --check web/tresd.js web/share.js web/splatview.js web/unified-viewer-state.js`.**
- [x] **Step 3: Run `node --test tools/test_unified_viewer_state.mjs` and `python3 -m unittest pipeline.test_tresd_static pipeline.test_static_gzip_freshness`.**
- [x] **Step 4: Run `python3 pipeline/test_smoke.py`.**
- [x] **Step 5: Run browser QA against the active Dialéctica project on desktop and mobile**, exercising all three tabs, mouse/touch navigation, fullscreen, project changes, and Gaussian version changes.
- [x] **Step 6: Inspect `git diff --check` and the final scoped diff before committing.**
