# AeroBrain Home V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Home animation stack with a fast cinematic dashboard that uses the real drone GLB, truthful partial-data states, complete responsive cards and a bounded AAA star-void navigation effect.

**Architecture:** Keep the existing shell and routes. Split Home into a pure CommonJS/browser view-model module, a semantic renderer/orchestrator, one shared canvas effects controller and one lazy ES-module Three.js drone renderer. Scope all new layout styles under `.home-v2`, then verify navigation and motion in the live local service before production handoff.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, existing Instrument Graphite tokens and icons, vendored Three.js r180 + GLTFLoader, Python unittest/source-contract tests, Chrome CDP browser gates.

## Global Constraints

- Preserve all seven existing module routes and the global sidebar/bottom navigation.
- Render usable content before loading `assets/drone.glb`.
- Keep the star-void handoff at or below 620 ms and fall through immediately on initialization failure.
- Cap particles at 420 desktop, 260 tablet, 160 phone and 100 at 320 px.
- Keep cards semantic anchors with full hit areas, keyboard activation and visible focus.
- Maintain zero horizontal overflow at 320, 390, 820, 1024 and desktop widths.
- Pause every animation loop while hidden and disable ambient/particle motion under `prefers-reduced-motion`.
- Use TDD for each behavior change and create atomic commits.
- Bump modified web asset references from `v=205` to `v=206` and regenerate matching `.gz` sidecars.

---

### Task 1: Truthful Home view model and independent data states

**Files:**
- Create: `web/home-data.js`
- Create: `pipeline/test_home_v2.py`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- Produces: `HomeData.buildHomeViewModel(flights, system, jobs, now)` returning `{ greeting, latest, telemetry, cards, storage, activeJobs, states }`.
- Produces: `HomeData.loadHomeData(getFlightsFn, fetchFn)` returning independently settled `{ flights, system, jobs, states }`.
- Consumes: existing `getFlights()`, `DATA`, `fmt` only in the renderer, never inside the pure view model.

- [ ] **Step 1: Write failing view-model tests**

Add unittest cases that execute `home-data.js` through Node and assert:

```python
def test_partial_system_failure_keeps_all_module_cards(self):
    vm = run_home_data("buildHomeViewModel", [[sample_flight()], {}, [], "2026-07-15T10:00:00-05:00"])
    self.assertEqual(7, len(vm["cards"]))
    self.assertEqual("Sin datos", vm["telemetry"][3]["value"])

def test_empty_flights_do_not_invent_zero_distance(self):
    vm = run_home_data("buildHomeViewModel", [[], {"storage": {"raw": 1024}}, [], "2026-07-15T10:00:00-05:00"])
    self.assertEqual("Sin datos", vm["telemetry"][1]["value"])
    self.assertIsNone(vm["latest"])

def test_jobs_403_is_public_not_error(self):
    data = run_home_data("classifyJobsResponse", [403, None])
    self.assertEqual({"state": "public", "jobs": []}, data)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 -m unittest pipeline/test_home_v2.py -v`  
Expected: FAIL because `web/home-data.js` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

Use a UMD wrapper so browser and Node share the same code:

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeData = api;
})(globalThis, function () {
  const MODULES = [
    ['index.html', 'grid', 'Vuelos'], ['trips.html', 'pin', 'Viajes'],
    ['tresd.html', 'cube', '3D'], ['drone.html', 'drone', 'Dron'],
    ['studio.html', 'film', 'Studio'], ['drone.html?via=subir', 'dl', 'Subir'],
    ['system.html', 'db', 'Sistema'],
  ];
  function classifyJobsResponse(status, payload) {
    if (status === 403) return { state: 'public', jobs: [] };
    if (status < 200 || status >= 300) return { state: 'error', jobs: [] };
    return { state: 'ready', jobs: Array.isArray(payload?.jobs) ? payload.jobs : [] };
  }
  function buildHomeViewModel(flights = [], system = {}, jobs = [], now = new Date()) {
    const validFlights = Array.isArray(flights) ? flights : [];
    const validSystem = system && typeof system === 'object' ? system : {};
    const activeJobs = jobs.filter(job => ['running', 'queued'].includes(job.status));
    const hasFlights = validFlights.length > 0;
    const telemetry = [
      { label: 'Vuelos', value: hasFlights ? String(validFlights.length) : 'Sin datos' },
      { label: 'En el aire', value: hasFlights ? String(validFlights.reduce((n, f) => n + (+f.duration_s || 0), 0)) : 'Sin datos' },
      { label: 'Distancia', value: hasFlights ? String(validFlights.reduce((n, f) => n + (+f.stats?.distance_m || 0), 0)) : 'Sin datos' },
      { label: '3D', value: validSystem.models || validSystem.splats ? `${(validSystem.models || []).length} · ${(validSystem.splats || []).length}` : 'Sin datos' },
      { label: 'Bóveda', value: validSystem.storage ? String(Object.values(validSystem.storage).reduce((n, x) => n + (+x || 0), 0)) : 'Sin datos' },
    ];
    return { now: new Date(now), telemetry, activeJobs, cards: MODULES.map(([href, icon, title]) => ({ href, icon, title })) };
  }
  async function loadHomeData(getFlightsFn, fetchFn) {
    const [flightsResult, systemResult, jobsResult] = await Promise.allSettled([
      getFlightsFn(), fetchFn(`${globalThis.DATA || 'data'}/manifest/system.json`), fetchFn('/api/jobs'),
    ]);
    return { flightsResult, systemResult, jobsResult };
  }
  return { MODULES, classifyJobsResponse, buildHomeViewModel, loadHomeData };
});
```

- [ ] **Step 4: Run focused tests and smoke**

Run: `PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 -m unittest pipeline/test_home_v2.py -v`  
Expected: all Home data tests PASS.  
Run: `PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 pipeline/test_smoke.py`  
Expected: `TODOS LOS TESTS PASAN`.

- [ ] **Step 5: Commit**

```bash
git add web/home-data.js pipeline/test_home_v2.py pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: add truthful Home V2 data model"
```

### Task 2: Semantic cinematic dashboard and responsive cards

**Files:**
- Modify: `web/home.html`
- Replace: `web/home.js`
- Modify: `web/style.css`
- Modify: `pipeline/test_home_v2.py`

**Interfaces:**
- Consumes: `HomeData.loadHomeData()` and `HomeData.buildHomeViewModel()`.
- Produces: `.home-v2`, `#home-drone-stage`, `.hv2-card[data-module]`, `.hv2-primary`, `.hv2-telemetry` and stable skeleton/empty/error states.
- Preserves: `attachScrub(main)`, `renderShell('home.html')`, `icon()`, `fmt`, `esc()`.

- [ ] **Step 1: Write failing source-contract tests**

```python
def test_home_has_all_semantic_module_routes(self):
    source = Path("web/home-data.js").read_text()
    for route in ("index.html", "trips.html", "tresd.html", "drone.html", "studio.html", "system.html"):
        self.assertIn(route, source)

def test_home_cards_keep_visible_action_and_focus_contract(self):
    js = Path("web/home.js").read_text()
    css = Path("web/style.css").read_text()
    self.assertIn('class="hv2-card', js)
    self.assertIn('class="hv2-go"', js)
    self.assertIn('.home-v2 .hv2-card:focus-visible', css)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 -m unittest pipeline/test_home_v2.py -v`  
Expected: FAIL because Home still renders `.deck-card` and has no `.home-v2` contract.

- [ ] **Step 3: Replace the renderer**

Render the shell immediately with stable skeleton geometry, load independent data, then replace each region. Use full-card anchors and real thumbnails with explicit `width`, `height`, `loading` and `decoding` attributes. Add primary/secondary hero CTAs, five telemetry cells, seven cards, latest flight and vault capacity. Never hide a module because its metrics are unavailable.

- [ ] **Step 4: Add one final scoped CSS system**

Create a single `/* Home V2 */` block under `.home-v2` with:

```css
.home-v2 { max-width: 1560px; margin-inline: auto; isolation: isolate; }
.home-v2 .hv2-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); }
.home-v2 .hv2-card:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media (max-width:1024px) { .home-v2 .hv2-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:640px) { .home-v2 .hv2-grid { grid-template-columns:1fr; } }
@media (prefers-reduced-motion:reduce) { .home-v2 *, .home-void { animation-duration:.001ms !important; } }
```

Keep action labels visible on all input types. Size touch actions to at least 44 px. Use container-safe `min-width:0`, `overflow-wrap:anywhere` and safe-area padding.

- [ ] **Step 5: Run tests and smoke**

Run the focused unittest and full smoke commands from Task 1.  
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add web/home.html web/home.js web/style.css pipeline/test_home_v2.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: build responsive cinematic Home V2"
```

### Task 3: Bounded AAA star-void navigation

**Files:**
- Create: `web/home-effects.js`
- Modify: `web/home.html`
- Modify: `web/home.js`
- Modify: `web/style.css`
- Modify: `pipeline/test_home_v2.py`

**Interfaces:**
- Produces: `HomeEffects.particleBudget(width) -> number`.
- Produces: `HomeEffects.attachVoidNavigation(root, options) -> { destroy() }`.
- `options.navigate(href)` is injectable for browser tests; default is `location.assign(href)`.

- [ ] **Step 1: Write failing effects tests**

```python
def test_particle_budgets_are_bounded_by_viewport(self):
    self.assertEqual(100, run_effect("particleBudget", [320]))
    self.assertEqual(160, run_effect("particleBudget", [390]))
    self.assertEqual(260, run_effect("particleBudget", [820]))
    self.assertEqual(420, run_effect("particleBudget", [1440]))

def test_effect_contract_has_failsafe_and_reduced_motion(self):
    source = Path("web/home-effects.js").read_text()
    self.assertIn("620", source)
    self.assertIn("prefers-reduced-motion", source)
    self.assertIn("pagehide", source)
```

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because `home-effects.js` does not exist.

- [ ] **Step 3: Implement one-canvas effect controller**

Intercept only unmodified primary activations. Use anchor center for keyboard, pointer coordinates for pointer/touch, and always read the target from `anchor.href`. Draw a radial void, capped depth particles and star streaks on a single fixed canvas. Cancel the loop and navigate at 620 ms maximum. If canvas/context creation fails, navigate synchronously. Destroy on `pagehide`; never leave `pointer-events` blocking the page.

- [ ] **Step 4: Add visual states**

Provide `.home-void`, `.home-void.is-active` and `.hv2-card.is-launching` styles. Keep the source card legible during the first 180 ms. Reduced motion uses only an 80 ms fade.

- [ ] **Step 5: Run focused tests and smoke**

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add web/home-effects.js web/home.html web/home.js web/style.css pipeline/test_home_v2.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: add star void navigation to Home"
```

### Task 4: Lazy real-drone hero with safe fallback

**Files:**
- Create: `web/home-drone.js`
- Modify: `web/home.js`
- Modify: `web/style.css`
- Modify: `pipeline/test_home_v2.py`

**Interfaces:**
- Produces: `mountHomeDrone(stage, options) -> Promise<{ destroy(), pause(), resume(), ready }>`.
- Consumes: `/flightverse/three.js?v=206`, `/vendor/three-addons180/loaders/GLTFLoader.js?v=206`, `/assets/drone.glb`.
- Falls back to the existing `<img class="hv2-drone-fallback" src="assets/ovi-drone.png">`.

- [ ] **Step 1: Write failing source-contract tests**

```python
def test_drone_uses_real_glb_and_static_fallback(self):
    source = Path("web/home-drone.js").read_text()
    self.assertIn("/assets/drone.glb", source)
    self.assertIn("GLTFLoader", source)
    self.assertIn("visibilitychange", source)
    self.assertIn("IntersectionObserver", source)
```

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because `home-drone.js` does not exist.

- [ ] **Step 3: Implement the lazy renderer**

Wait until content paint and the stage is near the viewport. Load the GLB, normalize its bounds, light with restrained key/rim lights, rotate with clamped pointer yaw/pitch, and render into a transparent antialiased canvas. Cap DPR by coarse pointer. Pause via IntersectionObserver and `visibilitychange`. On any import/WebGL/GLB error, keep the static image visible and resolve with `ready:false`.

- [ ] **Step 4: Integrate interaction and teardown**

Expose one accessible “Animar dron” control for keyboard users. Pointer motion over decorative canvas must not cover CTAs. Destroy renderer, observers and listeners on `pagehide`.

- [ ] **Step 5: Run focused tests and smoke**

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add web/home-drone.js web/home.js web/style.css pipeline/test_home_v2.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: render the real drone on Home"
```

### Task 5: Browser bug hunt, responsive QA and production publication

**Files:**
- Create: `pipeline/browser_home_v2.py`
- Modify: `pipeline/test_home_v2.py`
- Modify: `design-qa.md`
- Regenerate: `web/home.html.gz`, `web/home.js.gz`, `web/home-data.js.gz`, `web/home-effects.js.gz`, `web/home-drone.js.gz`, `web/style.css.gz`

**Interfaces:**
- Produces screenshots under `/Volumes/SSD/drone-vault/qa/home-v2-{viewport}.png`.
- Verifies the live local URL `http://127.0.0.1:8790/home.html` and the production URL `https://vuelos.metislab.work/home.html`.

- [ ] **Step 1: Write the browser gate before fixing browser-only defects**

The gate must check:

```python
VIEWPORTS = {"iphone": (390, 844), "ipad": (820, 1180), "desktop": (1440, 960)}
state = cdp.eval("""(() => ({
  cards: document.querySelectorAll('.hv2-card').length,
  actions: document.querySelectorAll('.hv2-hero-actions a').length,
  overflow: document.documentElement.scrollWidth - innerWidth,
  drone: !!document.querySelector('#home-drone-stage canvas, .hv2-drone-fallback.is-visible'),
  visibleGo: [...document.querySelectorAll('.hv2-go')].every(x => x.getBoundingClientRect().height > 0)
}))()""")
self.assertEqual(7, state["cards"])
self.assertGreaterEqual(state["actions"], 1)
self.assertLessEqual(state["overflow"], 3)
self.assertTrue(state["drone"])
self.assertTrue(state["visibleGo"])
```

- [ ] **Step 2: Run browser gate and record RED findings**

Run: `PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 pipeline/browser_home_v2.py --base-url http://127.0.0.1:8790`  
Expected: any browser-only defect fails with its viewport and exact contract.

- [ ] **Step 3: Fix P0/P1/P2 findings one at a time**

For every finding: add the smallest regression assertion, verify RED, implement one fix, rerun the affected viewport, then commit the atomic fix. Do not bundle unrelated visual polish.

- [ ] **Step 4: Compare reference and implementation**

Open the supplied desktop screenshot and the new 1440 × 960 capture together. Update `design-qa.md` with hierarchy, spacing, crop, typography, card completeness, motion and input findings. Repeat until `final result: passed` with no P0/P1/P2 items.

- [ ] **Step 5: Regenerate compressed assets and run all gates**

```bash
gzip -9 -c web/home.html > web/home.html.gz
gzip -9 -c web/home.js > web/home.js.gz
gzip -9 -c web/home-data.js > web/home-data.js.gz
gzip -9 -c web/home-effects.js > web/home-effects.js.gz
gzip -9 -c web/home-drone.js > web/home-drone.js.gz
gzip -9 -c web/style.css > web/style.css.gz
PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 -m unittest pipeline/test_home_v2.py -v
PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH python3 pipeline/browser_home_v2.py --base-url http://127.0.0.1:8790
git diff --check
```

Expected: all commands exit 0 and design QA says `final result: passed`.

- [ ] **Step 6: Verify production through the tunnel**

Run the same browser gate with `--base-url https://vuelos.metislab.work`. Confirm the HTML references the current mtime fingerprints and captures match local behavior.

- [ ] **Step 7: Commit**

```bash
git add pipeline/browser_home_v2.py pipeline/test_home_v2.py design-qa.md web/home.html.gz web/home.js.gz web/home-data.js.gz web/home-effects.js.gz web/home-drone.js.gz web/style.css.gz
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "test: accept Home V2 across devices"
```
