// flightverse/ui/reticle.js — el ÚNICO canvas 2D del HUD v2 (WS A).
// Dibuja, en un solo repintado por frame: retícula en espacio de pantalla (5 clases de arma),
// anillo de calor/enfriamiento, pipper de adelanto, caja de fijado, marcadores de impacto,
// arcos de daño, marcadores de amenazas, objetivo, cinta de rumbo, graduación de las cintas de
// velocidad/altitud, escalera de cabeceo + horizonte (FPV) y horizonte artificial (otras cámaras).
// Spec §3 y §14: forma + color, tamaños constantes en px, nada decorativo.
const TAU = Math.PI * 2;
export const HC = Object.freeze({
  ink: '#E6EBF2', ink2: '#B7C2D0', cand: '#E0A458', friend: '#45A0E6', ok: '#52C79A', hostile: '#D96A6A',
});
const FONT = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mixHex = (a, b, t) => {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',')})`;
};

/** Clase de retícula a partir del perfil de arma (kind del registro). */
export function reticleKindFor(profile) {
  switch (profile?.kind) {
    case 'bullet': return 'gun';
    case 'swarm': return 'swarm';
    case 'rail': return 'rail';
    case 'bomb': return 'nova';
    case 'missile': case 'guided': return 'missile';
    default: return 'gun';
  }
}

export function createHudCanvas(ctx, { canvas }) {
  const { THREE } = ctx;
  const g = canvas.getContext('2d');
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const L = {
    w: 1, h: 1, dpr: 1,
    compass: null, spd: null, agl: null, att: null,   // rects (css px) leídos del DOM
    phone: true,
  };
  const st = {
    kind: 'gun', weaponKey: 'm', screen: null, spreadPx: 22,
    heat: 0, overheated: false, cool: 1, readyFlash: 0, charge: 0, swarm: 0, splashPx: 0,
    lock: null, lockFade: null, pipper: null, threats: [], modeMarkers: null, objective: null,
    hits: [], arcs: [], lowHealth: 0, compassOn: true, fpv: false,
    tapes: { spdV: 0, aglV: 0, spdAct: 0, aglAct: 0 },
    externalReticle: false,                      // true si B llama setReticle (deja de derivarse)
  };
  let now = 0;

  function resize() {
    L.w = innerWidth; L.h = innerHeight;
    L.dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(L.w * L.dpr);
    canvas.height = Math.round(L.h * L.dpr);
    canvas.style.width = `${L.w}px`;
    canvas.style.height = `${L.h}px`;
    L.phone = Math.min(L.w, L.h) < 700;
  }
  const rectOf = el => {
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };
  /** Relee las anclas DOM (al redimensionar / cambiar de cámara). */
  function layout(anchors) {
    L.compass = rectOf(anchors.compass);
    L.spd = rectOf(anchors.spd);
    L.agl = rectOf(anchors.agl);
    L.att = rectOf(anchors.att);
  }

  const project = (x, y, z, out = tmpV2) => {
    out.set(x, y, z).project(ctx.camera);
    if (out.z > 1 || out.z < -1) return null;
    return [(out.x * 0.5 + 0.5) * L.w, (-out.y * 0.5 + 0.5) * L.h];
  };
  const toScreen = p => {
    if (!p) return null;
    if (Array.isArray(p)) return p;
    if (p.screen) return p.screen;
    if (Number.isFinite(p.sx)) return [p.sx, p.sy];
    if (Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.y)) return project(p.x, p.y, p.z);
    return null;
  };

  // ── API de entrada ──
  const api = {
    state: st, resize, layout,
    setReticle(kind, s = {}) {
      st.externalReticle = true;
      if (kind) st.kind = kind;
      if ('screen' in s) st.screen = toScreen(s.screen);
      if ('point' in s) st.screen = toScreen(s.point);
      for (const k of ['spreadPx', 'heat', 'overheated', 'cool', 'charge', 'swarm', 'splashPx']) if (k in s) st[k] = s[k];
    },
    hitMarker(type = 'hit') {
      st.hits.push({ t0: now, type });
      if (st.hits.length > 6) st.hits.shift();
    },
    damageArc(angle) {
      if (!Number.isFinite(angle)) return;
      st.arcs.push({ t0: now, a: angle });
      if (st.arcs.length > 3) st.arcs.shift();
    },
    setLock(l) {
      if (!l && st.lock) st.lockFade = { ...st.lock, t0: now };
      st.lock = l ? { ...l } : null;
    },
    setPipper(p) { st.pipper = p ? { ...p } : null; },
    setThreats(list) { st.threats = Array.isArray(list) ? list : []; },
    /** Modelo de marcadores de D (modes/invasion-mode.js renderHud().markers): coords 0..1 de pantalla. */
    setModeMarkers(m) { st.modeMarkers = m && (m.markers?.length || m.edges?.length || m.boss) ? m : null; },
    setObjective(o) { st.objective = o ? { ...o } : null; },
    setLowHealth(f) { st.lowHealth = clamp01(f); },
  };

  // ── utilidades de dibujo ──
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
  const plateText = (txt, x, y, color = HC.ink, align = 'center') => {
    g.font = FONT; g.textAlign = align; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = 'rgba(8,10,14,.8)'; g.strokeText(txt, x, y);
    g.fillStyle = color; g.fillText(txt, x, y);
  };

  function drawCompass(hdg) {
    const r = L.compass; if (!r || !st.compassOn) return;
    const { x, y, w, h } = r, mid = x + w / 2, ppd = w / 90;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.lineWidth = 1;
    const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    for (let d = Math.floor((hdg - 46) / 5) * 5; d <= hdg + 46; d += 5) {
      const dd = ((d % 360) + 360) % 360, px = mid + (d - hdg) * ppd;
      const major = dd % 15 === 0, cardinal = dd % 45 === 0;
      g.strokeStyle = cardinal ? HC.ink : 'rgba(183,194,208,.6)';
      line(px, y + h - 2, px, y + h - (cardinal ? 9 : major ? 7 : 4));
      if (cardinal) plateText(CARD[dd / 45], px, y + 8, HC.ink);
      else if (dd % 15 === 0 && Math.abs(px - mid) > 20) plateText(String(dd), px, y + 8, HC.ink2);
    }
    g.restore();
    g.fillStyle = HC.friend;
    g.beginPath(); g.moveTo(mid, y + h + 1); g.lineTo(mid - 4, y + h + 6); g.lineTo(mid + 4, y + h + 6); g.fill();
  }

  function drawTape(rect, value, step, pxPerStep, labelEvery, side, alpha) {
    if (!rect) return;
    const cy = rect.y + rect.h / 2;
    const half = 120;
    const ex = side === 'l' ? rect.x + 6 : rect.x + rect.w - 6;
    const dir = side === 'l' ? 1 : -1;
    g.save();
    g.globalAlpha = alpha;
    g.lineWidth = 1; g.strokeStyle = HC.ink2;
    const v0 = Math.floor((value - half / pxPerStep * step) / step) * step;
    for (let v = v0; v <= value + half / pxPerStep * step; v += step) {
      if (v < 0) continue;
      const ty = cy - (v - value) / step * pxPerStep;
      if (Math.abs(ty - cy) < 22 || Math.abs(ty - cy) > half) continue;   // hueco para la placa de lectura
      const major = Math.round(v / step) % labelEvery === 0;
      line(ex, ty, ex + dir * (major ? 10 : 6), ty);
      if (major) plateText(String(Math.round(v)), ex + dir * 14 + (side === 'l' ? 12 : -12), ty, HC.ink2, 'center');
    }
    g.restore();
  }

  function drawLadder(cam) {
    // cabeceo y alabeo desde la cámara activa (en FPV sigue el alabeo del dron)
    cam.getWorldDirection(tmpV);
    const pitch = Math.asin(Math.max(-1, Math.min(1, tmpV.y)));
    tmpV2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const roll = Math.asin(Math.max(-1, Math.min(1, tmpV2.y)));
    const vfov = cam.fov * Math.PI / 180;
    const pxPerRad = L.h / vfov;
    const cx = L.w / 2, cy = L.h / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(-roll);
    g.globalAlpha = 0.4;
    g.strokeStyle = HC.ink; g.lineWidth = 1; g.fillStyle = HC.ink;
    const hy = pitch * pxPerRad;   // cámara mirando arriba → el horizonte baja
    const gap = 64;
    const span = Math.min(L.w * 0.3, 170);
    line(-span, hy, -gap, hy); line(gap, hy, span, hy);
    for (const deg of [10, 20, 30, -10, -20, -30]) {
      const y = hy - deg * Math.PI / 180 * pxPerRad;
      if (Math.abs(y) < 96 || Math.abs(y) > L.h * 0.45) continue;   // nada a <96 px del centro (salvo retícula)
      const w = 44;
      line(-w, y, -14, y); line(14, y, w, y);
      line(-w, y, -w, y + (deg > 0 ? 6 : -6)); line(w, y, w, y + (deg > 0 ? 6 : -6));
      g.font = FONT; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(String(Math.abs(deg)), -w - 6, y);
    }
    g.restore();
  }

  function drawAttitude() {
    const r = L.att; if (!r || !ctx.drone?.quat) return;
    const q = ctx.drone.quat;
    tmpV.set(0, 0, -1).applyQuaternion(q);
    const pitch = Math.asin(Math.max(-1, Math.min(1, tmpV.y)));
    tmpV.set(1, 0, 0).applyQuaternion(q);
    const roll = Math.asin(Math.max(-1, Math.min(1, tmpV.y)));
    const R = Math.min(r.w, r.h) / 2, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    g.translate(cx, cy); g.rotate(-roll);
    const off = Math.max(-R, Math.min(R, pitch * R * 1.6));
    g.fillStyle = '#2b5f8f'; g.fillRect(-R * 2, -R * 2 + off, R * 4, R * 2);
    g.fillStyle = '#5d4b37'; g.fillRect(-R * 2, off, R * 4, R * 2);
    g.strokeStyle = HC.ink; g.lineWidth = 1; line(-R, off, R, off);
    g.restore();
    g.strokeStyle = 'rgba(230,235,242,.6)'; g.lineWidth = 1; arc(cx, cy, R - 0.5, 0, TAU);
    g.strokeStyle = HC.cand; g.lineWidth = 1.5; line(cx - 7, cy, cx - 2, cy); line(cx + 2, cy, cx + 7, cy);
  }

  function drawReticle(rx, ry, dt) {
    g.save();
    g.translate(rx, ry);
    g.globalAlpha = 0.7; g.strokeStyle = HC.ink; g.fillStyle = HC.ink; g.lineWidth = 1.5;
    // base: 4 marcas 8x1.5 con hueco de 10 px + punto de 2 px
    line(0, -10, 0, -18); line(0, 10, 0, 18); line(-10, 0, -18, 0); line(10, 0, 18, 0);
    g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
    g.lineWidth = 1;
    switch (st.kind) {
      case 'gun': arc(0, 0, st.spreadPx / 2, 0, TAU); break;
      case 'missile':                                   // anillo 28 px con 4 huecos
        for (let i = 0; i < 4; i++) arc(0, 0, 14, i * Math.PI / 2 + 0.32, (i + 1) * Math.PI / 2 - 0.32);
        break;
      case 'swarm':                                     // 8 puntos en círculo de 30 px
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU - Math.PI / 2;
          g.globalAlpha = i < st.swarm ? 1 : 0.35;
          g.beginPath(); g.arc(Math.cos(a) * 15, Math.sin(a) * 15, i < st.swarm ? 2 : 1.4, 0, TAU);
          if (i < st.swarm) g.fill(); else g.stroke();
        }
        break;
      case 'rail':                                      // hairlines de 60 px + arco de carga
        g.globalAlpha = 0.55;
        line(-30, 0, -22, 0); line(22, 0, 30, 0); line(0, -30, 0, -22); line(0, 22, 0, 30);
        if (st.charge > 0.01) {
          g.globalAlpha = 0.95; g.strokeStyle = HC.friend; g.lineWidth = 2;
          arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(st.charge));
        }
        break;
      case 'nova':                                      // círculo discontinuo 40 px + radio de splash
        g.setLineDash([4, 4]); arc(0, 0, 20, 0, TAU);
        if (st.splashPx > 24) { g.globalAlpha = 0.4; arc(0, 0, Math.min(st.splashPx, Math.min(L.w, L.h) * 0.4), 0, TAU); }
        g.setLineDash([]);
        if (st.charge > 0.01) {
          g.globalAlpha = 0.95; g.strokeStyle = HC.cand; g.lineWidth = 2;
          arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(st.charge));
        }
        break;
      default:
    }
    // anillo de calor (armas automáticas) o barrido de enfriamiento (resto) — radio 20, 1.5 px
    g.globalAlpha = 0.9; g.lineWidth = 1.5;
    if (st.kind === 'gun') {
      if (st.heat > 0.02 || st.overheated) {
        g.strokeStyle = st.overheated || st.heat >= 1 ? HC.hostile
          : st.heat > 0.7 ? mixHex(HC.cand, HC.hostile, (st.heat - 0.7) / 0.3)
            : mixHex(HC.ink, HC.cand, st.heat / 0.7);
        if (st.overheated) g.setLineDash([3, 3]);
        arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(st.heat));
        g.setLineDash([]);
      }
    } else if (st.cool < 0.999) {
      g.strokeStyle = HC.ink2;
      arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(st.cool));
    } else if (st.readyFlash > 0) {
      g.strokeStyle = HC.ink; g.lineWidth = 2; line(0, -24, 0, -20);
      st.readyFlash = Math.max(0, st.readyFlash - dt);
    }
    g.restore();
  }

  function drawPipper() {
    const p = st.pipper; if (!p) return;
    const s = toScreen(p); if (!s) return;
    g.save();
    g.strokeStyle = p.locked ? HC.friend : HC.cand; g.lineWidth = 1.5;
    g.strokeRect(s[0] - 3, s[1] - 3, 6, 6);
    g.restore();
  }

  function bracket(x, y, w, h, c, len) {
    g.beginPath();
    g.moveTo(x, y + len); g.lineTo(x, y); g.lineTo(x + len, y);
    g.moveTo(x + w - len, y); g.lineTo(x + w, y); g.lineTo(x + w, y + len);
    g.moveTo(x + w, y + h - len); g.lineTo(x + w, y + h); g.lineTo(x + w - len, y + h);
    g.moveTo(x + len, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - len);
    g.strokeStyle = c; g.lineWidth = 2; g.stroke();
  }
  function lockRect(l) {
    if (l.rect) return l.rect;
    const s = toScreen(l.world || l.target || l);
    if (!s) return null;
    const half = Math.max(16, l.halfPx || 18);
    return [s[0] - half, s[1] - half, half * 2, half * 2];
  }
  function drawLock() {
    let l = st.lock, k = 1;
    if (!l && st.lockFade) {                           // perdida: encoge y se desvanece en 150 ms
      const f = (now - st.lockFade.t0) / 0.15;
      if (f >= 1) st.lockFade = null; else { l = st.lockFade; k = 1 - f; }
    }
    if (!l) return;
    const r = lockRect(l); if (!r) return;
    const sh = l === st.lock ? 1 : 0.6 + 0.4 * k;
    const w = Math.max(32, r[2]) * sh, h = Math.max(32, r[3]) * sh;
    const x = r[0] + r[2] / 2 - w / 2, y = r[1] + r[3] / 2 - h / 2;
    const color = l.state === 'incoming' ? HC.hostile : l.state === 'locked' ? HC.friend : HC.cand;
    g.save(); g.globalAlpha = k;
    bracket(x, y, w, h, color, 9);
    if (l.state === 'acquiring') {                      // progreso: línea de 1 px por el perímetro
      const per = 2 * (w + h), run = per * clamp01(l.progress || 0);
      g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
      let rem = run;
      const seg = [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]];
      for (const [ax, ay, bx, by] of seg) {
        const len = Math.hypot(bx - ax, by - ay), t = Math.min(1, rem / len);
        if (rem <= 0) break;
        g.moveTo(ax, ay); g.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t);
        rem -= len;
      }
      g.stroke();
    } else if (l.state === 'locked') {                  // fijado: marco sólido
      g.strokeStyle = color; g.lineWidth = 1; g.strokeRect(x, y, w, h);
    }
    g.restore();
  }

  function drawHits() {
    for (let i = st.hits.length - 1; i >= 0; i--) {
      const h = st.hits[i], age = now - h.t0;
      const dur = h.type === 'kill' ? 0.25 : 0.1;
      if (age > dur) { st.hits.splice(i, 1); continue; }
      const k = age / dur, e = 1 - (1 - k) * (1 - k);     // ease-out
      const rx = st.screen?.[0] ?? L.w / 2, ry = st.screen?.[1] ?? L.h / 2;
      g.save(); g.translate(rx, ry); g.lineCap = 'round';
      if (h.type === 'deflect') {
        g.strokeStyle = 'rgba(160,168,180,.9)'; g.lineWidth = 2; g.globalAlpha = 1 - e;
        line(-7, 0, 7, 0);
      } else if (h.type === 'kill') {
        g.strokeStyle = mixHex('#ffffff', HC.hostile, 0.55); g.lineWidth = 2.5; g.globalAlpha = 1 - e * 0.6;
        const a = 5 + 11 * e * 0.25 + 3, b = 16 / 2 + 3;
        line(-b, -b, -a, -a); line(b, -b, a, -a); line(b, b, a, a); line(-b, b, -a, a);
        line(-a, -a, a, a); line(a, -a, -a, a);
      } else {
        const big = h.type === 'hit';
        g.strokeStyle = '#fff'; g.lineWidth = big ? 2 : 1.5; g.globalAlpha = (big ? 1 : 0.6) * (1 - e);
        const r0 = 6 + e * 2, r1 = r0 + (big ? 6 : 4);
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          line(sx * r0 * 0.707, sy * r0 * 0.707, sx * r1 * 0.707, sy * r1 * 0.707);
        }
      }
      g.restore();
    }
  }

  function drawArcs() {
    const R = Math.min(L.w, L.h) * 0.32;
    for (let i = st.arcs.length - 1; i >= 0; i--) {
      const a = st.arcs[i], age = now - a.t0;
      if (age > 1.2) { st.arcs.splice(i, 1); continue; }
      g.save();
      g.globalAlpha = 1 - age / 1.2; g.strokeStyle = HC.hostile; g.lineWidth = 4; g.lineCap = 'butt';
      const c = a.a - Math.PI / 2;                      // 0 = arriba, sentido horario
      arc(L.w / 2, L.h / 2, R, c - Math.PI / 6, c + Math.PI / 6);
      g.restore();
    }
  }

  function drawVignette() {
    if (st.lowHealth <= 0.01) return;
    const grd = g.createRadialGradient(L.w / 2, L.h / 2, Math.min(L.w, L.h) * 0.42, L.w / 2, L.h / 2, Math.hypot(L.w, L.h) * 0.56);
    grd.addColorStop(0, 'rgba(217,106,106,0)');
    grd.addColorStop(1, `rgba(217,106,106,${(0.06 * st.lowHealth).toFixed(3)})`);
    g.fillStyle = grd; g.fillRect(0, 0, L.w, L.h);
  }

  function drawThreats() {
    if (!st.threats.length) return;
    const cam = ctx.camera, max = L.phone ? 6 : 8;
    const items = st.threats.map(t => {
      const p = t.pos || t;
      tmpV.set(p.x, p.y, p.z);
      const dist = t.dist ?? cam.position.distanceTo(tmpV);
      return { t, dist, p };
    }).filter(i => i.dist <= 300).sort((a, b) => a.dist - b.dist);
    let drawn = 0, edge = 0;
    const cx = L.w / 2, cy = L.h / 2, ring = Math.min(L.w, L.h) * 0.42;
    for (const it of items) {
      const s = project(it.p.x, it.p.y, it.p.z);
      const inside = s && s[0] > 8 && s[0] < L.w - 8 && s[1] > 8 && s[1] < L.h - 8;
      if (inside && drawn < max) {
        drawn++;
        const [x, y] = s, hostile = HC.hostile;
        g.save(); g.strokeStyle = hostile; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.closePath(); g.stroke();
        plateText(`${Math.round(it.dist)} m`, x, y + 18, HC.ink2);
        const hp = it.t.hp;
        if (hp != null && hp < 0.999 || it.t.locked) {
          const f = clamp01(hp ?? 1);
          g.fillStyle = 'rgba(8,10,14,.72)'; g.fillRect(x - 24, y - 17, 48, 4);
          g.fillStyle = hostile; g.fillRect(x - 24, y - 17, 48 * f, 4);
          if (it.t.tiered) { g.fillStyle = 'rgba(8,10,14,.9)'; for (const q of [.25, .5, .75]) g.fillRect(x - 24 + 48 * q - 0.5, y - 17, 1, 4); }
        }
        g.restore();
      } else if (!inside && edge < 3) {
        edge++;
        // dirección en pantalla hacia el enemigo (proyección invertida si está detrás)
        tmpV2.set(it.p.x, it.p.y, it.p.z).project(cam);
        let dx = tmpV2.x, dy = -tmpV2.y;
        if (tmpV2.z > 1) { dx = -dx; dy = -dy; }
        const m = Math.hypot(dx, dy) || 1;
        const ax = cx + dx / m * ring, ay = cy + dy / m * ring;
        const ang = Math.atan2(dy, dx);
        g.save(); g.translate(ax, ay); g.rotate(ang);
        g.globalAlpha = clamp01(1.1 - it.dist / 320); g.fillStyle = HC.hostile;
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-5, -7); g.lineTo(-5, 7); g.closePath(); g.fill();
        g.restore();
      }
    }
  }

  function drawModeMarkers() {
    const m = st.modeMarkers; if (!m) return;
    const t = now;
    g.save();
    for (const k of m.markers || []) {
      const x = k.x * L.w, y = k.y * L.h - (k.boss ? 26 : 18);
      const tele = k.telegraphing && (Math.floor(t * 8) % 2 === 0);
      const half = k.boss ? 8 : 6;
      g.beginPath(); g.moveTo(x, y - half); g.lineTo(x + half, y); g.lineTo(x, y + half); g.lineTo(x - half, y); g.closePath();
      g.fillStyle = tele ? HC.hostile : 'rgba(217,106,106,.18)'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = tele ? '#fff' : HC.hostile; g.stroke();
      plateText(`${k.dist} m`, x, y + 19, HC.ink);
      if (k.hpFrac < 0.999 && !k.boss) {
        g.fillStyle = 'rgba(8,10,14,.72)'; g.fillRect(x - 24, y + 29, 48, 4);
        g.fillStyle = HC.hostile; g.fillRect(x - 24, y + 29, 48 * clamp01(k.hpFrac), 4);
      }
    }
    for (const e of m.edges || []) {
      g.save(); g.translate(e.x * L.w, e.y * L.h); g.rotate(-e.angle); g.globalAlpha = e.opacity ?? 1;
      g.beginPath(); g.moveTo(9, 0); g.lineTo(-7, -8); g.lineTo(-7, 8); g.closePath();
      g.fillStyle = HC.hostile; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(8,10,14,.85)'; g.stroke();
      g.restore();
    }
    if (m.boss) {                                   // barra de jefe 220x6 arriba al centro, segmentos de 25 %
      const bw = Math.min(220, L.w - 48), bx = (L.w - bw) / 2, by = (st.bossY ?? 92);
      plateText(m.boss.name, L.w / 2, by - 10, HC.ink);
      g.fillStyle = 'rgba(8,10,14,.72)'; g.fillRect(bx, by, bw, 6);
      g.fillStyle = HC.hostile; g.fillRect(bx, by, bw * clamp01(m.boss.hpFrac), 6);
      g.fillStyle = 'rgba(8,10,14,.9)'; for (const q of [.25, .5, .75]) g.fillRect(bx + bw * q - 0.5, by, 1, 6);
    }
    g.restore();
  }

  function drawObjective() {
    const o = st.objective; if (!o) return;
    const cam = ctx.camera;
    tmpV2.set(o.x, o.y, o.z).project(cam);
    const behind = tmpV2.z > 1;
    let sx = (tmpV2.x * 0.5 + 0.5) * L.w, sy = (-tmpV2.y * 0.5 + 0.5) * L.h;
    const inside = !behind && sx > 30 && sx < L.w - 30 && sy > 70 && sy < L.h - 130;
    const dist = Math.round(cam.position.distanceTo(tmpV.set(o.x, o.y, o.z)));
    g.save();
    g.strokeStyle = HC.friend; g.fillStyle = HC.friend; g.lineWidth = 1.5;
    if (inside) {
      g.beginPath(); g.arc(sx, sy, 11, 0, TAU); g.stroke();
      plateText(`${dist} m`, sx, sy + 24, HC.ink2);
      if (o.label) plateText(o.label, sx, sy - 24, HC.ink);
    } else {
      let dx = tmpV2.x, dy = -tmpV2.y; if (behind) { dx = -dx; dy = -dy; }
      const m = Math.hypot(dx, dy) || 1, R = Math.min(L.w, L.h) * 0.36;
      const ax = L.w / 2 + dx / m * R, ay = L.h / 2 + dy / m * R;
      g.translate(ax, ay); g.rotate(Math.atan2(dy, dx));
      g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -8); g.lineTo(-2, 0); g.lineTo(-6, 8); g.closePath(); g.fill();
    }
    g.restore();
  }

  /** Un repintado por frame. frame = { dt, hdg, spd, agl, fpv, showReticle, cam } */
  function draw(frame) {
    now += frame.dt;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.clearRect(0, 0, L.w, L.h);
    g.lineCap = 'butt';
    drawVignette();
    drawCompass(frame.hdg);
    if (frame.fpv) {
      const t = st.tapes;
      t.spdAct = Math.max(0, t.spdAct - frame.dt);
      if (Math.abs(frame.spd - t.spdV) / Math.max(frame.dt, 1e-3) > 0.5) t.spdAct = 0.6;
      t.spdV = frame.spd;
      const aglV = frame.agl ?? 0;
      t.aglAct = Math.max(0, t.aglAct - frame.dt);
      if (Math.abs(aglV - t.aglV) / Math.max(frame.dt, 1e-3) > 0.5) t.aglAct = 0.6;
      t.aglV = aglV;
      drawTape(L.spd, frame.spd, 2, 14, 5, 'l', t.spdAct > 0 ? 1 : 0.6);
      drawTape(L.agl, aglV, 5, 14, 2, 'r', t.aglAct > 0 ? 1 : 0.6);
      drawLadder(frame.cam);
    } else drawAttitude();
    drawObjective();
    drawThreats();
    drawModeMarkers();
    drawLock();
    drawPipper();
    if (frame.showReticle !== false) {
      const rx = st.screen?.[0] ?? L.w / 2, ry = st.screen?.[1] ?? L.h / 2;
      drawReticle(rx, ry, frame.dt);
    }
    drawHits();
    drawArcs();
  }

  resize();
  return Object.assign(api, { draw, project });
}
