// AeroBrain Home V2 — truthful data, cinematic presentation, progressive 3D.
'use strict';

const main = renderShell('home.html');
main.classList.add('home-v2');

const todayLabel = date => new Intl.DateTimeFormat('es-CO', {
  day: '2-digit', month: 'short', year: 'numeric',
}).format(date).replace('.', '').toUpperCase();

const thumbFor = flight => flight?.clip_id ? `${DATA}/thumbs/${encodeURIComponent(flight.clip_id)}.jpg` : '';
const safeText = value => esc(String(value ?? ''));

function metricValue(item) {
  if (item.value === 'Sin datos') return item.value;
  const value = +item.value;
  if (item.kind === 'duration') return fmt.hours(value);
  if (item.kind === 'distance') return fmt.km(value);
  if (item.kind === 'bytes') return fmt.gb(value);
  return item.value;
}

function chipLabel(title, value, index) {
  if (value === 'Sin datos') return value;
  const number = +value;
  if (title === 'Vuelos') return [
    `${number} clips`, `${fmt.hours(number)} en el aire`, fmt.km(number), `${number} streaming`,
  ][index] || value;
  if (title === 'Viajes') return index === 0 ? `${number} días` : fmt.date(value);
  if (title === '3D') return index === 0 ? `${number} modelos` : `${number} splats`;
  if (title === 'Sistema' && index === 0) return fmt.gb(number);
  if (title === 'Studio') return `${number} ${index === 0 ? 'reels' : 'fotos'}`;
  if (title === 'Dron' && index === 0 && Number.isFinite(number)) return `${number} archivos`;
  return value;
}

function cardImage(card, vm, index) {
  const flights = vm.orderedFlights;
  if (card.title === '3D') {
    const model = vm.system.models?.[0];
    const related = model && flights.find(f => f.clip_id === model.clip_id);
    if (related) return thumbFor(related);
  }
  return thumbFor(flights[index] || flights[index % Math.max(flights.length, 1)] || vm.latest);
}

function renderSkeleton() {
  main.innerHTML = `
    <div class="hv2-ambient" aria-hidden="true"></div>
    <section class="hv2-hero hv2-skeleton" aria-label="Cargando inicio">
      <div class="hv2-sk hv2-sk-kicker"></div><div class="hv2-sk hv2-sk-title"></div>
      <div class="hv2-sk hv2-sk-copy"></div><div class="hv2-sk hv2-sk-actions"></div>
    </section>
    <div class="hv2-telemetry hv2-skeleton">${Array.from({ length: 5 }, () => '<span class="hv2-sk"></span>').join('')}</div>
    <div class="hv2-grid hv2-skeleton">${Array.from({ length: 9 }, () => '<span class="hv2-sk"></span>').join('')}</div>`;
}

function renderHome(vm, states) {
  const latest = vm.latest;
  const primaryHref = latest ? `flight.html?id=${encodeURIComponent(latest.clip_id)}` : 'index.html';
  const primaryLabel = latest ? 'Continuar último vuelo' : 'Explorar vuelos';
  const activeLabel = vm.activeJobs.length === 1 ? '1 trabajo activo' : `${vm.activeJobs.length} trabajos activos`;
  const cards = vm.cards.map((card, index) => {
    const image = cardImage(card, vm, index);
    return `
      <a class="hv2-card" href="${card.href}" data-tone="${card.icon}">
        <span class="hv2-card-media" ${image ? `style="background-image:url('${image}')"` : ''} aria-hidden="true"></span>
        <span class="scrim" aria-hidden="true"></span>
        <span class="hv2-card-content">
          <span class="hv2-card-head"><span class="hv2-card-icon">${icon(card.icon)}</span><strong>${safeText(card.title)}</strong></span>
          <span class="hv2-card-copy">${safeText(card.description)}</span>
          <span class="hv2-chips">${card.chips.slice(0, 2).map((chip, i) => `<span>${safeText(chipLabel(card.title, chip, i))}</span>`).join('')}</span>
          <span class="hv2-go">Entrar ${icon('chevR')}</span>
        </span>
      </a>`;
  }).join('');

  main.innerHTML = `
    <div class="hv2-ambient" aria-hidden="true"><span></span><span></span><span></span></div>
    <section class="hv2-hero" aria-labelledby="hv2-title">
      <div class="hv2-hero-art" aria-hidden="true"></div>
      <div class="hv2-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="hv2-hero-copy">
        <p class="hv2-kicker mono">${safeText(vm.greeting)} · ${todayLabel(new Date())}</p>
        <h1 id="hv2-title">Tu cielo, <em>en datos</em></h1>
        <p class="hv2-lede">Vuelos, reconstrucciones 3D y creación aérea en un solo lugar.</p>
        <div class="hv2-actions">
          <a class="btn primary lg hv2-primary" href="${primaryHref}">${icon('play')} ${primaryLabel}</a>
          ${vm.activeJobs.length ? `<a class="btn lg hv2-job" href="system.html">${icon('activity')} ${activeLabel}</a>` : `<a class="btn lg" href="system.html">${icon('gauge')} Estado del sistema</a>`}
        </div>
      </div>
      <div class="hv2-drone-stage" id="home-drone-stage" aria-label="Dron 3D interactivo">
        <img class="hv2-drone-fallback" src="assets/ovi-drone.png" alt="Dron AeroBrain" draggable="false" loading="lazy">
        <span class="hv2-drone-hint mono">Mueve para pilotar</span>
      </div>
    </section>

    <section class="hv2-telemetry" aria-label="Resumen de la bóveda">
      ${vm.telemetry.map(item => `<div><span>${safeText(item.label)}</span><strong>${safeText(metricValue(item))}</strong></div>`).join('')}
    </section>

    <div class="hv2-section-head"><div><span class="mono">MÓDULOS</span><h2>Explora tu ecosistema</h2></div><span class="hv2-live ${states.system === 'ready' ? 'is-online' : ''}"><i></i>${states.system === 'ready' ? 'Bóveda conectada' : 'Datos parciales'}</span></div>
    <section class="hv2-grid" id="hv2-grid" aria-label="Módulos de AeroBrain">${cards}</section>

    <section class="hv2-lower">
      ${latest ? `<a class="hv2-tile hv2-tile-latest scrub" href="${primaryHref}" data-cid="${safeText(latest.clip_id)}" data-frames="${latest.frame_count || 0}">
        <span class="hv2-tile-img"><img src="${thumbFor(latest)}" alt="" loading="lazy"><i class="scrub-line"></i></span>
        <span><span class="hv2-tile-lb">Último vuelo</span><strong>${safeText(fmt.date(latest.date))} · ${safeText(latest.time || '')}</strong><em>${fmt.dur(latest.duration_s || 0)} · ${fmt.km(latest.stats?.distance_m || 0)}</em></span>
        <span class="hv2-tile-go">${icon('chevR')}</span>
      </a>` : `<a class="hv2-tile hv2-tile-latest" href="index.html"><span class="hv2-tile-ico">${icon('drone')}</span><span><span class="hv2-tile-lb">Primer despegue</span><strong>Aún no hay vuelos en la bóveda</strong><em>Importa tu primera misión para empezar.</em></span><span class="hv2-tile-go">${icon('chevR')}</span></a>`}
      <a class="hv2-tile hv2-tile-vault" href="system.html">
        <span class="hv2-tile-ico">${icon('db')}</span><span><span class="hv2-tile-lb">Bóveda local</span><strong>${vm.vaultBytes == null ? 'Sin datos' : fmt.gb(vm.vaultBytes)}</strong><em>Originales, proxies, modelos y splats</em></span><span class="hv2-tile-go">${icon('chevR')}</span>
      </a>
    </section>`;

  attachScrub(main);
  if (window.HomeEffects) HomeEffects.attachVoidNavigation(main);
  requestAnimationFrame(() => main.classList.add('is-ready'));
  entranceOnce(main);
  pauseAmbientOffscreen(main);
  mountDroneWhenIdle();
}

// Entrada de tarjetas: solo en el primer montaje, solo las visibles en el primer viewport (máx. 5),
// escalonado de 30 ms → 120 ms + --dur-base (200 ms) = 320 ms en total.
function entranceOnce(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const vh = innerHeight;
  [...root.querySelectorAll('.hv2-card')]
    .filter(el => el.getBoundingClientRect().top < vh)
    .slice(0, 5)
    .forEach((el, i) => { el.style.setProperty('--reveal-delay', `${i * 30}ms`); el.classList.add('hv2-in'); });
}

// Las animaciones ambientales (deriva, órbita, respiración del hero) se pausan fuera de pantalla o con la pestaña oculta.
function pauseAmbientOffscreen(root) {
  const hero = root.querySelector('.hv2-hero');
  let offscreen = false;
  const sync = () => root.classList.toggle('is-paused', offscreen || document.hidden);
  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => { offscreen = entries[0]?.isIntersecting === false; sync(); }).observe(hero);
  }
  document.addEventListener('visibilitychange', sync);
  sync();
}

// El dron 3D (~1.3 MB) es decorativo: en móvil / táctil / ahorro de datos no se monta y el escenario se oculta.
// El sprite de píxeles solo aparece si el GLB falla de verdad; mientras carga no se muestra nada.
function mountDroneWhenIdle() {
  const stage = document.getElementById('home-drone-stage');
  if (!stage) return;
  const lite = navigator.connection?.saveData || matchMedia('(max-width: 680px)').matches || matchMedia('(pointer: coarse)').matches;
  if (lite) { stage.classList.add('is-off'); return; }
  const fail = () => stage.classList.add('is-failed');
  const mount = () => import('./home-drone.js?v=366')
    .then(mod => mod.mountHomeDrone?.('#home-drone-stage'))
    .then(res => { if (!res) fail(); })
    .catch(fail);
  const idle = () => ('requestIdleCallback' in window) ? requestIdleCallback(mount, { timeout: 4000 }) : setTimeout(mount, 1200);
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
}

renderSkeleton();
HomeData.loadHomeData(getFlights, authFetch)
  .then(data => renderHome(HomeData.buildHomeViewModel(data.flights, data.system, data.jobs), data.states))
  .catch(() => renderHome(HomeData.buildHomeViewModel([], {}, []), { flights: 'error', system: 'error', jobs: 'error' }));
