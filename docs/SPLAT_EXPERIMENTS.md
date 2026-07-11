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
