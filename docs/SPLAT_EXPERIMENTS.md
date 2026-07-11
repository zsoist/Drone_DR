# SPLAT_EXPERIMENTS — resultados medidos (held-out)

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
