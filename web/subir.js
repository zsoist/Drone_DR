// Subir: drag&drop de videos en cualquier formato → vault → pipeline automático.
const main = renderShell('subir.html');
main.innerHTML = `
  <div class="page-head"><h1>Subir contenido</h1>
    <span class="count">MP4 · MOV · MKV · AVI · MTS · WEBM</span></div>
  <div class="fl-layout">
    <div>
      <div class="panel">
        <div class="pb">
          <div id="drop" style="border:1.5px dashed var(--line);border-radius:var(--r-lg);
            padding:52px 20px;text-align:center;cursor:pointer;transition:border-color 160ms">
            ${icon('dl')}
            <p style="margin-top:10px;font-weight:600">Arrastra videos aquí o toca para elegir</p>
            <p style="color:var(--text-3);font-size:12.5px;margin-top:4px">
              Se procesan solos: proxy 1080p, keyframes, análisis AI. Sin límite de tamaño.</p>
            <input type="file" id="file" multiple accept="video/*,.mts,.mkv" style="display:none">
          </div>
          <div id="queue" style="margin-top:14px"></div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('activity')} Trabajos del servidor</div>
        <div class="pb" id="jobs"></div>
      </div>
    </div>
    <div>
      <div class="panel">
        <div class="ph">${icon('check')} Cómo funciona</div>
        <div class="pb"><table class="kv">
          <tr><td>1. Subes</td><td>cualquier video, cualquier formato</td></tr>
          <tr><td>2. Proxy</td><td>1080p por hardware (M4)</td></tr>
          <tr><td>3. AI</td><td>resumen, tags, highlights</td></tr>
          <tr><td>4. Listo</td><td>aparece en Vuelos, editable en Studio</td></tr>
        </table>
        <p class="footer-note">Videos del dron con .SRT entran mejor por la SD (traen GPS).
        Esta vía es para contenido de cámara, teléfono o material de terceros —
        por ejemplo, el video de una propiedad en venta.</p></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('warn')} Acceso</div>
        <div class="pb">
          <p style="font-size:12.5px;color:var(--text-2)">Subir requiere el token de operador
          (solo tú lo tienes). Queda guardado en este navegador.</p>
          <button class="btn" id="retoken" style="margin-top:10px">Cambiar token</button>
        </div>
      </div>
    </div>
  </div>`;

const drop = document.getElementById('drop');
const fileIn = document.getElementById('file');
const queue = document.getElementById('queue');

drop.addEventListener('click', () => fileIn.click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; });
drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--line)'; });
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.style.borderColor = 'var(--line)';
  [...e.dataTransfer.files].forEach(upload);
});
fileIn.addEventListener('change', () => [...fileIn.files].forEach(upload));
document.getElementById('retoken').addEventListener('click', () => getToken(true));

function upload(file) {
  const token = getToken();
  if (!token) return;
  const row = document.createElement('div');
  row.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${file.name}</span>
      <span class="mono" id="pct" style="color:var(--text-3)">0%</span>
    </div>
    <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden;margin-bottom:12px">
      <div id="bar" style="height:100%;width:0%;background:var(--accent);transition:width 200ms"></div>
    </div>`;
  queue.appendChild(row);
  const bar = row.querySelector('#bar'), pct = row.querySelector('#pct');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/upload?name=${encodeURIComponent(file.name)}`);
  xhr.setRequestHeader('X-Token', token);
  xhr.upload.onprogress = e => {
    const p = Math.round((e.loaded / e.total) * 100);
    bar.style.width = `${p}%`; pct.textContent = `${p}% · ${(e.loaded / 1e6).toFixed(0)}MB`;
  };
  xhr.onload = () => {
    if (xhr.status === 200) {
      bar.style.background = 'var(--mint)'; pct.textContent = 'procesando en el M4';
    } else if (xhr.status === 403) {
      bar.style.background = 'var(--red)'; pct.textContent = 'token inválido'; getToken(true);
    } else {
      bar.style.background = 'var(--red)';
      pct.textContent = JSON.parse(xhr.responseText || '{}').error || `error ${xhr.status}`;
    }
  };
  xhr.onerror = () => { bar.style.background = 'var(--red)'; pct.textContent = 'error de red'; };
  xhr.send(file);
}

pollJobs(document.getElementById('jobs'));
