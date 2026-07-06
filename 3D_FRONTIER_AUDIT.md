# AeroBrain 3D Frontier Audit

Date: 2026-07-05 (última pasada: noche, post-Codex + hardening Claude)

Scope: ODM 3D modeling, DSM/point-cloud publishing, Gaussian splatting, Mac Mini M4 efficiency, vault integrity, browser delivery.

## Verdict

Current score: 9.6/10 for a local/free personal drone mapping stack.

The `.ksplat` gap is CLOSED: `pipeline/make_ksplat.mjs` converts `.splat`/`.ply` using the
same vendored GaussianSplats3D lib the viewer uses (no npm), the worker exports it after the
quality gate, both existing splats are converted, and the browser gate passed loading the
`.ksplat` end-to-end. The remaining gap to 10/10 is Metal/MPS training: the Metal Toolchain
download is running; once built, `choose_splat_backend()` picks it up automatically.

## What Is Now Solid

- ODM runs in a detached worker, not inside the web server.
- SQLite queue uses atomic claim, cancel, timeout, and orphan handling.
- ODM outputs publish DSM, DTM, ortho, hillshade, contours, point cloud, viewer mesh, share page assets.
- Ortho/DSM overlays use real alpha feathering and WebP for mobile load.
- Viewer mesh is re-centered to avoid float precision damage in Three.js.
- QA never stays empty: if ODM stats are missing, meta falls back to reconstruction metrics plus derived area/GSD from WGS84 footprint.
- Point clouds now publish `cloud_points` from the PLY header.
- Gaussian splat quality gate checks size, camera count, final loss, divergence, and incomplete training.
- Gaussian splat publish is now atomic: training writes to `splats/.training/<job>/`; only a passed quality gate can replace the public `.splat`.
- Gaussian splat backend selection is explicit and tested: `build-mps/opensplat` runs without `--cpu` when compiled with `GPU_RUNTIME=MPS`; otherwise the worker keeps the CPU fallback with `--cpu`.
- `pipeline/build_opensplat_mps.sh` is the repeatable local build path: it refuses to run during heavy jobs, downloads Apple's Metal Toolchain, builds `build-mps`, and validates `GPU_RUNTIME=MPS`.
- `pipeline/safe_restart.sh worker` now checks SQLite directly instead of trusting the web API, so a stale server response cannot kill a running 3D/splat job.
- `system.json` counts only visualizable splat assets (`.splat`, `.ksplat`, `.ply`), not sidecar metadata, and now records `clip_id` + `format` for each splat.
- `tresd.html` and `share.html` now select the best splat asset per project by format priority: `.ksplat` first, `.splat` second, `.ply` fallback.
- High-quality ODM preset now requests `--pc-copc`; when ODM emits a COPC LAZ, `tresd_publish.py` publishes it as `cloud.copc.laz` and both private/public 3D pages expose it as a GIS download. Existing models need reprocessing in `alta` to gain this asset.
- Browser gate is now executable by the worker before marking jobs done: `browser_gate.py model <cid>` verifies the public 3D share page and screenshot; `browser_gate.py splat <cid>` also opens the Gaussian tab and requires a rendered canvas.
- Browser QA on localhost loads `share.html` splat and `tresd.html` without console errors.
- `pipeline/audit_vault.py` reports 0 findings.

## Live Vault Evidence

Models:

- `DJI_20260315121003_0092_D`: QA partial, 35/42 cameras, 1.51 ha, 5.0 cm/px, 531,126 cloud points, DSM ok.
- `DJI_20260704160358_0104_D`: QA ok, 111/111 cameras, 1.21 px reprojection, 5.34 ha, 4.4 cm/px, 789,927 cloud points, DSM ok.
- `DJI_20260705171127_0099_D`: QA partial, 127/127 cameras, 6.19 ha, 3.7 cm/px, 787,988 cloud points, DSM ok.

Splats:

- `DJI_20260315121003_0092_D.splat`: 500,832 bytes, passed 2k CPU training, loss 0.176886, 42 cameras.
- `DJI_20260704160358_0104_D.splat`: 657,632 bytes, older preview splat.
- 7k urban attempt was killed by worker restart at 63.6%, so it did not complete. With atomic publish, future failed/killed runs will not corrupt the last good splat.

## Closed This Pass (2026-07-05 night)

- `.ksplat` export DONE: `make_ksplat.mjs` (Node + vendored viewer lib, import rewrite to
  `file://` + browser-global shims). Worker exports post-quality-gate, atomic tmp+replace,
  non-fatal on failure (`.splat` stays servible). Both live splats converted; browser gate
  verified the viewer loads the `.ksplat`.
- `system.json` splats now DEDUPE per clip (best format wins: `.ksplat` > `.splat` > `.ply`)
  so exporting `.ksplat` does not inflate UI counts. Smoke tests updated to the new contract.
- Browser gate hardened: exact-read WebSocket frames (short-read crash fixed), tolerant of
  "Execution context destroyed" during navigation, and the worker now passes `--timeout`
  explicitly (subprocess gets +30s margin).
- Worker startup now cleans orphaned `splats/.training/` stages (single-worker invariant).
- Vault organized: legacy loose `splats/cameras.json` renamed to
  `DJI_20260315121003_0092_D.cameras.json` (35 reconstructed cams of 42, timestamps match).

## Remaining Gap To 10/10

1. Complete Apple Metal Toolchain download (running in background) and run
   `pipeline/build_opensplat_mps.sh`, then process a 7k/15k splat through `build-mps/opensplat`.
2. Add browser-side streamed point-cloud viewing for COPC/EPT. COPC export/download is wired for future high-quality runs.
3. Add persistent QA history in the UI for browser-gate screenshots and failures.
4. Add capture recipe presets in the UI: nadir survey, oblique orbit, hybrid premium.
5. Add versioned model/splat history instead of one public file per clip.

## Metal Build Attempt

- Existing binary: `splat/OpenSplat/build/opensplat`, `GPU_RUNTIME=CPU`.
- System readiness: full Xcode selected, Apple M4 arm64, `xcrun --find metal` available.
- MPS configure: succeeded with `-DGPU_RUNTIME=MPS`.
- MPS compile: blocked by missing Apple Metal Toolchain component.
- `xcodebuild -downloadComponent MetalToolchain` started successfully but was cancelled at 42 MB / 687.9 MB because the network rate was too slow for this audit turn. Resume with `pipeline/build_opensplat_mps.sh`.

## Research Anchors

- OpenDroneMap outputs: point clouds, textured models, orthophotos, DSM/DTM.
- OpenDroneMap `pc-quality`: each quality step can multiply processing time roughly 4x, so Mac Mini presets must stay conservative.
- OpenDroneMap `pc-ept`: official EPT export exists for tiled point-cloud delivery.
- OpenSplat: Apple Metal is the serious path; CPU exists but is much slower.
- GaussianSplats3D: `.ksplat` is the fastest-loading viewer format.
