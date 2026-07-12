// flightverse/export.js — export DETERMINISTA (P7b): re-renderiza el replay
// frame a frame a resolución fija y codifica con WebCodecs → WebM (muxer
// vendorizado). Cada frame es el paso f del rec 60Hz: mismo input → mismo
// video, independiente del framerate de la máquina. Fallback honesto: si
// WebCodecs no existe, el caller usa Quick Record.
import { Muxer, ArrayBufferTarget } from '/vendor/webm-muxer.module.js?v=115';

export const canExport = () => typeof VideoEncoder !== 'undefined';

export async function exportDeterministic({ frames, drawFrame, canvas,
  width = 1920, height = 1080, fps = 60, mbps = 14, onProgress }) {
  if (!canExport()) throw new Error('WebCodecs no disponible');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'V_VP9', width, height, frameRate: fps },
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { throw e; },
  });
  encoder.configure({ codec: 'vp09.00.10.08', width, height,
    bitrate: mbps * 1e6, framerate: fps });
  for (let f = 0; f < frames; f++) {
    drawFrame(f);
    const frame = new VideoFrame(canvas, { timestamp: f * 1e6 / fps, duration: 1e6 / fps });
    encoder.encode(frame, { keyFrame: f % 120 === 0 });
    frame.close();
    if (f % 12 === 0) { onProgress?.(f / frames); await new Promise(r => setTimeout(r)); }
    if (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 8));
  }
  await encoder.flush();
  muxer.finalize();
  onProgress?.(1);
  return new Blob([muxer.target.buffer], { type: 'video/webm' });
}
