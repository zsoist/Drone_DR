# Spec de migración de trainer — investigación con criterio PRE-declarado

> Congelado 2026-07-11, ANTES de mirar candidatos (después ya no es pre-declarado).
> Motivos con evidencia: 2.1 pose cross-source (firma de ojo escena 3, n=1 +
> corroboración indirecta — peso honesto) y SH-desde-step-0 (el 2.0 demostró que
> la transición mid-run de OpenSplat destroza; SH bien entrenado NO está testeado
> porque OpenSplat no lo expone). OpenSplat 1.1.5 no expone ninguno de los dos.

## ADVERTENCIA ESTRUCTURAL: el sesgo del instrumento juega para el incumbente
Todo lo construido está entrenado en UN trainer: el modelo de memoria (pendientes
DE OpenSplat), el harness (su formato de salida, el patch --render-cameras que es
NUESTRO), las constantes (su allocator MPS), el NaN-watch. Consecuencias:
- El modelo de 3 términos NO viaja: las proyecciones para el candidato son
  hipótesis nuevas, no herencia. Re-calibrar desde sus propios cadáveres.
- El harness puede tener supuestos OpenSplat-shaped invisibles (convención de
  poses, formato de cámaras, modo de render de eval).
- **Fase de re-instrumentación del candidato es OBLIGATORIA y presupuestada
  ANTES de comparar nada** — o la comparación nace torcida a favor del local.

## El criterio del switch — TRES columnas, no una
1. **PARIDAD BAJO CAP**: el candidato reproduce baseline-v1 (escena 1, MISMO
   split determinista, LPIPS dentro de 2σ = ±0.01) cabiendo en 16GB por worker
   path. Sin paridad no hay conversación — los levers no compensan base rota.
2. **UN LEVER BLOQUEADO, DEMOSTRADO**: pose refinement o SH-desde-0 corriendo
   en MPS con mejora MEDIDA contra su propia paridad (no contra el README —
   la tabla de levers se verifica con runs, no con docs; lección del audit 1).
3. **COSTO OPERATIVO ACOTADO**: tiempo de entrenamiento ≤2× OpenSplat en la
   misma escena + re-instrumentación (harness, modelo de memoria, preflight)
   ESTIMADA EN SESIONES — el precio real de migrar no es el benchmark, es
   re-validar todo lo que hoy funciona.

**OPCIÓN HÍBRIDA (en el diseño, no como consuelo)**: si gana (1)+(2) pero (3)
explota → migración PARCIAL: el candidato solo para reconstrucciones que
necesiten pose cross-source (multi-source), OpenSplat para el resto. El job
spec ya distingue recon_ de single-source — el routing existe.

## Fases
- **M0 — matriz en papel**: candidatos (splatfacto/nerfstudio, gsplat directo,
  + el campo 2025-26 que haya madurado — BÚSQUEDA FRESCA el día que arranque,
  no memoria del modelo). Riesgo CUDA-only verificado contra docs ANTES de
  instalar nada (varios features de gsplat lo son — audit 1). Salida: 1-2
  candidatos instalables con soporte MPS verificado en papel.
- **M1 — paridad o muerte**: el sobreviviente corre escena 1 con el split de
  baseline-v1, por worker path, bajo cap. Incluye la re-instrumentación mínima
  (eval de su formato de salida + PeakTracker sobre su proceso). Columna 1.
- **M2 — el lever estrella**: pose refinement (motivo de producción: escena 3)
  medido contra la paridad de M1, mismo split multi-source. Columna 2.
- **M3 — matriz completa → decisión**: las tres columnas con números →
  switch / híbrido / stay. Si migra: **baseline-v2 con changelog** (el trainer
  es contexto de medición; v1 no se toca). Si stay: los motivos quedan
  documentados con los números que no alcanzaron.

## Gates
| Fase | Gate |
|---|---|
| M0 | matriz con MPS verificado en docs; cero instalaciones antes del gate |
| M1 | paridad ±2σ bajo cap por worker path, o candidato descartado con número |
| M2 | delta de pose medido (LPIPS + ojo con firma nombrada) vs paridad propia |
| M3 | decisión citando las 3 columnas; baseline-v2 solo si switch/híbrido |

# ═══ M0 EJECUTADA — 2026-07-11 (búsqueda fresca, cero instalaciones) ═══

## Matriz (evidencia de 2° orden citada por celda)
| Candidato | MPS/Metal training | Pose refinement | SH desde 0 | I/O | Re-instrum. (est.) | Madurez |
|---|---|---|---|---|---|---|
| **Brush** (ArthurBrussee) | ✓ por arquitectura (Burn/CubeCL→wgpu→Metal); claim genérico "macOS", SIN doc explícita de Metal-training — verificar en M1 | **NO DOCUMENTADO** | probable (3DGS estándar) — NO documentado | COLMAP/nerfstudio → .ply/.compressed.ply; CLI headless | 2-3 sesiones (OpenSfM→COLMAP export + eval de su .ply + modelo memoria desde 0) | v0.3.0 sep-25, Apache-2.0, 4.3k★, 1205 commits, docs jun-26, 25 issues |
| **msplat** (rayanht) | ✓ NATIVO — pipeline entero en Metal shaders fusionados; benchmarks propios M4 Max (7K iters: 77s garden; PSNR 25.68 vs gsplat 26.30) | NO ("sin optimización de cámaras" declarado) | ✓ probable (SH fwd/bwd fusionado sin schedule dinámico) | COLMAP/nerfstudio/Polycam → PLY + checkpoints resume; CLI headless + --eval | 2 sesiones (idem + su --eval nativo puede acortar) | v1.1.3 mar-26, Apache-2.0, **11 commits, 37★, ~1 contributor** — riesgo bus-factor |
| splatfacto/nerfstudio | ✗ DESCARTADO: issue #3290 "fails to run on Apple Silicon" (Torch not compiled with CUDA); gsplat #163 "MPS Support?" abierto — gsplat es CUDA | (tiene, pero inaccesible) | (tiene) | — | — | el riesgo CUDA-only del audit 1, confirmado por el campo |
| splat-apple (ghif) | ✓ claim (MLX+MPS) | claim dudoso del doc | claim | COLMAP | — | ✗ DESCARTADO: 20 commits, 27★, sin releases, **sin licencia declarada** |
| OpenSplat upstream | (incumbente) | NO — sin releases post-1.1.4 con levers | NO (el 2.0 lo demostró) | — | 0 | quedarse no compra levers |

## HALLAZGO CLAVE de M0
**Ningún candidato MPS-viable documenta pose refinement** — el motivo de producción
nº1 (escena 3) puede NO estar disponible en el campo Metal actual. La columna 2
del criterio probablemente solo es satisfacible vía SH-desde-0. Consecuencia
honesta: la migración compraría SH bien entrenado + (msplat) velocidad ~4×, pero
el lever de pose podría requerir trabajo upstream en cualquier candidato — eso
entra a la matriz de M3 como costo, no se descubre después.

## VEREDICTO M0: rama (b) — DOS candidatos cercanos → M1 corre AMBOS
- **Brush**: madurez/comunidad/multi-plataforma, levers sin documentar (M1 los
  verifica con runs, no con README — regla del audit 1).
- **msplat**: Metal-nativo con benchmarks publicados y --eval propio, pero
  bus-factor 1 y 11 commits — la paridad de M1 es también su test de madurez.
- Común: entrada COLMAP → puente OpenSfM→COLMAP (opensfm export existe en el
  contenedor ODM) es prerequisito compartido de M1, se construye UNA vez.
Costo rama (b): una sesión extra. Beneficio: la decisión más cara del arco no
se toma con n=1. M1: paridad o muerte en escena 1, split de baseline-v1.

## Pre-escritos de M1 (review post-M0 — ANTES del primer benchmark)
**LA RAMA STAY, CON DIGNIDAD**: el caso de migración quedó sostenido por UN
lever no demostrado (SH-desde-0; pose no existe en el campo MPS). Si M1 da
paridad pero M2 muestra SH-desde-0 moviendo LPIPS <0.02 en escena 1 → veredicto
STAY: OpenSplat + workaround justificado + preflight es un sistema que funciona
e instrumentado hasta los dientes. La inversión en M1 compra INFORMACIÓN, no
compromiso — volver a casa es veredicto, no derrota. (Escrito antes del puente
para inmunizar contra el sunk cost de "ya llegamos hasta acá".)
**PUENTE OpenSfM→COLMAP = infraestructura del harness con gate propio**:
validar round-trip con el INCUMBENTE como control antes de que ningún candidato
entrene — cámaras exportadas re-verificadas contra reconstruction.json dentro
de tolerancia numérica, y PRESERVACIÓN de nombres (el split determinista
train/test filtra por nombre — el puente debe mantenerlos). Si un candidato
falla paridad, el puente ya está absuelto (lección del plumbing pre-absuelto).
**ORDEN M1**: Brush primero (madurez → menos riesgo de morir en instalación),
msplat segundo. LECTURAS: ambos paridad → M2 decide · uno → pasa, el otro
documentado con causa (instalación/crash/calidad son diagnósticos distintos) ·
ninguno → rama (c) revive con evidencia de 1ª mano, STAY por walkover +
re-evaluación calendarizada.
**EXPECTATIVA**: el 77s/7K de msplat es marketing hasta reproducirse (M4 base
< M4 Max, 16GB compartidos); la velocidad es dato de columna 3, no titular —
el número que importa es LPIPS contra 0.567±0.005 en el MISMO split.

## PUENTE OpenSfM→COLMAP — GATE PASADO (11-jul)
`opensfm export_colmap` (dentro del contenedor ODM, binario en
/code/SuperBuild/install/bin/opensfm/bin/opensfm) → cameras.txt + images.txt +
points3D.txt (init de gaussianas ✓) + database. Round-trip contra
reconstruction.json: 30/30 nombres preservados (split determinista viaja),
error de centro de cámara max 6.2mm / media 3.6mm en frame topocéntrico —
**sub-GSD** (37mm/px): invisible para el training. Nota de honestidad: la
primera tolerancia (1e-3 abs) era arbitraria y "falló"; el umbral con principio
es err < GSD — declarado con razón, no ajustado al resultado. El puente queda
ABSUELTO por adelantado: si un candidato falla paridad, es del trainer.

## Marco fino M1-Brush (pre-run, review)
- PARIDAD = defaults de Brush + budget comparable (ELEGIDO: iters-similar a
  medium=2000; anotado). Forzarlo a imitar config de OpenSplat = sesgo del
  incumbente sutil (evaluar al candidato por su capacidad de ser OpenSplat).
- PRE-DECLARADO M1+M2 colapsado: si Brush trae SH-desde-0 por default y LPIPS
  sale notablemente < 0.567 → es paridad+lever EN UN RUN ("ganó por lever
  activo", no "por mejor trainer"); el desglose exige run con SH off si lo
  permite. No adjudicar en caliente.
- MEMORIA: wgpu puede reservar pools upfront (footprint alto estable) vs
  libtorch incremental — la sonda corta captura TRAYECTORIA, no solo peak;
  el %cap de Brush entra con nota de familia distinta.
- PROCEDENCIA: trainer brush-vX, args efectivos EXPLÍCITOS (defaults
  capturados), puente citado. Si muere en instalación/crash: causa con fecha
  = dato del campo citable en la re-evaluación.

## M1-Brush: SONDA PASADA, compat de PLY pendiente (11-jul noche)
✓ SMOKE: Brush v0.3.0 (binario oficial arm64) ENTRENA en Metal en el M4 —
  800 steps sobre el export del puente sin fricción de formato de entrada;
  headless por defecto; export_800.ply (4MB) producido.
✓ TRAYECTORIA wgpu (como se pre-escribió, familia distinta): pico temprano
  ~2.6GB → ESTABLE 1.8GB — no crece como libtorch; --max-splats = presupuesto
  DURO (MCMC), el lever anti-OOM que la escalera nunca tuvo. NO leer "usa menos"
  hasta run completo comparable.
✓ CLI: --sh-degree (desde 0, MCMC), --seed, --eval-split-every +
  --eval-save-to-disk (equivalente NATIVO de --render-cameras) → re-instrum. ≈1 sesión.
✗ COMPAT PLY con nuestro renderer: FALLA con causa nombrada — dialecto:
  (a) loadPly exige comment "at iteration N" (parcheable), (b) orden LÉXICO de
  f_rest_* (0,1,10,11...), (c) "Vertical axis: y", (d) layout de propiedades
  distinto → "Invalid PLY file" tras parchear (a).
SIGUIENTE (2 caminos, elegir en sesión fresca): (1) conversor PLY Brush→dialecto
opensplat (~40 líneas numpy: reordenar f_rest, ejes, header) → paridad
apples-to-apples con los MISMOS 8 test views; (2) plan B: eval nativo de Brush
(--eval-split-every) con nota de split distinto + GT-path distinto (el confound
que el conversor evita). El camino 1 preserva el estándar del arco.
Luego: export COLMAP train-only (cirugía ya existente) → paridad 2000 steps
→ msplat con el mismo marco.
