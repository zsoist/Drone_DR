// Dron — centro de mando de tarjetas SD: importa al vault verificando cada byte,
// optimiza la tarjeta por niveles, y explora su contenido con filtros.
const main = renderShell('drone.html');
main.innerHTML = `
  <div class="st-hero rise">
    <h1>Dron</h1>
    <p style="color:var(--text-2);font-size:14px;margin:0 0 12px">
      Todo el material entra por aquí — elige tu vía.</p>
    <span class="gchip" id="up-session" data-tip="La subida directa requiere sesión de operador">${icon('activity')} comprobando sesión…</span>
  </div>

  <div class="pm-tabs rise" id="dr-tabs" style="margin-bottom:16px;max-width:640px">
    <button class="on" data-tab="sd" data-tip="La vía recomendada: los .SRT traen GPS, mapa y telemetría">${icon('db')} Tarjeta SD · con GPS</button>
    <button data-tab="up" data-tip="Desde Fotos del iPhone/iPad o arrastrando en PC — sin telemetría">${icon('dl')} Subida directa</button>
    <span class="pm-ink"></span>
  </div>

  <section class="dr-mod" data-mod="sd">
    <div class="statgrid" id="d-stats">${'<div class="sk" style="height:74px"></div>'.repeat(5)}</div>

    <div class="panel rise">
      <div class="ph">${icon('db')} Tarjetas SD detectadas
        <span class="spacer" style="flex:1"></span>
        <button class="btn" id="sd-rescan" style="padding:4px 12px;font-size:11.5px" data-tip="Vuelve a buscar tarjetas montadas (carpeta DCIM)">Escanear</button>
      </div>
      <div class="pb" id="sd-list"><div class="sk" style="height:80px"></div></div>
    </div>

    <div class="panel rise" style="margin-top:16px">
      <div class="ph">${icon('route')} La cadena de importación</div>
      <div class="pb">
        <div class="pipe-strip">
          <span class="pipe-step" data-tip="Lee la carpeta DCIM de la tarjeta">${icon('db')}<b>SD</b><small>lectura</small></span>
          <span class="pipe-arrow"></span>
          <span class="pipe-step" data-tip="Copia cada archivo al SSD del Mac">${icon('dl')}<b>Copia</b><small>al SSD</small></span>
          <span class="pipe-arrow"></span>
          <span class="pipe-step" data-tip="Compara tamaño byte a byte antes de dar por buena la copia">${icon('check')}<b>Verificación</b><small>byte a byte</small></span>
          <span class="pipe-arrow"></span>
          <span class="pipe-step" data-tip="Genera streaming 1080p y 720p por hardware">${icon('film')}<b>Proxies</b><small>1080p · 720p</small></span>
          <span class="pipe-arrow"></span>
          <span class="pipe-step" data-tip="Extrae la telemetría del .SRT: ruta, altura, velocidad">${icon('route')}<b>GPS</b><small>track + thumbs</small></span>
          <span class="pipe-arrow"></span>
          <span class="pipe-step pipe-end" data-tip="El original queda intocable en raw/">${icon('drone')}<b>Vault</b><small>intocable</small></span>
        </div>
        <p class="footer-note" style="margin:0">Solo tras completar TODA la cadena —y si lo
        pediste— el archivo se borra de la SD. Un corte a mitad jamás pierde datos.</p>
      </div>
    </div>

    <div class="panel rise" style="margin-top:16px">
      <div class="ph">${icon('check')} Flujo recomendado</div>
      <div class="pb">
        <p class="footer-note" style="margin:0">1 · Aterriza → 2 · SD al Mac → 3 · «Importar
        nuevos…» → 4 · «Optimizar SD» nivel Fábrica → 5 · La tarjeta vuelve al dron vacía y lista.
        Los originales viven intocables en <span class="mono">raw/&lt;dron&gt;/</span>.</p>
      </div>
    </div>
  </section>

  <section class="dr-mod" data-mod="up" style="display:none">
    <div class="up-wrap">
      <div class="up-zone rise" id="drop" data-tip="También puedes soltar varios a la vez — van en cola">
        <span class="up-ring"></span>
        ${icon('dl')}
        <p class="up-t">Arrastra videos o toca para elegir</p>
        <p class="up-s">En iPhone y iPad se abre tu app de <b>Fotos</b> directamente.</p>
        <div class="up-devices">
          <span class="gchip" data-tip="El selector abre la fototeca — exporta del dron a Fotos y sube">${icon('iso')} iPhone · Fotos</span>
          <span class="gchip" data-tip="Igual que iPhone, con pantalla grande">${icon('grid')} iPad</span>
          <span class="gchip" data-tip="Arrastra archivos desde el Finder o Explorador">${icon('db')} PC · arrastra</span>
        </div>
        <input type="file" id="file" multiple accept="video/*,.mts,.mkv" style="display:none">
      </div>

      <div class="up-steps rise">
        <span data-tip="Cola secuencial con velocidad y ETA">${icon('dl')} Subes</span><i>${icon('chevR')}</i>
        <span data-tip="Streaming 1080p por hardware del M4">${icon('gauge')} Proxy 1080p</span><i>${icon('chevR')}</i>
        <span data-tip="Resumen, tags y highlights automáticos">${icon('spark')} Análisis AI</span><i>${icon('chevR')}</i>
        <span data-tip="Aparece en la galería y en el editor">${icon('check')} En Vuelos y Studio</span>
      </div>
      <p class="footer-note" style="margin:2px 4px 0">
        Sin telemetría: esta vía no trae GPS ni mapa. Si el video salió del dron con su .SRT,
        usa la <b>Tarjeta SD</b> — es la diferencia entre un clip y un vuelo completo.</p>

      <div id="queue" class="up-queue"></div>
    </div>
  </section>

  <div class="panel rise" style="margin-top:18px">
    <div class="ph">${icon('activity')} Trabajos del servidor</div>
    <div class="pb" id="jobs-sd"></div>
  </div>`;

// ---- tabs de método (SD / Directa) con tinta deslizante ----
const drTabs = document.getElementById('dr-tabs');
const drInk = drTabs.querySelector('.pm-ink');
function drInkMove() {
  const on = drTabs.querySelector('button.on');
  drInk.style.left = on.offsetLeft + 'px';
  drInk.style.width = on.offsetWidth + 'px';
}
setTimeout(drInkMove, 30);
window.addEventListener('resize', () => setTimeout(drInkMove, 30));
function showVia(name) {
  drTabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  drInkMove();
  document.querySelectorAll('.dr-mod').forEach(m => {
    const show = m.dataset.mod === name;
    if (show && m.style.display === 'none') {
      m.style.display = '';
      m.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'translateX(0)' }],
                { duration: 220, easing: 'ease-out' });
    } else if (!show) m.style.display = 'none';
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

function paintStats() {
  const st = sys.storage || {};
  const newCount = volumes.reduce((a, v) => a + v.videos.filter(x => !x.in_vault).length, 0);
  const lib = volumes.reduce((a, v) => a + freeable(v), 0);
  document.getElementById('d-stats').innerHTML = `
    <div class="stat rise"><div class="lb">${icon('db')} Vault raw</div><div class="v">${fmt.gb(st.raw || 0)}</div></div>
    <div class="stat rise"><div class="lb">${icon('drone')} Tarjetas</div><div class="v">${volumes.length}</div></div>
    <div class="stat rise"><div class="lb">${icon('film')} Videos en SD</div><div class="v">${volumes.reduce((a, v) => a + v.videos.length, 0)}</div></div>
    <div class="stat rise"><div class="lb">${icon('spark')} Nuevos</div><div class="v" style="color:${newCount ? 'var(--accent)' : 'inherit'}">${newCount}</div></div>
    <div class="stat rise"><div class="lb">${icon('dl')} Liberable</div><div class="v" style="color:${lib > 5e9 ? 'var(--amber)' : 'inherit'}">${gb(lib)}</div></div>`;
}

// gauge circular SVG — la aguja de combustible de la tarjeta
function gauge(pct) {
  const R = 17, C = 2 * Math.PI * R;
  const color = pct < 60 ? 'var(--mint)' : pct < 85 ? 'var(--amber)' : 'var(--red)';
  return `<svg class="sd-gauge" width="46" height="46" viewBox="0 0 46 46">
    <circle cx="23" cy="23" r="${R}" fill="none" stroke="var(--line)" stroke-width="5"/>
    <circle cx="23" cy="23" r="${R}" fill="none" stroke="${color}" stroke-width="5"
      stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"
      data-target="${(C * (1 - pct / 100)).toFixed(1)}"
      transform="rotate(-90 23 23)"/>
    <text x="23" y="27" text-anchor="middle" font-size="10.5" fill="currentColor"
      font-family="var(--mono)">${pct}%</text>
  </svg>`;
}

async function scan() {
  try {
    const r = await authFetch('/api/sd_scan');
    volumes = (await r.json()).volumes || [];
  } catch { volumes = []; }
  paintStats();
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
        ${nuevos.length
          ? `<button class="btn primary" data-import="${esc(v.volume)}" style="padding:5px 14px;font-size:12px">${icon('dl')} Importar ${nuevos.length}</button>`
          : `<span class="chip sd-ok">✓ respaldada</span>`}
        <button class="btn" data-optimize="${esc(v.volume)}" style="padding:5px 12px;font-size:12px" ${backed.length ? '' : 'disabled'}>${icon('spark')} Optimizar…</button>
      </div>
      <div class="sd-meta">
        <span class="chip">${nuevos.length} nuevos</span>
        <span class="chip">${backed.length} respaldados</span>
        <span class="chip" style="color:var(--amber)">${gb(freeable(v))} liberables</span>
        ${lastFlight(v) ? `<span class="chip">${icon('cal')} último vuelo ${lastFlight(v)}</span>` : ''}
        <span class="spacer" style="flex:1"></span>
        <button class="chip" data-browse="${esc(v.volume)}">Ver contenido ▾</button>
      </div>
      <div class="sd-split" title="Reparto del espacio usado">
        <div class="ss-v" style="width:${splitPct(v)}%"></div>
      </div>
      <div class="sd-split-lb">
        <span>${icon('film')} videos ${gb(v.videos.reduce((a, x) => a + x.bytes, 0))}</span>
        <span>${icon('iso')} fotos ${gb(v.photos.reduce((a, x) => a + x.bytes, 0))}</span>
      </div>
      <div class="sd-browser" data-browser="${esc(v.volume)}" style="display:none"></div>
    </div>`;
  }).join('') : `
    <div class="empty">${icon('db')}<p>Sin tarjetas SD detectadas.<br>
    <span style="font-size:12px;color:var(--text-3)">Inserta la micro SD del dron — se detecta
    sola cada 10 s (busca la carpeta DCIM).</span></p></div>`;
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
pollJobs(document.getElementById('jobs-sd'));

// ---------- explorador de contenido con filtros ----------
const bstate = {};   // vol -> { open, filtro, q }
function renderBrowser(v) {
  const st = bstate[v.volume] ??= { open: false, filtro: 'todo', q: '' };
  const box = document.querySelector(`[data-browser="${CSS.escape(v.volume)}"]`);
  if (!box) return;                       // la tarjeta pudo re-renderizarse (scan) → nodo detached
  if (!st.open) { box.style.display = 'none'; return; }
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
  box.style.display = '';
  box.innerHTML = `
    <div class="tool-row" style="padding:10px 0 6px">
      ${['todo', 'nuevos', 'respaldados', 'videos', 'fotos'].map(f =>
        `<button class="chip ${st.filtro === f ? 'on' : ''}" data-bf="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
      <input class="ctl" data-bq placeholder="Buscar…" value="${esc(st.q)}" style="margin-left:auto;width:150px;font-size:11.5px;padding:4px 9px">
    </div>
    <div class="sd-files">${rows.slice(0, 120).map(x => `
      <div class="sd-file">
        <span class="sf-ic">${icon(x.tipo === 'video' ? 'film' : 'iso')}</span>
        <span class="sf-name mono">${esc(x.name)}</span>
        ${x.srt ? '<span class="chip" style="padding:0 7px;font-size:9px">GPS</span>' : ''}
        <span class="spacer" style="flex:1"></span>
        <span class="mono sf-size">${x.bytes > 1e9 ? gb(x.bytes) : (x.bytes / 1e6).toFixed(0) + ' MB'}</span>
        <span class="sf-st" style="color:${x.in_vault ? 'var(--mint)' : 'var(--accent)'}">${x.in_vault ? '✓ vault' : 'nuevo'}</span>
      </div>`).join('')}
      ${rows.length > 120 ? `<p class="footer-note" style="padding:8px 0">…y ${rows.length - 120} más (usa los filtros).</p>` : ''}
      ${!rows.length ? '<p class="footer-note" style="padding:8px 0">Nada con ese filtro.</p>' : ''}
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
  const br = e.target.closest('[data-browse]');
  if (br) {
    const v = volumes.find(x => x.volume === br.dataset.browse);
    const st = bstate[v.volume] ??= { open: false, filtro: 'todo', q: '' };
    st.open = !st.open;
    br.textContent = st.open ? 'Ocultar contenido ▴' : 'Ver contenido ▾';
    const card = br.closest('.sd-card');
    const h0 = card.offsetHeight;
    renderBrowser(v);
    const h1 = card.offsetHeight;
    card.style.overflow = 'hidden';
    card.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }],
                 { duration: 260, easing: 'cubic-bezier(.25,.1,.25,1)' })
        .finished.then(() => { card.style.overflow = ''; });
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
      <button class="modal-x" aria-label="Cerrar">✕</button></div>
    <div class="modal-b">
      <p class="mlb">Videos nuevos (${nuevos.length})</p>
      <div class="mflights" style="max-height:230px">${nuevos.map(f => `
        <label class="mflight" style="cursor:pointer">
          <input type="checkbox" checked data-rel="${esc(f.rel)}" style="accent-color:var(--accent)">
          <div class="mf-t"><b>${esc(f.name)}</b>
          <span class="mono">${(f.bytes / 1e9).toFixed(2)} GB${f.srt ? ' · GPS ✓' : ' · sin telemetría'}</span></div>
        </label>`).join('')}</div>
      <p class="mlb">Dron / carpeta de destino</p>
      <input class="ctl" id="sd-drone" list="drones" value="${esc(v.volume)}" maxlength="40" style="width:100%">
      <datalist id="drones"><option value="DJI Flip"><option value="Neo 2"></datalist>
      <label style="display:flex;align-items:center;gap:9px;margin-top:14px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="sd-clean" checked style="accent-color:var(--accent)">
        Borrar de la SD tras <b>verificar</b> cada copia
      </label>
      <button class="btn primary" id="sd-go" style="width:100%;justify-content:center;margin-top:16px;padding:10px 0">${icon('dl')} Importar al vault</button>
    </div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.modal-x')) ov.remove(); });
  ov.querySelector('#sd-go').addEventListener('click', async e2 => {
    const goBtn = e2.currentTarget;
    if (goBtn.disabled) return;
    goBtn.disabled = true;                       // doble click = 2 ingest sobre los mismos archivos
    setTimeout(() => { goBtn.disabled = false; }, 4000);
    const files = [...ov.querySelectorAll('input[data-rel]:checked')].map(c => c.dataset.rel);
    if (!files.length) return alert('Elige al menos un video.');
    const r = await api('/api/sd_import', {
      volume: v.volume, files,
      drone: ov.querySelector('#sd-drone').value.trim(),
      clean: ov.querySelector('#sd-clean').checked,
    });
    if (r.error) return alert(r.error);
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
      <button class="modal-x" aria-label="Cerrar">✕</button></div>
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
      <button class="btn primary" id="opt-go" style="width:100%;justify-content:center;margin-top:14px;padding:10px 0">${icon('spark')} Optimizar tarjeta</button>
    </div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.modal-x')) ov.remove(); });

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
        <span class="opt-arrow">→</span>
        <span class="mono" style="color:var(--mint)">${pctAfter(lv)}% tras optimizar</span>
        <span class="spacer" style="flex:1"></span>
        <span class="mono" style="color:var(--amber)">libera ${gb(sz(lv.files))}</span>
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
    if (!lv.files.length) return alert('Nada respaldado que borrar todavía.');
    const r = await api('/api/sd_import', {
      volume: v.volume, files: lv.files.map(x => x.rel), clean_only: true,
    });
    if (r.error) return alert(r.error);
    ov.remove();
  });
}


// ================= subida directa (fusionado de Subir v2) =================
const drop = document.getElementById('drop');
const fileIn = document.getElementById('file');
const upQueue = document.getElementById('queue');
document.getElementById('up-session').innerHTML =
  `${icon('check')} sesión privada activa — listo para importar y subir`;
document.getElementById('up-session').classList.add('mint');

drop.addEventListener('click', () => fileIn.click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async e => {
  e.preventDefault(); drop.classList.remove('over');
  const files = [...e.dataTransfer.files];   // ANTES del await: el drag data store se vacía al retornar
  files.forEach(upEnqueue);
});
fileIn.addEventListener('change', () => { [...fileIn.files].forEach(upEnqueue); fileIn.value = ''; });

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
    else { item.err = (JSON.parse(xhr.responseText || '{}').error) || `error ${xhr.status}`; finish('error'); }
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
    <div class="up-card ${UP_STATE[it.status].cls}">
      <span class="up-ic">${icon(UP_STATE[it.status].ic)}</span>
      <div class="up-info">
        <div class="up-name">${esc(it.file.name)}</div>
        <div class="up-meta mono" data-meta="${i}">${upMeta(it)}</div>
        <div class="up-bar"><i data-bar="${i}" style="width:${it.pct}%"></i></div>
      </div>
      <div class="up-acts">
        ${it.status === 'subiendo' ? `<button class="btn" data-cancel="${i}">Cancelar</button>` : ''}
        ${it.status === 'error' || it.status === 'cancelado' ? `<button class="btn" data-retry="${i}">${icon('loop')} Reintentar</button>` : ''}
      </div>
    </div>`).join('');
}
function upMeta(it) {
  const mb = v => (v / 1e6).toFixed(0);
  if (it.status === 'subiendo')
    return `${it.pct}% · ${mb(it.loaded)}/${mb(it.file.size)} MB · ${(it.speed / 1e6).toFixed(1)} MB/s · ~${fmt.dur(Math.min(5940, it.eta))} restantes`;
  if (it.status === 'procesando') return `${mb(it.file.size)} MB · proxy + AI en curso, mira Trabajos abajo`;
  if (it.status === 'error') return it.err || 'error';
  return `${mb(it.file.size)} MB`;
}
function upPaint(it) {
  const i = upQ.indexOf(it);
  const m = upQueue.querySelector(`[data-meta="${i}"]`);
  const b = upQueue.querySelector(`[data-bar="${i}"]`);
  if (m) m.textContent = upMeta(it);
  if (b) b.style.width = `${it.pct}%`;
}
upQueue.addEventListener('click', e => {
  const c = e.target.closest('[data-cancel]');
  if (c) { upQ[+c.dataset.cancel]?.xhr?.abort(); return; }
  const r = e.target.closest('[data-retry]');
  if (r) { const it = upQ[+r.dataset.retry]; if (it) { it.status = 'pendiente'; it.pct = 0; it.err = null; upRender(); upPump(); } }
});
window.addEventListener('beforeunload', e => { if (upActive) { e.preventDefault(); e.returnValue = ''; } });
