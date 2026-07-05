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
| `web/` | Flight Deck: galería + mapa MapLibre/Esri sincronizado al video |

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
gaussian splats (OpenSplat CPU estable tras fix de divergencia SH; Metal/GPU
pendiente para calidad cinemática) · V2 detección YOLO/open-vocab pendiente ·
V4 travel mode + diarios AI · V5 watcher autónomo (SD in → todo solo).

---
*Solo para uso personal de Daniel. Código EN, contenido ES.*
