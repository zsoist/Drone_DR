# Hero Cell: model intake

Ningún modelo nuevo influye producción sin un registro `model_intake.v1`: licencia del código y pesos, SHA-256 del checkpoint, política de salida de datos, hardware medido, memoria, runtime, determinismo, intended use y veredicto.

## Reglas

- Falta de licencia o hash: `rejected`.
- Upload de datos privados sin opt-in explícito: `rejected`.
- Pesos no comerciales: como máximo `research-only`.
- Modelo no ejecutado o performance sin medición local: `research-only`.
- Sólo un modelo evaluado, local y comercialmente compatible puede ser `production`.

## Baseline y candidatos

| Sistema | Estado R0 | Razón |
|---|---|---|
| ODM/OpenSfM/OpenMVS ya publicado | production baseline | Los artefactos versionados son el input real; el compilador no reentrena ni sube datos. |
| MapAnything | not evaluated / research-only | No descargado ni ejecutado. |
| Depth Anything | not evaluated / research-only | No descargado ni ejecutado. |
| VGGT | not evaluated / research-only | No descargado ni ejecutado. |
| World Labs u otros servicios cloud | rejected para datos privados sin opt-in | R0 tiene presupuesto externo US$0 y no permite egress. |

Las etiquetas anteriores no afirman compatibilidad comercial de candidatos no inspeccionados; sólo registran que no forman parte del build R0.
