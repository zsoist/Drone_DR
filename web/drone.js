// Drone equipment, read-only library statistics, SD import, and direct upload.
const main = renderShell('drone.html');
main.classList.add('ab-page', 'dr-page');
const drMotionMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-base')) || 220;
main.innerHTML = `
  <header class="dr-head"><div><h1>Dron</h1><p>Tu equipo y el material de cada vuelo.</p></div><button class="ui-button ui-button--primary" id="dr-import">Importar archivos</button></header>
  <section class="dr-fleet" aria-label="Tus drones"><div class="dr-equipment"><h2>Tu equipo</h2><p>DJI Flip · Neo 2</p><button class="ui-button ui-button--secondary" id="dr-specs">Ver ficha del equipo</button></div><div id="dr-library" class="dr-library" aria-busy="true"><dl>${['Clips en el archivo','Tiempo grabado','Con ruta GPS'].map(label=>`<div><dt>${label}</dt><dd class="ui-skeleton" aria-hidden="true">&nbsp;</dd></div>`).join('')}</dl></div></section>
  <p class="dr-attribution">Los vuelos aún no incluyen el modelo de dron. Las cifras corresponden a todo el archivo.</p>
  <div class="ui-segmented dr-tabs" id="dr-tabs" role="group" aria-label="Vía de importación">
    <button class="on" aria-pressed="true" data-tab="sd" data-tip="La vía recomendada: los .SRT traen GPS, mapa y telemetría">${icon('db')} Tarjeta SD</button>
    <button aria-pressed="false" data-tab="up" data-tip="Videos o fotos desde iPhone/iPad o arrastrando en PC — sin telemetría de vuelo">${icon('dl')} Subida directa</button>
  </div>

  <section class="dr-mod" data-mod="sd">
    <div class="dr-stats" id="d-stats"></div>

    <div class="panel dr-panel">
      <div class="ph">${icon('db')} Tarjetas SD detectadas
        <span class="spacer" style="flex:1"></span>
        <button class="ui-button ui-button--secondary" id="sd-rescan" data-tip="Vuelve a buscar tarjetas montadas (carpeta DCIM)">${icon('loop')} Escanear</button>
      </div>
      <div class="pb" id="sd-list"><div class="ui-skeleton" style="height:80px"></div></div>
    </div>

    <p class="dr-note">Conserva la tarjeta hasta revisar tus archivos importados. <a href="guia.html#g-importar">Ver guía de importación</a></p>
  </section>

  <section class="dr-mod" data-mod="up" hidden>
    <div class="dr-up-wrap">
      <div class="ui-segmented dr-kind" id="up-kind" role="group" aria-label="Qué vas a subir">
        <button class="on" aria-pressed="true" data-kind="video" data-tip="Clips de video: reproducción, análisis y galería">${icon('film')} Videos</button>
        <button aria-pressed="false" data-kind="foto" data-tip="Fotos fijas JPG o DNG: la entrada recomendada para malla 3D">${icon('iso')} Fotos · malla 3D</button>
      </div>

      <div class="dr-up-panes" id="up-panes">
        <div class="dr-up-pane" data-pane="video">
          <div class="dr-up-zone rise" id="drop" data-tip="También puedes soltar varios a la vez — van en cola">

            ${icon('dl')}
            <p class="dr-up-t">Trae los videos de tu próximo montaje</p><button type="button" class="ui-button ui-button--primary" id="video-pick">Elegir videos</button>
            <p class="dr-up-s">En iPhone y iPad se abre tu app de <b>Fotos</b> directamente.</p>

            <input type="file" id="file" multiple accept="video/*,.mts,.mkv" hidden>
          </div>


          <p class="dr-note">Esta vía no incluye la ruta ni los datos del vuelo. Para conservarlos junto al video,
            importa desde la <b>Tarjeta SD</b>.</p>

          <div id="queue" class="dr-up-queue"></div>
        </div>

        <div class="dr-up-pane" data-pane="foto" hidden>
          <div class="dr-up-zone rise" id="ph-drop" role="button" tabindex="0" aria-label="Elegir fotos o soltar una carpeta"
               data-tip="Suelta fotos sueltas o una carpeta entera (cada subcarpeta es una pasada)">

            ${icon('iso')}
            <p class="dr-up-t">Arrastra fotos o una carpeta</p>
            <p class="dr-up-s">JPG, JPEG y DNG del dron. Hasta 200 MB por foto y 25 GB por grupo.</p>
            <div class="dr-up-devices">
              <button type="button" class="ui-button ui-button--secondary" id="ph-pick">${icon('plus')} Elegir fotos</button>
              <button type="button" class="ui-button ui-button--secondary" id="ph-pick-dir">${icon('folder')} Elegir carpeta</button>
            </div>
            <input type="file" id="ph-file" multiple accept=".jpg,.jpeg,.dng,image/jpeg" hidden>
            <input type="file" id="ph-dir" webkitdirectory multiple hidden>
          </div>

          <div class="panel dr-panel dr-ph" id="ph-stage" hidden>
            <div class="ph">${icon('layers')} Grupo de fotos
              <span class="spacer"></span>
              <button type="button" class="ui-button ui-button--quiet" id="ph-clear">${icon('trash')} Vaciar</button>
            </div>
            <div class="pb">
              <div class="dr-ph-fields">
                <label class="dr-ph-f"><span class="dr-ph-lb">Grupo</span>
                  <input class="ctl" id="ph-set" maxlength="60" autocomplete="off" placeholder="Ej. Edificio Dialectica"></label>
                <label class="dr-ph-f"><span class="dr-ph-lb">Pasada</span>
                  <input class="ctl" id="ph-pass" list="ph-pass-list" maxlength="60" autocomplete="off" placeholder="nadir, anillo A, fachada…"></label>
                <datalist id="ph-pass-list"><option value="nadir"><option value="anillo A"><option value="anillo B"><option value="anillo C"><option value="fachada"></datalist>
              </div>
              <div class="dr-ph-sum" id="ph-sum" aria-live="polite"></div>
              <div class="dr-ph-prog" id="ph-prog" hidden>
                <div class="dr-up-meta" id="ph-meta" aria-live="polite"></div>
                <div class="dr-up-bar"><i id="ph-bar" style="--p:0"></i></div>
              </div>
              <div id="ph-msg"></div>
              <div class="dr-ph-acts">
                <button type="button" class="ui-button ui-button--primary" id="ph-go">${icon('dl')} Subir fotos</button>
                <button type="button" class="ui-button ui-button--secondary" id="ph-cancel" hidden>Cancelar</button>
              </div>
              <p class="dr-note" id="ph-dest"></p>
            </div>
          </div>


          <p class="dr-note">Las fotos conservan la ubicación, los datos de la cámara y sus nombres originales. Mantén esos nombres para agrupar cada pasada.</p>
        </div>
      </div>
    </div>
  </section>

  <div class="dr-recent"><h2>Importaciones</h2><p>Sigue el progreso y revisa los resultados en Sistema.</p><a class="ui-button ui-button--secondary" href="system.html">Ver trabajos</a></div>`;

// Import methods use the W1 segmented control.
const drTabs = document.getElementById('dr-tabs');
function showVia(name) {
  drTabs.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === name);
    b.setAttribute('aria-pressed', b.dataset.tab === name);
  });
  document.querySelectorAll('.dr-mod').forEach(m => {
    const show = m.dataset.mod === name;
    if (show && m.hidden) {
      m.hidden = false;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) m.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
                { duration: drMotionMs, easing: 'cubic-bezier(.16,1,.3,1)' });
    } else if (!show) m.hidden = true;
  });
}
drTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showVia(b.dataset.tab);
});
if (new URLSearchParams(location.search).get('via') === 'subir') showVia('up');

let volumes = [];

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

function paintStats() {
  document.getElementById('d-stats').textContent = volumes.length ? `${volumes.length} tarjeta${volumes.length === 1 ? '' : 's'} conectada${volumes.length === 1 ? '' : 's'}` : '';
}
function gauge(pct) {
  return `<div class="sd-capacity"><b class="ui-figures">${pct}%</b><span>ocupado</span></div>`;
}

async function scan() {
  try {
    const r = await authFetch('/api/sd_scan');
    if (!r.ok) throw new Error('scan');
    volumes = (await r.json()).volumes || [];
  } catch {
    const el = document.getElementById('sd-list'); el.dataset.sig = '';
    el.innerHTML = '<div class="ui-empty"><p>No se pudo consultar la tarjeta.</p><button class="ui-button ui-button--primary" data-rescan>Reintentar</button></div>'; return;
  }
  paintStats();
  document.getElementById('sd-rescan').hidden = !volumes.length;   // vacío: el CTA del estado vacío ya escanea
  const el = document.getElementById('sd-list');
  // DIFF antes de re-pintar: el poll de 10s reconstruía el DOM idéntico → replay de .rise y
  // del sweep del gauge en cada tick, y si tecleabas en el buscador, innerHTML destruía el
  // input ANTES de renderBrowser (foco/teclado perdidos cada 10s)
  const sig = JSON.stringify(volumes.map(v => [v.volume, v.free, v.videos.length, v.photos.length,
    [...v.videos, ...v.photos].filter(x => !x.in_vault).length]));
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = volumes.length ? volumes.map(v => {
    const nuevos = [...v.videos, ...v.photos].filter(x => !x.in_vault);
    const backed = backedOf(v);
    const pct = v.total > 0 ? Math.round((v.total - v.free) / v.total * 100) : 0;
    return `
    <div class="sd-card rise" data-vol="${esc(v.volume)}">
      <div class="sd-head">
        ${gauge(pct)}
        <div class="sd-title">
          <b>${esc(v.volume)}</b>
          <span>${gb(v.total - v.free)} de ${gb(v.total)} · ${v.videos.length} videos · ${v.photos.length} fotos</span>
        </div>
        <span class="spacer" style="flex:1"></span>
        <div class="sd-acts">
          ${nuevos.length
            ? `<button class="ui-button ui-button--primary" data-import="${esc(v.volume)}">${icon('dl')} Importar ${nuevos.length}</button>`
            : `<span class="ui-chip sd-ok">${icon('check')} Sin archivos nuevos</span>`}
          <button class="ui-button ui-button--quiet" data-optimize="${esc(v.volume)}">Sobre la limpieza</button>
        </div>
      </div>
      <div class="sd-meta">
        <span class="ui-chip">${nuevos.length} nuevos</span>
        <span class="ui-chip">${backed.length} con copia registrada</span>
        <span class="ui-chip warn">Limpieza no disponible</span>
        ${lastFlight(v) ? `<span class="ui-chip">${icon('cal')} último vuelo ${lastFlight(v)}</span>` : ''}
        <span class="spacer" style="flex:1"></span>
        <button class="ui-button ui-button--quiet" data-browse="${esc(v.volume)}" aria-expanded="false">Ver contenido ${icon('chevD')}</button>
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
    <div class="ui-empty"><h3>No hay una tarjeta conectada</h3><p>Inserta la microSD en el Mac para importar tus vuelos.</p><button class="ui-button ui-button--primary" data-rescan>Buscar tarjeta</button><small>Por ejemplo, la tarjeta de tu último vuelo.</small></div>`;
  // el re-scan cada 10s reconstruye las tarjetas → re-abre el explorador que estuviera abierto
  // (antes se colapsaba solo y perdía sus listeners de filtro/búsqueda) (#8/#9/#11)
  volumes.forEach(v => { if (typeof bstate !== 'undefined' && bstate[v.volume]?.open) renderBrowser(v); });
}

document.getElementById('sd-rescan').addEventListener('click', scan);
scan();
const scanTimer = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) scan(); }, 10000);
addEventListener('pagehide', () => clearInterval(scanTimer), { once:true });
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
        `<button class="ui-chip" aria-pressed="${st.filtro === f}" data-bf="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
      <label class="search sd-q">${icon('search')}<input data-bq type="search" placeholder="Buscar archivo…" aria-label="Buscar archivos" autocomplete="off" value="${esc(st.q)}"></label>
    </div>
    <div class="sd-files">${rows.slice(0, 120).map(x => `
      <div class="sd-file">
        <span class="sf-ic">${icon(x.tipo === 'video' ? 'film' : 'iso')}</span>
        <span class="sf-name">${esc(x.name)}</span>
        ${x.srt ? '<span class="ui-chip">GPS</span>' : ''}
        <span class="spacer" style="flex:1"></span>
        <span class="mono sf-size">${x.bytes > 1e9 ? gb(x.bytes) : (x.bytes / 1e6).toFixed(0) + ' MB'}</span>
        <span class="sf-st ${x.in_vault ? 'in' : 'new'}">${x.in_vault ? 'En el archivo' : 'Nuevo'}</span>
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
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelector(`[data-browser="${CSS.escape(v.volume)}"]`)?.animate(
      [{ opacity: 0 }, { opacity: 1 }], { duration: drMotionMs, easing: 'cubic-bezier(.16,1,.3,1)' });
    return;
  }
  const imp = e.target.closest('[data-import]');
  if (imp) return openImport(volumes.find(x => x.volume === imp.dataset.import));
  const opt = e.target.closest('[data-optimize]');
  if (opt) return openOptimize(volumes.find(x => x.volume === opt.dataset.optimize));
});

// Import includes photos. Keep originals until content verification is available.
async function openImport(v) {
  const opener = document.activeElement;
  const { createSheet } = await import('./ui/sheet.js?v=395');
  const files = [...v.videos, ...v.photos].filter(x => !x.in_vault);
  const content = document.createElement('form'); content.className = 'dr-import-form';
  content.innerHTML = `<p>Elige los archivos que quieres importar. Los originales se conservan en la tarjeta.</p><div class="dr-import-files">${files.map(f=>`<label><input type="checkbox" checked data-rel="${esc(f.rel)}"><span><b>${esc(f.name)}</b><small>${gb(f.bytes)}${f.srt ? ' · con GPS' : ''}</small></span></label>`).join('')}</div><label for="sd-drone">Carpeta de destino</label><input class="ctl" id="sd-drone" value="${esc(v.volume)}" maxlength="40" required><p class="dr-import-error" role="alert"></p><button type="submit" class="ui-button ui-button--primary">Importar archivos</button>`;
  const view = createSheet({title:`Importar de ${v.volume}`,content,size:'full',onClose:()=>view.destroy()}); view.open(opener);
  content.addEventListener('submit', async e=>{
    e.preventDefault(); const button=content.querySelector('button[type=submit]'), error=content.querySelector('[role=alert]');
    const selected=[...content.querySelectorAll('[data-rel]:checked')].map(c=>c.dataset.rel);
    if (!selected.length) { error.textContent='Elige al menos un archivo.'; return; }
    button.disabled=true; error.textContent='';
    try {
      const response=await authFetch('/api/sd_import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({volume:v.volume,files:selected,drone:content.querySelector('#sd-drone').value.trim(),clean:false})});
      const result=await response.json(); if(!response.ok || result.error) throw new Error(result.error || 'No se pudo importar.');
      view.close(); scan();
    } catch(err) { error.textContent=err.message; } finally { button.disabled=false; }
  });
}
async function openOptimize() {
  const opener = document.activeElement;
  const { createSheet } = await import('./ui/sheet.js?v=395');
  const content=document.createElement('p'); content.textContent='La limpieza está deshabilitada hasta que el servidor pueda verificar el contenido completo de cada copia. Conserva los originales en la tarjeta.';
  const view=createSheet({title:'Conserva tus originales',content,size:'peek',onClose:()=>view.destroy()}); view.open(opener);
}

// ================= subida directa (fusionado de Subir v2) =================
const drop = document.getElementById('drop');
const fileIn = document.getElementById('file');
const upQueue = document.getElementById('queue');


document.getElementById('video-pick').addEventListener('click', () => fileIn.click());
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
    toast(`"${file.name}" no es un formato de video soportado.`); return;
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
        <div class="dr-up-meta" data-meta="${i}">${upMeta(it)}</div>
        <div class="dr-up-bar"><i data-bar="${i}" style="--p:${it.pct / 100}"></i></div>
      </div>
      <div class="dr-up-acts">
        ${it.status === 'subiendo' ? `<button class="ui-button ui-button--secondary" data-cancel="${i}">Cancelar</button>` : ''}
        ${it.status === 'error' || it.status === 'cancelado' ? `<button class="ui-button ui-button--secondary" data-retry="${i}">${icon('loop')} Reintentar</button>` : ''}
      </div>
    </div>`).join('');
}
function upMeta(it) {
  const mb = v => (v / 1e6).toFixed(0);
  if (it.status === 'subiendo')
    return `${it.pct}% · ${mb(it.loaded)}/${mb(it.file.size)} MB · ${(it.speed / 1e6).toFixed(1)} MB/s · ~${fmt.dur(Math.min(5940, it.eta))} restantes`;
  if (it.status === 'procesando') return `${mb(it.file.size)} MB · preparación y análisis en curso`;
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
    b.setAttribute('aria-pressed', b.dataset.kind === kind);
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
  if (over) notes.push(`${over} no caben en el grupo (máx. 2000 fotos y 25 GB)`);
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
    `<span class="ui-chip on">${phItems.length} foto${phItems.length === 1 ? '' : 's'}</span>`,
    `<span class="ui-chip mono">${phMB(bytes)}</span>`,
    nJpg ? `<span class="ui-chip mono">${nJpg} JPG</span>` : '',
    nDng ? `<span class="ui-chip mono">${nDng} DNG</span>` : '',
    passes.size > 1 ? `<span class="ui-chip">${passes.size} pasadas</span>` : '',
    done.length ? `<span class="ui-chip ok">${done.length} subida${done.length === 1 ? '' : 's'}</span>` : '',
    failed.length ? `<span class="ui-chip err">${failed.length} con error</span>` : '',
  ].join('');
  const go = phEl('ph-go');
  go.disabled = phBusy || !pend.length;
  go.innerHTML = `${icon(failed.length && !phBusy ? 'loop' : 'dl')} ${failed.length && !phBusy && pend.length === failed.length
    ? `Reintentar ${failed.length}` : pend.length ? `Subir ${pend.length} foto${pend.length === 1 ? '' : 's'}` : 'Todo subido'}`;
  phEl('ph-cancel').hidden = !phBusy;
  phEl('ph-clear').disabled = phBusy;
  phEl('ph-set').disabled = phEl('ph-pass').disabled = phBusy;
  const many = passes.size > 1;
  phEl('ph-dest').innerHTML = `Grupo: ${esc(phSetName())} · ${many ? 'varias pasadas' : esc([...passes][0])}. Se conservan los nombres y la calidad original.`;
  // mensaje de estado: error fatal, errores por foto, o éxito
  const msg = phEl('ph-msg');
  if (phFatal) {
    msg.innerHTML = `<div class="dr-ph-alert bad" role="alert">${icon('warn')}<span>${esc(phFatal)}</span></div>`;
  } else if (failed.length && !phBusy) {
    const first = failed.slice(0, 4).map(i => `<li><span>${esc(i.file.name)}</span> · ${esc(i.err || 'error')}</li>`).join('');
    msg.innerHTML = `<div class="dr-ph-alert bad" role="alert">${icon('warn')}<div><b>${failed.length} foto${failed.length === 1 ? '' : 's'} no se subió${failed.length === 1 ? '' : 'eron'}.</b>
      <ul>${first}${failed.length > 4 ? `<li>y ${failed.length - 4} más…</li>` : ''}</ul></div></div>`;
  } else if (done.length && !pend.length && !phBusy) {
    msg.innerHTML = `<div class="dr-ph-alert ok" role="status">${icon('check')}<span><b>${done.length} foto${done.length === 1 ? '' : 's'} en tu archivo.</b> Ya aparecen en Studio.</span>
      <a class="ui-button ui-button--secondary" href="studio.html?tab=fotos">Ver en Studio ${icon('chevR')}</a></div>`;
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

// Equipment is documented in the capture guide. The manifest has no drone assignment.
document.getElementById('dr-import').addEventListener('click',()=>{ document.getElementById('dr-tabs').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}); (document.querySelector('[data-rescan]') || document.getElementById('sd-rescan')).focus({preventScroll:true}); });
document.getElementById('dr-specs').addEventListener('click',async e=>{
  const opener=e.currentTarget; const {createSheet}=await import('./ui/sheet.js?v=395');
  const content=document.createElement('div'); content.className='dr-specs';
  content.innerHTML='<h3>DJI Flip</h3><dl><div><dt>Sensor</dt><dd>1/1,3 pulgadas</dd></div><div><dt>Foto</dt><dd>48 MP · JPEG y DNG</dd></div><div><dt>Vuelo máximo</dt><dd>31 min</dd></div></dl><a class="ui-button ui-button--quiet" href="https://www.dji.com/flip/specs" target="_blank" rel="noopener">Especificaciones de DJI Flip</a><h3>Neo 2</h3><dl><div><dt>Sensor</dt><dd>1/2 pulgada</dd></div><div><dt>Foto</dt><dd>12 MP</dd></div><div><dt>Vuelo máximo</dt><dd>19 min</dd></div></dl><a class="ui-button ui-button--quiet" href="https://store.dji.com/sg/product/dji-neo-2" target="_blank" rel="noopener">Especificaciones de DJI Neo 2</a><p>Datos del fabricante. La autonomía máxima se mide en condiciones de prueba; el tiempo real depende del vuelo.</p><p>Los vuelos del archivo aún no están asignados a un dron.</p>';
  const view=createSheet({title:'Tu equipo',content,size:'half',onClose:()=>view.destroy()}); view.open(opener);
});
async function loadLibrary() {
  const el=document.getElementById('dr-library');
  try {
    const r=await fetch(`${DATA}/manifest/flights.json`); if(!r.ok) throw new Error('flights'); const {flights=[]}=await r.json();
    const seconds=flights.reduce((n,f)=>n+(Number(f.duration_s)||0),0), gps=flights.filter(f=>f.has_srt).length;
    el.innerHTML=`<dl><div><dt>Clips en el archivo</dt><dd>${flights.length}</dd></div><div><dt>Tiempo grabado</dt><dd>${Math.round(seconds/60)} <small>min</small></dd></div><div><dt>Con ruta GPS</dt><dd>${gps}</dd></div></dl><p>Capturas: ${[...new Set(flights.map(f=>f.resolution).filter(Boolean))].map(esc).join(' · ') || 'Sin datos aún'}</p>`;
  } catch { el.innerHTML='<p>No se pudo cargar el archivo.</p><button class="ui-button ui-button--secondary" id="dr-retry-library">Reintentar</button>'; el.querySelector('button').onclick=loadLibrary; }
  finally { el.setAttribute('aria-busy','false'); }
}
loadLibrary();
registerPaletteSource(()=>[{id:'drone-flip',label:'DJI Flip',keywords:'Dron equipo',action:()=>document.getElementById('dr-specs').click()},{id:'drone-neo',label:'Neo 2',keywords:'Dron equipo',action:()=>document.getElementById('dr-specs').click()}]);
