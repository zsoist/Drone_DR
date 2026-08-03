import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEWER_MODES,
  normalizeViewerMode,
  shouldAutoloadViewer,
  viewerHeaderState,
} from '../web/unified-viewer-state.js';

const available = { cloud: true, mesh: true, splat: true };

test('exposes the three viewer modes in operator order', () => {
  assert.deepEqual(VIEWER_MODES, ['cloud', 'mesh', 'splat']);
});

test('keeps an available requested mode', () => {
  assert.equal(normalizeViewerMode('mesh', available), 'mesh');
});

test('falls back to cloud when mesh is weak', () => {
  assert.equal(normalizeViewerMode('mesh', { ...available, mesh: false }), 'cloud');
});

test('falls back to mesh when gaussian is absent and cloud is unavailable', () => {
  assert.equal(normalizeViewerMode('splat', { cloud: false, mesh: true, splat: false }), 'mesh');
});

test('returns contextual header state for every mode', () => {
  assert.deepEqual(viewerHeaderState('cloud', { cloudMB: 48.6 }), {
    title: 'Nube de puntos',
    status: '49 MB · PLY',
    loadLabel: 'Cargar nube',
  });
  assert.deepEqual(viewerHeaderState('mesh', { meshOk: true, meshQuality: 'alta' }), {
    title: 'Malla texturizada',
    status: 'calidad alta',
    loadLabel: 'Cargar malla',
  });
  assert.deepEqual(viewerHeaderState('splat', { splatCount: 2, splatMB: 15.7, splatFormat: 'SOG' }), {
    title: 'Gaussian splat',
    status: '2 versiones · 15.7 MB · SOG',
    loadLabel: 'Cargar Gaussian',
  });
});

test('restores mesh and gaussian automatically but protects heavy mobile clouds', () => {
  assert.equal(shouldAutoloadViewer('mesh', { mobile: true, cloudMB: 300 }), true);
  assert.equal(shouldAutoloadViewer('splat', { mobile: true, cloudMB: 300 }), true);
  assert.equal(shouldAutoloadViewer('cloud', { mobile: true, cloudMB: 26 }), false);
  assert.equal(shouldAutoloadViewer('cloud', { mobile: false, cloudMB: 300 }), true);
});
