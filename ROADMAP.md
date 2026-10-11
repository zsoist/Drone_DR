# AeroBrain roadmap

## V1: Ingest and post-processing (local pipeline)
- [x] Scaffold of the repo and the vault ✅ 2026-07-05
- [x] `ingest.py`: copy the SD card to `raw/` with a manifest of checksums ✅ 2026-07-05 (55GB)
- [x] `srt_parser.py`: convert SRT to `flight.json` (1Hz and stats) ✅ 2026-07-05
- [x] `process.py`: 1080p VT proxy, thumbnails and keyframes ✅ 2026-07-05
- [x] `policy.py`: tiers for each clip ✅ 2026-07-05 (defaults, thresholds you can change)
- [x] Full batch of the SD card ✅ 2026-07-05 (41 flights in `flights.json` on that date, 122 today)

## V1b: Flight Deck web
- [x] Web app: MapLibre map and a player that follows the GPS route ✅ 2026-07-05
- [x] LIVE: vuelos.metislab.work through the Tunnel ($0, no R2) ✅ 2026-07-05
- [x] Flight gallery with filters by place and date ✅ 2026-07-05
- [x] Cinematic Home V2: true data, seven modules, progressive GLB, bounded star transition,
  and QA on desktop, tablet and iPhone ✅ 2026-07-15

## V2: Detection
- [ ] YOLO/RF-DETR on keyframes (MPS)
- [ ] YOLO-World open-vocabulary search across flights
- [ ] Heatmaps of objects on the map

## V3: 3D mapping ✅ 2026-07-07 (ODM direct from video, not WebODM)
- [x] ✅ ODM orthomosaic from video (frames with SRT geotags), DSM/DTM and presets
- [x] ✅ Decoupled worker, SQLite queue, live progress, cancel, and `abort-on-nan`
- [x] ✅ Viewers for cloud, mesh and splat, and measurements (distance, area, volume, profile, compare)
- [x] ✅ Viewer by link inside the private session, and exports (GeoTIFF, GeoJSON, PLY, OBJ, SPLAT)
- [x] ✅ Fast 1K and Medium 2K (Metal/CPU on the Mac only with `AEROBRAIN_COMPUTE=local`, legacy). Today they also run on the PC.
  Cinematic 7K, Ultra 15K, Ultra+ 20K, Frontier 30K and Grandmaster 40K run in strict RTX CUDA, with quality and browser gates
- [x] ✅ `.ksplat` export and versioned history: you can select current and history in 3D, share and Splat Lab
- [x] ✅ (2026-09-28) PC-only policy: all ODM and splat jobs run on the PC CUDA node.
  OrbStack runs on demand (0 when idle), the scratch space of the PC expires by itself, and the transfer bridge is on D:
- [x] Browser gate: a 3d or splat job is done only after a real QA in headless Chrome ✅ 2026-07-05
- [x] ✅ ODM `alta` tuned for nadir video: 3072px, stable dense, DSM/ortho/cloud/splat as the main product, and no costly full mesh by default
- [ ] WebODM orthomosaic (JPG/DNG photos). Optional, because direct ODM already covers DJI video
- [ ] Dedicated orbital and oblique capture for facade splats and for a premium full 3D mesh

### CUDA check (2026-07-14)

- [x] Real runs of 7K, 15K, 20K, Frontier 30K and Grandmaster 40K on RTX CUDA. The OpenSfM gate passed for the
  cumulative reconstruction `recon_60b23208db` (10/10 sources, `FULL` merge), and the project published the ODM package with browser QA.
  Figures and times: [README, "Measured evidence"](README.md#measured-evidence-single-record).
- Status note: the **active** version of `scene_64f22e89f2` is `recon_b2fbe03239` (checked on 2026-09-28
  in `manifest/scenes/scene_64f22e89f2.json`). `recon_60b23208db` is `ready` but is not active.

## V4: Travel mode
- [ ] AI travel diary by place and date
- [ ] Auto-highlights (reels of 30-60s)

## V5: Autonomous
- [ ] launchd watcher: when you insert an SD card, the full pipeline runs with no action from you
