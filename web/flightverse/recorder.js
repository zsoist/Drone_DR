// flightverse/recorder.js — Quick Record (P7, primera mitad del Video Studio).
// Graba el canvas del juego a WebM vía captureStream + MediaRecorder: rápido,
// honesto (lo que ves es lo que sale) y sin servidor. La exportación
// DETERMINISTA frame-a-frame (WebCodecs, replay re-simulado) es la segunda
// mitad de P7 — esto no la sustituye, la complementa como camino instantáneo.
//
// WS E (robustez): start() nunca lanza (captureStream/MediaRecorder pueden fallar en Safari/iOS);
// stop() siempre resuelve (timeout si el navegador no dispara onstop); tope de duración y de bytes
// para no agotar memoria; un segundo start() mientras graba es un no-op; dispose() libera todo.
export const RECORDER_LIMITS = Object.freeze({ maxSeconds: 300, maxBytes: 400 * 1024 * 1024, stopTimeoutMs: 4000 });

export function createRecorder(canvas, { fps = 60, mbps = 12, onError = null, onLimit = null,
  maxSeconds = RECORDER_LIMITS.maxSeconds, maxBytes = RECORDER_LIMITS.maxBytes } = {}) {
  const pick = () => ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || null;

  let rec = null, chunks = [], startedAt = 0, bytes = 0, limitTimer = 0;
  const cleanup = r => {
    clearTimeout(limitTimer); limitTimer = 0;
    try { r?.stream?.getTracks().forEach(t => t.stop()); } catch { /* ya parado */ }
  };
  const api = {
    get supported() { return !!pick(); },
    get recording() { return !!rec && rec.state === 'recording'; },
    get seconds() { return rec ? (performance.now() - startedAt) / 1000 : 0; },
    get bytes() { return bytes; },
    start() {
      const mime = pick();
      if (!mime || rec || !canvas?.captureStream) return false;
      let stream = null, r = null;
      try {
        stream = canvas.captureStream(fps);
        r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: mbps * 1e6 });
      } catch (err) {
        try { stream?.getTracks().forEach(t => t.stop()); } catch { /* sin stream */ }
        onError?.(err);
        return false;
      }
      rec = r; chunks = []; bytes = 0;
      r.ondataavailable = e => {
        if (!e.data?.size) return;
        chunks.push(e.data); bytes += e.data.size;
        if (bytes > maxBytes && rec === r) { onLimit?.('bytes'); api.stop(); }
      };
      r.onerror = e => {
        // fallo del codificador: parar, soltar el stream y avisar (sin blob a medias)
        if (rec === r) rec = null;
        chunks = []; bytes = 0;
        try { if (r.state !== 'inactive') r.stop(); } catch { /* ya parado */ }
        cleanup(r);
        onError?.(e?.error || e);
      };
      try { r.start(500); } catch (err) { rec = null; cleanup(r); onError?.(err); return false; }
      startedAt = performance.now();
      limitTimer = setTimeout(() => { if (rec === r) { onLimit?.('time'); api.stop(); } }, maxSeconds * 1000);
      return true;
    },
    stop() {
      return new Promise(resolve => {
        if (!rec) return resolve(null);
        const r = rec; rec = null;
        r.onerror = null;
        let done = false;
        const finish = blob => { if (done) return; done = true; clearTimeout(guard); resolve(blob); };
        const guard = setTimeout(() => { cleanup(r); chunks = []; finish(null); }, RECORDER_LIMITS.stopTimeoutMs);
        r.onstop = () => {
          const blob = new Blob(chunks, { type: r.mimeType });
          chunks = []; bytes = 0;
          cleanup(r);
          finish(blob.size ? blob : null);
        };
        try {
          if (r.state !== 'inactive') r.stop(); else r.onstop();
        } catch { cleanup(r); chunks = []; finish(null); }
        cleanup(r);
      });
    },
    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    },
    dispose() { if (rec) { const r = rec; rec = null; r.onerror = null; try { r.stop(); } catch { /* nada */ } cleanup(r); } chunks = []; },
  };
  return api;
}
