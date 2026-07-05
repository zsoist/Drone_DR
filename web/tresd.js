  import * as THREE from '/vendor/three.module.js';
  import { OrbitControls } from '/vendor/three-addons/controls/OrbitControls.js';
  import { OBJLoader } from '/vendor/three-addons/loaders/OBJLoader.js';
  import { MTLLoader } from '/vendor/three-addons/loaders/MTLLoader.js';
  import { PLYLoader } from '/vendor/three-addons/loaders/PLYLoader.js';

  const main = renderShell('tresd.html');
  main.innerHTML = `
    <div class="page-head"><h1>3D</h1><span class="count">fotogrametría · nube de puntos · splats</span>
      <span class="spacer"></span>
      <select class="ctl" id="proj-sel"></select>
    </div>

    <div class="panel">
      <div class="ph">${icon('map')} Mapa del proyecto
        <span class="spacer" style="flex:1"></span>
        <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-2)">
          Opacidad <input type="range" id="op" min="0" max="100" value="88" style="width:110px"></label>
      </div>
      <div class="pb" style="padding:10px 12px;border-bottom:1px solid var(--line)">
        <div class="toolbar" style="margin:0">
          <span style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-3)">Capas</span>
          <button class="chip on" data-layer="ortho">Ortofoto</button>
          <button class="chip" data-layer="dsm">Elevación</button>
          <button class="chip" data-layer="hills">Relieve</button>
          <button class="chip" data-layer="contours">Curvas</button>
          <span class="spacer"></span>
          <span style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--text-3)">Medir</span>
          <button class="chip" data-tool="dist">Distancia</button>
          <button class="chip" data-tool="area">Área</button>
          <button class="chip" data-tool="volume">Volumen</button>
          <button class="chip" data-tool="profile">Perfil</button>
          <button class="chip" data-tool="compare">Comparar fechas</button>
          <select class="ctl" id="cmp-date" style="display:none;font-size:12px"></select>
          <button class="btn" id="m-clear" style="padding:3px 10px;font-size:11px">Limpiar</button>
        </div>
      </div>
      <div id="omap" style="height:56dvh;min-height:340px"></div>
      <div class="pb" id="m-result" style="display:none;border-top:1px solid var(--line)"></div>
    </div>

    <div class="fl-layout" style="margin-top:16px">
      <div>
        <div class="panel">
          <div class="ph">${icon('cube')} Modelo 3D texturizado
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="load-mesh" style="padding:4px 12px;font-size:11.5px">Cargar</button>
          </div>
          <div id="mesh-box" style="height:46dvh;min-height:300px;display:grid;place-items:center">
            <p class="footer-note" style="margin:0">Mesh con textura real del vuelo — arrastra para orbitar.</p>
          </div>
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="ph">${icon('layers')} Nube de puntos
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="load-cloud" style="padding:4px 12px;font-size:11.5px">Cargar</button>
          </div>
          <div id="cloud-box" style="height:46dvh;min-height:300px;display:grid;place-items:center">
            <p class="footer-note" style="margin:0">~800k puntos con color real, georreferenciados.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="fl-layout" style="margin-top:16px">
      <div>
        <div class="panel">
          <div class="ph">${icon('activity')} Procesar un vuelo en 3D</div>
          <div class="pb">
            <div class="toolbar">
              <select class="ctl" id="new-clip" style="flex:1"></select>
              <button class="btn primary" id="btn-run3d">${icon('cube')} Procesar 3D</button>
            </div>
            <p class="footer-note">Un tap: frames 2K → geotag con tu GPS → fotogrametría ODM →
            assets web. ~1h en el M4, todo local. Mejores resultados: vuelos en órbita o zigzag
            con solape; el nadir alto (como el 0104) mapea de maravilla.</p>
            <div id="jobs3d" style="margin-top:8px"></div>
          </div>
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="ph">${icon('cube')} Gaussian Splats
            <span class="spacer" style="flex:1"></span>
            <button class="btn primary" id="btn-splat" style="padding:4px 12px;font-size:11.5px">Generar splat</button>
          </div>
          <div class="pb" id="splats"></div>
          <div id="splat-viewer" style="height:46dvh;display:none"></div>
        </div>
        <div class="panel" style="margin-top:16px">
          <div class="ph">${icon('gauge')} Reporte de calidad & descargas</div>
          <div class="pb" id="dls"></div>
        </div>
      </div>
    </div>`;

  // ---------- estado ----------
  let sys = {}, models = [], cur = null;
  try { sys = await (await fetch('data/manifest/system.json')).json(); } catch {}
  models = sys.models || [];
  const flights = await getFlights();

  const sel = document.getElementById('proj-sel');
  sel.innerHTML = models.length
    ? models.map(m => {
        const f = flights.find(x => x.clip_id === m.clip_id);
        return `<option value="${m.clip_id}">${f ? (esc(f.label) || fmt.date(f.date) + ' ' + f.time) : m.clip_id}</option>`;
      }).join('')
    : `<option value="">Sin proyectos 3D aún</option>`;
  sel.addEventListener('change', () => setProject(sel.value));

  // clips candidatos a 3D (con GPS y proxy)
  const candidates = flights.filter(f => f.has_srt && f.stats?.bbox && !f.archived);
  document.getElementById('new-clip').innerHTML =
    candidates.map(f => `<option value="${f.clip_id}">${esc(f.label) || fmt.date(f.date) + ' ' + f.time} · ${fmt.dur(f.duration_s)} · ${Math.round(f.stats.max_rel_alt_m || 0)}m</option>`).join('');
  document.getElementById('btn-run3d').addEventListener('click', async () => {
    const r = await api('/api/odm', { clip_id: document.getElementById('new-clip').value });
    if (r.error) alert(r.error);
  });
  pollJobs(document.getElementById('jobs3d'));

  // ---------- ortofoto en MapLibre ----------
  let omap = null;
  function setProject(cid) {
    cur = models.find(m => m.clip_id === cid);
    if (!cur) return;
    const base = `data/models/${cid}`;
    const q = cur.qa || {};
    const reproj = q.reprojection_error_px;
    const grade = reproj == null ? '—' : reproj < 1.5 ? 'excelente' : reproj < 2.5 ? 'buena' : 'aceptable';
    document.getElementById('dls').innerHTML = `
      ${q.cameras_reconstructed != null ? `<table class="kv" style="margin-bottom:12px">
        <tr><td>Cámaras reconstruidas</td><td>${q.cameras_reconstructed} / ${q.cameras_total}</td></tr>
        <tr><td>Error de reproyección</td><td>${reproj} px · <span style="color:${reproj < 1.5 ? 'var(--mint)' : 'var(--amber)'}">${grade}</span></td></tr>
        <tr><td>Resolución (GSD)</td><td>${q.gsd_cm_px ?? '—'} cm/px</td></tr>
        <tr><td>Área cubierta</td><td>${q.area_m2 >= 10000 ? (q.area_m2 / 10000).toFixed(2) + ' ha' : Math.round(q.area_m2) + ' m²'}</td></tr>
        <tr><td>Puntos sparse</td><td>${(q.sparse_points || 0).toLocaleString()}</td></tr>
        <tr><td>Datum</td><td>WGS84 · elipsoidal</td></tr>
      </table>
      <p class="footer-note" style="margin:0 0 12px">Sin GCPs: precisión relativa alta, absoluta ±GPS del dron (~2-5 m). Para grado topográfico certificable, importa puntos de control.</p>` : ''}
      <div class="navrow" style="flex-wrap:wrap">
        <a class="btn" href="${base}/ortho_full.jpg" target="_blank">${icon('map')} Ortofoto 5K</a>
        <a class="btn" href="${base}/${cur.model_obj}" download>${icon('cube')} Modelo .obj</a>
        <a class="btn" href="${base}/cloud.ply" download>${icon('layers')} Nube .ply</a>
      </div>`;
    if (omap) omap.remove();
    const b = new maplibregl.LngLatBounds();
    cur.corners.forEach(c => b.extend(c));
    omap = new maplibregl.Map({
      container: 'omap', style: SAT_STYLE, bounds: b,
      fitBoundsOptions: { padding: 40 }, attributionControl: { compact: true },
    });
    omap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    omap.on('load', () => {
      omap.addSource('ortho', { type: 'image', url: `${base}/ortho.jpg`, coordinates: cur.corners });
      omap.addLayer({ id: 'ortho', type: 'raster', source: 'ortho',
                      paint: { 'raster-opacity': 0.88, 'raster-fade-duration': 0 } });
      if (cur.dsm_corners) {
        omap.addSource('dsm', { type: 'image', url: `${base}/dsm_color.png`, coordinates: cur.dsm_corners });
        omap.addLayer({ id: 'dsm', type: 'raster', source: 'dsm',
                        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75 } });
        omap.addSource('hills', { type: 'image', url: `${base}/hillshade.png`, coordinates: cur.dsm_corners });
        omap.addLayer({ id: 'hills', type: 'raster', source: 'hills',
                        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.6 } });
        omap.addSource('contours', { type: 'geojson', data: `${base}/contours.geojson` });
        // curvas por color de altura (amarillo=alto, ámbar oscuro=bajo) — sin glyphs,
        // así el estilo satelital offline no necesita servidor de fuentes
        omap.addLayer({ id: 'contours', type: 'line', source: 'contours',
                        layout: { visibility: 'none' },
                        paint: { 'line-width': 1.1, 'line-opacity': 0.9,
                                 'line-color': ['interpolate', ['linear'], ['get', 'elev'],
                                   (cur.dsm_min || 0), '#6b4a1f', (cur.dsm_max || 100), '#f2c14e'] } });
      }
      // capa de dibujo para mediciones
      omap.addSource('draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      omap.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw',
                      filter: ['==', '$type', 'Polygon'],
                      paint: { 'fill-color': '#45A0E6', 'fill-opacity': 0.18 } });
      omap.addLayer({ id: 'draw-line', type: 'line', source: 'draw',
                      paint: { 'line-color': '#45A0E6', 'line-width': 2.5, 'line-dasharray': [1.5, 1] } });
      omap.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw',
                      filter: ['==', '$type', 'Point'],
                      paint: { 'circle-radius': 4.5, 'circle-color': '#45A0E6',
                               'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      omap.on('click', onMapClick);
    });
    document.getElementById('op').oninput = e => {
      omap.getLayer('ortho') && omap.setPaintProperty('ortho', 'raster-opacity', +e.target.value / 100);
    };
    resetViewer('mesh-box', 'Mesh con textura real del vuelo — arrastra para orbitar.', 'load-mesh');
    resetViewer('cloud-box', '~800k puntos con color real, georreferenciados.', 'load-cloud');
  }
  // ---------- capas + mediciones ----------
  let tool = null, mpts = [];
  const R = 6371000, rad = Math.PI / 180;
  const hav = (a, b) => 2 * R * Math.asin(Math.sqrt(
    Math.sin((b[1] - a[1]) * rad / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2));
  function areaM2(pts) {                       // shoelace en metros locales
    const lat0 = pts[0][1] * rad;
    const xy = pts.map(p => [p[0] * rad * R * Math.cos(lat0), p[1] * rad * R]);
    let s = 0;
    for (let i = 0; i < xy.length; i++) {
      const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s / 2);
  }
  document.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    const vis = b.classList.contains('on') ? 'visible' : 'none';
    const ids = [b.dataset.layer];
    ids.forEach(id => omap.getLayer(id) && omap.setLayoutProperty(id, 'visibility', vis));
  }));
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tool]').forEach(x => x.classList.remove('on'));
    tool = tool === b.dataset.tool ? null : b.dataset.tool;
    if (tool) b.classList.add('on');
    const cmpSel = document.getElementById('cmp-date');
    if (tool === 'compare') {
      const others = models.filter(m => m.clip_id !== cur.clip_id);
      cmpSel.innerHTML = others.length ? others.map(m => {
        const f = flights.find(x => x.clip_id === m.clip_id);
        return `<option value="${m.clip_id}">vs ${f ? fmt.date(f.date) : m.clip_id}</option>`;
      }).join('') : '<option value="">— procesa otra fecha del mismo sector —</option>';
      cmpSel.style.display = others.length ? '' : 'none';
      if (!others.length) result('Necesitas 2+ fechas procesadas en 3D del mismo sector. Procesa otro vuelo con "Procesar 3D".');
    } else { cmpSel.style.display = 'none'; }
    mpts = []; paintDraw();
    const noSecond = tool === 'compare' && models.filter(m => m.clip_id !== cur.clip_id).length === 0;
    if (!noSecond) result(tool ? ({ dist: 'Toca puntos en el mapa para medir distancia.',
      area: 'Toca los vértices del área.', volume: 'Dibuja el polígono sobre el stockpile/edificio y toca "Calcular".',
      profile: 'Toca 2 puntos: inicio y fin del perfil.',
      compare: 'Dibuja el polígono del área a comparar entre las dos fechas y toca "Comparar".' })[tool] : null);
  }));
  document.getElementById('m-clear').addEventListener('click', () => {
    tool = null; mpts = []; paintDraw(); result(null);
    document.querySelectorAll('[data-tool]').forEach(x => x.classList.remove('on'));
  });
  function paintDraw() {
    if (!omap?.getSource('draw')) return;
    const feats = mpts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p } }));
    if (mpts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: mpts } });
    if (mpts.length > 2 && (tool === 'area' || tool === 'volume'))
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...mpts, mpts[0]]] } });
    omap.getSource('draw').setData({ type: 'FeatureCollection', features: feats });
  }
  function result(html) {
    const el = document.getElementById('m-result');
    el.style.display = html ? 'block' : 'none';
    el.innerHTML = html || '';
  }
  function onMapClick(e) {
    if (!tool) return;
    mpts.push([e.lngLat.lng, e.lngLat.lat]);
    paintDraw();
    if (tool === 'dist' && mpts.length > 1) {
      let d = 0;
      for (let i = 1; i < mpts.length; i++) d += hav(mpts[i - 1], mpts[i]);
      result(`<b class="mono" style="font-size:16px;color:var(--accent)">${d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d.toFixed(1) + ' m'}</b>
        <span class="footer-note" style="margin:0 0 0 10px">distancia · ${mpts.length} puntos</span>`);
    }
    if (tool === 'area' && mpts.length > 2) {
      const a = areaM2(mpts);
      result(`<b class="mono" style="font-size:16px;color:var(--accent)">${a >= 10000 ? (a / 10000).toFixed(2) + ' ha' : Math.round(a).toLocaleString() + ' m²'}</b>
        <span class="footer-note" style="margin:0 0 0 10px">área · ${mpts.length} vértices</span>`);
    }
    if (tool === 'volume' && mpts.length > 2) {
      result(`<button class="btn primary" id="calc-vol">Calcular volumen (${mpts.length} vértices)</button>`);
      document.getElementById('calc-vol').onclick = async () => {
        result('Calculando contra el DSM…');
        const r = await api('/api/measure', { type: 'volume', clip_id: cur.clip_id, points: mpts });
        result(r.error ? `<span style="color:var(--red)">${esc(r.error)}</span>` : `
          <div class="statgrid" style="margin:0">
            <div class="stat"><div class="lb">Volumen (fill)</div><div class="v">${r.volume_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Corte (cut)</div><div class="v">${r.cut_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Área</div><div class="v">${Math.round(r.area_m2).toLocaleString()}<small> m²</small></div></div>
            <div class="stat"><div class="lb">Altura máx</div><div class="v">${r.max_height}<small> m</small></div></div>
          </div><p class="footer-note">Base: ${r.base_elev} m snm (percentil 5 del polígono). Método cut/fill estándar survey.</p>`);
      };
    }
    if (tool === 'compare' && mpts.length > 2) {
      result(`<button class="btn primary" id="calc-cmp">Comparar (${mpts.length} vértices)</button>`);
      document.getElementById('calc-cmp').onclick = async () => {
        const other = document.getElementById('cmp-date').value;
        if (!other) return result('Elige la fecha a comparar.');
        result('Comparando las dos fechas contra el DSM…');
        const r = await api('/api/compare', { clip_a: other, clip_b: cur.clip_id, points: mpts });
        if (r.error) return result(`<span style="color:var(--red)">${esc(r.error)}</span>`);
        const of = flights.find(x => x.clip_id === other);
        const sign = r.net_change_m3 >= 0 ? '+' : '';
        const color = r.net_change_m3 >= 0 ? 'var(--mint)' : 'var(--amber)';
        result(`
          <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Cambio desde ${of ? fmt.date(of.date) : 'fecha A'} → ${fmt.date(cur.dsm_date || (flights.find(x=>x.clip_id===cur.clip_id)||{}).date)}</div>
          <div class="statgrid" style="margin:0">
            <div class="stat"><div class="lb">Cambio neto</div><div class="v" style="color:${color}">${sign}${r.net_change_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Agregado</div><div class="v">${r.added_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Removido</div><div class="v">${r.removed_m3.toLocaleString()}<small> m³</small></div></div>
            <div class="stat"><div class="lb">Cambio medio</div><div class="v">${r.mean_change_m}<small> m</small></div></div>
          </div>
          <p class="footer-note">Positivo = material agregado (construcción/relleno). Subida máx ${r.max_rise_m}m · bajada máx ${r.max_drop_m}m · ${Math.round(r.area_m2).toLocaleString()} m² comparados. Método cut/fill entre DSMs, tipo DroneDeploy.</p>`);
      };
    }
    if (tool === 'profile' && mpts.length === 2) {
      (async () => {
        result('Muestreando el DSM…');
        const r = await api('/api/measure', { type: 'profile', clip_id: cur.clip_id, points: mpts });
        if (r.error) return result(`<span style="color:var(--red)">${esc(r.error)}</span>`);
        const vals = r.profile.filter(v => v != null);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const W = 600, H = 90;
        const pth = r.profile.map((v, i) =>
          v == null ? null : `${(i / (r.profile.length - 1)) * W},${H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 24)}`)
          .filter(Boolean).join(' ');
        result(`<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3)">
            <span>Perfil de elevación · ${r.distance_m} m</span><span class="mono">${lo.toFixed(1)}–${hi.toFixed(1)} m snm · Δ${(hi - lo).toFixed(1)} m</span></div>
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
            <polyline points="${pth} ${W},${H} 0,${H}" fill="#45A0E6" opacity="0.1"/>
            <polyline points="${pth}" fill="none" stroke="#45A0E6" stroke-width="1.6"/></svg>`);
        mpts = [];
      })();
    }
  }

  function resetViewer(boxId, msg, btnId) {
    const box = document.getElementById(boxId);
    box.innerHTML = `<p class="footer-note" style="margin:0">${msg}</p>`;
    document.getElementById(btnId).style.display = '';
  }

  // ---------- three.js viewers ----------
  function makeScene(box) {
    const w = box.clientWidth, h = box.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    box.innerHTML = '';
    box.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0A0C10');
    const cam = new THREE.PerspectiveCamera(55, w / h, 0.1, 5000);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2);
    dl.position.set(1, 2, 1.5);
    scene.add(dl);
    (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam); })();
    return { scene, cam, controls };
  }
  function frameObject(obj, cam, controls) {
    const bb = new THREE.Box3().setFromObject(obj);
    const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()).length();
    obj.position.sub(c);                       // centra en el origen
    cam.position.set(size * 0.45, size * 0.35, size * 0.45);
    cam.near = size / 500; cam.far = size * 6; cam.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
  }
  const spin = box => { box.innerHTML = `<div class="sk" style="width:80%;height:10px;border-radius:5px"></div>`; };

  document.getElementById('load-mesh').addEventListener('click', async e => {
    if (!cur) return;
    e.currentTarget.style.display = 'none';
    const box = document.getElementById('mesh-box');
    spin(box);
    const base = `data/models/${cur.clip_id}/model/`;
    const mtl = await new MTLLoader().setPath(base).loadAsync('odm_textured_model_geo.mtl');
    mtl.preload();
    const obj = await new OBJLoader().setMaterials(mtl).setPath(base).loadAsync('odm_textured_model_geo.obj');
    const { scene, cam, controls } = makeScene(box);
    obj.rotation.x = -Math.PI / 2;             // ODM: Z-up → three.js: Y-up
    scene.add(obj);
    frameObject(obj, cam, controls);
  });

  document.getElementById('load-cloud').addEventListener('click', async e => {
    if (!cur) return;
    e.currentTarget.style.display = 'none';
    const box = document.getElementById('cloud-box');
    spin(box);
    const geo = await new PLYLoader().loadAsync(`data/models/${cur.clip_id}/cloud.ply`);
    const mat = new THREE.PointsMaterial({ size: 0.28, vertexColors: geo.hasAttribute('color') });
    const pts = new THREE.Points(geo, mat);
    const { scene, cam, controls } = makeScene(box);
    pts.rotation.x = -Math.PI / 2;
    scene.add(pts);
    frameObject(pts, cam, controls);
  });

  // splats: listar + ver inline + generar
  const splats = (sys.splats || []).filter(s => /\.(splat|ply|ksplat)$/.test(s.name));
  document.getElementById('splats').innerHTML = splats.length ? splats.map(s => `
    <div class="hl-item"><button class="tc" data-view="${esc(s.name)}">Ver</button>
    <p class="mono">${esc(s.name)} · ${(s.bytes / 1e6).toFixed(0)}MB
      <a href="data/splats/${encodeURIComponent(s.name)}" download style="color:var(--accent)">descargar</a></p></div>`).join('') :
    `<p class="footer-note">Sin splats aún — "Generar splat" entrena OpenSplat sobre las poses
    del proyecto ODM seleccionado (CPU, ~30-60 min). El resultado se ve aquí mismo.</p>`;
  document.getElementById('btn-splat').addEventListener('click', async () => {
    if (!cur) return alert('Procesa primero un vuelo en 3D.');
    const r = await api('/api/splat', { clip_id: cur.clip_id });
    if (r.error) alert(r.error); else alert('Entrenando splat — mira Trabajos (~30-60 min).');
  });
  document.getElementById('splats').addEventListener('click', async e => {
    const name = e.target.dataset.view;
    if (!name) return;
    const box = document.getElementById('splat-viewer');
    box.style.display = 'block';
    box.innerHTML = '<div class="sk" style="height:10px;width:70%;margin:20px auto"></div>';
    const { GaussianSplats3D } = await import('/vendor/gaussian-splats-3d.module.min.js');
    box.innerHTML = '';
    const viewer = new GaussianSplats3D.Viewer({ rootElement: box, sharedMemoryForWorkers: false });
    await viewer.addSplatScene(`data/splats/${name}`, { progressiveLoad: true });
    viewer.start();
  });

  if (models.length) setProject(models[0].clip_id);
