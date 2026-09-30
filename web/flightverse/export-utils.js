// flightverse/export-utils.js — piezas puras del export determinista (WS E): negociación de códec y validación.
// Sin imports: se prueba en pipeline/test_export_recorder.mjs.
// [codec WebCodecs, codec del contenedor]
export const EXPORT_CODECS = Object.freeze([['vp09.00.10.08', 'V_VP9'], ['vp8', 'V_VP8']]);

/** Primer códec soportado para width×height (puro en lo posible: recibe el encoder por inyección en tests). */
export async function pickExportCodec({ width, height, fps, bitrate, Encoder = globalThis.VideoEncoder }) {
  for (const [codec, container] of EXPORT_CODECS) {
    try {
      const r = await Encoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
      if (r?.supported) return { codec, container };
    } catch { /* probar el siguiente */ }
  }
  return null;
}

export function validateExportArgs({ frames, width, height, fps, canvas }) {
  if (!Number.isInteger(frames) || frames < 1) throw new Error('export: frames debe ser un entero ≥ 1');
  if (!(width > 0) || !(height > 0) || width % 2 || height % 2) throw new Error('export: width/height deben ser pares y > 0');
  if (!(fps > 0 && fps <= 120)) throw new Error('export: fps fuera de rango');
  if (canvas && (canvas.width !== width || canvas.height !== height)) {
    throw new Error(`export: el canvas es ${canvas.width}x${canvas.height}, se pidió ${width}x${height}`);
  }
}

