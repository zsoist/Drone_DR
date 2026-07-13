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

## v102 (2026-07-12) — armamento v2: cráteres reales + VFX nivel motor
- Research: three.quarks (GPU instancing, stretched billboards, trails, Shuriken
  parity) y three-nebula evaluados; técnicas portadas NATIVAS (cero deps, CSP
  intacto): Points con textura suave (adiós chispas cuadradas), streaks
  LineSegments estirados por velocidad, rampas color-sobre-vida en sprites
  (blanco→naranja→rojo oscuro / humo aclara), rotación por partícula.
- CRÁTERES REALES: terrain.crater(x,z,r,depth) deprime el heightfield hf +
  geometría con falloff coseno; heightAt cierra sobre hf → colisión del dron y
  anclaje de objetos ven el cráter. Normales recalculadas SOLO en el parche
  (diferencias centrales del grid regular — sin computeVertexNormals global).
- Escombros PERSISTEN: al asentarse (rebote + |v|<0.9) se congelan como rubble
  estático (matrixAutoUpdate=false), tope 240 FIFO. 18 chunks, 30% carbonizados.
- Fuegos residuales: 5.5s de llamas con rampa + humo + PointLight con flicker,
  máx 3 concurrentes. Misil: roll, aletas, flicker de tobera, estela fina,
  hardpoints alternos izq/der.
- Retícula de impacto: balística simulada 80 pasos contra el heightfield cada
  frame — anillo naranja pulsante donde caerá el misil. Chip DERRIBOS n.
- QA params: &fuego=1 (dispara), &boom=1 (detona a suelo), &rig=N (cámara).
  6 gates verdes consecutivos, 66-75fps, 0 errores.

## v104 (2026-07-12) — destruction kit integrado + dron ultra-HD
- Kit de ChatGPT (threejs_destruction_kit) integrado SIN Rapier: usamos sus GLBs
  pre-fracturados (extras: role/massKg/mode/explosive) con NUESTRA física de
  weapons.js — cero deps nuevas, determinismo intacto. Rapier queda como opción
  futura (physics/ del kit conservado en Downloads).
- objects.json type:'kit' → assets/destruction/models/ (barril explosivo, bloque
  concreto, muro 70 ladrillos, pino, debris_pack; 17MB; THIRD_PARTY.md copiado).
- smash v3: fragmentos REALES del kit vuelan con velocidad ∝ 1/√massKg desde el
  punto de impacto; barriles encadenan detonación (+0.12s). Fallback: shatter.
- CSP: connect-src + blob: (GLTFLoader carga texturas embebidas via blob) —
  safe_restart.sh web aplicado.
- Dron ultra-HD: pipeline/generate_drone_hd.py (derivado del generador del
  operador): 40,336 tris, 3 mats (acento naranja EMISIVO), palas con twist,
  12 aletas de refrigeración/motor, tornillería, antenas, GPS puck, 24 radios,
  hardpoint_1..4 REALES — doFire dispara desde el hardpoint en turno.
- Gates: 12 objetos cargan limpio, customDrone true, fired/exploded 1/1, 67fps.

## v106 (2026-07-12) — explosión v3: potencia real + perf recuperada
- Núcleo blanco-caliente (7 sprites flash con rampa a naranja), 22 llamas ALTAS
  (escala no uniforme tall 1.5-2x + rise), columna de humo que sube (18, vida
  3.2-5.4s, crece a 11-18m), anillo de POLVO rasante terroso (14), EYECTA: 12
  pedazos de suelo/edificio que vuelan con arco y QUEDAN como escombro (esto
  faltaba al disparar a la fotogrametría), brasas 60→110, streaks 26→40,
  flash 24m, luz 150. Misiles explotan a big 1.25. Tope 460 sprites (drawcalls).
- Fuego residual: llamas estiradas 2.1x con aceleración vertical.
- Nubes billboard subidas 170→300m + sombreado suave (parecían blobs bug a baja
  altitud urbana).
- PERF: fragmentos del kit sin castShadow (70 ladrillos = 140 drawcalls de
  shadow pass) → 47fps → 71fps.
- Evidencia visual: scorch + eyecta confirmados en techo (crop cenital).

## v107 (2026-07-12) — Gate Rush v2: dificultades + aros HD + aproximación
- DIFFS: fácil 8×9m verde / media 10×6.5m azul / difícil 13×4.2m púrpura (con
  altura variada en fallback). Récords localStorage POR dificultad.
- Picker premium bajo el HUD (colores por nivel, recuerda la última en
  localStorage); T = arranca directo con la última.
- Aros HD: torus 24×96 + aro fino interior + glow 12×72; el activo gira, pulsa
  y proyecta BEAM de luz al suelo; flash-anillo blanco al pasar cada gate.
- 14 migas de luz fluyendo por la ruta (getPointAt animado) + splits: el HUD
  muestra +Δs por gate 1.6s.
- Aproximación grácil: al iniciar, el dron VUELA al punto de entrada (easeInOut
  + arquito, patrón del transit arcade), luego countdown — adiós teleport.
- Autotest verde: reto {time 3.62, gates 10 (media), recFrames 217}, replay
  activo, 70fps, 0 errores.

## v109 (2026-07-12) — modal de resultado v2 + replay limpio
- Modal Gate Rush v2: badge NUEVO RÉCORD animado / delta vs récord, grid de 4
  stats (gates, vel máx, vel MEDIA honesta = distancia real de poses/tiempo,
  metros), TABLA DE SPLITS por gate con el mejor tramo resaltado, botón
  Dificultad (reabre picker), Reintentar repite la misma dificultad.
- Bug z-index: el OSD FPV (HOME/GIMBAL) se pintaba SOBRE los botones del modal
  → vl-result z-60 + el FPV se oculta al mostrar resultado.
- Replay/Director muestran el VUELO PURO: el circuito (aros/beams/migas/tubo,
  aditivos) se ocultaba en velos gigantes al volar dentro — setVisible(false)
  al entrar, restore al salir (ESC y exitDirector).

## v111 (2026-07-12) — VFX senior pass + arsenal completo
- HUMO REAL: textura multi-lóbulo procedural (26 blobs con densidad variable —
  silueta irregular, no disco de tinta), curva de opacidad VFX (entrada rápida
  ×5, salida cuadrática, tope 0.6 — nunca negro sólido), y NACE ILUMINADO por el
  fuego (rampa 0xb56a34 → gris 0x8f8b86). Aplicado a columna, polvo, estela y
  fuegos residuales.
- Scorch con gradiente radial suave (adiós 'landing pad' negro flotante).
- Eyecta: gravedad 30 + drag aerodinámico, tamaños 0.1-0.36, rebote 0.24.
- ARSENAL (export ARSENAL): MG (auto 11.8/s, tracers balísticos con dispersión,
  daño acumulativo vs health del kit, impactos con polvito+chispa) + misiles
  S/M/L (velocidad/boom/cooldown/munición/regen propios; L escala 1.5 y big 2.2).
  Selector UI premium sobre el FIRE (MG/S/M/L), Z cicla, hold-to-fire (pointer
  y tecla X sostenida). Munición y cooldown del HUD por arma.
- Audio: mg() percusiva 60ms bandpass 1.6k; boom(big) — el L truena más grave
  (sub 80→20Hz) y más largo (~1.9s), cuerpo con lowpass más profundo.
- Colisión premium: flash rojo de viñeta 0.5s al chocar (vl-hitfx).
- QA: &fuego=mg = ráfaga sostenida → 18 balas/1.6s, 0 errores, 70fps.

## v113 (2026-07-12) — Modo Tierra: horda de zombies ORIGINAL
- LEGAL: NO se extrajo nada del APK/DZ de Black Ops Zombies (copyright Activision).
  Solo mecánicas (idea, no protegible): zombies procedurales originales de
  primitivas, IA de persecución, oleadas. Cero assets de terceros.
- zombies.js: humanoide encorvado (cápsulas/esferas) con animación de caminata
  (balanceo piernas/brazos + bamboleo), persigue al dron por XZ; y = terreno.
- Suelo CAMINABLE: walkable() muestrea 4 vecinos, rechaza pendiente >4.5m —
  los zombies no se paran en acantilados de la fotogrametría (donde SÍ pueden ir
  tiene sentido físico). Mejora directa del límite de colisión a nivel de suelo.
- Oleadas: 4+2·wave zombies, hp y velocidad crecen por oleada; spawn en anillo
  caminable 12-40m alrededor del dron.
- Integración armamento: zombies son hittables (.zombie); MG daño acumulativo +
  sangre, misil directo mata, explosión salpica radio. HUD: oleada/abatidos/
  activos + barra de salud (mordida −8hp con flash rojo).
- Botón "Modo Tierra" en el dock (sección juego). QA &zombies=1 → oleada 1,
  6 activos, 70fps, 0 errores.

## v114 (2026-07-12) — MODO INVASIÓN + VFX v4 + MG overhaul
- invasion.js (reemplaza zombies.js): 7 enemigos ORIGINALES procedurales —
  zombies, arqueros (flechas en arco con compensación balística), soldados
  (ráfagas de 3), OVNIs (órbita cerrada + plasma), aviones (pasadas), dragón
  (serpenteo + bolas de fuego + alas batiendo), gigantes ~12m (melee manotazo).
  Modal de selección multi-tipo al pulsar "Modo Invasión"; oleadas mixtas.
- Suelo: walkable() con footprint por-tipo (gigante 5m/pendiente 6) y ALTURA
  SUAVIZADA (lerp dt*8 — sin escalones). Voladores con patrones propios.
- Proyectiles enemigos dañan salud (flecha 6/bala 3/plasma 10/fuego 15) con
  flash rojo; muerte de enemigo metálico = explosión (fx bridge a weapons).
- weapons v4: hitEnemy genérico (sangre SOLO orgánicos, chispa en metal), MG
  con FOGONAZO de boca + tracer con glow (balas visibles de verdad), misil con
  encendido cinemático (25%→100% en 0.6s + puff de salida), brasas sin confeti
  (80×0.42, caen a 34), texturas 128/192px (42 lóbulos), onda de choque v2:
  frente brillante 64seg + banda de compresión oscura (aire comprimido).
- Punch de FOV de concusión: explosión cercana golpea el FOV hasta +7° con
  decaimiento — la 'distorsión' de una detonación real.
- HUD: mini-barra de munición bajo cada arma del selector (--ammo var CSS).
- Gate: invasion=zombie,ufo,gigante,dragon → oleada 1, 8 vivos, 73fps, 0 err.
  OVNI visible en screenshot orbitando.

## v115 (2026-07-12) — pipeline de enemigos GLB ultra-HD (motor listo)
- SkeletonUtils vendorizado (three 0.180 oficial, import al shim) — clonado de
  modelos con skinning.
- invasion.js: si assets/enemies/<tipo>.glb existe (manifest.json), lo carga y
  clona por spawn; AnimationMixer con clips 'walk'/'fly'/'attack'/'idle' —
  attack se dispara en melee y al disparar proyectiles. Centro de impacto y
  radio del bbox real. Fallback: procedural (carga progresiva honesta).
- docs/ENEMY_MODEL_SPEC.md: contrato completo (ejes/origen/escala real/clips/
  presupuesto 80k/6mats/2048²) + prompts copia-pega por los 7 tipos (diseños
  ORIGINALES brand-free) + lista de archivos a entregar a ChatGPT + pasos de
  instalación y gate de verificación.
- Gate: invasión procedural intacta (71fps, 0 errores).

## v116 (2026-07-12) — destruction kit v3: eyecta PBR real + regenerabilidad
- Los 3 kits comparados: GLBs byte-idénticos; kit-3 aporta el GENERADOR
  (generate_destruction_kit.py → pipeline/, kit regenerable/ajustable a
  voluntad) y los passes intermedios (no vendorizados).
- EYECTA REAL: debris_pack.glb (16 fragmentos PBR de concreto/ladrillo del
  kit, original brand-free) se carga perezoso; cada explosión clona
  fragmentos texturizados (geometría/material compartidos — barato) en vez
  de cajas de colores. Fallback procedural mientras carga o sin el GLB.
- impact_crater.glb añadido a assets/destruction/models (disponible como
  prop type:'kit' para vestir escenas con cráteres persistentes).
- Gate: fuego=1 verde, 77fps, 0 errores.

## v117 (2026-07-12) — ENEMIGOS GLB ULTRA instalados (pack externo v1.1)
- 7 GLBs finales (13.8MB, 16.9k-77.5k tris, PBR 2K embebido, clips walk/fly/
  attack/idle/death) + LOD1/LOD2 disponibles + manifest 7/7 + enemy_catalog.
  Pack validado por su emisor: 56 GLBs × validador oficial 0 errores, carga+
  clonado+clips verificados en three.
- Parche externo REVISADO (no aplicado a ciegas — nuestro archivo evolucionó):
  tomado cache-bust ?v=N (el bumper lo refresca), voladores y2=0 (origen centro,
  contrato), clip DEATH antes de retirar (mixer sigue en rama dead), guards
  !e.mixer en anims procedurales (ring/alas), flip π tras lookAt (apunta +Z,
  frente -Z) en avión/dragón.
- HALLAZGO propio en la revisión: facings procedurales inconsistentes (zombie
  brazos +Z, soldado rifle -Z) — estandarizado TODO al contrato -Z: partes del
  zombie/arquero volteadas, terrestres atan2+π universal. Una sola regla.
- Gate 7/7 tipos con GLB: todos OK, 0 errores de consola, 70fps.

## v124 (2026-07-13) — malla fotogramétrica: fix edificios dobles + texturas HD
- BUG 'mapa roto' (escena 0117 orbital casa): el DSM-LOD se hundía -0.55m bajo
  la malla ODM pero sus edificios EXTRUIDOS (3-10m) seguían cruzándola →
  edificios dobles, mezcla nítido/derretido. FIX: la máscara radial del terreno
  (libre desde mixta v4) recorta el DSM dentro de la HUELLA de la malla
  (bbox → centro XZ + radio (w+d)/4, borde dithered). DSM = solo alrededores.
- Texturas: el manifest solo exportaba mesh_mtl_low (vtl 3.4MB thumbnails) —
  en desktop se veía low-res. scene_manifest.py exporta ahora mesh_mtl (vth
  8.4MB) y mesh_mtl_extra (vtx 12.8MB); attachVisualMesh elige por dispositivo:
  coarse→low, desktop→vth. Manifests regenerados.
- applyVista() se re-aplica al resolver la malla (la máscara activa al llegar).
- Gate 0117: visualMesh true, 69fps, 0 errores; captura confirma malla nítida
  sin dobles.

## v125 (2026-07-13) — escenas con malla: SOLO la representación high-res
- El anillo DSM derretido alrededor de la malla seguía leyéndose como 'roto'.
  Regla nueva: si la escena tiene malla fotogramétrica, el DSM visual NO se
  dibuja nunca (ni recorte, ni anillo) — solo la malla nítida. La física
  (heightAt/colisión/cráteres) sigue en el heightfield. Sin malla: reglas de
  siempre. Máscara radial liberada de nuevo.
- Gates 0117 + 0104 (ambas con malla): 71fps, 0 errores. Captura cenital: puro
  high-res.

## v129 (2026-07-13) — escalera de texturas de la malla (el 'feo' era texel)
- El 'primero se ve HD y luego queda el feo': el DSM+orto (27MP) cargaba
  primero y la malla llegaba con texturas viewer downscaladas → el swap
  BAJABA la nitidez percibida. Fix en escalera:
  · desktop default: viewer_extra/vtx (12.8MB, el tier viewer más nítido)
  · calidad extra/4K/ultra: upgradeTextures() sube a los ATLAS ORIGINALES
    del geo (~90MB, 73 PNGs, swap por nombre de material, one-shot perezoso)
    — mismo principio que ortho_full: el supersampling no inventa textura.
  · móvil: low (3.4MB) como siempre.
- manifest exporta mesh_mtl_geo; scene.js guarda material.name como ancla y
  expone upgradeTextures(); volar dispara al subir calidad Y al resolver la
  malla (la calidad puede fijarse antes de que llegue el OBJ — bug cazado en
  el primer gate: meshTexMax null porque setCalidad corrió pre-malla).
- QA param nuevo: &calidad=auto|hd|extra|4k|ultra.
- Gate 0117 extra: meshTexMax true, 71fps, 0 errores; badge '· máx' visible.

## v132 (2026-07-13) — pase iPad completo + bug fantasma del gate
- COMBATE MUERTO en iPad: los sticks landscape medían 52vh — la zona derecha
  invisible tapaba el FAB y capturaba el pointer. Fix: sticks 40vh landscape,
  z-index:1 explícito, FABs/sheets z-44/43 con touch-action:manipulation.
  Verificado con CDP + emulación táctil real: tap abre panel, DISPARAR baja
  munición 8→7.
- iPad = textura de desktop: tier low SOLO si pantalla <700px (un iPad M puede
  con vtx 13MB); chip calidad visible en touch (extra+ = atlas geo también en
  iPad).
- HUD táctil premium: brújula de CINTA canvas (ticks 5°, cardinales, línea de
  fe — reemplaza el pill "N 0°"), telemetría con VS m/s (barra bipolar
  mint/ámbar), cards de métricas rediseñadas (glass, tabular nums), chip ghost
  fuera en táctil, sticks más grandes (base 132/156px, nub 58/66).
- BUG FANTASMA del gate (bisect + 4 probes): report.weaponState = weapons.state
  (del refactor codex) exponía misiles/partículas con meshes THREE — 27MB y
  'Object reference chain is too long' en CDP returnByValue, PERO solo tras
  disparar → los gates fuego colgaban con consola limpia. Fix doble: resumen
  escalar en el reporte + el gate ahora serializa EN PÁGINA (JSON.stringify)
  — inmune a grafos profundos para siempre. REGLA: window.__volar solo lleva
  datos planos.
- Micro-fixes: chip ammo pintaba [object Object] desde doFire (el loop ya
  pinta por arma); report.weapons vivo en el loop (estaba congelado en el
  snapshot del autotest).
