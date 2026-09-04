# Hero Cell 001 — aceptación medida

Fecha: 2026-09-04  
Rama: `feat/herocell-aaa-r0`  
Hero ID: `hero_7fc475900b2d1390`  
Veredicto: **partially accepted**

## Qué sí pasó

- Input real: `scene_0cadd1911f/recon_4e4245a1f4_aoi130`, activo, ready/full, terrain + mesh + collider v3.
- Selección determinista de cuadrado 100×100 m: centro local AeroBrain `(-20, 20)` m, score `0.599961738761`, 221 candidatos elegibles y 4 rechazados.
- Build atómico, content-addressed y reutilizable bajo `/Volumes/SSD/drone-vault/worlds/scene_0cadd1911f/hero_7fc475900b2d1390`.
- Geometría: 18.432 triángulos de referencia, 18.432 ground, 108 estructura limpia, 0 completion generado y 18.540 collision.
- Seis roles separados, matrices AB↔UE invertibles, source hashes, records de coste/run/request, materiales dentro de 256 MiB y output externo US$0.
- Truth Field real conservador: 75% `GEOMETRICALLY_INFERRED`, 25% `UNKNOWN`, 0% generated/observed en cuatro muestras de cobertura. No hay sidecar público para atribuir visibilidad por superficie, por lo que no se inventaron cámaras.
- 53 pruebas del compilador/contratos pasaron antes de este reporte; no hubo merge, push, upload privado ni gasto cloud.

## Qué no está aceptado

- El host no ofrece `UnrealEditor`/`UnrealEditor-Cmd`; el gate del importer produjo exit 2 y `blocked_external`, con cero assets importados.
- El PC RTX no respondió por SSH durante el preflight. No existen mediciones reales de avg FPS, 1% low, VRAM, ruta, hover drift, clipping, shader compile ni estabilidad Mac.
- No existen imágenes fijas Unreal ni comparación contra reference cameras porque la versión seleccionada carece del sidecar público por superficie.
- Median/p95 geométrico y silhouette contra ground truth independiente permanecen `null`, no “pass”.
- El smoke general mantiene un fallo baseline anterior a Hero Cell: hash de `ac30_cannon/ultra`. `audit_vault` dio 0 hallazgos y `audit_splats` 0 fallos; `ops_status` sólo reflejó discontinuidad histórica 24 h aunque el estado actual estaba sano.

## Decisión de expansión

La expansión a 200×200 m queda **rechazada por ahora**. Primero debe pasar el import/render Unreal real, la ruta de 30 s y los límites avg ≥60 FPS, 1% low ≥45 FPS y VRAM ≤7,2 GB en el target RTX. El contrato y el slice están implementados, pero un test estático no sustituye ese gate.

## Única acción externa pendiente

Enciende y deja accesible el PC RTX hasta que `ssh pc 'echo ready'` responda; con ese acceso puede ejecutarse el gate Unreal/RTX sin fingir resultados.
