# AeroBrain — Agent access & testing

For automated agents (Claude Code, Codex) testing the app without auth friction.

## TL;DR — local agent testing uses constrained dev mode

The server binds only `127.0.0.1:8790`. Codex and Claude Code may use full dev
access on that origin without a browser login. The check requires all of these:
loopback client IP, exact `127.0.0.1:8790` or `localhost:8790` Host, no Cloudflare
or forwarded headers, and same-origin/none browser fetch metadata. This prevents
DNS rebinding and cross-site browser requests from being mistaken for an agent.

```bash
# any agent ON the Mac — full read+write, no token, no login:
curl http://localhost:8790/api/whoami                      # -> dev_mode:true, user:daniel
curl http://localhost:8790/api/jobs                        # job list
curl -X POST http://localhost:8790/api/search -d '{"q":"selva verde"}'   # semantic search
curl -X POST http://localhost:8790/api/odm    -d '{"clip_id":"...","preset":"alta"}'    # premium ODM video route
curl -X POST http://localhost:8790/api/splat  -d '{"clip_id":"...","preset":"medium","backend":"metal"}'
curl -X POST http://localhost:8790/api/splat  -d '{"clip_id":"recon_...","preset":"frontier","backend":"cuda","backend_policy":"strict","resolution":"auto"}'
```

The preview browser pointed at `http://127.0.0.1:8790` is also in dev mode. Do not
proxy that URL or replace its Host header; either change disables the exception.

## Testing against the public URL

External requests require auth before HTML, APIs, videos, maps, models, splats,
share pages, or vault data are returned. The only remote path is Daniel's 24-hour
browser session. Header/query master tokens are deliberately rejected. Agents must
use loopback dev mode; do not put Daniel's password in a command or test fixture.

The browser session cookie is `Secure`, so it only works over HTTPS. Local UI
testing uses `http://localhost:8790` (trusted, no cookie needed).

## Why this is safe (not a backdoor)

- `127.0.0.1` loopback is only reachable from the Mac; nothing on the LAN or the
  internet can hit it except through the tunnel (which adds CF headers → gated).
- Local dev mode rejects unexpected Host, proxy, Origin and fetch-metadata values.
- A local process already has full filesystem access to the vault, so trusting
  localhost doesn't widen the attack surface.
- The public surface has no localhost fallback: it is gated only by Daniel's
  session. Header and query-string master tokens are rejected.

## Operator sign-in

- Canonical user: `daniel`; there is no registration or second account.
- The session cookie is `__Host-ab_session`, `Secure`, `HttpOnly`,
  `SameSite=Strict`, and expires absolutely after 24 hours.
- On the first successful login, the legacy SHA-256 verifier is migrated to a
  salted memory-hard scrypt record at `/Volumes/SSD/drone-vault/.operator-auth.json`
  with mode `0600`. Passwords and session tokens are never stored in plaintext.
- See `docs/AUTH_SECURITY.md` for the threat model, rotation procedure, and tests.
- Every public AeroBrain path crosses the versioned Cloudflare Worker in `edge/`.
  It replaces the browser cookie with a 30-second HMAC envelope, strips spoofable
  bridge headers, bypasses shared cache, and preserves Range/Set-Cookie. Test it
  with `node --test edge/test_private_data_worker.mjs`; never narrow the route,
  expose the signing key, or add a `workers.dev`/preview route.

## Restart the server after backend edits

```bash
pipeline/safe_restart.sh server     # alias for web; picks up backend changes
pipeline/safe_restart.sh tunnel     # Cloudflare tunnel only
pipeline/safe_restart.sh worker     # refuses while a 3D/splat job is running
tail -20 /tmp/aerobrain-watchdog.log
python3 pipeline/ops_status.py        # one-shot 24/7 ops audit
python3 pipeline/external_probe.py    # public health + HTML + video Range
```
HTML is no-store. The server replaces each placeholder `?v=` with the asset's
exact `st_mtime_ns`; matching JS/CSS URLs are immutable. Even so, every batch that
edits `web/` must run `python3 pipeline/bump_web_version.py`: it refreshes explicit
asset references and regenerates gzip sidecars. Vendored libraries cache for 24h.

## 3D acceptance checks for agents

Before saying a 3D/splat change works:

```bash
python3 -m py_compile pipeline/*.py ai/*.py
python3 pipeline/test_smoke.py
node --check web/icons.js web/tresd.js web/share.js web/splatview.js web/splatlab.js
python3 pipeline/audit_vault.py
python3 pipeline/audit_splats.py
python3 pipeline/browser_gate.py model <clip_id>
python3 pipeline/browser_gate.py splat <clip_id>
python3 pipeline/browser_matrix.py <clip_id>          # share + 3D workspace, mobile/iPad/desktop
```

For splat history bugs, verify both current and archived URLs:

```bash
curl -I http://127.0.0.1:8790/data/splats/<clip>.ksplat
curl -I http://127.0.0.1:8790/data/splats/history/<clip>-<timestamp>.ksplat
```
