(() => {
  'use strict';

  const form = document.getElementById('login-form');
  const password = document.getElementById('login-password');
  const submit = document.getElementById('login-submit');
  const error = document.getElementById('login-error');
  const reveal = document.querySelector('[data-reveal]');

  const safeNext = value => {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return '/home.html';
    try {
      const target = new URL(value, location.origin);
      if (target.origin !== location.origin || target.pathname === '/login.html') return '/home.html';
      return target.pathname + target.search + target.hash;
    } catch {
      return '/home.html';
    }
  };
  const next = safeNext(new URLSearchParams(location.search).get('next'));

  document.querySelectorAll('[data-icon]').forEach(node => {
    node.innerHTML = icon(node.dataset.icon);
  });
  reveal.innerHTML = icon('eye');

  reveal.addEventListener('click', () => {
    const showing = password.type === 'text';
    password.type = showing ? 'password' : 'text';
    reveal.innerHTML = icon(showing ? 'eye' : 'eyeOff');
    reveal.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
    reveal.title = showing ? 'Mostrar contraseña' : 'Ocultar contraseña';
    password.focus({ preventScroll: true });
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!password.value) {
      error.textContent = 'Ingresa tu contraseña.';
      password.focus();
      return;
    }
    error.textContent = '';
    form.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Verificando';
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-AeroBrain-CSRF': '1',
        },
        body: JSON.stringify({ user: 'daniel', password: password.value }),
      });
      if (response.ok) {
        password.value = '';
        location.replace(next);
        return;
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After') || 60);
        error.textContent = `Demasiados intentos. Intenta de nuevo en ${Math.max(1, Math.ceil(seconds / 60))} min.`;
      } else {
        error.textContent = 'No se pudo iniciar sesión. Revisa la contraseña.';
      }
      password.select();
    } catch {
      error.textContent = 'No se pudo conectar con AeroBrain.';
    } finally {
      form.removeAttribute('aria-busy');
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Entrar';
    }
  });

  addEventListener('pageshow', async event => {
    if (!event.persisted) return;
    try {
      if ((await fetch('/api/whoami', { cache: 'no-store' })).ok) location.replace(next);
    } catch { /* the form remains usable */ }
  });
})();
