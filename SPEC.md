# AeroBrain — Personal Drone Intelligence Platform

"Conecto el dron, subo, y analiza." Convierte cada vuelo del DJI Flip / Neo 2
en inteligencia: mapas, detección de objetos, escenas 3D y diarios de viaje.

## Arquitectura
- **Mac Mini M4** = compute: ingesta SD, ffmpeg/VideoToolbox, ODM Docker, OpenSplat Metal/MPS, YOLO (MPS)
- **Cloudflare** = SOLO túnel + dominio (vuelos.metislab.work → localhost:8790). Sin Pages ni R2: el media se sirve del SSD local con HTTP Range + gzip sidecars — $0/mes real. (Actualizado 2026-07-05; ver 3D_PROCESSING_AUDIT.md)
- **drone-vault** (`/Volumes/SSD/drone-vault/`) = datos, fuera del repo

## 3D contract
- ODM runs locally from video frames, not WebODM SaaS: SRT → EXIF GPS → OpenSfM/OpenMVS → DSM/DTM/ortho/cloud.
- Preset `alta` is the default premium video route: stable dense products and `--skip-3dmodel`; full mesh belongs to oblique/orbit captures, not short nadir video.
- Gaussian splats are first-class outputs: OpenSplat Medium/Cinematic/Ultra, Metal/MPS backend, atomic publish, `.ksplat`, history versions, Chrome browser gate.
- Done jobs must have real artifacts and QA. No empty QA, no stale artifact links, no current/history path confusion.

## Principios
1. Originales bit-perfect, nunca re-encodear (checksums en manifest)
2. Proxies 1080p por hardware (hevc_videotoolbox) para web
3. Keyframes JPG baratos como input de AI vision
4. Telemetría SRT → flight.json 1Hz (GPS, altitud, exposición)
5. Tiers de procesamiento por clip — compute donde vale la pena
6. LLM lanes: batch vision = API paga (Haiku) o modelos locales; nunca OAuth headless

## Non-goals (v1)
- No control de vuelo en vivo / DJI SDK
- No multi-usuario ni SaaS
- No VPS: Mac Mini + Cloudflare Tunnel
- No fine-tuning de modelos
