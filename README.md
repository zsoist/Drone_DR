# 🛸 AeroBrain — Personal Drone Intelligence Platform

**Live:** https://vuelos.metislab.work · **Repo:** https://github.com/zsoist/Drone_DR

Conectas la SD del DJI Flip / Neo 2 → el Mac Mini M4 procesa todo → tus vuelos
quedan navegables en la web: mapa satelital sincronizado al video, análisis AI
de escenas, y reels de viaje auto-editados.

## Arquitectura ($0/mes — decisión deliberada)

```
SD card ──ingest──▶ drone-vault (SSD 1TB)          Mac Mini M4
                      raw/ proxies/ frames/         · ffmpeg + VideoToolbox (HW)
                      tracks/ thumbs/ ai/           · Gemini vision + DeepSeek
                            │                       · python http.server :8790
                            ▼
              Cloudflare Tunnel (metislab)  ←── $0: sin R2, sin VPS, sin egress
                            │
                            ▼
                https://vuelos.metislab.work
```

**Por qué no R2/VPS:** el M4 ya es un server 24/7 con 759GB libres. Cloudflare
Tunnel sirve el vault directo — storage $0, egress $0, sin tarjeta. R2 queda
como opción futura para viajes ([sync_r2.py](pipeline/sync_r2.py) listo, cap 9GB free tier).

## Módulos

| Módulo | Qué hace |
|---|---|
| `pipeline/ingest.py` | SD → vault, rsync resumible + manifest de integridad |
| `pipeline/srt_parser.py` | Telemetría DJI SRT → GPS 1Hz + stats (dist, alt, bbox) |
| `pipeline/process.py` | Proxy 1080p H.264 (VideoToolbox) + keyframes + thumbs |
| `pipeline/policy.py` | Tiers de compute por clip (full/standard/skim) |
| `pipeline/build_index.py` | Agrega manifests → flights.json |
| `ai/router.py` | Lanes multi-LLM: Gemini (vision) · DeepSeek (texto) · OpenAI (fallback) |
| `ai/analyze.py` | Keyframes → resumen, tags, highlights, travel_score (~$0.002/clip) |
| `ai/reel.py` | Auto-editor: top highlights → reel 1080p o 9:16 vertical |
| `pipeline/worker.py` | Cola heavy 3D/splat: ODM, fallbacks, OpenSplat Metal/MPS, publish atómico |
| `pipeline/browser_gate.py` | QA real en Chrome headless (CDP stdlib) antes de dar un job 3D por done |
| `pipeline/browser_matrix.py` | QA multi-viewport de splats: share + workspace en mobile/iPad/desktop, macro zoom, overflow y screenshots |
| `pipeline/audit_splats.py` | Auditor de salud de splats: assets, current/history, metadata, jobs, warnings legacy |
| `pipeline/make_ksplat.mjs` | .splat/.ply → .ksplat con la lib vendoreada del viewer (sin npm) |
| `/supersplat/` | Editor SuperSplat (MIT) self-hosted — post-pro de splats: floaters, crop, export |
| `web/` | Flight Deck: galería + mapa MapLibre/Esri sincronizado al video |

## 3D pipeline actual

El camino premium de video DJI ahora es local y gratis:

1. `odm_prep.py` extrae frames con VideoToolbox, filtra blur/duplicados y escribe GPS EXIF desde SRT.
2. Worker encola ODM en SQLite y corre Docker separado del server web. Reiniciar la web no mata jobs.
3. Preset `alta` usa 3072px, `pc-quality high`, `feature-quality high`, DSM/DTM/ortho, nube densa y `--skip-3dmodel`. Para vuelos nadir, la malla full 3D es secundaria; nube, DSM, ortho y splat son el producto principal.
4. `tresd_publish.py` publica ortho/DSM/hillshade WebP con feather alpha, DSM binario para mediciones, nube PLY gzip, malla viewer re-centrada si existe, QA y `system.json` atómico.
5. OpenSplat entrena sobre poses ODM. Medium = 2k, Cinematic = 7k, Ultra = 15k bounded en Metal/MPS.
6. Publicación de splats es atómica: current se archiva en `splats/history/`, se genera `.ksplat`, se reconstruye índice y Chrome gate debe pasar antes de marcar `done`.
7. El viewer se verifica con matriz real: `share.html` y `tresd.html` en mobile, iPad y desktop deben renderizar canvas, exponer versiones, no desbordar horizontalmente y permitir macro zoom medible.

Evidencia viva 2026-07-07 (`DJI_20260706133809_0101_D`):

- ODM `alta`: 30/30 cámaras, DSM/DTM/ortho/nube, browser gate OK, 12.6 min.
- Medium splat: 2k, Metal/MPS, loss 0.0649658, 2.5 min.
- Cinematic splat: 7k, Metal/MPS, loss 0.0461415, archivado.
- Ultra splat: 15k bounded, Metal/MPS, 480,737 gaussianas, loss 0.0493478, `.ksplat` current, browser gate OK, matrix gate OK.

## Operación

```bash
python3 pipeline/ingest.py            # SD insertada → copiar todo
python3 pipeline/process.py --all     # procesar clips nuevos
python3 ai/analyze.py --all           # análisis AI de escenas
python3 pipeline/build_index.py       # refrescar flights.json (la web se actualiza sola)
python3 ai/reel.py --vertical         # reel para IG/TikTok
```

Servicios launchd: `com.aerobrain.web` (:8790) · `com.metislab.tunnel` (Cloudflare).

## Roadmap
V1 ✅ pipeline + Flight Deck live · V3 ✅ SHIPPED: fotogrametría ODM completa
(worker desacoplado + cola SQLite, presets rápido/estándar/alta, DSM + curvas +
mediciones de volumen/perfil/comparación multi-fecha, ortos feathered WebP,
malla re-centrada para viewer, página pública /share.html, gzip sidecars) +
gaussian splats ✅ (OpenSplat Metal/MPS, Medium/Cinematic/Ultra bounded, publish atómico,
.ksplat export, historial versionado, browser-gate en Chrome antes de marcar done,
browser-matrix mobile/iPad/desktop para share + workspace) ·
V2 detección YOLO/open-vocab pendiente ·
V4 travel mode + diarios AI · V5 watcher autónomo (SD in → todo solo).

---
*Solo para uso personal de Daniel. Código EN, contenido ES.*
