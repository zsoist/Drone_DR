// glb-mesh.js pure helpers: device tier + manifest lookup (the loader itself needs a GPU;
// it is exercised by glb_gate.py / browser_matrix). Keeps the fallback contract honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, '..', 'web', 'flightverse', 'glb-mesh.js')).href);

const stubDevice = (coarse, w, h) => {
  globalThis.matchMedia = q => ({ matches: q.includes('coarse') ? coarse : false });
  globalThis.screen = { width: w, height: h };
};

test('device tier: small touch screens are mobile, everything else desktop', () => {
  stubDevice(true, 390, 844);
  assert.equal(mod.glbDeviceTier(), 'mobile');
  stubDevice(true, 820, 1180);          // iPad: same rule as the OBJ texture ladder
  assert.equal(mod.glbDeviceTier(), 'desktop');
  stubDevice(false, 390, 844);          // narrow desktop window is not a phone
  assert.equal(mod.glbDeviceTier(), 'desktop');
});

test('manifest lookup only returns advertised tiers', () => {
  const man = { capabilities: { glb_mesh: true }, assets: { mesh_glb_mobile: 'a.glb', mesh_glb_desktop: 'b.glb' } };
  assert.equal(mod.glbUrlFromManifest(man, 'mobile'), 'a.glb');
  assert.equal(mod.glbUrlFromManifest(man, 'extra'), null);          // not built/approved
  assert.equal(mod.glbUrlFromManifest({ ...man, capabilities: {} }, 'mobile'), null);   // capability off
  assert.equal(mod.glbUrlFromManifest(null, 'mobile'), null);
});

test('scene.js keeps the OBJ ladder wired as the fallback', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(path.join(here, '..', 'web', 'flightverse', 'scene.js'), 'utf8');
  assert.match(src, /catch \(err\) \{[^}]*console\.warn\('\[fv\] malla GLB falló/s);
  assert.match(src, /return attachObjVisualMesh\(/);
  assert.match(src, /glb = 'auto'/);
});

test('probe renderer satisfies KTX2Loader.detectSupport on ASTC GPUs (Apple: has + get)', async () => {
  // KTX2Loader r180 calls extensions.get('WEBGL_compressed_texture_astc') when ASTC is present;
  // a probe with only `has` threw on Mac/iPhone and tresd silently fell back to the OBJ.
  const { KTX2Loader } = await import(pathToFileURL(path.join(here, '..', 'web', 'vendor', 'three-addons180', 'loaders', 'KTX2Loader.js')).href).catch(() => ({}));
  const astc = { getSupportedProfiles: () => ['ldr'] };
  const gl = { getExtension: n => (/astc|s3tc|etc/.test(n) ? astc : null) };
  globalThis.document = { createElement: () => ({ getContext: () => gl }) };
  const probe = mod._probeRendererForTest();
  assert.equal(typeof probe.renderer.extensions.get, 'function');
  if (KTX2Loader) {
    const cfg = new KTX2Loader().detectSupport(probe.renderer).workerConfig;
    assert.equal(cfg.astcSupported, true);
    assert.equal(cfg.astcHDRSupported, false);
  }
  delete globalThis.document;
});
