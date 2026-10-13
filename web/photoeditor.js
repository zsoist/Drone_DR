// Editor de fotos premium compartido (flight + studio). Requiere shell.js e icons.js.
async function openPhotoEditor({ url, name }) {
  if (!document.querySelector('link[href*="css/studio.css"]')) {
    const link=document.createElement('link');link.rel='stylesheet';link.href='css/studio.css?v=435';document.head.append(link);
  }
  const { mountTabs } = await import('./ui/tabs.js?v=434');
  const { createSheet } = await import('./ui/sheet.js?v=434');
  const { showToast } = await import('./ui/toast.js?v=434');
  const ov = document.createElement('div');
  ov.className = 'photo-editor-ov';
  const SLIDERS = {
    luz: [
      ['bright', 'Brillo', 60, 140, 100], ['contrast', 'Contraste', 60, 140, 100],
      ['high', 'Luces', -50, 50, 0], ['shadow', 'Sombras', -50, 50, 0], ['fade', 'Desvanecer', 0, 60, 0],
    ],
    color: [
      ['sat', 'Saturación', 0, 200, 100], ['temp', 'Temperatura', -40, 40, 0], ['tint', 'Tinte', -40, 40, 0],
    ],
    fx: [
      ['vig', 'Viñeta', 0, 60, 0], ['grain', 'Grano', 0, 50, 0],
    ],
  };
  const sliderRow = ([k, lb, mn, mx, dv]) => `
    <div class="pm-row"><label for="pm-${k}" class="tool-lb" data-dbl="${k}" data-tip="Doble click = reset">${lb}</label>
      <input type="range" class="pm-range" id="pm-${k}" data-f="${k}" min="${mn}" max="${mx}" value="${dv}">
      <span class="mono pm-val" data-v="${k}">${dv}</span></div>`;
  ov.innerHTML = `
    <div class="photo-modal pm2">
      <div class="pm-stage"><canvas id="pm-cv"></canvas><div class="pm-load" role="status"><span class="ui-skeleton ui-skeleton--media" aria-hidden="true"></span><p>Cargando foto…</p><button class="ui-button ui-button--secondary" data-retry hidden>Reintentar</button></div></div>
      <div class="pm-tools">
        <div class="pm-row"><span class="tool-lb">Estilo</span>
          <button class="chip on" data-preset="orig">Original</button>
          <button class="chip" data-preset="cine">Cine</button>
          <button class="chip" data-preset="vivid">Vívido</button>
          <button class="chip" data-preset="dorado">Dorado</button>
          <button class="chip" data-preset="bn">B&N</button></div>
        <div class="ui-tabs pm-tabs" aria-label="Ajustes de foto">
          <button data-tab="luz" role="tab" aria-controls="pm-group-luz" aria-selected="true">${icon('sun')} Luz</button>
          <button data-tab="color" role="tab" aria-controls="pm-group-color" aria-selected="false">${icon('sun')} Color</button>
          <button data-tab="fx" role="tab" aria-controls="pm-group-fx" aria-selected="false">${icon('film')} Efectos</button>
        </div>
        <div class="pm-group" id="pm-group-luz" data-group="luz">${SLIDERS.luz.map(sliderRow).join('')}</div>
        <div class="pm-group" id="pm-group-color" data-group="color">${SLIDERS.color.map(sliderRow).join('')}</div>
        <div class="pm-group" id="pm-group-fx" data-group="fx">${SLIDERS.fx.map(sliderRow).join('')}</div>
        <div class="pm-row"><span class="tool-lb">Formato</span>
          <button class="chip on" data-ratio="orig">Original</button>
          <button class="chip" data-ratio="45">4:5 Feed</button>
          <button class="chip" data-ratio="11">1:1</button>
          <button class="chip" data-ratio="916">9:16 Story</button>
          <button class="chip" data-ratio="169">16:9</button></div>
        <div class="pm-row"><span class="tool-lb">Calidad</span>
          <button class="chip" data-size="ig">Instagram (1080)</button>
          <button class="chip on" data-size="max">Máxima disponible</button>
          <button class="chip" data-size="custom">Personalizada</button>
          <input type="number" class="ctl" id="pm-custom" aria-label="Ancho de salida en píxeles" min="480" max="3840" value="1600"
            style="width:86px;display:none"> <span class="mono" id="pm-dims"></span></div>
      </div>
      <div class="pm-bar">
        <button class="btn" data-reset data-tip="Volver al original">Restablecer</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn primary" data-sharephoto>${icon('ext')} Guardar en Fotos</button>
        <button class="btn" data-dl>${icon('dl')} Descargar</button>
        <button class="btn" data-close>Cerrar</button>
      </div>
    </div>`;
  // openModal (shell.js): role=dialog, foco atrapado, Esc por la pila de capas, scroll lock; cleanup en onClose
  ov.classList.add('st-sheet-content');
  ov.querySelectorAll('button').forEach(b=>{b.classList.add('ui-button');if(b.classList.contains('primary'))b.classList.add('ui-button--primary');});
  const sheet = createSheet({ title: 'Editar foto', content: ov, size: 'full', className:'st-sheet st-photo-sheet', onClose: () => { release(); queueMicrotask(()=>sheet.destroy()); } });
  sheet.open();

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
    schedulePrepare();
  }
  let loaded = false, disposed = false;
  const loadState = ov.querySelector('.pm-load');
  const exportButtons = [...ov.querySelectorAll('[data-dl],[data-sharephoto]')];
  exportButtons.forEach(b=>b.disabled=true);
  img.onload = () => {
    if(disposed) return;
    loaded=true;loadState.hidden=true;exportButtons.forEach(b=>b.disabled=false);draw();
  };
  img.onerror = () => {
    if(disposed) return;
    loaded=false;loadState.hidden=false;loadState.querySelector('.ui-skeleton').hidden=true;
    loadState.querySelector('p').textContent='No se pudo cargar la foto. Revisa la conexión y reintenta.';
    loadState.querySelector('[data-retry]').hidden=false;exportButtons.forEach(b=>b.disabled=true);
  };
  loadState.querySelector('[data-retry]').onclick=()=>{
    loadState.querySelector('p').textContent='Cargando foto…';loadState.querySelector('[data-retry]').hidden=true;
    img.src=url;
  };
  img.src = url;
  async function exportBlob() {
    if (!loaded || disposed) throw new Error('La foto aún no está disponible.');
    const w = fx.size === 'ig' ? 1080 : fx.size === 'custom' ? fx.custom : 3840;
    const out = document.createElement('canvas');
    renderTo(out, w);                          // export: mismo motor, full res
    let blob;
    try { blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.92)); }
    finally { out.width = out.height = 0; }   // iOS limita la memoria total de canvas: suelta el de 4K ya
    if (!blob) throw new Error('No se pudo generar la imagen (¿demasiado grande para este dispositivo?)');
    return blob;
  }
  // el blob se PRERRENDERIZA cuando los ajustes se asientan: en iOS, navigator.share tras un
  // await largo (export 4K) pierde la activación del usuario y falla en silencio
  const outName = name.replace(/\.[^./\\]+$/, '') + '.jpg';   // el blob es JPEG aunque la fuente sea .DNG
  const notify = showToast;
  let prep = { key: '', blob: null, p: null }, prepT = null;
  function prepare() {
    const key = JSON.stringify(fx);
    if (prep.key === key && prep.p) return prep.p;
    const cur = prep = { key, blob: null, p: null };
    cur.p = exportBlob().then(b => { cur.blob = b; return b; });
    cur.p.catch(() => { if (prep === cur) prep = { key: '', blob: null, p: null }; });
    return cur.p;
  }
  const schedulePrepare = () => { clearTimeout(prepT); prepT = setTimeout(() => { prepare().catch(() => {}); }, 2500); };   // reposo largo: cada prerender 4K cuesta ~64 MB de canvas

  const PRESETS = {
    orig: { ...DEF },
    cine: { ...DEF, bright: 98, contrast: 112, sat: 92, temp: -8, vig: 24, fade: 12, grain: 10 },
    vivid: { ...DEF, bright: 104, contrast: 110, sat: 140, high: -8, shadow: 10, temp: 4 },
    dorado: { ...DEF, bright: 104, contrast: 104, sat: 112, temp: 26, vig: 14, shadow: 8 },
    bn: { ...DEF, bright: 102, contrast: 120, sat: 0, vig: 18, grain: 16, fade: 8 },
  };
  function syncUI() {
    ov.querySelectorAll('input[data-f]').forEach(r => { r.value = fx[r.dataset.f]; });
    ov.querySelectorAll('.pm-val').forEach(v => { v.textContent = fx[v.dataset.v]; });
    ov.querySelectorAll('[data-ratio]').forEach(x => x.classList.toggle('on', x.dataset.ratio === fx.ratio));
    ov.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('on', x.dataset.size === fx.size));
    ov.querySelectorAll('.chip').forEach(x=>x.setAttribute('aria-pressed',String(x.classList.contains('on'))));
    ov.querySelector('#pm-custom').style.display = fx.size === 'custom' ? '' : 'none';
  }
  const tabs = mountTabs(ov.querySelector('.ui-tabs'));
  function release() {
    disposed = true; loaded = false; img.onerror = null;        // quita el listener global y suelta la imagen decodificada (Esc, fondo y Cerrar pasan por aquí)
    tabs.destroy();
    clearTimeout(prepT);
    img.onload = null; img.removeAttribute('src');
    cv.width = cv.height = 0;
    prep = { key: '', blob: null, p: null };
  }
  const close = () => sheet.close();
  ov.addEventListener('input', ev => {
    const f = ev.target.dataset.f;
    if (f) {
      fx[f] = +ev.target.value;
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
  const shareBtn = ov.querySelector('[data-sharephoto]');
  shareBtn.addEventListener('pointerdown', () => { prepare().catch(() => {}); }, { passive: true });
  shareBtn.addEventListener('click', async ev => {
    const btn = ev.currentTarget, orig = btn.innerHTML;
    const key = JSON.stringify(fx);
    // camino rápido: blob ya listo → share() es lo PRIMERO que corre dentro del gesto
    let blob = prep.key === key ? prep.blob : null;
    let fresh = !!blob;
    try {
      if (!blob) {
        btn.innerHTML = 'Preparando…';
        blob = await prepare();
      }
      const file = new File([blob], outName, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); }
        catch (err) {
          if (err?.name === 'AbortError') return;
          if (!fresh && err?.name === 'NotAllowedError') { notify('Listo — toca «Guardar en Fotos» otra vez'); return; }
          throw err;
        }
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = outName; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
    } catch (err) {
      notify(`No se pudo guardar: ${err?.message || err}`);
    } finally { btn.innerHTML = orig; }
  });
  ov.querySelector('[data-dl]').addEventListener('click', async () => {
    try {
      const blob = await prepare();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = outName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    } catch (err) { notify(`No se pudo exportar: ${err?.message || err}`); }
  });
  ov.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) close();
  });
}
