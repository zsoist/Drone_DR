# FLIGHTVERSE — Ledger de implementación

> Rama: `feat/flightverse-v2` (desde main limpio, commit 64 de main).
> Spec completo: en el prompt del assignment (47 secciones). Este ledger es la
> memoria de ejecución entre sesiones: estado real, decisiones con razón, y el
> siguiente paso ejecutable. Regla del arco: nada se declara hecho sin
> verificación en browser.

## Contexto previo relevante (no redescubrir)
- Codex corrió ~25 min el prompt v1 (world-flight): DETENIDO al llegar
  FLIGHTVERSE v2 (0 commits; sus ediciones parciales quedaron como WIP forense
  en feat/world-flight-experience — NO heredadas, NO revisadas).
- Los 11 REPO FACTS (gz-trap, hook, sesión, assets, CSP, urllib, python-argv,
  MapLibre globals, iconos, preflight) están en /tmp/world-flight-prompt.md y
  en la memoria del proyecto — siguen vigentes.
- El plan G0-G3 previo (docs/GAME_EXPERIENCE_SPEC.md) queda SUPERSEDED por
  FLIGHTVERSE; se conserva como referencia de la tesis DSM=terreno.

## Decisiones tomadas (con razón, actualizable)
- D1 [Fase 0]: dos auditores read-only paralelos (A: renderer/estado/assets;
  E: showcase/AI/persistencia/Studio) + screenshots de breakpoints por el
  integrador. Integración: una sola mente (esta sesión) — los agentes no
  eligen arquitectura (regla sección 3).
- D2 [anticipada, a validar en Fase 1]: renderer incumbente (three.js +
  GaussianSplats3D, WebGL) parte FAVORITO del decision gate — integración 25pts
  y ya renderiza escenas reales; PlayCanvas/Babylon solo si el spike revela
  bloqueo duro en streaming/colisión. El gate se corre igual (sección 5).
- D3: el slice vertical (sección 42) manda sobre la amplitud: World→Volar→
  Gate Rush→Result→Replay→Director→Export 1080p→World en UNA escena real
  (candidata: escena 1 de baseline — DSM+orto+splat+track completos).

## Estado por fase
| Fase | Estado | Evidencia |
|---|---|---|
| P0 baseline+audit | EN CURSO | agentes A/E corriendo; screenshots pendientes |
| P1 renderer gate + SceneManifest V2 | — | |
| P2 world shell (/mundo) | — | |
| P3 vuelo jugable (loop fijo, modos, rigs) | — | |
| P4 Gate Rush (slice) | — | |
| P5 God/creator | — | |
| P6 Director | — | |
| P7 Video Studio | — | |
| P8 AI creator | — | |
| P9 Showcase | — | |
| P10 perf/resiliencia | — | |
| P11 polish/QA | — | |

## Siguiente paso ejecutable
Al aterrizar A+E: consolidar en docs/FLIGHTVERSE_UI_AUDIT.md (+screenshots
6 breakpoints vía pane con sesión ab_s), baseline de perf (bytes/first-frame
del visor actual), commit P0. Luego P1: spike del renderer sobre escena 1
(cargar ksplat + mesh DSM + query de posición + captura de frame limpio +
ciclo enter/exit sin leak) → FLIGHTVERSE_RENDERER_DECISION.md.
