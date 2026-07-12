// flightverse/audio.js — audio 100% sintetizado (WebAudio, cero assets, cero
// copyright). Acústica de quad REAL: 4 rotores independientes con frecuencia
// de paso de pala detuned (el batido/wobble característico), onda periódica
// rica en armónicos + saturación suave (grit), whine agudo de motor/ESC,
// propwash de ruido con chop AM al ritmo de las palas, y bus espacial:
// atenuación por distancia, paneo estéreo y absorción de aire (lowpass).
// El contexto se crea en el PRIMER gesto (política de autoplay); hasta
// entonces todo es no-op seguro (headless/autotest incluidos).
export function createAudio() {
  let ctx = null, eng = null, master = null, muted = false;
  // detune fijo por rotor: 4 fuentes casi-iguales = batido cuádruple lento
  const DET = [0.982, 0.994, 1.009, 1.021];
  // tasa de 'wander' por rotor (correcciones del controlador de vuelo)
  const RATE = [0.71, 1.13, 0.47, 0.93];

  function boot() {
    if (ctx || muted) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.85; master.connect(comp);

    // ── bus espacial del dron: air(lowpass) → dist(gain) → pan → master ──
    const pan = ctx.createStereoPanner();
    const dist = ctx.createGain(); dist.gain.value = 0.8;
    const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 5200;
    air.connect(dist); dist.connect(pan); pan.connect(master);

    // ── 4 rotores: onda periódica de paso de pala (armónicos 1/n^1.25) ──
    const N = 16;
    const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) imag[n] = Math.pow(n, -1.25) * (n % 2 ? 1 : 0.72);
    const wave = ctx.createPeriodicWave(real, imag);
    // saturación suave = grit de motor (los armónicos se intermodulan)
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i <= 256; i++) curve[i] = Math.tanh((i / 128 - 1) * 2.2);
    shaper.curve = curve; shaper.connect(air);
    const motorBus = ctx.createGain(); motorBus.gain.value = 0; motorBus.connect(shaper);
    const rotors = DET.map((det, i) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave); osc.frequency.value = 110 * det;
      const g = ctx.createGain(); g.gain.value = 0.24;
      osc.connect(g); g.connect(motorBus); osc.start();
      return { osc, det, rate: RATE[i], ph: i * 1.7 };
    });

    // ── whine agudo de motor/ESC (muy tenue, da el 'eléctrico') ──
    const whine = ctx.createOscillator(); whine.type = 'sawtooth'; whine.frequency.value = 1050;
    const whp = ctx.createBiquadFilter(); whp.type = 'highpass'; whp.frequency.value = 900;
    const wg = ctx.createGain(); wg.gain.value = 0;
    whine.connect(whp); whp.connect(wg); wg.connect(air); whine.start();

    // ── propwash: ruido → bandpass → AM 'chop' al ritmo de las palas ──
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const mkNoise = () => {
      const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(); return n;
    };
    const noiseBp = ctx.createBiquadFilter(); noiseBp.type = 'bandpass';
    noiseBp.frequency.value = 900; noiseBp.Q.value = 0.8;
    const chopG = ctx.createGain(); chopG.gain.value = 0.65;   // base del AM
    const ng = ctx.createGain(); ng.gain.value = 0;
    mkNoise().connect(noiseBp); noiseBp.connect(chopG); chopG.connect(ng); ng.connect(air);
    const chop = ctx.createOscillator(); chop.frequency.value = 110;
    const chopDepth = ctx.createGain(); chopDepth.gain.value = 0.35;
    chop.connect(chopDepth); chopDepth.connect(chopG.gain); chop.start();

    // ── viento de velocidad (célula aparte: aire en el micrófono, no panea) ──
    const windBp = ctx.createBiquadFilter(); windBp.type = 'bandpass';
    windBp.frequency.value = 450; windBp.Q.value = 0.5;
    const windG = ctx.createGain(); windG.gain.value = 0;
    mkNoise().connect(windBp); windBp.connect(windG); windG.connect(master);

    eng = { rotors, motorBus, whine, wg, noiseBp, ng, chop, windBp, windG, air, dist, pan };
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
    // rpm = propSpin del juego (14 ralentí … ~60 a fondo); dist/pan relativos
    // a la cámara activa (FPV pega el oído al dron, Lejos lo aleja).
    update(rpm, speed, lift, dist = 6, pan = 0) {
      if (!ctx || muted || !eng) return;
      const t = ctx.currentTime;
      // frecuencia de paso de pala (2 palas): ~105Hz ralentí → ~210Hz a fondo
      const bpf = 74 + rpm * 2.2 + Math.max(0, lift) * 6;
      for (const r of eng.rotors) {
        const wob = 1 + Math.sin(t * r.rate * 6.28 + r.ph) * 0.004;
        r.osc.frequency.setTargetAtTime(bpf * r.det * wob, t, 0.06);
      }
      eng.whine.frequency.setTargetAtTime(bpf * 9.5, t, 0.08);
      eng.chop.frequency.setTargetAtTime(bpf, t, 0.06);
      // carga: más thrust = más cuerpo, más propwash, más whine
      const load = Math.min(1, Math.max(0, (rpm - 12) / 46));
      eng.motorBus.gain.setTargetAtTime(0.10 + load * 0.15, t, 0.12);
      eng.ng.gain.setTargetAtTime(0.02 + load * 0.17, t, 0.15);
      eng.noiseBp.frequency.setTargetAtTime(600 + load * 1500, t, 0.2);
      eng.wg.gain.setTargetAtTime(0.006 + load * 0.014, t, 0.15);
      // viento aparte ∝ v²
      eng.windG.gain.setTargetAtTime(Math.min(0.22, speed * speed * 0.00016), t, 0.2);
      eng.windBp.frequency.setTargetAtTime(400 + speed * 30, t, 0.25);
      // espacio: 1/d + absorción de aire + paneo
      const dd = Math.max(1.2, dist);
      eng.dist.gain.setTargetAtTime(Math.min(1, 2.4 / dd), t, 0.12);
      eng.air.frequency.setTargetAtTime(6500 / (1 + dd * 0.12), t, 0.15);
      eng.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, pan)), t, 0.1);
    },
    gate() { blip(880, 1420, 0.14, 'sine', 0.26); },
    tick() { blip(660, 660, 0.07, 'square', 0.14); },
    go() { blip(660, 1320, 0.22, 'square', 0.2); },
    crash() { blip(160, 40, 0.28, 'sawtooth', 0.3); },
    finish() { blip(660, 660, 0.12); setTimeout(() => blip(880, 880, 0.12), 130); setTimeout(() => blip(1320, 1320, 0.2), 260); },
    rec(on) { blip(on ? 520 : 780, on ? 780 : 520, 0.1, 'sine', 0.18); },
    launch() {                                 // whoosh de salida de misil
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const n = ctx.createBufferSource();
      const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const c = b.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * (1 - i / c.length);
      n.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(3200, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.45);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      n.connect(f); f.connect(g); g.connect(master); n.start();
      blip(900, 240, 0.3, 'sawtooth', 0.1);
    },
    boom() {                                   // explosión: sub + cuerpo de ruido
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const n = ctx.createBufferSource();
      const b = ctx.createBuffer(1, ctx.sampleRate * 1.4, ctx.sampleRate);
      const c = b.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / c.length, 1.6);
      n.buffer = b;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(180, t + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      n.connect(lp); lp.connect(g); g.connect(master); n.start();
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(72, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.7);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.55, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      sub.connect(sg); sg.connect(master); sub.start(); sub.stop(t + 0.85);
    },
    toggleMute() {
      muted = !muted;
      if (ctx) (muted ? ctx.suspend() : ctx.resume());
      return muted;
    },
  };
}
