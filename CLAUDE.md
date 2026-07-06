# AeroBrain

## Pitfalls
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
  ODM runs in Docker (-m 7g, FULL pipeline con presets pc-quality low/medium/high) fine on the M4 alongside OpenBrain. OrbStack necesita memory_mib>=10240.
- GeoTIFF de ODM: ffmpeg lo lee NEGRO (tiled TIFF). Convertir SIEMPRE con GDAL dentro
  del contenedor: docker run --entrypoint bash opendronemap/odm -c "python3 -c 'from osgeo import gdal; gdal.Translate(...)'"
- ODM full pipeline (con openmvs densify) sí produce ortho+mesh reales; --fast-orthophoto
  desde video frames da sparse inservible. --rerun-from openmvs reutiliza las cámaras.
- gdal_array (ReadAsArray) está ROTO en la imagen ODM (numpy mismatch). Para mediciones:
  exportar DSM como binario ENVI en tresd_publish y leer con numpy en el HOST (memmap).
- OpenSplat en macOS: LibTorch >=2.7 (2.5 choca con Clang moderno por is_arithmetic),
  Metal necesita 'xcodebuild -downloadComponent MetalToolchain' (requiere first-launch/sudo)
  → build CPU con -DGPU_RUNTIME=CPU y correr con --cpu. image_list.txt de opensfm trae
  rutas del contenedor: sed a rutas host antes de entrenar.
- Docker corre en ORBSTACK y su VM tenía 3.9GB totales — el -m 7g del contenedor ODM
  era ilusorio (OOM exit 137 en mvs_texturing con texturas 8192). Fix aplicado:
  `orb config set memory_mib 10240` + `orb stop/start` → VM 9.77GB. Si ODM vuelve a
  dar 137, revisar `docker info | grep "Total Memory"` ANTES de bajar calidad.
- Jobs pesados: worker desacoplado (com.aerobrain.worker) — restart del server web
  NO los mata (probado en vivo). Restart del WORKER mata sus procesos huérfanos
  antes de re-reclamar (fix de codex).
- (2026-07-05) NUNCA `launchctl kickstart -k com.aerobrain.worker` sin revisar `/api/jobs` antes: mató un splat 7k al 63% (3.8h de CPU). El jobstore marca huérfanos como error al reiniciar el worker. drawtext/HAS_DRAWTEXT solo requiere reiniciar com.aerobrain.web (run_edit vive en el server, no en el worker). Usar pipeline/safe_restart.sh.
