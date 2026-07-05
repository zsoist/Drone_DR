# AeroBrain — Personal Drone Intelligence Platform

"Conecto el dron, subo, y analiza." Convierte cada vuelo del DJI Flip / Neo 2
en inteligencia: mapas, detección de objetos, escenas 3D y diarios de viaje.

## Arquitectura
- **Mac Mini M4** = compute: ingesta SD, ffmpeg/VideoToolbox, YOLO (MPS), WebODM
- **Cloudflare** = serving: Pages + R2 (video, egress gratis) + dominio propio
- **drone-vault** (`/Volumes/SSD/drone-vault/`) = datos, fuera del repo

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
