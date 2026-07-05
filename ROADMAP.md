# Roadmap AeroBrain

## V1 — Ingesta + Post-Processing (pipeline local)
- [x] Scaffold repo + vault ✅ 2026-07-05
- [x] ingest.py: SD → raw/ con manifest de checksums ✅ 2026-07-05 (55GB)
- [x] srt_parser.py: SRT → flight.json (1Hz + stats) ✅ 2026-07-05
- [x] process.py: proxy 1080p VT + thumbs + keyframes ✅ 2026-07-05
- [x] policy.py: tiers de procesamiento ✅ 2026-07-05 (defaults, umbrales ajustables)
- [ ] Batch completo de la SD (40 clips)

## V1b — Flight Deck web
- [x] Web app: mapa MapLibre + player sincronizado con ruta GPS ✅ 2026-07-05
- [x] LIVE: vuelos.metislab.work via Tunnel ($0, sin R2) ✅ 2026-07-05
- [ ] Galería de vuelos por fecha/lugar

## V2 — Detección
- [ ] YOLO/RF-DETR sobre keyframes (MPS)
- [ ] YOLO-World open-vocabulary search cross-vuelos
- [ ] Heatmaps de objetos sobre el mapa

## V3 — Mapping 3D
- [ ] WebODM ortomosaico (fotos JPG/DNG)
- [ ] Gaussian splatting MLX de un vuelo orbital (experimental)

## V4 — Travel mode
- [ ] Diario de viaje AI por lugar/fecha
- [ ] Auto-highlights (reels 30-60s)

## V5 — Autónomo
- [ ] Watcher launchd: SD insertada → pipeline completo sin tocar nada
