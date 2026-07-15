(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeEffects = api;
})(globalThis, function () {
  'use strict';

  function particleBudget(width, reducedMotion) {
    if (reducedMotion) return 0;
    if (width < 680) return 100;
    if (width < 1100) return 160;
    if (width < 1900) return 260;
    return 420;
  }

  function navigationDelay(reducedMotion) {
    return reducedMotion ? 70 : 560;
  }

  function attachVoidNavigation(rootNode, options = {}) {
    if (!rootNode || typeof document === 'undefined') return () => {};
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let canvas = null;
    let raf = 0;
    let timer = 0;
    let busy = false;
    const navigate = options.navigate || (href => { location.href = href; });

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      raf = 0; timer = 0; busy = false;
      canvas?.remove(); canvas = null;
    };

    const play = (x, y, accent) => {
      const count = particleBudget(innerWidth, reduce);
      if (!count) return;
      canvas = document.createElement('canvas');
      canvas.className = 'hv2-void';
      canvas.setAttribute('aria-hidden', 'true');
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
      canvas.style.setProperty('--void-x', `${x}px`); canvas.style.setProperty('--void-y', `${y}px`);
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const stars = Array.from({ length: count }, (_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 12 + Math.pow(Math.random(), .62) * Math.max(innerWidth, innerHeight) * .68;
        return { angle, radius, size: i % 19 === 0 ? 2.7 : .6 + Math.random() * 1.4, spin: (Math.random() - .5) * .9, alpha: .35 + Math.random() * .65 };
      });
      const start = performance.now();
      const color = /^#[0-9a-f]{6}$/i.test(accent.trim()) ? accent.trim() : '#4da3ff';
      const draw = now => {
        const p = Math.min(1, (now - start) / 560);
        const eased = 1 - Math.pow(1 - p, 4);
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        ctx.fillStyle = `rgba(3,6,14,${Math.min(.98, eased * 1.12)})`;
        ctx.fillRect(0, 0, innerWidth, innerHeight);
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 180 + eased * Math.max(innerWidth, innerHeight));
        halo.addColorStop(0, `${color}${p < .62 ? 'cc' : '22'}`); halo.addColorStop(.12, 'rgba(18,28,54,.82)'); halo.addColorStop(1, 'rgba(2,4,10,0)');
        ctx.fillStyle = halo; ctx.fillRect(0, 0, innerWidth, innerHeight);
        for (const star of stars) {
          const distance = star.radius * (1 - eased * .96);
          const angle = star.angle + star.spin * eased;
          const sx = x + Math.cos(angle) * distance;
          const sy = y + Math.sin(angle) * distance;
          ctx.fillStyle = `rgba(207,230,255,${star.alpha * (1 - p * .35)})`;
          ctx.beginPath(); ctx.arc(sx, sy, star.size * (1 + eased * 1.8), 0, Math.PI * 2); ctx.fill();
        }
        if (p < 1 && canvas?.isConnected) raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    };

    const onClick = event => {
      const anchor = event.target.closest('a[href]');
      if (!anchor || !rootNode.contains(anchor) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.href === location.href || busy) return;
      event.preventDefault();
      busy = true;
      const box = anchor.getBoundingClientRect();
      const x = event.clientX || box.left + box.width / 2;
      const y = event.clientY || box.top + box.height / 2;
      const accent = getComputedStyle(anchor).getPropertyValue('--card-accent') || '#4da3ff';
      play(x, y, accent);
      timer = setTimeout(() => navigate(url.href), navigationDelay(reduce));
    };

    rootNode.addEventListener('click', onClick);
    addEventListener('pagehide', stop, { once: true });
    return () => { rootNode.removeEventListener('click', onClick); stop(); };
  }

  return { particleBudget, navigationDelay, attachVoidNavigation };
});
