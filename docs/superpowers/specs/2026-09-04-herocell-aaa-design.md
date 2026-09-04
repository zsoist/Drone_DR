# AeroBrain Hero Cell R0 — diseño aprobado

Fecha: 2026-09-04

Rama de ejecución: `feat/herocell-aaa-r0`

Base deliberada: `d3b408cf` (`codex/scene-ops-stability`), porque contiene los contratos vivos de escenas, AOI, colisión y Flightverse que aún no están en `main`.

## 1. Resultado de producto

Hero Cell R0 convierte una versión inmutable de una escena AeroBrain en un mundo derivado de 100×100 m, editable y relightable. El output separa cinco capas de verdad (`OBSERVED_MULTI_VIEW`, `OBSERVED_WEAK`, `GEOMETRICALLY_INFERRED`, `GENERATED_CONSTRAINED`, `UNKNOWN`), geometría visual, colisión, materiales, completion y evidencia QA. El compilador nunca modifica originales, manifests de escena ni artefactos publicados.

R0 prioriza una celda pequeña y verificable. No intenta resolver una ciudad, sustituir el pipeline ODM, ni convertir splats en la única geometría cercana. El resultado canónico es el manifest `game_scene.v1.json` y un árbol de artefactos bajo `drone-vault/worlds/`; Unreal es un consumidor reproducible de ese contrato.

## 2. Estado real de partida

- El repositorio operativo y el worktree están limpios en `d3b408cf`.
- `scene_64f22e89f2/recon_60b23208db` existe y es `READY/FULL`, con 1.019 cámaras y los productos densos más grandes. No es la versión activa, su splat está `unaligned`, su collider publicado es v2 frente al contrato v3 y falta el sidecar público de cámaras del splat. No puede ser el input canónico de R0 sin una reparación versionada.
- El primer candidato operativo es `scene_0cadd1911f/recon_4e4245a1f4_aoi130`: versión activa, 428/428 cámaras, GSD 3,1 cm/px, splat alineado, collider v3 válido, cobertura de malla 72,53% y productos de 100/200 m listos.
- La máquina no tiene Unreal Editor, Blender, GDAL CLI, Open3D ni trimesh. El alias SSH `pc` no respondió al preflight. Esto bloquea el import/render Unreal y los experimentos CUDA, no el compilador determinista ni el empaquetado de evidencia existente.
- La línea base tiene un fallo ajeno a Hero Cell: el hash regenerado de `ac30_cannon/ultra` no coincide. `audit_vault` tiene 0 hallazgos, `audit_splats` 0 fallos y `ops_status` sólo falla por continuidad histórica de 24 h; el estado actual de servicios, auth, Range, recursos y jobs es sano.

## 3. Alternativas consideradas

### A. Reparar primero la reconstrucción acumulativa

Ventaja: máxima cantidad de cámaras y cobertura de 1 km. Coste: requiere publicar cámaras, alinear el splat, regenerar collider v3, validar y posiblemente promover otra versión. Mezcla la creación del compilador con mutaciones del sistema de escenas y retrasa el primer output verificable.

### B. Compilar primero el AOI activo y mantener la reconstrucción acumulativa como benchmark

Ventaja: usa un input coherente con los contratos actuales y permite construir selección, Truth Field, manifest, geometría por capas y QA sin tocar la escena publicada. Después, `recon_60b23208db` compite en la Geometry Jury cuando sus precondiciones estén reparadas. Esta es la opción elegida.

### C. Construir una demo sintética y posponer datos reales

Ventaja: máxima velocidad de unit tests. Desventaja: no prueba los contratos del vault ni produce evidencia del lugar real. Se usará sólo como fixture TDD, nunca como deliverable.

## 4. Arquitectura

`world_compiler` será un paquete Python sin dependencias ML obligatorias. La primera versión usa stdlib + NumPy + Pillow ya disponibles. Adaptadores opcionales aíslan GDAL, Open3D, trimesh y backends CUDA. Ninguna dependencia de investigación entra al entorno operacional de AeroBrain.

El flujo es:

```text
escena/version read-only
  -> validación de capacidades e identidad
  -> ranking de AOI y selección 100×100 m
  -> muestreo de cámaras/superficies
  -> Truth Field + provenance
  -> estructura observada/inferida + colisión separada
  -> Evidence Atlas + PBR por tiers
  -> completion escrow + missing_views
  -> game_scene.v1.json
  -> adaptador Unreal / QA
```

Los límites públicos son:

- `WorldRepository`: lectura confinada de `manifest/scenes`, `models`, `odm`, `splats` y `tracks`; nunca llama a `scene_manifest.build()` porque esa función escribe derivados.
- `HeroCellSelector`: genera candidatos dentro del extent verificado, rechaza nodata/capabilities insuficientes y devuelve scores desglosados.
- `TruthField`: calcula clase y confianza por muestra; clase y confidence son campos distintos.
- `GeometryBundle`: rutas independientes para referencia, estructura limpia observada, estructura inferida, completion generada, ground y collision.
- `EvidenceAtlas`: dominante de cámara, pesos, confidence, repair/generated mask y fuente de microdetalle.
- `GameSceneManifest`: único contrato de export; contiene transform 4×4 e inversa, assets, hashes, provenance, materials, reference cameras y build metadata.
- `WorldBuild`: staging bajo `worlds/<scene>/.staging-*`, validación completa y promoción atómica a `hero_<hash>`.

## 5. Identidad, rutas y atomicidad

El Hero ID es `hero_` más los primeros 16 caracteres de SHA-256 sobre JSON canónico de:

- `scene_id` y `version_id`;
- centro y tamaño AOI en frame AeroBrain;
- profile/config normalizado;
- hashes de manifests y assets fuente usados;
- versiones/hashes de adaptadores.

Sólo se aceptan fuentes resueltas bajo el vault y sólo se escribe bajo `<vault>/worlds`. Un build crea `request.json`, `run.json` y `cost.json` en staging. La promoción usa `os.replace` sobre un directorio completo del mismo filesystem. Un fallo deja el último Hero Cell aceptado intacto y conserva o elimina únicamente su staging explícito.

## 6. Contrato de coordenadas

El frame AeroBrain usa metros, `+X=east`, `+Y=up`, `+Z=south`. El centro horizontal del AOI se resta una sola vez antes de exportar. Unreal recibe centímetros:

```text
X_UE = 100 * X_AB
Y_UE = 100 * Z_AB
Z_UE = 100 * Y_AB
```

La matriz cambia handedness; el export corrige winding, normales y tangentes exactamente una vez. `game_scene.v1.json` guarda matriz row-major e inversa. Tests round-trip usan esquinas AOI, cámaras, terrain points, un control de roof y axes del dron.

## 7. Selección de escena y AOI

La selección de versión exige: escena existente, versión `ready`, merge `SINGLE|FULL`, artefactos requeridos, terrain+mesh+collision y transformaciones válidas para cualquier asset anunciado. Que una versión sea activa suma evidencia de coherencia, pero no reemplaza los gates.

El score de celda conserva los pesos aprobados:

```text
0.25 multi_view_coverage + 0.18 angular_diversity + 0.14 source_sharpness
+ 0.12 geometry_completeness + 0.10 low_GSD_detail + 0.08 semantic_richness
+ 0.06 roof_vertical_mix + 0.04 route_playability + 0.03 clean_boundary
```

Cada componente está normalizado en `[0,1]`, incluye fuente y razón, y se serializa. Cuando un dato aún no está medido, el componente queda `unavailable` y el candidato no recibe crédito. No se inventa un valor neutral. El primer build usa el AOI activo de 130 m como extent y selecciona un cuadrado real de 100 m contenido dentro de éste; el contrato de coverage por diámetro no prueba por sí solo ese containment.

## 8. Truth Field y Hallucination Firewall

El MVP evalúa muestras de superficie/celdas mediante número de cámaras útiles, diversidad angular, sharpness, densidad proyectada, consistency, geometry support, riesgo dinámico y distancia a borde. Fixtures calibran regiones densas, débiles, inferidas y desconocidas. Los thresholds y versión de calibración quedan en el manifest.

Reglas de escritura:

- `OBSERVED_MULTI_VIEW`: completion no puede mover superficie ni silhouette.
- `OBSERVED_WEAK`: sólo regularización local que respete corners/footprint/roof/floors.
- `GEOMETRICALLY_INFERRED`: layer separada, evidence refs obligatorias.
- `GENERATED_CONSTRAINED`: layer escrow separada con method, seed, constraints y render-to-refute score.
- `UNKNOWN`: nunca se exporta como realidad; puede recibir un fallback visual explícito marcado como unknown.

Un validator rechaza overlap estructural entre generated y observed high-confidence por encima de la tolerancia configurada.

## 9. Geometría y semántica

La primera geometría real se deriva de los assets ya publicados: DSM/DTM cuando esté disponible, cloud/mesh, collider y camera reconstruction. La referencia observada permanece sin mutar. El pipeline estructural extrae ground, componentes, planos verticales y roofs; la representación inferida sólo completa pequeñas discontinuidades. Collision se genera desde la estructura limpia, no desde splat ni material visual.

Las clases mínimas son building/wall/roof, road/sidewalk/soil, vegetation, vehicle/motorcycle, person, pole/cable/sign, glass, water y sky/no-data. Sin un segmentador local validado, el MVP no declara detecciones visuales: conserva masks vacías explícitas y sólo usa clases respaldadas por metadata/geometry. Los modelos externos pasan `model_intake.v1.json` antes de influir producción.

## 10. Appearance, Evidence Atlas y PBR

Para cada texel/patch, el ranking multiplica visibility, sharpness, projected density, incidence, exposure, geometric confidence y dynamic cleanliness. El atlas conserva cámara dominante y pesos. Base color separa variación de alta frecuencia de iluminación de baja frecuencia; material class controla normal/roughness/AO y wetness.

Los tiers se asignan por visibilidad simulada:

- A: hero 5–20 m, 2K salvo un conjunto 4K medido;
- B: materiales tileables + microdetalle fuente;
- C: material simplificado y sin texturas únicas caras.

No se reutilizan los atlas 4K de photogrammetry como set residente: el incidente documentado de 6,5 GB demuestra que viola el target de 8 GB.

## 11. Completion y active reflight

Completion empieza con gramática/regularidad, no generación cloud. Cada hipótesis registra constraints y se proyecta a cámaras relevantes; se rechaza por silhouette, occlusion, corner/roof/floor mismatch o penetración. El ganador sigue siendo `GENERATED_CONSTRAINED`.

`missing_views.json` prioriza regiones por uncertainty × visibility × gameplay relevance y emite posiciones locales, AGL, pitch, heading, orbit/pass radius, information gain y reason. Es asesoría; no controla hardware.

## 12. Unreal y slice jugable

El repo contiene sólo `.uproject`, config, C++/Python/import recipes y assets pequeños/sanitizados. `Content/Generated`, DDC, Saved, Intermediate y builds están ignorados. El importer valida el schema, importa las cinco capas separadas, aplica la matriz una vez, crea materials/lighting/provenance mode, reference cameras, collision y un import report.

El pawn usa hover estable, FPV/third-person, input teclado/gamepad, AGL, collision/reset/HUD y route reproducible de 30 s. La ruta reutiliza la semántica Flightverse, pero el runtime Unreal no duplica weapons/enemies.

Unreal no está disponible en el host al comenzar. Por eso R0 implementará y testeará el contrato/import scripts y dejará el gate de editor marcado `blocked_external` con comando exacto, sin fabricar capturas o FPS.

## 13. QA y aceptación

Cada fase produce métricas machine-readable. Los gates críticos son:

- source confinement e integridad de hashes;
- IDs deterministas y promoción atómica;
- round-trip de coordenadas;
- score estable y explicable;
- Truth Field más bajo en regiones ocultas/débiles de fixtures y AOI real;
- 100% de geometría exportada con provenance;
- generated layer separada;
- schema/import report válidos;
- geometry targets: median ≤0,15 m, p95 ≤0,40 m, silhouette ≥0,90 cuando la fuente lo soporte;
- Unreal/RTX: avg ≥60 FPS, 1% low ≥45, VRAM ≤7,2 GB;
- Mac: ≥30 FPS reduced profile;
- regresiones existentes, separando baseline anterior de fallos nuevos.

Sin Unreal/RTX accesible, el veredicto máximo será `partially accepted` aunque el compilador pase. No se usarán labels “AAA”, “60 FPS”, “PBR” o “reproducible” sin medición.

## 14. Privacidad, licencias y coste

Presupuesto externo: US$0. Ningún frame, cámara, ubicación o asset privado sale de las máquinas de Daniel. Cada adaptador externo registra code/weights license, commit/hash, privacidad, hardware, memoria, runtime, determinismo y verdict. Un backend sin licencia comercial clara queda `research-only` o `rejected`.

`cost.json` separa tiempo local, CUDA, APIs, cloud, assets, transfer y electricidad estimada. El uso actual de código determinista local es `production`; modelos no ejecutados no se presentan como integrados.

## 15. Self-review

- No quedan placeholders ni decisiones abiertas que bloqueen el skeleton.
- La reconstrucción acumulativa no se confunde con la versión activa.
- Coverage por diámetro no se trata como crop físico.
- La escritura se limita a `worlds/` y Git; no toca originals ni manifests.
- Los gates Unreal/RTX quedan explícitamente bloqueados por herramientas ausentes, no simulados.
- Cada criterio crítico del brief está asignado a una capa o gate del plan de implementación.
