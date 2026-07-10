// Editor de fotos premium compartido (flight + studio). Requiere shell.js e icons.js.
function openPhotoEditor({ url, name }) {
  const ov = document.createElement('div');
  ov.className = 'login-ov';
  const SLIDERS = {
    luz: [
      ['bright', 'Brillo', 60, 140, 100], ['contrast', 'Contraste', 60, 140, 100],
      ['high', 'Luces', -50, 50, 0], ['shadow', 'Sombras', -50, 50, 0], ['fade', 'Fade', 0, 60, 0],
    ],
    color: [
      ['sat', 'Saturación', 0, 200, 100], ['temp', 'Temperatura', -40, 40, 0], ['tint', 'Tinte', -40, 40, 0],
    ],
    fx: [
      ['vig', 'Viñeta', 0, 60, 0], ['grain', 'Grano', 0, 50, 0],
    ],
  };
  const sliderRow = ([k, lb, mn, mx, dv]) => `
    <div class="pm-row"><span class="tool-lb" data-dbl="${k}" data-tip="Doble click = reset">${lb}</span>
      <input type="range" class="pm-range" data-f="${k}" min="${mn}" max="${mx}" value="${dv}">
      <span class="mono pm-val" data-v="${k}">${dv}</span></div>`;
  ov.innerHTML = `
    <div class="photo-modal pm2">
      <div class="pm-stage"><canvas id="pm-cv"></canvas></div>
      <div class="pm-tools">
        <div class="pm-row"><span class="tool-lb">Preset</span>
          <button class="chip on" data-preset="orig">Original</button>
          <button class="chip" data-preset="cine">Cine</button>
          <button class="chip" data-preset="vivid">Vivid</button>
          <button class="chip" data-preset="dorado">Dorado</button>
          <button class="chip" data-preset="bn">B&N</button></div>
        <div class="pm-tabs">
          <button class="on" data-tab="luz">${icon('sun')} Luz</button>
          <button data-tab="color">${icon('spark')} Color</button>
          <button data-tab="fx">${icon('film')} Efectos</button>
          <span class="pm-ink"></span>
        </div>
        <div class="pm-group" data-group="luz">${SLIDERS.luz.map(sliderRow).join('')}</div>
        <div class="pm-group" data-group="color" style="display:none">${SLIDERS.color.map(sliderRow).join('')}</div>
        <div class="pm-group" data-group="fx" style="display:none">${SLIDERS.fx.map(sliderRow).join('')}</div>
        <div class="pm-row"><span class="tool-lb">Formato</span>
          <button class="chip on" data-ratio="orig">Original</button>
          <button class="chip" data-ratio="45">4:5 Feed</button>
          <button class="chip" data-ratio="11">1:1</button>
          <button class="chip" data-ratio="916">9:16 Story</button>
          <button class="chip" data-ratio="169">16:9</button></div>
        <div class="pm-row"><span class="tool-lb">Calidad</span>
          <button class="chip" data-size="ig">Instagram (1080)</button>
          <button class="chip on" data-size="max">Máxima (4K)</button>
          <button class="chip" data-size="custom">Custom</button>
          <input type="number" class="ctl" id="pm-custom" min="480" max="3840" value="1600"
            style="width:86px;display:none;padding:3px 8px;font-size:12px"> <span class="mono" id="pm-dims"></span></div>
      </div>
      <div class="pm-bar">
        <button class="btn" data-reset data-tip="Volver al original">Reset</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn primary" data-sharephoto>${icon('ext')} Guardar en Fotos</button>
        <button class="btn" data-dl>${icon('dl')} Descargar</button>
        <button class="btn" data-close>Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  // --- motor: pixel-math unificado — preview 720p EXACTO al export ---
  const cv = ov.querySelector('#pm-cv');
  const ctx = cv.getContext('2d');
  const img = new Image();
  const DEF = { bright: 100, contrast: 100, high: 0, shadow: 0, fade: 0,
                sat: 100, temp: 0, tint: 0, vig: 0, grain: 0, ratio: 'orig', size: 'max', custom: 1600 };
  const fx = { ...DEF };
  const RATIOS = { orig: null, '45': 4 / 5, '11': 1, '916': 9 / 16, '169': 16 / 9 };
  let noiseTile = null;

  function crop() {
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    const r = RATIOS[fx.ratio];
    if (r) {
      if (sw / sh > r) { const w = sh * r; sx = (sw - w) / 2; sw = w; }
      else { const h = sw / r; sy = (sh - h) / 2; sh = h; }
    }
    return { sx, sy, sw, sh };
  }
  function applyPixels(c2, w, h) {
    const b = fx.bright / 100, c = fx.contrast / 100, st = fx.sat / 100;
    const hi = fx.high, sh = fx.shadow, fd = fx.fade, tp = fx.temp, tn = fx.tint;
    if (b === 1 && c === 1 && st === 1 && !hi && !sh && !fd && !tp && !tn) return;
    const im = c2.getImageData(0, 0, w, h);
    const d8 = im.data;
    for (let i = 0; i < d8.length; i += 4) {
      let r = d8[i] * b, g = d8[i + 1] * b, bl = d8[i + 2] * b;
      const lum0 = r * 0.299 + g * 0.587 + bl * 0.114;
      if (sh && lum0 < 128) { const k = sh * (1 - lum0 / 128) * 0.8; r += k; g += k; bl += k; }
      if (hi && lum0 > 128) { const k = hi * ((lum0 - 128) / 128) * 0.8; r += k; g += k; bl += k; }
      r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
      if (fd) { const k = fd / 100 * 0.32; r += (120 - r) * k; g += (120 - g) * k; bl += (120 - bl) * k; }
      if (tp) { r += tp * 0.55; bl -= tp * 0.55; }
      if (tn) { g += tn * 0.5; }
      const lum = r * 0.299 + g * 0.587 + bl * 0.114;
      d8[i] = Math.max(0, Math.min(255, lum + (r - lum) * st));
      d8[i + 1] = Math.max(0, Math.min(255, lum + (g - lum) * st));
      d8[i + 2] = Math.max(0, Math.min(255, lum + (bl - lum) * st));
    }
    c2.putImageData(im, 0, 0);
  }
  function overlays(c2, w, h) {
    if (fx.grain) {
      if (!noiseTile) {
        noiseTile = document.createElement('canvas');
        noiseTile.width = noiseTile.height = 128;
        const nx = noiseTile.getContext('2d');
        const nd = nx.createImageData(128, 128);
        for (let i = 0; i < nd.data.length; i += 4) {
          const v = 118 + Math.random() * 20;
          nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v;
          nd.data[i + 3] = 255;
        }
        nx.putImageData(nd, 0, 0);
      }
      c2.globalAlpha = fx.grain / 90;
      c2.globalCompositeOperation = 'overlay';
      c2.fillStyle = c2.createPattern(noiseTile, 'repeat');
      c2.fillRect(0, 0, w, h);
      c2.globalAlpha = 1;
      c2.globalCompositeOperation = 'source-over';
    }
    if (fx.vig) {
      const g = c2.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${fx.vig / 80})`);
      c2.fillStyle = g;
      c2.fillRect(0, 0, w, h);
    }
  }
  function renderTo(canvas, maxW) {
    const { sx, sy, sw, sh } = crop();
    const sc = Math.min(1, maxW / sw);
    canvas.width = Math.round(sw * sc);
    canvas.height = Math.round(sh * sc);
    const c2 = canvas.getContext('2d');
    c2.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    applyPixels(c2, canvas.width, canvas.height);
    overlays(c2, canvas.width, canvas.height);
  }
  let raf = null;
  function draw() {
    if (raf) return;
    // rAF se congela con el tab oculto — setTimeout como respaldo
    const sched = document.hidden ? fn => setTimeout(fn, 16) : requestAnimationFrame.bind(window);
    raf = sched(() => {
      raf = null;
      if (!img.naturalWidth) return;
      renderTo(cv, 720);                       // preview: rápido y EXACTO
      const w = fx.size === 'ig' ? 1080 : fx.size === 'custom' ? fx.custom : 3840;
      const { sw, sh } = crop();
      const sc = Math.min(1, w / sw);
      ov.querySelector('#pm-dims').textContent = `${Math.round(sw * sc)}×${Math.round(sh * sc)}`;
    });
  }
  img.onload = draw;
  img.src = url;
  async function exportBlob() {
    const w = fx.size === 'ig' ? 1080 : fx.size === 'custom' ? fx.custom : 3840;
    const out = document.createElement('canvas');
    renderTo(out, w);                          // export: mismo motor, full res
    return new Promise(res => out.toBlob(res, 'image/jpeg', 0.92));
  }

  const PRESETS = {
    orig: { ...DEF },
    cine: { ...DEF, bright: 98, contrast: 112, sat: 92, temp: -8, vig: 24, fade: 12, grain: 10 },
    vivid: { ...DEF, bright: 104, contrast: 110, sat: 140, high: -8, shadow: 10, temp: 4 },
    dorado: { ...DEF, bright: 104, contrast: 104, sat: 112, temp: 26, vig: 14, shadow: 8 },
    bn: { ...DEF, bright: 102, contrast: 120, sat: 0, vig: 18, grain: 16, fade: 8 },
  };
  function paintRange(r) {
    const p = (r.value - r.min) / (r.max - r.min) * 100;
    r.style.background = `linear-gradient(90deg, var(--accent) ${p}%, var(--surface-2) ${p}%)`;
  }
  function syncUI() {
    ov.querySelectorAll('input[data-f]').forEach(r => { r.value = fx[r.dataset.f]; paintRange(r); });
    ov.querySelectorAll('.pm-val').forEach(v => { v.textContent = fx[v.dataset.v]; });
    ov.querySelectorAll('[data-ratio]').forEach(x => x.classList.toggle('on', x.dataset.ratio === fx.ratio));
    ov.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('on', x.dataset.size === fx.size));
    ov.querySelector('#pm-custom').style.display = fx.size === 'custom' ? '' : 'none';
  }
  ov.querySelectorAll('.pm-range').forEach(paintRange);
  // tabs con tinta deslizante
  const ink = ov.querySelector('.pm-ink');
  function moveInk() {
    const on = ov.querySelector('.pm-tabs button.on');
    ink.style.left = on.offsetLeft + 'px';
    ink.style.width = on.offsetWidth + 'px';
  }
  setTimeout(moveInk, 30);   // tras layout; rAF no dispara con tab oculto
  const onRs = () => moveInk();
  window.addEventListener('resize', onRs);
  ov.addEventListener('click', e => { if (e.target.closest('[data-close]')) window.removeEventListener('resize', onRs); });
  ov.querySelector('.pm-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    ov.querySelectorAll('.pm-tabs button').forEach(x => x.classList.toggle('on', x === b));
    moveInk();
    ov.querySelectorAll('.pm-group').forEach(g => {
      const show = g.dataset.group === b.dataset.tab;
      if (show && g.style.display === 'none') {
        g.style.display = '';
        g.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
                  { duration: 200, easing: 'ease-out' });
      } else if (!show) g.style.display = 'none';
    });
  });
  ov.addEventListener('input', ev => {
    const f = ev.target.dataset.f;
    if (f) {
      fx[f] = +ev.target.value;
      paintRange(ev.target);
      const val = ov.querySelector(`.pm-val[data-v="${f}"]`);
      val.textContent = fx[f];
      val.style.transform = 'scale(1.35)';
      clearTimeout(val._t);
      val._t = setTimeout(() => { val.style.transform = ''; }, 120);
      ov.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('on'));
      draw();
    }
    if (ev.target.id === 'pm-custom') { fx.custom = Math.max(480, Math.min(3840, +ev.target.value || 1600)); draw(); }
  });
  const dblReset = lb => { fx[lb.dataset.dbl] = DEF[lb.dataset.dbl]; syncUI(); draw(); };
  let _lastTap = 0, _lastEl = null;                 // dblclick no dispara fiable en táctil → doble-tap propio
  ov.addEventListener('pointerup', ev => {
    if (ev.pointerType === 'mouse') return;
    const lb = ev.target.closest('[data-dbl]');
    if (!lb) { _lastEl = null; return; }
    if (_lastEl === lb && ev.timeStamp - _lastTap < 350) { _lastTap = 0; _lastEl = null; dblReset(lb); }
    else { _lastTap = ev.timeStamp; _lastEl = lb; }
  });
  ov.addEventListener('dblclick', ev => {
    const lb = ev.target.closest('[data-dbl]');
    if (!lb) return;
    dblReset(lb);
  });
  ov.addEventListener('click', ev => {
    const pb = ev.target.closest('[data-preset]');
    if (pb) {
      Object.assign(fx, PRESETS[pb.dataset.preset], { ratio: fx.ratio, size: fx.size, custom: fx.custom });
      ov.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('on', x === pb));
      syncUI(); draw(); return;
    }
    const rb = ev.target.closest('[data-ratio]');
    if (rb) { fx.ratio = rb.dataset.ratio; syncUI(); draw(); return; }
    const sb = ev.target.closest('[data-size]');
    if (sb) { fx.size = sb.dataset.size; syncUI(); draw(); return; }
    if (ev.target.closest('[data-reset]')) {
      Object.assign(fx, DEF);
      ov.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('on', x.dataset.preset === 'orig'));
      syncUI(); draw();
    }
  });
  ov.querySelector('[data-sharephoto]').addEventListener('click', async ev => {
    const btn = ev.currentTarget, orig = btn.innerHTML;
    btn.innerHTML = 'Preparando…';
    const blob = await exportBlob();
    const file = new File([blob], name, { type: 'image/jpeg' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); }
    } catch {}
    btn.innerHTML = orig;
  });
  ov.querySelector('[data-dl]').addEventListener('click', async () => {
    const blob = await exportBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  });
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
  });
}
