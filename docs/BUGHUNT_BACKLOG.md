# Bug Hunt Backlog — per-tab (findings verificados NO críticos pendientes)

## P0 — regresión ambiental de memoria MPS (2026-07-11, descubierta por la baseline)
- [P0][producto] **El pipeline de HOY no puede reproducir el artefacto que shippeó el 7-jul.**
  Cinematic sobre proj_...133809_0101_D: 7-jul pasó (3502s, 7000 steps, ~950k gaussianas,
  bajo el cap 11000). Hoy: OOM ×7 intentos (eval 22cám ×3 rungs, verbatim ×3, discriminador
  30cám full = réplica EXACTA de producción, peak 10715 MiB muerto ~step 2200 con solo
  ~200k gaussianas → la memoria-por-gaussiana o el allocator MPS creció, no el conteo).
  ABSUELTOS con evidencia: inputs (recon/frames mtime 7-jul intactos), binario (solo
  opensplat.cpp.o recompilado hoy; model.cpp.o del 5-jul), libtorch (oct-2025), split
  (30cám también muere), --save-every, OS (sin updates desde marzo), reboot (MISMO boot:
  uptime 8d19h cubre el 7-jul). SOSPECHOSO RESTANTE: estado acumulado del sistema
  (5 días más de uptime, swap 2.8GB, driver Metal / fragmentación / presión).
  DISCRIMINADOR REBOOT EJECUTADO 11-jul 13:0x: OOM OTRA VEZ (10732 MiB, swap 0, boot
  fresco) — estado acumulado ABSUELTO. Forense pre-reboot en eval/logs/
  pre_reboot_forensics.txt (swap estaba 5263/6144MB). SIGUIENTE: job splat-1783791846718
  encolado al worker = camino de PRODUCCIÓN real (launchd env + run_tracked) sobre el
  mismo cid/preset — si pasa, el delta está en el entorno/invocación del harness de eval;
  si falla, producción misma está rota hoy. Luego: (1) (2) medium 2000 iters para hallar el techo de HOY; (3) el
  experimento PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.4 fue inconcluso (crash en
  Model::Model, herramienta equivocada). Evidencia: eval/DJI_...0101_D/
  {20260711-*-ultra/FAILED.json, discriminator-30cam/}, eval/logs/*.log.
  BLOQUEA: baseline Phase 1 (cinematic/ultra), splats nuevos de producción >fast.

## P1 — descubierto por la baseline de eval (2026-07-11)
- [P1][producto] **La escalera de escalones OOM no reduce el driver real de memoria.**
  Evidencia: ultra OOM'eó los 3 rungs en ~200s c/u sobre la escena easy (22 cám,
  `eval/DJI_20260706133809_0101_D/20260711-085950-ultra/FAILED.json`). Los rungs
  bajan resolución (`-d 2`) pero el peak lo domina el CONTEO de gaussianas de la
  densificación, que explota temprano e independiente del downscale (el propio
  comentario de worker.py:672-674 ya lo sabía para el rung 3 — los datos ahora
  dicen que aplica a la escalera entera en escenas densas). UX actual: usuario
  elige ultra → ~10 min de cómputo quemado en 3 intentos garantizados a fallar →
  error seco honesto ("usa el preset Cinematic", worker.py:777). Fix en dos
  frentes (POST-baseline, no ahora): (a) los rungs deben degradar densificación
  (densify-grad-thresh / refine-every / stop-screen-size-at), no solo resolución;
  (b) preflight de memoria que rechace ultra ANTES de quemar los 10 min (la
  predicción de capture_quality.memory_risk existe — cablearla al enqueue).
  Implicación Phase 2.5: el sweep barre parámetros de densificación, no resolución
  — demostrado empíricamente antes de diseñarlo.

Del bug hunt masivo de 8 tabs (72 confirmados): los HIGH + crashes + XSS + UX de impacto YA arreglados.
Quedan 32 de menor severidad (polish: caret jumps, undo gaps, teardown en SPA, NaN de borde ya mitigados por los guards de fmt).

## dron
✅ VERIFICADO 2026-07-10 (hunt Inicio+Vuelos+Dron): los 8 findings de abajo YA ESTABAN arreglados
en el código. Nuevos fixes de hoy: diff del scan (foco del buscador ya no se pierde cada 10s),
anti doble-submit importar/optimizar + dedupe server de ingest, drop captura files antes del await,
403 pinta stats, /api/sd tolera SD extraída a mitad de escaneo.
- [medium] Debounced search input and filter handlers in renderBrowser fire against a stale volume snapshot and a detached DOM node after scan()
  · renderBrowser() closures at lines 234-275: the [data-bq] input debounce (lines 270-274, st._t setTim
- [medium] renderBrowser() dereferences a null querySelector result after the card set changes
  · renderBrowser(), lines 236-237 (const box = document.querySelector([data-browser=...]); if (!st.open
- [medium] Browser search input is force-lowercased and loses caret/focus mid-typing
  · renderBrowser() lines 245, 252, 270-274 — filter uses x.name.toLowerCase().includes(st.q); the debou
- [low] xhr.upload.onprogress stale-closure ETA/speed math can divide by a zero-size total and emit NaN/Infinity
  · upStart onprogress handler, lines 480-490 (item.eta computation at line 485, item.pct at line 488)
- [low] Division by zero / NaN in SD usage gauge when total is 0 or missing
  · scan(), line 185: const pct = Math.round((v.total - v.free) / v.total * 100)
- [low] scan() render crashes if any SD file entry has a null/undefined name
  · lastFlight(v), line 135: .map(x => (x.name.match(/DJI_(\d{4})(\d{2})(\d{2})/) || []).slice(1))
- [low] Upload progress math produces NaN% and Infinity ETA for a zero-byte file
  · upStart xhr.upload.onprogress, line 488: item.pct = Math.round((e.loaded / e.total) * 100); and upMe
- [low] Card gauge and optimize percentages produce NaN when a card reports total=0
  · scan() line 185 (const pct = Math.round((v.total - v.free) / v.total * 100)); same divide-by-v.total

## home
✅ VERIFICADO 2026-07-10: los 3 findings de abajo YA ESTABAN arreglados. Nuevos fixes de hoy:
velo del smash ya no queda pegado al ocultar el tab, saludo con fecha LOCAL (no UTC), dc-cloud
re-fit en rotación.
- [low] Point-cloud rAF loop (.dc-cloud) is orphaned but keeps rendering after the fit() sizing is stale; on re-render a fresh loop starts while the old canvas element is detached
  · IIFE, lines 295-322: document.querySelectorAll('.dc-cloud').forEach(cv => { ... (function frame(){ i
- [low] No cleanup/teardown contract at all: the module leaves two independent rAF families (drone frame + N point-cloud frames) and a global document listener with lifetimes tied only to isConnected checks that fire late
  · IIFE overall — flyRaf loop (line 280) and per-canvas loops (line 320) plus document listener (line 2
- [low] Last-flight duration renders 'NaN:NaN' when duration_s is missing/null
  · home.js, `${last ? ... }` block, line 159: `${fmt.dur(last.duration_s)}`

## shell
✅ CERRADO 2026-07-09:
- [x] api(): concurrent 403 race → single-flight `authInFlight` en ensureAuth
- [x] attachScrub: el timer de touchend se guarda y cancela (no resetea a mitad de scrub)
- [x] Older-jobs stale: la clave estructural usa identidades (ids), no solo el conteo

## sistema
✅ VERIFICADO 2026-07-10: ambos ya estaban arreglados (try/catch en getFlights; jobCard tolera label null desde hoy en shell.js).
- [medium] Unhandled promise rejection freezes the entire tab when flights.json fails to load
  · system.js line 73, top-level async IIFE: `const flights = await getFlights();`
- [medium] Job missing `label` crashes the feed render (same blast radius: kills all filter/table listeners)
  · IIFE, "feed de trabajos recientes" — line 143: `esc(j.label.length > 26 ? j.label.slice(-16) : j.lab

## splatlab
✅ CERRADO en commit 5f300ca (drag&drop sobre el iframe publica).
- [medium] Drag & drop over the editor does nothing — the iframe swallows drag events so they never reach #lab-drop
  · drag&drop handlers on `drop` (#lab-drop), lines 106–112, with the <iframe id="lab-frame"> as a child
- [medium] drag&drop over the iframe never delivers drop events — feature is dead over its visible area
  · drag&drop handlers on `drop` (#lab-drop) — lines 106–112, combined with the iframe at line 35

## studio
✅ VERIFICADO 2026-07-10 (hunt completo): los 9 findings de abajo están ARREGLADOS en el código actual.
Fixes nuevos aplicados hoy: reverse con trim de entrada (A1), tmp por-job + guard doble-submit (A2),
cap 120s explícito (A3), fps normalizado para xfade + timeline NO se vacía al encolar (A4),
stderr de ffmpeg visible + timeout 30min (M1/M3), progreso por corte (M4), reel aparece solo
vía onDone (M5), tl-video se pausa al cambiar módulo (M6), scrub del carrusel revivido (M9),
modal de proyectos centrado (M10).
- [medium] Reels preview <video> elements keep playing/decoding after module-tab switch and are orphaned on grid re-render
  · renderGrid(), reels branch mouseenter/mouseleave binding (lines 493-501); interacts with showMod() (
- [medium] pause() and clearTL()/delClip() don't cancel the in-flight seek() load cycle, so a stale canplay/loadeddata handler calls video.play() and video.currentTime=target after the user paused or emptied the timeline
  · seek() load-cycle (lines 882-903) vs pause() (lines 941-945) and clearTL()/delClip()/magic()/deep-li
- [medium] Deep-link ?a=/?b= with non-numeric values inserts a NaN-range segment (breaks timeline geometry)
  · deep-link block lines 1438-1441: const a = params.get('a') != null ? Math.max(0, +params.get('a')) :
- [medium] restoreProject trusts clip_id from localStorage — orphaned or malicious clip_id is never validated against byId
  · restoreProject(p) line 1375: tl = (p.tl || []).map(s => ({ ...s, id: uid() })); (no filter on s.clip
- [medium] Undo cannot revert title-size or transition-duration changes (snapshot taken AFTER mutation)
  · editor IIFE, inspector bindings — $('tli-title-size') input+change (lines 1216-1217) and $('tli-tran
- [medium] Typing a title or changing title color is never captured by undo
  · editor IIFE — $('tli-title') 'input' (line 1214) and $('tli-title-color') 'input' (line 1218)
- [medium] restoreProject restores edFps variable but leaves the FPS chip UI on the wrong selection
  · editor IIFE — restoreProject(), line 1381 (if (g.fps != null) edFps = g.fps;)
- [medium] segDur() ignores freeze, so timeline length, size estimate and playback all disagree with the exported reel
  · editor IIFE — segDur (line 636); freeze is authored at lines 1189/146, sent to export at line 1333, 
- [low] safety timeout in seek() (setTimeout(start,1500)) fires against possibly-changed timeline state; `start` runs with the stale captured `target`/`andPlay` even if the user seeked within the same clip or edited it during the 1.5s window
  · seek(), lines 882-903 (safety = setTimeout(start,1500); start sets video.currentTime=target)

## viajes
✅ VERIFICADO 2026-07-10: los 5 ya estaban arreglados (caret preservado, AbortError capturado, ||0 en duraciones, debounce cancelado al volver, q sin mutar).
- [medium] Search input caret jumps to end and page scrolls to top on every keystroke
  · renderDetail() — the #d-q 'input' handler debounce (lines 191-195) combined with the trailing window
- [low] Interrupted '#city-back' WAAPI animation causes unhandled AbortError and races renderCities against re-entrant renderDetail
  · renderDetail — '#city-back' click handler, el.animate(...).finished.then(...) (lines 180-189)
- [low] Missing duration_s yields "NaN min" everywhere (no || 0 fallback)
  · trips.js line 54 (c.dur) and line 151 (per-day dur), rendered at lines 95, 131, 157
- [low] Pending search-debounce timer is never cleared on back navigation → user is yanked back into the detail view
  · renderDetail — #city-back click handler (lines 180-190) vs. #d-q input handler (lines 191-195)
- [low] Search input text is force-lowercased on re-render, so typed uppercase characters visibly mutate
  · renderDetail — #d-q input handler line 192 storing `dstate.q = e.target.value.toLowerCase()`, echoed

## Hunt pipelines 2026-07-09 (post-fixes) — pendientes de menor prioridad
✅ CERRADOS 2026-07-10: browser_gate drena stderr; build_index tolera stat-race y manifest corrupto;
splat_quality con tail=60 (el gate ya no se queda sin líneas Step); stages de splats fallidos se
limpian al fallar. Quedan solo: pid-identity en init(), prune→artifacts huérfanos, pending atómico,
eficiencias (doble rebuild, OBJ en RAM).
- [media] jobs.py init(): mata pids guardados sin verificar identidad (pid reciclado tras reboot puede ser inocente) · fix: comparar lstart/comm antes de señalizar
- [media] browser_gate.py:165: stderr de Chrome sin drenar tras el handshake → cuelgue si llena el PIPE de 64KB · fix: thread drenador
- [baja] worker run_splat: cancel post-train pisado por updates intermedios; stages .training/ de jobs fallidos solo se limpian al reiniciar worker
- [baja] prune_splat_history puede borrar versiones a las que retarget apuntó jobs done (tarjeta "Abrir" muerta) · fix: blanquear artifacts al podar
- [baja] build_index: p.stat() sin tolerar archivo desaparecido (carrera con prune) + un manifest corrupto tumba main() · fix: try/except por archivo
- [baja] splat_quality: métricas del tail de 12 líneas — si terminan en saves, los checks de convergencia se saltan en silencio
- [baja] jobs.pending() check-then-enqueue no atómico (doble tap = 2 jobs) · fix: BEGIN IMMEDIATE
- [baja] eficiencia: doble rebuild_index por 3D; tresd_publish copia OBJ con read_bytes (RAM) y lo parsea 3×; image_list.txt write no atómico

## Hunt Studio 2026-07-10 — pendientes menores
- [media] M7: preview de freeze/reverse diverge del export (playhead desincronizado en esos clips)
- [media] M8: borrar clip/undo DURANTE reproducción congela el player (pause() al inicio de delClip/undo/redo)
- [media] M3b: jobs 'edit' sin botón Cancelar (requiere migrar run_edit a run_tracked)
- [baja] B2-B4: reorder multi-undo, tap en handle = undo espurio, tli-freeze sin clamp JS
- [baja] B5: apóstrofes/':'/'%' del título se borran en silencio
- [baja] B6: estimado de tamaño ignora xfade/límites/audio
- [baja] B7/B8: authGate ante 500 dice 'Inicia sesión'; cancel de login = unhandled rejection
- [baja] B10: 'Nuevo proyecto' no resetea título/LUT/fps/bitrate; sin beforeunload guard del timeline

## Hunt 3D 2026-07-10 — diferidos menores
- [baja] selectedSplatByClip (localStorage) no poda claves de clips borrados
- [baja] /api/capture_report sin lock (clicks rápidos = análisis paralelos; mitigado por cache cliente)
- [baja] /upload y /api/splat_upload responden 4xx sin drenar el body (browser reporta error de red)
- [baja] pending()→enqueue() no atómico en /api/odm y /api/splat (2 clientes simultáneos)
- [baja] maximum-scale=1.0 bloquea pinch-zoom de página en Android (deliberado por los visores)

## Hunt Inicio+Vuelos+Dron 2026-07-10 — diferidos
- [baja] dron héroe del Inicio intercepta taps sobre el chip de trabajos/título cuando vuela encima (trade-off de diseño: es interactivo a propósito)
- [baja] /api/highlight: read-modify-write sin lock (2 marcas rápidas → 1 se pierde)

### P0 — discriminador binario (lecturas PRE-escritas, 11-jul tarde)
Worker limpio OOM ×3 → producción rota hoy. Binario sospechoso preservado:
eval/logs/opensplat-suspect-20260711 (sha cec01b29). TRES BUILDS: (a) limpio 9fb62fd
sin patch → si PASA, el binario de ayer era el problema → (b) re-aplicar patch +
rebuild → si PASA, culpable = link de ayer (rebuildeá y listo); si FALLA, culpable =
el patch mismo (rediseño; "aditivo post-carga" se verificó por intención, no por
comportamiento — gate permanente: cinematic conocido tras CUALQUIER parche al trainer).
Si (a) FALLA → bisección de insumos. Timeline: TODO fallo es post-patch; único pass
post-patch = fast (densificación mínima — donde overhead por-gaussiana no se nota).

### P0 — matriz cruzada completa + hipótesis de marginalidad (11-jul tarde)
| binario | env | camino | resultado |
|---|---|---|---|
| parcheado | shell (MallocNanoZone=0) | nohup | OOM ×N |
| parcheado | launchd limpio | worker run_tracked | OOM ×3 |
| limpio 9fb62fd | shell | nohup | OOM (10766 — idéntico) |
→ binario/patch/re-link ABSUELTOS conductualmente; env ABSUELTO (cruzado).
HIPÓTESIS ACTIVA — MARGINALIDAD, no regresión: todas las muertes caen en
10210-11000 MiB (±5% del cap; nunca 6GB, nunca 15GB). Cinematic en esta escena
siempre necesitó ~10.5-11+ GB; el 7-jul pasó ROZANDO el cap sin instrumentación
que lo viera (el peak recorder nació el 11); ruido de ±3% (init aleatorio,
allocator, nº de cámaras) voltea el resultado. No apareció un acantilado —
siempre estuvimos en el borde. Corrobora: reporte DeepSeek del 9-jul ya
flaggeaba anomalías splat el 8-9 jul (PRE-patch) y "06/07 punto de inflexión".
DISCRIMINADOR CORRIENDO: mismo run con taskpolicy -m 12500 — si completa con
peak ~11-12GB ⇒ confirmada ⇒ P0 se reescribe como "preset al borde del cap" y
los fixes son los del P1 (rungs sobre densificación + margen/preflight) + el
peak del sidecar como guardia permanente. Si OOM'ea a 12500 ⇒ crecimiento no
acotado ⇒ bisección real.
