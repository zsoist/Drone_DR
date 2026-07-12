// flightverse/sky.js — cielo vivo procedural (cero assets, cero copyright).
// Domo con gradiente por shader (cenit/horizonte por preset), sol/luna,
// estrellas (solo noche), y 2 capas de nubes de ruido (canvas) a la deriva.
// Presets: dia | atardecer | noche. La niebla y las luces de la escena se
// sincronizan con el preset para que el terreno/splat vivan EN el cielo.
import * as THREE from '/flightverse/three.js?v=69';

const PRESETS = {
  dia: {
    top: 0x2f6bb8, horizon: 0xbfd7ee, sun: 0xfff4d6, sunPos: [0.45, 0.62, 0.3],
    fog: 0xbfd7ee, ambient: 0.85, sunI: 1.25, stars: 0, clouds: 0.5, cloudTint: 0xffffff,
  },
  atardecer: {
    top: 0x2b2a55, horizon: 0xff9a5c, sun: 0xffc07a, sunPos: [0.8, 0.12, 0.2],
    fog: 0xd98a63, ambient: 0.55, sunI: 1.0, stars: 0.25, clouds: 0.45, cloudTint: 0xffd9b8,
  },
  noche: {
    top: 0x05070d, horizon: 0x14202f, sun: 0xcfe2ff, sunPos: [-0.4, 0.5, -0.3],
    fog: 0x0b1119, ambient: 0.34, sunI: 0.5, stars: 1, clouds: 0.22, cloudTint: 0x92a7c4,
  },
};

function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 256, 256);
  // manchas gaussianas superpuestas = cúmulo creíble a distancia
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 256, y = 96 + Math.random() * 64;
    const r = 14 + Math.random() * 34;
    const g = c.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createSky(scene, { radius = 2600 } = {}) {
  const uni = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
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
        uniform vec3 uTop, uHorizon, uSunColor; uniform vec3 uSunDir; uniform float uStars;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main(){
          float h = clamp(vDir.y, 0., 1.);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.62));
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.);
          col += uSunColor * (pow(s, 340.0) * 1.2 + pow(s, 18.0) * 0.18);   // disco + halo
          if (uStars > 0.01 && vDir.y > 0.06) {
            vec2 cell = floor(vDir.xz / vDir.y * 90.0);
            float st = step(0.9975, hash(cell)) * uStars * smoothstep(0.06, 0.35, vDir.y);
            col += vec3(st);
          }
          gl_FragColor = vec4(col, 1.);
        }`,
    }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // nubes: 2 planos altos con la misma textura a escalas distintas, deriva lenta
  const tex = cloudTexture();
  const clouds = [];
  for (const [y, rep, op, sp] of [[430, 3, 0.5, 4.2], [560, 5, 0.34, 2.6]]) {
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
  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(sun, ambient);

  let cur = 'dia';
  function setPreset(name) {
    const p = PRESETS[name] || PRESETS.dia;
    cur = name in PRESETS ? name : 'dia';
    uni.uTop.value.set(p.top);
    uni.uHorizon.value.set(p.horizon);
    uni.uSunColor.value.set(p.sun);
    uni.uSunDir.value.set(...p.sunPos).normalize();
    uni.uStars.value = p.stars;
    sun.color.set(p.sun); sun.intensity = p.sunI;
    sun.position.set(p.sunPos[0] * 600, p.sunPos[1] * 600, p.sunPos[2] * 600);
    ambient.intensity = p.ambient;
    scene.fog = new THREE.Fog(p.fog, 600, 2200);
    for (const c of clouds) {
      c.m.material.opacity = (c.m.material.userData.base ?? c.m.material.opacity);
      c.m.material.userData.base = c.m.material.userData.base ?? c.m.material.opacity;
      c.m.material.opacity = c.m.material.userData.base * (p.clouds / 0.5);
      c.m.material.color.set(p.cloudTint);
    }
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
    update(dt, camPos) {
      dome.position.copy(camPos);                       // el domo sigue a la cámara
      for (const c of clouds) {
        c.t.offset.x += dt * c.sp / 1000;
        c.m.position.x = camPos.x; c.m.position.z = camPos.z;
      }
    },
    lights: { sun, ambient },
  };
}
