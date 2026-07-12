# FLIGHTVERSE — UI Audit (Fase 0)

> Baseline previa a construir /mundo. Cada hallazgo: severidad, causa raíz
> (selector), fix previsto, test de regresión. Screenshots vía pane con sesión.

## Hallazgos del integrador (breakpoints 1440×900 y 390×844, tresd.html)
| # | Hallazgo | Sev | Causa raíz | Fix previsto | Regresión |
|---|---|---|---|---|---|
| I1 | A 390px el indicador (.pm-ink) del tab activo se extiende sobre el label vecino ("Trabajos") | media | .pm-ink calcula ancho con métricas desktop; sin recalc en viewport angosto | recalcular ink on-resize o width por button real | test visual 390px: ink.right ≤ botónActivo.right+2 |
| I2 | Scrollbar horizontal crudo bajo .td-stepper en móvil | baja | overflow-x:auto sin estilizado ni scroll-snap | scrollbar-width:none + mask-fade + scroll-snap-x | screenshot 390px sin barra gris |
| I3 | Último ítem del bottom-nav ("Splat Lab") cortado a 390px | media | nav inferior con overflow y sin indicador de scroll | fade lateral + snap, o colapsar labels a iconos <420px | 7/7 ítems alcanzables a 390px |
| I4 | overflow-x de documento: NO hay (✓) en 1440 ni 390 | — | — | mantener assert en tests | scrollWidth ≤ innerWidth |

## Limitación de entorno (documentada sesión previa)
El pane embebido congela rAF (0 ticks) → MapLibre/anims no progresan AHÍ;
verificación de mapa/60fps = browser real del operador + métricas por código.

## Pendiente de agentes A/E (renderer/estado/assets · showcase/AI/persistencia)
Se anexa al aterrizar.

---

## Consolidación AGENT A (renderer/estado/assets) — hechos con file:line
**Motor**: three.js r160 WebGL (no WebGPU) + @mkkellogg/gaussian-splats-3d 0.4.7
(vendor local). Vanilla ES modules, sin build step. Visor splat compartido =
`mountSplatViewer` (web/splatview.js:26), usado por tresd.js y share.js.
**`DropInViewer` SÍ está exportado** en el bundle → escena unificada posible.

- **Render loops**: GS maneja su loop interno (viewer.start, splatview.js:96);
  mesh viewer = RAF on-demand con auto-teardown al desconectar del DOM
  (tresd.js:1383-1404: dispose de geo/mat/tex + forceContextLoss). Nunca
  conviven >2 contextos WebGL (cap ~16 documentado splatview.js:59).
- **Cámara**: NO persistida; derivada de bounds al montar. cameras.json de
  splats = poses SfM reales (fx/fy, position, rotation en frame normalizado)
  — HOY NO consumidas por ningún visor → materia prima para rigs/FPV.
- **TRES frames de coordenadas distintos** (la fricción #1 del runtime):
  splat (normalizado OpenSplat, Y-up tras SPLAT_ROT), mesh viewer (metros,
  recentrado al centroide — offset cx,cy,cz NO persistido en meta.json;
  tresd_publish.py:58-77 lo calcula y lo tira), DSM/orto (WGS84 + gt GDAL).
  → SceneManifestV2 debe exportar el offset y una capa de transformación.
- **DSM**: solo server-side (np.memmap; /api/measure). NO hay lectura cliente
  ni malla de terreno. dsm.bin=126MB → LOD pyramid obligatoria para cliente.
- **Colisión**: inexistente. Proxies viables: odm_textured_model_viewer.obj
  (metros, origen) o heightfield del DSM (honesto, barato).
- **Captura**: PNG via toDataURL con render síncrono previo (sin
  preserveDrawingBuffer, splatview.js:240-243). NO hay captureStream ni
  MediaRecorder en web/ → Quick Record parte de cero.
- **Audio**: cero infraestructura WebAudio.
- **Workers**: GS usa SortWorker con postMessage-copia
  (sharedMemoryForWorkers:false). SIN COOP/COEP en el server →
  crossOriginIsolated=false → SAB no disponible (WebCodecs sí, no requiere SAB).
- **pollJobs**: guard correcto — solo refresca visores si el job es del
  proyecto abierto (tresd.js:945-947); _loadToken invalida cargas en vuelo.

## Consolidación AGENT E (showcase/AI/persistencia/Studio)
- **Público sin auth YA existe**: share.html (?m=cid) y p.html (?id=slug) —
  denylist del static server (server.py:1097-1102) deja público todo el vault
  salvo dotfiles/.db/.token/.env/.jsonl/.log y ops/trash/odm/raw. CSP
  frame-ancestors 'none' + sin CORS → FLIGHTVERSE vive same-origin.
- **Persistencia**: localStorage (proyectos Studio 'ab.studio.projects'),
  jobs.db (jobs+sessions, NO store genérico), JSON-en-vault por recurso
  (ai/{cid}.json = highlights/POIs; properties/{slug}.json). NO hay store de
  replays/desafíos → nuevo store JSON-en-vault con handler propio.
- **AI lanes**: ai/router.py (gemini_vision/deepseek_text/openai_text) +
  plantilla de endpoint = /api/analyze (auth→valida→dedupe→job→thread).
  Nuevos endpoints AI del creador: usar router, NO el _deepseek inline.
- **Studio timeline**: track único magnético tl=[{id,clip_id,a,b,speed,filter,
  title,transition,transDur,reverse,freeze,titleStyle,grade}], undo cap 60,
  razor global→fuente. run_edit: ffmpeg h264_videotoolbox, máx 24 cortes ×
  120s, concat|xfade. → Contrato de segmentos = schema de partida del Video
  Studio; falta multi-track y persistencia server-side.
- **foto4k**: /api/frame extrae del RAW (no proxy) → photos/{cid}_{t}s.jpg.
- **Tokens de diseño**: "Instrument Graphite" (style.css:2-35) — reusar, no
  inventar paleta nueva. Iconos: web/icons.js (falta 'globe' → añadir).
- **NAV**: array en shell.js:24-32; /mundo = entrada nueva + mundo.html.
- **QA visual**: browser_gate.py (CDP stdlib headless Chrome) +
  browser_matrix.py (viewports, no-overflow, screenshot no-vacío) → patrón
  run_mundo a copiar. El pane embebido congela rAF → gates SIEMPRE por CDP.

## Baseline de perf (escena 1 = DJI_20260704160358_0104_D, localhost)
| Asset | Bytes | TTFB |
|---|---|---|
| tresd.html | 830 | 5.4ms |
| three.module.js (gz) | 256,394 | 2.4ms |
| gaussian-splats-3d (gz) | 66,211 | 1.7ms |
| meta.json | 2,075 | 1.0ms |
| ksplat escena 1 | 36,299,580 | — (héroe, progresivo) |
| dsm.bin | 126,508,032 | NUNCA al cliente → LOD |
| ortho.webp | 715,366 | textura terreno viable |
