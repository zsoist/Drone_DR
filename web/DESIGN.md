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
- **`.chip`**: UNA altura, `--chip-h` = 28px en TODOS los punteros y contextos (incluido `.chip-row` y táctil; no hay 23/26/32/36). Padding 0 12, pill, 12px, `--surface-2`. `.chip.sm` 22px/11px = badge no interactivo. La zona táctil de 44px sale de `.hit44` (se aplica sola a `.chip` en `pointer: coarse`), nunca de agrandar el chip. `.on` = `--accent-dim` + `--accent-fg`. Estados `.ok/.warn/.err`. `.gchip .perf-chip .pv-tag .st-chip .fv-chip .score-pill .tierdot .pc-badges span` comparten la geometría `.chip.sm`; los que van sobre foto usan media chrome.
- **Segmentado**: `.seg .pm-tabs .scene-viewer-tabs .fv-viewtoggle .td-viewseg` (+ `.st-map-toggle` sobre mapa): contenedor radio md, padding 2, `--surface-2`; botones `--seg-h` = 32px con `min-height` 32 (44 táctil / ≤820px, también `.fv-viewtoggle.sm`), radio sm, 13px; `.pm-tabs` es SIEMPRE content-sized (`width: fit-content; max-width: 100%`, botones `flex: 0 1 auto`; una página que quiera ancho completo lo declara en su CSS); activo = `--surface` + `--shadow-1`. Nunca gradientes ni pills cian→verde.
- **Campos**: `.ctl` (`input/select/textarea`), `.search`, `input.m-ipt`: alto `--ctl-h`, (`.search` dibuja SU lupa por CSS `::before` si no contiene ningún `svg`, así todo campo de búsqueda la tiene; el `kbd` de atajo se oculta en táctil) radio md, borde `--line-strong`, hover `--text-3`, focus `--accent`; `select.ctl` con chevron SVG (`appearance:none`); `.search:has(input:focus-visible)` dibuja el anillo.
- **Overlays**: una sola receta. Backdrop `--overlay-scrim` + `ovIn` (`--dur-base`); tarjeta `mIn` (opacity + translateY(8px) scale(.98), `--dur-slow`).
- **Foco**: `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}` — sin `border-radius`. `:focus:not(:focus-visible){outline:none}`.
- **Barras de progreso**: `width:100%` + `transform:scaleX(var(--p,1))`, origen izquierdo. El JS debe fijar `--p` (0..1); un `style.width` heredado sigue funcionando (sin animación).
- **Tab ink** `.pm-ink`: `--ink-x` (px, translateX) y `--ink-w` (px); un `left/width` inline heredado sigue funcionando (sin deslizar).

## Componentes compartidos (style.css §4 + shell.js)
- **Menú / popover** — UN solo componente para todo lo flotante anclado a un botón. `openMenu(anchor, items, opts)` y `openPopover(anchor, node, opts)` (shell.js; CSS `.pop`, `.menu-i`, `.menu-sep`). Items: `{id, label, icon, hint, danger, disabled, href, sep}`; `opts.onSelect(id)` corre DESPUÉS de cerrar y devolver el foco al ancla. Pone `aria-haspopup`/`aria-expanded` en el ancla, `role=menu/menuitem`, ↑↓ Home End + tipeo, Esc (foco vuelve al ancla; escucha en `window` captura, gana a modales y visores), Tab/clic fuera/scroll fuera/resize cierran, se voltea si no cabe, un solo popover abierto (clic en el mismo ancla = toggle). `danger` = `--err-fg`. Fila táctil 44px. Prohibido construir menús locales (`.td-menu`, `.sl-pop`… ya no existen). El sheet «Más» del móvil (`#msheet-ov`) es un diálogo de navegación, no un menú. Páginas sin shell.js (share, p, volar, login) conservan sus propios controles.
- **`.btn-group`** — botones unidos (deshacer/rehacer, anterior/siguiente): hijos `.btn` normales, solo cambia radio y solape. **`.spacer`** = `flex:1`.
- **`.chip-row`** — fila de chips/filtros con scroll horizontal, sin barra; `.chip-div` separador. Los chips dentro son `.chip` normales (28px). Desvanecido de borde fuerte: la fila sangra `--chip-bleed` (22px) hacia los lados y la máscara baja a 0 en esos 22px, así el primer/último chip en reposo queda opaco y lo que se desplaza se ve cortarse.
- **`.sr-only`** — texto solo para lectores de pantalla. **`[hidden]`** gana siempre (`display:none !important`): nunca escribas `.x[hidden]` en CSS de página.
- **`.score-pill`** — la única insignia de puntuación (mono, `--on-media` sobre `--media-scrim`). **`.tierdot`** tiene dos looks: `full` = acento, el resto neutro.
- **`.scrim`** — degradado inferior (`--media-scrim-strong`) para texto sobre foto/video; sustituye a `.cc-shade/.wi-shade/.hv2-card-wash`.
- **Estado vacío** — `emptyState({icon, title, help, action, cls})` → `.empty` (icono + `<b>` título + `<p>` ayuda + botón opcional). No uses `.empty` como clase de estado: para eso `.is-empty`.
- **Cabecera de página** — `pageHead(title, sub, actionsHTML, {subId})` → `.page-head` (h1 20/600, `.page-head-sub`, `.page-head-actions`). Todas las páginas con shell la usan; el contador dinámico va en `subId` (aria-live).
- **Panel** — `.panel > .ph` es un título en frase (13/600, icono 16). Colapsable solo si el panel lleva `data-collapsible` (chevron por máscara CSS con `--chev-d`).
- **Comparador** `.cmp-handle` (dos chevrons por CSS), `details.explain`/`.tl-help` (chevron por máscara): sin glifos de texto.
- **Iconos** — todo en `icons.js` (`more, sliders, star, keyboard, edit, chevU/chevD/chevL/chevR, arrowL/arrowR, swap, bolt`…). Prohibido `Object.assign(ICONS, …)` en páginas y SVG inline sueltos; glifos ✕ ✓ ▾ ▸ › ✨ ⚡ fuera de la UI.

## Decisiones de QA global (c1)
- **Iconos dentro de botones**: los iconos de encabezado/contexto (`.panel .ph`, `.modal-h b`, `.tl-seclabel`, `.cc-stats`…) fijan su color con `:where(ctx) svg.ic` (especificidad 0,1,1) y NUNCA ganan a un `.btn`. Además `.btn.primary svg.ic` = `--text-on-accent` y `.btn.danger svg.ic` = `--err-fg`. Regla para CSS nuevo: el color de un icono de contexto va en `:where()`; el tamaño puede ir con selector normal.
- **Cierre de modal (`.modal-x`)**: componente canónico = `.btn.icon.ghost.sm` (32×32, radio md, borde transparente), icono `--text-2`; acento (`--accent-fg`) solo en hover y `:focus-visible`. Ya no hereda el azul de `.modal-h svg.ic` (que ahora solo pinta el icono del título: `.modal-h b svg.ic`).
- **`openModal(ov, {onClose, label, initialFocus, closeOnBackdrop})`** (shell.js, global) — API ÚNICA para modales de página: `role=dialog`, `aria-modal`, `aria-labelledby` automático (primer `.modal-h b`/`.tx-pop-h b`/h1-h3), foco inicial (opts → `[autofocus]` → primer control que no sea la ×; en táctil los campos de texto no roban el foco), Tab atrapado, Esc por la pila de capas, clic en fondo (down+up) o `.modal-x` cierra, scroll lock de `<html>` (`html.modal-open`, contado, compensa scrollbar) y foco devuelto al opener. `ov.remove()` posterior hace la misma limpieza. Devuelve `close()`. Uso: `const ov = document.createElement('div'); ov.className = 'modal-ov'; ov.innerHTML = '<div class="modal"><div class="modal-h"><b>Título</b><button class="modal-x" aria-label="Cerrar">…</button></div>…</div>'; const close = openModal(ov, { onClose })`. Prohibido volver a escribir listeners de Esc/Tab/backdrop a mano en modales nuevos; tresd/studio migran a esta API.
- **Pila de capas** (`pushLayer({onKey})` / `popLayer(layer)`, shell.js): UN único `keydown` en `window` (captura). Menús/popovers, modales y la hoja «Más» se apilan; solo la capa de arriba recibe teclas (Esc cierra primero lo más alto). `lockScroll()/unlockScroll()` con contador para cualquier capa que bloquee el fondo.
- **Ancho de página**: `--page-max: 1168px` y `--main-px` (26px; 14px ≤820px). `.main { max-width: calc(var(--page-max) + 2*var(--main-px)) }`, alineado a la izquierda: en pantallas anchas TODAS las páginas comparten borde izquierdo y ancho de contenido. Páginas de lectura estrechas (Guía 1040) usan un `max-width` interno SIN `margin: auto`, mismo borde izquierdo. Opt-out para canvas a sangre: `.main.wide` (y `.main.home-v2`). Los `max-width` de página (`.dr-page`, `.sy-page`, `.vt-page`…) no deben superar `--page-max`.
- **Utilidad `.hit44`**: el control conserva su tamaño visual; en `pointer: coarse` un `::after` centrado garantiza ≥44×44 de zona táctil (`position: relative` vía `:where`, no pisa `position: absolute`). Aplicada de serie a `.tl-x`, `.tl-expand`, `.cr-ins`, `.hl-item .tc` y `.chip`; el resto de controles pequeños de página añaden la clase `hit44`.
- **`kbd` global**: `--text` sobre `--surface-2`, borde 1px `--line-strong`, radio `--r-xs`, mono `--fs-xs`, padding 1px 6px (legible en ambos temas). El HUD del juego conserva `.vl-guide kbd`. Nada de estilos `kbd` por componente.
- **`.page-foot`**: nota al pie de página (muted `--text-2`, `--fs-sm`, margen superior `--sp-6`, `max-width: 72ch`). Se oculta sola si es hijo único o va justo tras `.empty`/`.is-empty` (nunca flota bajo un estado vacío).
- **Iconos nuevos**: `splat` (cúmulo de gaussianas) para Splat Lab; `spark` queda SOLO para IA; `image`, `moon` añadidos (`edit` ya existía). Menú de Viajes: Renombrar = `edit`, Elegir portada = `image`.
- **Shell**: enlace «Saltar al contenido» (`.skip-link`) es el primer foco de la página y lleva el foco a `<main id="main" tabindex="-1">`. La hoja «Más» tiene título «Más» + ×, `aria-labelledby`, rejilla de 6 columnas con tiles de span 2 (resto 1 = fila completa, resto 2 = mitades: nunca un tile huérfano), anillo de foco de la pestaña Más con `outline-offset: -4px`. El toggle de tema muestra el tema ACTUAL (luna = oscuro, sol = claro, «Tema oscuro/claro»), `aria-pressed` = oscuro activo, `title` = acción. Cambio de tema con fundido de 160ms solo de `background-color/color/border-color` (`html.theme-anim` ~220ms; desactivado con `prefers-reduced-motion`). Tarjeta de trabajo compartida: acción principal `.btn.sm.primary`, secundarias `.btn.sm`/`.ghost`; separación vertical `--sp-3`.

## Decisiones de QA global (c2 · componentes compartidos)
- **Slider** — UN componente: `input[type=range]` (style.css §4 «range slider»). `.pm-range`/`.tl-range` son alias (solo layout: `flex`, `min-width`, `width`). Pista 6px `--surface-3` con borde `--line-strong` (legible sobre cualquier card), relleno `--accent` vía `--fill` (0..100%), thumb 16px blanco con borde `--accent`, foco = anillo en el thumb, `:disabled` opacidad .4, puntero grueso: thumb 22px / pista 8px / banda 32px. `--fill` lo mantiene un helper global en shell.js (listener `input`/`change` delegado, setter de `.value` programático, nodos nuevos y cambios de `min/max/value` por MutationObserver; también `window.paintRange(el)`). El CSS pone `background: transparent !important` en el input porque JS heredado (`paintR` en studio.js, `paintRange` en photoeditor.js) pinta gradientes inline: esos helpers ya sobran y deben borrarse. Prohibido re-estilar thumbs/pistas en CSS de página.
- **`.ex-sheet`/`.ex-card`** (hoja de export) usa el mismo scrim (`--overlay-scrim`), tarjeta `--surface` + `--line`, radio `--r-lg`, `mIn`/`ovIn` que `.modal`; su cabecera debe ser `.modal-h` (no `.ph`).
- **Sticky**: los contenedores de página usan `overflow-x: clip`, nunca `hidden` (`hidden` vuelve el nodo un scroll container y mata `position: sticky` dentro). Aplicado a `.scene-improve-page` y `.scene-improve-page .main` (se eliminó el `max-width: 1500px` muerto: manda `--page-max`). Solo `html` conserva `hidden` (se propaga al viewport). `.main.home-v2{overflow:hidden}` (home.css) es intencional: no contiene sticky.
- **`::selection`**: `color-mix(in srgb, var(--accent) 35%, transparent)` + `--text`, ambos temas.
- **`.exportbar`**: sticky con `bottom: 0` en escritorio (sin franja de contenido debajo) y `padding-bottom` que suma `env(safe-area-inset-bottom)`; en ≤820px sigue sobre la bottom-nav.
- **Tarjeta de trabajo (`.jcx`)**: líneas de texto a `--sp-2`; bloques (cabecera, acciones, «Ver log») a `--sp-3`. Etiquetas de estado en español llano: «En proceso», «En cola», «Listo», «Falló», «Cancelado», «No se pudo cancelar» y «Listo · con respaldo» (nunca «fallback»).
- **`.scroll-x-fade`** — fila/toolbar con scroll horizontal y el mismo desvanecido de borde que `.chip-row` (`--fade` 22px). `.scroll-x-fade.bleed` sangra el padding para que primer/último ítem en reposo queden opacos. Úsalo en toolbars que ocultan acciones al desbordar.
- **Pie de modal**: `.modal-foot` (barra) + `.modal-hint` (texto): sans `--fs-sm` `--text-2`, nunca mono. `.rm-count` es alias. Un número dentro del pie puede ser `.mono.num`.

## CSS por página
`web/css/<page>.css` (se enlaza DESPUÉS de style.css y shell.css) contiene SOLO layout de esa página: rejillas, anchos, orden en móvil y prefijos propios (`.st-`, `.sl-`, `.tr-`…). Los componentes (botón, chip, menú, vacío, cabecera, insignias, scrim) viven UNA vez en style.css; una página puede ajustar ancho/margen, nunca alto, padding ni tamaño de fuente de un componente. Nada de `[hidden]`, `text-transform` en `.ph`, ni copias de `.chip-row`/`.sr-only`/`.score-pill`. Un selector cuyas clases no aparecen en ningún `web/**/*.js|html` está muerto y se borra. `position: sticky` funciona porque `body` usa `overflow-x: clip` (con `hidden`, `body` pasaba a ser contenedor de scroll y el sticky no se activaba).

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
