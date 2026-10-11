# pipeline/

This file has one line for each file. **[entry]** marks a file that you run or that launchd runs. The other files are modules that other code imports.
Retired scripts are in [`archive/`](archive/README.md). For the architecture, read [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
For procedures, read [`../docs/RUNBOOKS.md`](../docs/RUNBOOKS.md).

## Shared modules

The server, the worker and the tools import these modules. None of them is a service. New code must use them and must not make local copies.

- `paths.py` Filesystem roots: `REPO`, `PIPE`, `WEB`, `VAULT`, `KEYS_ENV`. `AEROBRAIN_VAULT` and `AEROBRAIN_KEYS_ENV` override the vault and the API-keys file (for tests and other machines).
- `fsutil.py` Crash-safe writes (`atomic_write_*`: a unique tmp file in the same directory, then `os.replace`) and `read_json`.
- `util_ids.py` Sanitizers for ids and file names (`safe_id` and others) that the HTTP server shares.
- `media_probe.py` Wrappers for `ffprobe` (the primitive `ffprobe_text` and high-level helpers) for the server and ingest.
- `splat_history.py` Retention of the splat history (prune: keeps the newest 6 versions of each clip) and the quality gate for training. `aerobrain_server` exports them again.
- `keys.py` The one parser for the API-keys env file (`paths.KEYS_ENV`). It caches the result in each process. It replaces the private copies in `ai/router.py`, `error_report.py` and `sync_supabase.py`.

## Server

- `aerobrain_server.py` **[entry, `com.aerobrain.web`]** HTTP origin on 127.0.0.1:8790: static files with Range, auth and session, upload, all `/api/*`.
- `jobs.py` SQLite store of jobs and sessions (`manifest/jobs.db`), and append-only job logs in `ops/job_logs/`.
- `perf.py` Sampler of Mac performance (no sudo) for the live System panel.
- `hwconfig.py` Hardware limits from `config/hardware.json` (`--detect` regenerates the machine section).
- `gzip_assets.sh` **[entry]** Regenerates the `.gz` sidecars for `web/` (`safe_restart.sh` runs it).
- `bump_web_version.py` **[entry]** Raises `?v=N` across `web/` and regenerates the `.gz` files. Run it after each edit in `web/`.

## Worker and jobs

- `worker.py` **[entry, `com.aerobrain.worker`]** The one consumer of the queue of heavy jobs (ODM `3d`, `splat`). It also does publish, gates and cancel.
- `compute_policy.py` Sends ODM and splat requests to the PC CUDA lane (strict). `AEROBRAIN_COMPUTE=local` selects the legacy Mac.
- `gpu_lane.py` **[entry: `--probe`]** CUDA splat trainer on the PC through SSH and WSL (nerfstudio/gsplat), with WoL and a transfer bridge.
- `odm_gpu_lane.py` ODM on the PC (GPU container): it ships images, checks resume and gets the outputs.
- `pc_janitor.py` **[entry, dry-run by default]** Retention of PC scratch data (7 d for terminal jobs, 30 d for untracked files).
- `docker_ondemand.py` OrbStack on demand: it boots before a local container step and stops after 5 min of idle time.
- `capture_quality.py` **[entry]** Capture Intelligence: it scores a flight before you spend ODM time.
- `preflight.py` Memory preflight, based on evidence, for the local (legacy) OpenSplat path.
- `policy.py` Tiers of work for each clip (full/standard/skim).

## 3D, splat and scene

- `odm_prep.py` **[entry]** Frame extraction and SRT-to-EXIF geotags for ODM.
- `tresd_publish.py` **[entry]** Publishes the ODM products as web assets in `models/<id>/`.
- `scenes.py` Stable scenes, immutable `recon_<hash>` versions and promote.
- `scene_manifest.py` **[entry]** SceneManifestV2, the contract that Mundo and Flightverse consume.
- `scene_aoi.py` **[entry]** Reversible AOI derivation for a scene that is already in the vault.
- `splat_presets.py` The single source of truth for splat tiers (Fast 1K to Grandmaster 40K).
- `splat_eval.py` **[entry]** Held-out eval harness (split, train, render, score) with the environment of the legacy MPS trainer.
- `splat_align.py` Splat-to-terrain alignment. Nothing uses it, it has the wrong vertical datum, and it is ready for the archive.
- `ply2splat.py` **[entry]** Converts PLY 3DGS to `.splat` (the production CUDA path).
- `autoclean.mjs`, `autoclean_presets.json` The Auto-Clean engine of Splat Lab v2 and its presets.
- `crop_splat.mjs` Removes floater halos from a `.splat`.
- `make_ksplat.mjs` Converts `.splat` or `.ply` to `.ksplat` with the vendored viewer library.
- `dsm_lod.py`, `mesh_coverage.py`, `collision_bake.py` **[entry each]** DSM LOD, mesh rasterization and the structural collider for Flightverse worlds.

## Media and ingest

- `ingest.py` **[entry]** Copies a DJI SD card to `raw/` with an integrity manifest.
- `process.py` **[entry]** Makes the proxy, thumbs, keyframes, track and manifest of each clip.
- `srt_parser.py` Converts DJI SRT to a 1 Hz GPS flight.json and stats.
- `build_index.py` **[entry]** Collects the manifests into `flights.json` and `system.json`.
- `backfill_luma.py` **[entry]** Adds the average luma of each clip to the manifest.
- `backfill_thumbs.py` **[entry]** Makes `models/<id>/ortho_thumb.webp` for published models.
- `sync_supabase.py` **[entry]** Mirrors vault metadata to Supabase (the project does not resolve now).
- `requirements.txt` Python dependencies.

## Ops and audits

- `safe_restart.sh` **[entry]** Restarts web, worker and tunnel without a kill of heavy jobs, and runs the world gates.
- `ops_watchdog.py` **[entry, `com.aerobrain.watchdog`, 60 s]** Local heal and alerts (`~/Library/Logs/AeroBrain/ALERT`).
- `ops_status.py` **[entry]** One-shot 24/7 audit (`--json` is available).
- `external_probe.py` **[entry]** Probe of public availability and auth, with no login (GitHub Actions also runs it).
- `error_report.py` Reports from DeepSeek that sort job errors (it writes only to `ops/reports`).
- `audit_vault.py` **[entry]** Integrity audit: manifest against files against jobs DB.
- `audit_splats.py` **[entry]** Audit of splat state (assets, current/history, metadata).
- `audit_world.py` **[entry]** Fail-closed audit of the collision assets of active worlds.

## QA gates (real Chrome)

- `browser_gate.py` **[entry]** Gate for published 3D and splat assets. A job needs it before the job is `done`.
- `browser_matrix.py` **[entry]** Tests share and workspace in mobile, iPad and desktop viewports.
- `flightverse_collision_gate.py` **[entry]** Deterministic gate for world collision (`--stress 100`).
- `invasion_runtime_gate.py` **[entry]** GPU-Chrome gate for a mixed Invasion.
- `world_runtime_sweep.py` **[entry]** Opens each active World and fails on runtime drift.
- `flightverse_spike_gate.py` **[entry]** CDP gate that the model specs use (`--page volar.html --global __volar`).

## Generators

- `generate_drone_hd.py`, `generate_destruction_kit.py`, `generate_weapon_arsenal.py` **[entry]** Deterministic GLB generators.
- `weapon_asset_contract.py` Strict contract (offline) for weapon GLBs.

## Tests

- `run_all_tests.py` **[entry: the test entry point]** Runs each suite. Flags: `--fast`, `-k NEEDLE`, `-j JOBS`, `-v`.
- `test_smoke.py` **[entry, pre-commit gate]** Smoke suite. It runs `run_all_tests.py --fast` itself. Run it without a pipe.
- `test_*.py` Modules of Python `unittest`. Run them with `python -m unittest` from `pipeline/`. To list them, run `ls pipeline/test_*`. They cover these subjects:
  - server, auth and routes
  - jobs and worker
  - scenes and AOI
  - splat policy and frontier
  - world collision and runtime gates
  - ops, watchdog and status
  - web and UI regressions
  - weapon assets
  - shared helpers
- `test_*.mjs` Modules for `node --test` (also `edge/test_*.mjs`, `tools/test_*.mjs`).
