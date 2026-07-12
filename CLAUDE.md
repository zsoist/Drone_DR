# AeroBrain

## Pitfalls
- **Versionado web**: TODO batch de edits en web/ termina con `python3 pipeline/bump_web_version.py` (sube ?v=N en html+js+vendor y regenera .gz). Editar módulos sin bump = navegador/edge mezcla módulos viejos y nuevos (incidente Safari 2026-07-12: terrain.splatMask undefined).

- GATE POST-PARCHE DEL TRAINER (P0 11-jul): tras CUALQUIER rebuild/patch de
  OpenSplat, correr un cinematic conocido (proj_...133809_0101_D) ANTES de
  declarar el binario bueno. "Aditivo por intención del diff" no es evidencia —
  el comportamiento se mide. Un fast NO basta (densificación mínima no expone
  overheads por-gaussiana).
- El trainer se invoca SIEMPRE con env explícito mínimo (splat_eval._minimal_env)
  — la shell de Claude Code lleva MallocNanoZone=0 y los nohup lo heredan.
- NUNCA encadenar `test_smoke.py | tail && git commit`: el pipe se traga el exit
  code y el `&&` comitea con tests rojos (pasó 2026-07-11). Correr el smoke SIN
  pipe, o con `set -o pipefail`, antes de cualquier commit.
- `ps` RSS subestima ~20× la memoria de procesos MPS/Metal (medido: RSS 489 MiB
  vs phys_footprint 10 GB en el mismo opensplat). Para memoria real usar
  `footprint -f bytes <pid>` (phys_footprint_peak; es lo que taskpolicy -m vigila).
- macOS ships **openrsync**, not GNU rsync: `--info=progress2` fails with exit 1.
  Use plain `rsync -a`; monitor progress with `du -sh` on the destination.
- DJI SD cards also carry a `HYPERLAPSE/` folder next to `DCIM/DJI_001/` — ingest
  copies all of DCIM; don't assume DJI_001 is the only source of media.
- wrangler (OAuth) refuses writes in non-interactive shells: wrap with `script -q /dev/null …` for a pseudo-TTY, and export CLOUDFLARE_ACCOUNT_ID.
- R2 requires one-time dashboard activation (error 10042) + card on file — AVOIDED by design: media is served from the vault via Cloudflare Tunnel ($0).
- `cloudflared tunnel route dns` uses the default cert zone (danielreyes.work); for metislab.work pass TUNNEL_ORIGIN_CERT=~/.cloudflared/zone-certs/metislab.work.pem. (A stray CNAME vuelos.metislab.work.danielreyes.work was created by the first attempt — harmless, delete in dash when convenient.)
- Media serving = python http.server behind the tunnel; if video seeking ever feels slow, swap to Caddy (proper Range support).
- ODM photogrammetry from video frames REQUIRES GPS EXIF geotags (from the SRT track
  via pipeline/odm_prep.py) — without them the orthophoto comes out 67x66px garbage.
  Current best default for DJI video is preset `alta`: 3072px frame prep, `pc-quality high`,
  `feature-quality high`, DSM/DTM/ortho/nube and `--skip-3dmodel`. Full mesh is expensive
  and weak for nadir-only video; splat + cloud + DSM are the premium outputs.
- GeoTIFF de ODM: ffmpeg lo lee NEGRO (tiled TIFF). Convertir SIEMPRE con GDAL dentro
  del contenedor: docker run --entrypoint bash opendronemap/odm -c "python3 -c 'from osgeo import gdal; gdal.Translate(...)'"
- ODM `alta` has been verified on `DJI_20260706133809_0101_D`: 30/30 cameras, DSM/DTM,
  feathered ortho, 717k cloud points, browser gate OK, ~12.6 min on this M4. If OpenMVS
  fails, worker falls back through stable dense or 25D publish with explicit QA, never silent.
- gdal_array (ReadAsArray) está ROTO en la imagen ODM (numpy mismatch). Para mediciones:
  exportar DSM como binario ENVI en tresd_publish y leer con numpy en el HOST (memmap).
- OpenSplat en macOS: production path is `splat/OpenSplat/build-mps/opensplat` with
  `GPU_RUNTIME=MPS`; CPU build is fallback only. Worker auto-selects Metal/MPS if available.
  `image_list.txt` from OpenSfM carries container paths; worker rewrites `/datasets/code` to
  the host project path before training.
- Docker corre en ORBSTACK y su VM tenía 3.9GB totales — el -m 7g del contenedor ODM
  era ilusorio (OOM exit 137 en mvs_texturing con texturas 8192). Fix aplicado:
  `orb config set memory_mib 10240` + `orb stop/start` → VM 9.77GB. Si ODM vuelve a
  dar 137, revisar `docker info | grep "Total Memory"` ANTES de bajar calidad.
- Jobs pesados: worker desacoplado (com.aerobrain.worker) — restart del server web
  NO los mata (probado en vivo). Restart del WORKER mata sus procesos huérfanos
  antes de re-reclamar (fix de codex).
- (2026-07-05) NUNCA `launchctl kickstart -k com.aerobrain.worker` sin revisar `/api/jobs` antes: mató un splat 7k al 63% (3.8h de CPU). El jobstore marca huérfanos como error al reiniciar el worker. drawtext/HAS_DRAWTEXT solo requiere reiniciar com.aerobrain.web (run_edit vive en el server, no en el worker). Usar pipeline/safe_restart.sh.
- GaussianSplats3D vendoreado importa "/vendor/three.module.js" (URL de navegador): para
  usarlo en Node (make_ksplat.mjs) reescribe ese import a file:// en una copia temporal y
  shimea window/self/document/navigator ANTES del import. Sin npm.
- Splat presets are explicit and versioned:
  - Medium: 2k iters, interactive QA.
  - Cinematic: 7k iters, shareable photoreal. Can be better loss than Ultra on some scenes.
  - Ultra: 15k iters, Metal/MPS, bounded densification (`--refine-every 200`,
    `--densify-grad-thresh 0.0005`, `--stop-screen-size-at 2500`, future runs checkpoint with
    `--save-every 1000`). This prevents 1M+ gaussian runaway on M4/16GB and keeps mobile assets
    sane. Publish is atomic and previous splats move to `splats/history/`.
- var(--x) NO resuelve en ATRIBUTOS de presentación SVG en WebKit (fill="var(--x)" cae a
  negro en iPhone/iPad). Colores temeables de SVG inline SIEMPRE por clase CSS.
- xcodebuild -downloadComponent MetalToolchain corre como usuario normal (sin sudo);
  ~688MB — lanzarlo en background y dejar que termine, no cancelarlo por lento.
- MobileAsset gotcha: xcodebuild -downloadComponent puede bajar un asset STALE de una
  versión vieja de Xcode (baja completo y queda "Status: uninstalled" sin error). Cura:
  reintentar el mismo comando — el segundo intento trae la versión correcta y activa.
- Texturas de malla ODM (44-57 páginas de 4096²) = 2.5-3.8GB DESCOMPRIMIDOS en GPU:
  Chrome desktop aguanta pero Safari/iPhone evictan texturas EN SILENCIO -> parches
  negros ("malla destrozada", sin error en consola). El visor debe usar el set
  vt_*.jpg con presupuesto (<=600MB; make_viewer_textures en tresd_publish). El
  detalle fino vive en la ortofoto, no en la malla.
