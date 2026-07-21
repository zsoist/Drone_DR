# AeroBrain authentication and security boundary

Status: current production contract. Owner: Daniel. Time zone: `America/Bogota`.

## Boundary

- Public origin: `https://vuelos.metislab.work`. `www.metislab.work` redirects to it.
- Public without a session: `login.html`, `login.js`, `login.css`, `icons.js`,
  `robots.txt`, minimal `/api/healthz`, and `/api/whoami`.
- Protected: every other HTML page, API, Range response, vault asset, model, splat,
  photo, video, map overlay, SuperSplat asset, property page, and share page.
- Remote access accepts Daniel's browser session only. Header/query master tokens
  and token-to-cookie exchange are rejected.
- Supabase is a server-side metadata index. Migrations
  `20260717070204_private_catalog_server_only.sql` and
  `20260717071016_harden_app_owned_database_objects.sql` revoke schema, table,
  sequence, policy, and application-RPC access from `anon`/`authenticated`; only
  the Mac-held secret/service role retains application access. Production
  verification returned `401` for the publishable key and `200` for the secret
  key on the same table route.
- Local agents: loopback-only dev mode for Codex and Claude Code. It requires an
  exact local Host, no forwarding/Cloudflare headers, and safe Origin/fetch metadata.

## Single operator

The only identity is `daniel` (display name `Daniel`). There is no registration,
password reset, alternate account, role, or anonymous share mode.

The password verifier is a salted scrypt record (`N=32768`, `r=8`, `p=3`) stored
at `/Volumes/SSD/drone-vault/.operator-auth.json` with mode `0600`. The first valid
login migrates the previous SHA-256 verifier. A corrupt scrypt record fails closed;
the server does not fall back to SHA-256 around it.

## Sessions

- 256 random bits from the operating-system CSPRNG.
- Only SHA-256 digests of session tokens are stored in SQLite.
- Absolute, non-sliding lifetime: 86,400 seconds.
- Cookie: `__Host-ab_session`; `Secure`; `HttpOnly`; `SameSite=Strict`; `Path=/`;
  no `Domain`; `Max-Age=86400`.
- Login rotates the prior browser session. Logout revokes it server-side and sends
  `Clear-Site-Data` for cache, cookies, and storage.
- `/api/whoami` reports the exact expiry in Colombia time; the server evaluates
  expiry from Unix time, independent of browser clock or time zone.

## Request defenses

- Login throttles by client IP and globally, with `Retry-After` responses.
- At most two scrypt derivations run concurrently, protecting the M4 during ODM or
  Gaussian-splat processing.
- Errors are generic; no username-enumeration response exists.
- Browser mutations require same-origin Fetch Metadata/Origin or the custom CSRF
  header. `same-site` sibling origins are not trusted.
- Protected JSON/HTML are `no-store`. Protected media/3D assets are private and
  revalidate; Cloudflare receives `Cloudflare-CDN-Cache-Control: no-store`.
- `edge/private_data_worker.mjs` runs on `vuelos.metislab.work/*` before cache
  lookup. It removes the browser cookie and any client-supplied bridge headers,
  then forwards the session in a method/path-bound HMAC envelope valid for 30
  seconds. The origin accepts that envelope only with its owner-only shared key.
- The Worker uses `cache: no-store` and forces private/no-store response policy.
  This keeps old CDN objects from bypassing auth and preserves Range streaming.
- CSP, HSTS, no-sniff, no-referrer, frame, resource, robot, and permissions headers
  are applied by the origin server.
- Authentication events store no password, bearer token, session ID, or raw IP.

## Credential rotation

Do not place a plaintext password in a command, shell history, repository, or chat.
Rotate the legacy verifier through an interactive local process, remove
`.operator-auth.json` only while the web server is stopped, then sign in once to
create the new scrypt record. Confirm the replacement file is mode `0600` before
restarting normal access.

The Worker-to-origin key lives at `/Volumes/SSD/drone-vault/.edge-auth-key` with
mode `0600` and in the encrypted Worker secret `AEROBRAIN_EDGE_AUTH_KEY`. Never
place it in Wrangler TOML, Git, shell history, logs, or chat. Rotation is a brief
maintenance operation: upload the exact file bytes without a trailing newline,
wait for Worker-secret propagation, then restart `com.aerobrain.web` so both ends
use the same key. A mismatch fails closed with `401`; a missing Worker binding
fails closed with `503`.

## Verification

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/test_auth_security.py
/Volumes/SSD/_system/venv/bin/python3 -m py_compile \
  pipeline/aerobrain_server.py pipeline/jobs.py pipeline/external_probe.py \
  pipeline/ops_watchdog.py pipeline/ops_status.py
node --check web/login.js web/shell.js web/drone.js web/icons.js
node --test edge/test_private_data_worker.mjs

# Public must not return protected content.
curl -I https://vuelos.metislab.work/
curl -I https://vuelos.metislab.work/data/manifest/flights.json

# Approved local dev mode remains available to agents.
curl http://127.0.0.1:8790/api/whoami

# Supabase: publishable access must be denied; the server secret must still work.
# Load values from the private env without printing either key.
curl -o /dev/null -w '%{http_code}\n' -H "apikey: $SUPABASE_DRONE_PUBLISHABLE_KEY" \
  "$SUPABASE_DRONE_URL/rest/v1/flights?select=*&limit=1"  # 401
curl -o /dev/null -w '%{http_code}\n' -H "apikey: $SUPABASE_DRONE_SECRET_KEY" \
  -H "Authorization: Bearer $SUPABASE_DRONE_SECRET_KEY" \
  "$SUPABASE_DRONE_URL/rest/v1/flights?select=*&limit=1"  # 200
```

## Supabase managed-extension note

This legacy Supabase project installed PostGIS and pgvector in `public`. Their
862 functions and three PostGIS catalog relations are owned by
`supabase_admin`, so a normal project migration cannot rewrite those managed
ACLs. They are not reachable by either client role: `PUBLIC`, `anon`, and
`authenticated` have no `USAGE` on `public`; direct anonymous REST probes return
`401`; managed RPCs are absent from the anonymous schema; and anonymous GraphQL
introspection exposes only its base `node` field.

The Supabase Security Advisor consequently retains extension-origin warnings
(`extension_in_public`, PostGIS catalog RLS/GraphQL, and PostGIS
`st_estimatedextent` ACLs). Application-owned warnings are zero: AeroBrain
functions have fixed `search_path`, retired `rooms` policies are gone, all six
application tables are deny-by-default under RLS, and direct grants are limited
to `service_role`. Moving PostGIS would require a supported backup/recreate or a
Supabase-assisted relocation and is not performed as an in-place auth change.

## Edge cache enforcement

Changing an origin route from public to private does not invalidate objects that
Cloudflare cached under the former policy. AeroBrain therefore does not rely on a
human remembering a one-time purge. The versioned Worker in `edge/` is deployed
with no `workers.dev` or preview hostname and only this route:

```text
vuelos.metislab.work/*
```

Cloudflare currently removes `Cookie` in a later request-transform phase. The
Worker therefore reads Daniel's cookie first, removes it and all spoofable bridge
headers, and sends `X-AeroBrain-Edge-Session`, timestamp, and HMAC signature.
The signature covers timestamp, HTTP method, path, and session token; the origin
accepts at most 30 seconds of clock skew. The Worker also bypasses cache, preserves
Range/`Set-Cookie`, and emits `X-AeroBrain-Edge: private-data-v1`.

Deploy it from the repository with the existing Wrangler OAuth session. The
encrypted secret must already exist:

```bash
node --test edge/test_private_data_worker.mjs
npx wrangler deploy --config edge/wrangler.toml
```

Acceptance requires an anonymous real proxy to return `401 DYNAMIC` with the edge
marker, while a short-lived Daniel session returns `206` with the requested byte.
On 2026-07-17 all 44 published MP4 files passed two anonymous rounds (`88/88`), and
an authenticated Range request passed before its test session was revoked.
The complete public acceptance also returned Daniel from `/api/whoami`, opened
`home.html`, revoked logout server-side, and rejected the same token immediately.
`pipeline/ops_status.py` also tests one real proxy through loopback (must be `206`)
and the exact same URL through the public origin (must be `401`); any public
`206 HIT` makes the current auth-boundary check fail.

`pipeline/external_probe.py` deliberately has no credentials. It verifies the
login redirect, anonymous `whoami`, private manifest, and private media route from
GitHub Actions. The watchdog records the real-media boundary separately and never
restarts the tunnel for a cache leak, because a process restart cannot purge an
edge object.

## Residual risk

This is hardened single-factor authentication, not an absolute security guarantee.
Compromise of Daniel's Mac account, Cloudflare account, browser profile, password,
or server-side Supabase secret can still expose AeroBrain. Passkeys or Cloudflare
Access would add a second factor but also add enrollment and recovery operations
not present today.
