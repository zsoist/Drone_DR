// flightverse/tour/ghost.js — ghost del vuelo REAL (track GPS 1 Hz interpolado) (WS E).
// Tubo de la ruta + marcador que recorre el track. Estado en ctx.state.ghost.
import { loadTrack } from '/flightverse/scene.js?v=368';

const M_LAT = 111320;

export async function createGhost(ctx) {
  const { THREE, man, W, terrain, scene, state: S } = ctx;
  const $ = ctx.$;
  // ── ghost del vuelo real ──
  let ghost = null;
  const track = await loadTrack(man);
  if (track?.points?.length > 3 && W.center_wgs84) {
    const [clon, clat] = W.center_wgs84;
    const mlon = M_LAT * Math.cos(clat * Math.PI / 180);
    const p0 = track.points[0];
    // frame local: +x=este, +z=sur (lat baja) — misma convención que el terreno
    const g0 = terrain.heightAt((p0.lon - clon) * mlon, (clat - p0.lat) * M_LAT);
    const pts = track.points.map(p => new THREE.Vector3(
      (p.lon - clon) * mlon,
      (g0 ?? 0) + (p.rel_alt || 0),
      (clat - p.lat) * M_LAT,
    ));
    const curve = new THREE.CatmullRomCurve3(pts);
    const line = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(600, pts.length * 3), 0.22, 6, false),
      new THREE.MeshBasicMaterial({ color: 0x52C79A, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0x7dffc9 }));
    const haloCv = document.createElement('canvas'); haloCv.width = haloCv.height = 64;
    const hc = haloCv.getContext('2d');
    const grd = hc.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(125,255,201,.85)'); grd.addColorStop(1, 'rgba(125,255,201,0)');
    hc.fillStyle = grd; hc.fillRect(0, 0, 64, 64);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(haloCv), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(4.5);
    marker.add(halo);
    const grp = new THREE.Group();
    grp.add(line); grp.add(marker); grp.visible = true;
    scene.add(grp);
    // t viene como datetime string ("2026-07-04 16:03:58") en los SRT reales;
    // normalizar a segundos desde el inicio, fallback = índice (muestreo 1Hz)
    const T = track.points.map((p, i) => {
      if (typeof p.t === 'number') return p.t;
      const ms = Date.parse(String(p.t || '').replace(' ', 'T'));
      return Number.isFinite(ms) ? ms / 1000 : i;
    });
    const tBase = T[0] || 0;
    for (let i = 0; i < T.length; i++) T[i] -= tBase;
    const dur = T[T.length - 1] || 1;
    ghost = { grp, marker, pts, T, dur, t: 0, on: true };
    $('#vl-ghost').textContent = `ghost · vuelo real ${Math.round(dur)}s`;
  } else {
    $('#vl-ghost').textContent = 'sin track';
  }
  S.ghost = ghost;

  return {
    /** Tecla G: mostrar/ocultar el ghost. */
    toggle() {
      if (ghost) { ghost.on = !ghost.on; ghost.grp.visible = ghost.on; }
    },
    /** Por paso fijo: avanza el marcador por el track. */
    update(dt) {
      if (ghost?.on) {
        ghost.t = (ghost.t + dt) % ghost.dur;
        const i = ghost.T.findIndex(t => t > ghost.t);
        const a = Math.max(0, i - 1), b = Math.max(0, i);
        const ta = ghost.T[a], tb = ghost.T[b] || ta + 1;
        const f = tb > ta ? (ghost.t - ta) / (tb - ta) : 0;
        ghost.marker.position.lerpVectors(ghost.pts[a], ghost.pts[b] || ghost.pts[a], f);
      }
    },
    /** Por frame: respiración del halo. */
    renderPulse() {
      if (ghost?.on) ghost.marker.children[0].scale.setScalar(4 + Math.sin(S.simT * 3.2) * 0.8);
    },
  };
}
