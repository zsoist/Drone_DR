# Hunt masivo 2026-07-10 — triage (workflow wf_e898a340-82c, cortado por token limit)

> **Snapshot histórico.** Los números de línea y estados pertenecen a ese corte. Para
> pendientes vigentes usa [BUGHUNT_BACKLOG.md](BUGHUNT_BACKLOG.md) y los tests actuales.

56 findings de finders (verificación adversarial parcial — triar antes de aplicar).
RESUME del hunt: Workflow({scriptPath: ".../aerobrain-massive-hunt-wf_e898a340-82c.js", resumeFromRunId: "wf_e898a340-82c"})

> ESTADO 2026-07-10: crítica de seguridad + 6 ALTA + 12 MEDIA/BAJA aplicadas (commits 76ef8ea + este). El resto queda para retomar — ver RESUME arriba.


- [x] **[critica]** `aerobrain_server.py:1087` — El montaje estatico /data sirve toda la raiz del VAULT sin auth ni denylist, filtrando el token maestro (/data/.token) y la base de sesiones (/data/manifest/jobs.db) — compromiso total pre-auth.
  · fix: En resolve() rechazar dotfiles y extensiones sensibles (.token/.db/.sqlite/.env) y confinar /data a subdirectorios publicos explicitos (models/reels/photos/manifest/flights.json), nunca a la raiz del VAULT ni a manifest/jobs.db.
- [x] **[alta]** `jobs.py:64` — init() mata el PID guardado de jobs pesados huérfanos SIN verificar identidad; tras un reboot ese PID casi siempre pertenece a otro proceso.
  · fix: Antes de señalizar, verificar identidad del pid (comparar create-time/comm del proceso vs job.started via psutil o `ps -o lstart=,comm= -p`) y saltar si no coincide.
- [x] **[alta]** `build_index.py:222` — El lector de tracks para routes.json no está protegido: un punto con lon/lat null o ausente (dropout GPS) rompe TODO el rebuild del índice.
  · fix: Envolver json.loads(tf) + el armado de line en try/except y filtrar puntos cuyos lon/lat no sean números finitos antes de round().
- [x] **[alta]** `build_index.py:213` — json.loads del sidecar ai/<cid>.json sin try/except: un AI JSON truncado (write parcial del pipeline LLM) tumba el rebuild completo.
  · fix: Rodear a = json.loads(aif.read_text()) con try/except (ValueError, OSError): continue/skip, igual que load_models.
- [x] **[alta]** `p.html:10` — La pagina publica de propiedad no tiene Open Graph ni meta description; el titulo solo se fija por JS (p.js:7), que los crawlers no ejecutan. render_html en el server solo reescribe versiones de assets, no inyecta OG.
  · fix: Inyectar server-side og:title/og:image/og:description + <meta name=description> desde el JSON de la propiedad en render_html (que ya intercepta p.html).
- [ ] **[alta]** `tresd.js:403` — Controles interactivos principales renderizados como <div> con data-* y delegacion de click, sin role/tabindex/manejo de teclado: no son enfocables ni operables por teclado (WCAG 2.1.1). Afecta .proj-card (tresd.js:403 — seleccionar proyecto 3D), .mflight (tresd.js:516) y .mpreset (tresd.js:527) dentro del modal de creacion, .mcard (map.js:144) y .city-card (trips.js:83). El :focus-visible global (style.css:337) nunca aplica porque un <div> no entra en el orden de tabulacion.
  · fix: Convertir estas tarjetas en <button type=button> (o anadir role="button" tabindex="0" + handler keydown Enter/Espacio).
- [x] **[alta]** `app.js:44` — Botones de solo-icono sin nombre accesible: los toggles de vista Cuadricula (app.js:44) y Lista (app.js:45) contienen solo icon('grid')/icon('list') (SVG sin title/aria) y su unica etiqueta es data-tip, que no se expone a lectores de pantalla y ademas se oculta en tactil via @media (hover:none) (style.css:1015). Mismo patron en flight.js:28 (boton volver hero-back) y flight.js:44 (boton archivar #btn-arch). En movil los botones Mapa/Lugares/Fechas tambien quedan sin nombre porque .seg-lb es display:none <=700px (style.css:802) y no hay aria-label de respaldo.
  · fix: Anadir aria-label (o title) explicito a cada boton de solo-icono, p.ej. aria-label="Vista cuadricula".
- [x] **[alta]** `shell.js:118` — El fetch('/api/login') del onsubmit no tiene try/catch: un fallo de red lanza dentro del handler async y wedgea la autenticación de toda la página.
  · fix: Envolver el fetch en try/catch: en catch mostrar #lg-err, re-habilitar el botón (go.disabled=false; go.textContent='Entrar') y NO dejar la promesa colgada.
- [ ] **[media]** `studio.js:945` — M7 VIGENTE: en clips con freeze el preview reproduce el clip a movimiento completo (a→b) y el playhead avanza (b-a)/speed en un slot que solo mide 'freeze'; el export congela el frame 'a' durante 'freeze' s (aerobrain_server.py:929/938). El tick nunca trata freeze como caso especial. Reverse tampoco se refleja (seek fija playbackRate positivo en :887, nunca reproduce en reversa).
  · fix: En tick (studio.js:943-948) si at.clip.freeze>0 avanzar playhead por tiempo de pared (no por video.currentTime) y saltar al siguiente clip tras 'freeze' s, manteniendo el video fijo en clip.a.
- [ ] **[media]** `studio.js:997` — M8 VIGENTE: delClip (:997), undo (:665) y redo (:666) mutan tl y llaman renderAll/seek SIN pause() mientras playing sigue true y el rAF tick sigue vivo; el nuevo seek entra con pendingPlay=false así que el video no reanuda pero el loop queda girando con playhead congelado.
  · fix: Llamar pause() al inicio de delClip (studio.js:997), undo (:665) y redo (:666) antes de mutar tl.
- [ ] **[media]** `studio.js:1214` — B4 VIGENTE: el handler de #tli-freeze solo aplica Math.max(0, +value) sin tope superior; el atributo HTML max=10 no restringe valores tecleados y el servidor clampa freeze a 30s (aerobrain_server.py:923), así que el preview usa el valor crudo.
  · fix: Clampar igual que el servidor en studio.js:1214: s.freeze = Math.min(30, Math.max(0, +e.target.value||0)) y reflejarlo de vuelta al input.
- [ ] **[media]** `aerobrain_server.py:1697` — pending()→enqueue() no es atómico: el _LOCK se libera entre ambas llamadas, así que dos requests concurrentes pasan el 409 y encolan un job pesado duplicado (mismo defecto en /api/splat:1853).
  · fix: Mover el check+insert a un solo jobstore.enqueue_if_absent() con BEGIN IMMEDIATE (SELECT ... e INSERT dentro de la misma transacción).
- [ ] **[media]** `build_index.py:212` — Los sidecars por-clip (ai/<cid>.json:212, tracks/<cid>.flight.json:219, ingest-*.json:231) se parsean SIN try/except; un solo archivo corrupto tumba main() y deja flights.json/system.json sin regenerar (la corrección de 'manifest corrupto' fue incompleta).
  · fix: Envolver cada read de ai/tracks/ingest en try/except (ValueError,OSError) con skip+log, igual que el loop de manifests (y hacer atómica la escritura de /api/highlight).
- [ ] **[media]** `aerobrain_server.py:1621` — /api/edit (y /api/frame, /upload) lanzan trabajos ffmpeg pesados en hilos daemon sin limite de concurrencia ni dedupe pending, a diferencia de odm/splat/analyze/ingest.
  · fix: Gatear edit/frame/upload con un pool acotado o un chequeo de conteo de jobs LIGHT activos que devuelva 429 al superar el limite de concurrencia.
- [x] **[media]** `build_index.py:231` — json.loads(ingests[-1]) + acceso directo a last['file_count']/['total_bytes']/['ingested_at'] sin guardas: un ingest json en carrera o corrupto rompe system.json.
  · fix: try/except alrededor de la lectura y usar last.get('file_count')/.get('total_bytes')/.get('ingested_at') con defaults.
- [x] **[media]** `build_index.py:14` — dir_size() hace f.stat() dentro del rglob sin capturar OSError: race TOCTOU durante ingest/prune borra el archivo entre is_file() y stat() -> crash de system.json.
  · fix: Sumar tamaños con un helper try/except OSError por archivo (saltar los que desaparecen) en vez de sum(f.stat().st_size ...).
- [x] **[media]** `sync_supabase.py:122` — El sync de AI solo hace glob('DJI_*.json'): los clips UP_ (prefijo soportado por build_index) se pierden silenciosamente del mirror de Supabase y del ai_count.
  · fix: Cambiar el glob de AI a un patrón que incluya ambos prefijos (p. ej. glob('*.json') filtrando por clip_id conocido) en sync_supabase:122 y build_index:236.
- [x] **[media]** `sync_supabase.py:147` — json.loads(mf) del meta.json de modelos sin try/except: un meta corrupto rompe el sync DESPUÉS de haber subido flights/tracks/ai -> mirror parcial y atasco permanente.
  · fix: Envolver la lectura del meta en try/except (ValueError, OSError): continue, igual que build_index.load_models.
- [x] **[media]** `sync_supabase.py:149` — json.dumps con allow_nan por defecto: un float no-finito (NaN/Inf) en dsm_min/dsm_max/qa/stats emite el token 'NaN', PostgREST responde 400 y falla el upsert ENTERO de esa tabla.
  · fix: Sanitizar floats no-finitos a None (o usar json.dumps(..., allow_nan=False) con limpieza previa) antes de cada upsert.
- [ ] **[media]** `sync_r2.py:45` — El ledger de R2 compara solo por TAMAÑO: una edición de contenido que preserva el número de bytes nunca se re-sube (asset viejo servido) y los borrados locales nunca se propagan a R2.
  · fix: Clavar el ledger en (size, mtime) o un hash de contenido, y reconciliar borrados contra el listado de R2.
- [x] **[media]** `capture_quality.py:153` — blur_frac se mide relativo a la mediana del propio clip (s < sharp_med*0.5), así que un vuelo uniformemente desenfocado da blur_frac≈0 y se califica como nítido.
  · fix: Añadir un umbral ABSOLUTO de nitidez (p. ej. sharp_median por debajo de un piso) que penalice suitability y dispare warning, además del blur_frac relativo.
- [ ] **[media]** `share.js:66` — share.html (visor publico sin sesion) descarga data/manifest/system.json, que el server sirve sin auth (aerobrain_server.py:1204, tras el branch autenticado /api/properties), exponiendo el catalogo completo.
  · fix: Poner la lista de splats del modelo dentro de data/models/<cid>/meta.json y dejar de leer system.json en paginas publicas (o gatear system.json tras auth).
- [x] **[media]** `p.js:12` — El lightbox de la galeria usa window.open(g.dataset.full), sacando al comprador de la pagina de venta hacia el JPG crudo.
  · fix: Reemplazar window.open por un overlay/lightbox in-page con boton de cierre.
- [x] **[media]** `p.js:10` — Los nombres de frame de la galeria se adivinan (f_(i*3+2), hasta gallery_n) y gallery_n NUNCA lo escribe el server (siempre =8), sin acotar por el frame_count real del clip.
  · fix: Acotar los indices al frame_count real del clip (server debe escribir gallery_n o la lista real de frames en la propiedad).
- [x] **[media]** `p.js:4` — No hay try/catch alrededor de fetch()/r.json(); solo se maneja el caso !r.ok (404).
  · fix: Envolver el cuerpo en try/catch y renderizar un estado de error/reintento en #root.
- [ ] **[media]** `style.css:148` — select.ctl e input.ctl declaran outline:none con especificidad (0,1,1), que gana al :focus-visible global (0,1,0) incluso al enfocar por teclado. input.ctl si tiene reemplazo (input.ctl:focus, linea 154) pero NO existe regla select.ctl:focus, asi que los <select> quedan sin ningun indicador de foco. Los sliders repiten el patron sin reemplazo: .pm-range (1133), .tl-inspect .tl-range (1985) y .td-search input (440).
  · fix: Anadir select.ctl:focus-visible/ input[type=range]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } (o quitar el outline:none).
- [ ] **[media]** `style.css:866` — Los badges de calidad .si-q usan hexes fijos fuera de la paleta (#34d399, #60d0e6, #e0b64a, #e08a6a, lineas 866-869) sobre un fondo del mismo tono al 14%; no reaccionan a [data-theme]. En tema claro el texto queda ilegible: #34d399 sobre surface-2 (#EAEEF4) da ~1.7:1 (WCAG AA exige 4.5:1 para texto pequeno de 9px).
  · fix: Usar los tokens de tema (var(--mint)/--accent/--amber/--red) para color y fondo de .si-q en lugar de hexes fijos.
- [ ] **[media]** `style.css:2407` — Estados de error/peligro codificados con #ff6b6b y #f06b5a fuera de la paleta en vez de var(--red): .up-card.bad .up-meta (2407), .up-card.bad .up-ic/bar (2402/2412), .perf-chip.warn (2930), .splat-item .btn.danger (879), .m-actions button.danger (1274). No adaptan a tema claro; #ff6b6b sobre surface-2 claro (#EAEEF4) da ~2.4:1 y es justamente el texto que comunica el fallo de una subida.
  · fix: Reemplazar los #ff6b6b/#f06b5a por var(--red) (que ya tiene variante clara #C24C4C) para color/borde/fondo.
- [ ] **[media]** `style.css:382` — .jc-status.queued usa color:var(--text-3) (#566274) sobre background:var(--surface) (#11151C) = ~3.0:1 en tema oscuro (bajo el 4.5:1 requerido para texto de 10px). Ademas el fondo de la pildora (surface) es casi identico al fondo de la .job-card (surface-2, #171D26), asi que la propia pildora de estado 'EN COLA' resulta practicamente invisible.
  · fix: Subir el color a var(--text-2) y darle fondo con contraste (p.ej. color-mix del amber/accent) como hacen los demas .jc-status.*.
- [ ] **[media]** `app.js:274` — La cadena fetch(routes.json).then().then() no tiene .catch (a diferencia de system.json en línea 418): rutas faltantes/corruptas producen unhandled rejection y el mapa falla en silencio.
  · fix: Añadir .catch(() => {}) (o manejo con aviso) al final de la cadena fetch(routes.json) igual que en system.json.
- [ ] **[media]** `splatview.js:96` — El comentario (línea 40) promete pausar el loop con visibilitychange 'abajo', pero no existe tal listener: con renderMode Always el rAF de viewer.start() renderiza sin parar.
  · fix: Registrar document.addEventListener('visibilitychange', ...) que llame viewer.stop()/start() según document.hidden y removerlo en dispose().
- [x] **[media]** `flight.js:81` — El panel 'Momentos' (hl-list) usa el `t` del highlight AI SIN la coercion `+h.t || 0` que el resto del codigo aplica (cf. chips del panel AI en linea 158 `data-t="${+h.t || 0}"`). En linea 81 `&b=${h.t + 4}` concatena strings y en linea 79 `data-t="${h.t}"` no coacciona.
  · fix: Al inicio del `.map(h => ...)` de hl-list, calcular `const t = +h.t || 0;` y usar `t` en data-t (79), fmt.dur, y a/b del link (81).
- [ ] **[baja]** `studio.js:1439` — B10 VIGENTE: 'Nuevo proyecto' (:1439-1441) solo vacía tl (clearTL) o el título; NO resetea ed-lut/edFps/ed-bitrate/ed-aspect/ed-preset/ed-trans/ed-audio/ed-fade, y no existe guard beforeunload en studio.js (solo drone.js:579 lo tiene).
  · fix: En el handler ed-new (studio.js:1439) resetear los selects/inputs globales + edFps='' con syncFpsChips(), y añadir window.addEventListener('beforeunload', e=>{ if(tl.length){e.preventDefault();e.returnValue='';} }).
- [ ] **[baja]** `studio.js:442` — B7 VIGENTE: loadMedia trata CUALQUIER status !==200 como falta de sesión (if (!r || r.status !== 200) authGate()), incluido un 500 del servidor.
  · fix: Gate solo ante auth en studio.js:442: authGate() únicamente si r.status===401||r.status===403; para otros !==200 mostrar un error genérico de carga.
- [ ] **[baja]** `studio.js:1096` — B2 VIGENTE: durante un arrastre de reordenamiento, cada cruce del centro del vecino llama pushUndo() (líneas 1096 y 1100), generando múltiples snapshots en un solo gesto.
  · fix: Empujar un solo snapshot en el primer swap del gesto (guard action.undoPushed) en studio.js:1096/1100 en vez de pushUndo() en cada cruce.
- [ ] **[baja]** `studio.js:1074` — B3 VIGENTE: al hacer pointerdown sobre una manija de trim se llama pushUndo() inmediatamente (:1074), antes de cualquier movimiento.
  · fix: No hacer pushUndo en pointerdown (studio.js:1074); empujarlo perezosamente en el primer pointermove de trim que realmente cambie a/b (con un flag guard).
- [ ] **[baja]** `aerobrain_server.py:888` — B5 VIGENTE: el título del reel/corte se sanitiza borrando apóstrofes y '%' en silencio (líneas 888 y 919: .replace("'","").replace("%","")); el cliente (studio.js ed-title/tli-title) muestra el texto completo y nunca avisa.
  · fix: En vez de borrar, escapar para drawtext (o escribir el texto a un textfile y usar textfile= para evitar el escaping) en aerobrain_server.py:888/919; como mínimo devolver al cliente el título saneado.
- [ ] **[baja]** `studio.js:1352` — B6 VIGENTE: el estimado de tamaño usa mb = bitrate*total()/8 (:1352) con total() = suma de segDur; ignora el solape de los crossfades (que acorta el reel) y no suma bitrate de audio.
  · fix: En studio.js:1352-1354 restar el solape de xfade (suma de transDur de clips i>0 con transición activa) de la duración usada y sumar un término de bitrate de audio cuando ed-audio!=='none'.
- [ ] **[baja]** `aerobrain_server.py:152` — prune_splat_history() borra grupos de versión antiguos sin blanquear el artifact de los jobs 'done' que retarget_splat_artifacts apuntó a esas versiones archivadas → tarjeta 'Abrir' muerta.
  · fix: Al podar, llamar un jobstore.blank_artifacts(paths) que ponga artifact='' en los jobs done cuyo artifact esté entre los files eliminados.
- [ ] **[baja]** `worker.py:555` — Reescritura in-place NO atómica de opensfm/image_list.txt (read_text→replace→write_text sobre el mismo archivo); un kill/crash a mitad lo trunca y corrompe la fuente de verdad de poses/n_cams para reruns.
  · fix: Escribir a tmp y os.replace: il.with_suffix('.tmp').write_text(nuevo); os.replace(tmp, il).
- [ ] **[baja]** `tresd_publish.py:389` — Los outputs de texturing (incluido el OBJ geo, que en alta/ultra pesa cientos de MB) se copian con f.read_bytes()/write_bytes() cargando el archivo COMPLETO en RAM en un M4 de 16GB.
  · fix: Sustituir write_bytes(f.read_bytes()) por shutil.copy2(f, dst) (copia por streaming).
- [ ] **[baja]** `tresd_publish.py:400` — El OBJ geo se parsea línea-a-línea 3 veces: make_viewer_mesh lo recorre 2× (centroide en 61-66 + reescritura en 70-77) y obj_stats() lo recorre otra vez en la línea 400.
  · fix: Acumular vertices/faces dentro del loop existente de make_viewer_mesh y devolver mesh_stats desde ahí, eliminando la pasada extra de obj_stats().
- [ ] **[baja]** `worker.py:521` — Doble rebuild_index por job 3D: tresd_publish.py ya ejecuta build_index.py (su línea 510) y build_3d_assets vuelve a llamar rebuild_index() en la 521 pocos ms después.
  · fix: Pasar preset/title a tresd_publish.py (que ya reescribe meta.json atómico) y eliminar el rebuild_index() de worker.py:521, o escribir preset/title antes de que tresd_publish haga su propio rebuild.
- [ ] **[baja]** `aerobrain_server.py:1671` — Varios handlers (measure, compare, capture_report) devuelven str(e)[-200:] al cliente, filtrando detalle interno de excepciones (rutas absolutas, internals de numpy).
  · fix: Registrar la excepcion server-side y devolver un mensaje generico, como ya hace el handler de nivel superior en do_POST.
- [ ] **[baja]** `aerobrain_server.py:1874` — El rate-limit de /api/client_error es un unico contador global 60/hora, no por IP/sesion, asi que cualquiera con acceso same-origin puede agotarlo y silenciar toda la telemetria de errores del frontend.
  · fix: Indexar el presupuesto por IP/sesion (o subir el tope con buckets por origen) en lugar de un solo contador de proceso _CLIENT_ERR_BUDGET.
- [ ] **[baja]** `aerobrain_server.py:1514` — /upload (y /api/splat_upload) leen Content-Length bytes en un bucle bloqueante sobre un server hilo-por-conexion, sin timeout de socket ni limite de tiempo total.
  · fix: Aplicar self.connection.settimeout() por lectura y un limite de wall-clock por subida, abortando transferencias estancadas.
- [x] **[baja]** `capture_quality.py:113` — gps_metrics asume lon/lat no-null: un punto con coordenada null hace math.radians(None) en _hav_m/_bearing -> TypeError y no se genera el reporte de captura.
  · fix: Filtrar puntos cuyos lon/lat no sean números finitos al construir lls/alts/ts al inicio de gps_metrics.
- [x] **[baja]** `p.js:16` — Cuando la propiedad no tiene ni video ni clip, poster='' y se emite <img src=""> en el hero.
  · fix: Emitir el <img> del hero solo si poster es truthy; si no, un placeholder neutro.
- [ ] **[baja]** `share.js:116` — El link de descarga 'Ortofoto 5K' (ortho_full.jpg) se renderiza siempre, sin gatearlo por un flag de meta como si se hace con COPC/OBJ/splat.
  · fix: Gatear el <a> de la ortofoto (y validar cloud.ply) con un flag en meta, igual que las otras descargas.
- [ ] **[baja]** `style.css:325` — Reglas CSS muertas (0 usos en todo el JS, verificado por grep): .cutcard y sus hijos .cc-info/.speed-chip/.cc-btns (325-331, editor studio v4 reemplazado por el timeline .tl-*), .chart-val (261), y los restos de la card dc3 .dc-flip/.dc-face/.dc-front/.dc-back (1855-1863) y .dc-sheen (1542-1550). Aumentan el peso del CSS y confunden el mantenimiento.
  · fix: Eliminar estos bloques de selectores sin uso del style.css.
- [ ] **[baja]** `shell.js:296` — El handler async de click en #auth-link hace await fetch('/api/whoami') y fetch('/api/logout') sin try/catch -> unhandled rejection ante fallo de red.
  · fix: Envolver los fetch del handler en try/catch y avisar con alert/mensaje ante error de red.
- [ ] **[baja]** `shell.js:183` — En jobCard, meta.name (que cae a j.kind sin escapar para kinds desconocidos, línea 181) y f.time se interpolan al innerHTML del título sin esc().
  · fix: Escapar: usar esc(meta.name) (y esc(f.time)) al construir title en la línea 183.
- [ ] **[baja]** `flight.js:292` — El handler de 'Re-analizar profundo' ignora la respuesta de /api/analyze y hace polling de /api/jobs sin ninguna condicion de terminacion cuando no aparece el job.
  · fix: Leer `{ok, job}` de la respuesta de api('/api/analyze'), abortar si !ok, y pollear por ese `job` id concreto con un `{ jobs = [] } =` por defecto.
- [ ] **[baja]** `flight.js:303` — Los handlers de accion (btn-hl:303, btn-label:312, btn-arch:318, btn-photo:275, btn-deep:288) hacen `await api(...)` sin try/catch; app.js SI envuelve la llamada equivalente de rename (try/catch, ref #7).
  · fix: Envolver cada `await api(...)` de estos handlers en try/catch con un alert('Revisa tu sesion') como en app.js:243-246.
- [ ] **[baja]** `flight.js:373` — `chart()` calcula `X = i => (i / (series.length - 1)) * w`; con un solo punto de telemetria `series.length===1` da division por cero -> NaN en todas las coordenadas.
  · fix: Usar `const X = i => series.length > 1 ? (i/(series.length-1))*w : w/2;` (o saltar el render de charts si series.length < 2).
- [ ] **[baja]** `map.js:1` — map.js y map.html estan huerfanos: ningun HTML carga map.js y map.html es solo un <meta refresh> (linea 5) hacia index.html?v=map; la vista mapa real vive en app.js `renderMap()`. Cualquier fix en map.js no tiene efecto en runtime.
  · fix: Borrar web/map.js y web/map.html (o dejar solo el redirect de map.html) ya que app.js renderMap es la unica vista mapa activa.
