// flightverse/sky.js — cielo vivo procedural (cero assets, cero copyright).
// Domo con gradiente por shader (cenit/horizonte por preset), sol/luna,
// estrellas (solo noche), y 2 capas de nubes de ruido (canvas) a la deriva.
// Presets: dia | atardecer | noche. La niebla y las luces de la escena se
// sincronizan con el preset para que el terreno/splat vivan EN el cielo.
import * as THREE from '/flightverse/three.js?v=82';

const PRESETS = {
  dia: {
    top: 0x2a63b3, mid: 0x8fbcec, horizon: 0xe6f0fa, midPos: 0.4,
    sun: 0xfff4d6, sunPos: [0.45, 0.62, 0.3], sunSize: 340,
    fog: 0xcfe2f2, ambient: 0.85, sunI: 1.25, stars: 0, moon: 0, galaxy: 0,
    clouds: 0.55, cloudTint: 0xffffff,
  },
  atardecer: {
    top: 0x1a2350, mid: 0x8f4a72, horizon: 0xf07a3a, midPos: 0.38,
    sun: 0xffdcb0, sunPos: [0.85, 0.09, 0.25], sunSize: 160,
    fog: 0xc98a68, ambient: 0.6, sunI: 1.0, stars: 0.12, moon: 0, galaxy: 0,
    clouds: 0.5, cloudTint: 0xffc9a0,
  },
  noche: {
    top: 0x050810, mid: 0x0b1526, horizon: 0x1a2839, midPos: 0.32,
    sun: 0x000000, sunPos: [0.8, 0.1, 0.2], sunSize: 340,
    moonPos: [-0.42, 0.6, -0.3],
    // luz REAL de luna: la direccional se mueve a la luna (fría) y el
    // ambiente sube — el orto dejaba de verse (reporte)
    fog: 0x0c1420, ambient: 0.58, sunI: 0.85, sunTint: 0xbdd4ff,
    stars: 1.1, moon: 1, galaxy: 0.5,
    clouds: 0.18, cloudTint: 0x8fa5c2,
  },
};

function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 256, 256);
  // manchas gaussianas superpuestas = cúmulo creíble a distancia
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256, y = 88 + Math.random() * 80;
    const r = 10 + Math.random() * 40;
    const a = 0.08 + Math.random() * 0.14;
    c.save();
    c.translate(x, y); c.scale(1.9, 1);          // cúmulos estirados, no bolas
    const g = c.createRadialGradient(0, 0, 1, 0, 0, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.6, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(-r * 2, -r, r * 4, r * 2);
    c.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createSky(scene, { radius = 2600 } = {}) {
  const uni = {
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uMidPos: { value: 0.4 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunSize: { value: 340 },
    uMoonDir: { value: new THREE.Vector3(-0.5, 0.55, -0.35).normalize() },
    uMoon: { value: 0 },
    uGalaxy: { value: 0 },
    uStars: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: uni,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `varying vec3 vDir;
        uniform vec3 uTop, uMid, uHorizon, uSunColor; uniform vec3 uSunDir, uMoonDir;
        uniform float uStars, uMidPos, uSunSize, uMoon, uGalaxy;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0., 1.);
          // gradiente de 3 paradas (el atardecer deja de ser 'un filtro naranja')
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, uMidPos, h));
          col = mix(col, uTop, smoothstep(uMidPos, 1.0, h));
          float s = max(dot(d, normalize(uSunDir)), 0.);
          // disco de dos tonos (núcleo cálido claro + corona del color del preset)
          float disc = pow(s, uSunSize);
          col += mix(uSunColor, vec3(1.0, 0.97, 0.9), 0.55) * disc * 1.15;
          col += uSunColor * pow(s, 24.0) * 0.28;
          col += uSunColor * pow(s, 5.0) * 0.10 * (1.0 - h);   // resplandor bajo del horizonte
          if (uMoon > 0.01) {
            float m = max(dot(d, uMoonDir), 0.);
            float disc = smoothstep(0.9994, 0.99965, m);
            // 'mares' lunares: manchas oscuras por hash de la dirección
            float mare = 0.78 + 0.22 * hash(floor(d.xz * 400.0) + floor(d.y * 400.0));
            col += vec3(0.92, 0.95, 1.0) * disc * mare * uMoon;
            col += vec3(0.45, 0.55, 0.75) * pow(m, 60.0) * 0.25 * uMoon;   // halo frío
          }
          if (uGalaxy > 0.01 && d.y > 0.02) {
            // vía láctea: banda alrededor de un gran círculo inclinado
            float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.05, -0.93))) / 0.09, 2.0));
            band *= smoothstep(0.12, 0.4, d.y);                 // solo en el cielo alto
            col += vec3(0.10, 0.12, 0.19) * band * uGalaxy;
            vec2 gcell = floor(d.xz / max(d.y, 0.05) * 210.0);
            col += vec3(step(0.9955, hash(gcell)) * band * uGalaxy * 0.6);
          }
          if (uStars > 0.01 && d.y > 0.06) {
            vec2 cell = floor(d.xz / d.y * 90.0);
            float tw = 0.75 + 0.25 * hash(cell + 7.0);
            float st = step(0.9973, hash(cell)) * uStars * tw * smoothstep(0.06, 0.35, d.y);
            col += vec3(st);
          }
          col += (hash(gl_FragCoord.xy) - 0.5) * 0.012;        // dither anti-banding
          gl_FragColor = vec4(col, 1.);
        }`,
    }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // nubes: 2 planos altos con la misma textura a escalas distintas, deriva lenta
  const tex = cloudTexture();
  const clouds = [];
  for (const [y, rep, op, sp] of [[430, 3, 0.5, 4.2], [560, 5, 0.34, 2.6], [700, 8, 0.18, 1.4]]) {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rep, rep);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 1.7, radius * 1.7),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: op,
        depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y;
    m.renderOrder = -9;
    scene.add(m);
    clouds.push({ m, t, sp });
  }

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  // sombras reales del sol/luna ('casi ray tracing'): frustum apretado que
  // SIGUE al dron via update(focus) — nitidez sin gastar mapa en toda la escena
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 50; sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  const hemi = new THREE.HemisphereLight(0x88aadd, 0x33291f, 0.5);   // rebote cielo/suelo
  scene.add(sun, sun.target, ambient, hemi);
  // FLARE del sol: sprite aditivo en la dirección del sol
  const fcv = document.createElement('canvas'); fcv.width = fcv.height = 128;
  const fc = fcv.getContext('2d');
  const fg = fc.createRadialGradient(64, 64, 2, 64, 64, 62);
  fg.addColorStop(0, 'rgba(255,250,235,.95)'); fg.addColorStop(0.25, 'rgba(255,235,190,.45)');
  fg.addColorStop(1, 'rgba(255,220,160,0)');
  fc.fillStyle = fg; fc.fillRect(0, 0, 128, 128);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(fcv), transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending }));
  flare.renderOrder = -8;
  scene.add(flare);
  // CÚMULOS billboard: 6 nubes gordas de sprites que derivan con parallax
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true,
        opacity: 0.5, depthWrite: false }));
      sp.position.set((j - 2) * 26 + Math.sin(i * 3 + j) * 9, Math.sin(j * 2.1) * 8, Math.cos(i + j) * 12);
      sp.scale.set(70, 34, 1);
      g.add(sp);
    }
    g.position.set(Math.sin(i * 1.9) * 700, 170 + (i % 3) * 45, Math.cos(i * 2.4) * 700);
    scene.add(g);
    puffs.push(g);
  }

  let cur = 'dia';
  function setPreset(name) {
    const p = PRESETS[name] || PRESETS.dia;
    cur = name in PRESETS ? name : 'dia';
    uni.uTop.value.set(p.top);
    uni.uMid.value.set(p.mid);
    uni.uHorizon.value.set(p.horizon);
    uni.uMidPos.value = p.midPos;
    uni.uSunColor.value.set(p.sun);
    uni.uSunDir.value.set(...p.sunPos).normalize();
    uni.uSunSize.value = p.sunSize;
    uni.uMoon.value = p.moon;
    if (p.moonPos) uni.uMoonDir.value.set(...p.moonPos).normalize();
    uni.uGalaxy.value = p.galaxy;
    uni.uStars.value = p.stars;
    sun.color.set(p.sunTint || p.sun || 0xffffff); sun.intensity = p.sunI;
    const lp = (p.moon > 0 && p.moonPos) ? p.moonPos : p.sunPos;
    sun.position.set(lp[0] * 600, lp[1] * 600, lp[2] * 600);
    ambient.intensity = p.ambient;
    scene.fog = new THREE.Fog(p.fog, 600, 2200);
    for (const c of clouds) {
      c.m.material.opacity = (c.m.material.userData.base ?? c.m.material.opacity);
      c.m.material.userData.base = c.m.material.userData.base ?? c.m.material.opacity;
      c.m.material.opacity = c.m.material.userData.base * (p.clouds / 0.5);
      c.m.material.color.set(p.cloudTint);
    }
    hemi.color.set(p.top); hemi.groundColor.set(p.fog); hemi.intensity = p.moon > 0 ? 0.22 : 0.45;
    flare.material.color.set(p.sun || 0xffffff);
    flare.material.opacity = p.moon > 0 ? 0 : 1;
    flare.scale.setScalar(p.sunSize < 200 ? 260 : 150);   // sol bajo = flare grande
    for (const pg of puffs) pg.children.forEach(sp => {
      sp.material.opacity = 0.5 * (p.clouds / 0.5);
      sp.material.color.set(p.cloudTint);
    });
    return cur;
  }
  setPreset('dia');

  return {
    get preset() { return cur; },
    setPreset,
    cycle() {
      const ks = Object.keys(PRESETS);
      return setPreset(ks[(ks.indexOf(cur) + 1) % ks.length]);
    },
    update(dt, camPos, focus) {
      dome.position.copy(camPos);                       // el domo sigue a la cámara
      for (const c of clouds) {
        c.t.offset.x += dt * c.sp / 1000;
        c.m.position.x = camPos.x; c.m.position.z = camPos.z;
      }
      flare.position.copy(camPos).addScaledVector(uni.uSunDir.value, 2200);
      for (const pg of puffs) { pg.position.x += dt * 1.7; if (pg.position.x > 900) pg.position.x = -900; }
      if (focus) {                                       // frustum de sombra sigue al dron
        sun.target.position.copy(focus);
        sun.position.copy(focus).addScaledVector(uni.uSunDir.value.clone().normalize(), 420);
        sun.target.updateMatrixWorld();
      }
    },
    lights: { sun, ambient },
  };
}
