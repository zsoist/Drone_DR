// Dron — centro de mando de tarjetas SD: importa al vault verificando cada byte,
// optimiza la tarjeta por niveles, y explora su contenido con filtros.
const main = renderShell('drone.html');
main.innerHTML = `
  <div class="page-head"><h1>Dron</h1><span class="count">tarjetas SD · importación · optimización</span></div>
  <div class="statgrid" id="d-stats">${'<div class="sk" style="height:74px"></div>'.repeat(5)}</div>

  <div class="panel rise">
    <div class="ph">${icon('db')} Tarjetas SD detectadas
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="sd-rescan" style="padding:4px 12px;font-size:11.5px">Escanear</button>
    </div>
    <div class="pb" id="sd-list"><div class="sk" style="height:80px"></div></div>
  </div>

  <div class="panel rise" style="margin-top:16px">
    <div class="ph">${icon('activity')} Cola de importación</div>
    <div class="pb">
      <div class="pipe-strip">
        <span class="pipe-step">${icon('db')}<b>SD</b><small>lectura</small></span>
        <span class="pipe-arrow"></span>
        <span class="pipe-step">${icon('dl')}<b>Copia</b><small>al SSD</small></span>
        <span class="pipe-arrow"></span>
        <span class="pipe-step">${icon('check')}<b>Verificación</b><small>byte a byte</small></span>
        <span class="pipe-arrow"></span>
        <span class="pipe-step">${icon('film')}<b>Proxies</b><small>1080p · 720p</small></span>
        <span class="pipe-arrow"></span>
        <span class="pipe-step">${icon('route')}<b>GPS</b><small>track + thumbs</small></span>
        <span class="pipe-arrow"></span>
        <span class="pipe-step pipe-end">${icon('drone')}<b>Vault</b><small>intocable</small></span>
      </div>
      <p class="footer-note" style="margin:0 0 10px">Solo tras completar TODA la cadena —y si lo
      pediste— el archivo se borra de la SD. Un corte a mitad jamás pierde datos.</p>
      <div id="jobs-sd"></div>
    </div>
  </div>

  <div class="panel rise" style="margin-top:16px">
    <div class="ph">${icon('check')} Flujo recomendado</div>
    <div class="pb">
      <p class="footer-note" style="margin:0">1 · Aterriza → 2 · SD al Mac → 3 · «Importar
      nuevos…» → 4 · «Optimizar SD» nivel Fábrica → 5 · La tarjeta vuelve al dron vacía y lista.
      Los originales viven intocables en <span class="mono">raw/&lt;dron&gt;/</span>.</p>
    </div>
  </div>`;

let sys = {}, volumes = [];
(async () => { try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); paintStats(); } catch {} })();

const gb = b => (b / 1e9).toFixed(1) + ' GB';
function lastFlight(v) {
  const dates = [...v.videos, ...v.photos]
    .map(x => (x.name.match(/DJI_(\d{4})(\d{2})(\d{2})/) || []).slice(1))
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
    const r = await fetch('/api/sd_scan');
    if (r.status === 403) { document.getElementById('sd-list').innerHTML = '<p class="footer-note">Inicia sesión para escanear.</p>'; return; }
    volumes = (await r.json()).volumes || [];
  } catch { volumes = []; }
  paintStats();
  const el = document.getElementById('sd-list');
  el.innerHTML = volumes.length ? volumes.map(v => {
    const nuevos = v.videos.filter(x => !x.in_vault);
    const backed = backedOf(v);
    const pct = Math.round((v.total - v.free) / v.total * 100);
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
  if (!st.open) { box.style.display = 'none'; return; }
  const all = [...v.videos.map(x => ({ ...x, tipo: 'video' })),
               ...v.photos.map(x => ({ ...x, tipo: 'foto' }))];
  const rows = all.filter(x => {
    if (st.filtro === 'nuevos' && x.in_vault) return false;
    if (st.filtro === 'respaldados' && !x.in_vault) return false;
    if (st.filtro === 'videos' && x.tipo !== 'video') return false;
    if (st.filtro === 'fotos' && x.tipo !== 'foto') return false;
    return !st.q || x.name.toLowerCase().includes(st.q);
  }).sort((a, b) => b.bytes - a.bytes);
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
  box.querySelectorAll('[data-bf]').forEach(b => b.addEventListener('click', () => {
    st.filtro = b.dataset.bf;
    renderBrowser(v);
  }));
  box.querySelector('[data-bq]').addEventListener('input', e => {
    st.q = e.target.value.toLowerCase();
    clearTimeout(st._t);
    st._t = setTimeout(() => renderBrowser(v), 180);
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
  ov.querySelector('#sd-go').addEventListener('click', async () => {
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
  const pctNow = Math.round(usado / v.total * 100);
  const pctAfter = lv => Math.max(0, Math.round((usado - sz(lv.files)) / v.total * 100));

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
  ov.querySelector('#opt-go').addEventListener('click', async () => {
    const lv = LV.find(l => l.k === ov.querySelector('.mpreset.on')?.dataset.lv) || LV[1];
    if (!lv.files.length) return alert('Nada respaldado que borrar todavía.');
    const r = await api('/api/sd_import', {
      volume: v.volume, files: lv.files.map(x => x.rel), clean_only: true,
    });
    if (r.error) return alert(r.error);
    ov.remove();
  });
}
