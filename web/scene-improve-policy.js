(function exposeSceneImprovePolicy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SceneImprovePolicy = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const DEFAULT_LIMITS = Object.freeze({
    max_sources: 16,
    max_duration_s: 1200,
    max_distance_m: 500,
    max_photos: 80,
  });

  const ROLE_ORDER = Object.freeze([
    'Órbita y fachadas',
    'Cubierta y detalle',
    'Contexto del sitio',
    'Cobertura adicional',
  ]);

  const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  function evidenceFor(candidate) {
    const report = candidate?.report || {};
    const gps = report.gps || {};
    const suitability = report.suitability || {};
    return {
      durationS: Math.max(0, finite(candidate?.durationS ?? report.duration_s)),
      distanceM: finite(candidate?.distanceM ?? gps.distance_m, NaN),
      altitudeM: finite(candidate?.altitudeM ?? gps.alt_max_m, NaN),
      headings: Math.max(0, finite(gps.heading_sectors)),
      ortho: Math.max(0, finite(suitability.ortho_dsm)),
      mesh: Math.max(0, finite(suitability.mesh)),
      splat: Math.max(0, finite(suitability.splat)),
    };
  }

  function classifyCapture(candidate) {
    const evidence = evidenceFor(candidate);
    const sameSite = candidate?.sameSite !== false && Number.isFinite(evidence.distanceM);
    const reasons = [];
    const lowThreeD = evidence.mesh < 6 && evidence.splat < 6;
    const tooShort = evidence.durationS < 20;
    const invalidAltitude = Number.isFinite(evidence.altitudeM) && evidence.altitudeM < 0;
    const weak = !sameSite || tooShort || invalidAltitude || lowThreeD;

    let role = 'Cobertura adicional';
    if (evidence.durationS >= 160 && evidence.headings >= 4) {
      role = 'Contexto del sitio';
    } else if (evidence.altitudeM >= 80 && evidence.ortho >= 8
        && evidence.durationS >= 20 && evidence.durationS < 90) {
      role = 'Cubierta y detalle';
    } else if (evidence.headings >= 5 && evidence.mesh >= 7 && evidence.splat >= 7) {
      role = 'Órbita y fachadas';
    } else if (evidence.headings >= 4 && evidence.durationS >= 60) {
      role = 'Órbita y fachadas';
    }

    if (!sameSite) reasons.push('Fuera del sitio o sin GPS verificable.');
    if (tooShort) reasons.push('Video muy corto para aportar cobertura estable.');
    if (invalidAltitude) reasons.push('Altitud relativa inválida para recomendación automática.');
    if (lowThreeD) reasons.push('Geometría 3D limitada en el análisis de captura.');
    if (!weak) {
      if (role === 'Órbita y fachadas') reasons.push('Añade paralaje y varios ángulos de fachada.');
      if (role === 'Cubierta y detalle') reasons.push('Refuerza cubierta y detalle cenital.');
      if (role === 'Contexto del sitio') reasons.push('Amplía el contexto alrededor del edificio.');
      if (role === 'Cobertura adicional') reasons.push('Añade cobertura compatible del mismo sitio.');
    }

    const threeD = (evidence.mesh + evidence.splat) / 2;
    const roleBonus = role === 'Cobertura adicional' ? 0 : 12;
    const score = Math.round((threeD * 8
      + Math.min(8, evidence.headings) * 2
      + Math.min(10, evidence.durationS / 18)
      + roleBonus) * 10) / 10;
    return { role, label: role, weak, score, reasons, evidence };
  }

  function normalizeLimits(limits) {
    return {
      max_sources: Math.max(1, finite(limits?.max_sources, DEFAULT_LIMITS.max_sources)),
      max_duration_s: Math.max(1, finite(limits?.max_duration_s, DEFAULT_LIMITS.max_duration_s)),
      max_distance_m: Math.max(1, finite(limits?.max_distance_m, DEFAULT_LIMITS.max_distance_m)),
      max_photos: Math.max(0, finite(limits?.max_photos, DEFAULT_LIMITS.max_photos)),
    };
  }

  function selectionTotals(items) {
    return {
      sources: items.length,
      durationS: Math.round(items.reduce((sum, item) => sum + Math.max(0, finite(item?.durationS)), 0)),
    };
  }

  function validateSelection(items, limits) {
    const safeLimits = normalizeLimits(limits);
    const totals = selectionTotals(items || []);
    const errors = [];
    if (totals.sources > safeLimits.max_sources) {
      errors.push(`Máximo ${safeLimits.max_sources} videos por versión.`);
    }
    if (totals.durationS > safeLimits.max_duration_s) {
      errors.push(`Máximo ${Math.round(safeLimits.max_duration_s / 60)} min de video por versión.`);
    }
    return { valid: errors.length === 0, errors, totals, limits: safeLimits };
  }

  function resolveActiveModel(models, requestedModel, scene) {
    const activeId = scene?.active_version;
    if (!activeId || !Array.isArray(models)) return requestedModel || null;
    return models.find(model => model?.clip_id === activeId) || requestedModel || null;
  }

  function buildImprovementPlan({ baseSources = [], candidates = [], limits } = {}) {
    const safeLimits = normalizeLimits(limits);
    const locked = baseSources
      .filter(item => item?.id)
      .map(item => ({ ...item, durationS: Math.max(0, finite(item.durationS)), locked: true }));
    const baseNewest = locked.reduce((latest, source) => {
      const timestamp = Date.parse(source.captureAt || '');
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, 0);
    const classified = candidates
      .filter(item => item?.id && !locked.some(base => base.id === item.id))
      .map((item, index) => {
        const timestamp = Date.parse(item.captureAt || '');
        const olderThanBase = baseNewest > 0 && Number.isFinite(timestamp) && timestamp <= baseNewest;
        const classification = classifyCapture(item);
        return { ...item, index, classification: olderThanBase ? {
          ...classification,
          olderThanBase: true,
          reasons: ['Captura anterior a la versión activa; disponible para selección manual.',
            ...classification.reasons],
        } : { ...classification, olderThanBase: false } };
      });
    const eligible = classified.filter(item => !item.classification.weak
      && !item.classification.olderThanBase);
    const ordered = ROLE_ORDER.flatMap(role => eligible
      .filter(item => item.classification.role === role)
      .sort((a, b) => Math.round(b.classification.score / 5)
        - Math.round(a.classification.score / 5) || a.index - b.index));

    const selected = [...locked];
    const recommended = [];
    for (const item of ordered) {
      const attempt = [...selected, item];
      if (!validateSelection(attempt, safeLimits).valid) continue;
      selected.push(item);
      recommended.push(item);
    }
    const roles = ROLE_ORDER.filter(role => recommended.some(item => item.classification.role === role));
    const totals = selectionTotals(selected);
    return {
      items: classified,
      recommendedIds: recommended.map(item => item.id),
      selectedIds: selected.map(item => item.id),
      totals,
      roles,
      limits: safeLimits,
    };
  }

  return {
    DEFAULT_LIMITS,
    ROLE_ORDER,
    buildImprovementPlan,
    classifyCapture,
    resolveActiveModel,
    selectionTotals,
    validateSelection,
  };
}));
