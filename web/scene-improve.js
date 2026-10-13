import { fmt } from './ui/format.js?v=433';
import { term } from './ui/terms.js?v=433';
import { originalInputs } from './scene-improve-state.js?v=433';
import { sceneTitle, areaNav, hydrateSceneCovers } from './scene-improve-ui.js?v=433';
/* global renderShell, pageHead, getFlights, authFetch, api, fmt, icon, haversine, SceneImprovePolicy */

const root = document.getElementById('scene-improve-root');
const shellMain = renderShell('tresd.html');
shellMain.classList.add('ab-page', 'ab-page--wide');
shellMain.append(root);

const {
  buildImprovementPlan,
  classifyCapture,
  isPhotoSetSource,
  resolveActiveModel,
  sourceLabel,
  validateSelection,
} = SceneImprovePolicy;
const modelId = new URLSearchParams(location.search).get('id') || '';
const state = {
  model: null,
  flights: [],
  scenes: [],
  scene: null,
  limits: SceneImprovePolicy.DEFAULT_LIMITS,
  baseSources: [],
  basePhotos: [],
  candidates: [],
  plan: null,
  selected: new Set(),
  reportsLoaded: false,
  error: '',
};

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const durationFor = flight => finite(flight?.duration_s) || finite(flight?.stats?.duration_s) || 0;
const dateLabel = flight => [flight?.date ? fmt.date(flight.date) : '', flight?.time || '']
  .filter(Boolean).join(' · ') || 'Fecha no registrada';

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

// Fuente = pasada de fotos (set:<set>/<pasada>): fila propia, sin vuelo/manifest de clip.
function photoSetRow(source, { selected = false, locked = false } = {}) {
  const count = Number(source.photoCount) || 0;
  const cov = Number.isFinite(Number(source.gpsCoverage)) ? `${Math.round(Number(source.gpsCoverage) * 100)}% GPS` : null;
  const evidence = [count ? `${count} fotos` : 'fotos', cov, source.status ? `estado: ${source.status}` : null]
    .filter(Boolean).join(' · ');
  const thumb = source.quality?.eligible === true && source.thumbRel
    ? `<img src="/api/photo_thumb?rel=${encodeURIComponent(source.thumbRel).replace(/%2F/g, '/')}&w=160" alt="Vista previa de ${esc(sourceLabel(source.id))}" loading="lazy" >`
    : '<span class="si-thumb-empty" aria-hidden="true"></span>';
  return `<label class="si-capture si-photo-set${selected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}">
    <input type="checkbox" data-source-id="${esc(source.id)}" ${selected ? 'checked' : ''} ${locked ? 'disabled' : ''}>
    ${thumb}
    <span class="si-capture-copy">
      <span class="si-capture-title"><b>${esc(sourceLabel(source.id))}</b><span class="si-role">Fotos</span></span>
      <span class="si-evidence">${esc(evidence)}</span>
    </span>
  </label>`;
}

function captureRow(candidate, { selected = false, locked = false } = {}) {
  if (isPhotoSetSource(candidate.id)) return photoSetRow(candidate, { selected, locked });
  const classification = candidate.classification || classifyCapture(candidate);
  const report = candidate.report || {};
  const suitability = report.suitability || {};
  const flight = candidate.flight || {};
  const score = Math.round(Math.max(finite(suitability.mesh) || 0, finite(suitability.splat) || 0) * 10);
  const evidence = [
    `${fmt.duration(candidate.durationS)} video`,
    Number.isFinite(candidate.distanceM) ? `${Math.round(candidate.distanceM)} m del sitio` : 'GPS no medible',
    Number.isFinite(candidate.altitudeM) ? `${Math.round(candidate.altitudeM)} m de altura` : null,
    !locked && score ? `aporte 3D ${score}` : null,
  ].filter(Boolean).join(' · ');
  return `<label class="si-capture${selected ? ' is-selected' : ''}${classification.weak ? ' is-weak' : ''}${locked ? ' is-locked' : ''}">
    <input type="checkbox" data-source-id="${esc(candidate.id)}" ${selected ? 'checked' : ''} ${locked ? 'disabled' : ''}>
    <img hidden data-scene-cover="${esc(candidate.id)}" alt="Vista previa del vuelo ${esc(dateLabel(flight))}" loading="lazy">
    <span class="si-capture-copy">
      <span class="si-capture-title"><b>${esc(dateLabel(flight))}</b>
        <span class="si-role">${esc(classification.role)}</span></span>
      <span class="si-evidence">${esc(evidence)}</span>
      ${locked ? '' : `<span class="si-reason">${esc(classification.reasons[0] || 'Captura compatible del mismo sitio.')}</span>`}
    </span>
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
  document.querySelectorAll('[data-si-source-count]').forEach(node => {
    const sets = validation.totals.photoSets || 0;
    node.textContent = sets ? `${validation.totals.sources - sets} + ${sets} fotos` : validation.totals.sources;
  });
  document.querySelectorAll('[data-si-duration]').forEach(node => { node.textContent = fmt.duration(validation.totals.durationS); });
  document.querySelectorAll('[data-si-roles]').forEach(roleNode => { roleNode.innerHTML = roles.length
    ? roles.map(role => `<span>${esc(role)}</span>`).join('')
    : '<span>Selecciona al menos una captura nueva</span>'; });
  const preset = document.getElementById('si-splat-preset');
  const label = document.getElementById('si-splat-summary');
  if (label && preset) label.textContent = document.getElementById('si-then-splat').checked ? `${term('splat')} · ${preset.selectedOptions[0].textContent}` : 'Sin escena fotorrealista';
  const odm = document.getElementById('si-preset');
  const odmLabel = document.getElementById('si-odm-summary');
  if (odmLabel && odm) odmLabel.textContent = `${term('mesh')} · ${odm.selectedOptions[0].textContent}`;
  const error = state.error || validation.errors[0] || (!additions.length ? 'Añade una captura nueva para crear otra versión.' : '');
  const status = document.getElementById('si-action-status');
  if (status) status.textContent = error;
  const button = document.getElementById('si-submit');
  if (button) button.disabled = !validation.valid || !additions.length;
  const fill = document.querySelector('[data-si-budget-fill]');
  if (fill) fill.style.setProperty('--p', Math.min(1, validation.totals.durationS / state.limits.max_duration_s).toFixed(3));
}

function wireSelection() {
  root.addEventListener('change', event => {
    const input = event.target.closest('[data-source-id]');
    if (!input) { updateReview(); return; }
    if (input.disabled) return;
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
    ${shell.backLink('Escenas', '/tresd.html')}
    ${pageHead(`Mejorar ${esc(sceneTitle(model.title || 'esta escena'))}`,
      'Añade tomas del mismo lugar. Conserva la versión actual hasta revisar el resultado.',
      `<span class="chip ok">${icon('check')} Versión actual protegida</span>`)}

    <div class="si-layout">
      <div class="si-flow">
        <section class="panel si-section" aria-labelledby="si-base-title">
          <div class="si-step"><span>01</span><div><h2 id="si-base-title">Base de la mejora</h2><p>Conserva estas capturas y añade nuevos ángulos.</p></div></div>
          <div class="si-base-card">
            <img hidden data-scene-cover="${esc(model.clip_id)}" alt="Captura de ${esc(sceneTitle(model.title || 'la escena'))}">
            <div><h3>${esc(sceneTitle(model.title || model.clip_id))}</h3>
              <p>${q.cameras_reconstructed ?? '—'} cámaras · ${fmt.number(q.gsd_cm_px,1)} cm/px · ${q.area_m2 ? fmt.area(q.area_m2 / 10000) : 'área no medida'}</p>
              <p>Podrás comparar ambas versiones antes de elegir.</p></div>
          </div>
          <div class="si-current"><h3>Capturas actuales${state.basePhotos.length ? ` · ${state.basePhotos.length} fotos conservadas` : ''}</h3><div class="si-capture-list">${currentRows}</div></div>
        </section>

        <section class="panel si-section" aria-labelledby="si-captures-title">
          <div class="si-step"><span>02</span><div><h2 id="si-captures-title">Añadir capturas</h2>
            <p>Elige tomas que muestren lados y alturas diferentes.</p></div></div>
          <div class="si-callout">${icon('layers')} <span><b>${recommended.length} capturas recomendadas</b>
            <small>Selección automática dentro del límite real de ${state.limits.max_sources} videos y ${state.limits.max_duration_s / 60} minutos.</small></span></div>
          <div class="si-capture-list">${recommended.length ? recommended.map(candidate => captureRow(candidate, { selected: state.selected.has(candidate.id) })).join('') : '<div class="ui-empty"><p>No hay capturas nuevas recomendadas para esta escena.</p><a class="ui-button ui-button--secondary" href="subir.html">Subir capturas</a><p>Prueba con una órbita baja y una vista cenital del mismo lugar.</p></div>'}</div>
          <details class="si-other"${others.length ? '' : ' hidden'}>
            <summary>Otras capturas compatibles <span>${others.length}</span></summary>
            <p>Disponibles para revisión manual. Las capturas débiles explican por qué no fueron seleccionadas.</p>
            <div class="si-capture-list">${others.map(candidate => captureRow(candidate, { selected: state.selected.has(candidate.id) })).join('')}</div>
          </details>
        </section>

        <section class="panel si-section" aria-labelledby="si-build-title">
          <div class="si-step"><span>03</span><div><h2 id="si-build-title">Reconstrucción</h2>
            <p>Reconstruye la escena con todas las capturas seleccionadas.</p></div></div>
          <div class="si-build-choice">
            <span>${icon('cube')}</span><div><b id="si-odm-summary">Modelo 3D · Edificios</b><small>Volumen del edificio, elevación del terreno y foto aérea.</small></div><em>Recomendado</em>
          </div>
          <div class="si-build-choice">
            <span>${icon('layers')}</span><div><b id="si-splat-summary">Escena fotorrealista · Equilibrada</b><small>Conserva la calidad elegida durante todo el proceso.</small></div>
          </div>
          <details class="si-advanced">
            <summary>Ajustes avanzados</summary>
            <div class="si-settings">
              <label>Calidad del modelo<select class="ctl" id="si-preset"><option value="extra">Extra 3D · edificio</option><option value="alta">Alta · puntos y relieve</option><option value="estandar">Estándar</option><option value="rapido">Rápida</option><option value="ultra">Ultra 3D</option></select></label>
              <label>Escena fotorrealista<select class="ctl" id="si-splat-preset"><option value="mcmc1m">Equilibrada</option><option value="mcmc3m">Mayor detalle (experimental)</option><option value="grandmaster">${term('grandmaster')}</option><option value="frontier">${term('frontier')}</option><option value="ultra20">${term('ultra20')}</option><option value="ultra">${term('ultra')}</option></select></label>
              <label>Resolución<select class="ctl" id="si-resolution"><option value="auto">Automática según memoria disponible</option><option value="full">Solo completa</option><option value="half">Media resolución</option></select></label>
              <label class="si-check"><input type="checkbox" id="si-then-splat" checked> Generar escena fotorrealista después del modelo</label>
            </div>
          </details>
        </section>

        <section class="panel si-section si-mobile-review" aria-labelledby="si-review-mobile-title">
          <div class="si-step"><span>04</span><div><h2 id="si-review-mobile-title">Revisar y crear versión</h2></div></div>
          <div class="si-mobile-summary"><b><span data-si-source-count></span> videos · <span data-si-duration></span></b><span data-si-roles></span></div>
        </section>
      </div>

      <aside class="si-review" aria-labelledby="si-review-title">
        <h2 id="si-review-title">Revisar selección</h2>
        <div class="si-review-kpis"><div><b data-si-source-count></b><span>videos / ${state.limits.max_sources}</span></div>
          <div><b data-si-duration></b><span>duración / ${state.limits.max_duration_s / 60} min</span></div></div>
        <div class="si-budget"><i data-si-budget-fill></i></div>
        <div class="si-role-summary" data-si-roles></div>
        <div class="si-truth">${icon('shield')} <span><b>Sin reemplazo automático</b><small>Revisa el resultado antes de usarlo como versión actual.</small></span></div>
        <p id="si-action-status" class="si-action-status" aria-live="polite"></p>
        <button class="ui-button ui-button--primary si-submit" id="si-submit">${icon('layers')} Crear versión mejorada</button>
        <a href="tresd.html?project=${encodeURIComponent(modelId)}" class="btn ghost si-cancel">Cancelar y volver</a>
      </aside>
    </div>`;
  hydrateSceneCovers(root, [model]);
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
        photos: state.basePhotos,
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
      photos: state.basePhotos,
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
    <p>La nueva reconstrucción combinará <b>${result.sources}</b> videos. Cuando termine podrás comparar las vistas antes de elegir la nueva versión.</p>
    <div class="si-success-facts"><span><small>Trabajo</small><b class="mono">${esc(result.job)}</b></span>
      <span><small>Reconstrucción</small><b class="mono">${esc(result.reconstruction)}</b></span></div>
    <div class="si-success-actions"><a class="ui-button ui-button--primary" href="tresd.html?tab=jobs&job=${encodeURIComponent(result.job)}">${icon('activity')} Ver procesamiento</a>
      <a class="btn" href="tresd.html">Volver a 3D</a></div>
  </section>`;
  root.focus?.();
}

function renderFailure(message) {
  root.className = 'si-failure';
  root.setAttribute('aria-busy', 'false');
  root.innerHTML = `${areaNav('escenas')}<div class="ui-empty"><h1>No se pudo abrir la escena</h1>
    <p>${esc(message)}</p><a class="ui-button ui-button--primary" href="tresd.html">Volver a 3D</a></div>`;
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
    const models = systemResponse.models || [];
    const requestedModel = models.find(model => model.clip_id === modelId);
    if (!requestedModel) return renderFailure('Este modelo no existe o ya no está disponible.');
    state.model = requestedModel;
    state.flights = flights;
    state.scenes = scenesResponse.scenes || [];
    state.limits = scenesResponse.limits || state.limits;
    state.scene = findScene(requestedModel);
    const version = activeVersion(state.scene);
    state.model = resolveActiveModel(models, requestedModel, state.scene);
    const inputs = originalInputs(state.model, version);
    const baseIds = inputs.sources;
    state.basePhotos = inputs.photos;
    if (!baseIds.length && !state.basePhotos.length) return renderFailure('No se encontraron las capturas originales de esta escena.');
    const evidenceById = Object.fromEntries((state.scene?.source_evidence || []).map(row => [row.clip_id, row]));
    state.baseSources = baseIds.map(id => {
      if (isPhotoSetSource(id)) {
        // pasada de fotos: datos de la evidencia de escena / reconstruction.sources, jamás de un vuelo
        const ev = evidenceById[id] || (state.model?.reconstruction?.sources || [])
          .find(row => row && row.clip_id === id) || {};
        return { id, kind: 'photo_set', durationS: 0, sameSite: true, distanceM: 0,
          photoCount: ev.photo_count ?? ev.submitted, gpsCoverage: ev.gps_coverage,
          thumbRel: ev.thumb_rel, quality: ev.quality, status: ev.status,
          classification: { role: 'Fotos', weak: false, reasons: [] } };
      }
      const flight = flights.find(item => item.clip_id === id) || {};
      return { id, durationS: durationFor(flight), flight, sameSite: true, distanceM: 0,
        altitudeM: finite(flight.stats?.max_rel_alt_m),
        captureAt: flight.date ? `${flight.date}T${flight.time || '00:00:00'}` : '',
        classification: { role: 'Activa', weak: false, reasons: [] } };
    });
    const baseFlight = flights.find(flight => flight.clip_id === baseIds.find(id => !isPhotoSetSource(id)))
      || flights.find(flight => flight.clip_id === requestedModel.clip_id);
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
