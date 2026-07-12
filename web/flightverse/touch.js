// flightverse/touch.js — dual-stick virtual para móvil (pointer events).
// Izquierdo = mover (fwd/strafe), derecho = girar/altura (yaw/lift).
// Deadzone 0.12, radio 56px, nub visual. Solo se monta en pantallas táctiles;
// sample() se mezcla con el teclado en volar (el que tenga señal gana).
export function createTouchSticks(host) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return null;
  const R = 56, DEAD = 0.12;
  const mk = side => {
    const zone = document.createElement('div');
    zone.className = `vl-stick ${side}`;
    zone.innerHTML = '<div class="vl-stick-base"><div class="vl-stick-nub"></div></div>';
    host.appendChild(zone);
    const nub = zone.querySelector('.vl-stick-nub');
    const st = { x: 0, y: 0, id: null };
    const setNub = (dx, dy) => { nub.style.transform = `translate(${dx * R}px, ${dy * R}px)`; };
    zone.addEventListener('pointerdown', e => {
      st.id = e.pointerId; zone.setPointerCapture(e.pointerId);
      st.cx = e.clientX; st.cy = e.clientY;
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== st.id) return;
      let dx = (e.clientX - st.cx) / R, dy = (e.clientY - st.cy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      st.x = Math.abs(dx) < DEAD ? 0 : dx;
      st.y = Math.abs(dy) < DEAD ? 0 : dy;
      setNub(dx, dy);
    });
    const end = e => {
      if (e.pointerId !== st.id) return;
      st.id = null; st.x = 0; st.y = 0; setNub(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    return st;
  };
  const L = mk('left'), Rs = mk('right');
  return {
    sample() {
      return {
        fwd: -L.y, strafe: L.x,
        yaw: -Rs.x, lift: -Rs.y,
        active: L.id != null || Rs.id != null,
      };
    },
  };
}
