# CANARY REPORT — Native world coverage fallback v332

| Field | Value |
| --- | --- |
| Production | `https://vuelos.metislab.work` |
| Candidate | `bcbc3d46a44e8542bedf08ccc539d01937274271` |
| Branch | `codex/scene-ops-stability` |
| Web build | v332 |
| Web tree | `b0facf2a4b1b28eb862b81f41c2f58a30599d330` |
| Alerts | 0 |
| Status | HEALTHY |

## Root cause

Mundo persisted `cobertura=100` globally and appended `diametro=100` to every
launch URL. A native or legacy scene without an explicit ready 100 m coverage
product was then rejected by Volar with `cobertura 100 m pendiente`, even when
its native world geometry and collider were valid.

## Fix

- Mundo only appends an explicit diameter when that product is ready for the
  selected scene and shape.
- An incompatible remembered selection is represented as Auto for that scene.
- Volar treats stale explicit coverage parameters as a compatibility request:
  it falls back to the scene's native extent and collider instead of aborting.
- Runtime diagnostics expose whether the requested coverage was honored and
  why a native fallback was selected.

## Regression evidence

The browser regression first reproduced both failures:

1. A remembered 100 m preference generated
   `volar.html?m=recon_d77ef7af86&diametro=100`.
2. An old URL with the same stale parameter aborted with
   `cobertura 100 m pendiente`.

After the fix, the generated launch is
`volar.html?m=recon_d77ef7af86`, and the old URL boots successfully with:

- `requested_diameter_m: 100`
- `requested_honored: false`
- `effective_diameter_m: 397.47`
- `status: native-fallback`
- `fallback_reason: requested-coverage-unavailable`
- `boundary_source: native-fallback`
- `boundary_hits: 402`
- zero console errors

This behavior also allows genuine sub-100 m native scenes to open without
requiring a fabricated 100 m product.

## Local gates

- Full smoke suite: PASS (`TODOS LOS TESTS PASAN`).
- Browser matrix: phone portrait, phone landscape, iPad portrait, iPad
  landscape, and desktop all passed.
- Python focused suites: 70/70.
- JavaScript collision, camera, and touch suites: 29/29.
- Static gzip freshness: 7/7.
- World audit: 9/9 active worlds valid.
- World runtime sweep: 9/9 at 60 fps.
- Deployment preflight retained all active worlds green.

## Production canary

| Surface | Viewport | Result |
| --- | --- | --- |
| Mundo | Phone portrait | 9 islands, zero overflow |
| Volar | Phone portrait | 60 fps, real touch, zero overflow |
| Mundo | Desktop | 9 islands; remembered 100 m resolved to Auto |
| Volar | Desktop | 60 fps; stale 100 m URL used native fallback |

The authenticated manifest, weapon manifest, and five runtime weapon GLBs
returned 200 with private/no-store edge policy. The short-lived test session
was revoked after the run.

The public login returned 200, produced no console errors, and loaded in
426 ms. Public health and authentication boundaries passed before the
authenticated matrix.

Screenshot:
`.gstack/canary-reports/screenshots/login-v332-final.png`.

## Verdict

DEPLOY IS HEALTHY. Native worlds are no longer blocked by stale or unsupported
100 m coverage preferences. Both newly generated and old bookmarked launch
paths work, native collision remains active, and the production device checks
hold 60 fps with zero browser errors.
