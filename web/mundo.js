// mundo.js — FLIGHTVERSE /mundo: WORLD SELECT estilo videojuego (Mario Kart
// world map). Islas dinámicas en carrusel snap, selección → panel de misión
// (Libre/Gate Rush/Cinemático = deep-links reales a /volar), récords locales,
// transición de carga de consola. 60fps: solo transform/opacity.
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fechaDe = cid => { const m = /(\d{4})(\d{2})(\d{2})/.exec(cid||''); return m ? `${+m[3]} ${MESES[+m[2]-1]} ${m[1]}` : ''; };
const dur = s => { s = Math.round(s||0); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
const esc = s => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const best = cid => { const t = parseFloat(localStorage.getItem(`ab.fv.best.${cid}.gaterush`)); return Number.isFinite(t) ? t : null; };

const main = renderShell('mundo.html');
let scenes = [], sel = null;

function isla(sc, i) {
  const c = sc.capabilities||{}, st = sc.stats||{};
  const rec = best(sc.clip_id);
  return `
  <article class="wi ${c.terrain?'':'off'}" data-i="${i}" style="--d:${i*70}ms">
    <div class="wi-poster" style="background-image:url('${esc(sc.assets?.poster||'')}')"></div>
    <div class="wi-shine"></div>
    <div class="wi-shade"></div>
    ${c.splat?'<span class="wi-badge">◆ FOTO-REAL</span>':''}
    ${rec!=null?`<span class="wi-rec">🏆 ${rec.toFixed(1)}s</span>`:''}
    <div class="wi-body">
      <div class="wi-name">${esc(sc.name)}</div>
      <div class="wi-meta">${fechaDe(sc.clip_id)||''}${st.track_duration_s?` · vuelo ${dur(st.track_duration_s)}`:''}</div>
    </div>
  </article>`;
}

function pick(i) {
  sel = scenes[i];
  document.querySelectorAll('.wi').forEach((el,j)=>el.classList.toggle('sel', j===i));
  const c = sel.capabilities||{}, st = sel.stats||{}, w = sel.world||{};
  const rec = best(sel.clip_id);
  const go = (extra='') => `volar.html?m=${encodeURIComponent(sel.clip_id)}${extra}`;
  const p = document.getElementById('w-panel');
  p.innerHTML = c.terrain ? `
    <div class="wp-in">
      <div>
        <div class="wp-name">${esc(sel.name)}</div>
        <div class="wp-chips">
          ${c.splat?`<span class="fv-chip on">◆ splat ${st.splat_cameras||''} cams</span>`:''}
          ${w.size_m?`<span class="fv-chip">${Math.round(w.size_m[0])}×${Math.round(w.size_m[1])} m</span>`:''}
          ${st.gsd_cm_px?`<span class="fv-chip">${st.gsd_cm_px} cm/px</span>`:''}
          ${rec!=null?`<span class="fv-chip on">🏆 récord ${rec.toFixed(2)}s</span>`:''}
        </div>
      </div>
      <div class="wp-missions">
        <button class="wp-m" data-go="${go()}"><b>✈ Vuelo libre</b><span>explora sin límites</span></button>
        <button class="wp-m hot" data-go="${go('&reto=1')}"><b>🏁 Gate Rush</b><span>${rec!=null?`bate tu ${rec.toFixed(1)}s`:'contra tu ruta real'}</span></button>
        <button class="wp-m" data-go="${go('&modo=cinematico')}"><b>🎬 Cinemático</b><span>tour orbital</span></button>
      </div>
    </div>` : `<div class="wp-in"><div class="wp-name">${esc(sel.name)}</div>
      <a class="fv-cta ghost" href="tresd.html" style="max-width:280px">Procesar en Estudio 3D</a></div>`;
  p.classList.add('show');
}

function launch(url, poster) {
  const ov = document.getElementById('w-launch');
  ov.querySelector('.wl-bg').style.backgroundImage = `url('${poster}')`;
  ov.classList.add('go');
  setTimeout(() => { location.href = url; }, 520);
}

async function boot() {
  main.innerHTML = `<div class="page fv-page">
    <header class="fv-hero">
      <div class="fv-kicker">FLIGHTVERSE</div>
      <h1>Mundo</h1>
      <p class="fv-sub">Elige tu isla — lugares reales reconstruidos desde tus vuelos.</p>
      <div class="fv-statbar" id="fv-stats"></div>
      <div class="fv-viewtoggle">
        <button class="on" data-fvv="cards">Islas</button>
        <button data-fvv="map">Mapa</button>
      </div>
    </header>
    <div id="w-cards">
      <div class="w-rail" id="w-rail"><div class="fv-loading">Cargando mundo…</div></div>
      <div class="w-panel" id="w-panel"></div>
    </div>
    <div class="fv-map" id="fv-map" hidden></div>
    <div class="w-launch" id="w-launch"><div class="wl-bg"></div><div class="wl-txt">CARGANDO ESCENA<span class="wl-bar"></span></div></div>
  </div>`;
  let sys;
  try { sys = await (await fetch('data/manifest/system.json')).json(); }
  catch { document.getElementById('w-rail').innerHTML = '<div class="fv-loading">Sin manifiesto.</div>'; return; }
  const settled = await Promise.allSettled((sys.models||[]).map(m =>
    fetch(`data/models/${m.clip_id}/scene.v2.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)));
  scenes = settled.map(s => s.status==='fulfilled'?s.value:null).filter(Boolean);
  scenes.sort((a,b) => ((b.capabilities?.terrain|0)-(a.capabilities?.terrain|0))
    || ((b.capabilities?.splat|0)-(a.capabilities?.splat|0))
    || String(b.clip_id).localeCompare(String(a.clip_id)));

  const nFly = scenes.filter(s=>s.capabilities?.terrain).length;
  const nSp = scenes.filter(s=>s.capabilities?.splat).length;
  const secs = scenes.reduce((t,s)=>t+(s.stats?.track_duration_s||0),0);
  document.getElementById('fv-stats').innerHTML =
    `<span><b>${nFly}</b> islas volables</span><span><b>${nSp}</b> foto-realistas</span>`+
    (secs?`<span><b>${dur(secs)}</b> de vuelo real</span>`:'');

  const rail = document.getElementById('w-rail');
  rail.innerHTML = scenes.map(isla).join('');
  rail.addEventListener('click', e => {
    const el = e.target.closest('.wi'); if (!el) return;
    pick(+el.dataset.i);
    el.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
  });
  document.getElementById('w-panel').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    launch(b.dataset.go, sel?.assets?.poster || '');
  });
  // tilt 3D solo con puntero fino
  if (matchMedia('(pointer:fine)').matches) rail.addEventListener('mousemove', e => {
    const el = e.target.closest('.wi'); if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.transform = `perspective(700px) rotateY(${((e.clientX-r.left)/r.width-.5)*7}deg) rotateX(${(.5-(e.clientY-r.top)/r.height)*5}deg)`;
  }), rail.addEventListener('mouseout', e => { const el = e.target.closest('.wi'); if (el) el.style.transform=''; });
  pick(0);

  // ── mapa (igual que antes) ──
  let map = null;
  const SAT = { version:8, sources:{ sat:{ type:'raster',
    tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize:256, attribution:'Esri' } }, layers:[{ id:'sat', type:'raster', source:'sat' }] };
  function showMap() {
    const el = document.getElementById('fv-map');
    el.hidden = false; document.getElementById('w-cards').style.display = 'none';
    if (map) { map.resize(); return; }
    map = new maplibregl.Map({ container: el, style: SAT, center: [-74.06,4.75], zoom: 11, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'top-right');
    const bounds = new maplibregl.LngLatBounds();
    for (const sc of scenes) {
      const c = sc.world?.center_wgs84; if (!c) continue;
      bounds.extend(c);
      const pop = new maplibregl.Popup({ offset:18, closeButton:false }).setHTML(
        `<div style="font:600 12px ui-monospace,monospace;color:#111">${esc(sc.name)}<br>`+
        (sc.capabilities?.terrain ? `<a href="volar.html?m=${encodeURIComponent(sc.clip_id)}" style="display:inline-block;margin-top:6px;padding:6px 12px;border-radius:6px;background:#2b7fd4;color:#fff;text-decoration:none;font-weight:700">VOLAR</a>` : 'en preparación')+'</div>');
      const dot = document.createElement('div');
      dot.className = 'fv-pin' + (sc.capabilities?.splat ? ' splat' : '');
      new maplibregl.Marker({ element: dot }).setLngLat(c).setPopup(pop).addTo(map);
      dot.addEventListener('click', () => map.flyTo({ center: c, zoom: 15.5, speed: 1.4 }));
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 14 });
  }
  document.querySelector('.fv-viewtoggle').addEventListener('click', e => {
    const b = e.target.closest('[data-fvv]'); if (!b) return;
    document.querySelectorAll('.fv-viewtoggle button').forEach(x => x.classList.toggle('on', x===b));
    if (b.dataset.fvv === 'map') showMap();
    else { document.getElementById('fv-map').hidden = true; document.getElementById('w-cards').style.display = ''; }
  });
}
boot().catch(e => main.insertAdjacentHTML('beforeend', `<div class="fv-loading">Error: ${esc(e.message)}</div>`));
