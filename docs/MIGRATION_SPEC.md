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
