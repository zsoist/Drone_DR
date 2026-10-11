# Splat Lab v2 — GRAND PLAN

**Author:** Lead Architect
**Date:** 2026-07-15
**Status:** Proposed (pre-build)
**Scope:** A studio to clean Gaussian splats in AeroBrain. It is a fork of PlayCanvas SuperSplat (MIT) with integration into the AeroBrain pipeline and viewer.
**Canonical path of this doc:** `/Volumes/SSD/work/forge-projects/aerobrain/docs/SPLATLAB_V2_PLAN.md`

---

## 0. TL;DR

Splat Lab v2 changes our vendored SuperSplat iframe from a bare MIT editor into a purpose-built **studio to clean aerial splats**. No competitor ships these three things together:

- A real **one-click Auto-Clean**. It is an ordered stack of statistical, voxel, and attribute filters. We set the filters for drone captures.
- **Full reversibility**. Every clean is a promotable version in `splats/history/`. The editor also has non-destructive masks and atomic undo.
- A **reorganized, touch-first UI** with a tooltip on every control. It feels like Google Earth on desktop, iPad, and iPhone.

We do the clean on the server with a `pipeline` command that runs on publish. We also do the clean in the editor with one button and a guided aerial wizard. A thin plugin boundary keeps our patches small, so they stay easy to merge with upstream changes. Big scenes stay fast on iPad. This needs render-on-demand, a throttle on the sort, a cap on DPR, and LOD.

---

## 1. VISION

Splat Lab v2 is the first studio built to clean **drone Gaussian splats specifically**. You open a new aerial model, and one tap removes these defects:

- the sky floaters
- the spiky oblique-pass needles
- the translucent haze blobs
- the far-altitude noise

The tap removes them in the right order. The parameters are for large, sparse aerial scenes. The ground footprint stays. The thin structures that are real stay. Far corners that are legitimately sparse stay.

Every clean is **fully reversible**. The editor does not delete anything for good until you deliberately bake an export. Every published clean is a promotable version in the vault. The editor **navigates like Google Earth** on any device, and every control has a hover or tap tooltip. Power users keep the complete manual toolkit of SuperSplat underneath.

We host the editor ourselves. It is same-origin and CSP-clean. It fits into the current AeroBrain pipeline of `.splat` master, SOG viewer, and versioned manifest. It does not break any downstream consumer.

---

## 2. AUTO-CLEAN ENGINE

This is the heart of v2. One algorithm runs in two runtimes: a server pipeline command and an in-editor button. The design makes the clean reversible by construction.

### 2.1 The ordered pipeline (canonical order, do not change it)

Each stage writes to a boolean **mask** for each Gaussian. A stage never changes the source buffer. The stages run in this exact order. If cheap and safe stages remove gaussians first, the expensive kNN pass is faster and has less statistical bias.

| # | Stage | What it removes | Default (Aerial) | Default (Object) | Cost |
|---|-------|---------------|------------------|------------------|------|
| 1 | **NaN/Inf filter** | corrupt gaussians | always on | always on | O(N) |
| 2 | **Opacity threshold** | faint haze/fog | `alpha < 0.04` | `alpha < 0.10` | O(N) |
| 3 | **Scale cap (absolute)** | spikes / needles | `maxAxis > 6·median` | `maxAxis > 4·median` | O(N) |
| 4 | **Scale cap (bbox)** | sky-spanning splats | `maxAxis > 0.10·bboxDiag` | `maxAxis > 0.10·bboxDiag` | O(N) |
| 5 | **Anisotropy cap** | extreme slivers | `maxAxis/minAxis > 15` | `maxAxis/minAxis > 12` | O(N) |
| 6 | **Voxel-occupancy floater filter** (primary structural remover) | disconnected floaters | `size=0.05·sceneScale, op=0.10, min=0.004` | same | O(N) |
| 7 | **SOR (statistical outlier removal)** (optional) | residual floater cloud | `nb=25, std_ratio=2.5` (or OFF) | `nb=20, std_ratio=1.5` | O(N log N) |
| 8 | **Crop to AOI** (LAST, explicit only) | context outside area | georef flight boundary ONLY | box/sphere manual | O(N) |

**Rationale from the research:**

- In a PLY file, the opacity is a **logit** (inverse sigmoid). Apply `sigmoid()` and then compare to the threshold. Or compare the raw logit directly. The values are `alpha=0.10 ≈ logit −2.197`, `alpha=0.05 ≈ −2.944`, and `alpha=0.04 ≈ −3.178`.
- The file stores scale in **log space**. Apply `exp()` before you compare to `median` or `bboxDiag`.
- The tool computes `median_scale` and `bboxDiag` **for each model**. The thresholds adapt to the scene and are never absolute.
- Voxel occupancy is the **backbone** floater remover. It uses the `filterFloaters` model of splat-transform. The tool divides the scene into voxels of size `size`. It marks a voxel as "solid" when the accumulated contribution is more than the thresholds. It drops each Gaussian that contributes to no solid voxel. The method is robust to scene scale.
- SOR and ROR remove too much of two valid things: the far corners of sparse aerial scenes, and thin real structures (crane jibs, pipes, rebar). So SOR is a *secondary optional* pass and not the backbone.
- **NEVER** run `filterCluster` (keep the connected component) on aerial scenes by default. It deletes detached but valid regions, such as separate buildings and terrain islands. The Object preset can offer it as an opt-in.
- **NEVER** crop an aerial scene automatically by position percentile. The floaters that we remove bias the percentiles. Crop only to a georeferenced flight boundary that is explicit (see §2.4). Or crop to a box that the user draws.

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

**(A) Server-side pipeline command.** The command is `pipeline/autoclean.mjs` (new). It runs in two ways:

1. **On publish of a training run.** The command replaces the current in-place `crop_floaters(final_out)` call at `worker.py:2056-2059` with `run_autoclean(final_out, preset="aerial")`. It runs on every OpenSplat training output before `export_viewer_sog`.
2. **On SuperSplat upload.** The same hook goes in `aerobrain_server.py` just before the SOG transform (about `:2770`). The hook has a gate: `meta.edited != true`. The gate makes sure that the pipeline never crops an export again after a human cleaned it. Such a crop can undo the work of the human.

The command wraps **`playcanvas/splat-transform`** (MIT CLI) for stages 1, 2, 3, 4, 6, and 8. The flags are `--filter-nan`, `--filter-value opacity,gt,X`, `--filter-value scale_*`, `--filter-floaters size,op,min`, and `--filter-box`. A small custom pass does stages 5 and 7 (anisotropy and SOR). The commands chain together and stream the data. They use bounded memory on scenes of 10M+ gaussians.

Keep the current **fail-open guard** for safety. If less than 40% of the gaussians stay after the clean, stop the clean. Write a log entry. Continue to publish the splat without the clean. This is the contract of `worker.py:126` and `crop_splat.mjs:66`.

**(B) In-editor one-click.** The SuperSplat fork ships these items:

- an **Auto-Clean button**
- a settings panel
- a guided **Aerial Wizard** (§4)

The button runs the same algorithm in the browser as ONE undoable `AutoCleanOp` (§2.5).

Both runtimes use the **same parameter names and defaults**. So you can paste a preset that you tuned in the editor into the server command, and the reverse. The parameters live in one shared JSON schema: `pipeline/autoclean_presets.json`.

### 2.4 Aerial georef crop source (fills a research gap)

The aerial rule "never crop by percentile" needs a boundary source. AeroBrain already stores `<cid>.cameras.json`. It holds the drone poses, which can come from RTK or PPK.

v2 derives the **flight-boundary polygon** from the camera XY extents. It takes the convex hull of the camera positions and makes it larger by the nadir footprint. It stores a `scene_to_meters` scale factor and the `flight_boundary` polygon in `<cid>.meta.json`. Stage 8 crops to that polygon and not to a gaussian-position percentile. This also makes the measure tool possible (§8, deferred).

### 2.5 Reversibility of the clean itself

**Server-side:** Archive the RAW pre-clean output as its own version **before** the clean changes it. Today `crop_floaters` overwrites the file `splats/<cid>.splat` in place. The worker also runs `rmtree` on the staged raw directory. So nobody can recover the output before the crop. In v2, write `splats/history/<cid>-<ts>.raw.splat` (or a `<cid>.raw.splat` sidecar) **before** Auto-Clean runs. 

Record `cleaned_from` (version_id) and `clean_params` in `<cid>.meta.json`. This mirrors the `params_hash` pattern that is already in use. Then you can undo any clean when you promote the raw history entry (§3).

**In-editor:** The clean is a single **`MultiOp`**, which is `[SelectOp(set, mask), DeleteSelectionOp]`. `State.deleted` is a non-destructive bitfield flag. The export leaves out each gaussian with the deleted flag. The editor never removes them from the buffer. So the whole clean is **one atomic Undo** (Ctrl+Z), and `ResetOp` restores everything.

**The conflict between atomicity and granularity (from the critic), resolved:**

- The default Auto-Clean is one atomic MultiOp. It gives a clean UX and a single undo.
- The **Aerial Wizard** and the settings panel run each stage as its **own** maskable and toggleable sub-op. Each stage has a live count ("Scale cap removed 8,431 · SOR removed 12,004") and a checkbox.
- Example: a user "liked the opacity pass but SOR ate my crane". The user turns SOR off and bakes again. The user does not do the rest of the work again.
- To make this work, the wizard builds a `MultiOp` but keeps each child op in a list in the panel. Each child has its own on/off flag. When the user clears a checkbox, the wizard runs the MultiOp again without that child.

The one-click button is atomic. The wizard has stages. Both are reversible.

---

## 3. REVERSIBILITY DESIGN (the vault)

### 3.1 Storage model (extends what exists)

Splats live flat in `VAULT/splats/` (`VAULT=/Volumes/SSD/drone-vault`). Each clip `<cid>` has these files:

- `<cid>.splat` (**master**, antimatter15, 32 B/gaussian): the auditable source
- `<cid>.clean.sog` (lossy viewer format): derived, not a source
- `<cid>.ply` / `<cid>.spz` / `<cid>.ksplat` (alternative formats)
- `<cid>.meta.json`, `<cid>.cameras.json`

The system archives every earlier variant to `splats/history/<cid>-YYYYMMDD-HHMMSS.<suffix>` **before** it writes a new current file. This already happens on publish of a training run (`worker.py:242-263`) and on SuperSplat upload (`aerobrain_server.py:2731-2763`). The retention is `keep=6` (`prune_splat_history`). **v2 makes reversibility first-class in three ways:**

1. **Archive the raw pre-clean splat** as a version (§2.5). Then the un-cleaned output of *this run* is recoverable. Before, only the splat of the *earlier training run* was recoverable.
2. **Keep `<cid>.ply` for each version** for a re-clean at maximum fidelity. SOG is lossy, and `.splat` drops SH>0. `SPLAT_PRIORITY` and publish already accept `.ply`.
3. **Raise the history `keep` to 12** for edited clips. A clean generates more versions than a training run does.

### 3.2 Version → manifest → viewer mapping (unchanged contract)

`build_index.all_splats` scans `splats/` and `splats/history/`. It collapses the viewer encodings and source encodings onto one logical version through `_logical_splat_key`. The order is `SPLAT_PRIORITY = {.sog:0,.spz:1,.ksplat:2,.splat:3,.ply:4}`, and the lowest value wins as the served artifact. It emits each entry with `name/path/bytes/format/version_id/current/archived_at` into `manifest/system.json.splats[]`. The viewer (`splatview.js`, `share.js`) loads the format that the manifest chose. **v2 adds nothing that breaks this.** New versions (raw, cleaned, edited) appear as more history entries, and each has its own `version_id`.

### 3.3 New: first-class revert and version selector

- **New endpoint** `POST /api/splat_revert?cid=&version_id=` (`aerobrain_server.py`). It does these steps:
  1. It archives the current variant.
  2. It promotes the history file that the user chose. The file goes back to `<cid>.<ext>`.
  3. It regenerates `.clean.sog`.
  4. It calls `retarget_splat_artifacts` (it already exists, `jobs.py:303`). So finished jobs keep a pointer to THEIR archived version.
  5. It runs `rebuild_index`.

  The endpoint uses the same **pending-lock** as uploads. It returns 409 if a splat job runs for the cid.
- **New: edit and clean ledger.** Today SuperSplat edits leave no trace in `reconstruction.splat_runs[]`, which holds training only. v2 appends an edit record `{version_id, tool:"autoclean|manual", params, gaussian_delta, ts}` to a parallel `reconstruction.splat_edits[]` in `meta.json`. Then the projected-vs-observed dataset includes the clean after the training run.
- **Viewer version selector** in `splatlab.js`. It is a dropdown that lists the `system.json` versions for the cid (current and history). Each entry shows `archived_at`, the gaussian count, and a `raw/cleaned/edited` tag. When the user selects one, the editor iframe reloads on that version. A "Revert to this" button calls `/api/splat_revert`.
- **A/B compare (fills a gap that the critic found).** The version selector offers "Compare with current". It loads both versions and toggles or wipes between them. The user sees exactly what a clean removed before the user commits.

---

## 4. SUPERSPLAT FORK PLAN

The fork root is `/Volumes/SSD/work/forge-projects/aerobrain/splat/supersplat` (vendored v2.28.1, MIT, TS+SCSS). The server serves it from `.../dist` at `/supersplat/`, same-origin.

### 4.1 Maintainability boundary (fills the biggest unaddressed risk)

**Rule: keep AeroBrain code in an isolated `src/aerobrain/` subtree. Touch the upstream `src/` files with the smallest possible seams.** Upstream ships fast. Inline edits in many files do not survive a rebase. In practice:

- **All new logic** lives in **new files** under `src/aerobrain/`. This includes the Auto-Clean op factory, the preset schema, the wizard panel, the touch-mode controller, and the tooltip config. There is zero upstream churn there.
- **Upstream files get one-line registration seams only:**
  - `src/editor.ts`: ONE `events.on('edit.autoClean', ...)` registration (it mirrors the current `select.delete`).
  - `src/ui/bottom-toolbar.ts`: ONE `this.append(new AeroToolbarGroup(events, tooltips))`.
  - `src/ui/editor.ts`: ONE `canvasContainer.append(new AutoCleanPanel(...))` and the wizard.
  - `src/shortcut-manager.ts`: a few lines in the `defaultShortcuts` map.
  - `src/main.ts`: the `?autoclean=` URL-param handler.
- **Patch list:** Wrap every upstream seam in `// AEROBRAIN-PATCH: <id>` comment markers. List each seam in `splat/supersplat/AEROBRAIN_PATCHES.md` (file, line anchor, reason). A `scripts/verify-patches.sh` script greps for the markers. So the script catches a rebase that drops one.
- **Upgrade cadence:** Pin the current commit. Re-vendor upstream **every quarter**. Apply the 7 seams from the patch catalogue again, and rebuild. We accept that we own `src/aerobrain/` forever. The seams are cheap to apply again because each one is a single line.

### 4.2 The command-queue command to add

<!-- ste:procedural -->

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

<!-- ste:descriptive -->

The code reuses two ops that have tests. `SelectOp` has a mask where 255 means hit. It skips locked and deleted gaussians by itself. `DeleteSelectionOp` sets `State.deleted`, and the serializers exclude those gaussians. So the plan needs **no new GPU code**.

For the GPU path option, reuse `DataProcessor.selectByRange(splat, mode, {...})`. It uses the tuned pipeline for scale and opacity that is already in the editor. Use `mode=8` (opacity) and `9-11` (scale), exactly as in `data-panel.ts:828-841`. Enqueue the call on `scene.commandQueue`.

**Selection scope fix:** `selectedSplats()` returns only the active splat. Auto-Clean must go through `scene.getElementsByType(ElementType.splat)`. Then it cleans all splats of a scene with many splats. Each splat gets its own MultiOp. Or a top-level MultiOp wraps all of them, for one undo.

### 4.3 Event wiring

`src/editor.ts` (in `registerEditorEvents`) has one seam:
```ts
// AEROBRAIN-PATCH: autoclean-event
events.on('edit.autoClean', (params = {}) => {
  scene.getElementsByType(ElementType.splat).forEach(splat =>
    editHistory.add(buildAutoCleanOp(splat, { preset: 'aerial', ...params })));
});
```

### 4.4 Toolbar and panel injection

- **Toolbar:** `src/aerobrain/aero-toolbar-group.ts` builds a PCUI `Container` with three buttons:
  - The Auto-Clean button (`bottom-toolbar-autoclean`, inline SVG from `src/aerobrain/svg/autoclean.svg`).
  - A **Wizard** button.
  - A **Statistical Cleanup** button. It shows the Data Panel (Ctrl+D). This is the most powerful cleaner of SuperSplat. Today the user must click the status bar to find it.

  Each button has `tooltips.register(btn, tooltip('aero.autoclean'))` and `btn.dom.addEventListener('click', () => events.fire('edit.autoClean'))`.
- **Settings panel:** `src/aerobrain/auto-clean-panel.ts`. Copy `color-panel.ts` as the template (a Container with `SliderInput`s). The sliders are:
  - the preset selector
  - the opacity threshold
  - scale-K
  - the bbox fraction
  - anisotropy
  - the voxel size and op
  - SOR on/off with nb and std

  The panel shows a live count of removed gaussians for each stage. It has a checkbox for each stage (§2.5). "Run" fires `edit.autoClean` with the slider params. "Reset" fires the ResetOp.
- **Aerial Wizard:** `src/aerobrain/aerial-wizard.ts` is a guided slide-over with 4 steps. The steps follow the coarse-to-fine order:
  1. *Strip sky.* Box Select the ground footprint, then Invert, then preview the delete.
  2. *Remove haze and floaters.* Use opacity, voxel, and optional SOR with a live preview slider.
  3. *Remove spikes.* Use the scale and anisotropy caps.
  4. *Crop to AOI.* Use the georef boundary or a manual box.

  Each step shows the counts before and after. The user can skip each step. By default, the wizard sets the view mode to **Rings** (hotkey `O`/`Q`). The reason is that oversized gaussians show only as ellipses and not as centers.

### 4.5 Selection by opacity or scale (it already exists, so surface it)

Promote the histogram **Data Panel** (`data-panel.ts`, `Ctrl+D`) to a first-class toolbar button. Add one-click presets that drag the histogram range for the user:

- "select faint (low opacity tail)"
- "select spikes (high scale tail)"
- "select far floaters (high distance)"

The presets use the path that is already in the editor: `DataProcessor.selectByRange`, then `select.mask`, then `SelectOp`.

### 4.6 Keyboard shortcuts

Add these to `src/shortcut-manager.ts` `defaultShortcuts` (all `// AEROBRAIN-PATCH: shortcuts`):
```
'edit.autoClean'   : { keys: ['k'], ctrl: 'required', capture: true }
'aero.wizard'      : { keys: ['k'], shift: 'required', capture: true }
'aero.dataPanel'   : { keys: ['d'], ctrl: 'required' }   // if not already mapped
```
Keep the SuperSplat shortcuts that users know by heart:

- `R/P/L/B/O` (rect/poly/lasso/brush/flood)
- `E` eyedropper
- `[`/`]` brush size
- `Ctrl+A`/`Shift+A`/`Ctrl+I`
- `Delete`
- `H/U`
- `Tab`
- the modifier model: Set, Add (Shift), Remove (Ctrl), Intersect (Shift+Ctrl)

### 4.7 `?autoclean=` on load (publish integration)

`src/main.ts` gets one seam after the `?load=` loop (`:280`):
```ts
// AEROBRAIN-PATCH: autoclean-onload
if (url.searchParams.get('autoclean')) {
  await events.invoke('queue', () =>
    events.fire('edit.autoClean', { preset: url.searchParams.get('preset') || 'aerial',
                                    std: Number(url.searchParams.get('autocleanStd')) || undefined }));
}
```
The editor selects imported splats by itself (`selection.ts:33`). The op goes on the shared CommandQueue, so it runs in a fixed order after the load. The publish pipeline can open `?load=<url>&autoclean=1&preset=aerial` to clean on open.

For a headless bake, call `events.invoke('scene.write', 'ply'|'compressedPly'|'sog', options)` after the clean. The serializers drop `State.deleted`, so the export is the cleaned model.

### 4.8 Build and deploy

<!-- ste:procedural -->

1. Go to `splat/supersplat/`.
2. Run `npm install` (one time only).
3. Run `npm run develop` while you iterate. It watches the files and serves on :3000 with `BUILD_TYPE=debug`.
4. Run `npm run build` (`rollup -c` writes to `dist/`).
5. Commit the `src/` changes and the rebuilt `dist/`.
6. Run `tsc`.
7. If `tsc` fails, fix the errors. Do not push.
8. If the server sends pre-compressed files, regenerate the `.gz` twins (`splatlab.js.gz`, `supersplat-mobile.css.gz`).

<!-- ste:descriptive -->

The Node version must be 20.19 or later. The environment has 26, which is correct. The repo rule gives the `tsc` gate. Duplicate keys caused two regressions in prod.

### 4.9 CSP constraint (hard requirement)

Everything ships **inside the same-origin dist bundle**:

- `script-src 'self' 'wasm-unsafe-eval'`. It is necessary for the WASM sort worker.
- `connect-src 'self'` only. There is no CDN and no external source.

The iframe stays same-origin. So `splatlab.js` keeps `frame.contentDocument` access for the mobile CSS injection and the DnD interception. The SuperSplat HTML keeps `frame-ancestors 'self'` (`aerobrain_server.py:2467`). So `splatlab.html` can put it in an iframe.

---

## 5. UI REORG + RESPONSIVE

### 5.1 Layout by device

**Desktop (>1280px):** The panels stay docked. The left panel is the scene manager. The right panel holds the transform, color, and **Auto-Clean** controls. The top toolbar has one group for each task. The bottom toolbar holds the tools. Every control has a hover tooltip.

**iPad (768–1280px):** The toolbars can collapse or float. The side panels turn into **slide-over drawers** (Auto-Clean, Data Panel, version selector). The hit targets are larger, at least 44px. The Aerial Wizard is a slide-over. It matters *more* here, because brush selection with a finger is painful. So one-tap Auto-Clean and the wizard are the primary path.

**iPhone (<768px):** The canvas fills the whole screen. All secondary controls collapse into a **bottom sheet** (thumb zone). A fixed primary CTA, **Auto-Clean**, floats on the screen. The primary navigation is behind a menu button. The tool palette and the wizard live in the bottom sheet.

### 5.2 Toolbar reorg (groups, not a flat row)

Group the scattered tools of SuperSplat into labelled clusters:

- **Navigate** (orbit/pan/zoom/focus)
- **Select** (picker/rect/poly/lasso/brush/flood/sphere/box and Set/Add/Remove/Intersect)
- **Clean** (Auto-Clean · Wizard · Statistical/Data Panel · opacity/scale presets)
- **View** (Centers/Rings toggle, rings for selected, splat render toggle)
- **Version** (selector · A/B compare · revert)
- **Export**

The Rings toggle gets a prominent place, because floaters show only in ellipse mode.

### 5.3 Touch editing (fills a gap that the critic found; the viewer research did not cover this)

`splatlab.js` already injects mobile CSS into the iframe `contentDocument`. Extend that hook to add **touch-mode selection aids**. Touch has no hover, no right-click Remove, no `[`/`]`, and no Ctrl/Shift. The aids are:

- **Mode toggle** (orbit ⇄ select). It is a segmented control that floats on the screen. One finger cannot spin the camera and paint a selection at the same time.
- **On-screen Add / Remove / Intersect** buttons. They replace the Shift and Ctrl modifiers.
- **On-screen brush-size − / +** buttons. They replace `[`/`]`.
- **Two fingers always mean orbit or pinch** (the Google Earth model). In select mode, one finger paints. In orbit mode, one finger rotates.
- All targets are at least 44×44px, with gaps of at least 8px.

### 5.4 Tooltip system (hover and touch; REQUIRED on ALL buttons)

One component branches on the input capability:

- `@media (hover:hover) and (pointer:fine)`: **hover reveal**. Always add `:focus` for the keyboard.
- `@media (hover:none) and (pointer:coarse)`: **tap-to-explain**. The first tap shows a label or popover ("Auto-Clean: removes floaters, haze, and spikes"). The second tap starts the button action. A long press also shows it.
- Every icon-only button MUST have a label available through this path. The content is what the button does and its shortcut.

SuperSplat already has `tooltips.register(btn, tooltip('key','shortcut.id'))`. We extend it with the touch branch and add AeroBrain keys.

**Overlay with a gesture hint on first run:** "1 finger to orbit · pinch to zoom · 2 fingers to pan · tap ⚡ to auto-clean". Users move over the mental model of Maps and Earth.

### 5.5 Nav feel (match our point-cloud and mesh viewers)

- One finger or one button ROTATES.
- Two fingers DOLLY and TRUCK.
- Pinch zooms to the centroid.
- Momentum comes from SmoothDamp-style inertia.

Match the params of our current perfect viewers: `smoothTime≈0.25`, `draggingSmoothTime≈0.11`, `rotateSpeed≈0.8`, `zoomSpeed≈1.2`, `panSpeed≈0.8`, `dollyToCursor=true`. Show a single **"inertia" slider** that maps to `smoothTime`. SuperSplat has its own camera controller. We tune its params to these values and do not swap the library.

---

## 6. PERFORMANCE

The bottleneck is fill rate (fragment operations) and the depth sort of each frame. Both grow faster than linear with the splat count. There are two independent levers: fewer fragments and fewer active splats.

- **Render-on-demand (the biggest iPad win):** There is no continuous rAF. These events set a `needsRender` flag: a camera change, the end of the motion, and a new LOD tile. The viewer renders one frame and then parks. It keeps rendering only while the velocity of the motion is more than the rest threshold. The idle GPU and battery use goes to about 0.
- **DPR cap:** `setPixelRatio(min(devicePixelRatio, isMobile ? 1.0 : 1.5))`. Drop to about 0.75 *during* an active drag. Restore the value on release ("blurry in motion, sharp at rest"). Turn off MSAA and AA on the splat pass.
- **Sort throttle:** Run the depth sort on a Web Worker. Sort again only past an angular or position threshold, or at about 20Hz. This is separate from the 60Hz draw. A slightly stale sort is acceptable during a fast spin.
- **Splat budget by device class:** About 1M on mobile and about 3M on desktop. Remove the splats outside the camera frustum. Use distance-based LOD. Load the coarsest LOD first. Then the first frame appears almost at once, and finer LODs stream in. Cap the LOD range on slow links.
- **Faster load:** Show the coarse LOD at once. Keep the current timeout for the viewer load (45s + 3s/MB, capped at 120s, `splatview.js:73`). Prefer to serve the SOG (80–200MB) over the raw PLY (about 1.5GB) as the viewer artifact. This is already the manifest default.
- **QA on a real iPad and iPhone at 390×844 first** (per CLAUDE.md). Watch for these problems:
  - sort hitches on a fast spin
  - a thermal slowdown after about 1 minute
  - tooltip behaviour on touch

---

## 7. PHASED ROADMAP

### P0 — Quick wins (server auto-clean + reversibility + tooltips) · about 3–4 days

This phase ships value without a change to the TS build of the fork.

- **Deliverables:**
  - `pipeline/autoclean.mjs` (it wraps splat-transform, §2.1 stages 1–8, aerial preset)
  - `pipeline/autoclean_presets.json`
  - raw-splat archive before the clean (§2.5)
  - `cleaned_from` and `clean_params` in `meta.json`
  - `POST /api/splat_revert`
  - the `splat_edits[]` ledger
  - the version selector, A/B compare, and revert UI in `splatlab.js`
  - a **tooltip-everywhere** pass (hover and touch) on the controls of the current `splatlab.html` wrapper and `supersplat-mobile.css`
- **Files:**
  - `pipeline/autoclean.mjs` (new)
  - `pipeline/autoclean_presets.json` (new)
  - `pipeline/worker.py` (replace the `crop_floaters` call at about 2056, and add the raw archive at about 248/269)
  - `pipeline/aerobrain_server.py` (add the revert endpoint, add the upload-path clean hook at about 2770, and set keep=12)
  - `pipeline/build_index.py` (show the raw/cleaned/edited tags)
  - `pipeline/jobs.py` (reuse `retarget_splat_artifacts`)
  - `web/splatlab.js`, `web/splatlab.html`, `web/supersplat-mobile.css`
- **Effort:** M.
- **Gate:** The fail-open guard for less than 40% stays. The revert uses the pending-lock. `tsc` and the build pass for all web JS.

### P1 — SuperSplat fork: in-editor Auto-Clean + UI reorg · about 5–7 days

- **Deliverables:**
  - the `src/aerobrain/` subtree (auto-clean-op, panel, wizard, presets, toolbar-group, svg)
  - the `edit.autoClean` event wiring
  - the toolbar reorg into task groups
  - the Data Panel as a first-class button, with histogram presets
  - keyboard shortcuts
  - `?autoclean=` on load
  - headless bake export
  - `AEROBRAIN_PATCHES.md` and `verify-patches.sh`
  - a rebuilt `dist/`
- **Files:** `src/aerobrain/*` (new), seams in `src/editor.ts`, `src/ui/bottom-toolbar.ts`, `src/ui/editor.ts`, `src/shortcut-manager.ts`, and `src/main.ts`. The `rollup` build writes to `dist/`.
- **Effort:** L.
- **Gate:** `tsc` is clean. A test shows that one undo reverses the clean. ResetOp restores the splat. The scope fix for many splats works.

### P2 — Responsive + mobile + perf · about 4–5 days

- **Deliverables:**
  - the device-class layout (desktop docked, iPad drawers, iPhone bottom sheet)
  - controls for touch-mode selection, injected through `contentDocument`
  - dual-mode tooltips inside the fork
  - the first-run gesture overlay
  - render-on-demand, DPR cap with drag downscale, worker sort throttle, splat budget, and LOD
  - a tune of the nav-feel params, and the inertia slider
- **Files:** `web/splatlab.js` (touch injection), `web/supersplat-mobile.css`, `src/aerobrain/touch-mode.ts` (new), `src/aerobrain/tooltips.ts` (new), the camera-controller params of the fork, the render loop of the fork.
- **Effort:** L.
- **Gate:** QA on a real iPad and iPhone at 390×844. 0 console errors. No sort hitch on a fast spin.

### P3 — Polish · about 2–3 days

- **Deliverables:**
  - a better per-stage toggle and live count in the wizard
  - color and exposure seam normalization for aerial (reuse the `color-panel.ts` op)
  - a clean of duplicate splats and splats that overlap in one plane, through a merge (splat-transform)
  - the measure tool (it needs `scene_to_meters`, §2.4)
  - an SH-band export control in our UI
  - i18n keys
  - empty and error states
  - deploy budget discipline (maximum 3 Vercel deploys, and local preview first)
- **Effort:** M.

---

## 8. RISKS + OPEN QUESTIONS

**Risks**

- **Fork upstream drift.** The `src/aerobrain/` boundary, `AEROBRAIN_PATCHES.md`, `verify-patches.sh`, and the quarterly re-vendor reduce this risk. We accept that we own the subtree forever.
- **Aerial over-cull.** SOR, ROR, and a tight crop can remove thin real structures. They can also remove sparse far corners. Mitigation: voxel occupancy is the backbone. SOR is off by default on aerial. There is no percentile crop. The fail-open guard for less than 40% stays. Every clean is reversible.
- **Training-vs-edit race.** Auto-Clean as a server job must join the same pending-lock as uploads (409). The revert must join it too.
- **`.splat` and SOG lossiness.** `.splat` drops SH>0, and SOG is lossy and final. Mitigation: keep `.ply` for each version for a re-clean at maximum fidelity. Edit masters in `.ply`, and ship in SOG or SPZ.
- **UX of edits on touch screens.** Brush selection with a finger is hard. We lean on Auto-Clean and the wizard as the primary mobile path. We do not pretend that manual selection works on a phone.
- **Performance on aerial scenes of 10M+ gaussians.** The worker sort, the budget, and LOD are essential and not optional. Test early on the largest real clip in the vault.

**Open questions**

1. **AI or semantic selection** (`SAGA`, `Gaussian Grouping`, or an identity channel that SAM distilled, to "select sky / ground / vegetation"). It is a large differentiator. But the training run must bake the identity channel **at train time** (an OpenSplat change). Or SAM must project it afterward through `cameras.json`. Is this a v2 stretch or a v3 track? Recommendation: in P3, scope a *lightweight* spike. The spike runs SAM on the source frames and projects the masks through `cameras.json`. Defer the full identity channel at train time to v3.
2. **Georef scale accuracy.** Is the drone RTK/PPK data in `cameras.json` reliable enough to derive `scene_to_meters` for a measure tool? Or do we need GCP input? This question blocks the measure tool and the safe geo-crop.
3. **Do we keep `.ply` as current** for edited clips (storage cost about 1.5GB/clip), or only in history? The answer changes how large the vault must be.
4. **One MultiOp or staged sub-ops as the shipped default.** Recommendation: an atomic MultiOp for the button and staged sub-ops for the wizard (§2.5). Make sure that this matches what users expect.
5. **Camera-controls library.** Do we tune the built-in controller of SuperSplat to our param targets, or swap in yomotsu/camera-controls? A swap gives a cleaner feel but needs a bigger fork seam. Recommendation: tune first.
