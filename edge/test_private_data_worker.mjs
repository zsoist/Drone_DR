import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const workerUrl = new URL('./private_data_worker.mjs', import.meta.url);
const configUrl = new URL('./wrangler.toml', import.meta.url);
const worker = (await import(workerUrl)).default;

test('the private data edge worker is versioned with the application', () => {
  assert.equal(existsSync(workerUrl), true);
});

test('deployment covers the private AeroBrain host and has no public preview host', () => {
  assert.equal(existsSync(configUrl), true);
  const config = readFileSync(configUrl, 'utf8');
  assert.match(config, /workers_dev\s*=\s*false/);
  assert.match(config, /preview_urls\s*=\s*false/);
  assert.match(config, /pattern\s*=\s*"vuelos\.metislab\.work\/\*"/);
  assert.match(config, /zone_name\s*=\s*"metislab\.work"/);
  assert.doesNotMatch(config, /AEROBRAIN_EDGE_AUTH_KEY\s*=/);
});

test('the worker refuses requests outside the private AeroBrain hostname', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response('unexpected');
  };
  try {
    const response = await worker.fetch(new Request('https://evil.example/home.html'), {
      AEROBRAIN_EDGE_AUTH_KEY: 'edge-test-key',
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the worker signs the browser session for the origin and strips spoofable inputs', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  let upstreamOptions;
  globalThis.fetch = async (request, options) => {
    upstreamRequest = request;
    upstreamOptions = options;
    return new Response('{"ok":true}', {
      status: 200,
      headers: {
        'Age': '9000',
        'Cache-Control': 'public, max-age=86400',
        'Content-Type': 'application/json',
        'Set-Cookie': '__Host-ab_session=rotated; Path=/; Secure; HttpOnly',
      },
    });
  };
  try {
    const request = new Request(
      'https://vuelos.metislab.work/data/proxies/private.mp4',
      { headers: {
        Cookie: '__Host-ab_session=test_session_token_1234567890abcdef',
        Range: 'bytes=0-0',
        'X-AeroBrain-Edge-Session': 'attacker',
        'X-AeroBrain-Edge-Time': '1',
        'X-AeroBrain-Edge-Signature': 'attacker',
      } },
    );
    const response = await worker.fetch(request, {
      AEROBRAIN_EDGE_AUTH_KEY: 'edge-test-key',
    });

    assert.notEqual(upstreamRequest, request);
    assert.equal(upstreamRequest.headers.has('Cookie'), false);
    assert.equal(upstreamRequest.headers.get('Range'), 'bytes=0-0');
    assert.equal(upstreamRequest.headers.get('X-AeroBrain-Edge-Session'),
      'test_session_token_1234567890abcdef');
    const timestamp = upstreamRequest.headers.get('X-AeroBrain-Edge-Time');
    assert.match(timestamp, /^\d{10}$/);
    const message = `${timestamp}\nGET\n/data/proxies/private.mp4\ntest_session_token_1234567890abcdef`;
    assert.equal(upstreamRequest.headers.get('X-AeroBrain-Edge-Signature'),
      createHmac('sha256', 'edge-test-key').update(message).digest('hex'));
    assert.equal(upstreamRequest.redirect, 'manual');
    assert.equal(upstreamOptions.cache, 'no-store');
    assert.equal(upstreamOptions.cf.cacheTtlByStatus['100-599'], -1);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-cache, must-revalidate');
    assert.equal(response.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-AeroBrain-Edge'), 'private-data-v1');
    assert.equal(response.headers.get('Set-Cookie'),
      '__Host-ab_session=rotated; Path=/; Secure; HttpOnly');
    assert.equal(response.headers.has('X-AeroBrain-Debug-Cookie'), false);
    assert.equal(response.headers.has('Age'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the worker fails closed when its signing secret is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response('unexpected');
  };
  try {
    const response = await worker.fetch(new Request('https://vuelos.metislab.work/login.html'), {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('anonymous clients cannot smuggle edge-auth headers to the origin', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async request => {
    upstreamRequest = request;
    return new Response('{"ok":false}', { status: 401 });
  };
  try {
    const request = new Request('https://vuelos.metislab.work/api/whoami', {
      headers: {
        'X-AeroBrain-Edge-Session': 'attacker_session_token_1234567890abcdef',
        'X-AeroBrain-Edge-Time': '1784277000',
        'X-AeroBrain-Edge-Signature': 'a'.repeat(64),
      },
    });
    await worker.fetch(request, { AEROBRAIN_EDGE_AUTH_KEY: 'edge-test-key' });
    assert.equal(upstreamRequest.headers.has('X-AeroBrain-Edge-Session'), false);
    assert.equal(upstreamRequest.headers.has('X-AeroBrain-Edge-Time'), false);
    assert.equal(upstreamRequest.headers.has('X-AeroBrain-Edge-Signature'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
