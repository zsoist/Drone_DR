# Scene Improvement Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated, truthful workflow that recommends useful new captures for an existing 3D/Gaussian scene and queues a validated immutable version.

**Architecture:** A small pure JavaScript policy module ranks and budgets captures independently from rendering. A dedicated page uses existing authenticated APIs and AeroBrain shell components; the server publishes its current scene limits alongside `/api/scenes` and remains authoritative at submission.

**Tech Stack:** Vanilla JavaScript ES modules, existing AeroBrain CSS/shell, Python `ThreadingHTTPServer`, Python unittest, Node built-in test runner.

## Global Constraints

- Existing scene versions remain immutable and the active version is never auto-promoted.
- Server limits remain exactly 16 videos, 1,200 seconds, 500 m, and 80 photos.
- Current sources are locked; cross-site or GPS-unknown sources cannot be selected.
- New UI functional text is at least 12 px and body text is at least 14 px.
- No nested source-list scrolling and no primary CTA below an internal modal fold.
- Every `web/` edit batch must run `python3 pipeline/bump_web_version.py` before commit.

---

### Task 1: Authoritative limits contract

**Files:**
- Modify: `pipeline/aerobrain_server.py`
- Modify: `pipeline/test_scenes.py`

**Interfaces:**
- Produces: `SCENE_LIMITS: dict[str, int]`
- Produces: `GET /api/scenes -> {scenes: list, limits: object}`
- Consumed by: scene improvement workspace bootstrap.

- [ ] **Step 1: Write the failing API test**

Add an authenticated `/api/scenes` assertion that `limits` equals `{"max_sources": 16, "max_duration_s": 1200, "max_distance_m": 500, "max_photos": 80}` and add boundary tests showing the POST rejects the 17th video and durations above 1,200 seconds.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `python3 -m unittest pipeline.test_scenes -v`  
Expected: FAIL because `/api/scenes` has no `limits` member.

- [ ] **Step 3: Implement one shared limits constant**

Define `SCENE_LIMITS` near the scene API helpers, return it from `/api/scenes`, and replace the duplicate numeric validation literals in `/api/scene_improve` and compatibility reporting.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python3 -m unittest pipeline.test_scenes -v`  
Expected: PASS.

### Task 2: Capture recommendation policy

**Files:**
- Create: `web/scene-improve-policy.js`
- Create: `tools/test_scene_improve_policy.mjs`

**Interfaces:**
- Produces: `classifyCapture(candidate) -> {role, label, weak, score, reasons}`
- Produces: `buildImprovementPlan({baseSources, candidates, limits}) -> {items, selectedIds, totals, roles}`
- Consumed by: `web/scene-improve.js`.

- [ ] **Step 1: Write failing policy tests with literal expected selections**

Cover the real Dialectica-shaped fixture, locked-base duration accounting, weak short-clip exclusion, role diversity, unknown/cross-site rejection, the 16-source boundary, and the 1,200-second boundary.

- [ ] **Step 2: Run policy tests and verify RED**

Run: `node --test tools/test_scene_improve_policy.mjs`  
Expected: FAIL because `web/scene-improve-policy.js` does not exist.

- [ ] **Step 3: Implement the minimum deterministic policy**

Use capture-report `mesh`, `splat`, heading-sector, duration, distance, and altitude evidence. Fill roles in priority order before adding same-role alternatives; never exceed limits or unlock the base.

- [ ] **Step 4: Run policy tests and verify GREEN**

Run: `node --test tools/test_scene_improve_policy.mjs`  
Expected: PASS with no warnings.

### Task 3: Dedicated improvement workspace

**Files:**
- Create: `web/scene-improve.html`
- Create: `web/scene-improve.js`
- Modify: `web/style.css`
- Modify: `web/tresd.js`
- Modify: `pipeline/test_tresd_static.py`

**Interfaces:**
- Consumes: `/api/models`, `/api/flights`, `/api/scenes`, `/api/capture_report`, `/api/scene_create`, `/api/scene_improve`.
- Consumes: `buildImprovementPlan` and `classifyCapture` from `scene-improve-policy.js`.
- Produces: navigable `scene-improve.html?id=<model_id>` entry and job success state.

- [ ] **Step 1: Write failing static integration tests**

Assert the 3D project CTA links to the workspace, the page includes one main landmark, a live status region, a sticky review summary, a native details element for advanced settings, and the policy module.

- [ ] **Step 2: Run static tests and verify RED**

Run: `python3 -m unittest pipeline.test_tresd_static -v`  
Expected: FAIL because the workspace and link do not exist.

- [ ] **Step 3: Build the semantic page and loading/error states**

Implement the four-section workspace, skeleton state, missing-model state, capture-report hydration, recommendation reason labels, selected duration/count validation, and an explicit active-version guarantee.

- [ ] **Step 4: Implement submission and success state**

Reuse the existing scene when found; otherwise create it with the current model as the first version. Submit only validated selected sources, then render job/reconstruction facts and a Processing link without auto-promoting.

- [ ] **Step 5: Replace the buried modal action**

Change “Mejorar esta escena” to a clear “Mejorar con nuevas capturas” entry near project identity and route to the dedicated workspace. Remove the obsolete modal implementation and 24-source copy.

- [ ] **Step 6: Run static and policy tests and verify GREEN**

Run: `python3 -m unittest pipeline.test_tresd_static -v && node --test tools/test_scene_improve_policy.mjs`  
Expected: PASS.

### Task 4: Browser QA, versioning, and deployment gate

**Files:**
- Modify: generated web version references via `pipeline/bump_web_version.py`
- Modify only if a browser defect is reproduced: `web/scene-improve.js`, `web/style.css`, `web/tresd.js`

**Interfaces:**
- Produces: browser-verified desktop/mobile light/dark workflow and deployable web assets.

- [ ] **Step 1: Bump and regenerate compressed web assets**

Run: `python3 pipeline/bump_web_version.py`  
Expected: version increment and fresh `.gz` files.

- [ ] **Step 2: Run focused and regression suites**

Run: `python3 -m unittest pipeline.test_scenes pipeline.test_tresd_static pipeline.test_static_gzip_freshness -v && node --test tools/test_scene_improve_policy.mjs`  
Expected: PASS.

- [ ] **Step 3: Inspect the real local workflow in the in-app browser**

At desktop and 390 × 844 mobile sizes, verify: entry CTA, recommended set, expandable alternatives, visible budget, keyboard focus, light/dark contrast, sticky review behavior, and no console errors. Capture screenshots for comparison.

- [ ] **Step 4: Run the Impeccable detector on the changed UI**

Run: `npx --yes impeccable detect web/scene-improve.html web/scene-improve.js web/style.css`  
Expected: no high-severity issue in the new workspace; review warnings manually against AeroBrain context.

- [ ] **Step 5: Run the repository deploy gate and deploy**

Run the documented safe restart/deploy command from `AGENTS.md`, then verify `/healthz`, the version endpoint, the production workspace, and browser console output.

