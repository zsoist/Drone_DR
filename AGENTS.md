# AeroBrain — Agent access & testing

For automated agents (Claude Code, Codex) testing the app without auth friction.

## TL;DR — testing on the Mac needs NO auth

The server binds `127.0.0.1:8790` and is only exposed to the internet through the
Cloudflare tunnel, which stamps every external request with `CF-Connecting-IP`.
A request **without** that header and from loopback can only come from a process
on the Mac itself (loopback isn't reachable from the LAN) — so `auth()` trusts it.
Browser cross-site requests to localhost are rejected via `Sec-Fetch-Site`/`Origin`
checks, so a random website cannot silently trigger write actions.

```bash
# any agent ON the Mac — full read+write, no token, no login:
curl http://localhost:8790/api/whoami                      # -> {"ok":true,"local":true}
curl http://localhost:8790/api/jobs                        # job list
curl -X POST http://localhost:8790/api/search -d '{"q":"selva verde"}'   # semantic search
curl -X POST http://localhost:8790/api/odm    -d '{"clip_id":"..."}'     # process 3D
```

The **preview browser pointed at `http://localhost:8790`** is also trusted — pages
skip the login modal automatically (whoami returns ok), so UI flows test cleanly.

## Testing against the PUBLIC url (vuelos.metislab.work)

External requests carry `CF-Connecting-IP`, so they need auth. Two ways:

```bash
# 1) operator token via header (read it from the vault):
TOKEN=$(cat /Volumes/SSD/drone-vault/.token)
curl https://vuelos.metislab.work/api/jobs -H "X-Token: $TOKEN"

# 2) sign in for a 30-day session cookie:
curl -c jar.txt -X POST https://vuelos.metislab.work/api/login \
  -H "Content-Type: application/json" \
  -d '{"user":"reyesusma@hotmail.com","password":"<in .api-keys.env, hashed>"}'
curl -b jar.txt https://vuelos.metislab.work/api/jobs
```

Note: the browser session cookie is `Secure`, so it only works over HTTPS — that's
why local UI testing must use `http://localhost:8790` (trusted, no cookie needed)
rather than trying to log in over http.

## Why this is safe (not a backdoor)

- `127.0.0.1` loopback is only reachable from the Mac; nothing on the LAN or the
  internet can hit it except through the tunnel (which adds CF headers → gated).
- Browser CSRF from a third-party site to localhost is rejected (`cross-site`
  fetch metadata or non-local Origin), while curl/agents and same-origin local UI
  still work with no auth.
- A local process already has full filesystem access to the vault, so trusting
  localhost doesn't widen the attack surface.
- The public surface (the only thing the world can reach) is unchanged: gated by
  token/session, query-string tokens rejected, strict CSP, RLS on Supabase.

## Operator sign-in (manual UI testing)

- User: `reyesusma@hotmail.com` · password stored **only as a SHA-256 hash** in
  `/Volumes/SSD/_system/claude/.api-keys.env` (`AEROBRAIN_PASS_SHA256`) — never in
  this repo. Rotate by re-hashing a new password into that file.

## Restart the server after backend edits

```bash
launchctl kickstart -k gui/501/com.aerobrain.web   # picks up pipeline/*.py changes
```
Static web/ + /data are served no-cache, so frontend edits are live immediately.
