# AeroBrain World v305 production canary

| Field | Value |
|-------|-------|
| **Date** | 2026-07-26 |
| **Candidate** | `3b17f1943dba9e11b730f6bae9577f29031456a2` |
| **Branch** | `codex/scene-ops-stability` |
| **Production** | `https://vuelos.metislab.work` |
| **Deploy command** | `pipeline/safe_restart.sh server` |
| **Bypass** | none |
| **Status** | HEALTHY |

## Fail-closed deployment

The single restart session `19908` completed with exit 0 and emitted, in order:

1. `world runtime sweep preflight: todos los mapas activos verdes`
2. `world gate preflight: recon_b2fbe03239 · 100/100 verde`
3. `web reiniciado`
4. `world deployment preflight conservó los mapas activos verdes`

The fourth line is reachable only after `wait_for_web_health()` receives a
successful `GET http://127.0.0.1:8790/api/healthz`. No
`AEROBRAIN_SKIP_WORLD_GATE` or break-glass variable was set.

## Loopback canary

- `/api/healthz`: 200, `ok:true`, web/vault/disk/manifests/jobs all true,
  487.2 GB free and zero active jobs.
- `/api/whoami`: 200, operator `daniel`, `dev_mode:true`.
- Fresh post-deploy Flightverse matrix: Mundo loaded nine islands and Volar
  sustained 60 fps on desktop.
- Three consecutive watchdog/local checks at 03:50:56, 03:51:56 and 03:52:02
  COT returned 200/healthy.
- Fresh post-deploy screenshot:
  `/Volumes/SSD/drone-vault/qa/matrix-volar-desktop.png`.

## Public boundary

Two post-deploy `pipeline/external_probe.py` runs completed with exit 0:

| Probe | Check 1 | Check 2 |
|-------|--------:|--------:|
| Health | 326 ms | 245 ms |
| Login | 476 ms | 464 ms |
| Whoami boundary | 251 ms | 227 ms |
| Manifest boundary | 258 ms | 225 ms |
| Media boundary | 233 ms | 229 ms |

Exact fresh HTTP evidence:

- `/api/healthz`: 200, `X-AeroBrain-Edge: private-data-v1`,
  `Cache-Control: private, no-cache, must-revalidate`, CDN no-store.
- `/login.html?next=%2Fmundo.html`: 200 with CSP, HSTS, frame denial and
  private/no-store edge policy.
- `/mundo.html` without a session: 303 to the exact
  `/login.html?next=%2Fmundo.html` boundary.
- `/api/whoami` without a session: 401 with `{"ok": false}` and private/no-store
  edge policy.
- The independent ops audit passed with 23.98 hours, zero reliability failures,
  public auth boundary 401, authenticated bridge 200/operator `daniel`, stream
  Range 206, and all web/worker/tunnel/watchdog services healthy.

## Verdict

DEPLOY IS HEALTHY. No new product console error, page failure, authentication
leak, cache-policy regression or runtime performance regression was observed.
