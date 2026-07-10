# Bug Hunt Backlog — per-tab (findings verificados NO críticos pendientes)

Del bug hunt masivo de 8 tabs (72 confirmados): los HIGH + crashes + XSS + UX de impacto YA arreglados.
Quedan 32 de menor severidad (polish: caret jumps, undo gaps, teardown en SPA, NaN de borde ya mitigados por los guards de fmt).

## dron
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
- [medium] Unhandled promise rejection freezes the entire tab when flights.json fails to load
  · system.js line 73, top-level async IIFE: `const flights = await getFlights();`
- [medium] Job missing `label` crashes the feed render (same blast radius: kills all filter/table listeners)
  · IIFE, "feed de trabajos recientes" — line 143: `esc(j.label.length > 26 ? j.label.slice(-16) : j.lab

## splatlab
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
