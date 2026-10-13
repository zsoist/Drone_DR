import { thumbnailURL } from './ui/thumbnail.js?v=438';
import { fmt } from './ui/format.js?v=438';
import { readAI, loadInsights, captionView, bestCover, flightCaption } from './home.ai.js?v=438';
import { loadFlights, registerFlights, skeleton, renderFailure, suggestedContent } from './home-shared.js?v=438';
const main = renderShell('home.html');
main.classList.add('home-page', 'ab-page');
const flightLink = f => `flight.html?id=${encodeURIComponent(f.clip_id)}`;
const titleFor = f => f.label || 'Vuelo';
let collectionRequest;
const getCollections = () => collectionRequest ||= readAI('/api/collections').catch(error => { collectionRequest = null; throw error; });

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
      <header class="home-heading"><h1>Inicio</h1><nav class="home-quick" aria-label="Acciones rápidas"><a class="ui-button ui-button--quiet" href="trips.html?view=map">${icon('map')} Explorar mapa</a><a class="ui-button ui-button--quiet" href="studio.html">${icon('film')} Crear reel</a><a class="ui-button ui-button--quiet" href="studio.html?via=subir">${icon('plus')} Subir</a></nav></header>
      <section class="home-feature">
        <a class="home-feature-media" href="${flightLink(latest)}" aria-label="Ver último vuelo" data-transition-key="clip-${esc(latest.clip_id)}"><img hidden alt="Vista aérea del último vuelo" fetchpriority="high"></a>
        <div class="home-feature-copy"><p class="home-date">Último vuelo · ${esc(latest.time || '')}</p><h2>${esc(latest.label || fmt.date(latest.date))}</h2><div id="home-summary" aria-busy="true"><div class="ui-skeleton ui-skeleton--text" aria-hidden="true"></div></div><div class="home-flight-meta"><span>${esc(fmt.duration(latest.duration_s))} en el aire</span><span>${esc(fmt.distance(latest.stats?.distance_m))} de recorrido</span></div><a class="ui-button ui-button--primary" href="${flightLink(latest)}">${icon('play')} Ver vuelo</a></div>
      </section>
      <section class="home-section home-collection-section"><div class="home-section-head"><h2>Colecciones</h2><div class="home-collection-controls"><button class="ui-button ui-button--quiet" id="collections-prev" aria-label="Colecciones anteriores" disabled>${icon('arrowL')}</button><button class="ui-button ui-button--quiet" id="collections-next" aria-label="Más colecciones">${icon('arrowR')}</button></div><a class="ui-button ui-button--quiet" href="trips.html">Ver viajes ${icon('arrowR')}</a></div><div id="home-collections" aria-busy="true">${skeleton(3)}</div></section>
      <section class="home-section home-recent-section"><div class="home-section-head"><h2>Vuelos recientes</h2><a class="ui-button ui-button--quiet" href="index.html">Ver todos ${icon('arrowR')}</a></div><div class="home-recent" id="home-recent">${flights.slice(1, 5).map(f => `<a href="${flightLink(f)}" class="home-recent-item" data-clip="${esc(f.clip_id)}"><img src="${esc(thumbnailURL(f))}" alt="" loading="lazy"><span><strong>${esc(titleFor(f))}</strong><span>${esc(fmt.date(f.date))} · ${esc(f.time || '')} · ${esc(fmt.duration(f.duration_s))}</span></span>${icon('arrowR')}</a>`).join('') || '<p>Tu próximo vuelo aparecerá aquí.</p>'}</div></section>
      <section class="home-section home-bottom">${events.length ? `<div><h2>Actividad reciente</h2><ul class="home-activity">${events.map(event => `<li><a href="${esc(event.href)}"><strong>${esc(event.text)}</strong><span>${esc(fmt.relative(event.finished * 1000))}</span></a></li>`).join('')}</ul></div>` : ''}${jobsError ? '<p class="w2-note">No se pudo cargar la actividad. <button class="ui-button ui-button--quiet" id="home-jobs-retry">Reintentar</button></p>' : ''}</section>`;
    loadCollections(flights);
    loadRecent(flights.slice(0, 5));
    if (!events.length && !jobsError) main.querySelector('.home-bottom').remove();
    document.getElementById('home-jobs-retry')?.addEventListener('click', load);
  } catch { renderFailure(main, load); }
}
async function loadCollections(flights) {
  const region = document.getElementById('home-collections');
  try {
    const { collections } = await getCollections();
    const covers = await collectionCovers(collections, flights);
    const kinds = { place: 'Lugares', month: 'Meses', subject: 'Temas', shot_type: 'Tomas' };
    const grouped = Object.keys(kinds).map(kind => ({ kind, items: collections.map((c, i) => ({ ...c, image: covers[i], order: i })).filter(c => collectionKind(c) === kind).sort((a, b) => (a.rank ?? a.order) - (b.rank ?? b.order)) })).filter(group => group.items.length);
    const html = `<div class="home-collections" tabindex="0" aria-label="Colecciones por tipo">${grouped.map(({ kind, items }) => `${items.map(c => {
      const members = flights.filter(f => c.clip_ids.includes(f.clip_id));
      const duration = Math.round(members.reduce((sum, f) => sum + (Number(f.duration_s) || 0), 0));
      const durationText = fmt.duration(duration) + (duration >= 3600 && duration % 60 ? ` ${fmt.duration(duration % 60)}` : '');
      return `<a class="home-collection" data-kind="${kind}" href="index.html?collection=${encodeURIComponent(c.id)}&v=list"><span class="home-collection-kind">${kinds[kind]}</span>${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : '<div class="home-cover-empty">Sin portada seleccionada</div>'}<h4>${esc(c.label)}</h4><p>${esc(fmt.number(c.count))} clips · ${esc(durationText)}</p></a>`;
    }).join('')}`).join('')}</div>`;
    region.replaceChildren(collections.length ? suggestedContent(html) : Object.assign(document.createElement('p'), { className: 'w2-note', textContent: 'Las colecciones aparecerán cuando haya vuelos analizados.' }));
    const track = region.querySelector('.home-collections');
    if (track) {
      const prev = document.getElementById('collections-prev'), next = document.getElementById('collections-next');
      const update = () => { track.style.setProperty('--collection-width', `${(track.clientWidth - 16 * (Math.max(1, Math.floor(track.clientWidth / 230)) - 1)) / Math.max(1, Math.floor(track.clientWidth / 230))}px`); prev.disabled = track.scrollLeft < 2; next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2; };
      for (const [button, direction] of [[prev, -1], [next, 1]]) button.onclick = () => track.scrollBy({ left: direction * (track.clientWidth + 16), behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth' });
      track.addEventListener('scroll', update, { passive: true });
      const resize = new ResizeObserver(() => requestAnimationFrame(update)); resize.observe(track);
      addEventListener('pagehide', () => resize.disconnect(), { once: true }); update();
    }
  } catch { region.innerHTML = '<p class="w2-note">No se pudieron cargar las colecciones. <button class="ui-button ui-button--quiet" id="collections-retry">Reintentar</button></p>'; region.querySelector('button').addEventListener('click', () => loadCollections(flights)); }
  finally { region.setAttribute('aria-busy', 'false'); }
}
function recentEvents(jobs, flights) {
  const seen = new Set();
  return jobs.filter(job => job.status === 'done' && Number.isFinite(job.finished) && job.finished > Date.now() / 1000 - 7 * 86400)
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
  const used = new Set(collections.filter(c => c.cover?.selection === 'owner').map(c => c.cover.frame_url.replace(/^\//, '')));
  const covers = [];
  for (const collection of collections) {
    if (collection.cover?.selection === 'owner') { covers.push(collection.cover.frame_url); continue; }
    const candidates = flights.filter(f => collection.clip_ids.includes(f.clip_id))
      .sort((a, b) => (b.clip_id === collection.cover?.clip_id) - (a.clip_id === collection.cover?.clip_id)
        || (b.ai?.travel_score || 0) - (a.ai?.travel_score || 0));
    let cover;
    for (const flight of candidates) {
      const { insights } = await loadInsights([flight]);
      cover = await bestCover(flight, insights[flight.clip_id], { exclude: used });
      if (cover) break;
    }
    if (cover) used.add(cover.url.replace(/^\//, ''));
    covers.push(cover?.url || '');
  }
  return covers;
}
function collectionKind(c) {
  if (['place', 'month', 'subject', 'shot_type'].includes(c.kind)) return c.kind;
  if (/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i.test(c.label)) return 'month';
  if (/cenital|revelaci|mixt|órbita|paneo|ascenso|descenso|seguimiento|travelling|fpv/i.test(c.label)) return 'shot_type';
  if (/bogotá|guatavita|la mesa|zona|lugar/i.test(c.label) || c.id?.startsWith('place:')) return 'place';
  return 'subject';
}
async function loadRecent(rows) {
  const region = document.getElementById('home-summary');
  const [{ insights, failed }, collections] = await Promise.all([loadInsights(rows), getCollections().then(data => data.collections).catch(() => [])]);
  const place = f => collections.find(c => collectionKind(c) === 'place' && c.clip_ids.includes(f.clip_id))?.label;
  for (const f of rows) {
    const entry = document.querySelector(`.home-recent-item[data-clip="${f.clip_id}"]`);
    if (!entry) continue;
    entry.querySelector('strong').textContent = flightCaption(f, insights[f.clip_id]);
    const img = entry.querySelector('img'); img.src = thumbnailURL(f); img.hidden = false;
  }
  const latest = rows[0], insight = insights[latest.clip_id];
  document.querySelector('.home-feature h2').textContent = latest.label || place(latest) || fmt.date(latest.date);
  document.querySelector('.home-date').textContent = `Último vuelo · ${fmt.date(latest.date)} · ${latest.time || ''}`;
  const cover = await bestCover(latest, insight);
  if (cover) { const img = document.querySelector('.home-feature-media img'); img.src = cover.url; img.hidden = false; }
  region.replaceChildren();
  if (insight?.caption_short || insight?.caption) region.append(suggestedContent(captionView(insight)));
  else if (failed) region.textContent = 'No se pudo cargar el resumen.';
  region.setAttribute('aria-busy', 'false');
  // One shared disclosure identifies the suggested recent-flight titles.
  if (rows.slice(1).some(f => insights[f.clip_id]?.caption_short && !f.label)) {
    const recent = document.getElementById('home-recent');
    const wrap = suggestedContent(recent.outerHTML); recent.replaceWith(wrap);
  }
}
load();
