# Roadmap AeroBrain

## V1 — Ingesta + Post-Processing (pipeline local)
- [ ] Scaffold repo + vault
- [ ] ingest.py: SD → raw/ con manifest de checksums
- [ ] srt_parser.py: SRT → flight.json (1Hz + stats)
- [ ] process.py: proxy 1080p VT + thumbs + keyframes
- [ ] policy.py: tiers de procesamiento (decisión humana)
- [ ] Batch completo de la SD (40 clips)

## V1b — Flight Deck web
- [ ] Web app: mapa MapLibre + player sincronizado con ruta GPS
- [ ] Dominio Cloudflare + Pages + R2
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
