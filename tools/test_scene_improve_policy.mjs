import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildImprovementPlan,
  classifyCapture,
  validateSelection,
} = require('../web/scene-improve-policy.js');

const limits = {
  max_sources: 16,
  max_duration_s: 1200,
  max_distance_m: 500,
  max_photos: 80,
};

const candidate = (id, durationS, distanceM, altitudeM, suitability, headings = 0) => ({
  id,
  durationS,
  distanceM,
  altitudeM,
  sameSite: true,
  report: {
    gps: { heading_sectors: headings, distance_m: distanceM, alt_max_m: altitudeM },
    suitability,
  },
});

const dialectica = [
  candidate('jul24-1219', 113.1, 208.3, 35.7, { ortho_dsm: 9, mesh: 8.4, splat: 8.7 }, 7),
  candidate('jul24-1221', 124.5, 198.1, 43.3, { ortho_dsm: 9, mesh: 8.4, splat: 8.7 }, 7),
  candidate('jul24-1224', 30.5, 10.1, 97.2, { ortho_dsm: 10, mesh: 7.2, splat: 7.5 }, 1),
  candidate('jul24-1225', 23.7, 1.8, 62.9, { ortho_dsm: 10, mesh: 4.5, splat: 4.5 }, 1),
  candidate('jul24-1226', 21.9, 1.6, 101.5, { ortho_dsm: 10, mesh: 4.5, splat: 4.5 }, 1),
  candidate('jul24-1227', 24.9, 2.2, 99.4, { ortho_dsm: 10, mesh: 4.5, splat: 4.5 }, 1),
  candidate('jul24-1624-short', 9.7, 4.2, -8.2, { ortho_dsm: 8, mesh: 5, splat: 5.1 }, 1),
  candidate('jul24-1624-long', 219, 62.1, 59.5, { ortho_dsm: 9.8, mesh: 6.5, splat: 6.7 }, 6),
];

test('recommends the four complementary Dialectica captures inside the real budget', () => {
  const plan = buildImprovementPlan({
    baseSources: [{ id: 'jul14-base', durationS: 317.9 }],
    candidates: dialectica,
    limits,
  });

  assert.deepEqual(plan.recommendedIds, [
    'jul24-1219',
    'jul24-1221',
    'jul24-1224',
    'jul24-1624-long',
  ]);
  assert.deepEqual(plan.selectedIds, [
    'jul14-base',
    'jul24-1219',
    'jul24-1221',
    'jul24-1224',
    'jul24-1624-long',
  ]);
  assert.equal(plan.totals.sources, 5);
  assert.equal(plan.totals.durationS, 805);
  assert.deepEqual(plan.roles, ['Órbita y fachadas', 'Cubierta y detalle', 'Contexto del sitio']);
});

test('marks stationary, low-3D and negative-altitude clips as weak', () => {
  const lowThreeD = classifyCapture(dialectica[3]);
  const negativeAltitude = classifyCapture(dialectica[6]);

  assert.equal(lowThreeD.weak, true);
  assert.match(lowThreeD.reasons.join(' '), /geometría 3D limitada/i);
  assert.equal(negativeAltitude.weak, true);
  assert.match(negativeAltitude.reasons.join(' '), /muy corto|altitud/i);
});

test('never recommends a cross-site or GPS-unknown capture', () => {
  const plan = buildImprovementPlan({
    baseSources: [{ id: 'base', durationS: 200 }],
    candidates: [
      { ...dialectica[0], id: 'far', sameSite: false, distanceM: 900 },
      { ...dialectica[1], id: 'unknown', sameSite: false, distanceM: null },
    ],
    limits,
  });

  assert.deepEqual(plan.recommendedIds, []);
  assert.deepEqual(plan.selectedIds, ['base']);
});

test('older captures stay available but are not recommended over the active version', () => {
  const plan = buildImprovementPlan({
    baseSources: [{ id: 'base', durationS: 200, captureAt: '2026-07-14T16:30:00' }],
    candidates: [
      { ...dialectica[0], id: 'older-high-score', captureAt: '2026-07-09T14:50:00' },
      { ...dialectica[1], id: 'newer', captureAt: '2026-07-24T12:21:00' },
    ],
    limits,
  });

  assert.deepEqual(plan.recommendedIds, ['newer']);
  assert.equal(plan.items.find(item => item.id === 'older-high-score').classification.olderThanBase, true);
});

test('locked base sources consume source and duration budget', () => {
  const many = Array.from({ length: 18 }, (_, index) => candidate(
    `candidate-${index + 1}`,
    90,
    100 + index,
    40,
    { ortho_dsm: 9, mesh: 8.5, splat: 8.5 },
    7,
  ));
  const constrained = { ...limits, max_sources: 4, max_duration_s: 500 };
  const plan = buildImprovementPlan({
    baseSources: [{ id: 'base-a', durationS: 200 }, { id: 'base-b', durationS: 200 }],
    candidates: many,
    limits: constrained,
  });

  assert.equal(plan.totals.sources, 3);
  assert.equal(plan.totals.durationS, 490);
  assert.deepEqual(plan.selectedIds.slice(0, 2), ['base-a', 'base-b']);
});

test('selection validation reports both count and duration overflow', () => {
  const result = validateSelection([
    { id: 'a', durationS: 700 },
    { id: 'b', durationS: 600 },
    { id: 'c', durationS: 1 },
  ], { ...limits, max_sources: 2 });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    'Máximo 2 videos por versión.',
    'Máximo 20 min de video por versión.',
  ]);
});
