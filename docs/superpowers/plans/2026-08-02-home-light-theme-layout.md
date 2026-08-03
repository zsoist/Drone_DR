# Home Light Theme and Balanced Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home V2 fully legible and spatially balanced in light mode across wide desktop, compact desktop, and mobile viewports.

**Architecture:** Preserve the dark photographic hero and module surfaces while separating their on-media text colors from global theme tokens. Replace the four-column viewport-proportional grid with a capped twelve-column composition and validate the rendered result through Chrome DevTools Protocol.

**Tech Stack:** CSS Grid, CSS custom properties, vanilla JavaScript-rendered HTML, Python stdlib CDP browser gate.

## Global Constraints

- Keep all production data and existing Home destinations unchanged.
- Do not add frontend dependencies.
- Run `python3 pipeline/bump_web_version.py` after editing `web/`.
- Validate 2048×1218, 1024×609, and 390×844 without horizontal overflow.

---

### Task 1: Add the visual regression gate

**Files:**
- Create: `pipeline/browser_home_light.py`

**Interfaces:**
- Consumes: `browser_gate.launch_chrome()` and `browser_gate.new_page(port)`.
- Produces: a zero exit status plus screenshots in `/Volumes/SSD/drone-vault/qa/home-light-<viewport>.png`.

- [x] **Step 1: Write the failing browser assertions**

  Inspect computed heading colors, lower-panel background and contrast, card
  rectangles, final-row coverage, grid-to-summary gap, and root overflow.

- [x] **Step 2: Verify RED**

  Run: `python3 pipeline/browser_home_light.py`

  Expected: FAIL with a photo-card heading of `[23, 32, 43]`, 696 px wide-screen
  rows, 49.5% final-row coverage, and 1.28:1 lower-panel contrast.

### Task 2: Implement semantic light surfaces and balanced spans

**Files:**
- Modify: `web/style.css:40-190`

**Interfaces:**
- Consumes: the nine `.hv2-card` elements rendered by `web/home.js`.
- Produces: twelve-column wide layout, two-column compact layout, one-column mobile layout, and explicit on-media colors.

- [x] **Step 1: Replace unbounded rows and incomplete spans**

  Use twelve columns with default span 3, feature and final cards span 6, and
  `grid-auto-rows: clamp(300px, 28vw, 430px)`.

- [x] **Step 2: Separate on-media text from light-canvas text**

  Set hero and module headings to `#edf4ff`; add light-theme washes and white
  lower surfaces with `#17202b` titles.

- [x] **Step 3: Refresh asset versions**

  Run: `python3 pipeline/bump_web_version.py`

  Expected: version `v334` with gzip sidecars regenerated.

### Task 3: Verify compatibility and publish

**Files:**
- Test: `pipeline/browser_home_light.py`
- Test: `pipeline/browser_home_drone.py`
- Test: `pipeline/test_smoke.py`

**Interfaces:**
- Consumes: the complete v334 web bundle.
- Produces: browser evidence for light and dark themes plus the normal deployment artifact.

- [x] **Step 1: Verify GREEN for the reported viewports**

  Run: `python3 pipeline/browser_home_light.py`

  Expected: PASS with 430 px maximum wide rows, 100% final-row coverage,
  16.43:1 lower-panel title contrast, and zero browser errors.

- [x] **Step 2: Run Home and repository regression suites**

  Run: `python3 pipeline/browser_home_drone.py && python3 pipeline/test_smoke.py`

  Expected: all commands exit zero.

- [x] **Step 3: Commit, push, deploy, and canary**

  Commit only the light-theme contract, updated web bundle, and documentation;
  push the existing branch, restart the web service safely, and verify public
  health plus the production Home light browser gate.
