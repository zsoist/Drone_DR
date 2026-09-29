# AeroBrain Design System — "Instrument Graphite"

Referencia visual: paneles de instrumentos de aviación + software pro de edición (DaVinci Resolve, Linear, Arc).
Datos primero, cromo después. Fuente única de verdad: `web/style.css` (tokens en `:root` y `html[data-theme="light"]`,
tema en `localStorage 'ab_theme'`). `login.css` repite el subconjunto de tokens porque `login.html` no carga `style.css`.

## Principios
1. **Cero emojis en UI.** Iconos SVG propios (`icons.js`, grid 20px), sin relleno.
2. **Números tabulares monoespaciados** para toda telemetría (`.mono`, `--mono`).
3. **Hairlines, no sombras.** Elevación = cambio de superficie; sombra solo en capas flotantes (`--shadow-1/2/3`).
4. **Motion contenido:** solo `transform`/`opacity` (y color/bg/border en hovers). Nada rebota salvo `--ease-spring` en el hero del Home y el juego.
5. **Densidad pro:** la información no se esconde detrás de clicks; se organiza.
6. **Un componente, una forma.** Botón, chip, segmentado, campo y overlay tienen UNA definición; los contextos solo cambian ancho/margen/layout, nunca alto/padding/tamaño de fuente.

## Estructura de `style.css`
1 Tokens · 2 Base · 3 Pages (bloques por pantalla) · 4 Components (canónicos, van DESPUÉS de las páginas) · 5 Theme + Media chrome · 6 Motion (+ bloque único de reduced-motion al final).

## Tokens
### Color (dark / light)
| Token | Dark | Light | Uso |
|---|---|---|---|
| --bg / --surface / --surface-2 / --surface-3 | #0A0C10 / #11151C / #171D26 / #1E2530 | #F2F4F8 / #FFF / #EAEEF4 / #DDE3EC | fondo, paneles, hover/inputs, relieve |
| --line / --line-strong | #1E2530 / #2E3846 | #DDE3EC / #C4CDDA | hairline / bordes de controles |
| --text / --text-2 / --text-3 | #E6EBF2 / #8A97A8 / #7B899C | #17202B / #4E5D70 / #5F6C7E | primario, secundario (labels mono caps), terciario |
| --accent | #45A0E6 | #1E7FD1 | bordes, fills, iconos |
| --accent-fg | #45A0E6 | #1565B0 | acento como TEXTO |
| --accent-solid / -hover / -press | #45A0E6 / #5AB0F0 / #3890D4 | #1668B5 / #135A9E / #114F8A | fondo de botón primario |
| --text-on-accent | #06111C | #FFFFFF | texto sobre --accent-solid |
| --ok / --warn / --err | #52C79A / #E0A458 / #D96A6A | #1E8F63 / #B97A1F / #C24C4C | fills, iconos, bordes |
| --ok-fg / --warn-fg / --err-fg | = base | #146C4B / #8A5A0A / #B03A3A | estado como TEXTO |
| --*-bg / --*-bd | color-mix 14% / 34% (light bg 12%) | | chips y avisos de estado |

Alias heredados (siguen funcionando): `--mint`=ok, `--amber`=warn, `--red`=err, `--bad`, `--accent-2`=accent-fg, `--panel`/`--surface-1`=surface, `--bg-2`=surface-2.
**Regla:** color de acento/estado usado como texto → siempre `-fg`. Nunca `color:var(--accent|--mint|--amber|--red)` en CSS nuevo.

### Media chrome (idéntico en ambos temas)
Todo lo que se dibuja sobre foto/video/3D usa tokens fijos, nunca `--surface`/`--text`:
`--media-scrim` rgba(8,10,14,.72) · `--media-scrim-strong` .86 · `--media-line` rgba(255,255,255,.14) · `--on-media` #E6EBF2 · `--on-media-2` #B7C2D0 · `--media-ok/warn/accent`.
`--overlay-scrim` (dark rgba(4,6,10,.66) / light rgba(15,23,36,.42)) es el fondo de modales.

### Tipografía
Fuente: `--font` (system stack, sin Inter) · `--mono`. `button,input,select,textarea{font-family:inherit}`.
Escala: `--fs-2xs 10` · `xs 11` · `sm 12` · `md 13` · `lg 14` (cuerpo) · `xl 16` · `2xl 20` · `3xl 28` · `display clamp(40px,7vw,96px)` (solo hero del Home).
**Nada por debajo de 10px.** Pesos: 400/500/600/700 (`--fw-*`). Line-height: `--lh-tight 1.15`, `snug 1.3`, `base 1.45`, `loose 1.6`.
Tracking: `--tr-tight -.02em` (títulos) · `--tr-display -.045em` · `--tr-caps .08em` (labels mono caps) · `--tr-eyebrow .14em`.
Todo `h1` de página (`.page-head h1`, `.hero-t h1`, `.st-hero h1`, `.si-head h1`, `.si-success h1`) = `--fs-2xl` / 600 / `--tr-tight`, sin gradientes.
Labels mono en mayúsculas: 10–11px, `--tr-caps`, color `--text-2` (no `--text-3`).

### Espacio, radio, iconos, z-index
- Espacio `--sp-0..10` = 2, 4, 8, 12, 16, 20, 24, 32, 40, 56, 72 (+ `--sp-half` 6).
- Radio: `--r-xs 4` · `sm 6` · `md 8` (controles) · `lg 12` (paneles/cards) · `xl 16` · `2xl 24` · `pill 999px`.
- Iconos: `--ic-xs 12` · `sm 14` · `md 16` (dentro de botones) · `lg 20` (defecto) · `xl 24`. Trazo 1.5; 1.75 a ≤14px; 1.25 a ≥24px.
- Z: `--z-sticky 20` · `nav 100` · `overlay 300` (visores a pantalla completa, photo editor, launch) · `modal 400` (modales, popovers de timeline) · `drawer 450` · `toast 600` · `tooltip 700` · `transition 900` (Home void). El HUD del juego (`.vl-*`) conserva z locales.
- Elevación: `--shadow-1` (borde de control activo) · `--shadow-2` (popover) · `--shadow-3` (modal) · `--shadow-accent`.

## Componentes
- **`.btn`**: alto `--ctl-h` (36; 44 en táctil/≤820px), padding 0 14, borde `--line-strong`, radio md, 13px/500, `nowrap`. Tamaños `.sm` (28; 36 táctil), `.lg`/`.big` (44; 48 táctil). Variantes `.primary` (sólido `--accent-solid`, hover/press propios), `.ghost`, `.danger` (`--err-*`), `.icon` (cuadrado), `.on` (toggle). Iconos 16px (sm 14). Hover solo bajo `(hover:hover)`; `:active` scale .98; `:disabled` opacidad .4. Contextos densos (`.pc-actions .btn`, `.jc-actions .btn`…) se mapean a `.sm` en la sección Components, no con overrides locales.
- **`.chip`**: alto 28, padding 0 12, pill, 12px, `--surface-2`. `.chip.sm` 22px/11px para badges. `.on` = `--accent-dim` + `--accent-fg`. Estados `.ok/.warn/.err`. `.gchip .perf-chip .pv-tag .st-chip .fv-chip .score-pill .tierdot .pc-badges span` comparten la geometría `.chip.sm`; los que van sobre foto usan media chrome.
- **Segmentado**: `.seg .pm-tabs .scene-viewer-tabs .fv-viewtoggle .td-viewseg` (+ `.st-map-toggle` sobre mapa): contenedor radio md, padding 2, `--surface-2`; botones 32px (44 táctil), radio sm, 13px; activo = `--surface` + `--shadow-1`. Nunca gradientes ni pills cian→verde.
- **Campos**: `.ctl` (`input/select/textarea`), `.search`, `input.m-ipt`: alto `--ctl-h`, radio md, borde `--line-strong`, hover `--text-3`, focus `--accent`; `select.ctl` con chevron SVG (`appearance:none`); `.search:has(input:focus-visible)` dibuja el anillo.
- **Overlays**: una sola receta. Backdrop `--overlay-scrim` + `ovIn` (`--dur-base`); tarjeta `mIn` (opacity + translateY(8px) scale(.98), `--dur-slow`).
- **Foco**: `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}` — sin `border-radius`. `:focus:not(:focus-visible){outline:none}`.
- **Barras de progreso**: `width:100%` + `transform:scaleX(var(--p,1))`, origen izquierdo. El JS debe fijar `--p` (0..1); un `style.width` heredado sigue funcionando (sin animación).
- **Tab ink** `.pm-ink`: `--ink-x` (px, translateX) y `--ink-w` (px); un `left/width` inline heredado sigue funcionando (sin deslizar).

## Motion
Tokens: `--dur-instant 80` · `fast 140` · `base 200` · `slow 320` · `hero 600`; `--ease-out cubic-bezier(.16,1,.3,1)` (defecto, `--ease`) · `--ease-in-out` · `--ease-in` · `--ease-spring` (solo hero Home + juego).
Reglas:
1. Animar solo `transform` y `opacity` (+ color/background-color/border-color en hover). Nunca `width/height/left/top/gap/grid-template-columns/box-shadow/filter/background-position`.
2. Prohibido `transition: all`; listar propiedades.
3. Hover lift ≤ `translateY(-1px)` y solo dentro de `@media (hover:hover)`.
4. Shimmer = pseudo-elemento con `translateX`; pulsos = `::after` con opacity/scale.
5. Un único bloque `prefers-reduced-motion` al final del archivo; no añadir bloques por selector.
6. Efectos ambientales (`.hv2-ambient`) apagados en ≤820px y con reduced-motion.

## Do / Don't
- Do: usar tokens; `-fg` para texto de acento/estado; media chrome sobre imágenes; `.btn.sm` para densidad; `--z-*` para capas.
- Don't: hex/rgba sueltos para superficies; `font-size` < 10px; pesos 650/750/800; `!important` para ganar a un componente; sombras decorativas; gradientes en CTAs; hover sin `(hover:hover)`.

## Home V2: excepción cinematográfica aprobada
El Home amplía el lenguaje hacia una entrada cinematográfica: `--fs-display`, blur ambiental en desktop, `--ease-spring` en la entrada de tarjetas y transición de ruta (`--z-transition`). Límites: el contenido aparece antes del GLB, cada tarjeta es un enlace, un solo canvas de estrellas (presupuesto 100/160/260/420), navegación ≤ 620 ms, `prefers-reduced-motion` elimina el espectáculo.
