// Ventas: crea páginas de propiedad aisladas (p.html?id=slug) con link + QR.
const main = renderShell('ventas.html');
// [clave, etiqueta, placeholder, pista, opciones]
const GROUPS = [
  ['Básico', [
    ['slug', 'URL corta', 'casa-cajica', 'Será el link de la página: p.html?id=…', { full: true, mono: true }],
    ['titulo', 'Título', 'Casa campestre en Cajicá', '', { full: true }],
    ['ubicacion', 'Ubicación', 'Cajicá, Cundinamarca', '', { full: true }],
    ['precio', 'Precio', '$850.000.000 COP', '', { full: true }],
  ]],
  ['Características', [
    ['area', 'Área (m²)', '240', '', { inputmode: 'decimal' }],
    ['habitaciones', 'Habitaciones', '4', '', { inputmode: 'numeric' }],
    ['banos', 'Baños', '3', '', { inputmode: 'numeric' }],
    ['parqueaderos', 'Parqueaderos', '2', '', { inputmode: 'numeric' }],
    ['estrato', 'Estrato', '5', '', { inputmode: 'numeric' }],
  ]],
  ['Contacto', [
    ['whatsapp', 'WhatsApp', '573001234567', 'Con indicativo de país, sin + ni espacios.', { inputmode: 'tel' }],
    ['telefono', 'Teléfono', '300 123 4567', '', { inputmode: 'tel' }],
  ]],
];
const F = GROUPS.flatMap(([, fields]) => fields);
const fieldHTML = ([k, label, ph, hint, o = {}]) => `
  <div class="vt-f${o.full ? ' full' : ''}">
    <label for="f-${k}">${label}</label>
    <input class="ctl${o.mono ? ' mono' : ''}" id="f-${k}" placeholder="${ph}" autocomplete="off"${o.inputmode ? ` inputmode="${o.inputmode}"` : ''}>
    ${hint ? `<small>${hint}</small>` : ''}
  </div>`;
main.classList.add('vt-page');
main.innerHTML = `
  ${pageHead('Ventas', 'Crea una página aislada por propiedad, con link y QR para compartir.')}
  <div class="vt-layout">
    <div class="panel vt-form">
      <div class="ph">${icon('pin')} Datos de la propiedad</div>
      <div class="pb">
        ${GROUPS.map(([title, fields]) => `
        <fieldset class="vt-group">
          <legend>${title}</legend>
          <div class="vt-grid${title === 'Características' ? ' tight' : ''}">${fields.map(fieldHTML).join('')}</div>
        </fieldset>`).join('')}
        <fieldset class="vt-group">
          <legend>Medios</legend>
          <div class="vt-grid">
            <div class="vt-f full"><label for="f-clip">Portada de galería</label>
              <select class="ctl" id="f-clip"></select></div>
            <div class="vt-f full"><label for="f-video">Video principal</label>
              <select class="ctl" id="f-video"></select></div>
          </div>
        </fieldset>
        <fieldset class="vt-group">
          <legend>Descripción</legend>
          <div class="vt-f full">
            <label for="f-descripcion">Texto de venta</label>
            <textarea class="ctl" id="f-descripcion" rows="6" placeholder="Escríbela o genérala con AI a partir de los datos de arriba."></textarea>
          </div>
        </fieldset>
        <div class="vt-actions">
          <button class="btn ghost" id="btn-ai" type="button">${icon('spark')} Generar descripción AI</button>
          <span class="spacer"></span>
          <button class="btn primary" id="btn-save" type="button">${icon('check')} Guardar y publicar</button>
        </div>
        <div id="result"></div>
      </div>
    </div>
    <div class="vt-side">
      <div class="panel">
        <div class="ph">${icon('layers')} Propiedades publicadas</div>
        <div class="pb" id="plist"><div class="sk" style="height:60px"></div></div>
      </div>
      <div class="panel">
        <div class="ph">${icon('check')} Cómo funciona</div>
        <div class="pb">
          <ol class="vt-steps">
            <li><b>Video</b><span>Vuela la propiedad o sube el recorrido.</span></li>
            <li><b>Datos</b><span>Llena el formulario; la AI escribe la venta.</span></li>
            <li><b>Publica</b><span>Obtienes un link aislado y su QR.</span></li>
            <li><b>Comparte</b><span>WhatsApp, valla con QR, portales.</span></li>
          </ol>
          <p class="vt-note">El comprador solo ve esa propiedad: video, mapa, galería y botón de WhatsApp. Nada más de tu archivo.</p>
        </div>
      </div>
    </div>
  </div>`;

document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (b) { navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copiado'; }
});
(async () => {
  const flights = await getFlights();
  const clips = flights.filter(f => f.frame_count);
  document.getElementById('f-clip').innerHTML =
    `<option value="">Sin portada (opcional)</option>` +
    clips.map(f => `<option value="${f.clip_id}">${fmt.date(f.date)} ${f.time} — ${f.clip_id.startsWith('UP_') ? 'subido' : 'dron'}</option>`).join('');
  let sys = { reels: [] };
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  document.getElementById('f-video').innerHTML =
    `<option value="">Sin video principal</option>` +
    flights.filter(f => f.has_proxy).map(f => `<option value="${f.clip_id}">Video: ${fmt.date(f.date)} ${f.time}</option>`).join('') +
    (sys.reels || []).map(r => `<option value="${r.name}">Reel: ${r.name}</option>`).join('');

  async function loadList() {
    const res = await authFetch('/api/properties');
    const { properties } = await res.json();
    document.getElementById('plist').innerHTML = properties.length ? properties.map(p => `
      <div class="vt-item">
        <div class="vt-item-m">
          <b>${esc(p.titulo) || esc(p.slug)}</b>
          <span>${esc(p.precio) || 'Sin precio'}</span>
          <span class="vt-item-d">${esc(String(p.updated || '').slice(0, 16).replace('T', ' '))}</span>
        </div>
        <div class="vt-item-a">
          <a class="btn sm ghost" href="p.html?id=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">${icon('ext')} Ver</a>
          <button class="btn sm" data-edit="${esc(p.slug)}">Editar</button>
        </div>
      </div>`).join('') :
      emptyState({ icon: 'tag', title: 'Sin propiedades publicadas', help: 'Cuando publiques la primera aparecerá aquí.' });
  }
  loadList();

  document.getElementById('plist').addEventListener('click', async e => {
    const slug = e.target.dataset.edit;
    if (!slug) return;
    const p = await (await fetch(`${DATA}/properties/${slug}.json`)).json();
    F.forEach(([k]) => { document.getElementById(`f-${k}`).value = p[k] || ''; });
    document.getElementById('f-descripcion').value = p.descripcion || '';
    document.getElementById('f-clip').value = p.clip || '';
    document.getElementById('f-video').value = p.video || '';
  });

  function collect() {
    const p = {};
    F.forEach(([k]) => { p[k] = document.getElementById(`f-${k}`).value.trim(); });
    p.descripcion = document.getElementById('f-descripcion').value.trim();
    p.clip = document.getElementById('f-clip').value;
    p.video = document.getElementById('f-video').value;
    const cl = flights.find(f => f.clip_id === p.clip);
    if (cl?.stats?.home) { p.lon = cl.stats.home[0]; p.lat = cl.stats.home[1]; }
    return p;
  }

  document.getElementById('btn-save').addEventListener('click', async () => {
    const token = getToken();
    if (!token) return;
    const p = collect();
    if (!p.slug || !p.titulo) { toast('La URL corta y el título son obligatorios.'); return; }
    const { url } = await api('/api/property', p);
    const safeSlug = encodeURIComponent(p.slug);
    const localUrl = `p.html?id=${safeSlug}`;
    document.getElementById('result').innerHTML = `
      <div class="vt-done">
        <div class="vt-done-t"><span class="chip sm ok">${icon('check')} Publicada</span><span>Comparte este link:</span></div>
        <a class="vt-link mono" href="${localUrl}" target="_blank" rel="noopener">${esc(url)}</a>
        <div class="vt-qr"><img alt="Código QR de la propiedad" width="160" height="160"
          src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}"></div>
        <button class="btn sm" data-copy="${esc(url)}">${icon('copy')} Copiar link</button>
      </div>`;
    loadList();
  });

  document.getElementById('btn-ai').addEventListener('click', async () => {
    const token = getToken();
    if (!token) return;
    const p = collect();
    if (!p.slug) { toast('Escribe primero la URL corta: la AI necesita guardar la propiedad.'); return; }
    await api('/api/property', p);
    const btn = document.getElementById('btn-ai');
    btn.disabled = true;
    btn.textContent = 'Escribiendo…';
    const d = await api('/api/property_ai', { slug: p.slug });
    if (d.descripcion) document.getElementById('f-descripcion').value = d.descripcion;
    btn.disabled = false;
    btn.innerHTML = `${icon('spark')} Generar descripción AI`;
  });
})();
