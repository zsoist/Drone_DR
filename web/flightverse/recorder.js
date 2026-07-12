// flightverse/recorder.js — Quick Record (P7, primera mitad del Video Studio).
// Graba el canvas del juego a WebM vía captureStream + MediaRecorder: rápido,
// honesto (lo que ves es lo que sale) y sin servidor. La exportación
// DETERMINISTA frame-a-frame (WebCodecs, replay re-simulado) es la segunda
// mitad de P7 — esto no la sustituye, la complementa como camino instantáneo.
export function createRecorder(canvas, { fps = 60, mbps = 12 } = {}) {
  const pick = () => ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || null;

  let rec = null, chunks = [], startedAt = 0;
  const api = {
    get supported() { return !!pick(); },
    get recording() { return !!rec && rec.state === 'recording'; },
    get seconds() { return rec ? (performance.now() - startedAt) / 1000 : 0; },
    start() {
      const mime = pick();
      if (!mime || rec) return false;
      const stream = canvas.captureStream(fps);
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: mbps * 1e6 });
      chunks = [];
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      rec.start(500);
      startedAt = performance.now();
      return true;
    },
    stop() {
      return new Promise(resolve => {
        if (!rec) return resolve(null);
        const r = rec; rec = null;
        r.onstop = () => {
          const blob = new Blob(chunks, { type: r.mimeType });
          chunks = [];
          resolve(blob.size ? blob : null);
        };
        r.stop();
        r.stream.getTracks().forEach(t => t.stop());
      });
    },
    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    },
  };
  return api;
}
