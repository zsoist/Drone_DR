# AeroBrain Design System — "Instrument Graphite"

Referencia visual: paneles de instrumentos de aviación + software pro de edición
(DaVinci Resolve, Linear, Arc). Datos primero, cromo después.

## Principios
1. **Cero emojis en UI.** Iconografía SVG propia, trazo 1.5px, 20px grid.
2. **Números tabulares monoespaciados** para toda telemetría (SF Mono / ui-monospace).
3. **Hairlines, no sombras.** Bordes 1px #1E2530; elevación = cambio de fondo, no blur.
4. **Motion contenido:** 160ms ease-out, solo transform/opacity. Nada rebota.
5. **Densidad pro:** la información no se esconde detrás de clicks; se organiza.

## Home V2: excepción cinematográfica aprobada

El Home es la única superficie que amplía deliberadamente este lenguaje hacia una entrada
cinematográfica. Conserva tipografía, iconos, tokens y telemetría Instrument Graphite, pero permite
profundidad, blur ambiental y motion más largo en el hero, las tarjetas y la transición de ruta.
La excepción tiene límites de producto: el contenido aparece antes del GLB, cada tarjeta completa
es un enlace, el efecto de estrellas usa un solo canvas con presupuesto 100/160/260/420, la
navegación nunca espera más de 620 ms y `prefers-reduced-motion` elimina el espectáculo. El resto
de la aplicación mantiene motion de 160 ms y elevación por superficie.

## Tokens
| Token | Valor | Uso |
|---|---|---|
| --bg | #0A0C10 | fondo app |
| --surface | #11151C | paneles, cards |
| --surface-2 | #171D26 | hover, inputs |
| --line | #1E2530 | bordes hairline |
| --text | #E6EBF2 | texto primario |
| --text-2 | #8A97A8 | secundario |
| --text-3 | #566274 | terciario, labels |
| --accent | #45A0E6 | acción, rutas, links |
| --amber | #E0A458 | warnings, tier standard |
| --mint | #52C79A | ok, tier full |
| --red | #D96A6A | errores |
| --font | -apple-system, Inter, sans | UI |
| --mono | ui-monospace, "SF Mono" | telemetría |
| --r-lg / --r-md / --r-sm | 12 / 8 / 5px | radius |

## Componentes
- **Sidebar** 220px desktop / bottom-bar móvil. Iconos + labels, item activo con barra accent 2px.
- **Card de vuelo:** thumb 16:9, hover = scrub de keyframes, footer con 3 métricas mono.
- **HUD:** strip horizontal de métricas, label 10px uppercase tracking 1px, valor 16px mono.
- **Charts:** SVG inline, línea 1.5px accent, área con gradient 8% opacity, crosshair on hover.
- **Chips de tags:** surface-2, 12px, clickables → búsqueda.
- **Estados:** skeleton shimmer para loading; empty states con icono + una línea, sin ilustraciones cursis.
- **Home V2:** hero con asset `hero-pixel.webp`, `drone.glb` progresivo con fallback
  `ovi-drone.png`, cinco métricas veraces y siete tarjetas siempre presentes.
