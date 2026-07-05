// Dron — gestión de tarjetas SD: importa videos nuevos al vault del SSD,
// verifica la copia y deja la micro SD limpia. Multi-dron por carpeta.
const main = renderShell('drone.html');
main.innerHTML = `
  <div class="page-head"><h1>Dron</h1><span class="count">tarjetas SD · importación · vault</span></div>
  <div class="statgrid" id="d-stats">${'<div class="sk" style="height:74px"></div>'.repeat(4)}</div>

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
      <p class="footer-note" style="margin:0 0 10px">Cada video se copia al SSD, se <b>verifica el
      tamaño</b>, se procesa (proxy 1080p + GPS + thumbnails) y solo entonces —si lo marcaste—
      se borra de la SD. La tarjeta queda limpia y tus datos, seguros.</p>
      <div id="jobs-sd"></div>
    </div>
  </div>

  <div class="panel rise" style="margin-top:16px">
    <div class="ph">${icon('check')} Flujo recomendado</div>
    <div class="pb">
      <p class="footer-note" style="margin:0">1 · Vuela y aterriza → 2 · Mete la micro SD al Mac →
      3 · "Importar nuevos…" con limpieza activada → 4 · Devuelve la SD al dron, vacía y lista.
      Los originales 4K viven en el vault (<span class="mono">raw/&lt;dron&gt;/</span>), intocables;
      renombra, edita y gestiona todo desde Vuelos.</p>
    </div>
  </div>`;

let sys = {};
(async () => { try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); paintStats(); } catch {} })();

function paintStats(vols = []) {
  const st = sys.storage || {};
  const newCount = vols.reduce((a, v) => a + v.videos.filter(x => !x.in_vault).length, 0);
  document.getElementById('d-stats').innerHTML = `
    <div class="stat rise"><div class="lb">${icon('db')} Vault raw</div><div class="v">${fmt.gb(st.raw || 0)}</div></div>
    <div class="stat rise"><div class="lb">${icon('drone')} Tarjetas</div><div class="v">${vols.length}</div></div>
    <div class="stat rise"><div class="lb">${icon('film')} Videos en SD</div><div class="v">${vols.reduce((a, v) => a + v.videos.length, 0)}</div></div>
    <div class="stat rise"><div class="lb">${icon('spark')} Nuevos por importar</div><div class="v" style="color:${newCount ? 'var(--accent)' : 'inherit'}">${newCount}</div></div>`;
}

let volumes = [];
async function scan() {
  try {
    const r = await fetch('/api/sd_scan');
    if (r.status === 403) { document.getElementById('sd-list').innerHTML = '<p class="footer-note">Inicia sesión para escanear.</p>'; return; }
    volumes = (await r.json()).volumes || [];
  } catch { volumes = []; }
  paintStats(volumes);
  const el = document.getElementById('sd-list');
  el.innerHTML = volumes.length ? volumes.map(v => {
    const nuevos = v.videos.filter(x => !x.in_vault);
    const usadoPct = ((v.total - v.free) / v.total * 100).toFixed(0);
    const gb = b => (b / 1e9).toFixed(1) + ' GB';
    return `
    <div class="sd-card">
      <div class="sd-head">${icon('db')}<b>${esc(v.volume)}</b>
        <span class="mono" style="color:var(--text-3);font-size:11px">${gb(v.total - v.free)} / ${gb(v.total)}</span>
        <span class="spacer" style="flex:1"></span>
        ${nuevos.length
          ? `<button class="btn primary" data-import="${esc(v.volume)}" style="padding:5px 14px;font-size:12px">${icon('dl')} Importar ${nuevos.length} nuevos…</button>`
          : `<span class="chip" style="color:var(--mint);border-color:rgba(82,199,154,.4)">✓ al día</span>`}
      </div>
      <div class="sbar" style="margin:10px 0 6px"><div style="width:${usadoPct}%"></div></div>
      <p class="footer-note" style="margin:0">${v.videos.length} videos en la tarjeta ·
        ${nuevos.length} nuevos · ${v.videos.filter(x => x.in_vault).length} ya respaldados
        ${v.videos.some(x => x.in_vault) ? `· <a href="#" data-cleanonly="${esc(v.volume)}" style="color:var(--accent)">liberar espacio (borrar respaldados)</a>` : ''}</p>
    </div>`;
  }).join('') : `
    <div class="empty">${icon('db')}<p>Sin tarjetas SD detectadas.<br>
    <span style="font-size:12px;color:var(--text-3)">Inserta la micro SD del dron — se detecta sola
    (busca la carpeta DCIM).</span></p></div>`;
}

document.getElementById('sd-rescan').addEventListener('click', scan);
scan();
setInterval(scan, 10000);           // detecta inserción de la SD sola
pollJobs(document.getElementById('jobs-sd'));

// ---------- modal de importación ----------
document.getElementById('sd-list').addEventListener('click', e => {
  const cl = e.target.closest('[data-cleanonly]');
  if (cl) {
    e.preventDefault();
    const v = volumes.find(x => x.volume === cl.dataset.cleanonly);
    const done = v.videos.filter(x => x.in_vault);
    if (!confirm(`¿Borrar de la SD "${v.volume}" los ${done.length} videos ya respaldados en el vault?\n\nSolo se borran archivos verificados; el vault no se toca.`)) return;
    api('/api/sd_import', { volume: v.volume, files: done.map(x => x.rel), clean: true, drone: v.volume })
      .then(r => { if (r.error) alert(r.error); });
    return;
  }
  const b = e.target.closest('[data-import]');
  if (!b) return;
  const v = volumes.find(x => x.volume === b.dataset.import);
  openImport(v);
});

function openImport(v) {
  const nuevos = v.videos.filter(x => !x.in_vault);
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal" style="max-width:600px">
    <div class="modal-h"><b>${icon('dl')} Importar de "${esc(v.volume)}"</b>
      <button class="modal-x" aria-label="Cerrar">✕</button></div>
    <div class="modal-b">
      <p class="mlb">Videos nuevos <span style="text-transform:none;letter-spacing:0">(${nuevos.length})</span></p>
      <div class="mflights" style="max-height:240px">${nuevos.map(f => `
        <label class="mflight" style="cursor:pointer">
          <input type="checkbox" checked data-rel="${esc(f.rel)}" style="accent-color:var(--accent)">
          <div class="mf-t"><b>${esc(f.name)}</b>
          <span class="mono">${(f.bytes / 1e9).toFixed(2)} GB${f.srt ? ' · GPS ✓' : ' · sin telemetría'}</span></div>
        </label>`).join('')}</div>
      <p class="mlb">Dron / carpeta de destino</p>
      <input class="ctl" id="sd-drone" list="drones" value="${esc(v.volume)}" maxlength="40" style="width:100%">
      <datalist id="drones"><option value="DJI Flip"><option value="Neo 2"><option value="${esc(v.volume)}"></datalist>
      <label style="display:flex;align-items:center;gap:9px;margin-top:14px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="sd-clean" checked style="accent-color:var(--accent)">
        Dejar la SD limpia — borra cada video <b>solo tras verificar</b> su copia en el SSD
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
