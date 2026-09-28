# AeroBrain — Personal Drone Intelligence Platform

"Conecto el dron, subo, y analiza." Convierte cada vuelo del DJI Flip / Neo 2
en inteligencia: mapas, detección de objetos, escenas 3D y diarios de viaje.

## Arquitectura
- **Mac Mini M4** = control plane y servidor: ingesta SD, proxies ffmpeg/VideoToolbox, web y
  video, API/SQLite/vault/publicación/gates y reels. Post-proceso GDAL/PDAL/OpenSfM en OrbStack
  **sólo bajo demanda** (apagado en reposo). Desde 2026-09-28 no entrena ni corre ODM.
- **PC RTX 4060 Ti + WSL2** = fuerza de trabajo: todo ODM (CUDA, strict) y todo splat
  (Nerfstudio/gsplat, 1K–40K). Nunca es autoridad de publicación; su scratch expira solo
  (`pc_janitor.py`). `AEROBRAIN_COMPUTE=local` reactiva los caminos legacy del Mac.
- **Cloudflare** = túnel + dominio (vuelos.metislab.work → localhost:8790) + el Worker de borde OBLIGATORIO en `edge/` (private-data-v1: gate de auth y puente HMAC hacia el origen; sin él no hay acceso). Sin Pages ni R2: el media se sirve del SSD local con HTTP Range + gzip sidecars — $0/mes real. (Actualizado 2026-07-05; ver 3D_PROCESSING_AUDIT.md)
- **drone-vault** (`/Volumes/SSD/drone-vault/`) = datos, fuera del repo

## 3D contract
- ODM runs from video frames, not WebODM SaaS: SRT → EXIF GPS → OpenSfM/OpenMVS →
  DSM/DTM/ortho/cloud/mesh. Por política (`compute_policy.py`) todo ODM va al nodo CUDA en modo strict.
- Preset `alta` is the stable local video route and may use `--skip-3dmodel` for nadir.
  Remote CUDA Ultra is the full-product route for large orbital/oblique scene versions.
- Gaussian splats are first-class outputs. Todos corren en CUDA (política PC-only);
  7K–40K son CUDA estrictos, con `d1→d2` sólo tras OOM clasificado y sin fallback al Mac.
  Publicación atómica, SOG/legacy formats, history versions, checksums y Chrome browser gate.
- Una escena estable conserva versiones `recon_<hash>` inmutables. Una fuente sólo cuenta como
  integrada si pertenece al componente compartido elegido y supera el gate por-fuente; no se
  auto-entrena ningún splat antes de auditar el `reconstruction.json` final.
- Done jobs must have real artifacts and QA. No empty QA, no stale artifact links, no current/history path confusion.

## Principios
1. Originales bit-perfect, nunca re-encodear (checksums en manifest)
2. Proxies 1080p por hardware (hevc_videotoolbox) para web
3. Keyframes JPG baratos como input de AI vision
4. Telemetría SRT → flight.json 1Hz (GPS, altitud, exposición)
5. Tiers de procesamiento por clip — compute donde vale la pena
6. LLM lanes: ai/router.py: vision = Gemini Flash (frames JPG), texto = DeepSeek, fallback = OpenAI (todas con API key paga); nunca OAuth headless

## Non-goals (v1)
- No control de vuelo en vivo / DJI SDK
- No multi-usuario ni SaaS
- No VPS: Mac Mini + Cloudflare Tunnel
- No fine-tuning de modelos
