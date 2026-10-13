import { fmt } from './ui/format.js?v=429';
import { term } from './ui/terms.js?v=429';
import { Suggested } from './ui/suggested.js?v=429';
import { mapSkinOptions, skinMap } from './ui/map-skin.js?v=429';
import { sceneTitle, sceneSources, sceneInsight, sceneCover, areaNav, createSheet, sceneInfo, registerScenes, skeletonCards, wireOrbitPreview, reducedMotion, suggestionBlock } from './scene-improve-ui.js?v=429';
import { coverageRows } from './scene-improve-state.js?v=429';
// mundo.js — FLIGHTVERSE /mundo: WORLD SELECT estilo videojuego (Mario Kart
// world map). Islas dinámicas en carrusel snap, selección → panel de misión
// (Libre/Gate Rush/Cinemático = deep-links reales a /volar), récords locales,
// transición de carga de consola. 60fps: solo transform/opacity.
const fechaDe = cid => { const m = /(\d{4})(\d{2})(\d{2})/.exec(cid||''); return m ? fmt.date(`${m[1]}-${m[2]}-${m[3]}`) : ''; };
const dur = fmt.duration;
const cardDescription = insight => {
  if (!insight?.caption_short) return insight?.error ? 'Descripción no disponible.' : '';
  return esc(insight.caption_short);
};
// Keep measured ranges together in saved scene names.
const nbh = t => String(t).replace(/(\d)-(?=\d)/g, '$1\u2011');
const MISSIONS = {
  libre: { label: 'Vuelo libre', extra: '' },
  gaterush: { label: term('gateRush'), extra: '&reto=1' },
  cine: { label: 'Cinemático', extra: '&modo=cinematico' },
};
const best = cid => { try { const t = parseFloat(localStorage.getItem(`ab.fv.best.${cid}.gaterush`)); return Number.isFinite(t) ? t : null; } catch { return null; } };
// poster ligero (ortho_thumb.webp) con capa de respaldo al ortho.webp: si la miniatura da 404
// la capa falla en silencio y se ve la siguiente
// una sola capa: con dos (thumb + ortho de respaldo) el navegador descarga AMBAS
// imágenes siempre. tresd_publish genera ortho_thumb.webp en cada publicación.
const bgLayers = (p, q) => (p ? `url(${q}${p}${q})` : 'none');
// Mientras la miniatura no está lista (o no existe) la tarjeta muestra el placeholder neutro
// (.wi-poster::before: degradado + inicial de la isla); al cargar, .has-img lo oculta.
const hydratePreview = card => {
  const poster = card?.querySelector('.wi-poster');
  if (!poster || poster.dataset.previewLoaded === 'true') return false;
  const url = poster.dataset.preview || '';
  poster.dataset.previewLoaded = 'true';
  if (url) {
    poster.style.backgroundImage = bgLayers(url, '"');   // síncrono; el placeholder (::before) la cubre hasta que carga
    const probe = new Image();
    probe.onload = () => poster.classList.add('has-img');
    probe.onerror = () => { poster.style.backgroundImage = 'none'; };   // 404: queda el placeholder
    probe.src = url;
  }
  return true;
};

const SV = (d, s=13) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  plane: SV('<path d="M2.5 10.5L17 3l-4.5 14-3-6z"/>', 16),
  flag: SV('<path d="M5 17V4c3-1.8 6 1.8 9 0v8c-3 1.8-6-1.8-9 0"/>'),
  cam: SV('<rect x="2.5" y="5.5" width="11" height="9" rx="2"/><path d="M13.5 9l4-2.5v7l-4-2.5z"/>'),
  trophy: SV('<path d="M6 3.5h8v4a4 4 0 01-8 0zM6 5H3.5a2.5 2.5 0 002.5 3M14 5h2.5A2.5 2.5 0 0114 8M10 11.5V15M7 16.5h6"/>', 11),
};
const main = renderShell('mundo.html');
main.classList.add('ab-page');
const descriptions = new Map();
let cfg = { cielo: 'dia', calidad: 'auto', modo: 'asistido', cobertura: 'auto', forma: 'circle', mision: 'libre' };
try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem('ab.fv.launchcfg') || '{}') } } catch {}
cfg.cobertura = ['auto','100','200','400','600','1000'].includes(String(cfg.cobertura)) ? String(cfg.cobertura) : 'auto';
cfg.forma = cfg.forma === 'square' ? 'square' : 'circle';
if (!MISSIONS[cfg.mision]) cfg.mision = 'libre';
const effectiveCoverageChoice = scene => {
  if (cfg.cobertura === 'auto') return 'auto';
  const rows = scene?.coverage?.shapes?.[cfg.forma] || [];
  return rows.some(row => row.ready && String(row.diameter_m) === cfg.cobertura)
    ? cfg.cobertura
    : 'auto';
};
const cfgExtra = (scene=sel) =>
  (cfg.cielo !== 'dia' ? `&cielo=${cfg.cielo}` : '')
  + (cfg.calidad !== 'auto' ? `&calidad=${cfg.calidad}` : '')
  + (cfg.modo !== 'asistido' ? `&modo=${cfg.modo}` : '')
  + (effectiveCoverageChoice(scene) !== 'auto'
    ? `&diametro=${effectiveCoverageChoice(scene)}`
    : '')
  + (cfg.forma !== 'circle' ? `&forma=${cfg.forma}` : '');
let filtro = 'todas';
let scenes = [], sel = null, settingsSheet = null;
let mapLibrePromise = null;

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;
  mapLibrePromise = Promise.all([
    new Promise((resolve, reject) => {
      const existing = document.getElementById('fv-maplibre-css');
      if (existing) { resolve(); return; }
      const link = document.createElement('link');
      link.id = 'fv-maplibre-css';
      link.rel = 'stylesheet';
      link.href = 'vendor/maplibre-gl.css';
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => reject(new Error('MapLibre CSS no cargó')), { once: true });
      document.head.insertBefore(link, document.querySelector('link[href*="shell.css"]'));
    }),
    new Promise((resolve, reject) => {
      const existing = document.getElementById('fv-maplibre-js');
      if (existing) { existing.addEventListener('load', resolve, { once: true }); return; }
      const script = document.createElement('script');
      script.id = 'fv-maplibre-js';
      script.src = 'vendor/maplibre-gl.js';
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error('MapLibre JS no cargó')), { once: true });
      document.head.append(script);
    }),
  ]).then(() => {
    if (!window.maplibregl) throw new Error('MapLibre no quedó disponible');
    return window.maplibregl;
  }).catch(error => {
    mapLibrePromise = null;
    throw error;
  });
  return mapLibrePromise;
}

function isla(sc, i) {
  const c = sc.capabilities||{};
  const rec = best(sc.clip_id);
  return `
  <article class="wi ${c.terrain?'':'off'}" data-i="${i}" style="--d:${i*70}ms"
>
    <a class="wi-open" href="share.html?m=${encodeURIComponent(sc.clip_id)}" aria-label="Explorar ${esc(sceneTitle(sc.displayName || sc.name))}"><div class="wi-poster" data-ini="${esc(([...String(sc.name||'').trim()][0]||'·').toUpperCase())}" data-preview="${esc(sc.cover?.frame_url||'')}" data-transition-key="world-${esc(sc.clip_id)}"></div></a>



    ${rec!=null?`<span class="wi-rec">${I.trophy} ${fmt.number(rec,1)}s</span>`:''}
    <div class="wi-body">
      <div class="wi-heading"><a class="wi-name" href="share.html?m=${encodeURIComponent(sc.clip_id)}">${nbh(esc(sceneTitle(sc.displayName || sc.name)))}</a><button class="ui-button ui-button--quiet" data-world-detail="${i}" aria-label="Detalles de ${esc(sceneTitle(sc.displayName || sc.name))}">${icon('more')}</button></div>
      <div class="wi-meta">${fechaDe(sceneSources(sc)[0])?`<span>${fechaDe(sceneSources(sc)[0])}</span>`:''}${sc.world?.size_m?`<span>${fmt.area(sc.world.size_m[0]*sc.world.size_m[1]/10000)}</span>`:''}</div>
      <p class="wi-description" aria-busy="${!descriptions.has(sc.clip_id)}">${descriptions.has(sc.clip_id)?cardDescription(descriptions.get(sc.clip_id)):'<span class="ui-skeleton ui-skeleton--text" aria-hidden="true"></span>'}</p>
    </div>
  </article>`;
}

function pick(i) {
  sel = scenes[i];
  document.querySelectorAll('.wi').forEach(el => {
    const selected = +el.dataset.i === i;
    el.classList.toggle('sel', selected);

    if (selected) hydratePreview(el);
  });
  const c = sel.capabilities||{}, st = sel.stats||{}, w = sel.world||{};
  const site = sel.site || {}, coverage = coverageRows(sel, cfg.forma);
  const integrated = site.source_status?.integrated || site.effective_sources?.length || 0;
  const readyCoverage = coverage.filter(row => row.ready).map(row => row.diameter_m);
  const rec = best(sel.clip_id);
  const mis = MISSIONS[cfg.mision] || MISSIONS.libre;
  const goUrl = `volar.html?m=${encodeURIComponent(sel.clip_id)}${mis.extra}${cfgExtra()}`;
  const p = document.getElementById('w-panel');
  p.innerHTML = c.terrain ? `
    <div class="wp-in">
      <div>
        <div class="wp-name">${nbh(esc(sceneTitle(sel.displayName || sel.name)))}</div>
        <div class="wp-description"></div><div class="wp-chips">
          ${site.scene_id?`<span class="fv-chip on">sitio estable · ${site.version_count||1} versiones</span>`:''}
          ${site.source_count?`<span class="fv-chip">${integrated}/${site.source_count} videos integrados</span>`:''}
          ${coverage.length?`<span class="fv-chip">cobertura lista ${readyCoverage.length?readyCoverage.join(' / ')+' m':'pendiente'}</span>`:''}
          ${c.splat?`<span class="fv-chip on">splat ${st.splat_cameras||''} cams</span>`:''}
          ${rec!=null?`<span class="fv-chip on">récord ${fmt.number(rec,2)}s</span>`:''}
        </div>
        <div class="wp-data">
          ${w.size_m?`<div><b><span class="ui-figure">${fmt.number(w.size_m[0]*w.size_m[1]/10000,1)}</span> <span class="ui-unit">ha</span></b><span>Superficie</span></div>`:''}
          ${w.elev_max?`<div><b><span class="ui-figure">${fmt.number(w.elev_max-w.elev_min)}</span> <span class="ui-unit">m</span></b><span>Desnivel</span></div>`:''}
          ${st.track_distance_m?`<div><b>${fmt.distance(st.track_distance_m)}</b><span>Recorrido grabado</span></div>`:''}
        </div>
      </div>
      <div class="wp-cfg" id="wp-cfg" hidden>
        <div class="wp-cfg-g ui-segmented" data-k="mision"><span>Tipo de vuelo</span>
          ${Object.entries(MISSIONS).map(([key, mission]) => `<button data-v="${key}">${mission.label}</button>`).join('')}</div>
        <div class="wp-cfg-g ui-segmented" data-k="cielo"><span>Cielo</span>
          <button data-v="dia">Día</button><button data-v="atardecer">Atardecer</button><button data-v="noche">Noche</button></div>
        <div class="wp-cfg-g ui-segmented" data-k="calidad"><span>Calidad</span>
          <button data-v="auto">Auto</button><button data-v="hd">HD</button><button data-v="extra">Extra</button></div>
        <div class="wp-cfg-g ui-segmented" data-k="modo"><span>Modo</span>
          <button data-v="asistido">Normal</button><button data-v="arcade">Arcade</button><button data-v="dios">Dios</button></div>
        ${sel.coverage?.shapes?`<div class="wp-cfg-g ui-segmented coverage" data-k="cobertura"><span>Cobertura</span>
          <button data-v="auto">Auto</button>${coverage.map(row => `<button data-v="${row.diameter_m}" title="${row.ready?`${Math.round(row.area_m2).toLocaleString('es-CO')} m²`:`Cobertura pendiente: disponible ${row.available_diameter_m||'—'} m`}"${row.ready?'':' disabled'}>${row.diameter_m} m${row.ready?'':' · pendiente'}</button>`).join('')}</div>
        <div class="wp-cfg-g ui-segmented" data-k="forma"><span>Forma</span>
          <button data-v="circle">Círculo</button><button data-v="square">Cuadrado</button></div>`:''}
        <button class="ui-button ui-button--primary wp-fly" data-go="${goUrl}">${I.plane} Empezar vuelo</button>
      </div>
      <div class="wp-go"><a class="ui-button ui-button--primary" href="share.html?m=${encodeURIComponent(sel.clip_id)}">Explorar escena</a>
        <div class="scene-actions"><button class="ui-button ui-button--secondary" data-world-info>Detalles</button><button class="ui-button ui-button--secondary" data-world-settings>${I.plane} Volar</button></div>
      </div>
    </div>` : `<div class="wp-in"><div class="wp-name">${nbh(esc(sceneTitle(sel.displayName || sel.name)))}</div>
      <a class="btn" href="tresd.html">Procesar en Estudio 3D</a></div>`;
  p.classList.add('show');
  const insight = descriptions.get(sel.clip_id);
  if(insight?.caption_short) p.querySelector('.wp-description')?.append(suggestionBlock({title:'',text:insight.caption_short,fullText:insight.caption}));
  p.querySelectorAll('.wp-cfg-g').forEach(g => {
    const k = g.dataset.k;
    const selected = k === 'cobertura' ? effectiveCoverageChoice(sel) : cfg[k];
    g.setAttribute('role','group'); g.setAttribute('aria-label',g.querySelector('span').textContent);
    g.querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed',b.dataset.v === selected); });
  });
}

function launch(url, poster) {
  if (reducedMotion()) { location.href = url; return; }
  const ov = document.getElementById('w-launch');
  ov.querySelector('.wl-bg').style.backgroundImage = bgLayers(poster, "'");
  ov.classList.add('go');
  window.__abReloadOnRestore = true;  // shell.js recarga al volver por bfcache (el overlay .go taparía la página)
  setTimeout(() => { location.href = url; }, 520);
}

async function boot() {
  main.innerHTML = `<div class="page fv-page">
    ${areaNav('mundo')}<header class="fv-hero">
      <h1>Mundo</h1>

      <div class="fv-statbar" id="fv-stats"></div>
      <div class="fv-viewseg" role="group" aria-label="Vista">
        <button class="ui-button ui-button--quiet" data-fvv="cards" aria-pressed="true" hidden>Ver galería</button>
        <button class="ui-button ui-button--quiet" data-fvv="map" aria-pressed="false">Ver mapa</button>
      </div>
    </header>
    <div id="w-cards">
      <div class="w-bar">
        <div class="w-filters" id="w-filters" role="group" aria-label="Filtrar islas">
          <button class="on" data-f="todas" aria-pressed="true">Todas</button>
          <button data-f="fotoreal" aria-pressed="false">Fotorrealistas</button>
          <button data-f="record" aria-pressed="false">Con récord</button>
          <button data-f="volables" aria-pressed="false">Para volar</button>
        </div>
        <div class="w-nav">
          <button class="btn icon" id="w-prev" aria-label="Islas anteriores">${icon('chevL')}</button>
          <button class="btn icon" id="w-next" aria-label="Islas siguientes">${icon('chevR')}</button>
        </div>
      </div>
      <div class="w-railwrap">
        <div class="w-rail" id="w-rail" aria-busy="true">${skeletonCards()}</div>
      </div>
      <div class="w-panel" id="w-panel"></div>
    </div>
    <div class="fv-mapwrap" id="fv-mapwrap" hidden>
      <div class="fv-mapbar">
        <span class="spacer"></span>
        <button class="btn sm" id="fv-rutas" aria-pressed="false">Rutas reales</button>
        <button class="btn sm" id="fv-fit">Encuadrar todo</button>
      </div>
      <div class="fv-map" id="fv-map"></div>
    </div>
    <div class="w-launch" id="w-launch"><div class="wl-bg"></div><div class="wl-txt">CARGANDO ESCENA<span class="wl-bar"></span></div></div>
  </div>`;
  let sys;
  try { const response = await fetch('data/manifest/system.json'); if (!response.ok) throw Error(); sys = await response.json(); }
  catch { document.getElementById('w-rail').setAttribute('aria-busy','false');document.getElementById('w-rail').innerHTML = '<div class="ui-empty"><p>No se pudo cargar Mundo.</p><a class="ui-button ui-button--primary" href="mundo.html">Reintentar</a></div>'; return; }
  // Una isla por sitio estable: solo la versión activa entra al Mundo. Los modelos
  // todavía no asociados a un sitio permanecen visibles como escenas independientes.
  const stableSites = (sys.scenes || []).filter(site => site.active_version);
  const versioned = new Set((sys.scenes || []).flatMap(site => (site.versions || []).map(v => v.id)));
  const targets = stableSites.map(site => ({ clip_id: site.active_version, site }));
  const seen = new Set(targets.map(row => row.clip_id));
  for (const model of sys.models || []) {
    if (!model.clip_id || versioned.has(model.clip_id) || seen.has(model.clip_id)) continue;
    targets.push({ clip_id: model.clip_id, site: null }); seen.add(model.clip_id);
  }
  const settled = await Promise.allSettled(targets.map(target =>
    fetch(`data/models/${target.clip_id}/scene.v2.json`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(man => ({ man, target }))));
  scenes = settled.map(s => {
    if (s.status !== 'fulfilled' || !s.value.man) return null;
    const { man, target } = s.value;
    if (target.site) {
      const active = (target.site.versions || []).find(v => v.id === target.site.active_version) || {};
      const evidence = target.site.source_evidence || [];
      const status = Object.fromEntries(['integrated','eligible','duplicate','insufficient_overlap','registration_failed']
        .map(key => [key, evidence.filter(row => row.status === key).length]));
      man.site = { ...(man.site || {}), scene_id: target.site.id, title: target.site.title,
        active_version: target.site.active_version, is_active_version: true,
        version_count: (target.site.versions || []).length,
        source_count: target.site.source_inventory?.videos?.length || 0,
        source_status: status, effective_sources: active.effective_sources || [],
        dropped_sources: active.dropped_sources || [] };
      man.name = target.site.title || man.name;
    }
    const model = (sys.models || []).find(m => m.clip_id === man.clip_id);
    man.reconstruction = model?.reconstruction; man.ai = model?.ai;
    man.name = target.site?.title || model?.title || man.name;
    return man;
  }).filter(Boolean);
  scenes.sort((a,b) => ((b.capabilities?.terrain|0)-(a.capabilities?.terrain|0))
    || ((b.capabilities?.splat|0)-(a.capabilities?.splat|0))
    || String(b.clip_id).localeCompare(String(a.clip_id)));

  await Promise.all(scenes.map(async sc => { sc.cover = await sceneCover(sc); }));
  const titleCounts = new Map();
  scenes.forEach(sc => { const title=sceneTitle(sc.name).replace(/(Bogotá) · Bogotá$/i, '$1'); titleCounts.set(title,(titleCounts.get(title)||0)+1); });
  scenes.forEach(sc => {
    const title=sceneTitle(sc.name).replace(/(Bogotá) · Bogotá$/i, '$1');
    sc.displayName = titleCounts.get(title)>1 ? `${title} · ${fechaDe(sceneSources(sc)[0]) || 'Captura '+(scenes.indexOf(sc)+1)}` : title;
  });
  const usedTitles = new Set();
  scenes.forEach(sc => {
    const title = sc.displayName;
    let n = 2;
    while (usedTitles.has(sc.displayName)) sc.displayName = `${title} · ${n++}`;
    usedTitles.add(sc.displayName);
  });
  registerScenes(scenes, 'Mundo');
  const nFly = scenes.filter(s=>s.capabilities?.terrain).length;
  const nSp = scenes.filter(s=>s.capabilities?.splat).length;
  const secs = scenes.reduce((t,s)=>t+(s.stats?.track_duration_s||0),0);
  document.getElementById('fv-stats').innerHTML =
    `<span><b>${fmt.number(nFly)}</b> lugares para volar</span><span><b>${fmt.number(nSp)}</b> fotorrealistas</span>`+
    (secs?`<span><b>${dur(secs)}</b> de vuelo real</span>`:'');

  const rail = document.getElementById('w-rail');
  if(!scenes.length){
    rail.setAttribute('aria-busy','false');
    rail.innerHTML=targets.length
      ? '<div class="ui-empty"><p>No se pudieron abrir los lugares.</p><a class="ui-button ui-button--primary" href="mundo.html">Reintentar</a></div>'
      : '<div class="ui-empty"><p>Aún no tienes lugares para explorar.</p><a class="ui-button ui-button--primary" href="tresd.html?tab=process">Crear escena</a><p>Empieza con una órbita de tu casa.</p></div>';
    document.querySelector('.w-bar').hidden=true;document.querySelector('.fv-viewseg').hidden=true;return;
  }
  const gallerySuggestion = Suggested({content:document.querySelector('.w-railwrap')});
  gallerySuggestion.classList.add('world-descriptions');
  gallerySuggestion.querySelector('.ui-suggested-label').prepend('Descripciones · ');
  document.querySelector('.w-bar').after(gallerySuggestion);
  let previewObserver = null;
  const observePreviews = () => {
    previewObserver?.disconnect();
    const cards = [...rail.querySelectorAll('.wi')];
    if (!('IntersectionObserver' in window)) {
      cards.slice(0, 2).forEach(hydratePreview);
      return;
    }
    previewObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        hydratePreview(entry.target);
        previewObserver?.unobserve(entry.target);
      });
    }, { rootMargin: '280px', threshold: 0.01 });
    cards.forEach(card => previewObserver.observe(card));
  };
  let railShown = false, stopPreviews = [];

  const applyFiltro = () => {
    stopPreviews.splice(0).forEach(stop=>stop?.());
    const f = filtro;
    const list = scenes.map((sc, i) => ({ sc, i })).filter(({ sc }) =>
      f === 'todas' ? true
      : f === 'fotoreal' ? sc.capabilities?.splat
      : f === 'record' ? best(sc.clip_id) != null
      : sc.capabilities?.terrain);
    rail.classList.toggle('settled', railShown);   // la entrada escalonada solo en el primer montaje
    railShown = true;
    rail.innerHTML = list.length
      ? list.map(({ sc, i }) => isla(sc, i)).join('')
      : '<div class="ui-empty"><p>No hay escenas con este filtro.</p><button class="ui-button ui-button--secondary" data-reset-world>Ver todas</button><p>Prueba con una escena sin récord.</p></div>';
    rail.setAttribute('aria-busy','false');
    observePreviews();
    rail.scrollLeft = 0;
    requestAnimationFrame(() => syncArrows());
    const first = list[0];
    if (first) pick(first.i);
    else { sel = null; const p = document.getElementById('w-panel'); p.replaceChildren(); p.classList.remove('show'); }
    rail.querySelector('[data-reset-world]')?.addEventListener('click',()=>document.querySelector('[data-f="todas"]').click());
    rail.querySelectorAll('.wi').forEach(card=>stopPreviews.push(wireOrbitPreview(card.querySelector('.wi-poster'),scenes[+card.dataset.i]?.assets?.orbit_preview)));
  };
  document.getElementById('w-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    filtro = b.dataset.f;
    document.querySelectorAll('#w-filters button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    applyFiltro();
  });
  const step = () => (rail.querySelector('.wi')?.getBoundingClientRect().width || 320) + 16;
  document.getElementById('w-prev').addEventListener('click', () => rail.scrollBy({ left: -step(), behavior: reducedMotion()?'instant':'smooth' }));
  document.getElementById('w-next').addEventListener('click', () => rail.scrollBy({ left: step(), behavior: reducedMotion()?'instant':'smooth' }));
  const syncArrows = () => {
    const max = rail.scrollWidth - rail.clientWidth - 2;
    document.getElementById('w-prev').disabled = rail.scrollLeft <= 2;
    document.getElementById('w-next').disabled = rail.scrollLeft >= max;
    rail.classList.toggle('at-end', rail.scrollLeft >= max);   // al final del carrusel no se difumina la última tarjeta
    rail.classList.toggle('at-start', rail.scrollLeft <= 2);
  };
  rail.addEventListener('scroll', syncArrows, { passive: true });
  addEventListener('resize', syncArrows);
  applyFiltro();
  syncArrows();
  scenes.forEach(async sc=>{
    let insight=null;
    let failed=false;
    try { insight=await sceneInsight(sc); } catch { failed=true; }
    descriptions.set(sc.clip_id,insight || {error:failed});
    const card=rail.querySelector(`[data-i="${scenes.indexOf(sc)}"] .wi-description`);
    if(card){card.setAttribute('aria-busy','false');card.innerHTML=cardDescription(insight || {error:failed});}

    if(sel===sc){const text=document.querySelector('.wp-description');if(text && insight)text.replaceChildren(suggestionBlock({title:'',text:insight.caption_short,fullText:insight.caption}));}
  });
  rail.addEventListener('click', e => {
    const button = e.target.closest('[data-world-detail]');
    if (!button) {
      const card=e.target.closest('.wi');
      if(card && !e.target.closest('a,button,summary,details') && !getSelection()?.toString()) location.href=card.querySelector('.wi-open').href;
      return;
    }
    pick(+button.dataset.worldDetail);
    if (matchMedia('(min-width:1024px)').matches) return;
    const panel = document.getElementById('w-panel');
    const sheet = createSheet({title:'Detalles del lugar',content:panel,size:'full',className:'scene-sheet',onClose:()=>{document.getElementById('w-cards').append(panel);sheet.destroy();}});
    sheet.open(button);
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-world-info]')) { sceneInfo({model:sel,opener:e.target.closest('button')}); return; }
    if (e.target.closest('[data-world-settings]')) {
      const content=document.getElementById('wp-cfg').cloneNode(true); content.removeAttribute('id'); content.hidden=false;
      settingsSheet=createSheet({title:'Volar en '+sceneTitle(sel.displayName || sel.name),content,size:'full',className:'scene-sheet',onClose:()=>{const sheet=settingsSheet; settingsSheet=null; sheet?.destroy();}}); settingsSheet.open(e.target.closest('button'));return;
    }
    const cb = e.target.closest('.wp-cfg-g button[data-v]');
    if (cb) {
      const g = cb.closest('.wp-cfg-g');
      cfg[g.dataset.k] = cb.dataset.v;
      try { localStorage.setItem('ab.fv.launchcfg', JSON.stringify(cfg)); } catch {}
      pick(scenes.indexOf(sel));
      if(settingsSheet){const content=document.getElementById('wp-cfg').cloneNode(true);content.removeAttribute('id');content.hidden=false;settingsSheet.body.replaceChildren(content); content.querySelector(`[data-k="${g.dataset.k}"] [data-v="${cb.dataset.v}"]`)?.focus();}
      return;
    }
    const b = e.target.closest('[data-go]'); if (!b) return;
    launch(b.dataset.go, sel?.cover?.frame_url || '');
  });
  // ── MAPA v2: capas, huellas de cobertura, rutas reales, popup de misión ──
  let map = null, rutasOn = false, routeRequest = 0;
  const RASTER = (t, attribution) => ({ version:8, sources:{ b:{ type:'raster', tiles:[t], tileSize:256, attribution } },
    layers:[{ id:'b', type:'raster', source:'b' }] });
  const LAYERS = {
    sat: RASTER('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', '© Esri'),
  };
  let mapBounds = null;
  const MLAT = 111320;
  const footprints = { type:'FeatureCollection', features: scenes.flatMap(sc => {
    const c = sc.world?.center_wgs84, s = sc.world?.size_m; if (!c || !s) return [];
    const rx = (s[0] / 2) / (MLAT * Math.cos(c[1] * Math.PI / 180)), ry = (s[1] / 2) / MLAT;
    const ring = [];
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * Math.PI * 2;
      ring.push([c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry]);
    }
    return [{ type:'Feature', properties:{ splat: sc.capabilities?.splat ? 1 : 0 },
              geometry:{ type:'Polygon', coordinates:[ring] } }];
  }) };
  const addOverlays = () => {
    if (map.getSource('fp')) return;
    map.addSource('fp', { type:'geojson', data: footprints });
    map.addLayer({ id:'fp-fill', type:'fill', source:'fp',
      paint:{ 'fill-color':['case',['==',['get','splat'],1],'#45A0E6','#8A97A8'], 'fill-opacity':0.14 } });
    map.addLayer({ id:'fp-line', type:'line', source:'fp',
      paint:{ 'line-color':['case',['==',['get','splat'],1],'#45A0E6','#8A97A8'], 'line-width':1.6, 'line-opacity':0.65 } });
    if (rutasOn) drawRutas();
  };
  async function drawRutas() {
    const request = ++routeRequest;
    const feats = [];
    for (const sc of scenes) {
      if (!sc.assets?.track) continue;
      try {
        const t = await (await fetch(sc.assets.track)).json();
        feats.push({ type:'Feature', properties:{},
          geometry:{ type:'LineString', coordinates: t.points.map(p => [p.lon, p.lat]) } });
      } catch { /* sin ruta */ }
    }
    if (!rutasOn || request !== routeRequest || !map.isStyleLoaded()) return;
    if (!map.getSource('rt')) {
      map.addSource('rt', { type:'geojson', data:{ type:'FeatureCollection', features: feats } });
      map.addLayer({ id:'rt-line', type:'line', source:'rt',
        paint:{ 'line-color':'#45A0E6', 'line-width':2.2, 'line-opacity':0.85 } });
    }
  }
  const missionPopup = sc => {
    const rec = best(sc.clip_id), st = sc.stats || {};
      return `<div class="fv-pop">
      <div class="fv-pop-poster" style="background-image:${esc(bgLayers(sc.cover?.frame_url||'', "'"))}"></div>
      <b>${esc(sceneTitle(sc.displayName || sc.name))}</b>
      ${descriptions.get(sc.clip_id)?.caption_short ? suggestionBlock({title:'',text:descriptions.get(sc.clip_id).caption_short,fullText:descriptions.get(sc.clip_id).caption}).outerHTML : ''}
      <span>${st.gsd_cm_px ? fmt.number(st.gsd_cm_px,1) + ' cm/px · ' : ''}${st.track_duration_s ? dur(st.track_duration_s) + ' vuelo real' : ''}${rec != null ? ' · récord ' + fmt.number(rec,1) + 's' : ''}</span>
      <div class="fv-pop-btns"><a class="ui-button ui-button--primary" href="share.html?m=${encodeURIComponent(sc.clip_id)}">Explorar escena</a>
        ${sc.capabilities?.terrain ? `<button class="ui-button ui-button--secondary" data-map-fly="${scenes.indexOf(sc)}">Volar</button>` : ''}</div>
    </div>`;
  };
  async function showMap() {
    document.getElementById('fv-mapwrap').hidden = false;
    document.getElementById('w-cards').hidden = true;
    if (map) { map.resize(); return; }
    try {
      await loadMapLibre();
    } catch (error) {
      document.getElementById('fv-mapwrap').hidden = true;
      document.getElementById('w-cards').hidden = false;
      throw error;
    }
    mapBounds = new maplibregl.LngLatBounds();
    map = new maplibregl.Map({ ...mapSkinOptions, container: document.getElementById('fv-map'), style: LAYERS.sat,
      center: [-74.06, 4.75], zoom: 11, attributionControl: false });
    skinMap(map);
    map.on('load', addOverlays);
    for (const sc of scenes) {
      const c = sc.world?.center_wgs84; if (!c) continue;
      mapBounds.extend(c);
      const pop = new maplibregl.Popup({ anchor: 'bottom', offset: 20, closeButton: false, maxWidth: '260px' })
        .setHTML(missionPopup(sc));
      const dot = document.createElement('div');
      dot.className = 'fv-pin2' + (sc.capabilities?.splat ? ' splat' : '');
      dot.innerHTML = `<span class="fv-pin-img" style="background-image:${esc(bgLayers(sc.cover?.frame_url||'', "'"))}"></span><span class="fv-pin-lb">${esc(sceneTitle(sc.displayName || sc.name).split(' · ')[0])}</span>`;
      new maplibregl.Marker({ element: dot }).setLngLat(c).setPopup(pop).addTo(map);
      dot.addEventListener('click', () => map.flyTo({ center: c, zoom: 15.5, duration: reducedMotion() ? 0 : 340 }));
    }
    if (!mapBounds.isEmpty()) map.fitBounds(mapBounds, { padding: 70, maxZoom: 14 });
    document.getElementById('fv-rutas').addEventListener('click', e => {
      rutasOn = !rutasOn;
      routeRequest++;
      e.currentTarget.classList.toggle('on', rutasOn); e.currentTarget.setAttribute('aria-pressed', rutasOn);
      if (rutasOn) drawRutas();
      else if (map.getLayer('rt-line')) { map.removeLayer('rt-line'); map.removeSource('rt'); }
    });
    document.getElementById('fv-fit').addEventListener('click', () =>
      map.fitBounds(mapBounds, { padding: 70, maxZoom: 14, duration: reducedMotion()?0:340 }));
    document.getElementById('fv-map').addEventListener('click', e => {
      const fly = e.target.closest('[data-map-fly]');
      if(fly){pick(+fly.dataset.mapFly);document.querySelector('[data-world-settings]').click();return;}
    });
  }
  document.querySelector('.fv-viewseg').addEventListener('click', e => {
    const b = e.target.closest('[data-fvv]'); if (!b) return;
    document.querySelectorAll('.fv-viewseg button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); x.hidden = x === b; });
    if (b.dataset.fvv === 'map') {
      void showMap().catch(error => {
        main.insertAdjacentHTML('beforeend', `<div class="fv-loading">Mapa: ${esc(error.message)}</div>`);
      });
    } else {
      document.getElementById('fv-mapwrap').hidden = true;
      document.getElementById('w-cards').hidden = false;
    }
  });
}
boot().catch(e => main.insertAdjacentHTML('beforeend', `<div class="fv-loading">Error: ${esc(e.message)}</div>`));
