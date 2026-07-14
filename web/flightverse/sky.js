// flightverse/sky.js — cielo vivo procedural (cero assets, cero copyright).
// Domo con gradiente por shader (cenit/horizonte por preset), sol/luna,
// estrellas (solo noche), y 2 capas de nubes de ruido (canvas) a la deriva.
// Presets: dia | atardecer | noche. La niebla y las luces de la escena se
// sincronizan con el preset para que el terreno/splat vivan EN el cielo.
import * as THREE from '/flightverse/three.js?v=176';

const PRESETS = {
  dia: {
    top: 0x2456a8, mid: 0x7fb0e8, horizon: 0xdcebf8, midPos: 0.22, topPos: 0.6,
    sun: 0xfff4d6, sunPos: [0.45, 0.62, 0.3], sunSize: 340,
    fog: 0xcfe2f2, ambient: 0.85, sunI: 1.25, stars: 0, moon: 0, galaxy: 0,
    clouds: 0.55, cloudTint: 0xffffff, scatter: 0.08,
  },
  atardecer: {
    top: 0x2a3160, mid: 0x8f4e6a, horizon: 0xe8642e, midPos: 0.10, topPos: 0.46,
    sun: 0xffc985, sunPos: [0.85, 0.09, 0.25], sunSize: 190, 
    fog: 0xc08066, ambient: 0.6, sunI: 1.0, stars: 0.14, moon: 0, galaxy: 0,
    clouds: 0.5, cloudTint: 0xff9a6a, scatter: 0.45,
  },
  noche: {
    top: 0x050810, mid: 0x0b1526, horizon: 0x1a2839, midPos: 0.32, topPos: 0.9,
    sun: 0x000000, sunPos: [0.8, 0.1, 0.2], sunSize: 340,
    moonPos: [-0.92, 0.16, -0.33],
    // luz REAL de luna: la direccional se mueve a la luna (fría) y el
    // ambiente sube — el orto dejaba de verse (reporte)
    fog: 0x0c1420, ambient: 0.58, sunI: 0.85, sunTint: 0xbdd4ff,
    stars: 1.1, moon: 1, galaxy: 0.5,
    clouds: 0.18, cloudTint: 0x8fa5c2,
  },
};

function cloudTexture() {
  // fbm de value-noise TILEABLE (lattice con wrap): cielos rotos con bordes de
  // cúmulo real, sin la repetición obvia de las manchas gaussianas
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d');
  const img = c.createImageData(N, N);
  const rnd = (x, y, o) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + o * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const sm = t => t * t * (3 - 2 * t);
  const vn = (u, v, freq, o) => {
    const x = u * freq, y = v * freq;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const w = (a, b) => rnd(((a % freq) + freq) % freq, ((b % freq) + freq) % freq, o);
    return (w(xi, yi) * (1 - xf) + w(xi + 1, yi) * xf) * (1 - yf)
         + (w(xi, yi + 1) * (1 - xf) + w(xi + 1, yi + 1) * xf) * yf;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const n = vn(u, v, 4, 1) * 0.5 + vn(u, v, 8, 2) * 0.25
            + vn(u, v, 16, 3) * 0.15 + vn(u, v, 32, 4) * 0.10;
    const a = Math.pow(Math.max(0, (n - 0.47) / 0.53), 1.3);
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.min(255, a * 700);
  }
  c.putImageData(img, 0, 0);
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
    uTopPos: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunSize: { value: 340 },
    uMoonDir: { value: new THREE.Vector3(-0.5, 0.55, -0.35).normalize() },
    uMoon: { value: 0 },
    uGalaxy: { value: 0 },
    uStars: { value: 0 },
    uScatter: { value: 0 },
    uFogC: { value: new THREE.Color() },
    uTime: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: uni,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `varying vec3 vDir;
        uniform vec3 uTop, uMid, uHorizon, uSunColor, uFogC; uniform vec3 uSunDir, uMoonDir;
        uniform float uStars, uMidPos, uSunSize, uMoon, uGalaxy, uScatter, uTime, uTopPos;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x),
                     mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0., 1.);
          // gradiente de 3 paradas (el atardecer deja de ser 'un filtro naranja')
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, uMidPos, h));
          col = mix(col, uTop, smoothstep(uMidPos, uTopPos, h));
          float hb = clamp(-d.y, 0., 1.);
          col = mix(col, uFogC * 0.82, smoothstep(0.015, 0.3, hb));
          if (uScatter > 0.01) {
            // dispersión Mie de juguete: banda cálida alrededor del azimut del sol,
            // fuerte cerca del horizonte — el atardecer deja de ser un color plano
            vec3 sh = normalize(vec3(uSunDir.x, 0.001, uSunDir.z));
            float az = max(dot(normalize(vec3(d.x, 0.001, d.z)), sh), 0.);
            float low = 1.0 - smoothstep(0.0, 0.22, h);
            col += uSunColor * pow(az, 6.0) * low * uScatter * 0.22;
            col += vec3(1.0, 0.35, 0.15) * pow(az, 14.0) * low * uScatter * 0.18;
            col = mix(col, col * vec3(0.92, 0.84, 1.06), (1.0 - az) * uScatter * 0.25);
          }
          float s = max(dot(d, normalize(uSunDir)), 0.);
          // disco de dos tonos (núcleo cálido claro + corona del color del preset)
          float disc = pow(s, uSunSize);
          col += mix(uSunColor, vec3(1.0, 0.97, 0.9), 0.55) * disc * 1.15;
          col += uSunColor * pow(s, 24.0) * 0.28;
          col += uSunColor * pow(s, 5.0) * 0.10 * (1.0 - h);   // resplandor bajo del horizonte
          if (uMoon > 0.01) {
            // disco lunar REAL: UV local sobre el plano perpendicular a la luna,
            // mares por value-noise (estables) + limb darkening. mix() en vez de
            // suma: objeto opaco bajo el umbral del bloom — se acabó el blob.
            vec3 mr = normalize(cross(vec3(0.,1.,0.), uMoonDir));
            vec3 mu = cross(uMoonDir, mr);
            vec2 muv = vec2(dot(d, mr), dot(d, mu)) / 0.026;
            float r2 = dot(muv, muv);
            if (r2 < 1.0 && dot(d, uMoonDir) > 0.5) {
              float limb = sqrt(max(1.0 - r2, 0.));
              vec2 mp = muv * 2.4 + 13.0;
              float mare = vnoise(mp) * 0.55 + vnoise(mp * 2.6 + 4.0) * 0.45;
              float surf = 0.68 + 0.32 * smoothstep(0.3, 0.72, mare);
              vec3 mcol = vec3(0.87, 0.89, 0.93) * surf * (0.42 + 0.58 * limb);
              col = mix(col, mcol * uMoon, smoothstep(1.0, 0.9, r2));
            }
            float m = max(dot(d, uMoonDir), 0.);
            col += vec3(0.36, 0.46, 0.66) * pow(m, 220.0) * 0.30 * uMoon;  // halo apretado
            col += vec3(0.16, 0.22, 0.36) * pow(m, 28.0) * 0.08 * uMoon;   // bruma fría
          }
          if (uGalaxy > 0.01 && d.y > 0.02) {
            // vía láctea: banda alrededor de un gran círculo inclinado
            float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.05, -0.93))) / 0.09, 2.0));
            band *= smoothstep(0.12, 0.4, d.y);                 // solo en el cielo alto
            col += vec3(0.10, 0.12, 0.19) * band * uGalaxy;
            vec2 gcell = floor(d.xz / max(d.y, 0.05) * 210.0);
            col += vec3(step(0.9955, hash(gcell)) * band * uGalaxy * 0.6);
          }
          if (uStars > 0.01 && d.y > 0.01) {
            // mapeo azimut/elevación (no se estiran en el horizonte) — cada celda
            // tiene una estrella redonda con magnitud, tinte y twinkle propios
            vec2 sc = vec2(atan(d.x, d.z) * 42.0, d.y * 150.0);
            for (int L = 0; L < 2; L++) {
              vec2 g = sc * (L == 0 ? 1.0 : 2.3) + float(L) * 17.0;
              vec2 cell = floor(g), fp = fract(g);
              if (hash(cell) > (L == 0 ? 0.75 : 0.88)) {
                vec2 spos = vec2(hash(cell + 1.3), hash(cell + 2.7)) * 0.8 + 0.1;
                float mag = pow(hash(cell + 4.1), 3.0);
                float tw = 0.72 + 0.28 * sin(uTime * (1.0 + hash(cell + 9.0) * 2.5) + hash(cell) * 40.0);
                float st = smoothstep(0.10 + mag * 0.16, 0.0, length(fp - spos));
                vec3 tint = mix(vec3(1.0, 0.93, 0.82), vec3(0.80, 0.90, 1.0), hash(cell + 5.0));
                col += tint * st * (L == 0 ? 0.28 + mag * 0.9 : 0.14 + mag * 0.35)
                     * tw * uStars * smoothstep(0.01, 0.18, d.y);
              }
            }
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
  for (const [y, rep, op, sp] of [[430, 3, 0.62, 4.2], [560, 5, 0.44, 2.6], [700, 8, 0.26, 1.4]]) {
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
        opacity: 0.42 + 0.18 * Math.abs(Math.sin(i * 5 + j * 1.7)), depthWrite: false }));
      const py = Math.max(-3, Math.sin(j * 2.1) * 8);        // base plana: cúmulo real
      sp.position.set((j - 2) * 26 + Math.sin(i * 3 + j) * 9, py, Math.cos(i + j) * 12);
      sp.scale.set(58 + Math.sin(i * 7 + j * 3) * 18, 26 + Math.cos(i + j * 2) * 8, 1);
      sp.userData.shade = 0.88 + 0.12 * Math.min(1, (py + 3) / 11);  // panza en sombra sutil
      g.add(sp);
    }
    g.position.set(Math.sin(i * 1.9) * 700, 300 + (i % 3) * 60, Math.cos(i * 2.4) * 700);
    scene.add(g);
    puffs.push(g);
  }

  window.__skyUni = uni;                    // debug: inspección CDP de uniforms
  let cur = 'dia';
  function setPreset(name) {
    const p = PRESETS[name] || PRESETS.dia;
    cur = name in PRESETS ? name : 'dia';
    uni.uTop.value.set(p.top);
    uni.uMid.value.set(p.mid);
    uni.uHorizon.value.set(p.horizon);
    uni.uMidPos.value = p.midPos;
    uni.uTopPos.value = p.topPos ?? 1.0;
    uni.uSunColor.value.set(p.sun);
    uni.uSunDir.value.set(...p.sunPos).normalize();
    uni.uSunSize.value = p.sunSize;
    uni.uMoon.value = p.moon;
    if (p.moonPos) uni.uMoonDir.value.set(...p.moonPos).normalize();
    uni.uGalaxy.value = p.galaxy;
    uni.uStars.value = p.stars;
    uni.uScatter.value = p.scatter || 0;
    uni.uFogC.value.set(p.fog);
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
      sp.material.opacity = (sp.userData.baseOp ?? (sp.userData.baseOp = sp.material.opacity)) * (p.clouds / 0.5);
      sp.material.color.set(p.cloudTint).multiplyScalar(sp.userData.shade ?? 1);
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
      uni.uTime.value += dt;
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
