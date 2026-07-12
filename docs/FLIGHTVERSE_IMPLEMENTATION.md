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

## Estado del plan 'cierre 10/10' (2026-07-12)
Paso 0 ✓ · A nodata ✓ · B 6DOF ✓ · G SOG ✓ (5 escenas, -50% peso) ·
C Director ✓ (camera-controls + keyframes + Grabar toma) ·
D export determinista 1080p ✓ (WebCodecs+webm-muxer, CDP verde) ·
F matriz ✓ (browser_matrix --flightverse: mundo+volar × 3 viewports 71-76fps).
Fase E ✓ (2026-07-12): splatview portado a Spark, tresd/share en r180, GS3D+three160+addons160+pp637 BORRADOS del repo — un solo stack. Gates: browser_gate splat + matriz share/workspace 6/6 (macro real). PLAN COMPLETO 7/7. El slice §42 está COMPLETO:
Mundo→Volar→Gate Rush→Result→Replay→Director→Export 1080p→Mundo.

## Siguiente paso ejecutable (sesión siguiente)
El plan 'cierre 10/10' está 7/7 y el slice §42 completo. Backlog restante del
spec original (por valor):
- P5 creator de desafíos: en modo Dios colocar gates → JSON en vault vía
  handler nuevo (patrón /api/property).
- P8 AI creator: plantilla /api/analyze + ai/router — drafts estructurados,
  NUNCA código ejecutable (regla del spec).
- P9 showcase: patrón share.html + control de privacidad de ubicación
  (no exponer center_wgs84 en replays públicos sin opt-in).
- P10 restos: progressiveLoad/streaming del SOG, COOP/COEP si algún día
  WebCodecs multithread, gamepad.
- P11: checklist formal de los 43 criterios de aceptación.
Deudas menores: foto mode (P7), 4 rigs restantes, tuning fino del 6DOF con
mando real, minimapa MapLibre opcional.

## v93 (2026-07-12) — cielo realista v5 + LEDs escala + dock premium
- **Bug raíz del "muro naranja"**: el hemisferio inferior del domo renderizaba color-horizonte
  puro (h=clamp(d.y,0,1)=0) llenando media pantalla. Fix: bruma bajo el horizonte hacia uFogC.
  Diagnóstico: franjas debug por h en el shader (patrón reutilizable).
- Luna real: disco sólido vía mix() (no aditivo → sin blob de bloom), UV local, mares por
  value-noise, limb darkening, halo apretado. Posición naciente (~9°) en frame por defecto.
- Estrellas: mapeo az/el estable (sin estirón en horizonte), 2 capas, magnitud/tinte/twinkle
  por celda (uTime nuevo).
- Atardecer: banda horizonte estrecha (midPos .10, topPos .46), headroom R<1 (anti-clamp),
  scatter Mie de juguete solo bajo y hacia el azimut del sol.
- Nubes: fbm value-noise tileable (4 octavas, wrap) + cúmulos con base plana y panza sombreada.
- LEDs del dron a escala real (0.055/0.075, núcleo duro), respiración sutil.
- Dock premium: sheen sweep, glow por color de sección, entrada escalonada, prefers-reduced-motion.
- Debug: window.__skyUni expone uniforms del cielo para QA por CDP.

## v94 (2026-07-12) — audio overhaul: acústica de quad real
- 4 rotores independientes (PeriodicWave 16 armónicos 1/n^1.25, pares atenuados),
  detune fijo por rotor (batido cuádruple) + wander senoidal (correcciones FC).
- WaveShaper tanh = grit; whine motor/ESC (saw ×9.5 BPF, muy tenue); propwash de
  ruido bandpass con chop AM a la frecuencia de paso de pala; viento ∝ v² aparte.
- Bus espacial: gain 1/d + lowpass de absorción de aire + StereoPanner, alimentado
  desde volar con camera.worldToLocal(P) — FPV pega el oído, Lejos lo aleja.
- BPF sigue propSpin (la inercia de hélices ya existente) + lift.
- Verificación headless: OfflineAudioContext render → RMS 0.074 / peak 0.21 (probe
  CDP con monkey-patch de AudioContext); report.audioArmed expuesto para gates.

## v96 (2026-07-12) — armamento + pipeline ultra-HD de modelos
- weapons.js: misiles (balística leve, estela de humo), explosión multicapa
  (flash + PointLight, bola de fuego, humo, 70 chispas Points con gravedad,
  onda expansiva expandiéndose a ras de suelo, scorch persistente máx 12 FIFO),
  fragmentación de destruibles (14 chunks con rebote) — todo pools, cero assets.
- objects.json: flag `destructible` → hittables (centro+radio²); 3 cajas de
  prueba en la escena sample. HONESTO: la fotogrametría recibe scorch/metralla,
  no se rompe; lo destruible son objetos de juego.
- UI: botón FIRE circular premium (municion 8 + recarga 2.5s/u, barra cooldown,
  anim flash, estado empty) + tecla X. Shake de cámara escalado por distancia.
- audio: launch() whoosh bandpass + boom() ruido lowpass 2.6k→180 + sub 72→28Hz.
- Ultra-HD: environment map procedural (scene.environment — PBR metálico ya no
  sale negro), anisotropía máx en todas las texturas del GLB, receiveShadow.
  Spec v2: 120k tris / 8 mats / 2048² / hardpoints / gimbal / prompts copia-pega.
- Gate: &fuego=1 dispara a 1s con pitch -0.55 → report.weapons {fired, exploded}.
  Verificado: fired 1 / exploded 1 / 68fps / 0 errores.
