# FLIGHTVERSE — Decisión de renderer (P1)

> **Snapshot del gate inicial.** La decisión r160 + GaussianSplats3D 0.4.7 fue
> superada por la implementación unificada three r180 + Spark 2.1. Consulta
> [GAME_ENGINE.md](GAME_ENGINE.md) para el contrato actual; la tabla se conserva como evidencia.

> Gate corrido 2026-07-11 sobre la escena 1 real (DJI_20260704160358_0104_D,
> Niza · Bogotá: DSM+orto+splat+track completos). Evidencia:
> `qa/DJI_20260704160358_0104_D-flightverse-spike.png` + reporte del gate CDP
> (`pipeline/flightverse_spike_gate.py`, Chrome headless real).

## Candidatos y tabla ponderada
| Criterio | Peso | three r160 + GS 0.4.7 (incumbente) | PlayCanvas | Babylon.js |
|---|---|---|---|---|
| Integración con lo existente (visores, splatview, share, CSP, vendor local, sin build step) | 25 | **25** — ya renderiza las escenas reales en prod | 8 — reescritura de visores | 8 — reescritura |
| Soporte splat .ksplat | 20 | **20** — GS es la lib de referencia del formato; DropInViewer probado HOY | 12 — soporte splat propio, formato distinto (conversión) | 12 — ídem |
| Perf en M4 + móvil (escena real) | 20 | **17** — spike: first frame 1.1s, 3.14M tris, 3 draw calls | 15 — motor optimizado pero sin dato propio | 14 — sin dato |
| Colisión/heightfield honesto | 15 | **13** — muestreo bilineal del dsm_lod probado (10.18m AGL) — sin física de terceros, suficiente para vuelo | 13 — física integrada (ammo) | 13 |
| Streaming/LOD de assets | 10 | **8** — progressiveLoad de GS + LOD DSM propio | 7 | 7 |
| Riesgo/bus-factor (vendor, licencia, mantenimiento) | 10 | **9** — ya vendorizado, MIT, cero deps nuevas | 6 — runtime+editor externos | 7 |
| **Total** | 100 | **92** | 61 | 61 |

## Resultado del spike (la evidencia que confirma al favorito)
Escena UNIFICADA (un WebGLRenderer, un scene graph): terreno heightfield desde
`dsm_lod256.bin` (256×234, 1.49m/celda, generado por `pipeline/dsm_lod.py`,
126MB→234KB) con textura orto + splat 1.51M vía `GS.DropInViewer`.

| Pregunta del gate | Resultado |
|---|---|
| ¿ksplat + terreno DSM en una escena? | SÍ — 3,137,584 tris (3.02M splat + 117k terreno), 3 draw calls |
| ¿Query de posición? | SÍ — bilineal sobre heightfield: 10.18m AGL en el centro |
| ¿Frame limpio capturable? | SÍ — 1.3MB PNG vía render síncrono + toDataURL (sin preserveDrawingBuffer) |
| ¿Enter/exit sin leak? | SÍ — ciclo 1 → 0 canvases/0 contextos; ciclo 2 reconstruye a la misma perf (1096→1065ms) |
| ¿Errores de consola? | 0 (el único fue favicon 404, corregido) |
| First frame | ~1.1s incluyendo carga del ksplat 36MB local |

## Decisión
**three.js r160 + GaussianSplats3D 0.4.7 (DropInViewer), WebGL — CONFIRMADO.**
El riesgo real del proyecto no era el motor sino la convivencia splat+terreno
y el ciclo de vida del contexto: ambos probados con números. Cambiar de motor
costaría los 25pts de integración para perseguir ganancias no demostradas.

## Deudas que el spike deja anotadas (van al backlog de fases)
- Bordes nodata del DSM = "dientes" visibles → emplumar/clipear máscara (P2).
- Alineación splat↔terreno pendiente: frames distintos (splat normalizado vs
  metros locales). Materia prima: `splats/<id>.cameras.json` (poses SfM, HOY
  sin consumir) + offset del centroide que `make_viewer_mesh` calcula y tira
  → SceneManifestV2 debe persistirlo (P1, parte 2).
- `progressiveLoad:false` en el spike; el mundo real usará progresivo + budget.
- Audio, MediaRecorder, WebCodecs: infra desde cero (P3/P7) — no bloquean motor.
