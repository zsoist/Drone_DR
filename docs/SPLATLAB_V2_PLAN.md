# Splat Lab v2 — GRAND PLAN

**Author:** Lead Architect
**Date:** 2026-07-15
**Status:** Proposed (pre-build)
**Scope:** AeroBrain gaussian-splat CLEANING studio — fork of PlayCanvas SuperSplat (MIT) + AeroBrain pipeline/viewer integration
**Canonical path of this doc:** `/Volumes/SSD/work/forge-projects/aerobrain/docs/SPLATLAB_V2_PLAN.md`

---

## 0. TL;DR

Splat Lab v2 turns our vendored SuperSplat iframe from a bare MIT editor into a purpose-built **aerial-splat cleaning studio** with three things no competitor ships together: a real **one-click Auto-Clean** (ordered statistical + voxel + attribute filter stack tuned for drone captures), **full reversibility** (every clean is a promotable version in `splats/history/`, plus non-destructive masks and atomic undo inside the editor), and a **reorganized, tooltip-everywhere, touch-first UI** that feels like Google Earth on desktop, iPad, and iPhone. We do it server-side (a `pipeline` command that runs on publish) AND in-editor (one button + a guided aerial wizard), we keep our patches maintainable against upstream via a thin plugin boundary, and we make heavy splats fast on iPad with render-on-demand, sort throttling, DPR capping, and LOD.

---

## 1. VISION

Splat Lab v2 is the first cleaning studio built for **drone gaussian splats specifically**: you open a freshly-trained aerial model and one tap removes the sky floaters, the spiky oblique-pass needles, the translucent haze blobs, and the far-altitude noise — in the right order, with parameters tuned for large sparse aerial scenes — while the ground footprint, thin real structures, and legitimately-sparse far corners survive. Every clean is **fully reversible** (nothing is ever hard-deleted until you deliberately bake an export; every published clean is a promotable version in the vault), the editor **navigates like Google Earth** on any device with hover-and-tap tooltips on every control, and power users still get SuperSplat's complete manual toolkit underneath. It is self-hosted, same-origin, CSP-clean, and it slots into AeroBrain's existing `.splat`-master / SOG-viewer / versioned-manifest pipeline without breaking a single downstream consumer.

---

## 2. AUTO-CLEAN ENGINE

The heart of v2. One algorithm, two runtimes (server pipeline command + in-editor button), reversible by construction.

### 2.1 The ordered pipeline (canonical order — DO NOT reorder)

Each stage writes to a per-Gaussian boolean **mask** (never mutates the source buffer). Stages run in this exact order because cheap/safe pruning first makes the expensive kNN pass both faster and less statistically biased:

| # | Stage | What it kills | Default (Aerial) | Default (Object) | Cost |
|---|-------|---------------|------------------|------------------|------|
| 1 | **NaN/Inf filter** | corrupt gaussians | always on | always on | O(N) |
| 2 | **Opacity threshold** | faint haze/fog | `alpha < 0.04` | `alpha < 0.10` | O(N) |
| 3 | **Scale cap (absolute)** | spikes / needles | `maxAxis > 6·median` | `maxAxis > 4·median` | O(N) |
| 4 | **Scale cap (bbox)** | sky-spanning splats | `maxAxis > 0.10·bboxDiag` | `maxAxis > 0.10·bboxDiag` | O(N) |
| 5 | **Anisotropy cap** | extreme slivers | `maxAxis/minAxis > 15` | `maxAxis/minAxis > 12` | O(N) |
| 6 | **Voxel-occupancy floater filter** (primary structural remover) | disconnected floaters | `size=0.05·sceneScale, op=0.10, min=0.004` | same | O(N) |
| 7 | **SOR (statistical outlier removal)** — optional | residual floater cloud | `nb=25, std_ratio=2.5` (or OFF) | `nb=20, std_ratio=1.5` | O(N log N) |
| 8 | **Crop to AOI** — LAST, explicit only | context outside area | georef flight boundary ONLY | box/sphere manual | O(N) |

**Rationale grounded in research:**
- Opacity is stored as a **logit** (inverse-sigmoid) in PLY → threshold after `sigmoid()`, or compare raw logit directly: `alpha=0.10 ≈ logit −2.197`, `alpha=0.05 ≈ −2.944`, `alpha=0.04 ≈ −3.178`.
- Scale is stored **log-space** → `exp()` before comparing to `median` or `bboxDiag`.
- `median_scale` and `bboxDiag` are computed **per-model** so thresholds are scene-adaptive, never absolute.
- Voxel-occupancy (splat-transform's `filterFloaters` model: voxelize at `size`, mark "solid" voxels where accumulated contribution > thresholds, drop gaussians contributing to no solid voxel) is the **backbone** floater remover because it is scene-scale-robust — SOR/ROR over-cull legitimately-sparse aerial far-corners and thin real structures (crane jibs, pipes, rebar). SOR is a *secondary optional* pass, not the backbone.
- **NEVER** run `filterCluster` (connected-component keep) on aerial by default — it deletes detached-but-valid regions (separate buildings, terrain islands). Object preset may offer it opt-in.
- **NEVER** auto-crop by position percentile on aerial — percentiles are biased by the very floaters we're removing. Crop only to an explicit georeferenced flight boundary (see §2.4) or a user-drawn box.

### 2.2 Presets

```
AERIAL (default for AeroBrain models)   — conservative, floater-safe
  opacity 0.04 · scale K=6 · bbox 0.10 · aniso 15
  voxel size=0.05·scale op=0.10 min=0.004
  SOR OFF (or nb=25 std=2.5 if "aggressive" toggled)
  cluster-keep OFF · percentile-crop OFF

OBJECT / INDOOR                          — aggressive
  opacity 0.10 · scale K=4 · bbox 0.10 · aniso 12
  voxel size=0.05·scale op=0.10 min=0.004
  SOR nb=20 std=1.5
  cluster-keep opt-in
```

### 2.3 Where it runs

**(A) Server-side pipeline command** — `pipeline/autoclean.mjs` (new), invoked two ways:

1. **On training publish** — replace the current in-place `crop_floaters(final_out)` call at `worker.py:2056-2059` with `run_autoclean(final_out, preset="aerial")`. Runs on every OpenSplat training output before `export_viewer_sog`.
2. **On SuperSplat upload** — add the same hook in `aerobrain_server.py` just before the SOG transform (~`:2770`), **gated on `meta.edited != true`** so a human-cleaned export is never re-cropped and undone.

The command wraps **`playcanvas/splat-transform`** (MIT CLI) for stages 1,2,3,4,6,8 (`--filter-nan`, `--filter-value opacity,gt,X`, `--filter-value scale_*`, `--filter-floaters size,op,min`, `--filter-box`) and a small custom SOR/anisotropy pass for stages 5,7. Chainable, streaming, bounded memory on 10M+ gaussian scenes. Keep the existing **fail-open safety guard**: abort the clean (log, continue publishing the un-cleaned splat) if it would keep < 40% of gaussians (`worker.py:126` / `crop_splat.mjs:66` contract).

**(B) In-editor one-click** — the SuperSplat fork ships an **Auto-Clean button** + a settings panel + a guided **Aerial Wizard** (§4). Runs the same algorithm client-side as ONE undoable `AutoCleanOp` (§2.5).

Both runtimes use the **same parameter names and defaults** so a preset tuned in the editor can be pasted into the server command and vice-versa. Params live in one shared JSON schema: `pipeline/autoclean_presets.json`.

### 2.4 Aerial georef crop source (fills a research gap)

The aerial cleaning rule "never crop by percentile" needs a boundary source. AeroBrain already stores `<cid>.cameras.json` (RTK/PPK-capable drone poses). v2 derives the **flight-boundary polygon** from camera XY extents (convex hull of camera positions, inflated by nadir footprint) and stores a `scene_to_meters` scale factor + `flight_boundary` polygon in `<cid>.meta.json`. Stage 8 crops to that polygon, not to a gaussian-position percentile. This also unlocks the measure tool (§8, deferred).

### 2.5 Reversibility of the clean itself

**Server-side:** archive the RAW pre-clean output as its own version **before** mutating. Today `crop_floaters` overwrites `splats/<cid>.splat` in place and the staged raw dir is `rmtree`'d — the un-cropped output is unrecoverable. In v2, write `splats/history/<cid>-<ts>.raw.splat` (or a `<cid>.raw.splat` sidecar) **before** running Auto-Clean, and record `cleaned_from` (version_id) + `clean_params` in `<cid>.meta.json` (mirrors the existing `params_hash` pattern). → any clean is undoable by promoting the raw history entry (§3).

**In-editor:** the clean is a single **`MultiOp`** = `[SelectOp(set, mask), DeleteSelectionOp]`. `State.deleted` is a non-destructive bitfield flag — deleted gaussians are only excluded at export, never removed from the buffer. So the whole clean is **one atomic Undo** (Ctrl+Z), and `ResetOp` restores everything.

**The atomicity-vs-granularity tension (from the critic) — resolved:** the default Auto-Clean is one atomic MultiOp (clean UX, single undo). But the **Aerial Wizard** and settings panel run each stage as its **own** maskable, toggleable sub-op with a live count ("Scale cap removed 8,431 · SOR removed 12,004") and a per-stage checkbox, so a user who "liked the opacity pass but SOR ate my crane" can toggle SOR off and re-bake without redoing the rest. Implementation: the wizard builds a `MultiOp` but keeps each child op referenced in a panel-side list with individual enable flags; unchecking re-runs the MultiOp minus that child. One-click button = atomic; wizard = staged. Both reversible.

---

## 3. REVERSIBILITY DESIGN (the vault)

### 3.1 Storage model (extends what exists)

Splats live flat in `VAULT/splats/` (`VAULT=/Volumes/SSD/drone-vault`). Per clip `<cid>`:
- `<cid>.splat` — **master** (antimatter15, 32 B/gaussian), auditable source
- `<cid>.clean.sog` — lossy viewer format (derived, not a source)
- `<cid>.ply` / `<cid>.spz` / `<cid>.ksplat` — alt formats
- `<cid>.meta.json`, `<cid>.cameras.json`

Every prior variant is archived to `splats/history/<cid>-YYYYMMDD-HHMMSS.<suffix>` **before** any new current file is written — this already happens on both training publish (`worker.py:242-263`) and SuperSplat upload (`aerobrain_server.py:2731-2763`), retention `keep=6` (`prune_splat_history`). **v2 makes reversibility first-class by:**

1. **Archiving the raw pre-clean splat** as a version (§2.5) so *this run's* un-cleaned output is recoverable, not just the *prior training's* splat.
2. **Retaining `<cid>.ply` per version** for max-fidelity re-clean (SOG is lossy; `.splat` drops SH>0). `SPLAT_PRIORITY` and publish already tolerate `.ply`.
3. **Raising history `keep` to 12** for edited clips (cleaning generates more versions than training).

### 3.2 Version → manifest → viewer mapping (unchanged contract)

`build_index.all_splats` scans `splats/` + `splats/history/`, collapses viewer+source encodings onto one logical version via `_logical_splat_key` / `SPLAT_PRIORITY = {.sog:0,.spz:1,.ksplat:2,.splat:3,.ply:4}` (lowest wins as served artifact), emits each entry with `name/path/bytes/format/version_id/current/archived_at` into `manifest/system.json.splats[]`. The viewer (`splatview.js`, `share.js`) loads whatever format the manifest chose. **v2 adds nothing to break this** — new versions (raw, cleaned, edited) just appear as additional history entries with their own `version_id`.

### 3.3 New: first-class revert + version selector

- **New endpoint** `POST /api/splat_revert?cid=&version_id=` (`aerobrain_server.py`): archives the current variant, promotes the chosen history file back to `<cid>.<ext>`, regenerates `.clean.sog`, calls `retarget_splat_artifacts` (already exists, `jobs.py:303`) so finished jobs keep pointing at THEIR archived version, `rebuild_index`. Participates in the same **pending-lock** as uploads (409 if a splat job is running for the cid).
- **New: edit/clean ledger.** SuperSplat edits currently leave no trace in `reconstruction.splat_runs[]` (train-only). v2 appends an edit record `{version_id, tool:"autoclean|manual", params, gaussian_delta, ts}` to a parallel `reconstruction.splat_edits[]` in `meta.json` so the projected-vs-observed dataset isn't blind to post-training cleaning.
- **Viewer version selector** in `splatlab.js`: a dropdown listing `system.json` versions for the cid (current + history, with `archived_at` + gaussian count + `raw/cleaned/edited` tag). Selecting one reloads the editor iframe on that version; a "Revert to this" button calls `/api/splat_revert`.
- **A/B compare (fills critic gap):** the version selector offers "Compare with current" — loads both versions and toggles/wipes between them so the user sees exactly what a clean removed before committing.

---

## 4. SUPERSPLAT FORK PLAN

Fork root: `/Volumes/SSD/work/forge-projects/aerobrain/splat/supersplat` (vendored v2.28.1, MIT, TS+SCSS). Served from `.../dist` at `/supersplat/` same-origin.

### 4.1 Maintainability boundary (fills the biggest unaddressed risk)

**Rule: keep AeroBrain code in an isolated `src/aerobrain/` subtree; touch upstream `src/` files with the smallest possible seams.** Upstream ships fast; inline edits scattered across many files will not survive a rebase. Concretely:

- **All new logic** (Auto-Clean op factory, preset schema, wizard panel, touch-mode controller, tooltip config) lives in **new files** under `src/aerobrain/` — zero upstream churn there.
- **Upstream files get one-line registration seams only:**
  - `src/editor.ts` — ONE `events.on('edit.autoClean', ...)` registration (mirrors existing `select.delete`).
  - `src/ui/bottom-toolbar.ts` — ONE `this.append(new AeroToolbarGroup(events, tooltips))`.
  - `src/ui/editor.ts` — ONE `canvasContainer.append(new AutoCleanPanel(...))` + wizard.
  - `src/shortcut-manager.ts` — a handful of lines in the `defaultShortcuts` map.
  - `src/main.ts` — the `?autoclean=` URL-param handler.
- **Patch tracking:** every upstream seam is wrapped in `// AEROBRAIN-PATCH: <id>` comment markers and catalogued in `splat/supersplat/AEROBRAIN_PATCHES.md` (file, line-anchor, why). A `scripts/verify-patches.sh` greps for the markers so a rebase that drops one is caught.
- **Upgrade cadence:** pin the current commit; re-vendor upstream **quarterly**, re-apply the ~7 seams from the patch catalogue, rebuild. We intentionally accept that we own `src/aerobrain/` forever; the seams are cheap to re-apply because they're one-liners.

### 4.2 The command-queue command to add

Create `src/aerobrain/auto-clean-op.ts`:

```ts
// buildAutoCleanOp(splat, params) -> MultiOp   (ONE undoable history entry)
export function buildAutoCleanOp(splat, params): MultiOp {
  const n = splat.splatData.numSplats;
  const scale0 = splat.splatData.getProp('scale_0'); // log-space
  const scale1 = splat.splatData.getProp('scale_1');
  const scale2 = splat.splatData.getProp('scale_2');
  const opacity = splat.splatData.getProp('opacity'); // logit
  const x = splat.splatData.getProp('x'), y = ..., z = ...;
  // compute per-model median scale + bbox diag, then run stages 1..7
  // into a Uint8Array mask (255 = remove), following §2.1 order.
  const mask = computeAutoCleanMask(n, {scale0,scale1,scale2,opacity,x,y,z}, params);
  return new MultiOp([ new SelectOp(splat, 'set', mask), new DeleteSelectionOp(splat) ]);
}
```

This reuses the tested `SelectOp` (mask: 255=hit, auto-skips locked/deleted) and `DeleteSelectionOp` (sets `State.deleted`, excluded by serializers) — **zero new GPU code**. For the GPU path option (scale/opacity via the existing tuned pipeline), reuse `DataProcessor.selectByRange(splat, mode, {...})` with `mode=8` (opacity) / `9-11` (scale) exactly as `data-panel.ts:828-841`, enqueued on `scene.commandQueue`.

**Selection scope fix:** `selectedSplats()` returns only the active splat. Auto-Clean must iterate `scene.getElementsByType(ElementType.splat)` so a multi-splat scene cleans all of them (each as its own MultiOp, or wrapped in a top-level MultiOp for one undo).

### 4.3 Event wiring

`src/editor.ts` (in `registerEditorEvents`), one seam:
```ts
// AEROBRAIN-PATCH: autoclean-event
events.on('edit.autoClean', (params = {}) => {
  scene.getElementsByType(ElementType.splat).forEach(splat =>
    editHistory.add(buildAutoCleanOp(splat, { preset: 'aerial', ...params })));
});
```

### 4.4 Toolbar + panel injection

- **Toolbar:** `src/aerobrain/aero-toolbar-group.ts` builds a PCUI `Container` with the Auto-Clean button (`bottom-toolbar-autoclean`, inline SVG from `src/aerobrain/svg/autoclean.svg`), a **Wizard** button, and a **Statistical Cleanup** button that surfaces the Data Panel (Ctrl+D — SuperSplat's most powerful cleaner, currently buried behind a status-bar click). Each button: `tooltips.register(btn, tooltip('aero.autoclean'))` + `btn.dom.addEventListener('click', () => events.fire('edit.autoClean'))`.
- **Settings panel:** `src/aerobrain/auto-clean-panel.ts` (copy `color-panel.ts` as template — Container + `SliderInput`s). Sliders: preset selector, opacity threshold, scale-K, bbox-fraction, anisotropy, voxel size/op, SOR on/off + nb/std. Live per-stage removed-count readout + per-stage enable checkboxes (§2.5). "Run" fires `edit.autoClean` with slider params; "Reset" fires the ResetOp.
- **Aerial Wizard:** `src/aerobrain/aerial-wizard.ts` — a guided 4-step slide-over encoding the coarse-to-fine order: (1) *Strip sky* — Box Select ground footprint → Invert → preview delete; (2) *Kill haze/floaters* — opacity + voxel + optional SOR with live preview slider; (3) *Kill spikes* — scale/aniso caps; (4) *Crop to AOI* — georef boundary or manual box. Each step shows before/after counts and can be skipped. Defaults to **Rings/Splat view mode ON** during the wizard (hotkey `O`/`Q`) because oversized gaussians are only visible as ellipses, not centers.

### 4.5 Selection-by-opacity/scale (already exists — surface it)

Promote the histogram **Data Panel** (`data-panel.ts`, `Ctrl+D`) to a first-class toolbar button. One-click presets that pre-drag the histogram range: "select faint (low opacity tail)", "select spikes (high scale tail)", "select far floaters (high distance)". Uses the existing `DataProcessor.selectByRange` → `select.mask` → `SelectOp` path.

### 4.6 Keyboard shortcuts

Add to `src/shortcut-manager.ts` `defaultShortcuts` (all `// AEROBRAIN-PATCH: shortcuts`):
```
'edit.autoClean'   : { keys: ['k'], ctrl: 'required', capture: true }
'aero.wizard'      : { keys: ['k'], shift: 'required', capture: true }
'aero.dataPanel'   : { keys: ['d'], ctrl: 'required' }   // if not already mapped
```
Preserve SuperSplat's existing muscle-memory kit: `R/P/L/B/O` (rect/poly/lasso/brush/flood), `E` eyedropper, `[`/`]` brush size, `Ctrl+A`/`Shift+A`/`Ctrl+I`, `Delete`, `H/U`, `Tab`, and the Set/Add(Shift)/Remove(Ctrl)/Intersect(Shift+Ctrl) modifier model.

### 4.7 `?autoclean=` on load (publish integration)

`src/main.ts`, one seam after the `?load=` loop (`:280`):
```ts
// AEROBRAIN-PATCH: autoclean-onload
if (url.searchParams.get('autoclean')) {
  await events.invoke('queue', () =>
    events.fire('edit.autoClean', { preset: url.searchParams.get('preset') || 'aerial',
                                    std: Number(url.searchParams.get('autocleanStd')) || undefined }));
}
```
Imported splats are auto-selected (`selection.ts:33`) and the op is queued on the shared CommandQueue, so it runs deterministically after load. Publish pipeline can open `?load=<url>&autoclean=1&preset=aerial` to clean-on-open. Headless bake: after the clean, `events.invoke('scene.write', 'ply'|'compressedPly'|'sog', options)` — serializers drop `State.deleted`, so the export is the cleaned model.

### 4.8 Build + deploy

From `splat/supersplat/`: `npm install` (once), `npm run develop` (watch + serve :3000, `BUILD_TYPE=debug`) while iterating, then `npm run build` (`rollup -c` → `dist/`). Node ≥ 20.19 (env has 26 — fine). Ship = commit `src/` changes + rebuilt `dist/`. **Gate on `tsc` before push** (per repo rule — duplicate-key regressions have hit prod twice). Also regenerate the `.gz` twins (`splatlab.js.gz`, `supersplat-mobile.css.gz`) if we serve pre-compressed.

### 4.9 CSP constraint (hard requirement)

Everything ships **inside the same-origin dist bundle**: `script-src 'self' 'wasm-unsafe-eval'` (WASM sort worker needs it), `connect-src 'self'` only (no CDN/external). The iframe stays same-origin so `splatlab.js` keeps `frame.contentDocument` access for mobile CSS injection + DnD interception. SuperSplat HTML keeps `frame-ancestors 'self'` (`aerobrain_server.py:2467`) so `splatlab.html` can iframe it.

---

## 5. UI REORG + RESPONSIVE

### 5.1 Layout by device

**Desktop (>1280px):** persistent docked panels (left: scene manager; right: transform/color/**Auto-Clean**), top toolbar grouped by task, bottom toolbar for tools. Hover tooltips on every control.

**iPad (768–1280px):** collapsible/floating toolbars; side panels become **slide-over drawers** (Auto-Clean, Data Panel, version selector). Larger hit targets (≥44px). Aerial Wizard as a slide-over — matters *more* here because finger-brush selection is painful, so one-tap Auto-Clean + wizard are the primary path.

**iPhone (<768px):** full-bleed canvas; all secondary controls collapse into a **bottom sheet** (thumb zone) with a fixed floating primary CTA = **Auto-Clean**. Primary nav behind a menu button. Tool palette + wizard live in the bottom sheet.

### 5.2 Toolbar reorg (groups, not a flat row)

Group SuperSplat's scattered tools into labelled clusters: **Navigate** (orbit/pan/zoom/focus) · **Select** (picker/rect/poly/lasso/brush/flood/sphere/box + Set/Add/Remove/Intersect) · **Clean** (Auto-Clean · Wizard · Statistical/Data Panel · opacity/scale presets) · **View** (Centers/Rings toggle, rings-for-selected, splat render toggle) · **Version** (selector · A/B compare · revert) · **Export**. Rings toggle gets prominent placement (floaters only visible in ellipse mode).

### 5.3 Touch editing (fills critic gap — the viewer research didn't cover this)

`splatlab.js` already injects mobile CSS into the iframe `contentDocument`; extend that hook to add **touch-mode selection affordances** since touch has no hover / no right-click Remove / no `[`/`]` / no Ctrl/Shift:
- **Mode toggle** (orbit ⇄ select) — a floating segmented control, since one-finger can't mean both spin-camera and paint-selection.
- **On-screen Add / Remove / Intersect** buttons (replaces Shift/Ctrl modifiers).
- **On-screen brush-size − / +** (replaces `[`/`]`).
- **Two-finger = orbit/pinch always** (Google Earth model); one-finger in select-mode = paint, in orbit-mode = rotate.
- All targets ≥44×44px, ≥8px gaps.

### 5.4 Tooltip system (hover + touch — REQUIRED on ALL buttons)

One component, branches on input capability:
- `@media (hover:hover) and (pointer:fine)` → **hover reveal** (+ always pair `:focus` for keyboard).
- `@media (hover:none) and (pointer:coarse)` → **tap-to-explain**: first tap shows a label/popover ("Auto-Clean — removes floaters, haze, and spikes"), second tap activates. Long-press also reveals.
- Every icon-only button MUST have a label available via this path. Content: what it does + shortcut. SuperSplat's `tooltips.register(btn, tooltip('key','shortcut.id'))` already exists; we extend it with the touch branch and add AeroBrain keys.
- **First-run gesture hint overlay:** "1 finger to orbit · pinch to zoom · 2 fingers to pan · tap ⚡ to auto-clean" (users transfer the Maps/Earth mental model).

### 5.5 Nav feel (match our point-cloud/mesh viewers)

One-finger/one-button ROTATE, two-finger DOLLY+TRUCK, pinch zoom-to-centroid. Momentum via SmoothDamp-style damping. Params to match our existing perfect viewers: `smoothTime≈0.25`, `draggingSmoothTime≈0.11`, `rotateSpeed≈0.8`, `zoomSpeed≈1.2`, `panSpeed≈0.8`, `dollyToCursor=true`. Expose a single **"inertia" slider** mapping to `smoothTime`. (SuperSplat has its own camera controller; we tune its params to these values rather than swapping the library.)

---

## 6. PERFORMANCE

Bottleneck = fill rate (fragment ops) + per-frame depth sort, both worse-than-linear in splat count. Two independent levers: fewer fragments, fewer active splats.

- **Render-on-demand (biggest iPad win):** no continuous rAF. `needsRender` flag set by camera-change / damping-settling / new-LOD-tile; render one frame then park. Keep rendering only while damping velocity > rest threshold. Idle GPU/battery → ~0.
- **DPR cap:** `setPixelRatio(min(devicePixelRatio, isMobile ? 1.0 : 1.5))`; drop to ~0.75 *during* active drag, restore on release ("blurry while moving, sharp when still"). Disable MSAA/AA on the splat pass.
- **Sort throttling:** depth sort on a Web Worker; re-sort only past an angular/position threshold or ~20Hz, decoupled from 60Hz draw. Slightly-stale sort is acceptable during fast spin.
- **Splat budget by device class:** ~1M mobile / ~3M desktop; frustum culling; distance-based LOD (coarsest LOD first → first frame almost immediately → stream finer). Cap LOD range on slow links.
- **Faster load:** show coarse LOD instantly; respect the existing viewer load timeout (45s + 3s/MB, capped 120s, `splatview.js:73`). Prefer serving the SOG (80–200MB) over raw PLY (~1.5GB) as the viewer artifact — already the manifest default.
- **QA on real iPad + iPhone at 390×844 first** (per CLAUDE.md): watch for sort hitches on fast spin, thermal throttling after ~1min, tooltip-on-touch behaviour.

---

## 7. PHASED ROADMAP

### P0 — Quick wins (server auto-clean + reversibility + tooltips) · ~3–4 days
Ship value without touching the fork's TS build.
- **Deliverables:** `pipeline/autoclean.mjs` (wraps splat-transform, §2.1 stages 1–8, aerial preset); `pipeline/autoclean_presets.json`; raw-splat archival before clean (§2.5); `cleaned_from`/`clean_params` in `meta.json`; `POST /api/splat_revert`; `splat_edits[]` ledger; version-selector + A/B compare + revert UI in `splatlab.js`; **tooltip-everywhere** (hover+touch) pass on the existing `splatlab.html` wrapper controls + `supersplat-mobile.css`.
- **Files:** `pipeline/autoclean.mjs` (new), `pipeline/autoclean_presets.json` (new), `pipeline/worker.py` (replace `crop_floaters` call ~2056; raw archive ~248/269), `pipeline/aerobrain_server.py` (revert endpoint; upload-path clean hook ~2770; keep=12), `pipeline/build_index.py` (surface raw/cleaned/edited tags), `pipeline/jobs.py` (reuse `retarget_splat_artifacts`), `web/splatlab.js`, `web/splatlab.html`, `web/supersplat-mobile.css`.
- **Effort:** M. **Gate:** fail-open <40% guard preserved; pending-lock on revert; `tsc`/build green for any web JS.

### P1 — SuperSplat fork: in-editor Auto-Clean + UI reorg · ~5–7 days
- **Deliverables:** `src/aerobrain/` subtree (auto-clean-op, panel, wizard, presets, toolbar-group, svg); `edit.autoClean` event wiring; toolbar reorg into task groups; Data-Panel-as-first-class button + histogram presets; keyboard shortcuts; `?autoclean=` on-load; headless bake export; `AEROBRAIN_PATCHES.md` + `verify-patches.sh`; rebuild `dist/`.
- **Files:** `src/aerobrain/*` (new), seams in `src/editor.ts`, `src/ui/bottom-toolbar.ts`, `src/ui/editor.ts`, `src/shortcut-manager.ts`, `src/main.ts`; `rollup` build → `dist/`.
- **Effort:** L. **Gate:** `tsc` clean; single-undo verified; ResetOp restores; multi-splat scope fixed.

### P2 — Responsive + mobile + perf · ~4–5 days
- **Deliverables:** device-class layout (desktop docked / iPad drawers / iPhone bottom sheet); touch-mode selection controls injected via `contentDocument`; dual-mode tooltips inside the fork; first-run gesture overlay; render-on-demand, DPR cap + drag-downscale, worker sort throttle, splat budget + LOD; nav-feel param tuning + inertia slider.
- **Files:** `web/splatlab.js` (touch injection), `web/supersplat-mobile.css`, `src/aerobrain/touch-mode.ts` (new), `src/aerobrain/tooltips.ts` (new), fork camera-controller params, fork render loop.
- **Effort:** L. **Gate:** QA on real iPad + iPhone at 390×844; 0 console errors; no sort hitch on fast spin.

### P3 — Polish · ~2–3 days
- **Deliverables:** per-stage toggle/live-count refinement in wizard; color/exposure seam normalization for aerial (reuse `color-panel.ts` op); duplicate/overlap coplanar-merge cleaning (splat-transform); measure tool (needs `scene_to_meters`, §2.4); SH-band export control surfaced in our UI; i18n keys; empty/error states; deploy budget discipline (max 3 Vercel/local-preview-first).
- **Effort:** M.

---

## 8. RISKS + OPEN QUESTIONS

**Risks**
- **Fork upstream drift** — mitigated by the `src/aerobrain/` boundary + `AEROBRAIN_PATCHES.md` + `verify-patches.sh` + quarterly re-vendor. Accept we own the subtree forever.
- **Aerial over-cull** — SOR/ROR/tight-crop clip thin real structures and sparse far corners. Mitigation: voxel-occupancy as backbone, SOR off-by-default on aerial, no percentile crop, fail-open <40% guard, always-reversible.
- **Training-vs-edit race** — Auto-Clean-as-server-job must join the same pending-lock as uploads (409). Revert must too.
- **`.splat`/SOG lossiness** — `.splat` drops SH>0, SOG is lossy-final. Mitigation: retain `.ply` per version for max-fidelity re-clean; edit masters in `.ply`, ship in SOG/SPZ.
- **Touch editing UX** — finger brush selection is genuinely hard; we lean on Auto-Clean + wizard as the primary mobile path rather than pretending manual selection works on a phone.
- **Perf on 10M+ aerial scenes** — worker sort + budget + LOD are essential, not optional; validate on the largest real vault clip early.

**Open questions**
1. **AI/semantic selection** (SAGA / Gaussian Grouping / SAM-distilled identity encoding for "select sky / ground / vegetation"): huge differentiator, but the identity-encoding channel must be baked **at train time** (OpenSplat change) or SAM-projected via `cameras.json` post-hoc. Is this a v2 stretch or a v3 track? Recommend: scope a *lightweight* SAM-on-source-frames → project masks via `cameras.json` spike in P3, defer full training-time encoding to v3.
2. **Georef scale accuracy** — is drone RTK/PPK data reliable enough in `cameras.json` to derive `scene_to_meters` for a measure tool, or do we need GCP input? Blocks the measure tool + safe geo-crop.
3. **Do we retain `.ply` as current** for edited clips (storage cost ~1.5GB/clip) or only in history? Affects vault sizing.
4. **One MultiOp vs staged sub-ops as the shipped default** — recommend atomic MultiOp for the button, staged for the wizard (§2.5); confirm this matches user expectation.
5. **Camera-controls library** — tune SuperSplat's built-in controller to our param targets, or swap in yomotsu/camera-controls? Swap is cleaner feel but a bigger fork seam. Recommend tune-first.
