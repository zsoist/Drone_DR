const SESSION_COOKIE = '__Host-ab_session';
const SESSION_HEADER = 'X-AeroBrain-Edge-Session';
const TIME_HEADER = 'X-AeroBrain-Edge-Time';
const SIGNATURE_HEADER = 'X-AeroBrain-Edge-Signature';
const encoder = new TextEncoder();

function sessionFromCookie(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name !== SESSION_COOKIE) continue;
    const value = valueParts.join('=');
    return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : '';
  }
  return '';
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.hostname !== 'vuelos.metislab.work') {
      return new Response('Not found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (!env.AEROBRAIN_EDGE_AUTH_KEY) {
      return new Response('Edge authentication unavailable', {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Cloudflare-CDN-Cache-Control': 'no-store',
        },
      });
    }

    const forwardedHeaders = new Headers(request.headers);
    const session = sessionFromCookie(forwardedHeaders.get('Cookie'));
    forwardedHeaders.delete('Cookie');
    for (const name of [SESSION_HEADER, TIME_HEADER, SIGNATURE_HEADER]) {
      forwardedHeaders.delete(name);
    }
    if (session) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const message = `${timestamp}\n${request.method.toUpperCase()}\n${url.pathname}\n${session}`;
      forwardedHeaders.set(SESSION_HEADER, session);
      forwardedHeaders.set(TIME_HEADER, timestamp);
      forwardedHeaders.set(SIGNATURE_HEADER,
        await sign(env.AEROBRAIN_EDGE_AUTH_KEY, message));
    }
    const upstreamRequest = new Request(request, {
      headers: forwardedHeaders,
      redirect: 'manual',
    });
    const upstream = await fetch(upstreamRequest, {
      cache: 'no-store',
      cf: { cacheTtlByStatus: { '100-599': -1 } },
    });
    const headers = new Headers(upstream.headers);
    headers.delete('Age');
    headers.set('Cache-Control', 'private, no-cache, must-revalidate');
    headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
    headers.set('X-AeroBrain-Edge', 'private-data-v1');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
