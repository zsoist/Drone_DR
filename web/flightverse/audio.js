// flightverse/audio.js — audio 100% sintetizado (WebAudio, cero assets, cero
// copyright). Acústica de quad REAL: 4 rotores independientes con frecuencia
// de paso de pala detuned (el batido/wobble característico), onda periódica
// rica en armónicos + saturación suave (grit), whine agudo de motor/ESC,
// propwash de ruido con chop AM al ritmo de las palas, y bus espacial:
// atenuación por distancia, paneo estéreo y absorción de aire (lowpass).
// El contexto se crea en el PRIMER gesto (política de autoplay); hasta
// entonces todo es no-op seguro (headless/autotest incluidos).
//
// ?fv=2 (spec §12): buses master→comp + sfx/engine/ui/music/amb con ducking sidechain,
// capas por evento (recipes en audio/recipes.js: fuego por arma, explosión thump+crack+lluvia
// de escombros con retardo d/343, tick de impacto, kill de dos tonos con pitch escalonado,
// daño, tonos de lock), sonidos de UI, rotores ligados a s.m[] del motor físico y viento a
// |va|. Sin ?fv=2 el comportamiento es el de siempre (mismos nodos, ganancias unitarias).
//
// API extra (todas no-op seguras antes del primer gesto):
//   attach({bus, listener, motors})  bus de eventos + oyente {pos,right} + lector de motores
//   unlock()                         crea/reanuda el contexto (llamar dentro del gesto)
//   fire(key,opts) impact(surface,o) explosion(o) hit(o) charge(key,dur) lockTone(state,p)
//   damage(d) ui(name) setMotors(m,va,gust,integrity) duck(db) buses/context (para música, E)
import {
  BUS_GAINS, CHARGE, DUCK, EXPLOSION, FIRE, FLIGHT, HIT_TICK, IMPACT, KILL,
  createKillStreak, dbToGain, distanceModel, engineFromMotors, lockBeepRate,
} from './audio/recipes.js?v=368';

const FV2 = (() => {
  try { const q = new URLSearchParams(location.search); return q.get('fv') === '2' || q.get('fvfx') === '1'; } catch { return false; }
})();

export function createAudio() {
  let ctx = null, eng = null, master = null, muted = false;
  // ?fv=2: buses; sin ?fv=2 todos apuntan al master (salida idéntica a la de siempre)
  let B = null;
  let noiseBuf = null, reverbSend = null;
  let listener = null, motorReader = null, busRef = null;
  const motorState = { m: null, va: 0, gust: 0, integrity: 1, at: -1 };
  let stutterUntil = 0, stutterDepth = 0, whineDropUntil = 0;
  const voices = [];
  const streak = createKillStreak();
  const lockState = { state: 'none', nextBeep: 0, osc: null, gain: null };
  // detune fijo por rotor: 4 fuentes casi-iguales = batido cuádruple lento
  const DET = [0.982, 0.994, 1.009, 1.021];
  // tasa de 'wander' por rotor (correcciones del controlador de vuelo)
  const RATE = [0.71, 1.13, 0.47, 0.93];

  function boot() {
    if (ctx || muted) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    // Safari puede crear el contexto todavía suspendido incluso dentro del primer
    // gesto. Reanudar aquí conserva ese gesto y evita un motor silencioso.
    ctx.resume?.().catch(() => {});
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.85; master.connect(comp);
    B = { master, sfx: master, engine: master, ui: master, music: master, amb: master, comp };
    if (FV2) {
      for (const name of ['sfx', 'engine', 'ui', 'music', 'amb']) {
        const g = ctx.createGain(); g.gain.value = BUS_GAINS[name]; g.connect(master); B[name] = g;
      }
    }
    // ruido blanco compartido (2 s) para capas de ruido bajo demanda
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    { const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; }
    if (FV2) {
      // reverb send sintetizada (IR de ruido que decae, ~0.6 s)
      const len = Math.floor(ctx.sampleRate * 0.6);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      const conv = ctx.createConvolver(); conv.buffer = ir;
      reverbSend = ctx.createGain(); reverbSend.gain.value = 0.9;
      reverbSend.connect(conv); conv.connect(B.sfx);
    }

    // ── bus espacial del dron: air(lowpass) → dist(gain) → pan → master ──
    const pan = ctx.createStereoPanner();
    const dist = ctx.createGain(); dist.gain.value = 0.8;
    const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 5200;
    air.connect(dist); dist.connect(pan); pan.connect(B.engine);

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
    mkNoise().connect(windBp); windBp.connect(windG); windG.connect(B.engine);

    eng = { rotors, motorBus, whine, wg, noiseBp, ng, chop, windBp, windG, air, dist, pan };
  }
  // primer gesto arma el contexto (una sola vez)
  // WebKit no cuenta pointerdown/touchstart como activación de usuario para WebAudio (sí touchend/click/keydown),
  // y tras una interrupción (llamada, bloqueo, segundo plano) el contexto queda 'suspended'/'interrupted':
  // los listeners permanecen y reanudan en cada gesto mientras el contexto no esté corriendo.
  const arm = () => {
    if (!ctx) boot();
    else if (!muted && ctx.state !== 'running' && !document.hidden) ctx.resume?.().catch(() => {});
  };
  // ?fv=2: además pointerup/capture — el plate 'Toca para empezar' puede detener la propagación
  for (const type of (FV2 ? ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] : ['pointerdown', 'touchend', 'click', 'keydown'])) {
    addEventListener(type, arm, FV2 ? { passive: true, capture: true } : { passive: true });
  }
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
    o.connect(g); g.connect(B.ui); o.start(); o.stop(ctx.currentTime + dur + 0.02);
  };

  // ═══════════════════════════ ?fv=2 voces y capas ═══════════════════════════
  const usable = () => FV2 && ctx && !muted && B && ctx.state !== 'closed';
  const now = () => ctx.currentTime;

  /** Límite de 24 voces: las de baja prioridad se descartan; explosiones/kills siempre suenan. */
  function takeVoice(end, priority = 1) {
    const t = now();
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= t) voices.splice(i, 1);
    if (voices.length >= 24 && priority < 2) return false;
    voices.push({ end, priority });
    if (voices.length > 40) voices.shift();
    return true;
  }

  function readMotors() {
    try {
      const r = motorReader?.();
      if (r?.m) {
        motorState.m = r.m; motorState.va = r.va ?? motorState.va; motorState.gust = r.gust ?? 0;
        motorState.integrity = r.integrity ?? 1; motorState.at = now();
        return true;
      }
    } catch { /* fallback a rpm */ }
    return false;
  }

  /** Reproduce una lista de capas de recipes.js. Devuelve el instante final. */
  function playLayers(layers, {
    when = now(), pitch = 1, gain = 1, level = 1, pan = 0, lp = 0, dest = null, wet = 1,
  } = {}) {
    let end = when;
    const out = ctx.createGain(); out.gain.value = gain * level;
    let head = out;
    if (lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; out.connect(f); head = f;
    }
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); head.connect(p); head = p;
    }
    head.connect(dest || B.sfx);
    for (const l of layers) {
      const t = when + l.t;
      const dur = l.a + l.d * 1.4;
      let src;
      if (l.src === 'noise') {
        src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        src.start(t, Math.random() * 1.5);
      } else {
        src = ctx.createOscillator(); src.type = l.wave || 'sine';
        src.frequency.setValueAtTime(l.f[0] * pitch, t);
        if (l.f[1] !== l.f[0]) src.frequency.exponentialRampToValueAtTime(Math.max(1, l.f[1] * pitch), t + l.d);
        src.start(t);
      }
      src.stop(t + dur + 0.03);
      let node = src;
      if (l.filter) {
        const f = ctx.createBiquadFilter(); f.type = l.filter.type; f.Q.value = l.filter.q;
        f.frequency.setValueAtTime(l.filter.f[0] * pitch, t);
        if (l.filter.f[1] !== l.filter.f[0]) f.frequency.exponentialRampToValueAtTime(Math.max(20, l.filter.f[1] * pitch), t + l.d);
        node.connect(f); node = f;
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(l.gain, t + l.a);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-5, l.gain * Math.pow(0.001, 1.4)), t + dur);
      node.connect(g);
      g.connect(l.tail && reverbSend ? reverbSend : out);
      end = Math.max(end, t + dur + 0.03);
    }
    return end;
  }

  /** Ducking sidechain: engine+music+amb caen `db` dB (ataque 20 ms, suelta 600 ms). */
  function duck(db, at = now()) {
    if (!usable() || !(db > 0)) return;
    const k = dbToGain(db);
    for (const name of DUCK.targets) {
      const g = B[name].gain;
      const base = BUS_GAINS[name];
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.setTargetAtTime(base * k, at, DUCK.attack / 3);
      g.setTargetAtTime(base, at + DUCK.attack + 0.1, DUCK.release / 3);
    }
  }

  /** Geometría del oyente: distancia y paneo (-1..1) hacia una posición de mundo. */
  function spatial(pos) {
    const L = listener?.();
    if (!pos || !L?.pos) return { dist: 0, pan: 0 };
    const dx = pos.x - L.pos.x, dy = pos.y - L.pos.y, dz = pos.z - L.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    const r = L.right;
    const pan = r && dist > 0.5 ? Math.max(-1, Math.min(1, (dx * r.x + dy * r.y + dz * r.z) / dist)) : 0;
    return { dist, pan };
  }

  function playFire(key, opts = {}) {
    if (!usable()) return;
    const family = key === 's' || key === 'l' || key === 'vx' || key === 'm' ? 'misil' : key === 'sw' ? 'swarm' : key === 'rg' ? 'rail' : key === 'tb' ? 'nova' : key;
    const recipe = FIRE[family];
    if (!recipe) return;
    const end0 = now() + 0.6;
    if (!takeVoice(end0, recipe.priority)) return;
    let pitch = 1 + (Math.random() * 2 - 1) * (recipe.pitchJitter || 0);
    if (family === 'swarm') pitch *= Math.pow(2, ((opts.index || 0) * 2) / 12);       // +2 semitonos por cohete
    playLayers(recipe.layers, { pitch, level: recipe.level ?? 1, gain: family === 'mg' ? 0.8 : 1 });
    if (family === 'misil') playLayers(FLIGHT.misil, { gain: 0.9, pitch: opts.guided ? 1.15 : 1 });
  }

  function playCharge(key, dur) {
    if (!usable()) return;
    const recipe = CHARGE[key];
    if (!recipe || !takeVoice(now() + dur + 0.1, 2)) return;
    playLayers(recipe.layers, { gain: 1, level: 1, dest: B.sfx });
  }

  function playImpact(surface, { pos = null, heavy = false } = {}) {
    if (!usable()) return;
    const R = IMPACT[surface] || IMPACT.ground;
    const t = now();
    if (t - (playImpact.last || 0) < 0.035 && !heavy) return;          // un tick cada ≥35 ms
    playImpact.last = t;
    const { dist, pan } = spatial(pos);
    const dm = distanceModel(dist);
    if (!takeVoice(t + R.d + 0.05 + dm.delay, 1)) return;
    const layers = [{ t: 0, a: 0.001, gain: 1, src: 'noise', filter: { type: 'bandpass', f: [R.f, R.f * 0.8], q: R.q }, d: R.d }];
    if (R.ring) layers.push({ t: 0.002, a: 0.001, gain: 0.15, src: 'osc', wave: 'sine', f: [R.ring, R.ring * 0.96], d: 0.18 });
    playLayers(layers, { when: t + dm.delay, gain: (heavy ? 1.6 : 1) * R.gain * dm.gain, pan, lp: dm.lowpass });
  }

  function playExplosion({ pos = null, size = 'M' } = {}) {
    if (!usable()) return;
    const R = EXPLOSION[size] || EXPLOSION.M;
    const t = now();
    const { dist, pan } = spatial(pos);
    const dm = distanceModel(dist);
    const at = t + dm.delay;
    if (!takeVoice(at + R.rain[0] + 0.6, R.priority)) return;
    const g = Math.max(0.12, dm.gain);
    const layers = [
      { t: 0, a: 0.004, gain: R.thumpGain, src: 'osc', wave: 'sine', f: [R.thump[0], R.thump[1]], d: R.thump[2] },
      { t: 0, a: 0.001, gain: R.crack[1], src: 'noise', filter: { type: 'highpass', f: [4000, 3000], q: 0.7 }, d: R.crack[0] },
      { t: 0.03, a: 0.02, gain: 0.35, src: 'noise', filter: { type: 'lowpass', f: [R.lp, 240], q: 0.7 }, d: R.rain[0] * 0.9 },
    ];
    playLayers(layers, { when: at, gain: g, pan, lp: Math.max(dm.lowpass, 1800), level: 0.9 });
    // lluvia de escombros granular: ráfagas de ruido cortas con barrido de lowpass descendente
    const grains = size === 'S' ? 10 : size === 'M' ? 22 : 34;
    const rain = ctx.createGain(); rain.gain.value = g * R.rain[1];
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(3200, at + 0.1); lpf.frequency.exponentialRampToValueAtTime(380, at + 0.1 + R.rain[0]);
    const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
    nz.connect(lpf); lpf.connect(rain);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; rain.connect(p); p.connect(B.sfx); } else rain.connect(B.sfx);
    rain.gain.setValueAtTime(0, at);
    for (let i = 0; i < grains; i++) {
      const gt = at + 0.12 + Math.pow(Math.random(), 0.8) * R.rain[0];
      const amp = g * R.rain[1] * (0.3 + Math.random() * 0.7) * (1 - (gt - at) / (R.rain[0] + 0.3));
      rain.gain.setValueAtTime(0.0001, gt);
      rain.gain.linearRampToValueAtTime(Math.max(0.0001, amp), gt + 0.008);
      rain.gain.linearRampToValueAtTime(0.0001, gt + 0.03 + Math.random() * 0.03);
    }
    nz.start(at, Math.random() * 1.5); nz.stop(at + 0.2 + R.rain[0] + 0.1);
    // ducking: M/XL −6/−9 dB (empieza cuando el sonido llega)
    duck(R.duckDb, at);
  }

  function playHit({ kill = false, kind = 'full' } = {}) {
    if (!usable()) return;
    const t = now();
    if (kill) {
      const { streak: n, pitch } = streak.hit(t);
      if (!takeVoice(t + 0.2, 3)) return;
      const tone = (f, at) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * pitch;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.32, at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, at + KILL.dur);
        o.connect(g); g.connect(B.ui); o.start(at); o.stop(at + KILL.dur + 0.02);
      };
      tone(KILL.f1, t); tone(KILL.f2, t + KILL.dur);
      duck(6, t);
      return n;
    }
    if (t - (playHit.last || 0) < 0.03) return;
    playHit.last = t;
    if (!takeVoice(t + 0.05, 1)) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = kind === 'graze' ? HIT_TICK.f * 0.8 : kind === 'deflect' ? 900 : HIT_TICK.f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(kind === 'graze' ? 0.12 : 0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + HIT_TICK.dur);
    o.connect(g); g.connect(B.ui); o.start(t); o.stop(t + HIT_TICK.dur + 0.02);
  }

  function playDamage({ amount = 10 } = {}) {
    if (!usable()) return;
    const t = now();
    if (t - (playDamage.last || 0) < 0.12) return;
    playDamage.last = t;
    if (!takeVoice(t + 0.4, 3)) return;
    const lvl = Math.min(1, 0.45 + amount / 30);
    playLayers([
      { t: 0, a: 0.002, gain: 0.9, src: 'osc', wave: 'sine', f: [95, 42], d: 0.14 },
      { t: 0, a: 0.004, gain: 0.45, src: 'noise', filter: { type: 'lowpass', f: [1800, 600], q: 0.7 }, d: 0.22 },
    ], { gain: lvl * 0.9, dest: B.ui });
  }

  function playUi(name) {
    if (!usable()) return;
    const t = now();
    if (t - (playUi.last || 0) < 0.04) return;
    playUi.last = t;
    const tones = {
      tap: [[900, 0.04, 0.08]], select: [[700, 0.05, 0.09], [1050, 0.06, 0.09]], back: [[700, 0.05, 0.08], [480, 0.06, 0.08]],
      confirm: [[660, 0.06, 0.1], [990, 0.08, 0.1]], error: [[300, 0.09, 0.12], [240, 0.1, 0.12]], weapon: [[520, 0.03, 0.07], [780, 0.03, 0.06]],
      pause: [[600, 0.05, 0.08], [400, 0.06, 0.08]], resume: [[400, 0.05, 0.08], [600, 0.06, 0.08]],
    }[name] || [[800, 0.04, 0.08]];
    let at = t;
    for (const [f, dur, vol] of tones) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + 0.004); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      o.connect(g); g.connect(B.ui); o.start(at); o.stop(at + dur + 0.02);
      at += dur * 0.85;
    }
  }

  /** Tonos de lock: acquiring = pitidos 3→12 Hz, locked = 1.2 kHz continuo, lost = dos tonos descendentes. */
  function playLock(state, progress) {
    if (!usable()) return;
    const t = now();
    const ls = lockState;
    if (state !== 'locked' && ls.osc) {
      try { ls.gain.gain.setTargetAtTime(0.0001, t, 0.01); ls.osc.stop(t + 0.06); } catch { /* */ }
      ls.osc = null; ls.gain = null;
    }
    if (state === 'acquiring') {
      if (t >= ls.nextBeep) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        o.connect(g); g.connect(B.ui); o.start(t); o.stop(t + 0.07);
        ls.nextBeep = t + 1 / lockBeepRate(progress);
      }
    } else if (state === 'locked') {
      if (!ls.osc) {
        ls.osc = ctx.createOscillator(); ls.osc.type = 'sine'; ls.osc.frequency.value = 1200;
        ls.gain = ctx.createGain(); ls.gain.gain.setValueAtTime(0.0001, t); ls.gain.gain.linearRampToValueAtTime(0.11, t + 0.01);
        ls.osc.connect(ls.gain); ls.gain.connect(B.ui); ls.osc.start(t);
      }
    } else if (state === 'lost' && ls.state !== 'lost') {
      [[1200, 0], [760, 0.09]].forEach(([f, dt]) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t + dt); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dt + 0.09);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.linearRampToValueAtTime(0.13, t + dt + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.09);
        o.connect(g); g.connect(B.ui); o.start(t + dt); o.stop(t + dt + 0.11);
      });
    } else if (state === 'none') ls.nextBeep = 0;
    ls.state = state;
  }

  const api = {
    get armed() { return !!ctx; },
    // rpm = propSpin del juego (14 ralentí … ~60 a fondo); dist/pan relativos
    // a la cámara activa (FPV pega el oído al dron, Lejos lo aleja).
    update(rpm, speed, lift, dist = 6, pan = 0) {
      if (!ctx || muted || !eng) return;
      const t = ctx.currentTime;
      // ?fv=2: si la física v2 publica s.m[] (ω normalizada por rotor) y |va|, los rotores siguen
      // al motor real; si no, cae a la fórmula de siempre (rpm/lift/speed del juego)
      const live = FV2 && (motorReader && readMotors()) || (FV2 && motorState.m && t - motorState.at < 0.4);
      const ES = live ? engineFromMotors(motorState.m, motorState.va || speed, motorState.gust, motorState.integrity) : null;
      // frecuencia de paso de pala (2 palas): ~105Hz ralentí → ~210Hz a fondo
      const bpf = ES ? ES.freqs.reduce((a, b) => a + b, 0) / ES.freqs.length : 74 + rpm * 2.2 + Math.max(0, lift) * 6;
      eng.rotors.forEach((r, i) => {
        const wob = 1 + Math.sin(t * r.rate * 6.28 + r.ph) * 0.004;
        const f = ES ? ES.freqs[i % ES.freqs.length] * (1 + (r.det - 1) * 0.25) : bpf * r.det;
        r.osc.frequency.setTargetAtTime(f * wob, t, 0.06);
      });
      eng.whine.frequency.setTargetAtTime(bpf * 9.5 * (t < whineDropUntil ? 0.6 : 1), t, 0.08);
      eng.chop.frequency.setTargetAtTime(bpf, t, 0.06);
      // carga: más thrust = más cuerpo, más propwash, más whine
      const load = ES ? ES.load : Math.min(1, Math.max(0, (rpm - 12) / 46));
      let motorGain = 0.10 + load * 0.15;
      if (FV2) {
        // tartamudeo de motor: integridad baja o golpe de hélice/choque (dips a ~8 Hz)
        const depth = Math.max(ES ? ES.stutter : 0, t < stutterUntil ? stutterDepth : 0);
        if (depth > 0) motorGain *= 1 - depth * (0.5 + 0.5 * Math.sin(t * 50));
      }
      eng.motorBus.gain.setTargetAtTime(motorGain, t, FV2 ? 0.04 : 0.12);
      eng.ng.gain.setTargetAtTime(0.02 + load * 0.17, t, 0.15);
      eng.noiseBp.frequency.setTargetAtTime(600 + load * 1500, t, 0.2);
      eng.wg.gain.setTargetAtTime(0.006 + load * 0.014, t, 0.15);
      // viento aparte ∝ v² (fv2: velocidad del aire |va| + ráfaga si la física la publica)
      const airspeed = ES ? (motorState.va || speed) : speed;
      eng.windG.gain.setTargetAtTime(ES ? ES.wind : Math.min(0.22, speed * speed * 0.00016), t, 0.2);
      eng.windBp.frequency.setTargetAtTime(400 + airspeed * 30, t, 0.25);
      // espacio: 1/d + absorción de aire + paneo
      const dd = Math.max(1.2, dist);
      eng.dist.gain.setTargetAtTime(Math.min(1, 2.4 / dd), t, 0.12);
      eng.air.frequency.setTargetAtTime(6500 / (1 + dd * 0.12), t, 0.15);
      eng.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, pan)), t, 0.1);
    },
    // ── ?fv=2 ─────────────────────────────────────────────────────────────
    get buses() { return B; },
    get context() { return ctx; },
    get fv2() { return FV2; },
    /** Bus de eventos + oyente + lector de motores. `listener()` -> {pos:{x,y,z}, right:{x,y,z}}. */
    attach({ bus = null, listener: getListener = null, motors = null } = {}) {
      if (getListener) listener = getListener;
      if (motors) motorReader = motors;
      if (bus && !busRef) {
        busRef = bus;
        bus.on('damage', d => api.damage(d));
        bus.on('crash', ({ energyClass } = {}) => {
          if (!ctx) return;
          const now = ctx.currentTime;
          if (energyClass === 'wobble' || energyClass === 'soft') { stutterUntil = now + 0.3; stutterDepth = 0.6; }
          else if (energyClass === 'prop') { stutterUntil = now + 0.5; stutterDepth = 0.85; whineDropUntil = now + 0.8; }
          else if (energyClass === 'crash') { stutterUntil = now + 0.9; stutterDepth = 1; whineDropUntil = now + 1.5; }
        });
      }
    },
    setMotors(m, va = 0, gust = 0, integrity = 1) {
      motorState.m = m; motorState.va = va; motorState.gust = gust; motorState.integrity = integrity;
      motorState.at = ctx ? ctx.currentTime : 0;
    },
    unlock() {
      if (!ctx) boot();
      if (!ctx) return false;
      ctx.resume?.().catch(() => {});
      try {                                                 // iOS: un buffer de 1 muestra dentro del gesto
        const b = ctx.createBuffer(1, 1, 22050); const src = ctx.createBufferSource();
        src.buffer = b; src.connect(ctx.destination); src.start(0);
      } catch { /* */ }
      return true;
    },
    duck(db = 6) { duck(db); },
    fire(key, opts = {}) { if (FV2) playFire(key, opts); else if (key === 'mg') api.mg(); else api.launch(); },
    charge(key, dur = 0.4) { if (FV2) playCharge(key, dur); },
    impact(surface, o = {}) { if (FV2) playImpact(surface, o); },
    explosion(o = {}) { if (FV2) playExplosion(o); else api.boom(o.big || 1); },
    hit(o = {}) { if (FV2) playHit(o); },
    lockTone(state, progress = 0) { if (FV2) playLock(state, progress); },
    damage(d = {}) { if (FV2) playDamage(d); },
    ui(name = 'tap') { if (FV2) playUi(name); },
    gate() { blip(880, 1420, 0.14, 'sine', 0.26); },
    tick() { blip(660, 660, 0.07, 'square', 0.14); },
    go() { blip(660, 1320, 0.22, 'square', 0.2); },
    crash() {
      blip(160, 40, 0.28, 'sawtooth', 0.3);
      if (usable()) {                                     // fv2: golpe grave + chasquido de plástico/hélice
        playLayers([
          { t: 0, a: 0.002, gain: 0.9, src: 'osc', wave: 'sine', f: [110, 38], d: 0.22 },
          { t: 0, a: 0.001, gain: 0.5, src: 'noise', filter: { type: 'bandpass', f: [1800, 900], q: 1.1 }, d: 0.09 },
        ], { gain: 0.8, dest: B.sfx });
        duck(6);
      }
    },
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
      n.connect(f); f.connect(g); g.connect(B.sfx); n.start();
      blip(900, 240, 0.3, 'sawtooth', 0.1);
    },
    mg() {                                     // ráfaga corta percusiva
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const n = ctx.createBufferSource();
      const b = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
      const c = b.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * (1 - i / c.length);
      n.buffer = b;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.34, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      n.connect(f); f.connect(g); g.connect(B.sfx); n.start();
    },
    boom(big = 1) {                            // explosión: sub + cuerpo, escala por tamaño
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const n = ctx.createBufferSource();
      const b = ctx.createBuffer(1, ctx.sampleRate * (1.1 + big * 0.5), ctx.sampleRate);
      const c = b.getChannelData(0);
      for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / c.length, 1.6);
      n.buffer = b;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(90, 200 - big * 40), t + 0.9 + big * 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(1, 0.7 + big * 0.2), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.0 + big * 0.4);
      n.connect(lp); lp.connect(g); g.connect(B.sfx); n.start();
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(80 - big * 12, t);
      sub.frequency.exponentialRampToValueAtTime(Math.max(20, 30 - big * 5), t + 0.6 + big * 0.25);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.55, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      sub.connect(sg); sg.connect(B.sfx); sub.start(); sub.stop(t + 0.85);
    },
    toggleMute() {
      // Si el control es el primer gesto, su intención es ACTIVAR sonido, no
      // crear el contexto y apagarlo inmediatamente en el click posterior.
      if (!ctx) {
        muted = false;
        boot();
        ctx?.resume?.().catch(() => {});
        return false;
      }
      muted = !muted;
      if (ctx) (muted ? ctx.suspend() : ctx.resume());
      return muted;
    },
  };
  return api;
}
