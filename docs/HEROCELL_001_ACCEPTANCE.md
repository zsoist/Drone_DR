# Hero Cell 001 — aceptación medida

Fecha: 2026-09-04  
Rama: `feat/herocell-aaa-r0`  
Hero ID: `hero_829d02794c076980`
Veredicto: **partially accepted**

## Qué sí pasó

- Input real: `scene_0cadd1911f/recon_4e4245a1f4_aoi130`, activo, ready/full, terrain + mesh + collider v3.
- Selección determinista de cuadrado 100×100 m: centro local AeroBrain `(-30, -10)` m, score `0.576708604566`, 221 candidatos elegibles y 4 rechazados. `selection.json` conserva los diez mejores candidatos con todos sus componentes y hasta diez rechazos con razón.
- La inspección de la ortofoto baseline refutó el selector inicial, que confundía rango vertical de copas con mezcla de cubiertas. El selector corregido combina rango vertical con planitud de superficies elevadas y penaliza la fracción de vegetación medida en ortofoto; la celda final contiene dos cubiertas grandes, calles y patios, con proxy de vegetación `0,126552`.
- Build atómico y content-addressed bajo `/Volumes/SSD/drone-vault/worlds/scene_0cadd1911f/hero_829d02794c076980`.
- Geometría: 18.624 triángulos de referencia, 18.624 ground, 3.352 estructura limpia, 0 completion generado y 21.976 collision. La extracción descarta componentes pequeños, exige planitud, usa altura robusta, excluye el proxy de vegetación y extruye la huella raster observada con paredes solo en su contorno; ya no rellena el rectángulo envolvente de patios o plantas irregulares.
- Seis roles separados, matrices AB↔UE invertibles, source hashes, records de coste/run/request, materiales dentro de 256 MiB y output externo US$0.
- Evidencia real: 428 poses OpenSfM transformadas a coordenadas locales, ocho reference cameras y mapas 97×98 de confidence, provenance y cámara dominante. Frustum + ray-march DSM registra 24–348 cámaras por muestra (media 169,192), pero conserva 100% `OBSERVED_WEAK`, confidence ≤0,49 y 0% multi-view porque la oclusión aún no está calibrada con held-out views y faltan sharpness/reproyección.
- Plan de import regenerable con seis capas, materiales PBR base, provenance F8, cuatro perfiles (day/sunset/night/rain), ocho cámaras y política de contenido generado no versionado.
- 74 pruebas del compilador/contratos pasaron; la identidad contiene 14 hashes fuente y hashes reales de los árboles del compilador y Unreal. El gate de coordenadas pasó con ocho esquinas AOI, ocho cámaras, cuatro puntos terrain, un roof control y axes del dron; error round-trip máximo `4e-15` m. No quedó staging, ni hubo merge, push, upload privado o gasto cloud.
- Tres vistas baseline locales —ortofoto fuente, hillshade DSM y Truth Field— quedaron bajo `qa/baseline`; están rotuladas como QA del compilador, no como capturas de aceptación Unreal.
- Build local medido: 1,715225 s; coste externo US$0; electricidad no estimada.
- `audit_vault.py`: 0 hallazgos. `audit_splats.py`: 0 fallos y 4 avisos legacy.

## Qué no está aceptado

- El host no ofrece `UnrealEditor`/`UnrealEditor-Cmd`; el gate del importer para el Hero actual produjo exit 2 y `blocked_external`, con cero assets importados. El plan sí validó nivel, cuatro perfiles, F8 y ocho cámaras.
- El PC RTX no respondió por SSH durante el preflight. No existen mediciones reales de avg FPS, 1% low, VRAM, ruta, hover drift, clipping, shader compile ni estabilidad Mac.
- No existen imágenes fijas Unreal ni comparación renderizada contra las ocho reference cameras porque el editor no está disponible.
- Median/p95 geométrico y silhouette contra ground truth independiente permanecen `null`, no “pass”. Como diagnóstico no independiente, 6.704 vértices de la huella estructural se compararon con 49.848 vértices del collider fuente dentro del AOI: mediana `1,4710 m` y p95 `8,8563 m`. La huella medida mejora la mediana 33,0% frente al build rectangular y elimina relleno falso, pero el p95 empeora 6,3% al muestrear densamente cubiertas y contornos antes representados por pocas esquinas. El gate continúa fallando y el reporte se rotula expresamente como proxy no elegible para aceptación.
- El smoke general mantiene un fallo baseline anterior a Hero Cell: hash de `ac30_cannon/ultra`.
- `audit_world.py --all` conserva dos fallos legacy ajenos al input seleccionado: collider inválido en `DJI_20260712135736_0117_D` y `recon_60b23208db`. El AOI R0 `recon_4e4245a1f4_aoi130` sí reportó mesh, terrain, collider v3, 404.878 triángulos y 72,53% de cobertura.
- `ops_status` sólo reflejó discontinuidad histórica de 24 h aunque el estado actual de servicios, auth, Range, recursos y jobs estaba sano.

## Decisión de expansión

La expansión a 200×200 m queda **rechazada por ahora**. Primero debe pasar el import/render Unreal real, la ruta de 30 s y los límites avg ≥60 FPS, 1% low ≥45 FPS y VRAM ≤7,2 GB en el target RTX. El contrato y el slice están implementados, pero un test estático no sustituye ese gate.

## Única acción externa pendiente

Enciende y deja accesible el PC RTX hasta que `ssh pc 'echo ready'` responda; con ese acceso puede ejecutarse el gate Unreal/RTX sin fingir resultados.
