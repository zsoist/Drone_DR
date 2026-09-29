// Dron — centro de mando de tarjetas SD: importa al vault verificando cada byte,
// optimiza la tarjeta por niveles, y explora su contenido con filtros.
const main = renderShell('drone.html');
main.classList.add('dr-page');
const CHAIN = [
  ['db', 'SD', 'lectura', 'Lee la carpeta DCIM de la tarjeta'],
  ['dl', 'Copia', 'al SSD', 'Copia cada archivo al SSD del Mac'],
  ['check', 'Verificación', 'byte a byte', 'Compara tamaño byte a byte antes de dar por buena la copia'],
  ['film', 'Proxies', '1080p · 720p', 'Genera streaming 1080p y 720p por hardware'],
  ['route', 'GPS', 'track + miniaturas', 'Extrae la telemetría del .SRT: ruta, altura, velocidad'],
  ['drone', 'Vault', 'original intocable', 'El original queda intocable en raw/'],
];
const FLOW = [
  'Aterriza y saca la micro SD del dron.',
  'Insértala en el Mac.',
  'Pulsa <b>Importar nuevos</b> en la tarjeta detectada.',
  'Cuando termine, usa <b>Optimizar</b> con el nivel Fábrica.',
  'La tarjeta vuelve al dron vacía y lista.',
];
main.innerHTML = `
  ${pageHead('Dron', 'Todo el material entra por aquí. Elige tu vía.',
    `<span class="dr-sess" id="up-session" data-tip="La subida directa requiere sesión de operador"><i class="dr-dot"></i>Comprobando sesión</span>`)}

  <div class="pm-tabs seg dr-tabs" id="dr-tabs" role="tablist" aria-label="Vía de importación">
    <button class="on" role="tab" aria-selected="true" data-tab="sd" data-tip="La vía recomendada: los .SRT traen GPS, mapa y telemetría">${icon('db')} Tarjeta SD · con GPS</button>
    <button role="tab" aria-selected="false" data-tab="up" data-tip="Videos o fotos desde iPhone/iPad o arrastrando en PC — sin telemetría de vuelo">${icon('dl')} Subida directa</button>
    <span class="pm-ink"></span>
  </div>

  <section class="dr-mod" data-mod="sd">
    <div class="dr-stats" id="d-stats">${'<div class="sk" style="height:74px"></div>'.repeat(5)}</div>

    <div class="panel dr-panel">
      <div class="ph">${icon('db')} Tarjetas SD detectadas
        <span class="spacer" style="flex:1"></span>
        <button class="btn sm" id="sd-rescan" data-tip="Vuelve a buscar tarjetas montadas (carpeta DCIM)">${icon('loop')} Escanear</button>
      </div>
      <div class="pb" id="sd-list"><div class="sk" style="height:80px"></div></div>
    </div>

    <div class="dr-two">
      <div class="panel dr-panel">
        <div class="ph">${icon('route')} Cadena de importación</div>
        <div class="pb">
          <ol class="dr-chain">
            ${CHAIN.map(([ic, t, sub, tip], i) => `
            <li class="dr-step${i === CHAIN.length - 1 ? ' end' : ''}" data-tip="${esc(tip)}">
              <span class="dr-step-ic">${icon(ic)}</span>
              <span class="dr-step-t"><b>${t}</b><small>${sub}</small></span>
            </li>`).join('')}
          </ol>
          <p class="dr-note">Solo tras completar toda la cadena, y si lo pides, el archivo se borra de la SD. Un corte a mitad nunca pierde datos.</p>
        </div>
      </div>

      <div class="panel dr-panel">
        <div class="ph">${icon('check')} Flujo recomendado</div>
        <div class="pb">
          <ol class="dr-flow">${FLOW.map(x => `<li><span>${x}</span></li>`).join('')}</ol>
          <p class="dr-note">Los originales viven intocables en <span class="mono">raw/&lt;dron&gt;/</span>.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="dr-mod" data-mod="up" hidden>
    <div class="dr-up-wrap">
      <div class="pm-tabs seg dr-kind" id="up-kind" role="tablist" aria-label="Qué vas a subir">
        <button class="on" role="tab" aria-selected="true" data-kind="video" data-tip="Clips de video: proxy, análisis y galería">${icon('film')} Videos</button>
        <button role="tab" aria-selected="false" data-kind="foto" data-tip="Fotos fijas JPG o DNG: la entrada recomendada para malla 3D">${icon('iso')} Fotos · malla 3D</button>
      </div>

      <div class="dr-up-panes" id="up-panes">
        <div class="dr-up-pane" data-pane="video">
          <div class="dr-up-zone rise" id="drop" data-tip="También puedes soltar varios a la vez — van en cola">
            <span class="dr-up-ring"></span>
            ${icon('dl')}
            <p class="dr-up-t">Arrastra videos o toca para elegir</p>
            <p class="dr-up-s">En iPhone y iPad se abre tu app de <b>Fotos</b> directamente.</p>
            <div class="dr-up-devices">
              <span class="gchip" data-tip="El selector abre la fototeca — exporta del dron a Fotos y sube">${icon('iso')} iPhone · Fotos</span>
              <span class="gchip" data-tip="Igual que iPhone, con pantalla grande">${icon('grid')} iPad</span>
              <span class="gchip" data-tip="Arrastra archivos desde el Finder o Explorador">${icon('db')} PC · arrastra</span>
            </div>
            <input type="file" id="file" multiple accept="video/*,.mts,.mkv" hidden>
          </div>

          <ol class="dr-chain dr-chain-up">
            <li class="dr-step" data-tip="Cola secuencial con velocidad y ETA"><span class="dr-step-ic">${icon('dl')}</span><span class="dr-step-t"><b>Subes</b><small>cola con ETA</small></span></li>
            <li class="dr-step" data-tip="Streaming 1080p por hardware del M4"><span class="dr-step-ic">${icon('gauge')}</span><span class="dr-step-t"><b>Proxy 1080p</b><small>hardware M4</small></span></li>
            <li class="dr-step" data-tip="Resumen, tags y highlights automáticos"><span class="dr-step-ic">${icon('spark')}</span><span class="dr-step-t"><b>Análisis AI</b><small>resumen y tags</small></span></li>
            <li class="dr-step end" data-tip="Aparece en la galería y en el editor"><span class="dr-step-ic">${icon('check')}</span><span class="dr-step-t"><b>Listo</b><small>en Vuelos y Studio</small></span></li>
          </ol>
          <p class="dr-note">Sin telemetría: esta vía no trae GPS ni mapa. Si el video salió del dron con su .SRT,
            usa la <b>Tarjeta SD</b>: es la diferencia entre un clip y un vuelo completo.</p>

          <div id="queue" class="dr-up-queue"></div>
        </div>

        <div class="dr-up-pane" data-pane="foto" hidden>
          <div class="dr-up-zone rise" id="ph-drop" role="button" tabindex="0" aria-label="Elegir fotos o soltar una carpeta"
               data-tip="Suelta fotos sueltas o una carpeta entera (cada subcarpeta es una pasada)">
            <span class="dr-up-ring"></span>
            ${icon('iso')}
            <p class="dr-up-t">Arrastra fotos o una carpeta</p>
            <p class="dr-up-s">JPG, JPEG y DNG del dron. Hasta 200 MB por foto y 25 GB por set.</p>
            <div class="dr-up-devices">
              <button type="button" class="btn sm" id="ph-pick">${icon('plus')} Elegir fotos</button>
              <button type="button" class="btn sm" id="ph-pick-dir">${icon('folder')} Elegir carpeta</button>
            </div>
            <input type="file" id="ph-file" multiple accept=".jpg,.jpeg,.dng,image/jpeg" hidden>
            <input type="file" id="ph-dir" webkitdirectory multiple hidden>
          </div>

          <div class="panel dr-panel dr-ph" id="ph-stage" hidden>
            <div class="ph">${icon('layers')} Set de fotos
              <span class="spacer"></span>
              <button type="button" class="btn sm ghost" id="ph-clear">${icon('trash')} Vaciar</button>
            </div>
            <div class="pb">
              <div class="dr-ph-fields">
                <label class="dr-ph-f"><span class="dr-ph-lb">Set</span>
                  <input class="ctl" id="ph-set" maxlength="60" autocomplete="off" placeholder="Ej. Edificio Dialectica"></label>
                <label class="dr-ph-f"><span class="dr-ph-lb">Pasada</span>
                  <input class="ctl" id="ph-pass" list="ph-pass-list" maxlength="60" autocomplete="off" placeholder="nadir, anillo A, fachada…"></label>
                <datalist id="ph-pass-list"><option value="nadir"><option value="anillo A"><option value="anillo B"><option value="anillo C"><option value="fachada"></datalist>
              </div>
              <div class="dr-ph-sum" id="ph-sum" aria-live="polite"></div>
              <div class="dr-ph-prog" id="ph-prog" hidden>
                <div class="dr-up-meta mono" id="ph-meta" aria-live="polite"></div>
                <div class="dr-up-bar"><i id="ph-bar" style="--p:0"></i></div>
              </div>
              <div id="ph-msg"></div>
              <div class="dr-ph-acts">
                <button type="button" class="btn primary" id="ph-go">${icon('dl')} Subir fotos</button>
                <button type="button" class="btn" id="ph-cancel" hidden>Cancelar</button>
              </div>
              <p class="dr-note" id="ph-dest"></p>
            </div>
          </div>

          <ol class="dr-chain dr-chain-up">
            <li class="dr-step" data-tip="Una foto por petición, con progreso total y ETA"><span class="dr-step-ic">${icon('dl')}</span><span class="dr-step-t"><b>Subes</b><small>foto a foto</small></span></li>
            <li class="dr-step" data-tip="Se comprueba la firma real del archivo: JPEG o DNG"><span class="dr-step-ic">${icon('check')}</span><span class="dr-step-t"><b>Validación</b><small>JPEG · DNG</small></span></li>
            <li class="dr-step" data-tip="Mismo layout que la tarjeta SD: nombres intactos"><span class="dr-step-ic">${icon('db')}</span><span class="dr-step-t"><b>raw/set/pasada</b><small>originales</small></span></li>
            <li class="dr-step end" data-tip="Aparecen en Studio, pestaña Fotos"><span class="dr-step-ic">${icon('image')}</span><span class="dr-step-t"><b>Listo</b><small>en Studio · Fotos</small></span></li>
          </ol>
          <p class="dr-note">Las fotos conservan su EXIF (GPS, lente) y su nombre original: no las renombres, el protocolo de captura depende de ello.</p>
        </div>
      </div>
    </div>
  </section>

  <div class="panel dr-panel dr-jobs">
    <div class="ph">${icon('activity')} Importaciones recientes
      <span class="spacer" style="flex:1"></span>
      <a class="btn sm ghost" href="studio.html?tab=jobs">Ver todos los trabajos ${icon('chevR')}</a>
    </div>
    <div class="pb" id="jobs-sd"></div>
  </div>`;

// ---- tabs de método (SD / Directa) con tinta deslizante (--ink-x / --ink-w) ----
const drTabs = document.getElementById('dr-tabs');
const drInk = drTabs.querySelector('.pm-ink');
function drInkMove() {
  const on = drTabs.querySelector('button.on');
  drInk.style.setProperty('--ink-x', on.offsetLeft + 'px');
  drInk.style.setProperty('--ink-w', on.offsetWidth + 'px');
}
requestAnimationFrame(drInkMove);
window.addEventListener('resize', drInkMove);
function showVia(name) {
  drTabs.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === name);
    b.setAttribute('aria-selected', b.dataset.tab === name);
  });
  drInkMove();
  document.querySelectorAll('.dr-mod').forEach(m => {
    const show = m.dataset.mod === name;
    if (show && m.hidden) {
      m.hidden = false;
      m.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
                { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
    } else if (!show) m.hidden = true;
  });
}
drTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showVia(b.dataset.tab);
});
if (new URLSearchParams(location.search).get('via') === 'subir') showVia('up');

let sys = {}, volumes = [];
(async () => { try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); paintStats(); } catch {} })();

const gb = b => (b / 1e9).toFixed(1) + ' GB';
function lastFlight(v) {
  const dates = [...v.videos, ...v.photos]
    .map(x => ((x.name || '').match(/DJI_(\d{4})(\d{2})(\d{2})/) || []).slice(1))
    .filter(d => d.length).map(d => `${d[0]}-${d[1]}-${d[2]}`).sort();
  return dates.length ? fmt.date(dates[dates.length - 1]) : null;
}
function splitPct(v) {
  const vb = v.videos.reduce((a, x) => a + x.bytes, 0);
  const pb = v.photos.reduce((a, x) => a + x.bytes, 0);
  return vb + pb ? Math.round(vb / (vb + pb) * 100) : 50;
}
const backedOf = v => [...v.videos, ...v.photos].filter(x => x.in_vault);
const freeable = v => backedOf(v).reduce((a, x) => a + x.bytes, 0);

let statsSig = '';
function paintStats() {
  const st = sys.storage || {};
  const newCount = volumes.reduce((a, v) => a + v.videos.filter(x => !x.in_vault).length, 0);
  const lib = volumes.reduce((a, v) => a + freeable(v), 0);
  const vids = volumes.reduce((a, v) => a + v.videos.length, 0);
  const zero = (n, cls = '') => n > 0 ? cls : 'is-zero';   // un cero no pesa como un dato real
  const items = [
    ['db', 'Vault raw', fmt.gb(st.raw || 0), zero(st.raw || 0)],
    ['drone', 'Tarjetas', volumes.length, zero(volumes.length)],
    ['film', 'Videos en SD', vids, zero(vids)],
    ['spark', 'Nuevos', newCount, zero(newCount, 'is-accent')],
    ['dl', 'Liberable', gb(lib), zero(lib, lib > 5e9 ? 'is-warn' : '')],
  ];
  const sig = JSON.stringify(items);
  if (sig === statsSig) return;             // sin cambios: no reconstruir (evita replay de animación cada 10 s)
  const first = !statsSig;
  statsSig = sig;
  document.getElementById('d-stats').innerHTML = items.map(([ic, lb, v, cls]) => `
    <div class="stat${first ? ' rise' : ''}"><div class="lb">${icon(ic)} ${lb}</div><div class="v ${cls}">${v}</div></div>`).join('');
}

// gauge circular SVG — la aguja de combustible de la tarjeta
function gauge(pct) {
  const R = 17, C = 2 * Math.PI * R;
  const color = pct < 60 ? 'var(--ok)' : pct < 85 ? 'var(--warn)' : 'var(--err)';
  return `<svg class="sd-gauge" width="46" height="46" viewBox="0 0 46 46">
    <circle cx="23" cy="23" r="${R}" fill="none" stroke="var(--line)" stroke-width="5"/>
    <circle cx="23" cy="23" r="${R}" fill="none" stroke="${color}" stroke-width="5"
      stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"
      data-target="${(C * (1 - pct / 100)).toFixed(1)}"
      transform="rotate(-90 23 23)"/>
    <text x="23" y="27" text-anchor="middle" font-size="10" fill="currentColor"
      font-family="var(--mono)">${pct}%</text>
  </svg>`;
}

async function scan() {
  try {
    const r = await authFetch('/api/sd_scan');
    volumes = (await r.json()).volumes || [];
  } catch { volumes = []; }
  paintStats();
  document.getElementById('sd-rescan').hidden = !volumes.length;   // vacío: el CTA del estado vacío ya escanea
  const el = document.getElementById('sd-list');
  // DIFF antes de re-pintar: el poll de 10s reconstruía el DOM idéntico → replay de .rise y
  // del sweep del gauge en cada tick, y si tecleabas en el buscador, innerHTML destruía el
  // input ANTES de renderBrowser (foco/teclado perdidos cada 10s)
  const sig = JSON.stringify(volumes.map(v => [v.volume, v.free, v.videos.length, v.photos.length,
    v.videos.filter(x => !x.in_vault).length]));
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = volumes.length ? volumes.map(v => {
    const nuevos = v.videos.filter(x => !x.in_vault);
    const backed = backedOf(v);
    const pct = v.total > 0 ? Math.round((v.total - v.free) / v.total * 100) : 0;
    return `
    <div class="sd-card rise" data-vol="${esc(v.volume)}">
      <div class="sd-head">
        ${gauge(pct)}
        <div class="sd-title">
          <b>${esc(v.volume)}</b>
          <span class="mono">${gb(v.total - v.free)} de ${gb(v.total)} · ${v.videos.length} videos · ${v.photos.length} fotos</span>
        </div>
        <span class="spacer" style="flex:1"></span>
        <div class="sd-acts">
          ${nuevos.length
            ? `<button class="btn sm primary" data-import="${esc(v.volume)}">${icon('dl')} Importar ${nuevos.length}</button>`
            : `<span class="chip sm sd-ok">${icon('check')} Respaldada</span>`}
          <button class="btn sm" data-optimize="${esc(v.volume)}" ${backed.length ? '' : 'disabled'}>${icon('spark')} Optimizar</button>
        </div>
      </div>
      <div class="sd-meta">
        <span class="chip sm">${nuevos.length} nuevos</span>
        <span class="chip sm">${backed.length} respaldados</span>
        <span class="chip sm warn">${gb(freeable(v))} liberables</span>
        ${lastFlight(v) ? `<span class="chip sm">${icon('cal')} último vuelo ${lastFlight(v)}</span>` : ''}
        <span class="spacer" style="flex:1"></span>
        <button class="btn sm ghost" data-browse="${esc(v.volume)}" aria-expanded="false">Ver contenido ${icon('chevD')}</button>
      </div>
      <div class="sd-split" title="Reparto del espacio usado">
        <div class="ss-v" style="--p:${splitPct(v) / 100}"></div>
      </div>
      <div class="sd-split-lb">
        <span>${icon('film')} videos ${gb(v.videos.reduce((a, x) => a + x.bytes, 0))}</span>
        <span>${icon('iso')} fotos ${gb(v.photos.reduce((a, x) => a + x.bytes, 0))}</span>
      </div>
      <div class="sd-browser" data-browser="${esc(v.volume)}" hidden></div>
    </div>`;
  }).join('') : `
    ${emptyState({ icon: 'db', title: 'Sin tarjetas SD detectadas', help: 'Inserta la micro SD del dron. Se detecta sola cada 10 s (busca la carpeta DCIM).',
      action: `<button class="btn primary" data-rescan>${icon('loop')} Escanear ahora</button>`, cls: 'dr-empty' })}`;
  // anima los gauges tras el primer layout
  requestAnimationFrame(() => el.querySelectorAll('.sd-gauge [data-target]').forEach(c => {
    c.style.strokeDashoffset = c.dataset.target;
  }));
  // el re-scan cada 10s reconstruye las tarjetas → re-abre el explorador que estuviera abierto
  // (antes se colapsaba solo y perdía sus listeners de filtro/búsqueda) (#8/#9/#11)
  volumes.forEach(v => { if (typeof bstate !== 'undefined' && bstate[v.volume]?.open) renderBrowser(v); });
}

document.getElementById('sd-rescan').addEventListener('click', scan);
scan();
setInterval(scan, 10000);
// La etiqueta del servidor trae el volumen crudo («Untitled · 8 archivos»): si no tiene nombre útil,
// cae a carpeta destino + fecha del trabajo.
const jobsEl = document.getElementById('jobs-sd');
jobsEl.addEventListener('jobs:paint', ev => {
  const byId = Object.fromEntries((ev.detail?.jobs || []).map(j => [j.id, j]));
  jobsEl.querySelectorAll('[data-jid]').forEach(card => {
    const j = byId[card.dataset.jid];
    const t = card.querySelector('.jc-title');
    if (!j || !t || j.title || !/^(untitled|sin t[ií]tulo|no name)\b/i.test(j.label || '')) return;
    const n = (j.label.match(/·\s*(.+)$/) || [])[1];
    const dest = ((j.detail || '').match(/raw\/([^·]+?)\s*(?:·|$)/) || [])[1];
    const when = j.started ? fmt.date(new Date(j.started * 1000).toISOString().slice(0, 10)) : '';
    const name = [dest || 'Tarjeta SD', when, n].filter(Boolean).join(' · ');
    if (t.textContent !== name) { t.textContent = name; t.title = name; }
  });
});
pollJobs(jobsEl, 2500, null, {
  filter: j => ['ingest', 'upload'].includes(j.kind), limit: 3,
  emptyText: 'Aún no hay importaciones. Cuando importes una tarjeta o subas un video, aparecerá aquí.',
});

// ---------- explorador de contenido con filtros ----------
const bstate = {};   // vol -> { open, filtro, q }
function renderBrowser(v) {
  const st = bstate[v.volume] ??= { open: false, filtro: 'todo', q: '' };
  const box = document.querySelector(`[data-browser="${CSS.escape(v.volume)}"]`);
  if (!box) return;                       // la tarjeta pudo re-renderizarse (scan) → nodo detached
  if (!st.open) { box.hidden = true; return; }
  const all = [...v.videos.map(x => ({ ...x, tipo: 'video' })),
               ...v.photos.map(x => ({ ...x, tipo: 'foto' }))];
  const q = st.q.trim().toLowerCase();    // comparación case-insensitive SIN mutar lo tecleado
  const rows = all.filter(x => {
    if (st.filtro === 'nuevos' && x.in_vault) return false;
    if (st.filtro === 'respaldados' && !x.in_vault) return false;
    if (st.filtro === 'videos' && x.tipo !== 'video') return false;
    if (st.filtro === 'fotos' && x.tipo !== 'foto') return false;
    return !q || (x.name || '').toLowerCase().includes(q);
  }).sort((a, b) => b.bytes - a.bytes);
  // preserva foco/caret del buscador si el usuario está tecleando (el innerHTML lo recrearía)
  const prevBq = box.querySelector('[data-bq]');
  const hadFocus = prevBq && document.activeElement === prevBq;
  const caret = hadFocus ? prevBq.selectionStart : null;
  box.hidden = false;
  box.innerHTML = `
    <div class="tool-row sd-tools">
      ${['todo', 'nuevos', 'respaldados', 'videos', 'fotos'].map(f =>
        `<button class="chip ${st.filtro === f ? 'on' : ''}" data-bf="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
      <label class="search sd-q">${icon('search')}<input data-bq type="search" placeholder="Buscar archivo…" aria-label="Buscar archivos" autocomplete="off" value="${esc(st.q)}"></label>
    </div>
    <div class="sd-files">${rows.slice(0, 120).map(x => `
      <div class="sd-file">
        <span class="sf-ic">${icon(x.tipo === 'video' ? 'film' : 'iso')}</span>
        <span class="sf-name mono">${esc(x.name)}</span>
        ${x.srt ? '<span class="chip sm">GPS</span>' : ''}
        <span class="spacer" style="flex:1"></span>
        <span class="mono sf-size">${x.bytes > 1e9 ? gb(x.bytes) : (x.bytes / 1e6).toFixed(0) + ' MB'}</span>
        <span class="sf-st ${x.in_vault ? 'in' : 'new'}">${x.in_vault ? 'En vault' : 'Nuevo'}</span>
      </div>`).join('')}
      ${rows.length > 120 ? `<p class="dr-note">…y ${rows.length - 120} más (usa los filtros).</p>` : ''}
      ${!rows.length ? '<p class="dr-note">Nada con ese filtro.</p>' : ''}
    </div>`;
  // restaura foco/caret tras recrear el input (evita el salto al final)
  if (hadFocus) {
    const bq = box.querySelector('[data-bq]');
    if (bq) { bq.focus(); try { bq.setSelectionRange(caret, caret); } catch {} }
  }
  const fresh = () => volumes.find(x => x.volume === v.volume) || v;   // dato vigente tras un scan
  box.querySelectorAll('[data-bf]').forEach(b => b.addEventListener('click', () => {
    st.filtro = b.dataset.bf;
    renderBrowser(fresh());
  }));
  box.querySelector('[data-bq]').addEventListener('input', e => {
    st.q = e.target.value;                 // guarda lo tecleado tal cual (sin lowercase)
    clearTimeout(st._t);
    st._t = setTimeout(() => renderBrowser(fresh()), 180);   // usa el volumen fresco, no el capturado
  });
}

// ---------- acciones de tarjeta ----------
document.getElementById('sd-list').addEventListener('click', e => {
  if (e.target.closest('[data-rescan]')) return scan();
  const br = e.target.closest('[data-browse]');
  if (br) {
    const v = volumes.find(x => x.volume === br.dataset.browse);
    const st = bstate[v.volume] ??= { open: false, filtro: 'todo', q: '' };
    st.open = !st.open;
    br.innerHTML = `${st.open ? 'Ocultar contenido' : 'Ver contenido'} ${icon('chevD')}`;
    br.setAttribute('aria-expanded', st.open);
    br.classList.toggle('open', st.open);
    renderBrowser(v);
    document.querySelector(`[data-browser="${CSS.escape(v.volume)}"]`)?.animate(
      [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
    return;
  }
  const imp = e.target.closest('[data-import]');
  if (imp) return openImport(volumes.find(x => x.volume === imp.dataset.import));
  const opt = e.target.closest('[data-optimize]');
  if (opt) return openOptimize(volumes.find(x => x.volume === opt.dataset.optimize));
});

// ---------- modal: importar ----------
function openImport(v) {
  const nuevos = v.videos.filter(x => !x.in_vault);
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal" style="max-width:600px">
    <div class="modal-h"><b>${icon('dl')} Importar de «${esc(v.volume)}»</b>
      <button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
    <div class="modal-b">
      <p class="mlb">Videos nuevos (${nuevos.length})</p>
      <div class="mflights" style="max-height:230px">${nuevos.map(f => `
        <label class="mflight" style="cursor:pointer">
          <input type="checkbox" checked data-rel="${esc(f.rel)}" style="accent-color:var(--accent)">
          <div class="mf-t"><b>${esc(f.name)}</b>
          <span class="mono">${(f.bytes / 1e9).toFixed(2)} GB${f.srt ? ' · con GPS' : ' · sin telemetría'}</span></div>
        </label>`).join('')}</div>
      <p class="mlb">Dron / carpeta de destino</p>
      <input class="ctl" id="sd-drone" list="drones" value="${esc(v.volume)}" maxlength="40" style="width:100%">
      <datalist id="drones"><option value="DJI Flip"><option value="Neo 2"></datalist>
      <label style="display:flex;align-items:center;gap:9px;margin-top:14px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="sd-clean" checked style="accent-color:var(--accent)">
        Borrar de la SD tras <b>verificar</b> cada copia
      </label>
      <button class="btn primary lg dr-wide" id="sd-go">${icon('dl')} Importar al vault</button>
    </div></div>`;
  openModal(ov);
  ov.querySelector('#sd-go').addEventListener('click', async e2 => {
    const goBtn = e2.currentTarget;
    if (goBtn.disabled) return;
    goBtn.disabled = true;                       // doble click = 2 ingest sobre los mismos archivos
    setTimeout(() => { goBtn.disabled = false; }, 4000);
    const files = [...ov.querySelectorAll('input[data-rel]:checked')].map(c => c.dataset.rel);
    if (!files.length) return toast('Elige al menos un video.');
    const r = await api('/api/sd_import', {
      volume: v.volume, files,
      drone: ov.querySelector('#sd-drone').value.trim(),
      clean: ov.querySelector('#sd-clean').checked,
    });
    if (r.error) return toast(r.error);
    ov.remove();
  });
}

// ---------- modal: optimizar SD por niveles ----------
function openOptimize(v) {
  const vidsB = v.videos.filter(x => x.in_vault);
  const fotosB = v.photos.filter(x => x.in_vault);
  const nuevosV = v.videos.filter(x => !x.in_vault).length;
  const nuevasF = v.photos.filter(x => !x.in_vault).length;
  const sz = arr => arr.reduce((a, x) => a + x.bytes, 0);
  const LV = [
    { k: 'conservador', n: 'Conservador', ic: 'check',
      d: 'Borra solo los videos ya respaldados. Las fotos se quedan en la tarjeta.',
      files: vidsB,
      borra: [`${vidsB.length} videos (${gb(sz(vidsB))})`],
      queda: [`${fotosB.length} fotos respaldadas`, `${nuevosV + nuevasF} archivos sin respaldo`] },
    { k: 'completo', n: 'Completo', ic: 'spark',
      d: 'Borra videos y fotos respaldados — máximo espacio verificado.',
      files: [...vidsB, ...fotosB],
      borra: [`${vidsB.length} videos (${gb(sz(vidsB))})`, `${fotosB.length} fotos (${gb(sz(fotosB))})`],
      queda: [`${nuevosV + nuevasF} archivos sin respaldo`, 'estructura DCIM intacta'] },
    { k: 'fabrica', n: 'Fábrica', ic: 'drone',
      d: 'Todo lo respaldado fuera — la SD lista para el próximo vuelo, como nueva.',
      files: [...vidsB, ...fotosB],
      borra: [`${vidsB.length + fotosB.length} archivos respaldados (${gb(sz([...vidsB, ...fotosB]))})`],
      queda: [nuevosV + nuevasF ? `${nuevosV + nuevasF} sin respaldo (¡impórtalos primero!)` : 'nada — tarjeta limpia', 'carpetas DCIM del dron'] },
  ];
  const usado = v.total - v.free;
  const pctNow = v.total > 0 ? Math.round(usado / v.total * 100) : 0;
  const pctAfter = lv => v.total > 0 ? Math.max(0, Math.round((usado - sz(lv.files)) / v.total * 100)) : 0;

  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal" style="max-width:580px">
    <div class="modal-h"><b>${icon('spark')} Optimizar «${esc(v.volume)}»</b>
      <button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
    <div class="modal-b">
      <div class="opt-safe">${icon('check')} <span>Solo se borra lo <b>verificado en el vault</b>
        (mismo nombre y tamaño byte a byte). Lo nuevo o sin respaldo <b>jamás</b> se toca.</span></div>
      <p class="mlb">Nivel de limpieza</p>
      <div class="mpresets" style="grid-template-columns:1fr 1fr 1fr">${LV.map((l, i) => `
        <div class="mpreset${i === 1 ? ' on' : ''}" data-lv="${l.k}">
          <b>${icon(l.ic)} ${l.n}</b>
          <span class="mono">${l.files.length} arch · ${gb(sz(l.files))}</span>
        </div>`).join('')}</div>
      <div id="opt-detail"></div>
      <button class="btn primary lg dr-wide" id="opt-go">${icon('spark')} Optimizar tarjeta</button>
    </div></div>`;
  openModal(ov);

  function paintDetail() {
    const lv = LV.find(l => l.k === ov.querySelector('.mpreset.on')?.dataset.lv) || LV[1];
    ov.querySelector('#opt-detail').innerHTML = `
      <p class="footer-note" style="margin:12px 0 10px">${esc(lv.d)}</p>
      <div class="opt-cols">
        <div class="opt-col opt-del"><b>${icon('dl')} Se borra de la SD</b>
          ${lv.borra.map(x => `<span>· ${esc(x)}</span>`).join('')}</div>
        <div class="opt-col opt-keep"><b>${icon('check')} Se queda</b>
          ${lv.queda.map(x => `<span>· ${esc(x)}</span>`).join('')}</div>
      </div>
      <div class="opt-after">
        <span class="mono">${pctNow}% usado</span>
        <span class="opt-arrow">${icon('chevR')}</span>
        <span class="mono t-ok">${pctAfter(lv)}% tras optimizar</span>
        <span class="spacer" style="flex:1"></span>
        <span class="mono t-warn">libera ${gb(sz(lv.files))}</span>
      </div>`;
  }
  paintDetail();
  ov.querySelector('.mpresets').addEventListener('click', e => {
    const c = e.target.closest('.mpreset');
    if (!c) return;
    ov.querySelectorAll('.mpreset').forEach(x => x.classList.toggle('on', x === c));
    paintDetail();
  });
  ov.querySelector('#opt-go').addEventListener('click', async e2 => {
    const goBtn = e2.currentTarget;
    if (goBtn.disabled) return;
    goBtn.disabled = true;
    setTimeout(() => { goBtn.disabled = false; }, 4000);
    const lv = LV.find(l => l.k === ov.querySelector('.mpreset.on')?.dataset.lv) || LV[1];
    if (!lv.files.length) return toast('Nada respaldado que borrar todavía.');
    const r = await api('/api/sd_import', {
      volume: v.volume, files: lv.files.map(x => x.rel), clean_only: true,
    });
    if (r.error) return toast(r.error);
    ov.remove();
  });
}


// ================= subida directa (fusionado de Subir v2) =================
const drop = document.getElementById('drop');
const fileIn = document.getElementById('file');
const upQueue = document.getElementById('queue');
document.getElementById('up-session').innerHTML = '<i class="dr-dot"></i>Sesión activa';

drop.addEventListener('click', () => fileIn.click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async e => {
  e.preventDefault(); drop.classList.remove('over');
  const files = [...e.dataTransfer.files];   // ANTES del await: el drag data store se vacía al retornar
  routeDropped(files, e.dataTransfer);
});
fileIn.addEventListener('change', () => { routeDropped([...fileIn.files]); fileIn.value = ''; });
// fotos soltadas en la zona de video: en vez de rechazarlas, van al set de fotos
function routeDropped(files, dt) {
  const isPhoto = f => PH_EXT.test(f.name);
  const hasDir = dt && [...(dt.items || [])].some(i => i.webkitGetAsEntry?.()?.isDirectory);
  if (hasDir || (files.length && files.every(isPhoto))) { setUpKind('foto'); phStageEntries(dt ? phCollect(dt) : files.map(f => ({ file: f, rel: f.name }))); return; }
  files.forEach(upEnqueue);
}

const upQ = [];
let upActive = null;

function upEnqueue(file) {
  if (!/\.(mp4|mov|m4v|mkv|avi|mts|webm)$/i.test(file.name)) {
    alert(`"${file.name}" no es un formato de video soportado.`); return;
  }
  upQ.push({ file, status: 'pendiente', pct: 0, speed: 0, eta: 0, loaded: 0, xhr: null });
  upRender(); upPump();
}
function upPump() {
  if (upActive || !upQ.some(i => i.status === 'pendiente')) return;
  upActive = upQ.find(i => i.status === 'pendiente');
  upStart(upActive);
}
function upStart(item) {
  item.status = 'subiendo';
  const xhr = item.xhr = new XMLHttpRequest();
  xhr.open('POST', `/upload?name=${encodeURIComponent(item.file.name)}`);
  xhr.setRequestHeader('X-AeroBrain-CSRF', '1');
  let lastT = performance.now(), lastL = 0;
  xhr.upload.onprogress = e => {
    const now = performance.now(), dt = (now - lastT) / 1000;
    if (dt > 0.4) {
      const inst = (e.loaded - lastL) / dt;
      item.speed = item.speed ? item.speed * 0.6 + inst * 0.4 : inst;
      item.eta = item.speed > 0 ? (e.total - e.loaded) / item.speed : 0;
      lastT = now; lastL = e.loaded;
    }
    item.pct = e.total > 0 ? Math.round((e.loaded / e.total) * 100) : 100;   // zero-byte = completo, no NaN%
    item.loaded = e.loaded;
    upPaint(item);
  };
  const finish = st => { item.status = st; item.xhr = null; upActive = null; upRender(); upPump(); };
  xhr.onload = () => {
    if (xhr.status === 200) finish('procesando');
    else if (xhr.status === 401) { item.err = 'sesión expirada'; finish('error'); redirectToLogin(); }
    else {
      let msg = '';
      try { msg = JSON.parse(xhr.responseText || '{}').error || ''; } catch { /* cuerpo HTML (Cloudflare 413/502) */ }
      item.err = String(msg || `error ${xhr.status}`).slice(0, 200);
      finish('error');
    }
  };
  xhr.onerror = () => { item.err = 'error de red — reintenta'; finish('error'); };
  xhr.onabort = () => finish('cancelado');
  xhr.send(item.file);
  upRender();
}
const UP_STATE = {
  pendiente: { ic: 'clock', cls: '' }, subiendo: { ic: 'dl', cls: 'run' },
  procesando: { ic: 'gauge', cls: 'ok' }, cancelado: { ic: 'close', cls: 'off' },
  error: { ic: 'warn', cls: 'bad' },
};
function upRender() {
  upQueue.innerHTML = upQ.map((it, i) => `
    <div class="dr-up-card ${UP_STATE[it.status].cls}">
      <span class="dr-up-ic">${icon(UP_STATE[it.status].ic)}</span>
      <div class="dr-up-info">
        <div class="dr-up-name">${esc(it.file.name)}</div>
        <div class="dr-up-meta mono" data-meta="${i}">${upMeta(it)}</div>
        <div class="dr-up-bar"><i data-bar="${i}" style="--p:${it.pct / 100}"></i></div>
      </div>
      <div class="dr-up-acts">
        ${it.status === 'subiendo' ? `<button class="btn sm" data-cancel="${i}">Cancelar</button>` : ''}
        ${it.status === 'error' || it.status === 'cancelado' ? `<button class="btn sm" data-retry="${i}">${icon('loop')} Reintentar</button>` : ''}
      </div>
    </div>`).join('');
}
function upMeta(it) {
  const mb = v => (v / 1e6).toFixed(0);
  if (it.status === 'subiendo')
    return `${it.pct}% · ${mb(it.loaded)}/${mb(it.file.size)} MB · ${(it.speed / 1e6).toFixed(1)} MB/s · ~${fmt.dur(Math.min(5940, it.eta))} restantes`;
  if (it.status === 'procesando') return `${mb(it.file.size)} MB · proxy y análisis en curso`;
  if (it.status === 'error') return esc(it.err || 'error');
  return `${mb(it.file.size)} MB`;
}
function upPaint(it) {
  const i = upQ.indexOf(it);
  const m = upQueue.querySelector(`[data-meta="${i}"]`);
  const b = upQueue.querySelector(`[data-bar="${i}"]`);
  if (m) m.textContent = upMeta(it);
  if (b) b.style.setProperty('--p', it.pct / 100);
}
upQueue.addEventListener('click', e => {
  const c = e.target.closest('[data-cancel]');
  if (c) { upQ[+c.dataset.cancel]?.xhr?.abort(); return; }
  const r = e.target.closest('[data-retry]');
  if (r) { const it = upQ[+r.dataset.retry]; if (it) { it.status = 'pendiente'; it.pct = 0; it.err = null; upRender(); upPump(); } }
});
window.addEventListener('beforeunload', e => { if (upActive || phBusy) { e.preventDefault(); e.returnValue = ''; } });


// ================= subida directa de FOTOS (set para malla 3D) =================
// Una foto por petición a /api/photo_set_upload → raw/<set>/<pasada>/<nombre> (layout de la SD).
const PH_EXT = /\.(jpe?g|dng)$/i;
const PH_FILE_MAX = 200 * 1024 ** 2, PH_TOTAL_MAX = 25 * 1024 ** 3, PH_MAX_FILES = 2000;   // = servidor
const phEl = id => document.getElementById(id);
let phItems = [];          // {file, rel, pass, status: 'pend'|'sub'|'ok'|'dup'|'err', err}
let phBusy = false, phStop = false, phXhr = null, phFatal = '';

function setUpKind(kind) {
  document.querySelectorAll('#up-kind [data-kind]').forEach(b => {
    b.classList.toggle('on', b.dataset.kind === kind);
    b.setAttribute('aria-selected', b.dataset.kind === kind);
  });
  document.querySelectorAll('#up-panes [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== kind; });
  try { localStorage.setItem('ab_up_kind', kind); } catch { /* modo privado */ }
}
phEl('up-kind').addEventListener('click', e => {
  const b = e.target.closest('[data-kind]');
  if (b) setUpKind(b.dataset.kind);
});
try {
  if (localStorage.getItem('ab_up_kind') === 'foto' && new URLSearchParams(location.search).get('via') === 'subir') setUpKind('foto');
} catch { /* sin storage */ }

const phMB = v => v >= 1e9 ? (v / 1e9).toFixed(1) + ' GB' : (v / 1e6).toFixed(0) + ' MB';
const phDefaultSet = () => 'Fotos ' + new Date().toISOString().slice(0, 10);
if (!('webkitdirectory' in phEl('ph-dir'))) phEl('ph-pick-dir').hidden = true;   // iOS Safari: sin carpetas

// Entradas del drop: DEBE ejecutarse síncrono dentro del handler (el DataTransfer se vacía al await).
function phCollect(dt) {
  const entries = [...(dt.items || [])].map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return Promise.resolve([...dt.files].map(f => ({ file: f, rel: f.name })));
  const out = [];
  const walk = async (en, path) => {
    if (en.isFile) {
      const f = await new Promise((res, rej) => en.file(res, rej));
      out.push({ file: f, rel: path + f.name });
    } else if (en.isDirectory) {
      const rd = en.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => rd.readEntries(res, rej));
        for (const c of batch) await walk(c, path + en.name + '/');
      } while (batch.length);
    }
  };
  return (async () => { for (const en of entries) await walk(en, ''); return out; })();
}

async function phStageEntries(entries) {
  const list = await entries;
  let skipped = 0, tooBig = 0, over = 0;
  const seen = new Set(phItems.map(i => i.rel + ':' + i.file.size));
  let total = phItems.reduce((a, i) => a + i.file.size, 0);
  for (const { file, rel } of list) {
    if (file.name.startsWith('.')) continue;                      // .DS_Store y similares: ruido, no aviso
    if (!PH_EXT.test(file.name) || !file.size) { skipped++; continue; }
    if (file.size > PH_FILE_MAX) { tooBig++; continue; }
    if (seen.has(rel + ':' + file.size)) continue;
    if (phItems.length >= PH_MAX_FILES || total + file.size > PH_TOTAL_MAX) { over++; continue; }
    seen.add(rel + ':' + file.size);
    total += file.size;
    const parts = rel.split('/');
    phItems.push({ file, rel, pass: parts.length > 1 ? parts[parts.length - 2] : '', status: 'pend', err: '' });
  }
  const notes = [];
  if (skipped) notes.push(`${skipped} archivo${skipped === 1 ? '' : 's'} omitido${skipped === 1 ? '' : 's'} (solo JPG, JPEG y DNG)`);
  if (tooBig) notes.push(`${tooBig} pesa${tooBig === 1 ? '' : 'n'} más de 200 MB`);
  if (over) notes.push(`${over} no caben en el set (máx. 2000 fotos y 25 GB)`);
  if (notes.length) toast(notes.join(' · '));
  phFatal = '';
  phRender();
}

function phSetName() { return (phEl('ph-set').value || '').trim() || phDefaultSet(); }
function phPassOf(it) { return it.pass || (phEl('ph-pass').value || '').trim() || 'fotos'; }

function phRender() {
  const stage = phEl('ph-stage');
  stage.hidden = !phItems.length;
  if (!phItems.length) return;
  if (!phEl('ph-set').value) phEl('ph-set').placeholder = phDefaultSet();
  const pend = phItems.filter(i => i.status === 'pend' || i.status === 'err');
  const done = phItems.filter(i => i.status === 'ok' || i.status === 'dup');
  const failed = phItems.filter(i => i.status === 'err');
  const nJpg = phItems.filter(i => /\.jpe?g$/i.test(i.file.name)).length;
  const nDng = phItems.length - nJpg;
  const passes = new Set(phItems.map(phPassOf));
  const bytes = phItems.reduce((a, i) => a + i.file.size, 0);
  phEl('ph-sum').innerHTML = [
    `<span class="chip on">${phItems.length} foto${phItems.length === 1 ? '' : 's'}</span>`,
    `<span class="chip mono">${phMB(bytes)}</span>`,
    nJpg ? `<span class="chip mono">${nJpg} JPG</span>` : '',
    nDng ? `<span class="chip mono">${nDng} DNG</span>` : '',
    passes.size > 1 ? `<span class="chip">${passes.size} pasadas</span>` : '',
    done.length ? `<span class="chip ok">${done.length} subida${done.length === 1 ? '' : 's'}</span>` : '',
    failed.length ? `<span class="chip err">${failed.length} con error</span>` : '',
  ].join('');
  const go = phEl('ph-go');
  go.disabled = phBusy || !pend.length;
  go.innerHTML = `${icon(failed.length && !phBusy ? 'loop' : 'dl')} ${failed.length && !phBusy && pend.length === failed.length
    ? `Reintentar ${failed.length}` : pend.length ? `Subir ${pend.length} foto${pend.length === 1 ? '' : 's'}` : 'Todo subido'}`;
  phEl('ph-cancel').hidden = !phBusy;
  phEl('ph-clear').disabled = phBusy;
  phEl('ph-set').disabled = phEl('ph-pass').disabled = phBusy;
  const many = passes.size > 1;
  phEl('ph-dest').innerHTML = `Destino: <span class="mono">raw/${esc(phSetName())}/${many ? '&lt;pasada&gt;' : esc([...passes][0])}/</span> · nombres originales, sin recomprimir.`;
  // mensaje de estado: error fatal, errores por foto, o éxito
  const msg = phEl('ph-msg');
  if (phFatal) {
    msg.innerHTML = `<div class="dr-ph-alert bad" role="alert">${icon('warn')}<span>${esc(phFatal)}</span></div>`;
  } else if (failed.length && !phBusy) {
    const first = failed.slice(0, 4).map(i => `<li><span class="mono">${esc(i.file.name)}</span> · ${esc(i.err || 'error')}</li>`).join('');
    msg.innerHTML = `<div class="dr-ph-alert bad" role="alert">${icon('warn')}<div><b>${failed.length} foto${failed.length === 1 ? '' : 's'} no se subió${failed.length === 1 ? '' : 'eron'}.</b>
      <ul>${first}${failed.length > 4 ? `<li>y ${failed.length - 4} más…</li>` : ''}</ul></div></div>`;
  } else if (done.length && !pend.length && !phBusy) {
    msg.innerHTML = `<div class="dr-ph-alert ok" role="status">${icon('check')}<span><b>${done.length} foto${done.length === 1 ? '' : 's'} en el vault.</b> Ya aparecen en Studio.</span>
      <a class="btn sm" href="studio.html?tab=fotos">Ver en Studio ${icon('chevR')}</a></div>`;
  } else msg.innerHTML = '';
}

function phSend(it, set) {
  return new Promise(resolve => {
    const xhr = phXhr = new XMLHttpRequest();
    const q = new URLSearchParams({ name: it.file.name, set, pass: phPassOf(it) });
    xhr.open('POST', `/api/photo_set_upload?${q}`);
    xhr.setRequestHeader('X-AeroBrain-CSRF', '1');
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* HTML de Cloudflare */ }
      if (xhr.status === 200) return resolve({ ok: true, dup: !!body.duplicate });
      if (xhr.status === 401) { redirectToLogin(); return resolve({ ok: false, fatal: 'sesión expirada' }); }
      const err = String(body.error || `error ${xhr.status}`).slice(0, 200);
      resolve({ ok: false, err, fatal: (xhr.status === 507 || (xhr.status === 413 && /set/.test(err))) ? err : '' });
    };
    xhr.onerror = () => resolve({ ok: false, err: 'error de red — reintenta' });
    xhr.onabort = () => resolve({ ok: false, aborted: true });
    xhr.send(it.file);
  });
}

async function phRun() {
  if (phBusy) return;
  const todo = phItems.filter(i => i.status === 'pend' || i.status === 'err');
  if (!todo.length) return;
  phBusy = true; phStop = false; phFatal = '';
  const set = phSetName();
  todo.forEach(i => { i.status = 'pend'; i.err = ''; });
  const total = todo.reduce((a, i) => a + i.file.size, 0);
  let doneBytes = 0, speed = 0, lastT = performance.now(), lastB = 0, cur = 0, nDone = 0;
  const prog = phEl('ph-prog'), meta = phEl('ph-meta'), bar = phEl('ph-bar');
  prog.hidden = false;
  const paint = () => {
    const loaded = doneBytes + cur;
    bar.style.setProperty('--p', total ? Math.min(1, loaded / total) : 1);
    const eta = speed > 0 ? (total - loaded) / speed : 0;
    meta.textContent = `${nDone}/${todo.length} fotos · ${phMB(loaded)} de ${phMB(total)}`
      + (speed > 0 ? ` · ${(speed / 1e6).toFixed(1)} MB/s · ~${fmt.dur(Math.min(5940, eta))} restantes` : '');
  };
  phRender(); paint();
  for (const it of todo) {
    if (phStop) break;
    it.status = 'sub'; cur = 0;
    const p = phSend(it, set);
    // el progreso llega por el XHR activo; se engancha aquí para no ensuciar la promesa
    phXhr.upload.onprogress = e => {
      cur = e.loaded;
      const now = performance.now(), dt = (now - lastT) / 1000;
      if (dt > 0.4) {
        const inst = (doneBytes + cur - lastB) / dt;
        speed = speed ? speed * 0.6 + inst * 0.4 : inst;
        lastT = now; lastB = doneBytes + cur;
      }
      paint();
    };
    const r = await p;
    phXhr = null;
    if (r.aborted) { it.status = 'pend'; break; }
    if (r.ok) { it.status = r.dup ? 'dup' : 'ok'; doneBytes += it.file.size; nDone++; cur = 0; }
    else { it.status = 'err'; it.err = r.err || r.fatal; cur = 0; }
    paint();
    if (r.fatal) { phFatal = r.fatal; break; }
  }
  phBusy = false;
  prog.hidden = true;
  const ok = phItems.filter(i => i.status === 'ok' || i.status === 'dup').length;
  if (!phStop && !phFatal && !phItems.some(i => i.status === 'err')) toast(`${ok} foto${ok === 1 ? '' : 's'} subida${ok === 1 ? '' : 's'} a "${set}"`);
  phRender();
}

phEl('ph-go').addEventListener('click', phRun);
phEl('ph-cancel').addEventListener('click', () => { phStop = true; phXhr?.abort(); });
phEl('ph-clear').addEventListener('click', () => { phItems = []; phFatal = ''; phEl('ph-msg').innerHTML = ''; phRender(); });
phEl('ph-set').addEventListener('input', phRender);
phEl('ph-pass').addEventListener('input', phRender);
const phDrop = phEl('ph-drop');
const phPickFiles = () => phEl('ph-file').click();
phDrop.addEventListener('click', e => { if (!e.target.closest('button')) phPickFiles(); });
phDrop.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === phDrop) { e.preventDefault(); phPickFiles(); } });
phEl('ph-pick').addEventListener('click', phPickFiles);
phEl('ph-pick-dir').addEventListener('click', () => phEl('ph-dir').click());
phDrop.addEventListener('dragover', e => { e.preventDefault(); phDrop.classList.add('over'); });
phDrop.addEventListener('dragleave', () => phDrop.classList.remove('over'));
phDrop.addEventListener('drop', e => {
  e.preventDefault(); phDrop.classList.remove('over');
  phStageEntries(phCollect(e.dataTransfer));           // síncrono hasta las entradas; el resto async
});
phEl('ph-file').addEventListener('change', e => {
  phStageEntries([...e.target.files].map(f => ({ file: f, rel: f.name }))); e.target.value = '';
});
phEl('ph-dir').addEventListener('change', e => {
  phStageEntries([...e.target.files].map(f => ({ file: f, rel: f.webkitRelativePath || f.name }))); e.target.value = '';
});
