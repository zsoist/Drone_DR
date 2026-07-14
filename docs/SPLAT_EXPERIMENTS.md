# SPLAT_EXPERIMENTS — resultados medidos (held-out)

> **Dataset experimental congelado (MPS/OpenSplat, 2026-07-11).** Sigue siendo evidencia
> válida para esas corridas, pero no prescribe el backend premium actual. CUDA de producción y
> sus tiers viven en [SPLAT_PIPELINE.md](SPLAT_PIPELINE.md).

> Regla: ningún cambio de calidad shippea sin número antes/después de este
> harness. Los negativos se registran, nunca se borran. Cada fila tiene su
> `run.json` con `params_hash` en `vault/eval/<cid>/<run_id>/`.
>
> Protocolo: split determinista (seed = clip_id → mismo split entre runs de la
> misma escena), test views excluidas del training (cirugía de
> reconstruction.json), render + GT por el camino interno del trainer
> (`--render-cameras`, patch local), PSNR/SSIM full-res + LPIPS (AlexNet, lado
> ≤1024). Los splats publicados ANTES del harness entrenaron con todas las
> vistas — cualquier eval sobre ellos es train-view reproduction, NO baseline.

**Regla de resolución (verificada 2026-07-11):** el eval compara SIEMPRE a
resolución GT completa (`render_px` en cada eval block lo evidencia) — el modo
render no hereda el `-d` del training, así que un modelo entrenado a media res
paga su pérdida de detalle en el número. Sin esto, fast@full vs ultra@half no
serían comparables y todos los deltas de Phase 2 nacerían contaminados.

**Preset de baseline = cinematic** (lo que producción entrega en esta clase de
escena). Ultra se registra igual: su techo de memoria ES parte de la baseline.

## Baseline (Phase 1) — CONGELAR al completar las 3 escenas

| Escena | Preset | PSNR | SSIM | LPIPS | train s | peak MiB | run_id |
|---|---|---|---|---|---|---|---|
| easy `…133809_0101_D` (30 cám) | cinematic | **BLOQUEADA: regresión ambiental P0** (abajo) | | | | | |
| easy `…133809_0101_D` | ultra (3 escalones) | **FAIL: OOM ×3** — el preset insignia no puede con esta escena en 16GB (~200s/escalón hasta el cap footprint 11000) | — | — | 195+241+211 | 11000 (cap) | `20260711-085950-ultra/FAILED.json` |
| grande `…133243_0100_D` (214 img) | cinematic | _pendiente_ | | | | | |
| multi-source test #2 (0103+0104) | cinematic | _pendiente: regenerar recon_ | | | | | |

Nota de contexto: los `peak` del run ultra fallido son RSS (subestiman MPS ~20×
— medido en vivo: RSS 489 MiB vs phys_footprint 10 GB en el mismo proceso).
PeakTracker corregido a `phys_footprint_peak` del kernel DESPUÉS de ese run;
todos los runs siguientes reportan `peak_source: phys_footprint`. Las baselines
corren con la máquina desacoplada del worker (headroom ≥ producción) —
`machine_load` en cada run.json lo registra.

## Referencia (no baseline)

| Escena | Preset | PSNR | SSIM | LPIPS | train s | peak MiB | run_id | Nota |
|---|---|---|---|---|---|---|---|---|
| easy `…133809_0101_D` | fast | 14.41 | 0.3935 | 0.7477 | 50.2 | 672 | `20260711-084640-fast` | shakedown del harness; side-by-side confirmó poses alineadas |

## Experimentos Phase 2 (uno por fila, una variable por run)

| Lever | Escena | PSNR Δ | LPIPS Δ | train time Δ | peak MiB | Veredicto |
|---|---|---|---|---|---|---|
| _2.0 SH 0→N (fix NaN)_ | | | | | | _pendiente de baseline_ |

## Protocolo experimento 2.0 (SH-fix) — PRE-declarado (review 11-jul)
COLISIÓN DE PRESUPUESTO: SH 0→3 = 3→48 coefs/gaussiana (~3-4× params+Adam).
La cota 55KB/gaussiana y todo el preflight se midieron A SH=0 — inválidos para
SH=3. Orden obligatorio: (1) REPRODUCIR el NaN (step, tensor, causa: ¿lr de SH
en MPS? ¿fp16? ¿exposición variable?) — sin diagnóstico no hay experimento,
hay ruleta; (2) re-medir KB/gaussiana con SH activo (run corto instrumentado)
→ nuevo conteo máximo bajo cap; (3) comparación PRESUPUESTO-IGUAL: SH=3-bajo-cap
vs SH=0-bajo-cap, cada uno al conteo que su presupuesto permita (NO conteo
igual). Pregunta real: ¿cuánto LPIPS compra el color view-dependent a costa de
la densificación perdida? (4) MÉTRICA PRE-DECLARADA: LPIPS decide; PSNR y el
side-by-side de ojo VETAN (LPIPS mejor + artefactos nuevos visibles = FAIL).
Decidir la métrica después de ver resultados = p-hacking.

## Sweep escena 1 (en curso)
- A: medium → PSNR 14.14 / SSIM 0.356 / LPIPS 0.572, bajo cap ✅ (trained_binary
  clean-9fb62fd, anotado). Divergencia PSNR↔LPIPS vs fast: PSNR premia blur.
- B: cinematic-acotado (7000 it, thresh 0.0008, refine 300) — corriendo.
  Proyección: conteo ~180k ≤ 85% cap vía 55KB/gaussiana.
- Fila baseline escena 1 = la que domine cuando B termine. NO congelar antes.
- B FALLÓ: OOM 10925 a step 3430 — PASÓ el salto de resolución del schedule
  (¼→½ en 3000) y los buffers ×4 lo mataron. El bounding de conteo compró
  1200 steps vs cinematic (~2200). Memoria = f(conteo × resolución): el SALTO
  del schedule es driver. Punto C candidato: B + --num-downscales 3 o
  --resolution-schedule 8000 (nunca dobla en 7000 iters) — trade: detalle final.
  Fila baseline escena 1 provisional = medium (único >fast bajo cap hoy).

## Forma funcional del presupuesto (serie instrumentada, 11-jul)
peak(step) ≈ conteo×g(res) + B(res). MEDIDO en re-run de B: pre-salto 2.39
MiB/step; salto ¼→½ = ESCALÓN +1336 MiB (aditivo) Y pendiente ×1.55 → 3.71
MiB/step (multiplicativo). AMBOS términos existen. serieB/series.csv = evidencia.
- C (7000 it, nunca dobla) PRE-CONDENADO por aritmética: pendiente sola toca cap
  a ~step 3700. Noche ahorrada — no se corre.
- D (derivado de la curva): 3000 steps, acotado, schedule 8000 → proy. 84% cap.
  CORRIENDO. Es la "C afilada": steps extra dentro del régimen ¼.
- CUARTA FILA (review): "resolución temprana bajo cap" — salto a ½ en step ~500
  con conteo acotado agresivo: ~4GB + 1336 + 3.7/step ≈ ~1700 steps de
  presupuesto a ½. CONSTRUIBLE (full-res NO cabe: 2º escalón+pendiente).
  Se corre tras D. Si gana en LPIPS → la resolución era el lever dominante;
  si pierde → régimen ¼ es el techo real y SH/appearance quedan confirmados
  por eliminación como únicos levers (rama estructural, 3er sospechoso:
  PSNR~14 puede ser resolución ¼-vs-GT-full, más barato de probar que el NaN).
- REGLA DE TABLA: toda fila lleva train_res_regime (¼ | ½@N | full@N) — el
  número viaja con su régimen de medición.

## Fila escena 1 — CERRADA provisional (11-jul, 5 puntos medidos)
| punto | régimen | PSNR/SSIM/LPIPS | peak (proy→obs) |
|---|---|---|---|
| fast 1000 | ¼ | 14.41/.394/.748 | — |
| **medium 2000** | ¼ | **14.14/.356/.572** ← FILA | — |
| D 3000 acotado | ¼ | 14.23/.375/.640 | 9240→7449 (−24%) |
| B 7000 acotado | ¼→½@3000 | OOM @3430 | ≤85%→10925 |
| E 2000 acotado | ½ íntegra | 14.30/.386/.696 | 6749 (61%) |
LECCIONES MEDIDAS: (1) conteo > steps (D pierde vs medium con +1000 steps);
(2) conteo > resolución a este presupuesto (E a ½ pierde vs medium a ¼);
(3) la pendiente MiB/step es config-dependiente (proyección D erró −24%,
conservadora). CELDA ABIERTA: E' = ½ + densificación agresiva (E dejó 4GB sin
usar) — candidata si algún lever de Phase 2 la necesita. TERCER SOSPECHOSO del
PSNR~14 (res ¼) DEBILITADO: pagar ½ empeoró LPIPS → SH=0 + exposición quedan
al frente por eliminación parcial. Experimento 2.0 re-confirmado como el
siguiente, con su protocolo pre-declarado. Siguiente: escenas 2-3 (con punto-½
propio de diseño), tabla congelada.

## E' (presupuesto-igual, cierra la escena 1 DE VERDAD) — corriendo 11-jul
½ íntegra + densificación agresiva (0.0003/150) apuntando ~85% cap. Lecturas
pre-escritas: E' pierde → "densificación es el uso dominante del presupuesto"
DEMOSTRADA con presupuestos iguales, fila medium inatacable, y la vara del 2.0
SUBE (el SH-fix compite por el mismo presupuesto que el lever dominante: debe
comprar más LPIPS del que pierde cediendo conteo). E' gana → LA FILA cambia,
tercer sospechoso (res ¼) revive. Escenas 2-3: puntos dirigidos a FALSIFICAR
las leyes (¿medium-equivalente cabe con 214 img? ¿el estratificado protege a
las fuentes?), no a repetir el sweep — 2-3 puntos por escena, proyectados.
CANARIO: agendado explícito como ítem 1 de la sesión fresca (fin del limbo).

## ESCENA 1 — CERRADA (11-jul, presupuesto-igual satisfecho)
Medium re-run instrumentado: peak 6992 (63.6%) — MISMA clase de gasto que E'
(6763, 61.5%). LEY DEMOSTRADA con presupuestos iguales: **densificación
agresiva a ¼ > resolución ½ al mismo gasto** (LPIPS 0.567 vs 0.630).
FILA DEFINITIVA: medium — LPIPS 0.567±0.005 (reproducido: 0.572/0.567),
PSNR 14.2±0.13, peak ~7GB, régimen ¼, trained clean-9fb62fd.
Reproducibilidad del harness: ±1% LPIPS entre runs idénticos (incertidumbre
de tabla). Nota de modelo (5ª corrección): TODOS los presets sub-cap aterrizan
en 61-64% — la densificación se auto-limita a 2000 iters; la presión del cap
viene de runs LARGOS donde el conteo compone. Vara del 2.0: ALTA (el SH-fix
compite contra el lever dominante demostrado). Siguiente: escenas 2-3 como
falsificación dirigida → tabla congelada → 2.0. Canario = ítem 1 sesión fresca.

## Precisiones de cierre (review 11-jul noche)
1. FORMULACIÓN EXACTA de la ley: "al gasto que ambas configs alcanzan
   NATURALMENTE (~7GB), densificación ¼ > resolución ½". Región 64→85% sin
   explorar. HALLAZGO IMPLÍCITO: **el cap NO es vinculante para presets
   clase-medium en esta escena** — los OOMs del arco fueron todos por el salto
   de resolución, nunca por conteo puro a ¼; la escena satura su densificación
   bajo el presupuesto. Escena 2 (214 img) = primer test con el cap MORDIENDO.
2. Reproducibilidad ±1% LPIPS: n=2, estimación PRELIMINAR — tercer punto gratis
   con el re-run de control de escenas 2-3.
3. VARA DEL 2.0 BAJÓ: cap no-vinculante → SH degree 3 (3→48 coefs + Adam) sobre
   el conteo de medium probablemente CABE en los 4GB de headroom → caso (a)
   comparación a CONTEO IGUAL (la versión más pura: mismas gaussianas ± color
   view-dependent, LPIPS responde la pregunta limpia). Si la proyección del
   modelo (5 cláusulas) dice que no cabe → caso (b) con cesión de conteo, vara
   alta. La proyección decide el caso ANTES de quemar el run = 6º test del
   modelo. El NaN sigue yendo PRIMERO — nada importa si la divergencia no tiene
   causa arreglable. Tabla: anotar "gasto natural vs cap" por fila.

## GUARDA para escenas 2-3 (review de cierre, 11-jul)
"Es solo ejecución" precedió al P0, a la colisión de presupuesto y a la
corrección de la serie — el patrón del arco. Tratamiento obligatorio:
- Escena 2 (214 img): proyección PRE-escrita (7× puntos iniciales; las 5
  cláusulas del modelo se midieron con 30 cám — territorio nuevo); evento con
  cifras clave cableadas; presupuesto de ≥1 celda no planeada.
- Escena 3: la regen multi-source es el PRIMER ejercicio real del merge gate
  post-refactor — es un test propio ANTES de entrenar nada. Mismo tratamiento.
Si son aburridas: 10 min perdidos. Si no: el diagnóstico ya tiene marco.

## Escena 2 (214 img) — TERCER TÉRMINO del modelo + régimen decidido (11-jul)
La guarda pagó ANTES de encolar: sondas de 50 iters revelaron que OpenSplat
carga TODAS las imágenes upfront como tensores (~64MB/img float32 a 3072px) →
**escena 2 muere EN LA CARGA a full-res** (214×64MB≈13.7GB > cap; log termina
a mitad de Loading sin error = SIGKILL). Con -d 2 completa. VEREDICTO: el
régimen de la escena 2 es -d 2 DESDE LA CARGA — decidido por hardware, anotado
como condición de todas sus filas. MODELO DE MEMORIA gana su 3er término:
base_imgs ≈ n_train × px_w × px_h × 12B / d² — dominante en escenas grandes,
invisible en la escena 1 (22 imgs = 1.4GB). El "PASS" pre-cap del 7-jul de
esta escena (55MB splat) era otro swap-swim. U1.3 (preflight) hereda el
término: es el PRIMER check, antes que densificación (barato y determinista).
Celda escena 2: (c-extrema) → fila 1 = medium@-d2, corriendo.

## Escena 2 — CERRADA (2 puntos dirigidos, 11-jul)
| fila | LPIPS | PSNR | peak | veredicto |
|---|---|---|---|---|
| medium@-d2 (agresivo) | **0.615** ← FILA | 13.53 | 8354 (76%) | error dominante: alta frecuencia (fachadas/vegetación), sin floaters ni deriva expo — firma del régimen -d2 |
| acotado@-d2 | 0.628 | 13.57 | 8085 | LA LEY VIAJA con margen ENCOGIDO (Δ0.013 vs Δ0.058 escena 1): en régimen mordido la base aplana la ventaja |
Régimen: -d2 desde carga (hardware), split 193/21, render GT full verificado.

## Escena 3 — EN CURSO: doble gate (leyes + entity E2E)
Encolada por /api/odm real: **recon_c97cd120a1** (0103+0104, estandar) — primer
combinado con identidad propia en producción. Checklist E2E al completar:
merge_label FULL esperado (test #2: 17,006 matches) · card renderiza (join
null-safe) · share ?m=recon_… · visor · splat → luego fila eval con split
estratificado por fuente (by_source en el eval block).

### Reglas de lectura escena 3 — PRE-escritas (review, antes del veredicto)
1. ORDEN: merge_label primero (gate entity/pipeline), eval después (gate
   calidad) — NO se mezclan. FULL con by_source desbalanceado = "merge OK,
   calidad no uniforme"; PARTIAL con buen LPIPS global = "bueno DE LO QUE
   QUEDÓ". Si label ≠ FULL: sospechoso 1 = plumbing recon_/--proj-id
   (prefijos/geotag), NO la geometría — absuelta por test #2 (17,006 matches,
   estas fuentes exactas, vía harness; esto corre vía producción).
2. by_source estrena regla provisional de desbalance: con repro ±1% (n=2) y
   ~4-6 vistas/fuente, ΔLPIPS per-source <0.03 = ruido de muestreo probable;
   >0.08 = señal (fuente peor reconstruida); entre medio = se anota sin
   concluir. Confound conocido: las vistas de cada fuente miran partes
   DISTINTAS de la escena (contenido, no solo fuente).
3. E2E que los fixtures no cubren: card → share ?m=recon_… → visor → carga
   del splat, camino completo de producción. Si pasa, la entity queda
   EJERCIDA, no solo migrada.
4. Tabla: verificar qué régimen (-d) eligió el camino de producción ANTES de
   comparar LPIPS. Cabecera: deltas comparan DENTRO de escena; entre escenas
   viajan solo firmas cualitativas.

### Escena 3 — dos adendas pre-veredicto (review de medio vuelo)
5. RÉGIMEN PROPIO SILENCIOSO: producción eligió 2688px (perfil balanced) — ni
   3072 (escenas 1-2 origen) ni 1536 (-d2). La fila 3 estrena
   train_input_px:2688 y su GT de eval será 2688-based → render_px esperado
   [2687,~1511], NO [3071,1727]. Verificar AL CORRER el eval, no tras leer el
   LPIPS. GT/render consistentes entre sí = válido; "full GT" significa otra
   cosa en esta fila (anotar).
6. EL VEREDICTO TESTEA EL PRUNING, no solo la entity: 81 frames (23+58, poda
   activa) vs 169 del test #2 (sin poda, a propósito). TERCERA RAMA pre-escrita:
   FULL con 81 = resultado MÁS FUERTE que test #2 (el merge sobrevive a la poda;
   la enmienda "nunca dedup cross-source" validada en producción). PARTIAL =
   sospechoso nuevo: la poda comiéndose frames-ancla de una fuente (hipótesis
   del review #4 sesión 1) — ni plumbing (pre-absuelto con artefactos) ni
   geometría (test #2).

# ══════════ TABLA BASELINE CONGELADA — 2026-07-11 ══════════
Regla de cabecera: deltas comparan DENTRO de escena; entre escenas viajan solo
firmas cualitativas. Todos los runs: split determinista seed=cid, test excluido
del training, render+GT por camino interno del trainer, GT a resolución del
régimen (render_px en cada eval block), preset=medium (el que cabe bajo cap).

| Escena | LPIPS | PSNR | SSIM | peak (cap%) | régimen | error dominante (ojo) | run_id |
|---|---|---|---|---|---|---|---|
| 1 easy 30cám | **0.567±0.005** (n=2) | 14.2±0.13 | 0.357 | 6992 (64%) | ¼-schedule @3072 | blur global uniforme | 20260711-135601-medium |
| 2 grande 214img | **0.615** | 13.53 | 0.355 | 8354 (76%) | -d2 desde carga (hardware) | alta frecuencia (fachadas/vegetación), 0 floaters, 0 deriva expo | 20260711-142911-medium_d2 |
| 3 multi 0103+0104 | **0.667** | 11.16 | 0.255 | 8801 (80%) | 2688 balanced (producción) | desplazamiento pose/parallax en vistas cross-source + blur periférico; SIN banding expo | 20260711-144810-medium |

Escena 3 extra: merge FULL bajo poda (22/23+57/58); by_source Δ = ruido
(ΔPSNR 0.07, ΔSSIM 0.024, n=2/6 — bajo umbral 0.03; nota: by_source aún sin
LPIPS per-view — agregar antes del 2.0). Identity recon_c97cd120a1 (entity E2E ✓).

LEYES (validez anotada): densificación agresiva > steps > resolución a
presupuesto-igual (escena 1, verificada escena 2 con margen encogido Δ0.013);
cap no vinculante en escenas chicas (1: 64%), mordido en grandes (2-3: 76-80%).

SOSPECHOSOS PHASE 2 POR ESCENA (del ojo, no del promedio): escena 1 → SH=0 +
resolución ¼ (E' debilitó resolución); escena 2 → resolución de carga (bloqueada
por hardware/cap); escena 3 → POSE cross-source (2.1) sobre appearance (2.2) —
el multi-source nominó a pose refinement, que OpenSplat NO expone (migración).
El 2.0 (SH) corre en escena 1 con su protocolo pre-declarado; el caso de 2.1
acaba de ganar su primera evidencia de producto.
# ═══════════════════════════════════════════════════════════

### Protocolo 2.0 — adenda a la rama "supervivencia" del NaN-repro (pre-escrita)
Si el repro sobrevive 3000 steps: NO "el fantasma murió" — absuelve ESTA celda
(esta config, esta escena, este conteo, MPS); no absuelve cinematic@7000 con
densificación completa (donde producción lo habría sufrido), ni sabemos en qué
celda se diagnosticó originalmente el workaround. Lectura: "no reproducido en
la celda probada → SH se LIBERA para el 2.0 con NaN-WATCH activo" (detección
de nan en loss → abort con step+contexto, no crash silencioso — el abort_re
del run_tracked ya lo hace en producción; el harness lo hereda). Si el 2.0
completo también sobrevive → el workaround muere con evidencia de DOS celdas
y el watch queda como guardia permanente barata. Canario: corridas 1-4
CALIBRAN, no alertan (umbrales a priori → re-derivar de la serie al mes).

### NaN-repro: SOBREVIVIÓ (11-jul) — celda absuelta, no fantasma muerto
3000 steps, SH degree 3, salto en 1000, MPS: CERO nan en loss (0.081 final,
modelo 67MB — los 48 coefs visibles vs ~13-25MB de SH=0). Nota de proceso: el
monitor gritó "NaN" por matchear el NOMBRE del dir nan-repro/ — falso positivo
de mi propio naming, corregido leyendo el log. El 2.0 corre con NaN-watch
(abort_re ya existe en producción; el harness lo hereda). Paso 1 del protocolo: ✓.
Siguiente del 2.0: proyección de memoria con el modelo de 3 términos
(el 67MB@3000steps ya insinúa el término de conteo×48coefs) → caso a/b → run.

# ═══ Phase 2 — experimentos vs baseline-v1 ═══

## 2.0 SH-liberado — VEREDICTO: NEGATIVO con mecanismo nombrado (11-jul)
| celda | LPIPS↓ | PSNR | peak (proy→obs) | n | régimen | ojo |
|---|---|---|---|---|---|---|
| SH=0 (baseline-v1) | 0.567±0.005 | 14.2 | 6992 | 8 | ¼@3072, 2000it | borroso, LIMPIO |
| SH=3, interval 1000 | 0.5675 (empate) | 14.18 | 7032→6668 (−5%, test nº7 ✓) | 8 | idem | VETADO: streaks direccionales |
| SH=1, interval 1000 | 0.648 | 11.2 | 7005→6290 | 8 | idem | DESTRUCCIÓN total (esquirlas) |

LECTURA (pre-declarada, rama 3 ejecutada; CLÁUSULA obligatoria): el workaround
protegía la calidad **en OpenSplat, a 2000 iters, con transición mid-run** — la
evidencia condena LA TRANSICIÓN VIOLENTA EN ESTE TRAINER, no SH per se.
SH-desde-step-0 (como lo entrenan splatfacto/gsplat, con LR schedule propio
para coefs) NO está testeado *porque OpenSplat no lo expone* — es motivo de
migración, no conclusión sobre SH. Mecanismo: la TRANSICIÓN (activar
coefs SH a mitad del run, step 1000) desestabiliza la optimización; degree
menor NO suaviza (1 << 3 en calidad). En MPS ya no diverge (repro: 0 nan/3000
steps) pero destroza igual. El veto del ojo salvó la conclusión: LPIPS promedió
los streaks de SH=3 contra la ganancia de color y reportó "empate inofensivo" —
edición perceptual del falso 82%.
IMPLICACIONES (pre-escritas, ejecutan): (a) appearance/exposición (2.2) SUBE a
sospechoso principal del techo de calidad; (b) la MIGRACIÓN de trainer revive
con doble motivo — 2.1 pose (nominado por escena 3) y ahora SH-desde-step-0 /
LR-warmup de coefs (cirugía que OpenSplat no expone); (c) el workaround se
QUEDA (con razón documentada, ya no folklore). SIGUIENTE candidato 2.0b (NO
corrido hoy — cero levers extra): sh activo desde step 0 vía --sh-degree-interval
mínimo... NO existe como semántica en OpenSplat (interval=1 sube degree cada
step: transiciones ×3) — confirmar semántica antes de diseñarlo; probablemente
cae en la misma cirugía. Costo total del experimento: 2 celdas × ~95s + evals.

### Evidencia del motivo "pose cross-source" (rastro completo, pedido del review)
Origen: firma de OJO de la fila 3 de baseline-v1 — side-by-side
eval/recon_c97cd120a1/20260711-144810-medium/renders/sxs_0_s0_f_0003.jpg.jpg:
vista s0_ (fuente 0103) muestra DESPLAZAMIENTO de encuadre/pose vs GT (contenido
correcto, posición corrida) + blur periférico; SIN banding de exposición pese a
dos condiciones de luz. Corroboración numérica débil: PSNR de la escena 11.16
(vs 13.5-14.2 single-source) con by_source parejo — consistente con error de
pose GLOBAL de la fusión, no con una fuente mala. Estado: firma de ojo n=1
+ corroboración indirecta — motivo VÁLIDO para la matriz de migración, con su
peso honesto (no es un delta medido de pose; medirse requeriría re-optimización
de poses, que es... el lever bloqueado). Nota case study 2ª ed: "el negativo
barato es el producto final de la infraestructura cara" (línea del review).
