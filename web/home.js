import { readAI } from './home.ai.js?v=402';
import { loadFlights, registerFlights, frameFor, skeleton, renderFailure } from './home-shared.js?v=402';
const main = renderShell('home.html');
main.classList.add('home-page', 'ab-page');
const flightLink = f => `flight.html?id=${encodeURIComponent(f.clip_id)}`;
const titleFor = f => f.label || `${fmt.date(f.date)} · ${f.time || 'Vuelo'}`;

async function load() {
  main.innerHTML = `<div aria-busy="true" aria-label="Cargando inicio"><div class="home-heading"><div class="ui-skeleton ui-skeleton--text"></div></div><div class="home-feature"><div class="ui-skeleton ui-skeleton--media home-feature-media" aria-hidden="true"></div><div class="home-feature-copy">${'<div class="ui-skeleton ui-skeleton--text"></div>'.repeat(4)}</div></div><div class="home-section">${skeleton(3)}</div></div>`;
  try {
    const flights = (await loadFlights()).filter(f => !f.archived).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    registerFlights(flights);
    const latest = flights[0];
    let jobs = [], jobsError = false;
    try { const r = await authFetch('/api/jobs'); if (!r.ok) throw new Error('jobs'); const data = await r.json(); jobs = data.jobs || []; } catch { jobsError = true; }
    const events = recentEvents(jobs, flights);
    if (!latest) {
      main.innerHTML = '<h1>Inicio</h1><div class="ui-empty"><h2>Tu primer vuelo empieza aquí</h2><p>Sube un video del dron para ver su recorrido y sus mejores momentos.</p><a class="ui-button ui-button--primary" href="studio.html?via=subir">Subir video</a><p>Por ejemplo, un vuelo sobre los cerros.</p></div>';
      return;
    }
    main.innerHTML = `
      <header class="home-heading"><h1>Inicio</h1><a class="ui-button ui-button--quiet" href="studio.html?via=subir">${icon('plus')} Subir</a></header>
      <section class="home-feature">
        <a class="home-feature-media" href="${flightLink(latest)}" aria-label="Ver último vuelo" data-transition-key="clip-${esc(latest.clip_id)}"><img src="${frameFor(latest, latest.ai?.highlights?.[0]?.t)}" alt="Vista aérea del último vuelo" fetchpriority="high"></a>
        <div class="home-feature-copy"><p class="home-date">Último vuelo · ${esc(latest.time || '')}</p><h2>${esc(latest.label || fmt.date(latest.date))}</h2><p>Reproduce el recorrido y revisa tus momentos destacados.</p><div class="home-flight-meta"><span>${fmt.dur(latest.duration_s)} en el aire</span><span>${fmt.km(latest.stats?.distance_m || 0)} de recorrido</span></div><a class="ui-button ui-button--primary" href="${flightLink(latest)}">${icon('play')} Ver vuelo</a></div>
      </section>
      <section class="home-section home-collection-section"><div class="home-section-head"><div><h2>Colecciones</h2><span class="w2-note">Sugerido</span></div><a class="ui-button ui-button--quiet" href="trips.html">Ver viajes ${icon('arrowR')}</a></div><div id="home-collections" aria-busy="true">${skeleton(3)}</div></section>
      <section class="home-section home-recent-section"><div class="home-section-head"><h2>Vuelos recientes</h2><a class="ui-button ui-button--quiet" href="index.html">Ver todos ${icon('arrowR')}</a></div><div class="home-recent">${flights.slice(1, 5).map(f => `<a href="${flightLink(f)}" class="home-recent-item"><img src="${frameFor(f)}" alt="" loading="lazy"><span><strong>${esc(titleFor(f))}</strong><span>${fmt.dur(f.duration_s)} · ${fmt.km(f.stats?.distance_m || 0)}</span></span>${icon('arrowR')}</a>`).join('') || '<p>Tu próximo vuelo aparecerá aquí.</p>'}</div></section>
      <section class="home-section home-bottom">${events.length ? `<div><h2>Actividad reciente</h2><ul class="home-activity">${events.map(event => `<li><a href="${esc(event.href)}"><strong>${esc(event.text)}</strong><span>${esc(relativeTime(event.finished))}</span></a></li>`).join('')}</ul></div>` : ''}${jobsError ? '<p class="w2-note">No se pudo cargar la actividad. <button class="ui-button ui-button--quiet" id="home-jobs-retry">Reintentar</button></p>' : ''}<nav class="home-quick" aria-label="Acciones rápidas"><a class="ui-button ui-button--secondary" href="index.html?v=map">${icon('map')} Explorar mapa</a><a class="ui-button ui-button--secondary" href="studio.html">${icon('film')} Crear reel</a></nav></section>`;
    loadCollections(flights);
    document.getElementById('home-jobs-retry')?.addEventListener('click', load);
  } catch { renderFailure(main, load); }
}
async function loadCollections(flights) {
  const region = document.getElementById('home-collections');
  try {
    const { collections } = await readAI('/api/collections');
    const covers = await collectionCovers(collections, flights);
    region.innerHTML = collections.length ? `<div class="home-collections">${collections.map((c, i) => `<a class="home-collection" href="index.html?collection=${encodeURIComponent(c.id)}&v=list"><img src="${esc(covers[i])}" alt="" loading="lazy"><h3>${esc(c.label)}</h3><p>${esc(c.subtitle)}</p></a>`).join('')}</div>` : '<p class="w2-note">Las colecciones aparecerán cuando haya vuelos analizados.</p>';
  } catch { region.innerHTML = '<p class="w2-note">No se pudieron cargar las colecciones. <button class="ui-button ui-button--quiet" id="collections-retry">Reintentar</button></p>'; region.querySelector('button').addEventListener('click', () => loadCollections(flights)); }
  finally { region.setAttribute('aria-busy', 'false'); }
}
function relativeTime(seconds) {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - seconds) / 60));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 1440) return `hace ${Math.floor(minutes / 60)} h`;
  const days = Math.floor(minutes / 1440);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}
function recentEvents(jobs, flights) {
  const seen = new Set();
  return jobs.filter(job => job.status === 'done' && Number.isFinite(job.finished) && job.finished > 0)
    .sort((a, b) => b.finished - a.finished).flatMap(job => {
      const flight = flights.find(f => f.clip_id === job.label);
      const title = job.title || flight?.label;
      if (!title || title === job.label || /\b(?:DJI_|recon_)/i.test(title)) return [];
      let href, text;
      if (['3d', 'splat'].includes(job.kind) && job.artifact_exists) {
        href = `share.html?m=${encodeURIComponent(job.label)}`;
        text = `Escena «${title}» lista`;
      } else if (job.kind === 'analyze' && flight) {
        href = flightLink(flight);
        text = `Vuelo «${title}» analizado`;
      } else return [];
      if (seen.has(href)) return [];
      seen.add(href);
      return [{ href, text, finished: job.finished }];
    }).slice(0, 3);
}
async function collectionCovers(collections, flights) {
  const used = new Set(), insights = new Map(), covers = [];
  const imageKey = url => new URL(url, location.href).href;
  // Reserve owner covers before selecting suggestions, even when they appear later.
  const owned = new Set(collections.filter(c => c.cover.selection === 'owner').map(c => imageKey(c.cover.frame_url)));
  for (const collection of collections) {
    let cover = collection.cover.frame_url;
    if (used.has(imageKey(cover)) || (owned.has(imageKey(cover)) && collection.cover.selection !== 'owner')) {
      const candidates = flights.filter(f => collection.clip_ids.includes(f.clip_id))
        .sort((a, b) => (b.ai?.travel_score || 0) - (a.ai?.travel_score || 0));
      let alternate;
      for (const flight of candidates) {
        if (!insights.has(flight.clip_id)) {
          insights.set(flight.clip_id, readAI(`/api/clip/${encodeURIComponent(flight.clip_id)}/insight`).catch(() => null));
        }
        const insight = (await insights.get(flight.clip_id))?.insight;
        const times = [...(insight?.best_frame_times || []), ...(flight.ai?.highlights || []).map(h => h.t)];
        alternate = times.filter(t => Number.isFinite(t) && flight.frame_count > 0)
          .map(t => frameFor(flight, t)).find(url => !used.has(imageKey(url)) && !owned.has(imageKey(url)));
        if (alternate) break;
      }
      if (alternate) cover = alternate;
    }
    used.add(imageKey(cover));
    covers.push(cover);
  }
  return covers;
}
load();
