# Hero Cell 001 — aceptación medida

Fecha: 2026-09-04  
Rama: `feat/herocell-aaa-r0`  
Hero ID: `hero_7cf459c159d11388`
Veredicto: **partially accepted**

## Qué sí pasó

- Input real: `scene_0cadd1911f/recon_4e4245a1f4_aoi130`, activo, ready/full, terrain + mesh + collider v3.
- Selección determinista de cuadrado 100×100 m: centro local AeroBrain `(-30, -10)` m, score `0.576708604566`, 221 candidatos elegibles y 4 rechazados. `selection.json` conserva los diez mejores candidatos con todos sus componentes y hasta diez rechazos con razón.
- La inspección de la ortofoto baseline refutó el selector inicial, que confundía rango vertical de copas con mezcla de cubiertas. El selector corregido combina rango vertical con planitud de superficies elevadas y penaliza la fracción de vegetación medida en ortofoto; la celda final contiene dos cubiertas grandes, calles y patios, con proxy de vegetación `0,126552`.
- Build atómico y content-addressed bajo `/Volumes/SSD/drone-vault/worlds/scene_0cadd1911f/hero_7cf459c159d11388`.
- Geometría: 18.624 triángulos de referencia, 18.624 ground, 2.139 estructura observada limpia, 4.859 estructura inferida, 0 completion generado y 25.622 collision. La extracción descarta componentes pequeños, exige planitud, usa altura robusta, excluye el proxy de vegetación y extruye la huella raster observada con paredes solo en su contorno. Se corrigió un defecto donde píxeles de cubierta excluidos como vegetación se reutilizaban como “suelo” y podían rechazar una componente válida; la base ahora procede siempre del heightfield de suelo capado.
- El Hallucination Firewall compara cada vértice estructural con la superficie fuente usando tolerancia `1,1071 m` (0,75 diagonales de celda DSM, nunca menos de 0,40 m): conserva 30,57% de las caras candidatas como `OBSERVED_WEAK` y mueve 69,43% a `GEOMETRICALLY_INFERRED` en vez de fingir soporte observado.
- Seis roles separados, matrices AB↔UE invertibles, source hashes, records de coste/run/request, materiales dentro de 256 MiB y output externo US$0.
- Evidencia real: 428 poses OpenSfM transformadas a coordenadas locales, ocho reference cameras y mapas 97×98 de confidence, provenance y cámara dominante. Frustum + ray-march DSM registra 24–348 cámaras por muestra (media 169,192), pero conserva 100% `OBSERVED_WEAK`, confidence ≤0,49 y 0% multi-view porque la oclusión aún no está calibrada con held-out views y faltan sharpness/reproyección.
- Plan de import regenerable con seis capas, materiales PBR base, provenance F8, cuatro perfiles (day/sunset/night/rain), ocho cámaras y política de contenido generado no versionado.
- 88 pruebas del compilador/contratos pasaron; la identidad contiene 22 hashes fuente —incluidos SHA-256 de los ocho JPEG de referencia— y hashes reales de los árboles del compilador y Unreal. El gate de coordenadas pasó con ocho esquinas AOI, ocho cámaras, cuatro puntos terrain, un roof control y axes del dron; error round-trip máximo `4e-15` m. No quedó staging, ni hubo merge, push, upload privado o gasto cloud.
- Semántica conservadora espacial: máscaras PNG para 5.985 píxeles de `ground_surface`, 2.318 de roof, 1.203 de vegetación/replacement y 0 no-data, además de máscaras static/replacement y scene graph editable. La vegetación es un proxy RGB, no instance segmentation; road/sidewalk/soil, vehículos, personas, cables, vidrio y agua siguen expresamente no medidos y no se inventó identidad de objetos.
- Evidence Atlas raster medido: crop de ortofoto del AOI (22.912 bytes), confidence, cámara dominante y máscara replacement alineados a 97×98. El compilador ahora genera basecolor corregido, normal tangente desde DSM, roughness semántico, AO de cavidad local y microdetail high-pass; los seis mapas ocupan 81.550 bytes y todos los OBJ llevan UV X/Z del AOI. El importer valida confinamiento, importa las texturas y conecta Base Color, Normal, Roughness y AO. La corrección Retinex redujo la desviación de luminancia de baja frecuencia de `0,035383212` a `0,012378040`, pero no es descomposición intrínseca calibrada; los mapas son proxies 97×98, no los 2K planificados, y el gate de cuatro relightings Unreal sigue incompleto.
- Active Reflight Plan real: cinco objetivos separados por ≥15 m derivados de mínimo soporte/diversidad del Truth Field. Las dos primeras regiones tienen 24 cámaras visibles y diversidad `0,001760`/`0,032014`; cada solicitud incluye target y cámara en coordenadas AB, AGL 15 m, gimbal −45°, heading, radio 12 m, ganancia esperada y nota legal. El archivo declara `controls_drone=false` y oclusión held-out no calibrada.
- La cobertura simple por conteo de triángulos es 81,0358% `OBSERVED_WEAK` y 18,9642% `GEOMETRICALLY_INFERRED`. Al ponderar las 31 posiciones de la ruta por área proyectada potencial, distancia, orientación y línea de vista DSM, el desglose baja a 57,8388% observado y sube a 42,1612% inferido, con 0% multi-view, generado y unknown. La geometría recuperada es muy visible desde la ruta y el reporte expone ese riesgo; no usa frustum ni auto-oclusión estructural y no sustituye la ejecución Unreal.
- Tres vistas baseline locales —ortofoto fuente, hillshade DSM y Truth Field—, ocho overlays de collider/candidato y ocho overlays sobre JPEG real quedaron bajo `qa/baseline`; están rotulados como QA del compilador, no como capturas de aceptación Unreal. Los JPEG completos permanecen en el vault fuente y no se copian al Hero.
- El rasterizador software usa la rotación, traslación e intrínsecos OpenSfM completos en las ocho reference cameras. Contra triángulos elevados del collider de la misma reconstrucción midió IoU mediana `0,410931865` (mín. `0,403409644`, máx. `0,419177041`): mejora frente a `0,3397`, pero todavía refuta ampliamente el objetivo proxy `0,90`. El reporte queda marcado no independiente y no elegible para aceptación.
- Contra píxeles reales, el contorno canónico obtuvo soporte de borde mediano `0,482722841` (mín. `0,461864407`, máx. `0,520451340`) y lift mediano `4,8272×` sobre la densidad de bordes fuertes. La mejora es marginal frente a `0,4805`, y el overlay conserva regiones no cubiertas. Las imágenes participaron en la reconstrucción, la distorsión Brown no se aplica y los bordes incluyen textura/vegetación/sombras; por ello la métrica es un proxy no held-out y no elegible para aceptación.
- Cada Hero incluye ahora `qa/metrics.json` y `qa/acceptance.md`. El compiler los inicia con Unreal `not_run`; el importer real actualizó el mismo snapshot a `blocked_external`, retiró el blocker provisional y registró `unreal_python_module_unavailable`, 0 assets importados y 0 errores. Geometría independiente, FPS, VRAM, ruta y relighting permanecen `null`/false, no valores estimados.
- Build local medido: 5,066242 s; coste externo US$0; electricidad no estimada.
- `audit_vault.py`: 0 hallazgos. `audit_splats.py`: 0 fallos y 4 avisos legacy.

## Qué no está aceptado

- El host no ofrece `UnrealEditor`/`UnrealEditor-Cmd`; el gate del importer para el Hero actual produjo exit 2 y `blocked_external`, con cero assets importados. El plan sí validó nivel, cuatro perfiles, F8 y ocho cámaras.
- El PC RTX no respondió por SSH durante el preflight. No existen mediciones reales de avg FPS, 1% low, VRAM, ruta, hover drift, clipping, shader compile ni estabilidad Mac.
- No existen imágenes fijas Unreal ni comparación renderizada contra las ocho reference cameras porque el editor no está disponible.
- Median/p95 geométrico y silhouette contra ground truth independiente permanecen `null`, no “pass”. Para la capa observada, el diagnóstico mide 1.560 muestras deduplicadas contra los 64 triángulos fuente más cercanos entre 94.475 triángulos del AOI, con proyección punto-triángulo exacta. El proxy superficial da mediana `0,4443 m` y p95 `1,0241 m`; el proxy silhouette da `0,4109`. La cobertura creció, pero la distancia mediana empeoró frente al Hero anterior; ambos refutan sus objetivos y siguen no independientes/no elegibles.
- El smoke general mantiene un fallo baseline anterior a Hero Cell: hash de `ac30_cannon/ultra`.
- `audit_world.py --all` conserva dos fallos legacy ajenos al input seleccionado: collider inválido en `DJI_20260712135736_0117_D` y `recon_60b23208db`. El AOI R0 `recon_4e4245a1f4_aoi130` sí reportó mesh, terrain, collider v3, 404.878 triángulos y 72,53% de cobertura.
- `ops_status` sólo reflejó discontinuidad histórica de 24 h aunque el estado actual de servicios, auth, Range, recursos y jobs estaba sano.

## Decisión de expansión

La expansión a 200×200 m queda **rechazada por ahora**. Primero debe pasar el import/render Unreal real, la ruta de 30 s y los límites avg ≥60 FPS, 1% low ≥45 FPS y VRAM ≤7,2 GB en el target RTX. El contrato y el slice están implementados, pero un test estático no sustituye ese gate.

## Única acción externa pendiente

Enciende y deja accesible el PC RTX hasta que `ssh pc 'echo ready'` responda; con ese acceso puede ejecutarse el gate Unreal/RTX sin fingir resultados.
