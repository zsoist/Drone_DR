# Assets de la app

## Héroe de Inicio (Home V2)

- `hero-pixel.webp` (~200 KB) es el arte del héroe. Lo usan `web/home.html` (`<link rel="preload" ... fetchpriority="high">`)
  y `web/style.css` (`.home-v2::before` y `.hv2-hero-art`, como fondo atenuado con máscara/`mix-blend-mode`).
- `hero-pixel.png` (~2.8 MB) es la fuente sin comprimir; ningún HTML/CSS la referencia. Para cambiar el héroe, reemplaza el
  `.webp` (mismo nombre) y regenera desde el PNG; no cargues el PNG en la web.
- Tras cualquier cambio bajo `web/`, ejecuta `python3 pipeline/bump_web_version.py` (bump `?v=N` y regenera los `.gz`).

## Otros contenidos

- `drone.glb`, `enemies/`, `weapons/`, `destruction/`, `props/`: modelos y kits de Flightverse (ver `props/README.md`,
  `destruction/THIRD_PARTY.md` y `docs/DRONE_MODEL_SPEC.md`, `docs/ENEMY_MODEL_SPEC.md`).
- `manifest.json`: manifiesto PWA. `touch-icon.png`, `ovi-drone.{png,svg}`: iconos y marca del dron.
