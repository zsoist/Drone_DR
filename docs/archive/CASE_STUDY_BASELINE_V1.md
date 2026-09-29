# Un sistema donde ningún número viaja solo

### Cómo una baseline de tres escenas tomó trece sesiones — porque cada atajo resultó ser un número mintiendo

*AeroBrain, plataforma personal de fotogrametría de dron (DJI → reconstrucción 3D → Gaussian Splatting → visor web) corriendo entera en un Mac Mini M4 de 16GB. Este documento se ordenó desde los registros del proyecto; cada afirmación tiene commit, run_id o archivo de evidencia. Artefacto final: tag `baseline-v1`.*

**Mini-glosario** (lo justo para leer sin contexto): *SfM* = Structure-from-Motion, la etapa que estima desde las fotos dónde estaba la cámara en cada toma; una imagen queda **"registrada"** cuando el sistema logra ubicar su cámara en el espacio 3D — si no registra, esa foto no aporta nada al modelo. *Gaussian splat* = modelo 3D hecho de millones de elipsoides translúcidos ("gaussianas") optimizados para reproducir las fotos; se entrena como una red neuronal y come memoria en proporción a cuántas gaussianas crea (*densificación*). *PSNR/SSIM/LPIPS* = métricas de fidelidad entre una vista renderizada y su foto real (*GT*, ground truth); PSNR/SSIM más alto = mejor, **LPIPS más bajo = mejor** (y es la perceptual: la que mejor coincide con el ojo). *Régimen* = a qué resolución entrenó realmente el modelo. *OOM* = muerte por exceso de memoria.

---

## Tesis: el falso 82%

El proyecto necesitaba fusionar varios vuelos de dron en un solo modelo 3D. El primer test de fusión reportó **82% de imágenes registradas** — un éxito, a primera vista. La composición decía otra cosa: las 33 imágenes registradas venían TODAS de una fuente; la otra aportó **0 de 7**. El pipeline no había fallado: ante cero coincidencias visuales entre fuentes, descartó una en silencio y reportó el porcentaje global como si nada. El "modelo combinado" era un modelo de una sola fuente con disfraz.

**Un número global esconde composición.** Esa oración se convirtió en la regla operativa de todo lo que siguió — y reapareció, con disfraz nuevo, tres veces más:

| Edición | El número que mentía | Lo que escondía | Resuelto en |
|---|---|---|---|
| 1ª — merge | "82% registrado" | una fuente entera descartada en silencio | cap. 1 |
| 2ª — memoria | "completó en 3502s" | un proceso sin límite nadando en swap | cap. 3 |
| 3ª — calidad | "PSNR 14" comparado entre escenas | regímenes de resolución incomparables | cap. 5 |
| 4ª — historia | "error" ×N en un gate de QA | un bug de import enmascarado por un error secundario | cap. 6 |

La respuesta a cada edición fue la misma: no arreglar el número — **hacer que el número viaje con su composición**.

## Capítulo 1 — Validar antes de construir

La fusión multi-fuente se validó con tres tests controlados de SfM **antes** de que la interfaz la prometiera:

- **Test #1** (clip grabado a 1m de altura + vuelo a 90m, mismo punto de despegue): **0 coincidencias visuales entre fuentes** — ven mundos distintos aunque compartan GPS de despegue. Mató la heurística "mismo despegue = mismo sujeto" y produjo el falso 82%.
- **Test #2** (dos vuelos aéreos de la misma sesión): **17,006 coincidencias**, fusión 100%.
- **Test #3** (video + fotos del dron): **24,152 coincidencias** foto↔video, 3/3 fotos integradas.

De ahí salió el **merge gate**: una fuente "fusionó" si registró ≥5 imágenes y ≥60% de las que aportó; el veredicto (FULL/PARTIAL/SINGLE) viaja con el modelo y una fusión parcial nunca se presenta como total. El "score de combinabilidad" que la primera interfaz inventaba se eliminó: la UI solo muestra lo que el backend puede demostrar.

## Capítulo 2 — El instrumento antes que el número

"Calidad 10/10" era inmedible: no existía evaluación con vistas reservadas. Se construyó el instrumento primero:

- **Split determinista**: ~10% de las vistas se excluyen del entrenamiento (mismas vistas en cada re-run de la misma escena, para que los números comparen).
- **Render + GT por el mismo camino interno del trainer** (un patch local de ~30 líneas): ambos pasan por la misma corrección de lente — comparar contra las fotos crudas daría métricas falsas por la distorsión.
- **Regla de resolución**: el eval compara siempre a resolución completa del régimen; un modelo entrenado a media resolución paga su pérdida de detalle en el número (cada run registra `render_px` como evidencia).
- **PSNR/SSIM/LPIPS + 3 comparativas visuales (GT | render | diferencia) por run** — el número decide pero **el ojo audita que el número mida lo que crees**: un PSNR de 14 por poses desalineadas y uno por render borroso son indistinguibles sin mirar.
- Reproducibilidad medida de paso: **±1% LPIPS** entre runs idénticos (n=2, preliminar).

El primer número del instrumento vino con su comparativa confirmando poses alineadas. Funcionaba. Y entonces midió algo que nadie pidió.

## Capítulo 3 — El P0: once absoluciones y una fecha

Timeline, porque el desenlace es una fecha:

> **7-jul 09:44** — producción entrena la escena en preset alto: "PASS", 3502s.
> **9-jul 19:25** — se añade un límite de memoria por proceso (11GB, `taskpolicy -m`: el kernel mata al que lo supere).
> **11-jul** — nace el medidor de picos de memoria… y ese mismo día el mismo preset en la misma escena muere por memoria **siete veces**.

¿Qué se rompió entre el 7 y el 11? La cacería, con cada sospechoso absuelto por evidencia:

1. **Los insumos** — frames y reconstrucción con fechas intactas del 7-jul: nada cambió.
2. **El split del eval** — la réplica exacta de producción (todas las cámaras, sin split) murió igual.
3. **Un flag de guardado** que el eval había quitado "por limpieza" — restaurado verbatim, murió igual (y dejó la lección: la baseline reproduce el comando shipped al byte).
4. **El binario** — solo el patch de render se había recompilado; los objetos del trainer eran previos al PASS.
5. **libtorch** — la librería de tensores, sin cambios desde octubre.
6. **El sistema operativo** — sin updates desde marzo.
7. **El estado acumulado del sistema** — 8 días de uptime, swap lleno… y el reboot no cambió nada: OOM idéntico con swap en cero.
8. **El entorno de shell** — la sesión de desarrollo inyectaba `MallocNanoZone=0` (una variable de macOS que altera el asignador de memoria) a cada proceso lanzado a mano; contaminante real del harness… pero el worker de producción, con entorno limpio, murió igual.
9. **El camino de invocación** — el job por la vía de producción real (launchd, no shell): OOM ×3.
10. **El re-link del binario** — rebuild limpio desde upstream sin el patch: OOM idéntico.
11. **El borde del límite** — ¿estaría el preset siempre al filo? Se subió el cap a 12.5GB: llegó más lejos y murió igual — la memoria crecía sin techo.

Y en el camino, el instrumento se corrigió a sí mismo: los primeros peaks reportados ("murió a 2.5GB") eran **RSS, una métrica que subestima ~20× a los procesos con memoria de GPU en Apple Silicon** (medido en vivo: 489 MiB de RSS contra 10 GB de `phys_footprint`, la métrica que el kernel realmente vigila). Sin esa corrección, la investigación entera habría perseguido un fantasma en el lugar equivocado.

Once absoluciones después, la pregunta correcta dejó de ser "¿qué se rompió?" y pasó a ser: **¿y si el metro es nuevo?** Dos comandos de git la respondieron: el límite de memoria nació el 9-jul a las 19:25. El "PASS" fue el 7-jul a las 09:44 — **dos días antes de que existiera el límite**.

Nunca hubo regresión. El run del 7-jul corrió sin techo, usando 13-15GB invisibles mientras nadaba en los 5.3GB de swap que el forense pre-reboot había capturado. Sus 3502 segundos de duración eran el síntoma a la vista que nadie leyó: completar lento es un síntoma, no un pass. **El terreno no se hundió entre el 7 y el 11: siempre estuvo hundido — el 9 se puso el límite y el 11 se inventó el altímetro.**

La lección: cuando cambias el instrumento y la realidad "cambia" el mismo día, el primer sospechoso es el instrumento — y el `git log` del enforcement cuesta menos que once absoluciones.

## Capítulo 4 — El modelo de memoria (epílogo técnico)

Con el metro honesto, cada OOM dejó de ser misterio y pasó a ser medición. Tres muertes instrumentadas, tres términos:

```
peak ≈ carga_de_imágenes  +  gaussianas × costo_por_gaussiana  +  escalón_de_resolución
```

- **Carga de imágenes**: el trainer carga TODO el set en memoria al arrancar (~64MB por imagen 4K en float32). Invisible con 22 imágenes (1.4GB); letal con 214 — esa escena moría *antes de entrenar un solo paso*. Palanca: reducir resolución de entrada (`-d 2`).
- **Costo por gaussiana**: pendiente medida de 2.39 MiB/paso durante densificación a ¼ de resolución — dependiente de la configuración (error de proyección conocido en el primer uso: −24%, en la dirección conservadora).
- **Escalón de resolución**: cuando el entrenamiento dobla su resolución interna (paso 3000 del schedule), el footprint salta **+1336 MiB de una vez Y la pendiente se multiplica ×1.55** — ambos términos existen, medidos en una serie (paso, footprint) muestreada cada 5s.

De ahí salieron **leyes con presupuesto-igual** — comparar solo configuraciones que gastan lo mismo:

- **La densificación es el uso dominante del presupuesto**: a gasto igual (~7GB), gaussianas agresivas a ¼ de resolución ganan a media resolución con conteo acotado (LPIPS 0.567 vs 0.630 — recordar: más bajo es mejor). Verificada en la escena grande con el margen encogido que el término de carga predice (Δ0.013).
- **El límite no muerde en escenas chicas** (64% de uso natural) **y sí en grandes** (76-80%).

## Capítulo 5 — baseline-v1

| Escena | LPIPS ↓ | PSNR | peak MiB (%cap) | n test | régimen de entrenamiento | firma de error (ojo) |
|---|---|---|---|---|---|---|
| 1 — easy (30 cámaras) | **0.567±0.005** (n=2 runs) | 14.2±0.13 | 6992 (64%) | 8 | ¼ de 3072px (schedule) | blur global uniforme |
| 2 — grande (214 imágenes) | **0.615** | 13.53 | 8354 (76%) | 21 | mitad de 3072px desde la carga (forzado por hardware) | pérdida de alta frecuencia; 0 floaters, 0 deriva de exposición |
| 3 — multi-fuente (2 vuelos fusionados) | **0.667** | 11.16 | 8801 (80%) | 8 | 2688px (perfil de producción) | desplazamiento de pose entre fuentes + blur periférico |

Fila 3, composición: fusión FULL bajo la poda de producción (22/23 + 57/58 imágenes registradas por fuente); delta de calidad entre fuentes = ruido (ΔSSIM 0.024 con n=2 y n=6 vistas — por debajo del umbral pre-declarado). Los deltas solo comparan **dentro** de cada escena; entre escenas viajan las firmas cualitativas — que ya reordenaron la fase siguiente: el modelo multi-fuente no sufre de color (cero banding pese a dos condiciones de luz) sino de **pose residual entre fuentes**, nominando un lever que nadie había priorizado.

Congelada como artefacto versionado: **tag `baseline-v1`**, inmutable; re-runs futuros nacen v2 con changelog.

## Capítulo 6 — La cuarta edición: cuando el número que miente es un estado de error

Durante el cierre, el gate de QA de browser reportaba "error" en jobs cuyo resultado era perfecto. La causa real: un **import faltante** (`threading`) hacía crashear el gate al arrancar — pero el error visible era otro (un fallo de limpieza de directorio temporal durante el desmonte), que **enmascaraba al culpable como error secundario**. Todos los "browser-qa: error" del día tenían la misma causa oculta, incluido uno que se había atribuido — falsamente — a otra cosa. El fix fue doble: el import, y un fixture que compila el módulo entero y verifica sus imports por AST — no arreglar el bug, arreglar la *categoría*. Y la corrección se propagó hacia atrás: se revisó qué decisiones habían consumido la atribución falsa (ninguna) y se corrigió el registro del job afectado. Un historial de errores donde el estado no lleva su causa es la cuarta edición del mismo bug.

## Lo que el proceso dejó además de la tabla

- **Tres hallazgos de producto** invisibles para cualquier test unitario: el color view-dependent silenciosamente deshabilitado en todos los presets (un workaround de 3 líneas contra una divergencia numérica — hoy reproducido-negativo y liberado bajo vigilancia); una escalera de degradación por OOM que baja el parámetro equivocado (resolución, cuando el driver es el conteo de gaussianas); y el presupuesto invisible del capítulo 3.
- **Gates mecánicos**: un pre-commit que corre la suite sin pipes — nació de un commit que pasó con un test rojo porque `| tail` se tragó el exit code (evidencia: el commit existe, y el hook lo hace irrepetible). Y un gate post-parche del trainer: "aditivo por intención del diff" no es evidencia; el comportamiento se mide con un run conocido.
- **Identidad de primera clase para modelos combinados**: los modelos fusionados dejaron de heredar la identidad de su clip primario; la migración — temida durante semanas como "48 puntos de superficie a tocar" — costó un helper y cinco archivos, porque acuñar la identidad en el origen evitó traducirla en cada punto. Su primer uso en producción real fue el que desenterró el bug del capítulo 6.
- **Un canario semanal por condición**: el mismo entrenamiento corto, trended en pico de memoria Y duración — con sus primeras 4 corridas declaradas de calibración, porque sus umbrales nacieron a priori y un canario también es un número que necesita contexto.

## La regla, destilada

**Un número sin su contexto de medición no es un dato: es un riesgo con formato de dato.** Régimen, presupuesto, procedencia, incertidumbre, composición. Un sistema donde ningún número viaja solo.

---

*Evidencia: `docs/SPLAT_EXPERIMENTS.md` (tabla y protocolo), `docs/BUGHUNT_BACKLOG.md` (cadenas de investigación completas), `docs/SPLAT_PIPELINE.md` (trainer), `docs/MULTISOURCE_3D.md` (tests #1-#3), `vault/eval/*/run.json` (cada número con su contexto), tag `baseline-v1`.*
