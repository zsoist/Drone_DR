# Un sistema donde ningún número viaja solo

### Cómo una baseline de tres escenas tomó trece sesiones — porque cada atajo resultó ser un número mintiendo

*AeroBrain, plataforma personal de fotogrametría de dron (DJI → ODM → Gaussian Splatting → visor web) corriendo entera en un Mac Mini M4 de 16GB. Este documento se ordenó desde los ledgers del proyecto; cada afirmación tiene commit, run_id o archivo de evidencia. Artefacto final: tag `baseline-v1`.*

---

## Tesis: el falso 82%

El proyecto necesitaba fusionar varios vuelos de dron en un solo modelo 3D. El primer test de fusión reportó **82% de imágenes registradas** — un éxito, a primera vista. La composición decía otra cosa: las 33 imágenes registradas venían TODAS de una fuente; la otra aportó **0 de 7**. El "modelo combinado" era un modelo de una sola fuente con disfraz.

**Un número global esconde composición.** Esa oración se convirtió en la regla operativa de todo lo que siguió — y reapareció, con disfraz nuevo, tres veces más:

| Edición | El número que mentía | Lo que escondía |
|---|---|---|
| 1ª — merge | "82% registrado" | una fuente entera descartada en silencio |
| 2ª — memoria | "completó en 3502s" (7-jul) | un proceso sin límite nadando en 5GB de swap |
| 3ª — calidad | "PSNR 14" entre escenas | regímenes de resolución incomparables |
| 4ª — historia | "browser-qa: error" ×N | un `NameError` enmascarado por un race de limpieza |

La respuesta a cada edición fue la misma: no arreglar el número — **hacer que el número viaje con su composición**. Merge report per-fuente. Peak con su cap y su fuente de medición. LPIPS con su régimen. Y errores con su causa nombrada.

---

## Capítulo 1 — Validar antes de construir

La feature multi-source se validó con tres tests controlados de SfM **antes** de que la UI la prometiera:

- **Test #1** (clip a 1m + vuelo a 90m, mismo punto de despegue): **0 matches cruzados.** Mató la primitiva de agrupación ("mismo takeoff = mismo sujeto") y produjo el falso 82%.
- **Test #2** (dos vuelos aéreos, misma sesión): **17,006 matches**, fusión 100%.
- **Test #3** (video + fotos del dron): **24,152 matches** foto↔video, 3/3 fotos.

De ahí salió el **merge gate**: una fuente "fusionó" si registró ≥5 imágenes y ≥60% de las aportadas; el label (FULL/PARTIAL/SINGLE) viaja con el modelo y una fusión parcial nunca se presenta como total. La UI solo muestra lo que el backend puede demostrar — el "score de combinabilidad" original se extirpó por inventado.

## Capítulo 2 — El instrumento antes que el número

"Splats 10/10" era inmedible: no existía evaluación held-out. Se construyó el harness primero:

- **Split determinista** (seed = identidad de la escena → mismo split entre runs) por **cirugía de reconstruction.json** — el trainer itera shots, no listas de archivos.
- **Render de vistas test por el camino interno del trainer** (patch local de ~30 líneas a OpenSplat, `--render-cameras`): render y ground-truth salen del mismo `cv::undistort` — compararlos contra frames crudos daría métricas falsas por la distorsión de lente.
- **Regla de resolución**: el eval compara SIEMPRE a resolución GT completa del régimen; un modelo entrenado a media resolución paga su pérdida en el número (`render_px` como evidencia en cada run).
- **PSNR/SSIM/LPIPS** + 3 side-by-side (GT|render|diff) por run — porque el número decide pero **el ojo audita que el número mida lo que crees**: un PSNR de 14 con poses desalineadas y uno con render borroso son indistinguibles sin mirar.
- Reproducibilidad medida de paso: **±1% LPIPS** entre runs idénticos (n=2, preliminar).

El primer número del harness (PSNR 14.41 en un preset rápido) vino con su side-by-side confirmando poses alineadas. El instrumento funcionaba. Y entonces midió algo que nadie pidió.

## Capítulo 3 — El P0: once absoluciones y una fecha

La primera baseline seria (preset cinematic) **murió por memoria — siete veces**, en una escena donde producción había "pasado" cuatro días antes. La cacería, en orden, con cada sospechoso absuelto por evidencia:

1. Los insumos (mtimes intactos del 7-jul). 2. El split (la réplica exacta de producción, 30 cámaras, también murió). 3. `--save-every` (el run verbatim murió igual). 4. El binario (solo el patch se recompiló; los objetos del trainer eran del 5-jul). 5. libtorch (octubre). 6. El OS (sin updates). 7. El boot (mismo uptime cubría el 7-jul). 8. **El reboot** (OOM idéntico con swap 0). 9. El entorno de shell (`MallocNanoZone=0` de la sesión — contaminante real del harness, pero el worker limpio también murió). 10. El camino de invocación (producción real vía launchd: OOM ×3). 11. El binario re-linkeado (rebuild limpio desde upstream: OOM idéntico).

Y en el camino, el instrumento se corrigió a sí mismo: el peak "de 2.5GB" que reportaban las primeras muertes era **RSS, que subestima ~20× los procesos Metal/MPS** (medido en vivo: RSS 489 MiB vs `phys_footprint` 10 GB en el mismo proceso). El PeakTracker pasó a leer el `phys_footprint_peak` del kernel — el número que `taskpolicy -m` realmente vigila.

Once absoluciones después, la pregunta correcta dejó de ser "¿qué se rompió?" y pasó a ser la del duodécimo sospechoso: **el metro mismo**. Dos comandos de git la respondieron:

> El cap de memoria (`taskpolicy -m 11000`) nació el **9 de julio a las 19:25**.
> El "PASS" de producción fue el **7 de julio a las 09:44** — dos días antes.

Nunca hubo regresión. El run del 7-jul corrió **sin límite**, usando 13-15GB de footprint invisible mientras nadaba en los 5.3GB de swap que el forense pre-reboot había capturado (y que se absolvieron por la razón equivocada). Los tres mil quinientos segundos de duración eran el síntoma a la vista que nadie leyó. **El terreno no se hundió entre el 7 y el 11: siempre estuvo hundido — el 9 se puso el límite y el 11 se inventó el altímetro.**

La lección en una línea: **cuando cambias el instrumento y la realidad "cambia" el mismo día, el primer sospechoso es el instrumento** — y el git log del enforcement cuesta menos que once absoluciones.

## Capítulo 4 — El modelo de tres términos (epílogo técnico)

Con el metro honesto, cada OOM dejó de ser misterio y pasó a ser medición. Tres cadáveres instrumentados, tres términos:

```
peak(run) ≈ base_imgs(n × px × 12B / d²)   ← escena 2 murió EN LA CARGA a full-res
          + conteo × g(config, res)         ← pendiente medida: 2.39 MiB/step (¼ res)
          + escalón(salto del schedule)     ← +1336 MiB aditivo Y pendiente ×1.55 al doblar
```

Con cinco cláusulas documentadas (la pendiente es config-dependiente; la densificación se debilita a media resolución; el error de proyección conocido: −24%, conservador...) y un dataset que crece solo: cada run guarda proyectado-vs-observado. Del modelo salieron **leyes medidas con presupuesto-igual** — la única comparación que el arco acepta:

- **La densificación es el uso dominante del presupuesto**: gasta igual (~7GB) en gaussianas agresivas a ¼ de resolución o en media resolución con conteo acotado, y las gaussianas ganan (LPIPS 0.567 vs 0.630). Verificada en la escena grande con el margen encogido que la base predice (Δ0.013).
- **El cap no muerde en escenas chicas** (64% de uso natural) **y sí en grandes** (76-80%) — el preflight per-preset hereda la aritmética.

## Capítulo 5 — baseline-v1

| Escena | LPIPS | Régimen | Firma de error (ojo) |
|---|---|---|---|
| Easy (30 cám) | **0.567±0.005** | ¼-schedule @3072 | blur global uniforme |
| Grande (214 img) | **0.615** | -d2 desde carga (decidido por hardware) | alta frecuencia; 0 floaters, 0 deriva de exposición |
| Multi-source (fusión real) | **0.667** | 2688 (camino de producción) | desplazamiento de pose cross-source + blur periférico |

Cada fila con: peak y % de cap, procedencia de binario, condición de carga, incertidumbre con su n, y composición per-fuente donde aplica (la fila multi: fusión FULL bajo la poda de producción, 22/23 + 57/58; delta per-fuente = ruido, anotado con sus n). Deltas solo comparan dentro de escena; entre escenas viajan las firmas cualitativas — que ya reordenaron la fase siguiente: el multi-source no sufre de color (cero banding con dos vuelos) sino de **pose residual**, nominando un lever que nadie había priorizado.

Congelada como artefacto versionado: **tag `baseline-v1`**, inmutable; re-runs futuros nacen v2 con changelog.

## Lo que el proceso dejó además de la tabla

- **Tres hallazgos de producto** que ningún test unitario podía ver: armónicos esféricos silenciosamente deshabilitados en todos los presets (un workaround de NaN de tres líneas); una escalera de degradación por OOM que baja el parámetro equivocado; y el presupuesto invisible del P0.
- **Gates mecánicos**: pre-commit que corre el smoke sin pipe (nació de un commit que pasó en rojo porque `| tail` se tragó el exit code — un pitfall escrito se repite; uno imposible es proceso); gate post-parche del trainer ("aditivo por intención del diff" no es evidencia — el comportamiento se mide).
- **Una entity de identidad pagada en su mejor momento**: la reconstrucción como ciudadano de primera clase costó una fracción de lo temido porque tres sesiones de evidencia (el mapa de superficie, el merge report, el schema de runs) maduraron antes de escribirla — y su primer combinado real en producción encontró, como debía, el último bug enmascarado del sistema.
- **Un canario semanal por condición**: el mismo splat corto, trended en peak Y duración — porque el 7-jul enseñó que completar lento es un síntoma, no un pass.

## La regla, destilada

Trece sesiones de adversarialidad — cada plan estresado antes de ejecutarse, cada resultado leído con sus ramas pre-escritas, cada corrección propagada hacia atrás — destilaron una sola definición operativa de calidad:

**Un número sin su contexto de medición no es un dato: es un riesgo con formato de dato.** Régimen, presupuesto, procedencia, incertidumbre, composición. Un sistema donde ningún número viaja solo.

---

*Evidencia: `docs/SPLAT_EXPERIMENTS.md` (tabla y protocolo), `docs/BUGHUNT_BACKLOG.md` (P0/P1/P2 con cadenas completas), `docs/SPLAT_PIPELINE.md` (trainer), `docs/MULTISOURCE_3D.md` (tests #1-#3), `vault/eval/*/run.json` (cada número con su contexto), tag `baseline-v1`.*
