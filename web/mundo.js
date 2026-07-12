// mundo.js — FLIGHTVERSE /mundo: selección de mundo (P2).
// Cada tarjeta = una escena real con SceneManifestV2. Honestidad del spec:
// VOLAR solo si capabilities.terrain; sin terreno la CTA lleva al Estudio 3D
// (procesar), nunca a una experiencia fingida. Poster = ortofoto real.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaDe = cid => {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(cid || '');
  return m ? `${+m[3]} ${MESES[+m[2] - 1]} ${m[1]}` : '';
};
const dur = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const main = renderShell('mundo.html');

function card(sc) {
  const c = sc.capabilities || {};
  const st = sc.stats || {};
  const w = sc.world || {};
  const flyable = !!c.terrain;
  const chips = [
    c.splat ? `<span class="fv-chip on">◆ splat ${st.splat_cameras || ''} cams</span>` : '<span class="fv-chip">sin splat</span>',
    c.track && st.track_duration_s ? `<span class="fv-chip on">vuelo real ${dur(st.track_duration_s)}</span>` : '',
    w.size_m ? `<span class="fv-chip">${Math.round(w.size_m[0])}×${Math.round(w.size_m[1])} m</span>` : '',
    st.gsd_cm_px ? `<span class="fv-chip">${st.gsd_cm_px} cm/px</span>` : '',
  ].filter(Boolean).join('');
  const cta = flyable
    ? `<a class="fv-cta" href="volar.html?m=${encodeURIComponent(sc.clip_id)}">VOLAR</a>`
    : `<a class="fv-cta ghost" href="tresd.html">Procesar en Estudio 3D</a>`;
  return `
  <article class="fv-card${flyable ? '' : ' off'}" data-cid="${esc(sc.clip_id)}">
    <div class="fv-poster" style="background-image:url('${esc(sc.assets?.poster || '')}')"></div>
    <div class="fv-shade"></div>
    <div class="fv-body">
      <div>
        <div class="fv-name">${esc(sc.name)}</div>
        <div class="fv-date">${fechaDe(sc.clip_id) || esc(sc.clip_id)}</div>
      </div>
      <div class="fv-chips">${chips}</div>
      <div class="fv-actions">${cta}</div>
    </div>
  </article>`;
}

async function boot() {
  main.innerHTML = `<div class="page fv-page">
    <header class="fv-hero">
      <div class="fv-kicker">FLIGHTVERSE</div>
      <h1>Mundo</h1>
      <p class="fv-sub">Vuela tus propios mapas — cada escena es un lugar real, reconstruido desde tus vuelos.</p>
      <div class="fv-statbar" id="fv-stats"></div>
      <div class="fv-viewtoggle">
        <button class="on" data-fvv="cards">Tarjetas</button>
        <button data-fvv="map">Mapa</button>
      </div>
    </header>
    <div class="fv-grid" id="fv-grid"><div class="fv-loading">Cargando escenas…</div></div>
    <div class="fv-map" id="fv-map" hidden></div>
  </div>`;
  const grid = document.getElementById('fv-grid');
  let sys;
  try {
    sys = await (await fetch('data/manifest/system.json')).json();
  } catch {
    grid.innerHTML = '<div class="fv-loading">No se pudo leer el manifiesto del sistema.</div>';
    return;
  }
  const models = sys.models || [];
  const settled = await Promise.allSettled(models.map(m =>
    fetch(`data/models/${m.clip_id}/scene.v2.json`).then(r => (r.ok ? r.json() : null))));
  const scenes = settled.map(s => (s.status === 'fulfilled' ? s.value : null)).filter(Boolean);
  if (!scenes.length) {
    grid.innerHTML = '<div class="fv-loading">Aún no hay escenas publicadas — procesa un vuelo en el Estudio 3D.</div>';
    return;
  }
  // volables primero; dentro, las que tienen splat (la escena héroe) arriba
  scenes.sort((a, b) =>
    ((b.capabilities?.terrain | 0) - (a.capabilities?.terrain | 0))
    || ((b.capabilities?.splat | 0) - (a.capabilities?.splat | 0))
    || String(b.clip_id).localeCompare(String(a.clip_id)));

  const nFly = scenes.filter(s => s.capabilities?.terrain).length;
  const nSplat = scenes.filter(s => s.capabilities?.splat).length;
  const secs = scenes.reduce((t, s) => t + (s.stats?.track_duration_s || 0), 0);
  document.getElementById('fv-stats').innerHTML =
    `<span><b>${nFly}</b> escenas volables</span>` +
    `<span><b>${nSplat}</b> con splat foto-realista</span>` +
    (secs ? `<span><b>${dur(secs)}</b> de vuelo real capturado</span>` : '');

  grid.innerHTML = scenes.map(card).join('');

  // vista mapa: MapLibre satelital con pin por escena (flyTo + VOLAR)
  let map = null;
  const SAT = { version: 8, sources: { sat: { type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256, attribution: 'Esri' } }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] };
  function showMap() {
    const el = document.getElementById('fv-map');
    el.hidden = false; grid.hidden = true;
    if (map) { map.resize(); return; }
    map = new maplibregl.Map({ container: el, style: SAT, center: [-74.06, 4.75], zoom: 11, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const bounds = new maplibregl.LngLatBounds();
    for (const sc of scenes) {
      const c = sc.world?.center_wgs84;
      if (!c) continue;
      bounds.extend(c);
      const pop = new maplibregl.Popup({ offset: 18, closeButton: false }).setHTML(
        `<div style="font:600 12px ui-monospace,monospace;color:#111">${esc(sc.name)}<br>` +
        `<span style="color:#556">${fechaDe(sc.clip_id)}</span><br>` +
        (sc.capabilities?.terrain
          ? `<a href="volar.html?m=${encodeURIComponent(sc.clip_id)}" style="display:inline-block;margin-top:6px;padding:6px 12px;border-radius:6px;background:#2b7fd4;color:#fff;text-decoration:none;font-weight:700">VOLAR</a>`
          : 'en preparación') + '</div>');
      const dot = document.createElement('div');
      dot.className = 'fv-pin' + (sc.capabilities?.splat ? ' splat' : '');
      new maplibregl.Marker({ element: dot }).setLngLat(c).setPopup(pop).addTo(map);
      dot.addEventListener('click', () => map.flyTo({ center: c, zoom: 15.5, speed: 1.4 }));
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 14 });
  }
  document.querySelector('.fv-viewtoggle').addEventListener('click', e => {
    const b = e.target.closest('[data-fvv]');
    if (!b) return;
    document.querySelectorAll('.fv-viewtoggle button').forEach(x => x.classList.toggle('on', x === b));
    if (b.dataset.fvv === 'map') showMap();
    else { document.getElementById('fv-map').hidden = true; grid.hidden = false; }
  });
}

boot().catch(e => {
  main.insertAdjacentHTML('beforeend', `<div class="fv-loading">Error: ${esc(e.message)}</div>`);
});
