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

// iconos locales (icons.js no trae "más" ni "filtros"); mismo grid de 20px y trazo
const MORE_ICON = '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10h.01M10 10h.01M15.5 10h.01"/></svg>';
const shortTitle = text => {                                // igual que Vuelos: arranque del resumen AI sin la muletilla
  let t = String(text || '').trim();
  t = t.replace(/^(el|la|este|esta)\s+(vuelo|dron|drone|clip|video|metraje|material)(\s+\S+)??\s+(inicia|comienza|muestra|captura|realiza|presenta|sobrevuela|ofrece|documenta|registra|recorre|revela)(\s+(con|sobre|en))?\s+/i, '');
  t = t.replace(/^(un|una|unos|unas)\s+/i, '').split(/[,.;:]| y | para | mientras | luego | donde /i)[0].trim();
  if (t.length > 64) t = t.slice(0, 64).replace(/\s+\S*$/, '') + '…';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

main.classList.add('tr-page');
main.innerHTML = `
  <div class="page-head"><h1>Viajes</h1><span class="count" id="count" aria-live="polite"></span></div>
  <div class="statgrid" id="t-stats">${'<div class="sk tr-sk-stat"></div>'.repeat(4)}</div>
  <div id="cities" class="city-grid">${'<div class="sk tr-sk-city"></div>'.repeat(3)}</div>
  <div id="detail" hidden></div>`;

(async () => {
  const flights = (await getFlights()).filter(f => !f.archived);
  const ai = await getAIAll(flights);
  let diaries = {};
  try {
    const r = await fetch(`${DATA}/ai/trips.json`);
    if (r.ok) diaries = await r.json();
  } catch {}
  // meta por lugar (nombre + carátula) — server-side: sincroniza entre dispositivos
  let tripsMeta = {};
  try {
    const r = await fetch(`${DATA}/manifest/trips_meta.json`);
    if (r.ok) tripsMeta = await r.json();
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
  clusters.forEach(c => { c.key = `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`; });
  // la clave sale del despegue del primer vuelo (el más nuevo): un vuelo nuevo desde otro punto la cambia
  // y perdería nombre/carátula. Si no hay meta para la clave, adoptar la más cercana (<30 km) no usada
  // por otro cluster y migrarla a la clave nueva.
  const usedMetaKeys = new Set(clusters.map(c => c.key).filter(k => tripsMeta[k]));
  clusters.forEach(c => {
    if (tripsMeta[c.key]) return;
    let best = null, bestD = 30;
    for (const k of Object.keys(tripsMeta)) {
      if (usedMetaKeys.has(k)) continue;
      const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(k);
      if (!m) continue;
      const d = havKm(c.lat, c.lon, +m[1], +m[2]);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (!best) return;
    usedMetaKeys.add(best);
    // el server mueve + borra la clave vieja de forma atómica (ya no se copia y se deja huérfana)
    tripsMeta[c.key] = { ...(tripsMeta[best] || {}) };
    delete tripsMeta[best];
    api('/api/trip_meta', { key: c.key, migrate_from: best }).catch(() => {});
  });
  clusters.forEach(c => {
    const srv = tripsMeta[c.key] || {};
    const saved = localStorage.getItem(`ab.city.${c.key}`);
    const near = CITIES.map(([n, la, lo]) => [n, havKm(c.lat, c.lon, la, lo)]).sort((a, b) => a[1] - b[1])[0];
    // prioridad: server > localStorage (legado; se migra al server al abrir) > ciudad conocida > Zona
    c.name = srv.name || saved || (near && near[1] < 30 ? near[0] : `Zona ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`);
    if (!srv.name && saved) api('/api/trip_meta', { key: c.key, name: saved }).catch(() => {});
    c.dates = [...new Set(c.flights.map(f => f.date))].sort();
    c.dist = c.flights.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
    c.dur = c.flights.reduce((a, f) => a + (f.duration_s || 0), 0);   // duration_s ausente → 0, no NaN
    c.alt = Math.max(0, ...c.flights.map(f => f.stats.max_rel_alt_m || 0));
    c.best = [...c.flights].sort((a, b) => (ai[b.clip_id]?.travel_score || 0) - (ai[a.clip_id]?.travel_score || 0))[0];
    // carátula: elección manual (si el clip sigue en el cluster) gana sobre la mejor por AI
    c.cover = c.flights.find(f => f.clip_id === srv.cover) || c.best;
    c.score = ai[c.best?.clip_id]?.travel_score || 0;
  });
  clusters.sort((a, b) => b.flights.length - a.flights.length);

  const days = new Set(flights.map(f => f.date)).size;
  document.getElementById('count').textContent = `${clusters.length} ${clusters.length === 1 ? 'lugar' : 'lugares'} · ${days} días`;
  document.getElementById('t-stats').innerHTML = `
    <div class="stat"><div class="lb">${icon('pin')} Lugares</div><div class="v">${clusters.length}</div><div class="sub">explorados desde el aire</div></div>
    <div class="stat"><div class="lb">${icon('cal')} Días</div><div class="v">${days}</div><div class="sub">de vuelo registrados</div></div>
    <div class="stat"><div class="lb">${icon('drone')} Vuelos</div><div class="v">${flights.length}</div><div class="sub">en el diario</div></div>
    <div class="stat"><div class="lb">${icon('route')} Distancia</div><div class="v">${fmt.km(flights.reduce((a, f) => a + (f.stats.distance_m || 0), 0))}</div><div class="sub">recorrida en total</div></div>`;

  // ---------- vista 1: selector de ciudades ----------
  let citiesEntered = false;
  function renderCities() {
    const el = document.getElementById('cities');
    el.hidden = false;
    document.getElementById('detail').hidden = true;
    const anim = !citiesEntered && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    citiesEntered = true;
    el.innerHTML = clusters.map((c, i) => `
      <div class="city-card ${anim ? 'cc-in' : ''}" data-city="${esc(c.key)}" role="button" tabindex="0" aria-label="Abrir ${esc(c.name)}" style="--in-delay:${Math.min(i, 4) * 30}ms">
        <div class="cc-cover">
          <img src="${DATA}/thumbs/${esc(c.cover?.clip_id || '')}.jpg" loading="lazy" alt="" width="960" height="540">
          <div class="cc-shade"></div>
          ${c.score ? `<span class="score-pill cc-score" data-tip="Mejor score AI del lugar">${c.score}/10</span>` : ''}
          <div class="cc-cap">
            <h2>${esc(c.name)}</h2>
            <span class="cc-range">${icon('pin')} ${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates[c.dates.length - 1]) : ''}</span>
          </div>
        </div>
        <div class="cc-stats">
          <span data-tip="Vuelos en este lugar">${icon('drone')} ${c.flights.length}<i class="tr-sr"> vuelos</i></span>
          <span data-tip="Días distintos">${icon('cal')} ${c.dates.length}<i class="tr-sr"> días</i></span>
          <span data-tip="Tiempo total en el aire">${icon('clock')} ${fmt.hours(c.dur)}</span>
          <span data-tip="Distancia total volada">${icon('route')} ${fmt.km(c.dist)}</span>
          <span data-tip="Altura máxima alcanzada">${icon('mountain')} ${Math.round(c.alt)} m</span>
          <button class="btn icon sm tr-more" data-city-menu="${esc(c.key)}" aria-haspopup="menu" aria-expanded="false" aria-label="Acciones de ${esc(c.name)}">${MORE_ICON}</button>
        </div>
      </div>`).join('') ||
      `<div class="empty tr-span">${icon('pin')}<p>Sin vuelos con GPS todavía.</p></div>`;
  }

  // ---------- menú de acciones por lugar (un solo popover, roles de menú, teclado) ----------
  let menuEl = null, menuBtn = null;
  function closeMenu(restoreFocus = true) {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    menuBtn?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuBtn?.focus();
    menuBtn = null;
    document.removeEventListener('pointerdown', onMenuOutside, true);
    removeEventListener('scroll', onMenuScroll, true);
    removeEventListener('resize', onMenuScroll);
  }
  const onMenuOutside = e => { if (menuEl && !menuEl.contains(e.target) && !menuBtn?.contains(e.target)) closeMenu(false); };
  const onMenuScroll = () => closeMenu(false);
  function openMenu(btn) {
    if (menuEl) { const same = menuBtn === btn; closeMenu(false); if (same) return; }
    const c = clusters.find(x => x.key === btn.dataset.cityMenu);
    if (!c) return;
    menuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    menuEl = document.createElement('div');
    menuEl.className = 'tr-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.setAttribute('aria-label', `Acciones de ${c.name}`);
    menuEl.innerHTML = `
      <button role="menuitem" data-act="postal">${icon('dl')} Descargar postal</button>
      <button role="menuitem" data-act="cover">${icon('iso')} Elegir portada</button>
      <button role="menuitem" data-act="rename">${icon('tag')} Renombrar</button>`;
    document.body.appendChild(menuEl);
    const r = btn.getBoundingClientRect();
    const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
    const top = r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6;
    menuEl.style.setProperty('--mx', `${left}px`);
    menuEl.style.setProperty('--my', `${Math.max(8, top)}px`);
    menuEl.addEventListener('click', e => {
      const it = e.target.closest('[data-act]');
      if (!it) return;
      e.stopPropagation();
      const act = it.dataset.act, trigger = menuBtn;
      closeMenu(false);
      if (act === 'postal') makePostal(c, trigger);
      else if (act === 'cover') pickCover(c);
      else renameCity(c);
    });
    menuEl.addEventListener('keydown', e => {
      const items = [...menuEl.querySelectorAll('[role=menuitem]')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Tab') closeMenu(false);
    });
    document.addEventListener('pointerdown', onMenuOutside, true);
    addEventListener('scroll', onMenuScroll, true);
    addEventListener('resize', onMenuScroll);
    menuEl.querySelector('[role=menuitem]').focus();
  }

  // ---------- vista 2: detalle de ciudad (días adentro) ----------
  const dstate = { q: '', has: new Set(), scene: null };
  function renderDetail(c, animate = false) {
    const el = document.getElementById('detail');
    document.getElementById('cities').hidden = true;
    el.hidden = false;
    const rise = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'rise' : '';
    const list = c.flights.filter(f => {
      if (dstate.has.has('video') && !f.has_proxy) return false;
      if (dstate.has.has('ai') && !ai[f.clip_id]) return false;
      if (dstate.has.has('top') && (ai[f.clip_id]?.travel_score || 0) < 6) return false;
      if (dstate.scene && ai[f.clip_id]?.scene_type !== dstate.scene) return false;
      const hay = `${f.label || ''} ${f.date} ${ai[f.clip_id]?.summary || ''}`.toLowerCase();
      return !dstate.q || hay.includes(dstate.q.toLowerCase());   // q se guarda crudo; se compara insensible
    });
    const scenes = [...new Set(c.flights.map(f => ai[f.clip_id]?.scene_type).filter(Boolean))];
    const byDay = {};
    list.forEach(f => (byDay[f.date] = byDay[f.date] || []).push(f));
    const days = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
    const range = `${fmt.date(c.dates[0])}${c.dates.length > 1 ? ' — ' + fmt.date(c.dates[c.dates.length - 1]) : ''}`;
    const filterChips = [['video', 'play', 'Video'], ['ai', 'spark', 'AI'], ['top', 'spark', 'Score 6+']]
      .map(([k, ic, l]) => `<button class="chip ${dstate.has.has(k) ? 'on' : ''}" data-df="${k}" aria-pressed="${dstate.has.has(k)}">${icon(ic)} ${l}</button>`).join('');
    el.innerHTML = `
      <div class="hero glass tr-hero ${rise}">
        <button class="btn hero-back" id="city-back" data-tip="Volver a los lugares" aria-label="Volver a los lugares">${icon('chevL')}</button>
        <div class="hero-t"><h1>${esc(c.name)}</h1>
          <div class="hero-sub">${range}</div></div>
        <div class="hero-chips">
          <span class="gchip" data-tip="Vuelos filtrados / totales">${list.length}/${c.flights.length} vuelos</span>
          <span class="gchip" data-tip="Tiempo total en el aire">${fmt.hours(c.dur)}</span>
          ${c.score ? `<span class="score-pill" data-tip="Mejor score AI">${c.score}/10</span>` : ''}
        </div>
        <div class="hero-actions">
          <a class="btn" href="index.html?v=map" data-tip="Ver las rutas en el mapa">${icon('map')} Mapa</a>
          <button class="btn primary" data-postal="${esc(c.key)}">${icon('dl')} Postal</button>
        </div>
      </div>
      <div class="tr-bar ${rise}">
        <label class="search tr-search">${icon('search')}<input id="d-q" type="search" placeholder="Buscar en ${esc(c.name)}" aria-label="Buscar en ${esc(c.name)}" value="${esc(dstate.q)}"></label>
        <div class="tr-chiprow" role="toolbar" aria-label="Filtros">
          ${filterChips}
          ${scenes.length ? '<span class="tr-div" aria-hidden="true"></span>' : ''}
          ${scenes.map(sc => `<button class="chip ${dstate.scene === sc ? 'on' : ''}" data-dscene="${esc(sc)}" aria-pressed="${dstate.scene === sc}">${esc(sc)}</button>`).join('')}
        </div>
      </div>
      ${days.length > 1 ? `<nav class="tr-days" aria-label="Ir a un día">
        ${days.map(([date, dl]) => `<a class="chip" href="#day-${esc(date)}" data-day="${esc(date)}" data-tip="${dl.length} ${dl.length === 1 ? 'vuelo' : 'vuelos'}">${fmt.date(date)}</a>`).join('')}
      </nav>` : ''}
      ${days.map(([date, dl], di) => {
        const dist = dl.reduce((a, f) => a + (f.stats.distance_m || 0), 0);
        const dur = dl.reduce((a, f) => a + (f.duration_s || 0), 0);   // idem: sin NaN min por día
        const diary = diaries[date];
        return `
        <section class="trip ${di < 3 ? rise : ''}" id="day-${esc(date)}">
          <div class="trip-head">
            <h2>${fmt.date(date)}</h2>
            <span class="tr-daymeta">${dl.length} ${dl.length === 1 ? 'vuelo' : 'vuelos'} · ${fmt.km(dist)} · ${fmt.hours(dur)}</span>
          </div>
          ${diary ? `<div class="summary">${esc(diary)}</div>` : ''}
          <div class="grid">${dl.map(f => {
            const a = ai[f.clip_id];
            const title = f.label || shortTitle(a?.summary) || f.time || '';
            return `
            <a class="card scrub" href="flight.html?id=${f.clip_id}" data-cid="${f.clip_id}" data-frames="${f.frame_count || 0}">
              <div class="thumb">
                <img src="${DATA}/thumbs/${f.clip_id}.jpg" alt="" loading="lazy" width="960" height="540">
                <span class="tierdot ${f.tier}"><i></i>${f.tier}</span>
                ${a?.travel_score != null ? `<span class="score-pill" title="Score AI">${a.travel_score}/10</span>` : ''}
                <span class="ovl mono">${fmt.dur(f.duration_s)}</span>
                <span class="scrub-line"></span>
              </div>
              <div class="body">
                <div class="t"><span class="tr-title">${esc(title)}</span></div>
                ${title !== f.time ? `<div class="tr-when"><time>${f.time || ''}</time></div>` : ''}
                <div class="metrics">
                  <span title="Distancia">${icon('route')}<b>${fmt.km(f.stats.distance_m || 0)}</b><i class="tr-sr">Distancia</i></span>
                  <span title="Altura máxima">${icon('mountain')}<b>${Math.round(f.stats.max_rel_alt_m || 0)} m</b><i class="tr-sr">Altura máxima</i></span>
                </div>
                ${f.label && a?.summary ? `<p class="ai-line">${esc(a.summary)}</p>` : ''}
              </div>
            </a>`;
          }).join('')}
          </div>
        </section>`;
      }).join('') || `<div class="empty">${icon('search')}<p>Nada con esos filtros.</p></div>`}`;
    el.querySelector('#city-back').addEventListener('click', () => {
      if (dstate._leaving) return;                        // ya saliendo → evita doble animación y su race
      dstate._leaving = true;
      clearTimeout(dstate._t);                            // cancela el debounce: no re-abrir el detalle tras volver (#14)
      const back = () => {
        dstate._leaving = false;
        Object.assign(dstate, { q: '', scene: null });
        dstate.has.clear();
        renderCities();
        const cg = document.getElementById('cities');
        cg.animate([{ opacity: 0, transform: 'translateX(-18px)' }, { opacity: 1, transform: 'translateX(0)' }],
                   { duration: 220, easing: 'ease-out' });
      };
      el.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(24px)' }],
                 { duration: 180, easing: 'ease-in' })
        .finished.then(back).catch(() => { dstate._leaving = false; });   // AbortError al interrumpir → sin unhandled rejection
    });
    el.querySelector('#d-q').addEventListener('input', e => {
      dstate.q = e.target.value;                          // crudo (sin lowercase): no muta lo tecleado al re-render
      clearTimeout(dstate._t);
      dstate._t = setTimeout(() => {
        const cur = document.getElementById('d-q');
        const caret = cur ? cur.selectionStart : null;    // preserva caret y evita el salto de scroll
        renderDetail(c);
        const next = document.getElementById('d-q');
        if (next) { next.focus({ preventScroll: true }); if (caret != null) { try { next.setSelectionRange(caret, caret); } catch {} } }
      }, 220);
    });
    el.querySelectorAll('[data-df]').forEach(b => b.addEventListener('click', () => {
      dstate.has.has(b.dataset.df) ? dstate.has.delete(b.dataset.df) : dstate.has.add(b.dataset.df);
      renderDetail(c);
    }));
    el.querySelectorAll('[data-dscene]').forEach(b => b.addEventListener('click', () => {
      dstate.scene = dstate.scene === b.dataset.dscene ? null : b.dataset.dscene;
      renderDetail(c);
    }));
    el.querySelectorAll('[data-day]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById(`day-${a.dataset.day}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
    attachScrub(el);
    if (animate) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- postal descargable (canvas: portada + nombre + stats) ----------
  async function makePostal(c, btn) {
    if (btn._busy) return;                                // doble-click en vuelo corrompía el botón (#16)
    btn._busy = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '…';
    try {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = `${DATA}/thumbs/${(c.cover || c.best).clip_id}.jpg`; });
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
    } catch (err) { if (err?.name !== 'AbortError') alert('No se pudo generar la postal.'); }
    btn.innerHTML = orig; btn._busy = false;
  }

  // ---------- renombrar lugar (server-side, sincroniza entre dispositivos) ----------
  function renameCity(c) {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal tr-modal-sm">
      <div class="modal-h"><b>${icon('tag')} Renombrar lugar</b><button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
      <div class="modal-b">
        <div class="tool-row">
          <input class="m-ipt tr-name" id="tm-name" maxlength="60" value="${esc(c.name)}">
          <button class="btn primary" id="tm-save">Guardar</button>
        </div>
        <p class="footer-note tr-note">El nombre se guarda en el servidor: lo verás igual en el iPhone, iPad y desktop.</p>
      </div></div>`;
    openModal(ov);
    const save = async () => {
      const name = ov.querySelector('#tm-name').value.trim();
      if (!name) return;
      await api('/api/trip_meta', { key: c.key, name });
      localStorage.setItem(`ab.city.${c.key}`, name);   // cache local por si el fetch server falla
      c.name = name;
      ov.remove();
      renderCities();
    };
    ov.querySelector('#tm-save').addEventListener('click', save);
    ov.querySelector('#tm-name').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    setTimeout(() => { const i = ov.querySelector('#tm-name'); i.focus(); i.select(); }, 60);
  }

  // ---------- elegir carátula (grid de thumbs del lugar) ----------
  function pickCover(c) {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    const sorted = [...c.flights].sort((a, b) =>
      (ai[b.clip_id]?.travel_score || 0) - (ai[a.clip_id]?.travel_score || 0));
    ov.innerHTML = `<div class="modal tr-modal-md">
      <div class="modal-h"><b>${icon('iso')} Portada de ${esc(c.name)}</b><button class="modal-x" aria-label="Cerrar">${icon('close')}</button></div>
      <div class="modal-b">
        <div class="mflights tr-covers">
          ${sorted.map(f => `
            <div class="mflight ${f.clip_id === c.cover?.clip_id ? 'on' : ''}" data-pick="${esc(f.clip_id)}" role="button" tabindex="0" aria-label="Usar como portada: ${esc(f.label || fmt.date(f.date))}">
              <img src="${DATA}/thumbs/${esc(f.clip_id)}.jpg" loading="lazy" alt="" width="960" height="540">
              <div class="mf-t"><b>${esc(f.label || `${fmt.date(f.date)} · ${f.time || ''}`)}</b>
                <span>${fmt.dur(f.duration_s)}${ai[f.clip_id]?.travel_score ? ` · ${ai[f.clip_id].travel_score}/10 AI` : ''}</span></div>
            </div>`).join('')}
        </div>
        <p class="footer-note tr-note">Se guarda en el servidor. La estrella AI seguirá eligiendo si borras la elección manual.</p>
      </div></div>`;
    openModal(ov);
    const doPick = async row => {
      const cid2 = row.dataset.pick;
      await api('/api/trip_meta', { key: c.key, cover: cid2 });
      c.cover = c.flights.find(f => f.clip_id === cid2) || c.cover;
      ov.remove();
      renderCities();
    };
    ov.addEventListener('click', e => { const row = e.target.closest('[data-pick]'); if (row) doPick(row); });
    ov.addEventListener('keydown', e => {
      const row = e.target.closest('[data-pick]');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); doPick(row); }
    });
  }

  // ---------- interacciones ----------
  main.addEventListener('click', e => {
    const pb = e.target.closest('[data-postal]');
    if (pb) { e.stopPropagation(); makePostal(clusters.find(x => x.key === pb.dataset.postal), pb); return; }
    const mb = e.target.closest('[data-city-menu]');
    if (mb) { e.stopPropagation(); openMenu(mb); return; }
    const cc = e.target.closest('[data-city]');
    if (cc) {
      const c = clusters.find(x => x.key === cc.dataset.city);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        cc.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.98)' }, { transform: 'scale(1)' }], { duration: 180 });
      setTimeout(() => renderDetail(c, true), 120);
    }
  });

  // tarjetas de ciudad alcanzables por teclado (Enter / Espacio); los botones internos conservan lo suyo
  main.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== e.target.closest('.city-card')) return;   // los botones internos (menú) conservan lo suyo
    e.preventDefault();
    e.target.click();
  });

  renderCities();
})();
