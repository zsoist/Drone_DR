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
    <section class="hv2-hero hv2-skeleton" aria-label="Cargando Flight Deck">
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
      <a class="hv2-card ${card.wide ? 'hv2-card-wide' : ''}" href="${card.href}"
         style="--card-accent:${card.accent};--reveal-delay:${80 + index * 45}ms">
        <span class="hv2-card-media" ${image ? `style="background-image:url('${image}')"` : ''} aria-hidden="true"></span>
        <span class="hv2-card-wash" aria-hidden="true"></span>
        <span class="hv2-card-content">
          <span class="hv2-card-head"><span class="hv2-card-icon">${icon(card.icon)}</span><strong>${safeText(card.title)}</strong></span>
          <span class="hv2-card-copy">${safeText(card.description)}</span>
          <span class="hv2-chips">${card.chips.map((chip, i) => `<span>${safeText(chipLabel(card.title, chip, i))}</span>`).join('')}</span>
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
        <h1 id="hv2-title">Flight <em>Deck</em></h1>
        <p class="hv2-lede">Tu centro de mando para vuelos, reconstrucciones 3D y creación aérea.</p>
        <div class="hv2-actions">
          <a class="btn primary hv2-primary" href="${primaryHref}">${icon('play')} ${primaryLabel}</a>
          ${vm.activeJobs.length ? `<a class="btn hv2-job" href="system.html">${icon('activity')} ${activeLabel}</a>` : `<a class="btn" href="system.html">${icon('gauge')} Estado del sistema</a>`}
        </div>
      </div>
      <div class="hv2-drone-stage" id="home-drone-stage" aria-label="Dron 3D interactivo">
        <img class="hv2-drone-fallback is-visible" src="assets/ovi-drone.png" alt="Dron AeroBrain" draggable="false">
        <span class="hv2-drone-hint mono">MUEVE PARA PILOTAR</span>
      </div>
    </section>

    <section class="hv2-telemetry" aria-label="Resumen de la bóveda">
      ${vm.telemetry.map(item => `<div><span>${safeText(item.label)}</span><strong>${safeText(metricValue(item))}</strong></div>`).join('')}
    </section>

    <div class="hv2-section-head"><div><span class="mono">MÓDULOS DE VUELO</span><h2>Explora tu ecosistema</h2></div><span class="hv2-live ${states.system === 'ready' ? 'is-online' : ''}"><i></i>${states.system === 'ready' ? 'Bóveda conectada' : 'Datos parciales'}</span></div>
    <section class="hv2-grid" id="hv2-grid" aria-label="Módulos de AeroBrain">${cards}</section>

    <section class="hv2-lower">
      ${latest ? `<a class="hv2-latest scrub" href="${primaryHref}" data-cid="${safeText(latest.clip_id)}" data-frames="${latest.frame_count || 0}">
        <span class="hv2-latest-image"><img src="${thumbFor(latest)}" alt="Último vuelo del ${safeText(fmt.date(latest.date))}" loading="lazy"><i class="scrub-line"></i></span>
        <span><small class="mono">ÚLTIMO VUELO</small><strong>${safeText(fmt.date(latest.date))} · ${safeText(latest.time || '')}</strong><em>${fmt.dur(latest.duration_s || 0)} · ${fmt.km(latest.stats?.distance_m || 0)}</em></span>
        <b>${icon('chevR')}</b>
      </a>` : `<a class="hv2-latest is-empty" href="index.html"><span>${icon('drone')}</span><span><small class="mono">PRIMER DESPEGUE</small><strong>Aún no hay vuelos en la bóveda</strong><em>Importa tu primera misión para activar el Flight Deck.</em></span><b>${icon('chevR')}</b></a>`}
      <a class="hv2-vault" href="system.html">
        <span class="hv2-vault-icon">${icon('db')}</span><span><small class="mono">BÓVEDA LOCAL</small><strong>${vm.vaultBytes == null ? 'Sin datos' : fmt.gb(vm.vaultBytes)}</strong><em>Originales, proxies, modelos y splats</em></span><b>${icon('chevR')}</b>
      </a>
    </section>`;

  attachScrub(main);
  if (window.HomeEffects) HomeEffects.attachVoidNavigation(main);
  requestAnimationFrame(() => main.classList.add('is-ready'));
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setTimeout(() => import('./home-drone.js?v=215').then(mod => mod.mountHomeDrone?.('#home-drone-stage')).catch(() => {}), 260);
  }
}

renderSkeleton();
HomeData.loadHomeData(getFlights, fetch)
  .then(data => renderHome(HomeData.buildHomeViewModel(data.flights, data.system, data.jobs), data.states))
  .catch(() => renderHome(HomeData.buildHomeViewModel([], {}, []), { flights: 'error', system: 'error', jobs: 'error' }));
