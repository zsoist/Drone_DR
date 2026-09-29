# AeroBrain

Daily-driver pitfalls. Sistema actual: `docs/ARCHITECTURE.md`; procedimientos: `docs/RUNBOOKS.md`; mapa de scripts: `pipeline/README.md`.
Legacy Mac (OpenSplat/MPS/xcodebuild): `docs/archive/LEGACY_MAC_TRAINER.md`.

## Pitfalls
- **Auth obligatorio**: producción entrega sólo `login.html`, sus assets locales,
  `whoami` y el health mínimo sin sesión. Todo HTML/data/media/share exige la cookie
  de Daniel; `X-Token` y query tokens están retirados. El bypass dev existe sólo en
  loopback con Host exacto y sin headers de proxy. Nunca amplíes `PUBLIC_RESOURCES`
  para arreglar un 401.
- **Sesiones**: 24 h absolutas, cookie `__Host-ab_session`; SQLite guarda digest,
  no bearer token. Toda mutación de navegador pasa el gate CSRF central. La
  automatización aprobada usa únicamente el loopback estricto del Mac.
- **Borde privado**: `edge/wrangler.toml` mantiene el Worker sólo en
  `vuelos.metislab.work/*`, sin preview/`workers.dev`. La ruta completa es obligatoria:
  Cloudflare quita `Cookie` después del Worker y el origin recibe una sesión firmada
  HMAC con ventana de 30 s. Nunca reenvíes headers aportados por el cliente ni guardes
  `AEROBRAIN_EDGE_AUTH_KEY` en el repo. Tras cambios corre
  `node --test edge/test_private_data_worker.mjs` y despliega con Wrangler.
- **Versionado web**: TODO batch de edits en web/ termina con `python3 pipeline/bump_web_version.py` (sube ?v=N en html+js+vendor y regenera .gz). Editar módulos sin bump = navegador/edge mezcla módulos viejos y nuevos (incidente Safari 2026-07-12: terrain.splatMask undefined).

- NUNCA encadenar `test_smoke.py | tail && git commit`: el pipe se traga el exit
  code y el `&&` comitea con tests rojos (pasó 2026-07-11). Correr el smoke SIN
  pipe, o con `set -o pipefail`, antes de cualquier commit.
- macOS ships **openrsync**, not GNU rsync: `--info=progress2` fails with exit 1.
  Use plain `rsync -a`; monitor progress with `du -sh` on the destination.
- DJI SD cards also carry a `HYPERLAPSE/` folder next to `DCIM/DJI_001/` — ingest
  copies all of DCIM; don't assume DJI_001 is the only source of media.
- wrangler (OAuth) refuses writes in non-interactive shells: wrap with `script -q /dev/null …` for a pseudo-TTY, and export CLOUDFLARE_ACCOUNT_ID.
- R2 requires one-time dashboard activation (error 10042) + card on file — AVOIDED by design: media is served from the vault via Cloudflare Tunnel ($0).
- `cloudflared tunnel route dns` uses the default cert zone (danielreyes.work); for metislab.work pass TUNNEL_ORIGIN_CERT=~/.cloudflared/zone-certs/metislab.work.pem. (A stray CNAME vuelos.metislab.work.danielreyes.work was created by the first attempt — harmless, delete in dash when convenient.)
- Media is served by `aerobrain_server.py` (stdlib) behind the tunnel; HTTP Range is implemented there, so no Caddy swap is needed.
- After a structural refactor (moving code between modules, dispatch tables, renames), smoke checks that assert source literals or AST shapes will fail. Update them to the new invariant; do not revert the refactor to satisfy them.
- Tests must never write into the real vault: point `AEROBRAIN_JOB_LOG_DIR`, `AEROBRAIN_ERRLOG` and `AEROBRAIN_VAULT` at a temp dir before importing anything that touches them.
- ODM photogrammetry from video frames REQUIRES GPS EXIF geotags (from the SRT track
  via pipeline/odm_prep.py) — without them the orthophoto comes out 67x66px garbage.
  Current best default for DJI video is preset `alta`: 3072px frame prep, `pc-quality high`,
  `feature-quality high`, DSM/DTM/ortho/nube and `--skip-3dmodel`. Full mesh is expensive
  and weak for nadir-only video; splat + cloud + DSM are the premium outputs.
- GeoTIFF de ODM: ffmpeg lo lee NEGRO (tiled TIFF). Convertir SIEMPRE con GDAL dentro
  del contenedor: docker run --entrypoint bash opendronemap/odm -c "python3 -c 'from osgeo import gdal; gdal.Translate(...)'"
- ODM `alta` verificado en `DJI_20260706133809_0101_D` (30/30 cámaras, DSM/DTM, ortho feathered, browser gate OK).
  Si OpenMVS falla, el worker cae a dense estable o 25D con QA explícito, nunca en silencio. (Los ~12.6 min medidos
  fueron en el M4: ruta **legacy** `AEROBRAIN_COMPUTE=local`; hoy corre en el PC CUDA.)
- gdal_array (ReadAsArray) está ROTO en la imagen ODM (numpy mismatch). Para mediciones:
  exportar DSM como binario ENVI en tresd_publish y leer con numpy en el HOST (memmap).
- Trainer local Mac (OpenSplat/MPS): **legacy, roto e inusado** (sólo `AEROBRAIN_COMPUTE=local`). Todo el detalle, las reglas
  post-parche, memoria MPS y xcodebuild están en `docs/archive/LEGACY_MAC_TRAINER.md`. El canary-splat semanal está retirado.
- Docker corre en ORBSTACK, **bajo demanda** desde 2026-09-28 (`docker_ondemand.py`): no arranca
  con la sesión y se apaga tras 5 min sin uso. CUALQUIER comando `docker` lo enciende — las
  sondas miran `orb status` primero. Tope 8 GB: el Mac ya sólo hace post-proceso; ODM corre en
  el PC. (Histórico: con la VM en 3.9 GB, ODM local daba OOM 137 en mvs_texturing.)
- El PC GPU es `ssh pc` → 192.168.1.5 (MAC BC:5F:F4:45:7E:B8). Si "no responde", verificar la IP
  con `arp -a` antes de asumir que está apagado: el 2026-09-28 `~/.ssh/config` apuntaba a .3 (otro
  equipo) y el carril GPU estaba roto sin que nada lo reportara.
- Jobs pesados: worker desacoplado (com.aerobrain.worker) — restart del server web
  NO los mata (probado en vivo). Restart del WORKER mata sus procesos huérfanos
  antes de re-reclamar (fix de codex).
- (2026-07-05) NUNCA `launchctl kickstart -k com.aerobrain.worker` sin revisar `/api/jobs` antes: mató un splat 7k al 63% (3.8h de CPU). El jobstore marca huérfanos como error al reiniciar el worker. drawtext/HAS_DRAWTEXT solo requiere reiniciar com.aerobrain.web (run_edit vive en el server, no en el worker). Usar pipeline/safe_restart.sh.
- GaussianSplats3D vendoreado importa "/vendor/three.module.js" (URL de navegador): para
  usarlo en Node (make_ksplat.mjs) reescribe ese import a file:// en una copia temporal y
  shimea window/self/document/navigator ANTES del import. Sin npm.
- Splat profiles come only from `pipeline/splat_presets.py`: Fast 1K and Medium 2K may use
  Apple Metal/CPU only with `AEROBRAIN_COMPUTE=local` (legacy; default PC-only forces CUDA); Cinematic 7K, Ultra 15K, Ultra+ 20K, Frontier 30K and Grandmaster
  40K require NVIDIA CUDA. Strict CUDA never changes tier/backend. `resolution=auto` tries
  `d1`, then the same tier at `d2` only after classified CUDA OOM. SH remains degree 0 because
  the public `.splat`→SOG path cannot retain higher coefficients. Legacy custom requests
  above 2K are also CUDA-only; 500–2K stays inside the local envelope. Publish is atomic.
- CUDA is a disposable accelerator; the Mac owns SQLite, vault, immutable request,
  provenance, publish, browser gate and current/history swap. Never publish directly from PC.
- Stable scenes are versioned retraining, not online model mutation. A video is integrated
  only when per-source SfM registration says so. Preserve failed attempts/reasons in
  `source_evidence`; do not erase a source or call it integrated because the global ratio passes.
- Coverage diameters (100/200/400/600/1000 m) are output extents, not capture altitudes.
  `ready` requires real world dimensions; altitude bands are separate capture evidence.
- var(--x) NO resuelve en ATRIBUTOS de presentación SVG en WebKit (fill="var(--x)" cae a
  negro en iPhone/iPad). Colores temeables de SVG inline SIEMPRE por clase CSS.
- Texturas de malla ODM (44-57 páginas de 4096²) = 2.5-3.8GB DESCOMPRIMIDOS en GPU:
  Chrome desktop aguanta pero Safari/iPhone evictan texturas EN SILENCIO -> parches
  negros ("malla destrozada", sin error en consola). El visor debe usar el set
  vt_*.jpg con presupuesto (<=600MB; make_viewer_textures en tresd_publish). El
  detalle fino vive en la ortofoto, no en la malla.
