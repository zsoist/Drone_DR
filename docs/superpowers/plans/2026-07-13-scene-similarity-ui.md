# Scene Similarity UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make measured same-site compatibility visible and prevent cross-zone flights from being selected in the existing scene-improvement modal.

**Architecture:** Keep `web/tresd.js` as the modal controller and `web/style.css` as the existing scene-row presentation layer. The client mirrors the already-live 500 m server contract for immediate interaction feedback; `/api/scene_improve` remains authoritative.

**Tech Stack:** Vanilla JavaScript, existing AeroBrain CSS tokens, Python `unittest` static contract tests, browser matrix QA.

## Global Constraints

- A same-site source has a measured center distance at or below 500 m.
- Cross-site and unknown-distance sources stay visible but cannot be selected.
- Existing registration evidence remains visible and is never overwritten by spatial status.
- Active sources remain checked; the server is the final authority.
- After any `web/` edit, run `python3 pipeline/bump_web_version.py`.
- Do not restart the heavy worker while a 3D or splat job is running.

---

### Task 1: Same-site source interaction

**Files:**
- Modify: `pipeline/test_tresd_static.py`
- Modify: `web/tresd.js`
- Modify: `web/style.css`

**Interfaces:**
- Consumes: `geoDistance(origin, geoCenter(f)) -> number | null`, current source membership, and the server’s 500 m threshold.
- Produces: `.same-site` and `.cross-site` scene-row states, disabled cross-site inputs, and same-site-only bulk selection.

- [ ] **Step 1: Write the failing static contract test**

Add this test to `TresdInitializationTests`:

```python
def test_scene_similarity_is_visible_and_cross_site_sources_are_disabled(self):
    root = Path(__file__).resolve().parent.parent
    source = (root / "web" / "tresd.js").read_text()
    css = (root / "web" / "style.css").read_text()
    self.assertIn("const sameSite =", source)
    self.assertIn("same-site", source)
    self.assertIn("cross-site", source)
    self.assertIn("otro sitio", source)
    self.assertIn("input.disabled", source)
    self.assertIn(".scene-source.cross-site", css)
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest \
  pipeline.test_tresd_static.TresdInitializationTests.test_scene_similarity_is_visible_and_cross_site_sources_are_disabled
```

Expected: FAIL because the same-site row contract is absent.

- [ ] **Step 3: Implement the minimal modal behavior**

In the `choices.map` row renderer in `web/tresd.js`, derive compatibility once:

```javascript
const sameSite = distance != null && distance <= 500;
const crossSite = distance != null && distance > 500;
const spatialState = sameSite ? 'mismo sitio' : crossSite ? 'otro sitio' : 'cobertura sin medir';
```

Append `same-site` or `cross-site` to the row class, add `disabled` to cross-site or unknown inputs unless they are immutable active sources, and include `spatialState` beside the measured distance. In `setSceneSourceSelection`, force disabled inputs to remain unchecked:

```javascript
input.checked = !input.disabled && predicate(input.value, distance);
```

Update the footer to state that both the browser and server enforce the measured 500 m boundary.

- [ ] **Step 4: Add presentation using existing tokens**

In `web/style.css`, keep compatible rows visually quiet and make incompatible rows visibly unavailable:

```css
.scene-source.same-site:not(.on) { border-color: color-mix(in srgb, var(--mint) 24%, var(--line)); }
.scene-source.cross-site { opacity: .58; cursor: not-allowed; }
.scene-source.cross-site input { cursor: not-allowed; }
.scene-source.cross-site small:first-of-type { color: var(--amber); }
```

- [ ] **Step 5: Run the targeted test and verify GREEN**

Run the command from Step 2.

Expected: one test passes with zero failures.

- [ ] **Step 6: Bump web assets and run full verification**

Run:

```bash
python3 pipeline/bump_web_version.py
mods=$(find pipeline -maxdepth 1 -name 'test_*.py' ! -name 'test_smoke.py' -exec basename {} .py \; | sort | sed 's/^/pipeline./' | tr '\n' ' ')
PYTHONPATH=.:pipeline /Volumes/SSD/_system/venv/bin/python3 -m unittest $=mods
PATH=/Volumes/SSD/_system/venv/bin:$PATH /Volumes/SSD/_system/venv/bin/python3 pipeline/test_smoke.py
```

Expected: every unit test passes and smoke ends with `TODOS LOS TESTS PASAN`.

- [ ] **Step 7: Restart only the web service and run browser QA**

First confirm `/api/jobs` still shows the heavy job running, then run:

```bash
pipeline/safe_restart.sh web
```

Use the established browser matrix against the scene-improvement modal. Verify desktop and narrow widths, no horizontal overflow, same-site rows selectable, cross-site rows disabled, and no console errors.

- [ ] **Step 8: Commit**

```bash
git add pipeline/test_tresd_static.py web/tresd.js web/style.css web/version.json
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: expose same-site scene compatibility"
```

## Self-review

- Spec coverage: visible compatibility, disabled cross-site rows, preserved evidence, same-site-only selection, server authority, testing, and responsive QA are all represented.
- Placeholder scan: no incomplete markers or unspecified implementation steps remain.
- Type consistency: distance remains `number | null`; class names and selectors match in JavaScript, CSS, and tests.
