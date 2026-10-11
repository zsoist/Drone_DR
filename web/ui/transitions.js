/* Classic head script: progressive cross-document motion, no navigation interception.
   Use data-transition-key="clip-ID" (or trip/pin/world-ID) on one static element per page.
   Pair matching keys across documents. Never attach this key to a WebGL canvas.
   data-motion="reduced" is the hook for page-owned previews and camera controllers. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const sync = () => { root.dataset.motion = reduced.matches ? 'reduced' : 'full'; };
  reduced.addEventListener('change', sync); sync();
  const heavy = url => /\/(tresd|mundo|splatlab|scene-improve|volar)\.html$/.test(new URL(url, location.href).pathname);
  function configure(event, activation) {
    const transition = event.viewTransition;
    if (!transition) return;
    const from = activation?.from, entry = activation?.entry;
    const crossfade = reduced.matches || heavy(from?.url || location.href) || heavy(entry?.url || location.href);
    const direction = activation?.navigationType === 'traverse' && entry?.index < from?.index ? 'back' : 'forward';
    transition.types?.add(crossfade ? 'crossfade' : direction);
    const named = [];
    if (!crossfade) {
      const seen = new Set();
      document.querySelectorAll('[data-transition-key]').forEach(el => {
        const key = el.dataset.transitionKey;
        if (!/^(clip|trip|pin|world)-[\w-]+$/.test(key) || seen.has(key) || el.tagName === 'CANVAS') return;
        seen.add(key); el.style.viewTransitionName = key; named.push(el);
      });
    }
    transition.finished.catch(() => {}).finally(() => named.forEach(el => { el.style.viewTransitionName = ''; }));
  }
  addEventListener('pageswap', e => configure(e, e.activation));
  addEventListener('pagereveal', e => configure(e, window.navigation?.activation));
})();
