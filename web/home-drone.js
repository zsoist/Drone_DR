import * as THREE from '/flightverse/three.js?v=218';
import { GLTFLoader } from '/vendor/three-addons180/loaders/GLTFLoader.js?v=218';

export async function mountHomeDrone(selector = '#home-drone-stage') {
  const stage = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!stage || !window.WebGLRenderingContext) return null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .01, 40);
  camera.position.set(0, .22, 3.15);
  const rig = new THREE.Group();
  rig.position.x = -.3;
  scene.add(rig);
  scene.add(new THREE.HemisphereLight(0xa8d8ff, 0x101522, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 4.2); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x23dcb1, 5.5); rim.position.set(-4, 1, -3); scene.add(rim);

  let model;
  try {
    const gltf = await new GLTFLoader().loadAsync('/assets/drone.glb?v=218');
    model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.42 / Math.max(size.x, size.z, .001);
    model.scale.setScalar(scale);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.rotation.y = Math.PI;   // encara la cámara (+Z): el GLB trae el morro en -Z local
  model.rotation.x = .13;       // ligero morro-abajo una vez que apunta a +Z
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.filter(Boolean).forEach(material => { material.envMapIntensity = 1.4; material.needsUpdate = true; });
    });
    rig.add(model);
  } catch {
    renderer.dispose();
    return null;
  }

  stage.prepend(renderer.domElement);
  let targetX = -.12, targetY = -.28, visible = true, raf = 0, last = performance.now();
  const resize = () => {
    const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
  };
  const frame = now => {
    raf = 0;
    if (!visible || document.hidden || !stage.isConnected) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    rig.rotation.x += (targetX - rig.rotation.x) * Math.min(1, dt * 4.5);
    rig.rotation.y += (targetY - rig.rotation.y) * Math.min(1, dt * 4.5);
    rig.position.y = Math.sin(now * .00135) * .055;
    rig.rotation.z = Math.sin(now * .0009) * .025;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const pointerMove = event => {
    if (event.pointerType === 'touch') return;
    const rect = stage.getBoundingClientRect();
    targetY = ((event.clientX - rect.left) / rect.width - .5) * .9;
    targetX = ((event.clientY - rect.top) / rect.height - .5) * .3;
  };
  const pointerLeave = () => { targetX = -.12; targetY = -.28; };
  const onVisibility = () => document.hidden ? stop() : start();
  const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting !== false; visible ? start() : stop(); }, { rootMargin: '100px' });
  const resizeObserver = new ResizeObserver(resize);
  const dispose = () => {
    stop(); intersection.disconnect(); resizeObserver.disconnect();
    stage.removeEventListener('pointermove', pointerMove); stage.removeEventListener('pointerleave', pointerLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    renderer.dispose(); renderer.domElement.remove();
  };
  resize();
  intersection.observe(stage); resizeObserver.observe(stage);
  stage.addEventListener('pointermove', pointerMove); stage.addEventListener('pointerleave', pointerLeave);
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('pagehide', dispose, { once: true });
  renderer.render(scene, camera);
  stage.classList.add('is-3d');
  start();
  return { dispose };
}
