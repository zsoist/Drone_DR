# pipeline/archive

Scripts retired on 2026-09-28. Nothing in the repo, in a test, or in `~/Library/LaunchAgents`
imports or invokes them (verified with `git grep` and `grep -r` on the LaunchAgents). Kept for
provenance only; run them from here at your own risk, paths inside may be stale.

| File | Why archived |
|---|---|
| `canary_splat.py` | Weekly OpenSplat/Metal canary. Its LaunchAgent (`com.aerobrain.canary-splat`) is already in `~/Library/LaunchAgents/_archive/`, and the local OpenSplat build it exercised is broken and unused under the PC-only policy. |
| `backfill_proxies.py` | One-shot backfill of 720p proxies (finished; `ops/backfill_proxies.log` is the record). |
| `browser_home_drone.py` | One-shot Chrome check for the Home light-theme/drone layout (plan `docs/superpowers/plans/2026-08-02-home-light-theme-layout.md`). Superseded by `pipeline/test_home_drone_regression.py` and `pipeline/test_home_v2.py`. |
| `browser_home_light.py` | Same plan as above; light-theme layout was shipped and is now covered by the regression tests. |
| `ply_bridge.py` | Experiment glue (brush PLY to the OpenSplat PLY naming) for the trainer-migration research in `docs/archive/MIGRATION_SPEC.md`. The production CUDA path converts with `ply2splat.py`. |
| `build_opensplat_mps.sh` | Builds OpenSplat against Metal (MPS). The local trainer is legacy (`AEROBRAIN_COMPUTE=local` only) and the build is currently broken; see `docs/archive/LEGACY_MAC_TRAINER.md`. |
| `sync_r2.py` | Cloudflare R2 sync for trips. R2 was rejected by design ($0 policy, media served from the vault). Its known bug (size-only ledger) is in `docs/archive/HUNT_2026-07-10_TRIAGE.md`. |

## Not archived on purpose

- `pipeline/sync_supabase.py` stays in place (kept for the schema in `supabase/migrations/`; the Supabase project is currently NXDOMAIN, see `docs/OPERATIONS.md`).
- `pipeline/splat_align.py` (unused, wrong vertical datum) is still named in comments of
  `pipeline/ply2splat.py`, `web/volar.js` and `web/flightverse/scene.js`; move it here once those comments are updated.
- `pipeline/flightverse_spike_gate.py` is cited as the live CDP gate in `docs/DRONE_MODEL_SPEC.md`,
  `docs/ENEMY_MODEL_SPEC.md` and `docs/WORLD_CONTEXT_PROMPT.md`.
