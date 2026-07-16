(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeData = api;
})(globalThis, function () {
  'use strict';

  const MODULES = [
    { href: 'index.html', icon: 'grid', title: 'Vuelos', accent: '#4da3ff', wide: true,
      description: 'Reproduce, filtra y abre el mapa, el análisis o el 3D de cada vuelo.' },
    { href: 'trips.html', icon: 'pin', title: 'Viajes', accent: '#42d69c',
      description: 'Recorre tus vuelos por lugar y fecha, con postales listas para compartir.' },
    { href: 'mundo.html', icon: 'globe', title: 'Mundo', accent: '#2fd3b6',
      description: 'Explora todos tus vuelos sobre un mapa mundial interactivo.' },
    { href: 'tresd.html', icon: 'cube', title: '3D', accent: '#ff9f43',
      description: 'Explora ortomosaicos, nubes, mallas y gaussian splats medibles.' },
    { href: 'splatlab.html', icon: 'spark', title: 'Splat Lab', accent: '#e15bd6',
      description: 'Limpia y afina tus gaussian splats: quita floaters, recorta y exporta.' },
    { href: 'drone.html', icon: 'drone', title: 'Dron', accent: '#38d9e5',
      description: 'Importa desde la micro SD, verifica archivos y libera espacio con seguridad.' },
    { href: 'studio.html', icon: 'film', title: 'Studio', accent: '#b78cff',
      description: 'Edita clips y fotos, aplica transiciones y exporta hasta 4K.' },
    { href: 'drone.html?via=subir', icon: 'dl', title: 'Subir', accent: '#ff7eb0',
      description: 'Suelta contenido DJI y deja que AeroBrain prepare proxy, datos y análisis.' },
    { href: 'system.html', icon: 'db', title: 'Sistema', accent: '#8fa3c0',
      description: 'Supervisa trabajos, almacenamiento y la papelera restaurable.' },
  ];

  const finite = value => Number.isFinite(+value) ? +value : 0;
  const hasArray = (obj, key) => Array.isArray(obj?.[key]);
  const stamp = flight => `${flight?.date || ''} ${flight?.time || ''}`;

  function classifyJobsResponse(status, payload) {
    if (+status === 403) return { state: 'public', jobs: [] };
    if (+status < 200 || +status >= 300) return { state: 'error', jobs: [] };
    return { state: 'ready', jobs: Array.isArray(payload?.jobs) ? payload.jobs : [] };
  }

  function greetingFor(date) {
    const hour = date.getHours();
    if (hour < 6) return 'Vuelos nocturnos';
    if (hour < 12) return 'Buenos días';
    if (hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function manifestUrl(dataRoot = 'data') {
    return `${String(dataRoot || 'data').replace(/\/$/, '')}/manifest/system.json`;
  }

  function buildHomeViewModel(flights = [], system = {}, jobs = [], now = new Date()) {
    const safeFlights = Array.isArray(flights) ? flights.filter(Boolean) : [];
    const safeSystem = system && typeof system === 'object' ? system : {};
    const safeJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
    const ordered = [...safeFlights].sort((a, b) => stamp(b).localeCompare(stamp(a)));
    const latest = ordered[0] || null;
    const first = ordered[ordered.length - 1] || null;
    const durationSeconds = safeFlights.reduce((total, flight) => total + finite(flight.duration_s), 0);
    const distanceMeters = safeFlights.reduce((total, flight) => total + finite(flight.stats?.distance_m), 0);
    const streaming = safeFlights.filter(flight => flight.has_proxy).length;
    const days = new Set(safeFlights.map(flight => flight.date).filter(Boolean)).size;
    const modelsKnown = hasArray(safeSystem, 'models');
    const splatsKnown = hasArray(safeSystem, 'splats');
    const storageKnown = !!safeSystem.storage && typeof safeSystem.storage === 'object';
    const vaultBytes = storageKnown
      ? Object.values(safeSystem.storage).reduce((total, value) => total + finite(value), 0)
      : null;
    const modelCount = modelsKnown ? safeSystem.models.length : null;
    const splatCount = splatsKnown ? safeSystem.splats.length : null;
    const activeJobs = safeJobs.filter(job => ['running', 'queued'].includes(job.status));
    const date = new Date(now);

    const telemetry = [
      { label: 'Vuelos', value: safeFlights.length ? String(safeFlights.length) : 'Sin datos', kind: 'count' },
      { label: 'En el aire', value: safeFlights.length ? String(durationSeconds) : 'Sin datos', kind: 'duration' },
      { label: 'Distancia', value: safeFlights.length ? String(distanceMeters) : 'Sin datos', kind: 'distance' },
      { label: 'Modelos · Splats', value: modelsKnown || splatsKnown ? `${modelCount ?? 0} · ${splatCount ?? 0}` : 'Sin datos', kind: '3d' },
      { label: 'Bóveda local', value: storageKnown ? String(vaultBytes) : 'Sin datos', kind: 'bytes' },
    ];

    const cardChips = {
      Vuelos: safeFlights.length ? [String(safeFlights.length), String(durationSeconds), String(distanceMeters), String(streaming)] : ['Sin datos'],
      Viajes: days ? [String(days), first?.date || '', latest?.date || ''] : ['Sin datos'],
      Mundo: safeFlights.length ? [`${safeFlights.length} vuelos`, 'Vista mundial'] : ['Mapa mundial'],
      '3D': modelsKnown || splatsKnown ? [String(modelCount ?? 0), String(splatCount ?? 0)] : ['Sin datos'],
      'Splat Lab': splatsKnown ? [`${splatCount ?? 0} splats`, 'Limpiar · afinar'] : ['Laboratorio splat'],
      Dron: safeSystem.last_ingest ? [String(finite(safeSystem.last_ingest.files)), 'DJI Flip · Neo 2'] : ['SD lista'],
      Studio: hasArray(safeSystem, 'reels') || hasArray(safeSystem, 'photos')
        ? [String((safeSystem.reels || []).length), String((safeSystem.photos || []).length)] : ['Sin datos'],
      Subir: ['Arrastra y suelta', 'Hasta 25 GB'],
      Sistema: storageKnown ? [String(vaultBytes), 'Papelera segura'] : ['Sin datos'],
    };

    return {
      greeting: greetingFor(date),
      date: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      latest,
      first,
      orderedFlights: ordered,
      telemetry,
      cards: MODULES.map(module => ({ ...module, chips: cardChips[module.title] })),
      activeJobs,
      storage: storageKnown ? safeSystem.storage : null,
      vaultBytes,
      system: safeSystem,
      stats: { durationSeconds, distanceMeters, streaming, days, modelCount, splatCount },
    };
  }

  async function loadHomeData(getFlightsFn, fetchFn) {
    const readJson = async (url, quiet403 = false) => {
      const response = await fetchFn(url);
      if (quiet403 && response.status === 403) return classifyJobsResponse(403, null);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return quiet403 ? classifyJobsResponse(response.status, payload) : payload;
    };
    const [flightsResult, systemResult, jobsResult] = await Promise.allSettled([
      getFlightsFn(),
      readJson(manifestUrl(globalThis.DATA || 'data')),
      readJson('/api/jobs', true),
    ]);
    return {
      flights: flightsResult.status === 'fulfilled' && Array.isArray(flightsResult.value) ? flightsResult.value : [],
      system: systemResult.status === 'fulfilled' ? systemResult.value : {},
      jobs: jobsResult.status === 'fulfilled' ? jobsResult.value.jobs : [],
      states: {
        flights: flightsResult.status === 'fulfilled' ? 'ready' : 'error',
        system: systemResult.status === 'fulfilled' ? 'ready' : 'error',
        jobs: jobsResult.status === 'fulfilled' ? jobsResult.value.state : 'error',
      },
    };
  }

  return { MODULES, classifyJobsResponse, greetingFor, manifestUrl, buildHomeViewModel, loadHomeData };
});
