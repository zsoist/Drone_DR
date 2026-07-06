// Subir v2 — flujo real: vuela → exporta a Fotos (iPhone/iPad) o carpeta (PC) → aquí.
// Cola secuencial confiable con velocidad, ETA, cancelar y reintentar. Sesión requerida.
const main = renderShell('subir.html');
main.innerHTML = `
  <div class="st-hero rise">
    <h1>Subir</h1>
    <p style="color:var(--text-2);font-size:14px;margin:0 0 10px">
      Del dron a la bóveda: proxy, análisis y galería salen solos.</p>
    <span class="gchip" id="up-session">${icon('activity')} comprobando sesión…</span>
  </div>

  <div class="up-wrap">
    <div class="up-gate" id="up-gate" style="display:none">
      ${icon('warn')}
      <div><b>Inicia sesión para subir</b>
        <p>Solo el operador puede añadir videos a la bóveda.</p></div>
      <button class="btn primary" id="up-login">Iniciar sesión</button>
    </div>

    <div class="up-zone rise" id="drop" style="animation-delay:60ms">
      <span class="up-ring"></span>
      ${icon('dl')}
      <p class="up-t">Arrastra videos o toca para elegir</p>
      <p class="up-s">En iPhone y iPad se abre tu app de <b>Fotos</b> directamente.</p>
      <div class="up-devices">
        <span class="gchip">${icon('iso')} iPhone · Fotos</span>
        <span class="gchip">${icon('grid')} iPad</span>
        <span class="gchip">${icon('db')} PC · arrastra</span>
      </div>
      <input type="file" id="file" multiple accept="video/*,.mts,.mkv" style="display:none">
    </div>

    <div class="up-steps rise" style="animation-delay:110ms">
      <span>${icon('dl')} Subes</span><i>${icon('chevR')}</i>
      <span>${icon('gauge')} Proxy 1080p</span><i>${icon('chevR')}</i>
      <span>${icon('spark')} Análisis AI</span><i>${icon('chevR')}</i>
      <span>${icon('check')} En Vuelos y Studio</span>
    </div>
    <p class="footer-note" style="margin:2px 4px 0">
      Consejo: los videos del dron con telemetría .SRT entran mejor por la pestaña
      <a href="drone.html" style="color:var(--accent)">Dron</a> (traen GPS y mapa).</p>

    <div id="queue" class="up-queue"></div>

    <div class="panel" style="margin-top:18px">
      <div class="ph">${icon('activity')} Trabajos del servidor</div>
      <div class="pb" id="jobs"></div>
    </div>
  </div>`;

const drop = document.getElementById('drop');
const fileIn = document.getElementById('file');
const queue = document.getElementById('queue');
let logged = false;

// ---- gate de sesión: comprueba al entrar, bloquea la zona hasta loguear ----
async function checkSession() {
  try { logged = (await fetch('/api/whoami')).ok; } catch { logged = false; }
  document.getElementById('up-session').innerHTML = logged
    ? `${icon('check')} sesión activa — listo para subir`
    : `${icon('warn')} sin sesión`;
  document.getElementById('up-session').classList.toggle('mint', logged);
  document.getElementById('up-gate').style.display = logged ? 'none' : 'flex';
  drop.classList.toggle('locked', !logged);
}
checkSession();
document.getElementById('up-login').addEventListener('click', async () => {
  if (await ensureAuth()) checkSession();
});

drop.addEventListener('click', async () => {
  if (!logged) { if (await ensureAuth()) await checkSession(); else return; }
  if (logged) fileIn.click();
});
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async e => {
  e.preventDefault(); drop.classList.remove('over');
  if (!logged) { if (await ensureAuth()) await checkSession(); else return; }
  [...e.dataTransfer.files].forEach(enqueue);
});
fileIn.addEventListener('change', () => { [...fileIn.files].forEach(enqueue); fileIn.value = ''; });

// ---- cola secuencial: un upload a la vez = confiable en el túnel ----
const q = [];
let active = null;

function enqueue(file) {
  if (!/\.(mp4|mov|m4v|mkv|avi|mts|webm)$/i.test(file.name)) {
    alert(`"${file.name}" no es un formato de video soportado.`); return;
  }
  const item = { file, status: 'pendiente', pct: 0, speed: 0, eta: 0, loaded: 0, xhr: null };
  q.push(item);
  render();
  pump();
}

function pump() {
  if (active || !q.some(i => i.status === 'pendiente')) return;
  active = q.find(i => i.status === 'pendiente');
  start(active);
}

function start(item) {
  item.status = 'subiendo';
  const xhr = item.xhr = new XMLHttpRequest();
  xhr.open('POST', `/upload?name=${encodeURIComponent(item.file.name)}`);   // cookie de sesión va sola
  let lastT = performance.now(), lastL = 0;
  xhr.upload.onprogress = e => {
    const now = performance.now(), dt = (now - lastT) / 1000;
    if (dt > 0.4) {                                    // velocidad suavizada cada ~0.4s
      const inst = (e.loaded - lastL) / dt;
      item.speed = item.speed ? item.speed * 0.6 + inst * 0.4 : inst;
      item.eta = item.speed > 0 ? (e.total - e.loaded) / item.speed : 0;
      lastT = now; lastL = e.loaded;
    }
    item.pct = Math.round((e.loaded / e.total) * 100);
    item.loaded = e.loaded;
    paint(item);
  };
  const finish = st => { item.status = st; item.xhr = null; active = null; render(); pump(); };
  xhr.onload = () => {
    if (xhr.status === 200) finish('procesando');
    else if (xhr.status === 403) { item.err = 'sesión expirada'; finish('error'); checkSession(); }
    else { item.err = (JSON.parse(xhr.responseText || '{}').error) || `error ${xhr.status}`; finish('error'); }
  };
  xhr.onerror = () => { item.err = 'error de red — reintenta'; finish('error'); };
  xhr.onabort = () => finish('cancelado');
  xhr.send(item.file);
  render();
}

const STATE = {
  pendiente: { ic: 'clock', lb: 'En cola', cls: '' },
  subiendo: { ic: 'dl', lb: 'Subiendo', cls: 'run' },
  procesando: { ic: 'gauge', lb: 'Procesando en el M4', cls: 'ok' },
  cancelado: { ic: 'close', lb: 'Cancelado', cls: 'off' },
  error: { ic: 'warn', lb: 'Error', cls: 'bad' },
};

function render() {
  queue.innerHTML = q.map((it, i) => {
    const st = STATE[it.status];
    return `
    <div class="up-card ${st.cls}" data-i="${i}">
      <span class="up-ic">${icon(st.ic)}</span>
      <div class="up-info">
        <div class="up-name">${esc(it.file.name)}</div>
        <div class="up-meta mono" data-meta="${i}">${metaFor(it)}</div>
        <div class="up-bar"><i data-bar="${i}" style="width:${it.pct}%"></i></div>
      </div>
      <div class="up-acts">
        ${it.status === 'subiendo' ? `<button class="btn" data-cancel="${i}">Cancelar</button>` : ''}
        ${it.status === 'error' || it.status === 'cancelado' ? `<button class="btn" data-retry="${i}">${icon('loop')} Reintentar</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function metaFor(it) {
  const mb = v => (v / 1e6).toFixed(0);
  if (it.status === 'subiendo')
    return `${it.pct}% · ${mb(it.loaded)}/${mb(it.file.size)} MB · ${(it.speed / 1e6).toFixed(1)} MB/s · ~${fmt.dur(Math.min(5940, it.eta))} restantes`;
  if (it.status === 'procesando') return `${mb(it.file.size)} MB · proxy + AI en curso, mira Trabajos abajo`;
  if (it.status === 'error') return it.err || 'error';
  return `${mb(it.file.size)} MB`;
}

// repinta solo la card activa (sin re-render completo cada progreso)
function paint(it) {
  const i = q.indexOf(it);
  const m = queue.querySelector(`[data-meta="${i}"]`);
  const b = queue.querySelector(`[data-bar="${i}"]`);
  if (m) m.textContent = metaFor(it);
  if (b) b.style.width = `${it.pct}%`;
}

queue.addEventListener('click', e => {
  const c = e.target.closest('[data-cancel]');
  if (c) { q[+c.dataset.cancel]?.xhr?.abort(); return; }
  const r = e.target.closest('[data-retry]');
  if (r) {
    const it = q[+r.dataset.retry];
    if (it) { it.status = 'pendiente'; it.pct = 0; it.err = null; render(); pump(); }
  }
});

// aviso al salir con subida en curso
window.addEventListener('beforeunload', e => {
  if (active) { e.preventDefault(); e.returnValue = ''; }
});

pollJobs(document.getElementById('jobs'));
