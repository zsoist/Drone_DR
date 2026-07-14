# Multi-fuente 3D y escenas incrementales — estado (2026-07-14)

## Validado empíricamente ✅
- **Fusión funciona** con fuentes compatibles: test 0103+0104 (aéreo+aéreo, misma sesión, 31m,
  altura similar) → **169/169 = 100%, 1 componente, 17.006 matches cross-source, 2/2 fuentes**.
- **Falla predecible** con incompatibles: test 0106(1m suelo)+0101(90m aéreo) → 0 matches → 0106
  descartado (0/7). El 82% total era un FALSO pass. Diagnóstico: 0 features comunes (geometría),
  no config ni frames malos (538 features/img en ambos).
- **Discriminante = compatibilidad de vista (altura/ángulo)**, NO el punto de despegue.
- **video+FOTO PASA** (test #3): 0103 aéreo + 3 fotos de 0104 (misma sesión, fuente conocida-compatible)
  → 61/61, **3/3 fotos co-registradas, 24.152 matches foto↔video**. Fotos = stills del dron (foto4k),
  GPS heredado del track del clip padre.

## Rango VALIDADO (mapa honesto de lo que sé)
- Probado y PASA: misma sesión, ≤31m de separación de centros, solape de altitud ≥100m, mismo dron/cámara.
- Fuera de eso: SIN datos. No sé la frontera (¿150m? ¿4h de diferencia? ¿solape parcial de altura?).
- NO probado: fotos de OTRA cámara (celular) — eje distinto (perfil de cámara), su propia celda.

## Enviado
- odm_prep multi-fuente (--sources/--photos, prefijo por fuente, geotag por track, swap atómico).
- `worker.odm_registration`: evalúa todos los componentes, elige el mejor componente
  compartido y reporta `submitted/registered/ratio` por prefijo. Una fuente cuenta sólo si
  tiene ≥5 cámaras y ratio ≥0.6 dentro de ese mismo componente.
- Gate: partial_merge → no auto-encolar splat phased. Modelo siempre sobrevive (label, no hard-fail).
- UI: modal Estudio 3D (multi-select por lugar, fotos, preset, phased). Score predictivo ELIMINADO;
  avisos de compatibilidad reales (suelo+aéreo, cross-sesión, alturas dispares).
- Fixture de regresión del path de geotag (el bug que me mordió).
- Entidad `reconstruction` estable (`recon_<hash>` por fuentes+fotos) y entidad `scene_<hash>`
  con manifiesto propio. Una escena conserva inventario, historial inmutable de versiones y una
  versión activa promovida explícitamente.
- “Mejorar esta escena” crea otra reconstrucción con capturas/fotos nuevas sin sobrescribir la
  activa. Una versión `PARTIAL` o sin artefactos requeridos no puede promoverse. La cercanía GPS
  es solo sugerencia; `FULL/PARTIAL` depende del registro real por fuente.
- La primera versión válida (`FULL` o `SINGLE`) se promueve automáticamente. Las siguientes se
  conservan como candidatas hasta promoción humana, con QA, calidad solicitada/efectiva y splat.
- Schema 2 conserva `source_evidence` por video: altitud medida, bbox/fecha, intentos,
  submitted/registered/ratio y estado `integrated|eligible|duplicate|insufficient_overlap|registration_failed`.
  Un fallo no borra la fuente y una nueva medición no pisa el veredicto de registro.
- `scene.v2.json` + `site.lod.json` publican cinco diámetros de cobertura (100/200/400/600/1000 m)
  en círculo y cuadrado. Son extensiones del producto, no bandas de altitud. `ready` exige que
  el DSM real cubra el diámetro; el sitio 0117 verifica hoy 100/200/400 m y marca 600/1000 pendientes.
- Mundo carga una sola isla por `scene_id` (la versión activa); versiones antiguas siguen
  trazables pero no aparecen como lugares duplicados. Volar aplica el límite métrico solicitado.

## Hito acumulativo cerrado (2026-07-14)

0. **Recuperación OpenSfM, publicación densa y browser QA aprobados:** el intento original de
   `recon_60b23208db` terminó `rc=139` sin OOM al intentar fusionar tres componentes con IDs
   repetidos. La recuperación `3d-1784034358954095000-b1152f` preservó exactamente 1.019 imágenes,
   1.019 features, 1.019 matches y 282.878.995 bytes de tracks, archivó sólo el JSON truncado y
   reconstruyó con `--sfm-no-partial` sin borrar caches. El JSON persistido nuevo (322.283.220 bytes,
   SHA-256 `0f89170ee32399e6689aa8486ed5fe4736ca9e2c70e3f775b8f5d605d68b9f44`) pasó la lógica
   `worker.odm_registration`: 2 componentes, componente seleccionado 0 con 996/1.019 cámaras,
   951.994 puntos y 10/10 fuentes fusionadas; componente 1 con 16 cámaras/13.562 puntos sólo de
   `s9`; 1.012 cámaras únicas totales y cero IDs repetidos entre componentes. Evidencia por fuente
   del seleccionado: `s0=238/238`, `s1=21/28`, `s2=29/29`, `s3=127/127`, `s4=108/108`,
   `s5=41/41`, `s6=116/116`, `s7=214/214`, `s8=30/30`, `s9=72/88`; resultado `FULL`.
   El evento inmutable `odm_final_shared_component_audited` y la copia bajo
   `ops/evidence/3d-1784034358954095000-b1152f/opensfm/` conservan la prueba. El gate compartido
   pasó. OpenMVS fusionó 993 depthmaps y produjo 46.731.480 puntos densos. El filtro de visibilidad
   escribió artefactos válidos antes de un `rc=139` post-write sin OOM:
   `scene_dense_dense_filtered.ply` (37.473.907 vértices; 1.049.269.665 bytes) y
   `scene_dense_dense_filtered.mvs` (2.423.785.757 bytes; magic `MVSI`). El evento inmutable
   `odm_filter_postwrite_segfault_classified` distingue ese crash de un OOM.

   La recuperación estricta `3d-1784044407571700000-efa0fa` validó tamaño/conteo del PLY y magic
   del MVS antes de reanudar desde `odm_filterpoints`. Su filtro estadístico cerró con 37.386.157
   puntos en 124,7 s. El paquete final publicó ortofoto/DSM/DTM de 30.539×33.664, nube de 795.450
   puntos y malla de 744.416 vértices; todos los assets requeridos y el navegador pasaron QA.
   `recon_60b23208db` fue promovida explícitamente en `scene_64f22e89f2` y el evento inmutable
   `odm_publish_browser_qa_completed` abrió el gate de splat. Las únicas aceptaciones siguientes
   son Frontier 30K desde cero y un Grandmaster 40K sobre la misma versión, ambos CUDA FULL;
   nunca fallback al Mac.

   Este documento registra sólo hitos cerrados. La etapa en ejecución, memoria y progreso medido
   viven en **3D → Trabajos** y en los eventos append-only, para no congelar telemetría efímera en
   documentación contractual.
   `odm-reconstruct` muestra conteo y ritmo medido en cámaras/min, pero no inventa una ETA a 1.019:
   OpenSfM puede terminar válidamente con menos cámaras registradas que enviadas. En profundidad,
   la UI separa `Estimated`/`Filtered`/`Fused depth-maps` y usa la ETA nativa de OpenMVS; no cuenta
   archivos `.dmap`, porque cada subfase vuelve a escribir variantes y ese total sobrecontaría vistas.
   El filtro posterior conserva el total denso real y muestra `Point visibility checks` en puntos,
   con la ETA nativa, como subfase distinta.

## Pendiente (honesto — NO validado / diferido)

1. ~~video+foto e2e~~ ✅ HECHO (test #3, 3/3 fotos, 24k matches). Falta: fotos de celular (otra cámara).
2. **Presupuesto global de frames + dedup INTRA-fuente**: poda hoy es por-fuente. OJO (hallazgo del
   review): NO deduplicar cross-source — esos near-duplicates son el pegamento del co-registro.
   Cap MAX_IMAGES + floor por-fuente (≥20).
3. **Sugerencia por compatibilidad**: calibrar la frontera con más pares. La UI ya ordena por
   centro geográfico y muestra distancia/altura, pero no promete compatibilidad.
4. **Preflight de disco** antes de encolar multi-fuente pesada.
