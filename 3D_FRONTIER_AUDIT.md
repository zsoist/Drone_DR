# AeroBrain 3D Frontier Audit

Date: 2026-07-05 (última pasada: noche, post-Codex + hardening Claude)

Scope: ODM 3D modeling, DSM/point-cloud publishing, Gaussian splatting, Mac Mini M4 efficiency, vault integrity, browser delivery.

## Current Addendum — 2026-07-07

Score: 10/10 for the current local/free video-to-3D target.

The old Metal gap is closed. The live 0101 acceptance run proves the whole chain:

- ODM `alta` completed on `DJI_20260706133809_0101_D`: 30/30 cameras, DSM/DTM/ortho/cloud, browser gate OK, 12.6 min.
- OpenSplat Medium completed: 2k, Metal/MPS, loss 0.0649658, `.ksplat`, browser gate OK.
- OpenSplat Cinematic completed: 7k, Metal/MPS, loss 0.0461415, archived in `splats/history/`.
- OpenSplat Ultra completed: 15k, Metal/MPS, bounded densification, 480,737 gaussianas, loss 0.0493478, current `.ksplat`, browser gate OK.
- `system.json` exposes current Ultra plus archived Cinematic/Medium, and private/share/Splat Lab links use manifest `path`, so history assets load from `splats/history/`.
- `pipeline/audit_vault.py` reports 0 findings.

Important product truth: Ultra is now optimized for bounded asset size and stability on M4/16GB, not blindly lowest loss. Cinematic can beat Ultra on loss in some scenes because Ultra caps gaussian growth to avoid runaway 1M+ gaussian jobs and mobile-hostile files. The UI should present this as "Ultra bounded / stable premium", not "always lowest loss".

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

## Closed This Pass 11 (2026-07-06 — audit adversarial de 8 pasadas: 25 fixes + ODM extra/ultra)

- **Bug hunt de 8 lentes** (render/pipeline/storage/cache/wiring/stale/concurrency/smoothness),
  45 raw → 25 confirmados adversarialmente. Aplicados TODOS:
  · mesh/cloud currency guard (token) — el fix de splat no cubría malla/nube; cambiar de
    proyecto a mitad de carga fugaba contexto + montaba el modelo viejo en el box nuevo.
  · **model_delete resucitaba el splat borrado**: dejaba `.ksplat` huérfano y best_splats lo
    rankea sobre `.splat` → re-listado. Ahora borra el set completo + history/.
  · meta.json atómico (3 sitios) + build_index tolera meta corrupto — un write parcial ya no
    vacía TODA la UI. flights/system.json también atómicos.
  · splat_upload: temp único + guard 409 contra entrenamiento activo del mismo clip.
  · imágenes bajo models/ revalidan (304) — vt*/ortho cambian en re-procesado.
  · **render ON-DEMAND**: idle = 0 GPU (antes rAF dibujaba cada frame siempre); wake() +
    contador de 90 frames capta decodes async. history/ podado a 6 por clip.
  · make_viewer_textures decode-once (era N×3 decodes de 4096²).
- **Presets ODM Extra/Ultra** con auto-fallback: extra (mesh 600k/octree 12, pc-quality high),
  ultra (pc-quality ultra/mesh 800k, ~8.5x). Si la VM OrbStack no da la memoria, el worker
  reintenta solo (ultra→extra→alta). UI 'Procesar' con 5 tarjetas. meta graba el preset REAL.
- Experimentos en vuelo: cinemático 15k de 0104 (Metal, ~65%), cinemático de Casa 4 Julio (0099)
  encolado, orquestador ultra 0099 (ODM ultra→cinemático) difiriendo hasta drenar la cola.

## Closed This Pass 10 (2026-07-06 — 18 fixes del bug-hunt adversarial de 5 pasadas)

- makeScene teardown completo (geometría+materiales+texturas) + forceContextLoss +
  ResizeObserver.disconnect (verificado: 1 canvas vivo tras ciclo agresivo).
- splat: re-entrancy guard, track-antes-del-await, dispose en timeout/fallo, currency guard,
  dispose().catch (el vendored lanza NotFoundError async que try/catch no atrapa).
- tier-swap: dispose-una-vez (foto/relieve comparten Texture), conserva textura si falta en el
  tier, sin HEAD (TOCTOU), 'bajo' nunca degrada a 4096. frameObject: piso maxDim (sin cámara NaN).

## Closed This Pass 9 (2026-07-06 — 4 tiers de render + Ultra Metal SSAA)

- **Switch de calidad de 4 niveles** en malla (tresd + share): Rápido(1024/pr1.5) ·
  HD(2048/pr2) · Extra(3072/pr2.5) · Ultra(4096/pr3). extra/ultra gated a desktop
  (coarse pointer o <900px → solo Rápido/HD, evita eviction en Safari/iPhone).
- **Ultra explota el M4 (10-core, Metal 4, 16GB)**: texturas 4096 originales (geo.mtl,
  sin regenerar) + SUPERSAMPLING (pixelRatio 3 → buffer 3258px en viewport 1400) = SSAA
  por fuerza bruta. Verificado en vivo: 57 tex 4096 cargadas, 0 pérdida de contexto WebGL,
  malla nítida. GPU de texturas: 0092 2.5GB, 0104 3.6GB, 0099 2.8GB — trivial en 16GB.
- Tier-swap NO re-descarga el OBJ ni reparsea: swapea maps por nombre de material + ajusta
  pixelRatio. old.map.dispose() libera la VRAM del tier anterior.
- Publisher genera bajo/alto/extra (vtl_/vth_/vtx_); ultra reusa el geo.mtl 4096 publicado.
- Nota de frontera: WebGL ya corre sobre Metal en macOS (ANGLE→Metal / Safari nativo). El
  siguiente salto sería WebGPU (three.js WebGPURenderer = Metal 4 directo) pero la lib
  vendoreada es WebGL — anotado, no reescrito.

## Closed This Pass 8 (2026-07-06 — mesh "destrozado": CAUSA RAÍZ REAL = memoria GPU de texturas)

- El destrozo con sesión fresca y ángulo válido en Safari/iPhone NO era cámara ni geometría:
  el modelo alta trae 57 páginas de textura de 4096² = **3.8GB descomprimidos en GPU**.
  Chrome (desktop, 24GB unificada) los sube; Safari/iPhone los evictan EN SILENCIO →
  páginas negras intercaladas = "esquirlas". Forense previo confirmó geometría sana
  (F/V y % de borde MEJORES que los modelos que sí se veían bien).
- Fix: `make_viewer_textures()` en tresd_publish — set `vt_*.jpg` (JPEG q82) reescalado
  hasta que páginas × lado² × 4B ≤ 600MB (2048→1536→1024) + `odm_textured_model_viewer.mtl`.
  Viewers (tresd+share) prefieren el viewer.mtl con fallback. Resultados: 0104 3648→513MB,
  0099 2816→396MB, 0092 2496→351MB. Los downloads/exports siguen usando las 4096 originales.
- Aplicado a los 3 modelos publicados sin re-procesar ODM. Gate + visual verificados.
- El clamp de cámara (0.42π) de la pasada 6 sigue siendo correcto — era necesario pero
  no suficiente; los dos bugs se solapaban en el mismo síntoma.

## Closed This Pass 7 (2026-07-06 — Splat Lab móvil + fullscreen + eficiencia verificada)

- **Móvil re-armado**: capa CSS dedicada (`web/supersplat-mobile.css`) inyectada al iframe
  same-origin cuando el viewport es angosto — toolbar inferior full-width scrolleable sobre
  el safe-area del iPhone, right-toolbar/view-cube compactos, targets táctiles >=38px.
  Descubrimiento: SuperSplat YA trae colapso responsive nativo del panel izquierdo
  (body.collapsed + botón ">") — no se duplicó, se dejó el nativo. QA vivo 375x812.
- **Salida de pantalla completa**: "Completo" ahora es fullscreen CSS (fixed inset:0) con
  botón "✕ Salir" flotante + Esc — el Fullscreen API de iOS solo funciona en <video>, por
  eso CSS. Ciclo entrar/salir verificado en móvil.
- Nav móvil: 8 items desbordaban la bottom bar (Splat Lab quedaba cortado) — ahora
  scrolleable-x sin barra visible.
- **Eficiencia idle VERIFICADA en la fuente**: SuperSplat usa render on-demand
  (`app.autoRender = false`, scene.ts:128 — solo dibuja con renderNextFrame en cambios).
  Idle GPU ~= 0 por diseño; el rAF de fondo lo throttlea el browser en tabs ocultos.
  Carga: bundles con 304 (revalidación), dist 23MB solo se baja una vez.

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
