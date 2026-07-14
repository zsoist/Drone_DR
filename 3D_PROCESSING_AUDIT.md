# AeroBrain 3D Processing Audit

> **[2026-07-05 · SUPERSEDED]** Auditoría histórica (point-in-time). El estado vivo está en
> [docs/SPLAT_PIPELINE.md](docs/SPLAT_PIPELINE.md). De los hallazgos de aquí ya se resolvieron:
> P1 splat-not-premium (publish atómico + quality gate + ksplat; Metal/MPS productivo), P1 QA vacío
> (fallback área/GSD + browser gate), P2 stale dirs (limpieza .training + odm huérfanos),
> P2 HEAD miente tamaño (espejado), P2 storage frontier (COPC en preset alta), P2 docs stale
> (README/ROADMAP/SPEC/CLAUDE/AGENTS actualizados el 2026-07-07).


Date: 2026-07-05  
Scope: video-to-ODM, Gaussian splatting, storage, Mac Mini M4 efficiency, stale data, docs, and route/viewer integration.  
Evidence: local repo, live vault, jobs DB, launchd services, browser QA, and current upstream docs.

## Score

Current: 8.3/10 for local drone mapping.

The ODM side is now serious: detached worker, real queue, DSM, ortho feathering, WebP overlays, compressed PLY/OBJ transfer, share page, volume/compare tests, and Mac-local zero-monthly-cost serving. The Gaussian splat side is not 10/10 yet. It is still CPU-bound, unstable on current scenes, outputs only `.splat`, and the only published splat is a small 642 KB file.

Target: 10/10 means:

- ODM jobs are resumable, audited, and never publish partial/stale products.
- Every done model has QA, DSM, valid assets, and a browser screenshot gate.
- Splats train on Apple GPU/Metal, export optimized `.ksplat` or equivalent, and have quality gates based on real visual/metric checks.
- Storage has lifecycle cleanup and no stale job/artifact mismatch.
- Docs match actual architecture.

## What Is Working

- Worker split is correct. `pipeline/aerobrain_server.py` only enqueues `/api/odm` and `/api/splat`; `pipeline/worker.py` runs heavy jobs. Server restart does not kill ODM.
- SQLite queue is good enough for this local single-user system. `jobs.claim()` uses `BEGIN IMMEDIATE`, so two workers cannot claim the same queued job.
- ODM presets exist: `rapido`, `estandar`, `alta`, with different `pc-quality`, `feature-quality`, orthophoto resolution, DEM resolution, and timeouts.
- Video frame prep uses VideoToolbox via ffmpeg, frame extraction at 0.5 FPS, 2688 px width, and EXIF GPS from DJI SRT. This is the correct minimum for video-to-ODM.
- Browser assets are much better than the first prototype:
  - `ortho.webp` overlays with alpha feather.
  - DSM color and hillshade also feathered.
  - PLY and OBJ sidecar gzip works on GET.
  - Curves are lazy-loaded.
- Tests pass: `pipeline/test_smoke.py` currently reports 42 checks passing.
- Static serving blocks path traversal with `relative_to()`.
- Browser QA on localhost:
  - `tresd.html` opens with no console errors or failed requests.
  - `share.html?m=DJI_20260315121003_0092_D` and `share.html?m=DJI_20260704160358_0104_D` render a canvas and load model assets.

## Live State

Machine:

- Apple M4, 16 GB RAM, 10 CPU cores, 4 performance + 6 efficiency.
- macOS 26.5.1.
- OrbStack memory: 10240 MiB, Docker reports about 9.77 GiB usable.
- SSD: 699 GiB free on `/Volumes/SSD`.
- Vault: 60 GB total, 54 GB raw video, 427 MB published models, 4.0 GB ODM working dirs, 688 KB splats.

Active processing:

- Running job: `splat-1783282857611`, `DJI_20260315121003_0092_D`, CPU OpenSplat, 2000 iterations.
- Process observed at roughly 128-168% CPU and about 505 MB RSS.
- Log says step 705 / 2000, 35%.
- DB `progress` still says `0.1`, so UI progress is stale.

Published models:

- `DJI_20260704160358_0104_D`
  - DSM exists.
  - QA exists: 111/111 cameras, 1.21 px reprojection error, 4.4 cm/px, 5.34 ha.
  - Cloud: 49.5 MB raw PLY, 8.7 MB gzip transfer.
  - Textures: 49.
- `DJI_20260315121003_0092_D`
  - DSM exists.
  - Cloud: 33 MB raw PLY, 4.8 MB gzip transfer.
  - Textures: 39.
  - QA is `{}`. This model was marked done without ODM QA metrics.

Published splats:

- `DJI_20260704160358_0104_D.splat`, 657,632 bytes.
- `cameras.json`, 42 KB.
- No `.ksplat`.
- No completed splat for `0092` yet.

## Findings

### P1: Gaussian splatting is not premium yet

Evidence:

- Current published splat is only 642 KB.
- 0104 7k jobs diverged to `nan` and failed.
- 0092 2k first run diverged at step 1004.
- Current 0092 retry is still running on CPU.

Why it matters:

The UI says gaussian splats are the Polycam-like future. The current output is still experimental. A premium experience needs stable high-quality output, not just a button that sometimes trains.

Required fix:

- Finish Apple GPU/Metal training path.
- Treat CPU as fallback and cap CPU quality to preview.
- Add a deterministic retry strategy and record seed/config.
- Export optimized viewer format, preferably `.ksplat` for GaussianSplats3D.
- Add visual QA screenshot gate before publishing a splat.

### P1: Live splat progress is wrong for the active job

Evidence:

- Current job log: `Step 705 ... (35%)`.
- Jobs DB: `progress = 0.1`.
- UI displayed 10% while log showed about 29-35%.

Likely cause:

Source files were modified after the running worker process started, or the active worker does not have the latest `run_tracked(progress_re=...)` path loaded. Do not restart mid-job unless intentionally cancelling.

Required fix:

- After current splat ends or is cancelled, `launchctl kickstart -k gui/501/com.aerobrain.worker`.
- Add a regression test that feeds OpenSplat log lines into progress parsing and asserts DB progress updates.
- Add `/api/jobs` derived progress fallback for splat jobs from the log tail, so UI can recover even if worker progress is stale.

### P1: 3D model can be marked done with empty QA

Evidence:

- `DJI_20260315121003_0092_D/meta.json` has `"qa": {}`.
- Job `3d-1783280749858` is `done`.
- `tresd_publish.py` only fills QA if `opensfm/stats/stats.json` exists.

Why it matters:

The user sees a done model but cannot judge camera reconstruction count, reprojection error, GSD, area, or quality. This is exactly where bad capture data hides.

Required fix:

- Make QA a required publish gate for `estandar` and `alta`.
- If stats are missing, publish with explicit `qa.status = "missing"` and UI warning.
- Parse fallback metrics from reconstruction files if stats.json is absent.

### P1: Viewer uses georeferenced OBJ only

Evidence:

- `tresd_publish.py` copies `odm_textured_model_geo*` only.
- OpenDroneMap produces both local `odm_textured_model.obj` and georeferenced `odm_textured_model_geo.obj` when available.

Why it matters:

Georeferenced mesh vertices live at large UTM/world coordinates. Three.js can show precision artifacts when geometry is far from origin. The viewer should use local centered mesh; GIS/download should keep geo mesh.

Required fix:

- Publish both `model_viewer.obj` from local ODM mesh and `model_geo.obj` for GIS.
- Viewer loads local mesh.
- Downloads expose both.
- If local mesh is missing, rebase geometry vertices during publish, not at render time.

### P2: Jobs DB contains stale done artifacts after model deletion/purge

Evidence:

- `3d-1783273795650` is `done` with artifact `models/DJI_20260704155816_0102_D/meta.json`.
- That artifact no longer exists.

Why it matters:

Old job cards can link to dead assets. This is not active model corruption, but it is stale route/data mismatch.

Required fix:

- On model delete, update matching jobs to `artifact=NULL` or `detail='modelo eliminado'`.
- `/api/jobs` should add `artifact_exists` for done jobs.
- UI should hide "Abrir" links when artifact is missing.

### P2: Empty/stale model directories and temp files remain

Evidence:

- `/Volumes/SSD/drone-vault/models/DJI_20251206172659_0026_D/` exists without `meta.json`.
- `DJI_20260704160358_0104_D/.contours_small.tif` remains in a published model directory.
- `.DS_Store` files exist in vault.

Required fix:

- Add `pipeline/audit_vault.py --fix-stale` to report and optionally remove empty model dirs, temp publish files, and stale job artifacts.
- Publisher should write to temp dir then atomically replace, and clean dotfiles/temp products.

### P2: Static HEAD lies about compressed asset size

Evidence:

- GET with `Accept-Encoding: gzip` serves `cloud.ply` with `Content-Encoding: gzip` and `Content-Length: 8,698,641`.
- HEAD returns uncompressed `Content-Length: 49,534,730`.

Impact:

Browser works. Monitoring and future preload logic may overestimate transfer size.

Required fix:

- Make `do_HEAD()` mirror gzip sidecar behavior when `Accept-Encoding: gzip` is present and no Range is requested.

### P2: ODM frame sampling is fixed, not scene-aware

Evidence:

- `odm_prep.py` uses `FPS = 0.5`, `WIDTH = 2688` for every clip.

Why it matters:

Video-to-photogrammetry quality depends on overlap, blur, altitude, speed, yaw changes, and capture shape. Fixed 1 frame / 2 seconds is simple and efficient, but not frontier.

Required fix:

- Add preflight score:
  - blur score per candidate frame,
  - distance between frames from SRT,
  - yaw/heading change,
  - overlap estimate,
  - altitude stability,
  - GPS lock quality.
- Select frames adaptively, not by time only.
- Presets should tune frame count, width, ODM options, and splat iterations together.

### P2: Storage format is not frontier for large point clouds

Evidence:

- Browser uses raw PLY, with gzip sidecar.
- ODM docs support COPC/EPT outputs.

Impact:

PLY is okay for current 33-50 MB clouds. It does not scale gracefully to many projects, tiled web viewing, or progressive geospatial workflows.

Required fix:

- Add optional COPC or EPT publish target for point clouds.
- Keep PLY for simple Three.js viewer.
- Use COPC/EPT for GIS, future streaming, and large models.

### P2: Docs are stale

Evidence:

- [Historical, resolved 2026-07-07] README still said V3 was future "WebODM + gaussian splatting".
- ROADMAP still says V3 unchecked.
- SPEC still mentions Cloudflare Pages + R2, while actual architecture is local server + tunnel.
- CLAUDE still mentions `--fast-orthophoto` in one pitfall while current worker runs full ODM.

Required fix:

- Update README/ROADMAP/SPEC/CLAUDE to reflect:
  - worker queue,
  - ODM presets,
  - DSM/volume/compare,
  - share page,
  - splat current limitations,
  - OrbStack 10 GB requirement,
  - no R2 by default.

### P3: Public share page has generic load error

Evidence:

- `share.js` catches loader failures with "No se pudo cargar esta vista."

Impact:

Good enough for personal use, poor for debugging. If a texture or OBJ is missing, the user gets no file name or action.

Required fix:

- Surface failing asset type and model id in UI.
- Keep technical details collapsed.

## Mac Mini M4 Efficiency Verdict

Good for:

- ingest, ffmpeg proxies, frame extraction via VideoToolbox,
- local ODM at `rapido` and `estandar`,
- serving vault over Cloudflare Tunnel,
- single heavy job at a time,
- local testing and personal archive.

Tight but acceptable:

- ODM `alta` with Docker memory capped around 7 GB, OrbStack at 10 GB.
- Mesh texturing and dense point cloud stages.

Not frontier yet:

- CPU Gaussian splatting. OpenSplat upstream says CPU works but is around 100x slower than GPU. Your live process is using about 1.3-1.7 CPU cores and 505 MB RSS, which is stable but slow and still divergent on current scenes.

Correct operating policy:

- Keep one heavy job at a time.
- Keep Docker/OrbStack at 10 GB.
- Run ODM in Docker.
- Move splat training to Apple GPU/Metal before calling it premium.
- Do not use the Mac as a multi-user production 3D render farm. It is excellent as a personal local processing appliance.

## 10/10 Plan

### Phase 1: Seal data integrity

- Add `pipeline/audit_vault.py`:
  - verify every model in `system.json`,
  - verify every model dir with `meta.json`,
  - verify every done job artifact,
  - detect empty model dirs,
  - detect temp files and tiny splats,
  - optional `--fix`.
- Add atomic publishing:
  - publish to `models/<cid>.tmp`,
  - validate assets,
  - swap into `models/<cid>`,
  - rebuild index.
- Add QA required gate:
  - done only if QA is present or explicitly `qa.status="missing"`.

### Phase 2: Make ODM output professional

- Viewer mesh:
  - local centered OBJ for browser,
  - geo OBJ for GIS/download.
- Add capture preflight:
  - blur,
  - overlap,
  - GPS lock,
  - altitude/speed consistency,
  - enough cameras.
- Add GCP/RTK hooks:
  - optional GCP file,
  - RMSE report,
  - vertical datum note.
- Add COPC/EPT export for large point clouds.

### Phase 3: Make Gaussian splatting real

- Build OpenSplat Metal/Apple GPU path.
- Keep CPU only for preview.
- Add stable configs:
  - preview: 1k CPU allowed,
  - cinematic: 7k GPU,
  - ultra: 15k-30k GPU overnight.
- Add retry and quality:
  - record seed/config,
  - abort on nan,
  - retry with safe config,
  - require min cameras, min size, final loss threshold, no nan tail.
- Export optimized viewer format:
  - `.ksplat` for GaussianSplats3D web.
  - keep `.splat` download for compatibility.
- Add splat visual QA:
  - Playwright screenshot,
  - canvas nonblank pixel check,
  - mobile viewport check,
  - load time threshold.

### Phase 4: UI and share quality

- Replace generic viewer errors with model/asset-specific diagnostics.
- Add "current model health" panel:
  - ortho OK,
  - DSM OK,
  - mesh OK,
  - point cloud OK,
  - splat OK or pending/error.
- In jobs UI, derive splat progress from log when DB progress is stale.
- Add "needs worker restart" banner when source mtime is newer than worker start time.

### Phase 5: Docs and runbooks

- Update README, ROADMAP, SPEC, CLAUDE, AGENTS.
- Add `docs/3d-runbook.md`:
  - process 3D,
  - cancel,
  - restart worker safely,
  - inspect OrbStack memory,
  - audit vault,
  - rebuild index.
- Add `docs/capture-guide.md`:
  - nadir mapping,
  - orbit/oblique for mesh/splat,
  - overlap, altitude, sunlight, blur, speed.

## Sources Checked

- OpenSplat GitHub: CPU works but GPU is fastest, CPU is about 100x slower. https://github.com/pierotofy/opensplat
- GaussianSplats3D GitHub: `.ksplat` gives fastest loading because it matches internal splat data format. https://github.com/mkkellogg/GaussianSplats3D
- OpenDroneMap options: COPC/EPT point cloud outputs and processing flags. https://docs.opendronemap.org/arguments/
- OpenDroneMap outputs: textured mesh local and georeferenced outputs. https://docs.opendronemap.org/outputs/
- Original 3D Gaussian Splatting paper: real-time high-quality rendering from calibrated sparse points. https://arxiv.org/abs/2308.04079
