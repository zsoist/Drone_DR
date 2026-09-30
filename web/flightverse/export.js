// flightverse/export.js — export DETERMINISTA (P7b): re-renderiza el replay
// frame a frame a resolución fija y codifica con WebCodecs → WebM (muxer
// vendorizado). Cada frame es el paso f del rec 60Hz: mismo input → mismo
// video, independiente del framerate de la máquina. Fallback honesto: si
// WebCodecs no existe, el caller usa Quick Record.
//
// WS E (robustez): códec negociado con isConfigSupported (VP9 → VP8), validación de tamaño del canvas
// (un canvas que no está a width×height produciría frames mezclados), AbortSignal, el muxer y el
// encoder se cierran SIEMPRE y cualquier error del encoder se relanza al caller con su causa.
import { Muxer, ArrayBufferTarget } from '/vendor/webm-muxer.module.js?v=368';
import { EXPORT_CODECS, pickExportCodec, validateExportArgs } from '/flightverse/export-utils.js?v=368';

export const canExport = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

export { EXPORT_CODECS, pickExportCodec, validateExportArgs };

export async function exportDeterministic({ frames, drawFrame, canvas,
  width = 1920, height = 1080, fps = 60, mbps = 14, onProgress, signal = null }) {
  if (!canExport()) throw new Error('WebCodecs no disponible');
  validateExportArgs({ frames, width, height, fps, canvas });
  const bitrate = mbps * 1e6;
  const choice = await pickExportCodec({ width, height, fps, bitrate });
  if (!choice) throw new Error('export: ningún códec WebCodecs soporta esta resolución');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: choice.container, width, height, frameRate: fps },
  });
  let encoderError = null;   // el callback de error no puede lanzar al caller: se guarda y se relanza
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encoderError = e; },
  });
  try {
    encoder.configure({ codec: choice.codec, width, height, bitrate, framerate: fps });
    for (let f = 0; f < frames; f++) {
      if (signal?.aborted) throw new DOMException('export cancelado', 'AbortError');
      if (encoderError) throw encoderError;
      drawFrame(f);
      const frame = new VideoFrame(canvas, { timestamp: f * 1e6 / fps, duration: 1e6 / fps });
      try { encoder.encode(frame, { keyFrame: f % 120 === 0 }); } finally { frame.close(); }
      if (f % 12 === 0) { onProgress?.(f / frames); await new Promise(r => setTimeout(r)); }
      if (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 8));
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    onProgress?.(1);
    return new Blob([muxer.target.buffer], { type: 'video/webm' });
  } finally {
    if (encoder.state !== 'closed') { try { encoder.close(); } catch { /* ya cerrado */ } }
  }
}
