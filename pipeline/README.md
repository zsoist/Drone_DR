# pipeline/

One line per file. **[entry]** marks something you run or launchd runs; the rest are imported modules.
Retired scripts live in [`archive/`](archive/README.md). Architecture: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md);
procedures: [`../docs/RUNBOOKS.md`](../docs/RUNBOOKS.md).

## Shared modules

Imported by the server, worker and tools; none is a service. New code should use these instead of local copies.

- `paths.py` Filesystem roots: `REPO`, `PIPE`, `WEB`, `VAULT`, `KEYS_ENV`. `AEROBRAIN_VAULT` and `AEROBRAIN_KEYS_ENV` override the vault and the API-keys file (tests, other machines).
- `fsutil.py` Crash-safe writes (`atomic_write_*`, unique tmp in the same dir + `os.replace`) and `read_json`.
- `util_ids.py` Id/filename sanitizers (`safe_id` and friends) shared by the HTTP server.
- `media_probe.py` `ffprobe` wrappers (`ffprobe_text` primitive plus high-level helpers) for server and ingest.
- `splat_history.py` Splat history retention (prune, keeps the newest 6 versions per clip) and the training quality gate; re-exported by `aerobrain_server`.
- `keys.py` Single parser for the API-keys env file (`paths.KEYS_ENV`), cached per process; replaces the private copies in `ai/router.py`, `error_report.py` and `sync_supabase.py`.

## Server

- `aerobrain_server.py` **[entry, `com.aerobrain.web`]** HTTP origin on 127.0.0.1:8790: static + Range, auth/session, upload, all `/api/*`.
- `jobs.py` SQLite job + session store (`manifest/jobs.db`), append-only job logs in `ops/job_logs/`.
- `perf.py` Sudo-less Mac performance sampler for the live System panel.
- `hwconfig.py` Hardware caps from `config/hardware.json` (`--detect` regenerates the machine section).
- `gzip_assets.sh` **[entry]** Regenerates `.gz` sidecars for `web/` (run by `safe_restart.sh`).
- `bump_web_version.py` **[entry]** Bumps `?v=N` across `web/` and regenerates `.gz`; required after every `web/` edit.

## Worker and jobs

- `worker.py` **[entry, `com.aerobrain.worker`]** Single heavy-job queue consumer (ODM `3d`, `splat`), publish, gates, cancel.
- `compute_policy.py` Routes ODM/splat requests to the PC CUDA lane (strict); `AEROBRAIN_COMPUTE=local` = legacy Mac.
- `gpu_lane.py` **[entry: `--probe`]** SSH/WSL CUDA splat trainer on the PC (nerfstudio/gsplat), WoL, transfer bridge.
- `odm_gpu_lane.py` ODM on the PC (GPU container), ship images, resume checks, fetch outputs.
- `pc_janitor.py` **[entry, dry-run by default]** Retention of PC scratch (7 d terminal jobs, 30 d untracked).
- `docker_ondemand.py` OrbStack on demand (boot before a local container step, stop after 5 min idle).
- `capture_quality.py` **[entry]** Capture Intelligence: scores a flight before spending ODM time.
- `preflight.py` Evidence-based memory preflight for the local (legacy) OpenSplat path.
- `policy.py` Per-clip processing tiers (full/standard/skim).

## 3D, splat and scene

- `odm_prep.py` **[entry]** Frame extraction + SRT-to-EXIF geotags for ODM.
- `tresd_publish.py` **[entry]** Publishes ODM products as web assets in `models/<id>/`.
- `scenes.py` Stable scenes, immutable `recon_<hash>` versions, promote.
- `scene_manifest.py` **[entry]** SceneManifestV2, the contract Mundo/Flightverse consume.
- `scene_aoi.py` **[entry]** Reversible AOI derivation for an existing scene.
- `splat_presets.py` Single source of truth for splat tiers (Fast 1K to Grandmaster 40K).
- `splat_eval.py` **[entry]** Held-out eval harness (split, train, render, score); legacy MPS trainer env.
- `splat_align.py` Splat-to-terrain alignment (unused; wrong vertical datum; slated for archive).
- `ply2splat.py` **[entry]** PLY 3DGS to `.splat` conversion (production CUDA path).
- `autoclean.mjs`, `autoclean_presets.json` Splat Lab v2 Auto-Clean engine and presets.
- `crop_splat.mjs` Removes floater halos from a `.splat`.
- `make_ksplat.mjs` `.splat`/`.ply` to `.ksplat` using the vendored viewer lib.
- `dsm_lod.py`, `mesh_coverage.py`, `collision_bake.py` **[entry each]** DSM LOD, mesh rasterization and structural collider for Flightverse worlds.

## Media and ingest

- `ingest.py` **[entry]** DJI SD card to `raw/` with integrity manifest.
- `process.py` **[entry]** Proxy, thumbs, keyframes, track, manifest per clip.
- `srt_parser.py` DJI SRT to 1 Hz GPS flight.json and stats.
- `build_index.py` **[entry]** Aggregates manifests into `flights.json` and `system.json`.
- `backfill_luma.py` **[entry]** Average luma per clip into the manifest.
- `backfill_thumbs.py` **[entry]** Creates `models/<id>/ortho_thumb.webp` for published models.
- `sync_supabase.py` **[entry]** Mirrors vault metadata to Supabase (project currently unresolvable).
- `requirements.txt` Python dependencies.

## Ops and audits

- `safe_restart.sh` **[entry]** Restart web/worker/tunnel without killing heavy jobs, with world gates.
- `ops_watchdog.py` **[entry, `com.aerobrain.watchdog`, 60 s]** Local heal + alerts (`~/Library/Logs/AeroBrain/ALERT`).
- `ops_status.py` **[entry]** One-shot 24/7 audit (`--json` available).
- `external_probe.py` **[entry]** Unauthenticated public availability/auth probe (also run by GitHub Actions).
- `error_report.py` DeepSeek triage reports of job errors (writes only to `ops/reports`).
- `audit_vault.py` **[entry]** Manifest vs files vs jobs DB integrity.
- `audit_splats.py` **[entry]** Splat state audit (assets, current/history, metadata).
- `audit_world.py` **[entry]** Fail-closed audit of collision assets of active worlds.

## QA gates (real Chrome)

- `browser_gate.py` **[entry]** Gate for published 3D/splat assets; required before a job is `done`.
- `browser_matrix.py` **[entry]** Share + workspace across mobile/iPad/desktop viewports.
- `flightverse_collision_gate.py` **[entry]** Deterministic world-collision gate (`--stress 100`).
- `invasion_runtime_gate.py` **[entry]** GPU-Chrome gate for a mixed Invasion.
- `world_runtime_sweep.py` **[entry]** Opens every active World and fails on runtime drift.
- `flightverse_spike_gate.py` **[entry]** CDP gate used by the model specs (`--page volar.html --global __volar`).

## Generators

- `generate_drone_hd.py`, `generate_destruction_kit.py`, `generate_weapon_arsenal.py` **[entry]** Deterministic GLB generators.
- `weapon_asset_contract.py` Strict offline contract for weapon GLBs.

## Tests

- `run_all_tests.py` **[entry: the test entry point]** Runs every suite. Flags: `--fast`, `-k NEEDLE`, `-j JOBS`, `-v`.
- `test_smoke.py` **[entry, pre-commit gate]** Smoke suite; it invokes `run_all_tests.py --fast` itself. Run it without a pipe.
- `test_*.py` Python `unittest` modules (run as `python -m unittest` from `pipeline/`), split by subject: server/auth/routes, jobs and worker, scenes and AOI, splat policy and frontier, world collision and runtime gates, ops/watchdog/status, web/UI regressions, weapon assets, and shared helpers. List them with `ls pipeline/test_*`.
- `test_*.mjs` Node `node --test` modules (also `edge/test_*.mjs`, `tools/test_*.mjs`).
