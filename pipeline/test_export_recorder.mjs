// Export determinista + Quick Record + aislamiento de resize (WS E): pruebas con dobles, sin navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickExportCodec, validateExportArgs, EXPORT_CODECS } from '../web/flightverse/export-utils.js';
import { lockRenderSize, freezePixelRatio, shadow } from '../web/flightverse/tour/render-guard.js';

test('export: validateExportArgs rechaza frames/tamaños/fps/canvas inválidos', () => {
  const ok = { frames: 10, width: 1920, height: 1080, fps: 60, canvas: { width: 1920, height: 1080 } };
  assert.doesNotThrow(() => validateExportArgs(ok));
  assert.throws(() => validateExportArgs({ ...ok, frames: 0 }), /frames/);
  assert.throws(() => validateExportArgs({ ...ok, frames: 1.5 }), /frames/);
  assert.throws(() => validateExportArgs({ ...ok, width: 1919 }), /pares/);
  assert.throws(() => validateExportArgs({ ...ok, fps: 500 }), /fps/);
  assert.throws(() => validateExportArgs({ ...ok, canvas: { width: 1290, height: 2796 } }), /canvas es 1290x2796/);
});

test('export: negocia VP9 y cae a VP8; null si ninguno sirve', async () => {
  const mk = supported => ({ isConfigSupported: async c => ({ supported: supported.includes(c.codec) }) });
  const a = await pickExportCodec({ width: 1920, height: 1080, fps: 60, bitrate: 1e6, Encoder: mk([EXPORT_CODECS[0][0], 'vp8']) });
  assert.deepEqual(a, { codec: 'vp09.00.10.08', container: 'V_VP9' });
  const b = await pickExportCodec({ width: 1920, height: 1080, fps: 60, bitrate: 1e6, Encoder: mk(['vp8']) });
  assert.deepEqual(b, { codec: 'vp8', container: 'V_VP8' });
  assert.equal(await pickExportCodec({ width: 1, height: 1, fps: 60, bitrate: 1, Encoder: mk([]) }), null);
  const boom = { isConfigSupported: async () => { throw new Error('x'); } };
  assert.equal(await pickExportCodec({ width: 1, height: 1, fps: 60, bitrate: 1, Encoder: boom }), null);
});

// Dobles con los métodos como PROPIEDADES PROPIAS del renderer (así los define three.js en el constructor:
// `this.setSize = function…`). El incidente de prod 2026-09-30 fue un `delete` que los borraba.
class FakeRenderer {
  constructor() {
    this._dpr = 2; this._size = [430, 932];
    this.setPixelRatio = d => { this._dpr = d; };
    this.getPixelRatio = () => this._dpr;
    this.setSize = (w, h) => { this._size = [w, h]; };
  }
}
class FakeComposer { setSize() {} }                                  // postprocessing: método de prototipo
class FakeCamera { constructor() { this.aspect = 430 / 932; } updateProjectionMatrix() {} }
function fakeCtx() {
  return { renderer: new FakeRenderer(), composer: new FakeComposer(), camera: new FakeCamera(), state: {} };
}

test('lockRenderSize: fija 1920x1080@1x, ignora resize/DPR/aspecto ajenos y restaura el ÚLTIMO pedido', () => {
  globalThis.innerWidth = 1000; globalThis.innerHeight = 700;
  const ctx = fakeCtx();
  const lock = lockRenderSize(ctx, { width: 1920, height: 1080 });
  assert.equal(ctx.state.exporting, true);
  assert.equal(ctx.renderer._dpr, 1);
  assert.deepEqual(ctx.renderer._size, [1920, 1080]);
  assert.ok(Math.abs(ctx.camera.aspect - 16 / 9) < 1e-9);
  // eventos ajenos durante el export (resize + gobernador + aspecto de volar.js)
  ctx.renderer.setSize(1200, 800);
  ctx.renderer.setPixelRatio(1.5);
  ctx.composer.setSize(1200, 800);
  ctx.camera.aspect = 1200 / 800; ctx.camera.updateProjectionMatrix();
  assert.deepEqual(ctx.renderer._size, [1920, 1080], 'el tamaño de export no cambió');
  assert.equal(ctx.renderer._dpr, 1, 'DPR del export intacto');
  assert.ok(Math.abs(ctx.camera.aspect - 16 / 9) < 1e-9, 'aspecto forzado a 16:9');
  assert.equal(lock.pending.blocked, 3);
  lock.release();
  assert.equal(ctx.state.exporting, false);
  assert.equal(ctx.renderer._dpr, 1.5, 'se aplica el último DPR pedido por la app');
  assert.deepEqual(ctx.renderer._size, [1200, 800], 'y el último tamaño');
  assert.ok(Math.abs(ctx.camera.aspect - 1000 / 700) < 1e-9);
  // idempotente; NUNCA deja un método indefinido (incidente "renderer.setPixelRatio is not a function")
  lock.release();
  for (const [o, k] of [[ctx.renderer, 'setSize'], [ctx.renderer, 'setPixelRatio'], [ctx.composer, 'setSize'], [ctx.camera, 'updateProjectionMatrix']]) {
    assert.equal(typeof o[k], 'function', `${k} sigue siendo función`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.renderer, 'setPixelRatio'), true, 'propiedad propia del renderer restaurada');
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.composer, 'setSize'), false, 'el prototipo del composer no se contamina');
  ctx.renderer.setPixelRatio(1.25);
  assert.equal(ctx.renderer._dpr, 1.25, 'el método restaurado funciona');
});

test('shadow(): restaura propiedad propia o hereda; nunca deja undefined aunque se llame dos veces', () => {
  const own = { f() { return 'own'; } };
  const undoOwn = shadow(own, 'f', () => 'sombra');
  assert.equal(own.f(), 'sombra');
  undoOwn(); undoOwn();
  assert.equal(own.f(), 'own');
  class P { g() { return 'proto'; } }
  const inh = new P();
  const undoInh = shadow(inh, 'g', () => 'sombra');
  assert.equal(inh.g(), 'sombra');
  undoInh();
  assert.equal(inh.g(), 'proto');
  assert.equal(Object.prototype.hasOwnProperty.call(inh, 'g'), false);
});

test('freezePixelRatio: el DPR no cambia durante la grabación y se aplica al soltar', () => {
  globalThis.innerWidth = 800; globalThis.innerHeight = 600;
  const ctx = fakeCtx();
  const f = freezePixelRatio(ctx);
  ctx.renderer.setPixelRatio(1);
  ctx.renderer.setPixelRatio(1.25);
  assert.equal(ctx.renderer._dpr, 2, 'sin cambio mientras graba');
  f.release();
  assert.equal(typeof ctx.renderer.setPixelRatio, 'function', 'setPixelRatio sigue existiendo');
  assert.equal(ctx.renderer._dpr, 1.25, 'último pedido aplicado');
  assert.deepEqual(ctx.renderer._size, [800, 600]);
});

// ── recorder con MediaRecorder/captureStream simulados ──
class FakeTrack { stop() { this.stopped = true; } }
function installMedia({ failCtor = false, failStart = false, silentStop = false } = {}) {
  class MR {
    static isTypeSupported(t) { return t === 'video/webm'; }
    constructor(stream, opts) { if (failCtor) throw new Error('ctor'); this.stream = stream; this.mimeType = opts.mimeType; this.state = 'inactive'; MR.last = this; }
    start() { if (failStart) throw new Error('start'); this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (!silentStop) setTimeout(() => this.onstop?.(), 0); }
  }
  globalThis.window = { MediaRecorder: MR };
  globalThis.MediaRecorder = MR;
  return MR;
}
const canvas = () => ({ captureStream: () => ({ getTracks: () => [new FakeTrack()] }) });

test('recorder: start/stop devuelve un blob; segundo start es no-op; nunca lanza', async () => {
  const MR = installMedia();
  const { createRecorder } = await import('../web/flightverse/recorder.js');
  const r = createRecorder(canvas(), {});
  assert.equal(r.supported, true);
  assert.equal(r.start(), true);
  assert.equal(r.recording, true);
  assert.equal(r.start(), false, 'no dobla la grabación');
  MR.last.ondataavailable({ data: new Blob([new Uint8Array(2000)]) });
  const blob = await r.stop();
  assert.ok(blob && blob.size === 2000);
  assert.equal(r.recording, false);
  assert.equal(await r.stop(), null, 'stop sin grabación resuelve null');
});

test('recorder: fallos de captureStream/MediaRecorder/start se reportan sin lanzar', async () => {
  const { createRecorder } = await import('../web/flightverse/recorder.js');
  for (const opt of [{ failCtor: true }, { failStart: true }]) {
    installMedia(opt);
    const errs = [];
    const r = createRecorder(canvas(), { onError: e => errs.push(e) });
    assert.equal(r.start(), false);
    assert.equal(errs.length, 1);
    assert.equal(r.recording, false);
  }
  installMedia();
  const r2 = createRecorder({ captureStream() { throw new Error('taint'); } }, {});
  assert.equal(r2.start(), false);
  const r3 = createRecorder({}, {});           // canvas sin captureStream
  assert.equal(r3.start(), false);
});

test('recorder: stop resuelve aunque el navegador nunca dispare onstop (timeout) y respeta el tope de bytes', async () => {
  const { createRecorder, RECORDER_LIMITS } = await import('../web/flightverse/recorder.js');
  const MR = installMedia({ silentStop: true });
  const r = createRecorder(canvas(), {});
  r.start();
  const t0 = Date.now();
  const p = r.stop();
  const blob = await Promise.race([p, new Promise(res => setTimeout(() => res('COLGADO'), RECORDER_LIMITS.stopTimeoutMs + 1500))]);
  assert.equal(blob, null);
  assert.ok(Date.now() - t0 >= RECORDER_LIMITS.stopTimeoutMs - 50);
  void MR;
  const MR2 = installMedia();
  const limits = [];
  const r2 = createRecorder(canvas(), { maxBytes: 1000, onLimit: w => limits.push(w) });
  r2.start();
  MR2.last.ondataavailable({ data: new Blob([new Uint8Array(1500)]) });
  await new Promise(res => setTimeout(res, 20));
  assert.deepEqual(limits, ['bytes']);
  assert.equal(r2.recording, false);
});
