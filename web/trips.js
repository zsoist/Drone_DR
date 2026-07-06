// Viajes — selector de nivel por CIUDAD (estilo videojuego): tarjetas con portada,
// mini-mapa satelital y stats; dentro, el diario por fechas. Postal descargable.
const main = renderShell('trips.html');

// ciudades conocidas (lat, lon) — el cluster más cercano <30 km toma el nombre
const CITIES = [
  ['Bogotá', 4.711, -74.072], ['Medellín', 6.244, -75.581], ['Cali', 3.452, -76.532],
  ['Cartagena', 10.391, -75.479], ['Barranquilla', 10.964, -74.797], ['Santa Marta', 11.241, -74.199],
  ['Bucaramanga', 7.119, -73.123], ['Pereira', 4.813, -75.696], ['Manizales', 5.070, -75.518],
  ['Armenia', 4.535, -75.676], ['Ibagué', 4.439, -75.232], ['Villavicencio', 4.142, -73.627],
  ['Tunja', 5.535, -73.368], ['Popayán', 2.444, -76.615], ['Neiva', 2.928, -75.288],
  ['Girardot', 4.303, -74.804], ['Melgar', 4.204, -74.641], ['La Mesa', 4.631, -74.463],
  ['Villeta', 5.013, -74.472], ['Anapoima', 4.548, -74.536], ['Fusagasugá', 4.337, -74.364],
  ['Honda', 5.209, -74.737], ['Mariquita', 5.199, -74.893], ['La Vega', 4.999, -74.339],
];
const R0 = Math.PI / 180;
const havKm = (a, b, c, d) => 12742 * Math.asin(Math.sqrt(
  Math.sin((c - a) * R0 / 2) ** 2 + Math.cos(a * R0) * Math.cos(c * R0) * Math.sin((d - b) * R0 / 2) ** 2));

main.innerHTML = `
  <div class="page-head"><h1>Viajes</h1><span class="count" id="count"></span></div>
  <div class="statgrid" id="t-stats">${'<div class="sk" style="height:74px"></div>'.repeat(4)}</div>
  <div id="cities" class="city-grid">${'<div class="sk" style="height:210px;border-radius:14px"></div>'.repeat(3)}</div>
  <div id="detail" style="display:none"></div>`;

(async () => {
  const flights = (await getFlights()).filter(f => !f.archived);
  const ai = await getAIAll(flights);
  let diaries = {};
  try {
    const r = await fetch(`${DATA}/ai/trips.json`);
    if (r.ok) diaries = await r.json();
  } catch {}

  // ---------- clusters de ciudad (~30 km) ----------
  const clusters = [];
  flights.forEach(f => {
    const h = f.stats?.home;
    if (!Array.isArray(h) || h.length < 2) return;   // home malformado no debe tumbar el cluster (#19)
    let c = clusters.find(x => havKm(x.lat, x.lon, h[1], h[0]) < 30);
    if (!c) {
      c = { lat: h[1], lon: h[0], flights: [] };
      clusters.push(c);
    }
    c.flights.push(f);
  });
  clusters.forEach(c => {
    const saved = localStorage.getItem(`ab.city.${c.lat.toFixed(2)},${c.lon.toFixed(2)}`);
    const near = CITIES.map(([n, la, lo]) => [n, havKm(c.lat, c.lon, la, lo)]).sort((a, b) => a[1] - b[1])[0];
    c.key = `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
    c.name = saved || (near && near[1] < 30 ? near[0] : `Zona ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`);
    c.dates = [...new Set(c.flights.map(f => f.date))].sort();
    c.dist = c.flights.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
    c.dur = c.flights.reduce((a, f) => a + f.duration_s, 0);
    c.alt = Math.max(0, ...c.flights.map(f => f.stats.max_rel_alt_m || 0));
    c.best = [...c.flights].sort((a, b) => (ai[b.clip_id]?.travel_score || 0) - (ai[a.clip_id]?.travel_score || 0))[0];
    c.score = ai[c.best?.clip_id]?.travel_score || 0;
  });
  clusters.sort((a, b) => b.flights.length - a.flights.length);

  const days = new Set(flights.map(f => f.date)).size;
  document.getElementById('count').textContent = `${clusters.length} ${clusters.length === 1 ? 'lugar' : 'lugares'} · ${days} días`;
  document.getElementById('t-stats').innerHTML = `
    <div class="stat rise"><div class="lb">${icon('pin')} Lugares</div><div class="v">${clusters.length}</div><div class="sub">explorados desde el aire</div></div>
    <div class="stat rise"><div class="lb">${icon('cal')} Días</div><div class="v">${days}</div><div class="sub">de vuelo registrados</div></div>
    <div class="stat rise"><div class="lb">${icon('drone')} Vuelos</div><div class="v">${flights.length}</div><div class="sub">en el diario</div></div>
    <div class="stat rise"><div class="lb">${icon('route')} Distancia</div><div class="v">${fmt.km(flights.reduce((a, f) => a + (f.stats.distance_m || 0), 0))}</div><div class="sub">recorrida en total</div></div>`;

  // tile satelital estático del centro del cluster (z12) — mini-mapa gratis
  const tileURL = c => {
    const z = 12, lat = c.lat * R0;
    const x = Math.floor((c.lon + 180) / 360 * 2 ** z);
    const y = Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * 2 ** z);
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  };

  // ---------- vista 1: selector de ciudades ----------
  function renderCities() {
    const el = document.getElementById('cities');
    el.style.display = '';
    document.getElementById('detail').style.display = 'none';
    el.innerHTML = clusters.map((c, i) => `
      <div class="city-card" data-city="${esc(c.key)}" style="animation-delay:${i * 70}ms">
        <div class="cc-cover">
          <img src="${DATA}/thumbs/${esc(c.best?.clip_id || '')}.jpg" loading="lazy" alt="">
          <img class="cc-tile" src="${tileURL(c)}" loading="lazy" alt="" data-tip="Vista satelital de la zona">
          <div class="cc-shade"></div>
          <h2>${esc(c.name)}</h2>
          <span class="cc-range mono">${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates[c.dates.length - 1]) : ''}</span>
          ${c.score ? `<span class="cc-score" data-tip="Mejor score AI del lugar">${c.score}/10</span>` : ''}
        </div>
        <div class="cc-stats">
          <span data-tip="Vuelos en este lugar">${icon('drone')} ${c.flights.length}</span>
          <span data-tip="Días distintos">${icon('cal')} ${c.dates.length}</span>
          <span data-tip="Tiempo total en el aire">${icon('clock')} ${fmt.hours(c.dur)}</span>
          <span data-tip="Distancia total volada">${icon('route')} ${fmt.km(c.dist)}</span>
          <span data-tip="Altura máxima alcanzada">${icon('mountain')} ${Math.round(c.alt)} m</span>
          <span class="spacer" style="flex:1"></span>
          <button class="btn" data-postal="${esc(c.key)}" data-tip="Genera una postal PNG del lugar">${icon('dl')}</button>
          <button class="btn" data-rename-city="${esc(c.key)}" data-tip="Renombrar este lugar">${icon('tag')}</button>
        </div>
      </div>`).join('') ||
      `<div class="empty">${icon('pin')}<p>Sin vuelos con GPS todavía.</p></div>`;
  }

  // ---------- vista 2: detalle de ciudad (días adentro) ----------
  const dstate = { q: '', has: new Set(), scene: null };
  function renderDetail(c) {
    const el = document.getElementById('detail');
    document.getElementById('cities').style.display = 'none';
    el.style.display = '';
    const list = c.flights.filter(f => {
      if (dstate.has.has('video') && !f.has_proxy) return false;
      if (dstate.has.has('ai') && !ai[f.clip_id]) return false;
      if (dstate.has.has('top') && (ai[f.clip_id]?.travel_score || 0) < 6) return false;
      if (dstate.scene && ai[f.clip_id]?.scene_type !== dstate.scene) return false;
      const hay = `${f.label || ''} ${f.date} ${ai[f.clip_id]?.summary || ''}`.toLowerCase();
      return !dstate.q || hay.includes(dstate.q);
    });
    const scenes = [...new Set(c.flights.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
    const byDay = {};
    list.forEach(f => (byDay[f.date] = byDay[f.date] || []).push(f));
    const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
    el.innerHTML = `
      <div class="hero glass rise" style="margin-bottom:14px">
        <button class="btn hero-back" id="city-back" data-tip="Volver a los lugares">${icon('chevL')}</button>
        <div class="hero-t"><h1>${esc(c.name)}</h1>
          <div class="hero-sub mono">${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates[c.dates.length - 1]) : ''}</div></div>
        <div class="hero-chips">
          <span class="gchip" data-tip="Vuelos filtrados / totales">${list.length}/${c.flights.length} vuelos</span>
          <span class="gchip" data-tip="Tiempo total en el aire">${fmt.hours(c.dur)}</span>
          ${c.score ? `<span class="gchip mint" data-tip="Mejor score AI">${c.score}/10</span>` : ''}
        </div>
        <div class="hero-actions">
          <a class="btn" href="index.html?v=map" data-tip="Ver las rutas en el mapa">${icon('map')} Mapa</a>
          <button class="btn primary" data-postal="${esc(c.key)}">${icon('dl')} Postal</button>
        </div>
      </div>
      <div class="glass tbcard rise" style="animation-delay:60ms">
        <div class="tb-row">
          <label class="search" style="max-width:280px">${icon('search')}<input id="d-q" placeholder="Buscar en ${esc(c.name)}…" value="${esc(dstate.q)}"></label>
          <button class="chip ${dstate.has.has('video') ? 'on' : ''}" data-df="video">${icon('play')} Video</button>
          <button class="chip ${dstate.has.has('ai') ? 'on' : ''}" data-df="ai">${icon('spark')} AI</button>
          <button class="chip ${dstate.has.has('top') ? 'on' : ''}" data-df="top">${icon('spark')} Score 6+</button>
          <span class="spacer" style="flex:1"></span>
          ${scenes.map(sc => `<button class="chip ${dstate.scene === sc ? 'on' : ''}" data-dscene="${esc(sc)}">${esc(sc)}</button>`).join('')}
        </div>
      </div>
      ${days.map(([date, dl], di) => {
        const dist = dl.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
        const dur = dl.reduce((a, f) => a + f.duration_s, 0);
        const diary = diaries[date];
        return `
        <section class="trip rise" style="animation-delay:${100 + di * 60}ms">
          <div class="trip-head">
            <h2>${fmt.date(date)}</h2>
            <span class="mono">${dl.length} vuelos · ${fmt.km(dist)} · ${fmt.hours(dur)}</span>
          </div>
          ${diary ? `<div class="summary">${esc(diary)}</div>` : ''}
          <div class="grid">${dl.map(f => `
            <a class="card scrub" href="flight.html?id=${f.clip_id}" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
              <div class="thumb">
                <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
                <span class="tierdot ${f.tier}"><i></i>${f.tier}</span>
                <span class="ovl mono">${icon('clock')} ${fmt.dur(f.duration_s)}</span>
                <span class="scrub-line"></span>
              </div>
              <div class="body">
                <div class="t"><span>${esc(f.label || f.time || "")}</span></div>
                <div class="metrics">
                  <span>${icon('route')}<b>${fmt.km(f.stats.distance_m || 0)}</b></span>
                  <span>${icon('mountain')}<b>${Math.round(f.stats.max_rel_alt_m || 0)} m</b></span>
                </div>
                ${ai[f.clip_id]?.summary ? `<p class="ai-line">${esc(ai[f.clip_id].summary)}</p>` : ''}
              </div>
            </a>`).join('')}
          </div>
        </section>`;
      }).join('') || '<div class="empty">' + icon('search') + '<p>Nada con esos filtros.</p></div>'}`;
    el.querySelector('#city-back').addEventListener('click', () => {
      el.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(24px)' }],
                 { duration: 180, easing: 'ease-in' }).finished.then(() => {
        Object.assign(dstate, { q: '', scene: null });
        dstate.has.clear();
        renderCities();
        const cg = document.getElementById('cities');
        cg.animate([{ opacity: 0, transform: 'translateX(-18px)' }, { opacity: 1, transform: 'translateX(0)' }],
                   { duration: 220, easing: 'ease-out' });
      });
    });
    el.querySelector('#d-q').addEventListener('input', e => {
      dstate.q = e.target.value.toLowerCase();
      clearTimeout(dstate._t);
      dstate._t = setTimeout(() => { renderDetail(c); el.querySelector('#d-q').focus(); }, 220);
    });
    el.querySelectorAll('[data-df]').forEach(b => b.addEventListener('click', () => {
      dstate.has.has(b.dataset.df) ? dstate.has.delete(b.dataset.df) : dstate.has.add(b.dataset.df);
      renderDetail(c);
    }));
    el.querySelectorAll('[data-dscene]').forEach(b => b.addEventListener('click', () => {
      dstate.scene = dstate.scene === b.dataset.dscene ? null : b.dataset.dscene;
      renderDetail(c);
    }));
    attachScrub(el);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- postal descargable (canvas: portada + nombre + stats) ----------
  async function makePostal(c, btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '…';
    try {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = `${DATA}/thumbs/${c.best.clip_id}.jpg`; });
      const cv = document.createElement('canvas');
      cv.width = 1080;
      cv.height = 1350;                                       // 4:5 para redes
      const x = cv.getContext('2d');
      const sc = Math.max(cv.width / img.width, cv.height / img.height);
      x.drawImage(img, (cv.width - img.width * sc) / 2, (cv.height - img.height * sc) / 2,
                  img.width * sc, img.height * sc);
      const g = x.createLinearGradient(0, cv.height * 0.45, 0, cv.height);
      g.addColorStop(0, 'rgba(6,9,14,0)');
      g.addColorStop(1, 'rgba(6,9,14,0.92)');
      x.fillStyle = g;
      x.fillRect(0, 0, cv.width, cv.height);
      x.fillStyle = '#fff';
      x.font = '700 84px -apple-system, sans-serif';
      x.fillText(c.name, 60, cv.height - 180);
      x.fillStyle = 'rgba(255,255,255,0.75)';
      x.font = '400 34px ui-monospace, monospace';
      x.fillText(`${c.flights.length} vuelos · ${fmt.km(c.dist)} · alt máx ${Math.round(c.alt)} m`, 62, cv.height - 118);
      x.fillText(`${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates[c.dates.length - 1]) : ''} · AeroBrain`, 62, cv.height - 66);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
      const file = new File([blob], `${c.name.replace(/\W+/g, '_')}_postal.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
    } catch { alert('No se pudo generar la postal.'); }
    btn.innerHTML = orig;
  }

  // ---------- interacciones ----------
  main.addEventListener('click', e => {
    const pb = e.target.closest('[data-postal]');
    if (pb) { e.stopPropagation(); makePostal(clusters.find(x => x.key === pb.dataset.postal), pb); return; }
    const rb = e.target.closest('[data-rename-city]');
    if (rb) {
      e.stopPropagation();
      const c = clusters.find(x => x.key === rb.dataset.renameCity);
      const name = prompt('Nombre de este lugar:', c.name);
      if (name?.trim()) {
        localStorage.setItem(`ab.city.${c.key}`, name.trim());
        c.name = name.trim();
        renderCities();
      }
      return;
    }
    const cc = e.target.closest('[data-city]');
    if (cc) {
      const c = clusters.find(x => x.key === cc.dataset.city);
      cc.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }], { duration: 180 });
      setTimeout(() => renderDetail(c), 120);
    }
  });

  renderCities();
})();
