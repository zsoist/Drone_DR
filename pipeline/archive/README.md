# pipeline/archive

We retired these scripts on 2026-09-28. Nothing in the repo, in a test, or in `~/Library/LaunchAgents` imports or runs them. A check with `git grep` and `grep -r` on the LaunchAgents showed this.
They stay here for provenance only. If you run them from here, you take the risk: the paths inside can be old.

| File | Why archived |
|---|---|
| `canary_splat.py` | Weekly OpenSplat/Metal canary. Its LaunchAgent (`com.aerobrain.canary-splat`) is in `~/Library/LaunchAgents/_archive/`. The local OpenSplat build that it used is broken, and the PC-only policy does not use it. |
| `backfill_proxies.py` | One-shot backfill of 720p proxies. The job is finished, and `ops/backfill_proxies.log` is the record. |
| `browser_home_drone.py` | One-shot Chrome check of the Home light-theme and drone layout (plan `docs/superpowers/plans/2026-08-02-home-light-theme-layout.md`). `pipeline/test_home_drone_regression.py` and `pipeline/test_home_v2.py` replace it. |
| `browser_home_light.py` | Same plan as above. The light-theme layout is shipped, and the regression tests cover it. |
| `ply_bridge.py` | Experiment glue (brush PLY to the OpenSplat PLY naming) for the research on trainer migration in `docs/archive/MIGRATION_SPEC.md`. The production CUDA path converts with `ply2splat.py`. |
| `build_opensplat_mps.sh` | Builds OpenSplat against Metal (MPS). The local trainer is legacy (`AEROBRAIN_COMPUTE=local` only) and the build is broken now. See `docs/archive/LEGACY_MAC_TRAINER.md`. |
| `sync_r2.py` | Cloudflare R2 sync for trips. The design rejected R2 ($0 policy: media comes from the vault). Its known bug (a ledger that checks only size) is in `docs/archive/HUNT_2026-07-10_TRIAGE.md`. |

## Not archived on purpose

- `pipeline/sync_supabase.py` stays in place. It keeps the schema in `supabase/migrations/`. The Supabase project is NXDOMAIN now (see `docs/OPERATIONS.md`).
- `pipeline/splat_align.py` is unused and has the wrong vertical datum. Comments in `pipeline/ply2splat.py`, `web/volar.js` and `web/flightverse/scene.js` still name it. Move it here after you update those comments.
- `pipeline/flightverse_spike_gate.py` is the live CDP gate. `docs/DRONE_MODEL_SPEC.md`, `docs/ENEMY_MODEL_SPEC.md` and `docs/WORLD_CONTEXT_PROMPT.md` cite it.
