# FLIGHTVERSE — UI Audit (Fase 0)

> Baseline previa a construir /mundo. Cada hallazgo: severidad, causa raíz
> (selector), fix previsto, test de regresión. Screenshots vía pane con sesión.

## Hallazgos del integrador (breakpoints 1440×900 y 390×844, tresd.html)
| # | Hallazgo | Sev | Causa raíz | Fix previsto | Regresión |
|---|---|---|---|---|---|
| I1 | A 390px el indicador (.pm-ink) del tab activo se extiende sobre el label vecino ("Trabajos") | media | .pm-ink calcula ancho con métricas desktop; sin recalc en viewport angosto | recalcular ink on-resize o width por button real | test visual 390px: ink.right ≤ botónActivo.right+2 |
| I2 | Scrollbar horizontal crudo bajo .td-stepper en móvil | baja | overflow-x:auto sin estilizado ni scroll-snap | scrollbar-width:none + mask-fade + scroll-snap-x | screenshot 390px sin barra gris |
| I3 | Último ítem del bottom-nav ("Splat Lab") cortado a 390px | media | nav inferior con overflow y sin indicador de scroll | fade lateral + snap, o colapsar labels a iconos <420px | 7/7 ítems alcanzables a 390px |
| I4 | overflow-x de documento: NO hay (✓) en 1440 ni 390 | — | — | mantener assert en tests | scrollWidth ≤ innerWidth |

## Limitación de entorno (documentada sesión previa)
El pane embebido congela rAF (0 ticks) → MapLibre/anims no progresan AHÍ;
verificación de mapa/60fps = browser real del operador + métricas por código.

## Pendiente de agentes A/E (renderer/estado/assets · showcase/AI/persistencia)
Se anexa al aterrizar.
