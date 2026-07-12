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
| P0 baseline+audit | HECHA | FLIGHTVERSE_UI_AUDIT.md (A+E consolidados, I1-I4, baseline perf) |
| P1 renderer gate + SceneManifest V2 | HECHA | FLIGHTVERSE_RENDERER_DECISION.md — spike OK (92/100 incumbente, 5/5 preguntas, qa/*-flightverse-spike.png); dsm_lod.py (126MB→234KB) + spike_flightverse.{html,js} + flightverse_spike_gate.py |
| P2 world shell (/mundo) | HECHA | mundo.html/js + NAV globe + BLOQUE 28; 6 escenas, verificado pane (desktop+390px, 0 errores, sin overflow) |
| P3 vuelo jugable (loop fijo, modos, rigs) | HECHA (núcleo) | volar.{html,js} + flightverse/runtime.js — timestep fijo 120Hz, 5 modos, 6 rigs, ghost del track real, HUD 4-esquinas; gate CDP: 62fps, AGL real, 0 errores (qa/*-volar.png). Deudas: touch móvil, 4 rigs restantes, audio |
| P4 Gate Rush (slice) | HECHA (núcleo) | flightverse/gaterush.js — circuito sobre el track REAL (8 gates), countdown/timer/result/récord localStorage, replay 60Hz; gate CDP autotest=gaterush ok (detección+resultado+replay verificados, 0 errores) |
| P5 God/creator | — | |
| P6 Director | — | |
| P7 Video Studio | Quick Record HECHO | flightverse/recorder.js — captureStream+MediaRecorder VP9, botón+tecla V, gate: 2.3MB WebM/2.5s, 0 errores. Falta: export determinista WebCodecs 1080p, foto mode |
| P8 AI creator | — | |
| P9 Showcase | — | |
| P10 perf/resiliencia | — | |
| P11 polish/QA | — | |

## Arco 10/10 (2026-07-11/12) — overhaul con stack investigado
Auditoría paralela de 6 libs (workflow, veredictos con evidencia medida en
scratchpad). Integrado y GATEADO (CDP, 0 errores, 73-78fps):
- **Alineación splat<->terreno** (splat_align.py, Umeyama cámaras vs
  reconstruction.topocentric — RMSE 0.003-0.018m × 5 escenas) → splat héroe
  EN /volar (P foto-real, ±cm en HUD).
- **Spark 2.1 + three r180** (shim flightverse/three.js): ksplat nativo, LOD
  presupuesto fijo; GS3D retirado del juego (legacy tresd/share sigue r160 —
  migrarlos = tarea aparte). CSP connect-src +data:.
- **Colisión edificios**: splat-transform (tools/) → collision GLB → 
  collision_bake.py (matriz horneada) → three-mesh-bvh closestPointToPoint
  120Hz determinista, push-out+rebote.
- **postprocessing 6.39**: SMAA+Bloom+ACES+Vignette (un EffectPass).
- **Audio sintetizado** (rotores/viento/eventos, M mute) + **dual-stick
  táctil** + **minimapa orto** + **llegada cinematográfica** + LOD 512.
- Vendorizados listos sin consumir: camera-controls 3.1.2 (Director P6).
- Port ecctrl (modelo 6DOF rotores, constantes en journal del workflow
  wf_710e9b72-d8a) = upgrade de game-feel pendiente.

## Siguiente paso ejecutable (sesión siguiente)
Slice vertical FUNCIONAL: Mundo→Volar→Gate Rush→Result→Replay→Quick Record.
Faltan del slice §42: Director (keyframes/timeline sobre el replay, P6) y
export determinista 1080p (WebCodecs re-simulando el replay a paso fijo, P7b).
Orden sugerido: migrar splatview.js (tresd/share) a Spark r180 y retirar GS3D del repo · P6 Director mínimo (sobre camera-controls ya vendorizado) (keyframes de cámara sobre replay.rec +
scrubber) → P7b export → P5 creator de desafíos (Dios coloca gates, JSON en
vault vía handler nuevo) → P8 AI creator (plantilla /api/analyze + ai/router,
drafts estructurados NUNCA código) → P9 showcase (patrón share.html + control
de privacidad de ubicación) → P10 (governor perf, touch dual-stick móvil,
progressiveLoad del splat, COOP/COEP si WebCodecs multithread) → P11 QA 43
criterios. Deudas técnicas anotadas: dientes nodata del terreno (emplumar),
alineación splat<->terreno (cameras.json + offset centroide en publish),
audio desde cero, 4 rigs restantes, minimapa MapLibre, splat en /volar
(hoy solo terreno — honesto hasta alinear).
