# AeroBrain authentication and security boundary

Status: current production contract. Owner: Daniel. Time zone: `America/Bogota`.

## Boundary

- Public origin: `https://vuelos.metislab.work`. `www.metislab.work` redirects to it.
- These items are public without a session: `login.html`, `login.js`, `login.css`, `icons.js`,
  `robots.txt`, a minimal `/api/healthz`, and `/api/whoami`.
- The server protects every other item.
  These items are every other HTML page, API, Range response, vault asset, model, splat, photo, video,
  map overlay, SuperSplat asset, property page, and share page.
- Remote access accepts only the browser session of Daniel.
  The server does not accept a master token in a header.
  It does not accept a master token in the query.
  It also does not accept the exchange of a token for a cookie.
- Supabase is a server-side metadata index.
  Two migrations remove access to the schema, tables, sequences, policies, and application RPCs from `anon`/`authenticated`.
  The migrations are `20260717070204_private_catalog_server_only.sql` and
  `20260717071016_harden_app_owned_database_objects.sql`.
  Only the secret/service role that the Mac holds keeps application access.
  A production check of the same route for one table returned `401` for the publishable key and `200` for the secret key.
- Local agents: a loopback-only dev mode exists for Codex and Claude Code.
  It needs an exact local Host.
  It accepts no headers that forward the request and no Cloudflare headers.
  It needs a safe Origin and safe Fetch Metadata.

## Single operator

The only identity is `daniel`. The app shows the name `Daniel`.
The system has no registration, no password reset, no alternate account, no role, and no anonymous share mode.

The password verifier is a salted scrypt record (`N=32768`, `r=8`, `p=3`).
The record is in `/Volumes/SSD/drone-vault/.operator-auth.json` with mode `0600`.
The first valid login migrates the previous SHA-256 verifier.
If the scrypt record is corrupt, the server refuses the login.
The server does not go back to SHA-256 in this case.

## Sessions

- A session token has 256 random bits from the operating-system CSPRNG.
- SQLite stores only SHA-256 digests of session tokens.
- The lifetime is absolute and does not slide: 86,400 seconds.
- The cookie is `__Host-ab_session`.
  It has these attributes: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`,
  no `Domain`, and `Max-Age=86400`.
- A login replaces the previous browser session.
- A logout revokes the session on the server.
  A logout also sends `Clear-Site-Data` for cache, cookies, and storage.
- `/api/whoami` reports the exact expiry in Colombia time.
  The server calculates the expiry from Unix time.
  The result does not depend on the clock or the time zone of the browser.

## Request defenses

- The server limits the rate of logins for each client IP and for all clients together.
  It sends `Retry-After` responses.
- The server runs at most two scrypt derivations at the same time.
  This protects the M4 while ODM or Gaussian-splat jobs run.
- Errors are generic.
  No response lets a user find out if a username exists.
- A browser request that changes data needs the same-origin Fetch Metadata or Origin, or the custom CSRF header.
  The server does not trust other origins on the same `same-site`.
- Protected JSON and HTML are `no-store`.
  Protected media and 3D assets are private and the browser must revalidate them.
  Cloudflare gets `Cloudflare-CDN-Cache-Control: no-store`.
- `edge/private_data_worker.mjs` runs on `vuelos.metislab.work/*` before the cache lookup.
  It removes the browser cookie and all bridge headers that the client supplies.
  Then it sends the session in an HMAC envelope.
  The envelope is for one method and one path.
  The envelope is valid for 30 seconds.
  The origin accepts the envelope only with its shared key, which only the owner can read.
- The Worker uses `cache: no-store` and forces a private, `no-store` response policy.
  Old CDN objects cannot bypass authentication.
  It also keeps the Range responses that stream media.
- The origin server applies these headers: CSP, HSTS, no-sniff, no-referrer, frame, resource, robot, and permissions headers.
- The log of authentication events has no password, bearer token, session ID, or raw IP.

## Credential rotation

> **CAUTION:** Do not put a plaintext password in a command, shell history, repository, or chat. Anyone who reads the password can use it.

To rotate the legacy verifier, do these steps:
<!-- ste:procedural -->

1. Use an interactive local process for the rotation.
2. Stop the web server.
3. Remove `.operator-auth.json`. Do not remove it while the web server runs.
4. Sign in once. This creates the new scrypt record.
5. Make sure the replacement file has mode `0600`.
6. Only then restart normal access.

<!-- ste:descriptive -->
The Worker-to-origin key is in two places.
One place is `/Volumes/SSD/drone-vault/.edge-auth-key` with mode `0600`.
The other place is the secret `AEROBRAIN_EDGE_AUTH_KEY` in the Worker. This secret has encryption.

> **CAUTION:** Do not put the key in Wrangler TOML, Git, shell history, logs, or chat. Anyone who reads the key can forge the Worker envelope.

The rotation of this key is a short maintenance operation.
To rotate the key, do these steps:
<!-- ste:procedural -->

1. Upload the exact file bytes without a newline at the end.
2. Wait for the Worker secret to propagate.
3. Restart `com.aerobrain.web`. Then both ends use the same key.

<!-- ste:descriptive -->
If the two keys do not match, the system fails closed with `401`.
If the Worker does not have the key, the system fails closed with `503`.

## Checks

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

The team installed PostGIS and pgvector in `public` in this legacy Supabase project.
The role `supabase_admin` owns 862 functions of these extensions and three catalog relations of PostGIS.
For this reason, a normal project migration cannot rewrite those managed ACLs.
Neither client role can reach them:

- `PUBLIC`, `anon`, and `authenticated` have no `USAGE` on `public`.
- A direct REST probe without a login returns `401`.
- Managed RPCs are not in the anonymous schema.
- GraphQL introspection without a login shows only its base `node` field.

The Supabase Security Advisor still shows warnings that come from the extensions.
These warnings are `extension_in_public`, PostGIS catalog RLS/GraphQL, and PostGIS
`st_estimatedextent` ACLs.
The application has zero warnings of its own:

- AeroBrain functions have a fixed `search_path`.
- The retired `rooms` policies do not exist.
- All six application tables are deny-by-default under RLS.
- Direct grants go to `service_role` only.

To move PostGIS, the team needs a supported backup and recreate, or a relocation with help from Supabase.
The team does not do this move as an in-place auth change.

## Edge cache enforcement

A change of an origin route from public to private does not invalidate objects that
Cloudflare cached under the former policy.
For this reason, AeroBrain does not depend on a person who remembers a one-time purge.
The team deploys the versioned Worker in `edge/` with no `workers.dev` hostname and no preview hostname.
The Worker has only this route:

```text
vuelos.metislab.work/*
```

Cloudflare now removes `Cookie` in a later request-transform phase.
For this reason, the Worker reads the cookie of Daniel first.
Then it removes the cookie and all spoofable bridge headers.
It sends `X-AeroBrain-Edge-Session`, a timestamp, and an HMAC signature.
The signature covers the timestamp, the HTTP method, the path, and the session token.
The origin accepts at most 30 seconds of clock skew.

The Worker also bypasses the cache and keeps Range and `Set-Cookie`.
It emits `X-AeroBrain-Edge: private-data-v1`.

To deploy the Worker, use the Wrangler OAuth session that already exists.
The encrypted secret must already exist.
Run these commands from the repository:

```bash
node --test edge/test_private_data_worker.mjs
npx wrangler deploy --config edge/wrangler.toml
```

The acceptance test needs an anonymous real proxy to return `401 DYNAMIC` with the edge
marker.
It also needs a short-lived session of Daniel to return `206` with the requested byte.
On 2026-07-17 the team tested all 44 MP4 files that it published.
All of them passed in two anonymous rounds (`88/88`).
An authenticated Range request also passed.
After that, the team revoked the test session.

The public acceptance test also returned Daniel from `/api/whoami` and opened `home.html`.
The logout revoked the session on the server.
The server then rejected the same token immediately.

`pipeline/ops_status.py` also tests one real proxy through loopback.
The result must be `206`.
It tests the exact same URL through the public origin.
The result must be `401`.
Any public `206 HIT` makes the auth-boundary check fail.

`pipeline/external_probe.py` has no credentials on purpose.
It checks the login redirect, anonymous `whoami`, the private manifest, and the private media route from
GitHub Actions.
The watchdog records the real-media boundary separately.
It never restarts the tunnel for a cache leak, because a process restart cannot purge an
edge object.

## Residual risk

AeroBrain uses hardened single-factor authentication. It is not an absolute security guarantee.
A compromise of the Mac account of Daniel, the Cloudflare account, the browser profile, the password,
or the server-side Supabase secret can still expose AeroBrain.
Passkeys or Cloudflare Access add a second factor.
They also add enrollment and recovery operations that do not exist today.
