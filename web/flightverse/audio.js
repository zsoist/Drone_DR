// flightverse/audio.js — audio 100% sintetizado (WebAudio, cero assets, cero
// copyright). Rotores = 2 sierras detuned + lowpass cuyo pitch/volumen siguen
// la velocidad real; viento = ruido por bandpass ∝ v². Eventos cortos por
// osciladores. El contexto se crea en el PRIMER gesto (política de autoplay);
// hasta entonces todo es no-op seguro (headless/autotest incluidos).
export function createAudio() {
  let ctx = null, rotor = null, wind = null, master = null, muted = false;

  function boot() {
    if (ctx || muted) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);

    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth';
    o1.frequency.value = 82; o2.frequency.value = 83.7;      // batido de rotores
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
    o1.start(); o2.start();
    rotor = { o1, o2, lp, g };

    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    n.buffer = buf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0;
    n.connect(bp); bp.connect(wg); wg.connect(master);
    n.start();
    wind = { bp, g: wg };
  }
  // primer gesto arma el contexto (una sola vez)
  const arm = () => { boot(); removeEventListener('pointerdown', arm); removeEventListener('keydown', arm); };
  addEventListener('pointerdown', arm); addEventListener('keydown', arm);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (!muted) ctx.resume();
  });

  const blip = (f0, f1, dur, type = 'sine', vol = 0.22) => {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.02);
  };

  return {
    get armed() { return !!ctx; },
    update(speed, lift) {
      if (!ctx || muted || !rotor) return;
      const f = 78 + speed * 2.4 + Math.abs(lift) * 26;
      rotor.o1.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
      rotor.o2.frequency.setTargetAtTime(f * 1.021, ctx.currentTime, 0.08);
      rotor.g.gain.setTargetAtTime(Math.min(0.13, 0.05 + speed * 0.002), ctx.currentTime, 0.15);
      wind.g.gain.setTargetAtTime(Math.min(0.2, speed * speed * 0.00018), ctx.currentTime, 0.2);
      wind.bp.frequency.setTargetAtTime(500 + speed * 26, ctx.currentTime, 0.25);
    },
    gate() { blip(880, 1420, 0.14, 'sine', 0.26); },
    tick() { blip(660, 660, 0.07, 'square', 0.14); },
    go() { blip(660, 1320, 0.22, 'square', 0.2); },
    crash() { blip(160, 40, 0.28, 'sawtooth', 0.3); },
    finish() { blip(660, 660, 0.12); setTimeout(() => blip(880, 880, 0.12), 130); setTimeout(() => blip(1320, 1320, 0.2), 260); },
    rec(on) { blip(on ? 520 : 780, on ? 780 : 520, 0.1, 'sine', 0.18); },
    toggleMute() {
      muted = !muted;
      if (ctx) (muted ? ctx.suspend() : ctx.resume());
      return muted;
    },
  };
}
