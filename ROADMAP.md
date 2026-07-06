# Roadmap AeroBrain

## V1 — Ingesta + Post-Processing (pipeline local)
- [x] Scaffold repo + vault ✅ 2026-07-05
- [x] ingest.py: SD → raw/ con manifest de checksums ✅ 2026-07-05 (55GB)
- [x] srt_parser.py: SRT → flight.json (1Hz + stats) ✅ 2026-07-05
- [x] process.py: proxy 1080p VT + thumbs + keyframes ✅ 2026-07-05
- [x] policy.py: tiers de procesamiento ✅ 2026-07-05 (defaults, umbrales ajustables)
- [x] Batch completo de la SD ✅ 2026-07-05 (41 vuelos en flights.json)

## V1b — Flight Deck web
- [x] Web app: mapa MapLibre + player sincronizado con ruta GPS ✅ 2026-07-05
- [x] LIVE: vuelos.metislab.work via Tunnel ($0, sin R2) ✅ 2026-07-05
- [x] Galería de vuelos con filtros por lugar/fecha ✅ 2026-07-05

## V2 — Detección
- [ ] YOLO/RF-DETR sobre keyframes (MPS)
- [ ] YOLO-World open-vocabulary search cross-vuelos
- [ ] Heatmaps de objetos sobre el mapa

## V3 — Mapping 3D ✅ 2026-07-05 (superado: ODM directo desde video, no WebODM)
- [x] ✅ ODM ortomosaico desde video (frames geotagged con SRT) + DSM/DTM + presets
- [x] ✅ Worker desacoplado + cola SQLite + progreso vivo + cancel + abort-on-nan
- [x] ✅ Visores nube/malla/splat + mediciones (distancia/área/volumen/perfil/comparar)
- [x] ✅ Página pública compartible + exports (GeoTIFF, GeoJSON, PLY, OBJ, SPLAT)
- [ ] OpenSplat Metal/GPU (CPU estable pero lento; ver 3D_PROCESSING_AUDIT.md)
- [x] .ksplat export ✅ 2026-07-05 (make_ksplat.mjs con la lib vendoreada del viewer; worker lo exporta post-quality-gate) · COPC cableado en preset alta (pendiente 1er run)
- [x] Browser gate: jobs 3d/splat no se marcan done sin QA real en Chrome headless ✅ 2026-07-05
- [ ] WebODM ortomosaico (fotos JPG/DNG) — ya no necesario, ODM directo lo cubre
- [ ] Gaussian splatting MLX de un vuelo orbital (experimental)

## V4 — Travel mode
- [ ] Diario de viaje AI por lugar/fecha
- [ ] Auto-highlights (reels 30-60s)

## V5 — Autónomo
- [ ] Watcher launchd: SD insertada → pipeline completo sin tocar nada
