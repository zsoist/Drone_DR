# AeroBrain World Mobile v313 production canary

| Field | Value |
|-------|-------|
| **Date** | 2026-07-27 |
| **Candidate** | `0b0d798582a9bbb5d44367d3cfeb9c5f08d6f0d8` |
| **Branch** | `codex/scene-ops-stability` |
| **Production** | `https://vuelos.metislab.work` |
| **Deploy command** | `pipeline/safe_restart.sh server` |
| **Bypass** | none |
| **Web build** | v313 |
| **Status** | HEALTHY |

## Release gates

- Python compilation: PASS.
- Focused Node mobile/touch/aiming/collision suite: 51/51 PASS.
- Full smoke suite: PASS.
- World audit: 9/9 active worlds.
- World runtime sweep: 9/9 at 60 fps, disk audit clean.
- Invasion runtime: 60 fps, preload 6/6, caps respected, no fallbacks,
  spawn failures, or console errors.
- Collision stress `recon_b2fbe03239 --stress 100`: 100/100 at 60 fps,
  20 shots, 20 explosions, four reloads, no failures or console errors.
- Default Flightverse matrix: Mundo nine islands and Volar 60 fps across
  phone portrait/landscape, iPad portrait/landscape, and desktop. All four
  mobile profiles used real CDP touch.
- `git diff --check origin/main...HEAD`: PASS.

## Fail-closed deployment

The restart completed with exit 0 and emitted, in order:

1. `world runtime sweep preflight: todos los mapas activos verdes`
2. `world gate preflight: recon_b2fbe03239 · 100/100 verde`
3. `web reiniciado`
4. `world deployment preflight conservó los mapas activos verdes`

No `AEROBRAIN_SKIP_WORLD_GATE` or other bypass was used.

## Loopback and public boundary

- Loopback `/api/healthz`: 200, `ok:true`; web, vault, disk, manifests, and
  jobs checks true; zero active jobs.
- Loopback `/api/whoami`: 200, operator `daniel`, `dev_mode:true`.
- Public `/api/healthz`: 200, `X-AeroBrain-Edge: private-data-v1`,
  `Cache-Control: private, no-cache, must-revalidate`, CDN no-store.
- Public `/mundo.html` without a session: exact 303 to
  `/login.html?next=%2Fmundo.html`.
- Public `/api/whoami` without a session: 401 with `{"ok":false}` and the
  private/no-store edge policy.

## Authenticated production browser canary

A short-lived session was created in the authoritative session store and
injected into fresh Chrome profiles through CDP.

- Authenticated public `/manifest.json`: 200,
  `X-AeroBrain-Edge: private-data-v1`, private/no-cache.
- `mundo/mobile_portrait`: nine islands.
- `volar/mobile_portrait`: 60 fps, real-touch command HUD PASS.
- `mundo/desktop`: nine islands.
- `volar/desktop`: 60 fps, mouse Fire gate PASS.
- No product console errors were reported.
- The session was deleted in `finally`; `jobs.session_valid(session_id)` then
  returned false.

## Version and gzip integrity

- 225 explicit `?v=313` references.
- Zero stale `?v=300` through `?v=312` references.
- 92 gzip sidecars.
- Seven static-gzip tests passed, including complete pairing, decompressed
  byte identity, freshness, and credentialed manifest-link coverage.
- Candidate web tree: `13e2a5208b4390ab305647d582999e4f49b80325`.

## Verdict

DEPLOY IS HEALTHY. The v313 authenticated manifest fix is live, mobile real
touch and desktop remain at 60 fps, the unauthenticated boundary remains
closed, and no cache, gzip, console, or runtime regression was observed.
