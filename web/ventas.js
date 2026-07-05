// Ventas: crea páginas de propiedad aisladas (p.html?id=slug) con link + QR.
const main = renderShell('studio.html');
const F = [
  ['slug', 'URL corta (ej: casa-cajica)'], ['titulo', 'Título (ej: Casa campestre en Cajicá)'],
  ['precio', 'Precio (ej: $850.000.000 COP)'], ['ubicacion', 'Ubicación (ej: Cajicá, Cundinamarca)'],
  ['area', 'Área m²'], ['habitaciones', 'Habitaciones'], ['banos', 'Baños'],
  ['parqueaderos', 'Parqueaderos'], ['estrato', 'Estrato'],
  ['whatsapp', 'WhatsApp (57300…)'], ['telefono', 'Teléfono'],
];
main.innerHTML = `
  <div class="page-head"><h1>Ventas</h1><span class="count">páginas de propiedad con link + QR</span></div>
  <div class="fl-layout">
    <div>
      <div class="panel">
        <div class="ph">${icon('pin')} Datos de la propiedad</div>
        <div class="pb">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${F.map(([k, ph]) => `<input class="ctl" id="f-${k}" placeholder="${ph}"
              style="${['slug', 'titulo', 'ubicacion'].includes(k) ? 'grid-column:1/-1' : ''}">`).join('')}
            <select class="ctl" id="f-clip" style="grid-column:1/-1"></select>
            <select class="ctl" id="f-video" style="grid-column:1/-1"></select>
          </div>
          <textarea class="ctl" id="f-descripcion" rows="6" placeholder="Descripción de venta (o genera con AI)"
            style="width:100%;margin-top:10px;resize:vertical;font-family:var(--font)"></textarea>
          <div class="toolbar" style="margin-top:12px">
            <button class="btn" id="btn-ai">${icon('spark')} Generar descripción AI</button>
            <span class="spacer"></span>
            <button class="btn primary" id="btn-save">${icon('check')} Guardar y publicar</button>
          </div>
          <div id="result" style="margin-top:12px"></div>
        </div>
      </div>
    </div>
    <div>
      <div class="panel">
        <div class="ph">${icon('layers')} Propiedades publicadas</div>
        <div class="pb" id="plist"><div class="sk" style="height:60px"></div></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="ph">${icon('check')} Cómo funciona</div>
        <div class="pb"><table class="kv">
          <tr><td>1. Video</td><td>vuela la propiedad o sube el recorrido</td></tr>
          <tr><td>2. Datos</td><td>llena el formulario, AI escribe la venta</td></tr>
          <tr><td>3. Publica</td><td>obtienes link aislado + QR</td></tr>
          <tr><td>4. Comparte</td><td>WhatsApp, valla con QR, portales</td></tr>
        </table>
        <p class="footer-note">La página del comprador es independiente de tu archivo:
        solo ve esa propiedad, con video, mapa, galería y botón de WhatsApp.</p></div>
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
    `<option value="">Clip para galería/poster (opcional)</option>` +
    clips.map(f => `<option value="${f.clip_id}">${fmt.date(f.date)} ${f.time} — ${f.clip_id.startsWith('UP_') ? 'subido' : 'dron'}</option>`).join('');
  let sys = { reels: [] };
  try { sys = await (await fetch(`${DATA}/manifest/system.json`)).json(); } catch {}
  document.getElementById('f-video').innerHTML =
    `<option value="">Video hero (proxy o reel)</option>` +
    flights.filter(f => f.has_proxy).map(f => `<option value="${f.clip_id}">Video: ${fmt.date(f.date)} ${f.time}</option>`).join('') +
    (sys.reels || []).map(r => `<option value="${r.name}">Reel: ${r.name}</option>`).join('');

  async function loadList() {
    const { properties } = await (await fetch('/api/properties')).json();
    document.getElementById('plist').innerHTML = properties.length ? properties.map(p => `
      <div class="hl-item">
        <a class="tc" href="p.html?id=${p.slug}" target="_blank">${esc(p.slug)}</a>
        <p>${esc(p.titulo)} · ${esc(p.precio) || 's/p'} <span class="mono" style="color:var(--text-3)">${p.updated}</span></p>
        <button class="btn" data-edit="${p.slug}" style="padding:3px 9px;font-size:11px">Editar</button>
      </div>`).join('') :
      `<p class="footer-note">Aún no hay propiedades publicadas.</p>`;
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
    if (!p.slug || !p.titulo) return alert('Slug y título son obligatorios.');
    const { url } = await api('/api/property', p);
    const localUrl = `p.html?id=${p.slug}`;
    document.getElementById('result').innerHTML = `
      <div class="panel"><div class="pb" style="text-align:center">
        <p style="font-size:13px;margin-bottom:8px">Publicada — comparte este link:</p>
        <a class="mono" href="${localUrl}" target="_blank" style="color:var(--accent);font-size:13px">${url}</a>
        <div style="margin-top:12px"><img alt="QR" width="160" height="160" style="border-radius:8px;background:#fff;padding:8px"
          src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}"></div>
        <button class="btn" style="margin-top:10px" data-copy="${url}">Copiar link</button>
      </div></div>`;
    loadList();
  });

  document.getElementById('btn-ai').addEventListener('click', async () => {
    const token = getToken();
    if (!token) return;
    const p = collect();
    if (!p.slug) return alert('Guarda primero (necesita slug).');
    await api('/api/property', p);
    const btn = document.getElementById('btn-ai');
    btn.textContent = 'DeepSeek escribiendo…';
    const d = await api('/api/property_ai', { slug: p.slug });
    if (d.descripcion) document.getElementById('f-descripcion').value = d.descripcion;
    btn.innerHTML = `${icon('spark')} Generar descripción AI`;
  });
})();
