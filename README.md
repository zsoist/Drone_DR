# 🛸 AeroBrain — Personal Drone Intelligence Platform

**Live:** https://vuelos.metislab.work · **Repo:** https://github.com/zsoist/Drone_DR

Conectas la SD del DJI Flip / Neo 2 → el Mac Mini M4 procesa todo → tus vuelos
quedan navegables en la web: mapa satelital sincronizado al video, análisis AI
de escenas, y reels de viaje auto-editados.

## Arquitectura ($0/mes — decisión deliberada)

```
SD card ──ingest──▶ drone-vault (SSD 1TB)          Mac Mini M4 · control plane
                      raw/ proxies/ frames/         · ffmpeg + VideoToolbox (HW)
                      tracks/ thumbs/ ai/           · Gemini vision + DeepSeek
                            │                       · web/API/SQLite/publish/gates
                            │
                            ├── LAN/SSH ──▶ PC RTX 4060 Ti · WSL2
                            │              · ODM depthmaps CUDA
                            │              · gsplat 7K/15K/20K/30K/40K
                            ▼
              Cloudflare Worker /*          ←── sesión HMAC + bypass de cache privado
                            │
              Cloudflare Tunnel (metislab)  ←── $0: sin R2, sin VPS, sin egress
                            │
                            ▼
                https://vuelos.metislab.work
```

**Por qué no R2/VPS:** el M4 ya es un server 24/7 con ~598 GiB libres
(medido 2026-07-14). Cloudflare
Tunnel sirve el vault directo — storage $0, egress $0, sin tarjeta. R2 queda
como opción futura para viajes ([sync_r2.py](pipeline/sync_r2.py) listo, cap 9GB free tier).

## Acceso privado

AeroBrain tiene una sola cuenta, `daniel`. El servidor exige autenticación antes
de entregar cualquier página, API, video, foto, mapa, modelo, splat o enlace de
share. La sesión es absoluta de 24 horas, se muestra en hora de Colombia y usa una
cookie `__Host-` Secure/HttpOnly/SameSite=Strict. El password se verifica con
scrypt; SQLite guarda sólo el hash de cada token de sesión. Codex y Claude Code
conservan acceso de desarrollo únicamente por loopback estricto en
`http://127.0.0.1:8790`. Supabase funciona como índice sólo de servidor:
`anon`/`authenticated` no tienen acceso al esquema, tablas ni RPCs, y el Mac usa
exclusivamente su secret key. Detalles y verificación:
[docs/AUTH_SECURITY.md](docs/AUTH_SECURITY.md).

El Worker versionado en `edge/` protege todo el host antes del cache de Cloudflare.
Convierte la cookie de Daniel en un sobre HMAC efímero para el origin, elimina
headers falsificables y conserva streaming Range. Una entrada CDN antigua no puede
saltarse el gate ni una regla de transformación puede romper la sesión.

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
| `pipeline/worker.py` | Cola heavy única: ODM, Metal local 1K/2K, CUDA remoto 7K–40K, publicación y gates |
| `pipeline/scenes.py` | Sitios estables, versiones inmutables y aporte registrado por video |
| `pipeline/scene_manifest.py` | Contrato Mundo/Flightverse con cobertura verificada 100/200/400/600/1000 m |
| `pipeline/external_probe.py` | SLO público: health + home + video Range desde GitHub Actions cada 15 min |
| `pipeline/browser_gate.py` | QA real en Chrome headless (CDP stdlib) antes de dar un job 3D por done |
| `pipeline/browser_matrix.py` | QA multi-viewport de splats: share + workspace en mobile/iPad/desktop, macro zoom, overflow y screenshots |
| `pipeline/audit_splats.py` | Auditor de salud de splats: assets, current/history, metadata, jobs, warnings legacy |
| `pipeline/make_ksplat.mjs` | .splat/.ply → .ksplat con la lib vendoreada del viewer (sin npm) |
| `/supersplat/` | Editor SuperSplat (MIT) self-hosted — post-pro de splats: floaters, crop, export |
| `web/` | Flight Deck V2: Home cinematográfico, galería, mapa MapLibre/Esri y telemetría sincronizada |
| `web/home-data.js` | Vista veraz del Home: vuelos, jobs, bóveda y siete módulos con fallos independientes |

## 3D pipeline actual

El control, el vault y la publicación son locales; el cómputo premium usa el PC RTX de la LAN:

1. `odm_prep.py` extrae frames con VideoToolbox, filtra blur/duplicados y escribe GPS EXIF desde SRT.
2. Worker encola ODM en SQLite y corre Docker separado del server web. Reiniciar la web no mata jobs.
3. Preset `alta` usa 3072px, `pc-quality high`, `feature-quality high`, DSM/DTM/ortho y nube densa. La ruta remota CUDA puede producir malla completa para capturas orbitales/oblicuas; para nadir, DSM, ortho, nube y splat siguen siendo el producto principal.
4. `tresd_publish.py` publica ortho/DSM/hillshade WebP con feather alpha, DSM binario para mediciones, nube PLY gzip, malla viewer re-centrada si existe, QA y `system.json` atómico.
5. El contrato único de splat define Fast 1K y Medium 2K para Apple Metal/CUDA. Cinematic 7K, Ultra 15K, Ultra+ 20K, Frontier 30K y Grandmaster 40K son NVIDIA CUDA estrictos: no bajan de tier ni caen al Mac. `auto` prueba resolución completa y sólo reintenta `-d2` tras OOM CUDA clasificado.
6. Publicación de splats es atómica: current se archiva en `splats/history/`, se genera SOG, se reconstruye el índice y el gate de navegador debe pasar antes de marcar `done`.
7. El viewer se verifica con matriz real: `share.html` y `tresd.html` en mobile, iPad y desktop deben renderizar canvas, exponer versiones, no desbordar horizontalmente y permitir macro zoom medible.

Evidencia viva 2026-07-14 (`DJI_20260712135736_0117_D`, RTX 4060 Ti):

- ODM `alta`: 238/238 cámaras, DSM/DTM/ortho/nube/malla, browser gate OK.
- Cinematic 7K CUDA: 435.5 s end-to-end, 238 cámaras, `-d2`.
- Ultra 15K CUDA: 928.4 s end-to-end, 649,150 gaussianas fuente, SOG 8.3 MB, browser gate OK.
- Ultra+ 20K CUDA: 1,215.4 s end-to-end; `d1` OOM clasificado → `d2` exitoso,
  649,314 gaussianas, pico 1,698 MiB VRAM y `params_hash` persistido.
- Frontier 30K CUDA FULL sobre la versión acumulativa: 5.339,4 s de entrenamiento y 5.714,6 s
  end-to-end, 3.236.419 gaussianas, pico 7.755 MiB VRAM, SOG 37,1 MB, publicación atómica y
  browser QA.
- Grandmaster 40K CUDA FULL sobre la misma versión: 7.500,3 s de entrenamiento y 7.877,2 s
  end-to-end, 3.067.353 gaussianas a la salida del trainer y 2.881.394 tras de-halo, pico 7.730 MiB
  VRAM, SOG 34.903.178 bytes, publicación atómica y browser QA. Completó en un único intento `d1`,
  sin OOM, retry ni fallback.
- La versión acumulativa `recon_60b23208db` (1.019 entradas, 10 fuentes) ya pasó el gate OpenSfM:
  componente compartido de 996 cámaras, 951.994 puntos y aporte válido de 10/10 fuentes. OpenMVS
  produjo 46.731.480 puntos densos; un `rc=139` post-write sin OOM fue recuperado validando
  37.473.907 puntos filtrados y reanudando desde `odm_filterpoints`. El paquete final cerró con
  37.386.157 puntos densos filtrados, ortofoto/DSM/DTM de 30.539×33.664, nube publicada de
  795.450 puntos y malla de 744.416 vértices. Los assets requeridos pasaron publicación atómica y
  browser QA; la versión fue promovida explícitamente y el gate de splat quedó abierto.

## Sitios que mejoran con el tiempo

`scene_<id>` identifica un lugar real. Cada mejora crea un `recon_<hash>` reproducible con
la lista completa de videos/fotos; la versión activa no se sobrescribe. OpenSfM registra el
aporte por fuente (`submitted`, `registered`, ratio, motivo) y una fusión `PARTIAL` no se
promueve ni auto-entrena. Fallar registro conserva la evidencia y el motivo: no equivale a
integrarla. `scene.v2.json` y `site.lod.json` exponen productos circulares/cuadrados de
100/200/400/600/1000 m, marcando `ready` sólo cuando la extensión real del ODM alcanza el
diámetro. Estudio 3D y Mundo consumen la misma versión activa y el mismo contrato.

## Operación

```bash
python3 pipeline/ingest.py            # SD insertada → copiar todo
python3 pipeline/process.py --all     # procesar clips nuevos
python3 ai/analyze.py --all           # análisis AI de escenas
python3 pipeline/build_index.py       # refrescar flights.json (la web se actualiza sola)
python3 ai/reel.py --vertical         # reel para IG/TikTok
python3 pipeline/ops_status.py        # auditoría 24/7: servicios, health, streaming, recursos
python3 pipeline/external_probe.py    # mismo probe público que ejecuta GitHub Actions
```

Servicios launchd: `com.aerobrain.web` (:8790) · `com.aerobrain.worker`
(cola 3D/splat) · `com.metislab.tunnel` (Cloudflare) ·
`com.aerobrain.watchdog` (health check local/public). Sin viewer, heavy compute usa
10 cores/MPS; durante reproducción ODM baja a 7 cores y OpenSplat a background,
restaurándose tras 45 s. Runbook:
[docs/OPERATIONS.md](docs/OPERATIONS.md).

El Home de producción usa un renderer híbrido: carga contenido y métricas antes del GLB, conserva
un fallback estático si WebGL o el modelo fallan, pausa animación fuera de pantalla y limita el
efecto de navegación a un canvas con presupuesto por viewport. En datos parciales muestra
`Sin datos`; nunca convierte un fetch fallido en un cero inventado.

## Documentación

El índice [docs/README.md](docs/README.md) clasifica cada documento como contrato actual,
evidencia medida, runbook o snapshot histórico. Empieza por `SPEC.md` para producto,
`docs/SPLAT_PIPELINE.md` para el trainer y `docs/MULTISOURCE_3D.md` para escenas acumulativas.

## Roadmap
V1 ✅ pipeline + Flight Deck live · V3 ✅ SHIPPED: fotogrametría ODM completa
(worker desacoplado + cola SQLite, presets rápido/estándar/alta, DSM + curvas +
mediciones de volumen/perfil/comparación multi-fecha, ortos feathered WebP,
malla re-centrada para viewer, share autenticado, gzip sidecars) +
gaussian splats ✅ (Metal 1K/2K + RTX CUDA estricto 7K–40K, SOG, historial versionado,
campañas CUDA con dry-run, preflight y publish atómico, browser-gate antes de `done`,
browser-matrix mobile/iPad/desktop para share + workspace) ·
V2 detección YOLO/open-vocab pendiente ·
V4 travel mode + diarios AI · V5 watcher autónomo (SD in → todo solo).

---
*Solo para uso personal de Daniel. Código EN, contenido ES.*
