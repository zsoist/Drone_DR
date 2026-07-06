# AeroBrain 3D Frontier Audit

Date: 2026-07-05

Scope: ODM 3D modeling, DSM/point-cloud publishing, Gaussian splatting, Mac Mini M4 efficiency, vault integrity, browser delivery.

## Verdict

Current score: 9.2/10 for a local/free personal drone mapping stack.

Not 10/10 yet because the premium Gaussian path is prepared for Metal/MPS but the Mac still needs the Xcode Metal Toolchain component installed before `build-mps/opensplat` can compile. The pipeline now auto-selects a Metal build when present and falls back to the known-good CPU binary otherwise. It still exports `.splat`, not a web-optimized `.ksplat`. OpenSplat documents Apple Metal as the right path for serious local training, while CPU mode is a fallback. GaussianSplats3D documents `.ksplat` as its fastest-loading format.

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

## Remaining Gap To 10/10

1. Complete Apple Metal Toolchain download and run `pipeline/build_opensplat_mps.sh`, then process a 7k/15k splat through `build-mps/opensplat`.
2. Export `.ksplat` after `.splat` training. Viewer preference is already wired and browser-verified.
3. Add optional ODM `--pc-ept` or `--pc-copc` path for large point-cloud streaming/GIS.
4. Add browser screenshot gate for every published model/splat before marking the job done.
5. Add capture recipe presets in the UI: nadir survey, oblique orbit, hybrid premium.
6. Add versioned model/splat history instead of one public file per clip.

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
