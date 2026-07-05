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
  ODM runs in Docker (-m 7g, --fast-orthophoto) fine on the M4 alongside OpenBrain.
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
