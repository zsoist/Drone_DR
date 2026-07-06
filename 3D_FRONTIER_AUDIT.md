# AeroBrain 3D Frontier Audit

Date: 2026-07-05 (última pasada: noche, post-Codex + hardening Claude)

Scope: ODM 3D modeling, DSM/point-cloud publishing, Gaussian splatting, Mac Mini M4 efficiency, vault integrity, browser delivery.

## Verdict

Current score: 9.7/10 for a local/free personal drone mapping stack.
(CPU-era ceiling reached. **Metal Toolchain 17F109 INSTALLED** — the 0.3 lands when the
orchestrated MPS build + first cinematic GPU splat complete tonight.)

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

## Closed This Pass 6 (2026-07-06 — round-trip Splat Lab + mesh clamp definitivo)

- **Round-trip de edición CERRADO**: `POST /api/splat_upload?cid=&name=` publica el splat
  editado (SuperSplat export) de forma versionada — TODAS las variantes previas del clip van
  a `splats/history/<cid>-<ts>.<ext>` (si quedara un .ksplat viejo, el dedupe lo preferiría
  sobre el archivo editado), regenera `.ksplat`, rebuild_index. Probado end-to-end con curl:
  archive ✓ publish ✓ ksplat ✓ manifest ✓.
- Splat Lab: botonera completa (Original/Subir editado/Compartir/Ver en 3D), subida por
  botón o drag&drop con overlay, estado aria-live, picker con aria-pressed. QA móvil 375x812
  (chips wrap, editor táctil vivo). Bug cazado en móvil: `display:grid` del drophint pisaba
  el atributo `hidden` — fix `[hidden]{display:none}`.
- **Mesh "destrozado", causa raíz definitiva**: geometría SANA (mediana 0.25m²/tri, 3% borde,
  0 no-manifold; top-down cercano se ve impecable). El destrozo es la vista RASANTE: una malla
  2.5D vista horizontal es un bosque de faldones texturizados. Clamp final `maxPolarAngle
  0.42π` (~75°, estándar Pix4D/DroneDeploy) en tresd+share. El clamp anterior (89°) aún
  permitía la vista degenerada.
- Doming/tilt leve del terreno queda documentado (rolling shutter de video sin GCPs) —
  palanca: `--rolling-shutter` de ODM o capturas oblicuas.

## Closed This Pass 5 (2026-07-06 — Splat Lab tab + mesh viewer fix)

- **Splat Lab**: pestaña propia en el sidebar (`splatlab.html`). Picker de splats del vault +
  SuperSplat embebido en iframe same-origin (CSP `frame-ancestors 'self'` SOLO para
  /supersplat/; el resto de la app sigue en 'none') + botón "Completo". Verificado vivo:
  editor con 15,625 splats dentro del shell. Bundles de SuperSplat sirven con 304.
- **Mesh "destrozado" DIAGNOSTICADO y arreglado**: no era la malla (geometría sana: 292k
  verts, spikes <1%) sino la CÁMARA — los viewers de malla/nube no clampeaban el ángulo
  polar ni minDistance: orbitar bajo el horizonte muestra el underside de la malla 2.5D
  (esquirlas + huecos) y el zoom atravesaba la geometría (near-clip). Fix en tresd+share:
  `maxPolarAngle = 0.495π` + `minDistance` proporcional (como ya hacía el viewer de splats).
- Conocido (no bloqueante): leve doming/tilt del terreno en reconstrucciones de video
  (rolling shutter sin GCPs). Palanca futura: `--rolling-shutter` de ODM si el perfil del
  Flip está en su DB, u oblicuos en la captura.

## Closed This Pass 4 (2026-07-05 midnight — Metal LIVE + SuperSplat post-pro)

- **First Metal/MPS GPU training running**: 15k cinematic splat of 0104 on the alta premium
  reconstruction. Evidence: 29% CPU (vs ~900% CPU-only), loss 0.095 @ step 560 (the old 2k
  CPU run FINISHED at 0.177), ~6 steps/s → 15k in ~40 min (CPU took 3.8h for 63% of 7k).
- MPS build compiled clean in ~1 min (only sign-compare warnings in metal kernels).
- **SuperSplat v2.28.1 self-hosted** at `/supersplat/` (MIT, built from source, gitignored
  clone in splat/supersplat, 23MB dist, Node 26). Loads our splats via `?load=` — verified
  live with 15,651 splats in scene, full toolbar, zero CSP violations. "Editar" button per
  splat in the 3D tab. Rebuild: `cd splat/supersplat && npm install && npm run build`.
- Post-pro flow: Editar → limpiar floaters/crop en SuperSplat → export .ply/.splat →
  (siguiente reto: endpoint de re-subida versionada para cerrar el round-trip).

## Closed This Pass 3 (2026-07-05 night — Metal ready + final hardening)

- **Metal Toolchain 17F109 installed** (no sudo). Gotcha documented: the first
  `-downloadComponent` served a STALE asset (17F42) that downloaded fully but stayed
  "uninstalled"; the retry fetched 17F109 and activated. Trivial `.metal` kernel compiles ✓.
- `build-mps/` wiped for a clean configure (the old cache was from the toolchain-missing era).
- Orchestrated chain live: 3D alta 0104 (219 premium frames, mesh 300k, COPC) → MPS build →
  worker reload → cinematic splat 15k GPU auto-enqueued (`auto_cinematic_0104.sh`, detached).
- `run_tracked` SQLite writes throttled (1/0.5s max vs per-line) — less disk churn and lock
  contention with `/api/jobs` during chatty ODM/OpenSplat runs; final flush keeps the tail.
- Splat viewer timeout now size-aware (45s + 3s/MB, cap 120s) in tresd + share — fixed 45s
  would spuriously kill 10-20MB cinematic loads on slow mobile links. Gate re-verified.
- `progressiveLoad` stays FALSE deliberately: the iOS Safari hang was reproduced with .splat
  streaming; 304 caching + explicit % progress + size-aware timeout is the safer frontier.
- `run_splat` now prefers the freshest reconstruction (`proj_<cid>` premium over legacy
  `proj0104`) — the cinematic splat trains on alta cameras/points, not medium.
- `alta` preset upgraded: `--mesh-size 300000` (ODM urban guidance; ultra rejected at 8.5x).

## Closed This Pass 2 (2026-07-05 late night — smoothness & hygiene)

- Conditional caching for heavy 3D binaries (`.ply .splat .ksplat .obj .mtl .laz .geojson .tif`):
  `Cache-Control: no-cache` + `Last-Modified` + `If-Modified-Since` → 304. URLs are unversioned
  and retraining rewrites the same name, so max-age would serve stale and no-store re-downloaded
  MBs each visit; 304 revalidation gives cache speed with zero staleness. Verified live
  (200+validator, 304, Range 206 intact, gzip sidecar intact, HTML still no-store).
- OpenSplat now trains under `taskpolicy -c utility` (QoS): a 4h CPU training no longer steals
  UI/render smoothness; taskpolicy execs (same pid) so job cancel still works. Smoke-tested.
- gzip sidecars for splat formats: measured 93-95% ratio on real files → NOT worth it. Decision
  recorded so nobody re-tries it.
- Stale data cleaned: odm/proj_0026 (379M, failed run) and odm/proj_0106 (740K stub) deleted —
  no published model referenced them; reproducible from raw. odm/ 12G → 11G.
- Production DB (Supabase) synced: 41 flights / 35 tracks / 33 AI / 3 models / 1 property —
  exact mirror of local manifest, nothing stale.
- Resource audit: 61% mem free, swap 3.6G (normal residual), Docker VM 9.77G (OrbStack fix
  holding), SSD 688Gi free. Viewers already capped (pixelRatio ≤ 2, dispose on switch).

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
