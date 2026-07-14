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

## V3 — Mapping 3D ✅ 2026-07-07 (ODM directo desde video, no WebODM)
- [x] ✅ ODM ortomosaico desde video (frames geotagged con SRT) + DSM/DTM + presets
- [x] ✅ Worker desacoplado + cola SQLite + progreso vivo + cancel + abort-on-nan
- [x] ✅ Visores nube/malla/splat + mediciones (distancia/área/volumen/perfil/comparar)
- [x] ✅ Página pública compartible + exports (GeoTIFF, GeoJSON, PLY, OBJ, SPLAT)
- [x] ✅ Fast 1K/Medium 2K local en Metal/CPU; Cinematic 7K, Ultra 15K, Ultra+ 20K,
  Frontier 30K y Grandmaster 40K en RTX CUDA estricto, con quality/browser gates
- [x] ✅ .ksplat export + historial versionado: current y history seleccionables en 3D/share/Splat Lab
- [x] Browser gate: jobs 3d/splat no se marcan done sin QA real en Chrome headless ✅ 2026-07-05
- [x] ✅ Alta ODM optimizado para video nadir: 3072px, dense estable, DSM/ortho/nube/splat como producto principal, sin malla full cara por defecto
- [ ] WebODM ortomosaico (fotos JPG/DNG) — opcional, ODM directo ya cubre video DJI
- [ ] Captura orbital/oblicua dedicada para splats de fachada y malla full 3D premium

### Validación CUDA vigente (2026-07-14)

- [x] 7K, 15K y 20K reales sobre 238 cámaras; 20K verificó retry CUDA `d1→d2` por OOM.
- [x] Gate OpenSfM de la reconstrucción acumulativa: 996/1.019 cámaras en el componente compartido,
  10/10 fuentes, merge `FULL`; recuperación densa post-write clasificada sin OOM.
- [ ] Publicar y verificar el paquete ODM completo de esa versión; hasta entonces no se encola splat.
- [ ] Frontier 30K CUDA FULL desde cero sobre la reconstrucción acumulativa, después del gate final ODM.
- [ ] Un Grandmaster 40K sobre esa misma versión validada, después de publicar y verificar 30K.

## V4 — Travel mode
- [ ] Diario de viaje AI por lugar/fecha
- [ ] Auto-highlights (reels 30-60s)

## V5 — Autónomo
- [ ] Watcher launchd: SD insertada → pipeline completo sin tocar nada
