# Hero Cell 001 — aceptación medida

Fecha: 2026-09-04  
Rama: `feat/herocell-aaa-r0`  
Hero ID: `hero_ad3bb01dd71f6b4d`
Veredicto: **partially accepted**

## Qué sí pasó

- Input real: `scene_0cadd1911f/recon_4e4245a1f4_aoi130`, activo, ready/full, terrain + mesh + collider v3.
- Selección determinista de cuadrado 100×100 m: centro local AeroBrain `(-20, 20)` m, score `0.599961738761`, 221 candidatos elegibles y 4 rechazados.
- Build atómico y content-addressed bajo `/Volumes/SSD/drone-vault/worlds/scene_0cadd1911f/hero_ad3bb01dd71f6b4d`.
- Geometría: 18.432 triángulos de referencia, 18.432 ground, 108 estructura limpia, 0 completion generado y 18.540 collision.
- Seis roles separados, matrices AB↔UE invertibles, source hashes, records de coste/run/request, materiales dentro de 256 MiB y output externo US$0.
- Evidencia real: 428 poses OpenSfM transformadas a coordenadas locales, ocho reference cameras y mapas 97×97 de confidence, provenance y cámara dominante. Frustum + ray-march DSM registra 4–336 cámaras por muestra (media 156,95), pero conserva 100% `OBSERVED_WEAK`, confidence ≤0,49 y 0% multi-view porque la oclusión aún no está calibrada con held-out views y faltan sharpness/reproyección.
- Plan de import regenerable con seis capas, materiales PBR base, provenance F8, cuatro perfiles (day/sunset/night/rain), ocho cámaras y política de contenido generado no versionado.
- 67 pruebas del compilador/contratos pasaron; la identidad contiene 14 hashes fuente y hashes reales de los árboles del compilador y Unreal. El gate de coordenadas pasó con ocho esquinas AOI, ocho cámaras, cuatro puntos terrain, un roof control y axes del dron; error round-trip máximo `2e-15` m. No quedó staging, ni hubo merge, push, upload privado o gasto cloud.
- Build local medido: 1,825916 s; coste externo US$0; electricidad no estimada.
- `audit_vault.py`: 0 hallazgos. `audit_splats.py`: 0 fallos y 4 avisos legacy.

## Qué no está aceptado

- El host no ofrece `UnrealEditor`/`UnrealEditor-Cmd`; el gate del importer para el Hero actual produjo exit 2 y `blocked_external`, con cero assets importados. El plan sí validó nivel, cuatro perfiles, F8 y ocho cámaras.
- El PC RTX no respondió por SSH durante el preflight. No existen mediciones reales de avg FPS, 1% low, VRAM, ruta, hover drift, clipping, shader compile ni estabilidad Mac.
- No existen imágenes fijas Unreal ni comparación renderizada contra las ocho reference cameras porque el editor no está disponible.
- Median/p95 geométrico y silhouette contra ground truth independiente permanecen `null`, no “pass”.
- El smoke general mantiene un fallo baseline anterior a Hero Cell: hash de `ac30_cannon/ultra`.
- `audit_world.py --all` conserva dos fallos legacy ajenos al input seleccionado: collider inválido en `DJI_20260712135736_0117_D` y `recon_60b23208db`. El AOI R0 `recon_4e4245a1f4_aoi130` sí reportó mesh, terrain, collider v3, 404.878 triángulos y 72,53% de cobertura.
- `ops_status` sólo reflejó discontinuidad histórica de 24 h aunque el estado actual de servicios, auth, Range, recursos y jobs estaba sano.

## Decisión de expansión

La expansión a 200×200 m queda **rechazada por ahora**. Primero debe pasar el import/render Unreal real, la ruta de 30 s y los límites avg ≥60 FPS, 1% low ≥45 FPS y VRAM ≤7,2 GB en el target RTX. El contrato y el slice están implementados, pero un test estático no sustituye ese gate.

## Única acción externa pendiente

Enciende y deja accesible el PC RTX hasta que `ssh pc 'echo ready'` responda; con ese acceso puede ejecutarse el gate Unreal/RTX sin fingir resultados.
