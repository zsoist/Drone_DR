/* global renderShell, getFlights, authFetch, api, fmt, icon, haversine, SceneImprovePolicy */

const root = document.getElementById('scene-improve-root');
const shellMain = renderShell('tresd.html');
shellMain.append(root);

const { buildImprovementPlan, classifyCapture, validateSelection } = SceneImprovePolicy;
const modelId = new URLSearchParams(location.search).get('id') || '';
const state = {
  model: null,
  flights: [],
  scenes: [],
  scene: null,
  limits: SceneImprovePolicy.DEFAULT_LIMITS,
  baseSources: [],
  candidates: [],
  plan: null,
  selected: new Set(),
  reportsLoaded: false,
  error: '',
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const durationFor = flight => finite(flight?.duration_s) || finite(flight?.stats?.duration_s) || 0;
const dateLabel = flight => [flight?.date ? fmt.date(flight.date) : '', flight?.time || '']
  .filter(Boolean).join(' · ') || 'Fecha no registrada';
const thumbFor = id => `data/thumbs/${encodeURIComponent(id)}.jpg`;
const modelThumb = model => `data/models/${encodeURIComponent(model.clip_id)}/${encodeURIComponent(model.ortho_asset || 'ortho.jpg')}`;

function bboxCenter(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(item => Number.isFinite(Number(item)))) return null;
  return { lon: (Number(value[0]) + Number(value[2])) / 2,
    lat: (Number(value[1]) + Number(value[3])) / 2 };
}

function modelCenter(model, baseFlight) {
  const fromFlight = bboxCenter(baseFlight?.stats?.bbox);
  if (fromFlight) return fromFlight;
  const corners = model?.dsm_corners || model?.corners || [];
  const lons = corners.map(point => finite(point?.[0])).filter(Number.isFinite);
  const lats = corners.map(point => finite(point?.[1])).filter(Number.isFinite);
  return lons.length && lats.length
    ? { lon: (Math.min(...lons) + Math.max(...lons)) / 2,
      lat: (Math.min(...lats) + Math.max(...lats)) / 2 }
    : null;
}

function activeVersion(scene) {
  return (scene?.versions || []).find(version => version.id === scene.active_version) || null;
}

function findScene(model) {
  return state.scenes.find(scene => (scene.versions || []).some(version =>
    version.id === model.clip_id || (version.sources || []).includes(model.clip_id))) || null;
}

function captureRow(candidate, { selected = false, locked = false } = {}) {
  const classification = candidate.classification || classifyCapture(candidate);
  const report = candidate.report || {};
  const suitability = report.suitability || {};
  const flight = candidate.flight || {};
  const score = Math.round(Math.max(finite(suitability.mesh) || 0, finite(suitability.splat) || 0) * 10);
  const evidence = [
    `${fmt.dur(candidate.durationS)} video`,
    Number.isFinite(candidate.distanceM) ? `${Math.round(candidate.distanceM)} m del sitio` : 'GPS no medible',
    Number.isFinite(candidate.altitudeM) ? `${Math.round(candidate.altitudeM)} m AGL` : null,
  ].filter(Boolean).join(' · ');
  return `<label class="si-capture${selected ? ' is-selected' : ''}${classification.weak ? ' is-weak' : ''}${locked ? ' is-locked' : ''}">
    <input type="checkbox" data-source-id="${esc(candidate.id)}" ${selected ? 'checked' : ''} ${locked ? 'disabled' : ''}>
    <img src="${thumbFor(candidate.id)}" alt="Vista previa del vuelo ${esc(dateLabel(flight))}" loading="lazy">
    <span class="si-capture-copy">
      <span class="si-capture-title"><b>${esc(dateLabel(flight))}</b>
        <span class="si-role">${esc(classification.role)}</span></span>
      <span class="si-evidence mono">${esc(evidence)}</span>
      <span class="si-reason">${esc(classification.reasons[0] || 'Captura compatible del mismo sitio.')}</span>
    </span>
    <span class="si-quality"><b>${score || '—'}</b><small>aporte 3D</small></span>
    ${locked ? '<span class="si-locked">Fuente activa</span>' : ''}
  </label>`;
}

function selectedSources() {
  const baseById = new Map(state.baseSources.map(source => [source.id, source]));
  const candidateById = new Map(state.candidates.map(candidate => [candidate.id, candidate]));
  return [...state.selected].map(id => baseById.get(id) || candidateById.get(id)).filter(Boolean);
}

function updateReview() {
  const selected = selectedSources();
  const validation = validateSelection(selected, state.limits);
  const additions = selected.filter(item => !state.baseSources.some(base => base.id === item.id));
  const roles = SceneImprovePolicy.ROLE_ORDER.filter(role => additions.some(item =>
    (item.classification || classifyCapture(item)).role === role));
  document.querySelectorAll('[data-si-source-count]').forEach(node => { node.textContent = validation.totals.sources; });
  document.querySelectorAll('[data-si-duration]').forEach(node => { node.textContent = fmt.dur(validation.totals.durationS); });
  const roleNode = document.querySelector('[data-si-roles]');
  if (roleNode) roleNode.innerHTML = roles.length
    ? roles.map(role => `<span>${esc(role)}</span>`).join('')
    : '<span>Selecciona al menos una captura nueva</span>';
  const error = state.error || validation.errors[0] || (!additions.length ? 'Añade una captura nueva para crear otra versión.' : '');
  const status = document.getElementById('si-action-status');
  if (status) status.textContent = error;
  const button = document.getElementById('si-submit');
  if (button) button.disabled = !validation.valid || !additions.length;
  const fill = document.querySelector('[data-si-budget-fill]');
  if (fill) fill.style.width = `${Math.min(100, validation.totals.durationS / state.limits.max_duration_s * 100)}%`;
}

function wireSelection() {
  root.addEventListener('change', event => {
    const input = event.target.closest('[data-source-id]');
    if (!input || input.disabled) return;
    const id = input.dataset.sourceId;
    if (input.checked) state.selected.add(id); else state.selected.delete(id);
    const validation = validateSelection(selectedSources(), state.limits);
    if (!validation.valid) {
      state.selected.delete(id);
      input.checked = false;
      state.error = validation.errors[0];
    } else {
      state.error = '';
      input.closest('.si-capture')?.classList.toggle('is-selected', input.checked);
    }
    updateReview();
  });
}

function renderWorkspace() {
  const model = state.model;
  const q = model.qa || {};
  const recommended = state.candidates.filter(candidate => state.plan.recommendedIds.includes(candidate.id));
  const others = state.candidates.filter(candidate => !state.plan.recommendedIds.includes(candidate.id));
  const currentRows = state.baseSources.map(source => captureRow(source, { selected: true, locked: true })).join('');
  root.className = 'si-workspace';
  root.setAttribute('aria-busy', 'false');
  root.innerHTML = `
    <header class="si-head">
      <a class="si-back" href="tresd.html">${icon('chevLeft')} Modelos 3D</a>
      <div>
        <span class="eyebrow">NUEVA VERSIÓN · ESCENA EXISTENTE</span>
        <h1>Mejorar ${esc(model.title || 'esta escena')}</h1>
        <p>Combina nuevas tomas del mismo edificio. La versión visible hoy no cambia hasta que la nueva pase registro y control de calidad.</p>
      </div>
      <span class="si-safe">${icon('check')} Versión actual protegida</span>
    </header>

    <div class="si-layout">
      <div class="si-flow">
        <section class="panel si-section" aria-labelledby="si-base-title">
          <div class="si-step"><span>01</span><div><h2 id="si-base-title">Base de la mejora</h2><p>Esta es la geometría que vamos a reconstruir con más evidencia.</p></div></div>
          <div class="si-base-card">
            <img src="${modelThumb(model)}" alt="Ortofoto actual de ${esc(model.title || 'la escena')}">
            <div><span class="eyebrow">ESCENA ACTIVA</span><h3>${esc(model.title || model.clip_id)}</h3>
              <p class="mono">${q.cameras_reconstructed ?? '—'} cámaras · ${q.gsd_cm_px ?? '—'} cm/px · ${q.area_m2 ? (q.area_m2 / 10000).toFixed(1) + ' ha' : 'área no medida'}</p>
              <p>Se crea una versión independiente; podrás comparar y promoverla después.</p></div>
          </div>
          <div class="si-current"><h3>Fuentes actuales</h3>${currentRows}</div>
        </section>

        <section class="panel si-section" aria-labelledby="si-captures-title">
          <div class="si-step"><span>02</span><div><h2 id="si-captures-title">Capturas que realmente aportan</h2>
            <p>Priorizamos paralaje, ángulos complementarios y calidad 3D; no solo cercanía.</p></div></div>
          <div class="si-callout">${icon('spark')} <span><b>${recommended.length} capturas recomendadas</b>
            <small>Selección automática dentro del límite real de ${state.limits.max_sources} videos y ${state.limits.max_duration_s / 60} minutos.</small></span></div>
          <div class="si-capture-list">${recommended.map(candidate => captureRow(candidate, { selected: state.selected.has(candidate.id) })).join('')}</div>
          <details class="si-other">
            <summary>Otras capturas compatibles <span>${others.length}</span></summary>
            <p>Disponibles para revisión manual. Las capturas débiles explican por qué no fueron seleccionadas.</p>
            <div class="si-capture-list">${others.map(candidate => captureRow(candidate, { selected: state.selected.has(candidate.id) })).join('')}</div>
          </details>
        </section>

        <section class="panel si-section" aria-labelledby="si-build-title">
          <div class="si-step"><span>03</span><div><h2 id="si-build-title">Reconstrucción</h2>
            <p>Un preset equilibrado para recuperar fachadas, cubierta y contexto sin ocultar fallbacks.</p></div></div>
          <div class="si-build-choice">
            <span>${icon('cube')}</span><div><b>ODM Alta · NVIDIA CUDA</b><small>Fotogrametría, nube, DSM, ortofoto y malla texturizada.</small></div><em>RECOMENDADO</em>
          </div>
          <div class="si-build-choice">
            <span>${icon('spark')}</span><div><b>Gaussian Grandmaster 40K · CUDA</b><small>Máximo refinamiento estricto; no sustituye la solicitud por un tier inferior.</small></div><em>40K</em>
          </div>
          <details class="si-advanced">
            <summary>Ajustes avanzados</summary>
            <div class="si-settings">
              <label>Calidad ODM<select class="ctl" id="si-preset"><option value="alta">Alta</option><option value="media">Media</option><option value="rapida">Rápida</option></select></label>
              <label>Gaussian<select class="ctl" id="si-splat-preset"><option value="grandmaster">Grandmaster 40K</option><option value="frontier">Frontier 30K</option><option value="ultra20">Ultra+ 20K</option><option value="ultra">Ultra 15K</option></select></label>
              <label>Resolución CUDA<select class="ctl" id="si-resolution"><option value="auto">Completa → ½ solo por OOM</option><option value="full">Solo completa</option><option value="half">½ desde el inicio</option></select></label>
              <label class="si-check"><input type="checkbox" id="si-then-splat" checked> Generar Gaussian después de ODM</label>
            </div>
          </details>
        </section>

        <section class="panel si-section si-mobile-review" aria-labelledby="si-review-mobile-title">
          <div class="si-step"><span>04</span><div><h2 id="si-review-mobile-title">Revisar y crear versión</h2></div></div>
          <div class="si-mobile-summary"><b><span data-si-source-count></span> videos · <span data-si-duration></span></b><span data-si-roles></span></div>
        </section>
      </div>

      <aside class="si-review" aria-labelledby="si-review-title">
        <span class="eyebrow">PLAN DE MEJORA</span><h2 id="si-review-title">Lista para reconstruir</h2>
        <div class="si-review-kpis"><div><b data-si-source-count></b><span>videos / ${state.limits.max_sources}</span></div>
          <div><b data-si-duration></b><span>duración / ${state.limits.max_duration_s / 60} min</span></div></div>
        <div class="si-budget"><i data-si-budget-fill></i></div>
        <div class="si-role-summary" data-si-roles></div>
        <div class="si-truth">${icon('shield')} <span><b>Sin reemplazo automático</b><small>La versión nueva se promueve solo después de confirmar registro FULL y artefactos.</small></span></div>
        <p id="si-action-status" class="si-action-status" aria-live="polite"></p>
        <button class="btn primary si-submit" id="si-submit">${icon('layers')} Crear versión mejorada</button>
        <a href="tresd.html" class="si-cancel">Cancelar y volver</a>
      </aside>
    </div>`;
  wireSelection();
  document.getElementById('si-submit')?.addEventListener('click', submitImprovement);
  updateReview();
}

async function submitImprovement() {
  const button = document.getElementById('si-submit');
  const status = document.getElementById('si-action-status');
  state.error = '';
  updateReview();
  button.disabled = true;
  button.innerHTML = `${icon('activity')} Validando y encolando…`;
  status.textContent = 'El servidor está verificando sitio, duración y fuentes.';
  try {
    let scene = state.scene;
    if (!scene) {
      const center = modelCenter(state.model, state.flights.find(flight => flight.clip_id === state.model.clip_id));
      const created = await api('/api/scene_create', {
        title: state.model.title || 'Escena mejorada',
        anchor: center ? { lat: center.lat, lon: center.lon } : {},
        sources: state.baseSources.map(source => source.id),
        photos: [],
        existing_version: state.model.clip_id,
      });
      if (created.error) throw new Error(created.error);
      scene = created.scene;
    }
    const splatEnabled = document.getElementById('si-then-splat').checked;
    const result = await api('/api/scene_improve', {
      scene_id: scene.id,
      title: state.model.title || scene.title,
      sources: selectedSources().map(source => source.id),
      photos: [],
      preset: document.getElementById('si-preset').value,
      backend: 'cuda',
      then_splat: splatEnabled,
      splat_preset: document.getElementById('si-splat-preset').value,
      splat_backend: 'cuda',
      splat_resolution: document.getElementById('si-resolution').value,
      best_available: false,
    });
    if (result.error) throw new Error(result.error);
    renderSuccess(result);
  } catch (error) {
    state.error = error?.message || 'No se pudo crear la versión.';
    button.innerHTML = `${icon('layers')} Crear versión mejorada`;
    updateReview();
    status.focus?.();
  }
}

function renderSuccess(result) {
  root.innerHTML = `<section class="si-success" aria-live="polite">
    <span class="si-success-icon">${icon('check')}</span>
    <span class="eyebrow">VERSIÓN EN COLA</span>
    <h1>La escena actual sigue intacta.</h1>
    <p>La nueva reconstrucción combinará <b>${result.sources}</b> videos. Cuando termine podrás comparar registro, malla y Gaussian antes de promoverla.</p>
    <div class="si-success-facts"><span><small>Trabajo</small><b class="mono">${esc(result.job)}</b></span>
      <span><small>Reconstrucción</small><b class="mono">${esc(result.reconstruction)}</b></span></div>
    <div class="si-success-actions"><a class="btn primary" href="tresd.html?tab=jobs&job=${encodeURIComponent(result.job)}">${icon('activity')} Ver procesamiento</a>
      <a class="btn" href="tresd.html">Volver a Modelos 3D</a></div>
  </section>`;
  root.focus?.();
}

function renderFailure(message) {
  root.className = 'si-failure';
  root.setAttribute('aria-busy', 'false');
  root.innerHTML = `<div class="panel"><span>${icon('warn')}</span><h1>No pudimos abrir esta escena</h1>
    <p>${esc(message)}</p><a class="btn primary" href="tresd.html">Volver a Modelos 3D</a></div>`;
}

async function load() {
  if (!modelId) return renderFailure('Falta el identificador del modelo en el enlace.');
  try {
    const [systemResponse, flights, scenesResponse] = await Promise.all([
      fetch('data/manifest/system.json').then(response => {
        if (!response.ok) throw new Error('No se pudo cargar el catálogo 3D.');
        return response.json();
      }),
      getFlights(),
      authFetch('/api/scenes').then(response => response.json()),
    ]);
    state.model = (systemResponse.models || []).find(model => model.clip_id === modelId);
    if (!state.model) return renderFailure('Este modelo no existe o ya no está disponible.');
    state.flights = flights;
    state.scenes = scenesResponse.scenes || [];
    state.limits = scenesResponse.limits || state.limits;
    state.scene = findScene(state.model);
    const version = activeVersion(state.scene);
    const baseIds = version?.sources?.length ? version.sources : [state.model.clip_id];
    state.baseSources = baseIds.map(id => {
      const flight = flights.find(item => item.clip_id === id) || {};
      return { id, durationS: durationFor(flight), flight, sameSite: true, distanceM: 0,
        altitudeM: finite(flight.stats?.max_rel_alt_m),
        captureAt: flight.date ? `${flight.date}T${flight.time || '00:00:00'}` : '',
        classification: { role: 'Fuente actual', weak: false, reasons: ['Incluida en la versión activa.'] } };
    });
    const baseFlight = flights.find(flight => flight.clip_id === state.model.clip_id);
    const center = modelCenter(state.model, baseFlight);
    const baseSet = new Set(baseIds);
    const nearby = flights.map(flight => {
      const point = bboxCenter(flight.stats?.bbox);
      const distanceM = center && point ? haversine({ lat: center.lat, lon: center.lon }, { lat: point.lat, lon: point.lon }) : null;
      return { id: flight.clip_id, flight, durationS: durationFor(flight), distanceM,
        captureAt: flight.date ? `${flight.date}T${flight.time || '00:00:00'}` : '',
        altitudeM: finite(flight.stats?.max_rel_alt_m),
        sameSite: Number.isFinite(distanceM) && distanceM <= state.limits.max_distance_m };
    }).filter(item => !baseSet.has(item.id) && item.sameSite && !item.flight.archived);
    const hydrated = await Promise.all(nearby.map(async candidate => {
      try {
        const response = await authFetch(`/api/capture_report?clip_id=${encodeURIComponent(candidate.id)}`);
        const report = response.ok ? await response.json() : {};
        return { ...candidate, report };
      } catch { return candidate; }
    }));
    state.candidates = hydrated.map(candidate => ({ ...candidate,
      altitudeM: finite(candidate.report?.gps?.alt_max_m) ?? candidate.altitudeM,
      classification: classifyCapture(candidate) }));
    state.plan = buildImprovementPlan({ baseSources: state.baseSources, candidates: state.candidates, limits: state.limits });
    state.candidates = state.plan.items;
    state.selected = new Set(state.plan.selectedIds);
    renderWorkspace();
  } catch (error) {
    renderFailure(error?.message || 'Error de red al preparar la mejora.');
  }
}

load();
