# Flightverse Mobile Command HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overlapping Flightverse phone HUD with a compact, collapsible command HUD and make every flight/fire gesture immune to browser zoom, selection, blue tap highlight, ghost taps, and stuck pointer state.

**Architecture:** Add a focused `mobile-command.js` module for fire-pointer ownership, the compact weapon picker, and Flightverse-only browser-gesture guards. `volar.js` remains the scene integrator, while `style.css` owns responsive geometry and `browser_matrix.py` becomes authoritative for real `Input.dispatchTouchEvent` behavior and overlap evidence.

**Tech Stack:** Browser-native ES modules, Pointer Events, Three.js runtime integration, Node `node:test`, Python `unittest`, Chrome DevTools Protocol, existing AeroBrain smoke/release gates.

## Global Constraints

- Scope anti-selection and anti-highlight behavior to Flightverse; normal text selection elsewhere in AeroBrain must remain unchanged.
- Keep desktop Flightverse layout and behavior unchanged.
- Keep both dynamic stick touch zones large even when their visible bases become smaller.
- Persistent touch controls are limited to two sticks, Fire, selected weapon/ammo, Menu, and the minimal FPV OSD.
- Fire is 72×72 CSS pixels; weapon is at least 56×56; Menu is at least 52×52; picker items are at least 48 CSS pixels.
- MG repeats only while its owning pointer is held; every missile fires at most once per hold.
- No gesture-only firing, new font download, frontend dependency, physics change, damage change, collision change, or Invasion AI change.
- Every batch that edits `web/` runs `python3 pipeline/bump_web_version.py` exactly once and `pipeline/gzip_assets.sh`.
- Production deployment uses `pipeline/safe_restart.sh server` without bypass and is followed by public plus loopback canary checks.

---

### Task 1: Deterministic mobile gesture ownership

**Files:**
- Create: `web/flightverse/mobile-command.js`
- Create: `pipeline/test_mobile_command.mjs`
- Modify: `pipeline/test_smoke.py`

**Interfaces:**
- Produces: `createFirePointerController(options) -> { state(), cancel(reason), setEnabled(bool), dispose() }`.
- Produces: `installFlightSurfaceGuards(root) -> { dispose() }`.
- Consumes: callbacks `onPress(pointerId, event) -> boolean`, `onRelease(reason, event)`, and `isEnabled() -> boolean`.

- [ ] **Step 1: Read the repository test rules before writing tests**

Read completely:

```text
/Users/daniel_serverm4/.codex/plugins/cache/claude-plugins-official/superpowers/6.2.0/skills/test-driven-development/writing-good-tests.md
```

- [ ] **Step 2: Write RED unit tests for the fire pointer owner**

Create `pipeline/test_mobile_command.mjs` with a real `EventTarget` fake element and tests that assert:

```js
const controller = createFirePointerController({
  element: trigger,
  eventRoot,
  visibilityRoot,
  onPress: pointerId => { presses.push(pointerId); return true; },
  onRelease: reason => releases.push(reason),
});

trigger.dispatchEvent(pointer('pointerdown', 7));
trigger.dispatchEvent(pointer('pointerdown', 8));
assert.deepEqual(presses, [7]);
assert.equal(controller.state().pointerId, 7);

trigger.dispatchEvent(pointer('pointercancel', 7));
assert.deepEqual(releases, ['pointercancel']);
assert.equal(controller.state().held, false);

trigger.dispatchEvent(pointer('pointerup', 7));
assert.deepEqual(releases, ['pointercancel']);
```

Add separate tests for pointerup, lost capture, blur, hidden visibility,
pagehide, disable, disposal, secondary-pointer release, and fresh repress.

- [ ] **Step 3: Write RED tests for scoped gesture guards**

Assert that `selectstart`, `dragstart`, and `contextmenu` are prevented on the
Flightverse root, but a marked range control remains usable:

```js
const guards = installFlightSurfaceGuards(root);
const selection = cancelableEvent('selectstart', textNode);
root.dispatchEvent(selection);
assert.equal(selection.defaultPrevented, true);

const rangeSelection = cancelableEvent('selectstart', rangeInput);
Object.defineProperty(rangeSelection, 'target', { value: rangeInput });
root.dispatchEvent(rangeSelection);
assert.equal(rangeSelection.defaultPrevented, false);
guards.dispose();
```

- [ ] **Step 4: Run the new Node test and verify RED**

Run:

```bash
node --test pipeline/test_mobile_command.mjs
```

Expected: FAIL because `web/flightverse/mobile-command.js` does not exist.

- [ ] **Step 5: Implement the minimal pointer controller**

Implement one owner token and idempotent release:

```js
export function createFirePointerController({
  element, eventRoot = window, visibilityRoot = document,
  onPress, onRelease, isEnabled = () => true,
}) {
  let enabled = true;
  let disposed = false;
  let pointerId = null;
  let accepted = false;

  const cancel = (reason = 'cancel', event = null) => {
    if (pointerId == null) return false;
    const owned = pointerId;
    pointerId = null;
    const fired = accepted;
    accepted = false;
    if (element.hasPointerCapture?.(owned)) element.releasePointerCapture(owned);
    onRelease?.(reason, event, fired);
    return true;
  };

  const down = event => {
    if (disposed || !enabled || !isEnabled() || pointerId != null) return;
    event.preventDefault();
    event.stopPropagation();
    pointerId = event.pointerId;
    element.setPointerCapture?.(pointerId);
    accepted = onPress?.(pointerId, event) !== false;
  };

  const listeners = [];
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };
  listen(element, 'pointerdown', down);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    listen(element, type, event => {
      if (event.pointerId === pointerId) cancel(type, event);
    });
  }
  listen(eventRoot, 'blur', event => cancel('blur', event));
  listen(eventRoot, 'pagehide', event => cancel('pagehide', event));
  listen(visibilityRoot, 'visibilitychange', event => {
    if (visibilityRoot.hidden) cancel('visibilitychange', event);
  });

  return {
    state: () => ({ enabled, held: pointerId != null, pointerId, accepted }),
    cancel,
    setEnabled(value) {
      enabled = !!value;
      if (!enabled) cancel('disabled');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel('dispose');
      for (const [target, type, handler] of listeners) {
        target.removeEventListener(type, handler);
      }
    },
  };
}
```

- [ ] **Step 6: Implement scoped surface guards**

Ignore intentional form controls and prevent only Flightverse gesture theft:

```js
const ALLOW = 'input[type="range"],input,textarea,select,[contenteditable="true"]';
const block = event => {
  if (!event.target?.closest?.(ALLOW)) event.preventDefault();
};
```

Register and dispose `selectstart`, `dragstart`, and `contextmenu`.

- [ ] **Step 7: Run GREEN and smoke registration tests**

Run:

```bash
node --test pipeline/test_mobile_command.mjs
node --check web/flightverse/mobile-command.js
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
```

Expected: all pass. Add the new Node suite to `pipeline/test_smoke.py` if the
smoke runner does not discover it.

- [ ] **Step 8: Version, gzip, and commit**

Run:

```bash
python3 pipeline/bump_web_version.py
pipeline/gzip_assets.sh
PYTHONPATH=pipeline:/tmp/aerobrain-testdeps python3 -m unittest pipeline.test_static_gzip_freshness -v
git add web/flightverse/mobile-command.js web/flightverse/mobile-command.js.gz \
  pipeline/test_mobile_command.mjs pipeline/test_smoke.py web
PYTHONPATH=/tmp/aerobrain-testdeps git commit -m "feat: own Flightverse mobile gestures"
```

Review staged files before committing so `git add web` contains only the
mechanical fingerprint and gzip refresh required by this task.

---

### Task 2: Compact command HUD and collapsible weapon picker

**Files:**
- Modify: `web/volar.js`
- Modify: `web/style.css`
- Modify: `web/flightverse/mobile-command.js`
- Modify: `pipeline/test_mobile_command.mjs`
- Modify: `pipeline/test_volar_mobile.py`

**Interfaces:**
- Consumes: `createFirePointerController()` and `installFlightSurfaceGuards()` from Task 1.
- Produces: `createWeaponPicker(options) -> { active(), open(), close(reason), toggle(), dispose() }`.
- Produces DOM: `#vl-command-hud`, `#vl-weapon-toggle`, `#vl-weapon-picker`, `#vl-trigger`, `#vl-fab`.

- [ ] **Step 1: Write RED picker unit tests**

Extend `pipeline/test_mobile_command.mjs`:

```js
const picker = createWeaponPicker({
  trigger, panel, items, eventRoot,
  onSelect: key => selected.push(key),
});
trigger.dispatchEvent(new Event('click'));
assert.equal(picker.active(), true);
assert.equal(trigger.getAttribute('aria-expanded'), 'true');
items[1].dispatchEvent(new Event('click'));
assert.deepEqual(selected, ['s']);
assert.equal(picker.active(), false);
```

Add outside-pointer, Escape, orientationchange, disabled item, focus restore,
and dispose tests.

- [ ] **Step 2: Write RED static mobile-layout contracts**

Extend `pipeline/test_volar_mobile.py` to require:

```python
self.assertIn('id="vl-command-hud"', self.source)
self.assertIn('id="vl-weapon-toggle"', self.source)
self.assertIn('id="vl-weapon-picker"', self.source)
self.assertIn("createFirePointerController", self.source)
self.assertIn("createWeaponPicker", self.source)
self.assertNotIn('id="vl-combat-fab"', self.source)
self.assertIn("-webkit-tap-highlight-color:transparent", self.styles)
self.assertIn("-webkit-touch-callout:none", self.styles)
```

Also require camera and detailed combat entry points inside `#vl-dock`.

- [ ] **Step 3: Run RED suites**

Run:

```bash
node --test pipeline/test_mobile_command.mjs
python3 -m unittest pipeline.test_volar_mobile -v
```

Expected: picker and compact HUD assertions fail.

- [ ] **Step 4: Implement `createWeaponPicker`**

Use one transient open state:

```js
export function createWeaponPicker({
  trigger, panel, items, eventRoot = document, onSelect,
}) {
  let open = false;
  const close = reason => {
    if (!open) return false;
    open = false;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (reason !== 'overlay') trigger.focus?.();
    return true;
  };
  const toggle = () => open ? close('toggle') : (
    open = true,
    panel.hidden = false,
    trigger.setAttribute('aria-expanded', 'true'),
    true
  );
  const outside = event => {
    if (open && !panel.contains(event.target) && !trigger.contains(event.target)) {
      close('outside');
    }
  };
  const keydown = event => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close('escape');
    }
  };
  const orientation = () => close('orientation');
  const choose = event => {
    const item = event.currentTarget;
    if (item.disabled || item.getAttribute('aria-disabled') === 'true') return;
    onSelect?.(item.dataset.w);
    close('selection');
  };
  trigger.addEventListener('click', toggle);
  eventRoot.addEventListener('pointerdown', outside);
  eventRoot.addEventListener('keydown', keydown);
  eventRoot.defaultView?.addEventListener('orientationchange', orientation);
  for (const item of items) item.addEventListener('click', choose);

  return {
    active: () => open,
    open: () => open || toggle(),
    close,
    toggle,
    dispose() {
      close('dispose');
      trigger.removeEventListener('click', toggle);
      eventRoot.removeEventListener('pointerdown', outside);
      eventRoot.removeEventListener('keydown', keydown);
      eventRoot.defaultView?.removeEventListener('orientationchange', orientation);
      for (const item of items) item.removeEventListener('click', choose);
    },
  };
}
```

- [ ] **Step 5: Replace the live carousel markup**

In `web/volar.js`, render:

```html
<div class="vl-command-hud" id="vl-command-hud" aria-label="Controles de combate">
  <button class="vl-weapon-toggle" id="vl-weapon-toggle"
    aria-haspopup="listbox" aria-expanded="false">
    <span id="vl-weapon-code">M·M</span>
    <output id="vl-weapon-status">8</output>
  </button>
  <div class="vl-weapon-picker" id="vl-weapon-picker"
    role="listbox" aria-label="Seleccionar arma" hidden>
    <button role="option" data-w="mg">MG</button>
    <button role="option" data-w="s">Misil S</button>
    <button role="option" data-w="m">Misil M</button>
    <button role="option" data-w="l">Misil L</button>
  </div>
  <button class="vl-trigger" id="vl-trigger" aria-label="Disparar arma seleccionada">
    <span>◎</span><strong>FUEGO</strong>
  </button>
</div>
```

Remove `#vl-combat-fab`. Add Camera and Armamento buttons to `#vl-dock`; the
Armamento button opens the detailed combat sheet through the existing overlay
coordinator.

- [ ] **Step 6: Integrate pointer ownership and picker lifecycle**

Replace the duplicated trigger listeners with:

```js
const firePointer = createFirePointerController({
  element: triggerBtn,
  onPress: () => beginFiring('pointer'),
  onRelease: reason => releaseFiring('pointer', { reason }),
  isEnabled: () => !overlayCoordinator?.active(),
});
```

On overlay open, orientation change, pagehide, and teardown:

```js
weaponPicker.close('overlay');
firePointer.cancel('overlay');
```

Keep keyboard release independent. Update weapon code, ammo, `aria-selected`,
and trigger status from the existing weapon telemetry.

- [ ] **Step 7: Implement the compact responsive CSS**

Under coarse-pointer media queries:

```css
.vl-body,.vl-hud,.vl-hud *{
  -webkit-user-select:none;
  user-select:none;
  -webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;
}
.vl-body{ overscroll-behavior:none }
.vl-command-hud{
  position:fixed;
  right:calc(14px + env(safe-area-inset-right));
  bottom:calc(min(34vh,300px) + 18px + env(safe-area-inset-bottom));
  display:grid;
  justify-items:end;
  gap:10px;
  z-index:45;
}
.vl-trigger{ width:72px; height:72px; touch-action:none }
.vl-weapon-toggle{ width:56px; height:56px; touch-action:none }
.vl-weapon-picker{ min-width:132px; touch-action:none }
.vl-weapon-picker button{ min-height:48px }
```

Keep stick zones unchanged; reduce visible bases to 112 px on phones with
lower opacity. Make Menu 52×52. Hide command controls while an overlay owns
input. Use system font for actions and mono only for codes/ammo.

- [ ] **Step 8: Run focused GREEN suites**

Run:

```bash
node --test pipeline/test_mobile_command.mjs pipeline/test_touch_controls.mjs
python3 -m unittest pipeline.test_volar_mobile -v
node --check web/volar.js web/flightverse/mobile-command.js
```

Expected: all pass.

- [ ] **Step 9: Version, gzip, smoke, and commit**

Run one web fingerprint bump and gzip refresh, then:

```bash
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
PYTHONPATH=pipeline:/tmp/aerobrain-testdeps python3 -m unittest pipeline.test_static_gzip_freshness -v
git diff --check
PYTHONPATH=/tmp/aerobrain-testdeps git commit -m "feat: compact Flightverse mobile HUD"
```

---

### Task 3: Real-touch browser gate and visual QA

**Files:**
- Modify: `pipeline/browser_matrix.py`
- Modify: `pipeline/test_volar_mobile.py`
- Modify: `.gstack/qa-reports/qa-report-world-mobile-2026-07-27.md`

**Interfaces:**
- Consumes DOM and controllers from Tasks 1 and 2.
- Produces `touchCommandHud` evidence in each Flightverse matrix result.

- [ ] **Step 1: Write RED Python contracts for real touch**

Require `Input.dispatchTouchEvent`, `Input.synthesizeTapGesture`,
`selectstart`, `visualViewport.scale`, three simultaneous pointer IDs,
picker geometry, and closed/picker/menu screenshots.

- [ ] **Step 2: Add CDP touch helpers**

Implement helpers that always send the full active touch set:

```python
def touch_point(pointer_id, x, y):
    return {"id": pointer_id, "x": x, "y": y,
            "radiusX": 8, "radiusY": 8, "force": 1}

def dispatch_touches(cdp, event_type, points):
    cdp.send("Input.dispatchTouchEvent", {
        "type": event_type,
        "touchPoints": points,
    })
```

- [ ] **Step 3: Replace mouse-only combat acceptance with touch acceptance**

For every touch viewport, assert:

- one real touch reduces ammo and increases fired exactly once;
- MG hold repeats;
- S/M/L hold fires once, release/repress fires once more;
- rapid double tap produces two accepted presses and no ghost third shot;
- cancellation leaves `held:false`;
- a second pointer cannot release the trigger owner.

Desktop retains mouse coverage.

- [ ] **Step 4: Add three-pointer flight-plus-fire evidence**

Hold one touch in each stick zone, add a third touch on Fire, and assert:

```python
sample["active"] is True
abs(sample["lift"]) + abs(sample["fwd"]) > 0
fired_after > fired_before
trigger["held"] is True
```

Release Fire while keeping both stick points, confirm flight remains active,
then release all points and confirm every axis returns to zero.

- [ ] **Step 5: Add zoom, selection, and blue-highlight evidence**

Install a `selectstart` counter before gestures. Double tap and long press the
weapon control, then require:

```python
scale_before == 1
scale_after == 1
selectstart_count == 0
selection_text == ""
tap_highlight in ("rgba(0, 0, 0, 0)", "transparent")
```

- [ ] **Step 6: Add geometry assertions**

In closed state, weapon picker state, and Menu sheet state, assert no
intersection among:

- left/right stick zones;
- visible stick bases;
- Fire;
- weapon control and picker;
- Menu;
- viewport/safe-area bounds.

Require hidden command controls while Menu is open and focus inside the sheet.

- [ ] **Step 7: Capture and inspect all states**

Write screenshots for phone and iPad portrait/landscape:

```text
matrix-volar-<viewport>-closed.png
matrix-volar-<viewport>-weapons.png
matrix-volar-<viewport>-menu.png
```

Inspect all twelve images. Record overlap, hierarchy, typography, tap target,
and world-visibility results in the QA report.

- [ ] **Step 8: Run focused and full matrix**

Run:

```bash
python3 -m unittest pipeline.test_volar_mobile -v
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse --viewport mobile_portrait
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse
```

Expected: Mundo and Volar pass at 60 fps in phone/iPad portrait/landscape and
desktop; all real-touch evidence is true.

- [ ] **Step 9: Commit the browser gate**

Commit only pipeline tests and the QA report:

```bash
git add pipeline/browser_matrix.py pipeline/test_volar_mobile.py \
  .gstack/qa-reports/qa-report-world-mobile-2026-07-27.md
PYTHONPATH=/tmp/aerobrain-testdeps git commit -m "test: gate Flightverse real touch UI"
```

---

### Task 4: Review, full regression, deploy, and canary

**Files:**
- Modify: `.gstack/qa-reports/qa-report-world-mobile-2026-07-27.md`
- Create: `.gstack/canary-reports/world-mobile-v307.md`

**Interfaces:**
- Consumes the complete implementation and touch evidence.
- Produces a reviewed draft PR update and healthy production canary.

- [ ] **Step 1: Run the complete local release suite**

Run:

```bash
PYTHONPATH=.:pipeline python3 -m py_compile pipeline/*.py ai/*.py
node --test pipeline/test_mobile_command.mjs pipeline/test_touch_controls.mjs \
  pipeline/test_aiming.mjs pipeline/test_collision_math.mjs
PYTHONPATH=/tmp/aerobrain-testdeps python3 pipeline/test_smoke.py
python3 pipeline/audit_world.py
python3 pipeline/world_runtime_sweep.py
python3 pipeline/invasion_runtime_gate.py
python3 pipeline/flightverse_collision_gate.py recon_b2fbe03239 --stress 100
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse
git diff --check origin/main...HEAD
```

- [ ] **Step 2: Independently review the complete branch diff**

Review input ownership, touch cleanup, scoped browser guards, mobile geometry,
desktop preservation, gzip/version integrity, performance, and deployment
safety. Fix every actionable Critical, Important, and Minor finding with a RED
test before implementation.

- [ ] **Step 3: Push without merging**

Push `codex/scene-ops-stability`, update draft PR #1 with touch evidence, and
confirm the PR remains draft, open, and unmerged.

- [ ] **Step 4: Deploy fail-closed**

Run:

```bash
pipeline/safe_restart.sh server
```

Expected: every-map preflight passes, collision stress100 passes before
restart, web restarts, and mandatory post-health passes.

- [ ] **Step 5: Run production canary**

Verify:

```text
loopback /api/healthz = 200 and all checks true
loopback /api/whoami = daniel, dev_mode=true
public /api/healthz = 200 with private/no-store edge policy
public /mundo.html = exact 303 login redirect
public /api/whoami = 401
post-deploy mobile portrait real-touch gate = pass
post-deploy desktop = 60 fps
```

Create the final versioned canary report only after these checks are real.

- [ ] **Step 6: Final evidence commit**

Commit QA/canary evidence, push it, confirm `HEAD == remote == PR head`, clean
worktree, no stale fingerprint references, exact gzip pairs, and no web change
after the deployed candidate.
