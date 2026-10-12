import { loadFlights, registerFlights, frameFor, skeleton, renderFailure, suggestion, wireSuggestions } from './home-shared.js?v=386';
const main = renderShell('home.html');
main.classList.add('home-page');
const flightLink = f => `flight.html?id=${encodeURIComponent(f.clip_id)}`;
const titleFor = f => f.label || `${fmt.date(f.date)} · ${f.time || 'Vuelo'}`;

async function load() {
  main.innerHTML = `<div aria-busy="true" aria-label="Cargando inicio"><div class="home-heading"><div class="ui-skeleton ui-skeleton--text"></div></div><div class="home-feature"><div class="ui-skeleton ui-skeleton--media home-feature-media" aria-hidden="true"></div><div class="home-feature-copy">${'<div class="ui-skeleton ui-skeleton--text"></div>'.repeat(4)}</div></div><div class="home-section">${skeleton(3)}</div></div>`;
  try {
    const flights = (await loadFlights()).filter(f => !f.archived).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    registerFlights(flights);
    const latest = flights[0];
    let jobs = [], jobsError = false;
    try { const r = await authFetch('/api/jobs'); if (!r.ok) throw new Error('jobs'); const data = await r.json(); jobs = (data.jobs || []).slice(0, 3); } catch { jobsError = true; }
    const jobState = { done: 'Listo', error: 'Falló', running: 'En proceso', queued: 'En cola', cancelled: 'Cancelado' };
    const jobKind = { splat: 'Reconstrucción 3D', odm: 'Modelo del terreno', analyze: 'Análisis de vuelo', ingest: 'Importación', reel: 'Reel', render: 'Exportación' };
    if (!latest) {
      main.innerHTML = '<h1>Inicio</h1><div class="ui-empty"><h2>Tu primer vuelo empieza aquí</h2><p>Sube un video del dron para ver su recorrido y sus mejores momentos.</p><a class="ui-button ui-button--primary" href="studio.html?via=subir">Subir video</a><p>Por ejemplo, un vuelo sobre los cerros.</p></div>';
      return;
    }
    const groups = new Map();
    flights.forEach(f => new Set([...(f.ai?.tags || []), f.ai?.scene_type].filter(tag => tag && tag.toLowerCase() !== 'mixto')).forEach(tag => {
      const key = tag.toLocaleLowerCase('es');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }));
    const collections = [...groups].filter(([, rows]) => rows.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const usedCovers = new Set();
    const collectionCover = rows => {
      const ranked = [...rows].sort((a, b) => (b.ai?.travel_score || 0) - (a.ai?.travel_score || 0));
      const selected = ranked.find(f => !usedCovers.has(f.clip_id)) || ranked[0];
      usedCovers.add(selected.clip_id);
      return frameFor(selected, selected.ai?.highlights?.[0]?.t);
    };
    main.innerHTML = `
      <header class="home-heading"><h1>Inicio</h1><a class="ui-button ui-button--quiet" href="studio.html?via=subir">${icon('plus')} Subir</a></header>
      <section class="home-feature">
        <a class="home-feature-media" href="${flightLink(latest)}" aria-label="Ver último vuelo" data-transition-key="clip-${esc(latest.clip_id)}"><img src="${frameFor(latest, latest.ai?.highlights?.[0]?.t)}" alt="Vista aérea del último vuelo" fetchpriority="high"></a>
        <div class="home-feature-copy"><p class="home-date">Último vuelo · ${esc(latest.time || '')}</p><h2>${esc(latest.label || fmt.date(latest.date))}</h2><p>Reproduce el recorrido y revisa tus momentos destacados.</p><div class="home-flight-meta"><span>${fmt.dur(latest.duration_s)} en el aire</span><span>${fmt.km(latest.stats?.distance_m || 0)} de recorrido</span></div><a class="ui-button ui-button--primary" href="${flightLink(latest)}">${icon('play')} Ver vuelo</a></div>
      </section>
      <section class="home-section"><div class="home-section-head"><h2>Colecciones</h2><a class="ui-button ui-button--quiet" href="trips.html">Ver viajes ${icon('arrowR')}</a></div>
        ${collections.length ? `<div class="home-collections">${collections.map(([tag, rows]) => `<article class="home-collection"><a href="index.html?q=${encodeURIComponent(tag)}"><img src="${collectionCover(rows)}" alt="" loading="lazy"><h3>${esc(tag.charAt(0).toUpperCase() + tag.slice(1))}</h3><p>${rows.length} vuelos</p></a>${suggestion(`collection-${tag}`, `Agrupados por ${tag}.`, `index.html?q=${encodeURIComponent(tag)}`)}</article>`).join('')}</div>` : '<div class="ui-empty"><h3>Sin análisis aún</h3><p>Las colecciones aparecerán cuando tus vuelos tengan etiquetas.</p><a class="ui-button ui-button--secondary" href="index.html">Ver vuelos</a><p>Por ejemplo, montañas o arquitectura.</p></div>'}
      </section>
      <section class="home-section"><div class="home-section-head"><h2>Vuelos recientes</h2><a class="ui-button ui-button--quiet" href="index.html">Ver todos ${icon('arrowR')}</a></div><div class="home-recent">${flights.slice(1, 5).map(f => `<a href="${flightLink(f)}" class="home-recent-item"><img src="${frameFor(f)}" alt="" loading="lazy"><span><strong>${esc(titleFor(f))}</strong><span>${fmt.dur(f.duration_s)} · ${fmt.km(f.stats?.distance_m || 0)}</span></span>${icon('arrowR')}</a>`).join('') || '<p>Tu próximo vuelo aparecerá aquí.</p>'}</div></section>
      <section class="home-section home-bottom"><div><h2>Actividad reciente</h2><p>${flights.length} vuelos guardados · ${new Set(flights.map(f => f.date)).size} días de vuelo</p>${jobsError ? '<p>No se pudo cargar la actividad. <button class="ui-button ui-button--quiet" id="home-jobs-retry">Reintentar</button></p>' : jobs.length ? `<ul class="home-activity">${jobs.map(job => `<li><a href="system.html"><strong>${esc(jobKind[job.kind] || 'Procesamiento')}</strong><span>${esc(jobState[job.status] || 'Estado no disponible')}</span></a></li>`).join('')}</ul>` : `<p>Último vuelo registrado el ${fmt.date(latest.date)}.</p>`}</div><nav class="home-quick" aria-label="Acciones rápidas"><a class="ui-button ui-button--secondary" href="index.html?v=map">${icon('map')} Explorar mapa</a><a class="ui-button ui-button--secondary" href="studio.html">${icon('film')} Crear reel</a></nav></section>`;
    document.getElementById('home-jobs-retry')?.addEventListener('click', load);
  } catch { renderFailure(main, load); }
}
wireSuggestions(main);
load();
