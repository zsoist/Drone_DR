# AeroBrain architecture (current)

This file is the single source of truth for the connections between the parts of the system today.
On 2026-09-28, the team compared the paths and names with the code and the live LaunchAgents.
Procedures are in [RUNBOOKS.md](RUNBOOKS.md).
Service SLOs and Cloudflare settings are in [OPERATIONS.md](OPERATIONS.md).
Authentication is in [AUTH_SECURITY.md](AUTH_SECURITY.md).
Anything with the tag **legacy** runs only with `AEROBRAIN_COMPUTE=local`.

```text
Browser / iPhone
      |
Cloudflare edge  ->  Worker aerobrain-private-data-edge (edge/, route vuelos.metislab.work/*)
      |                    cookie -> 30 s HMAC envelope, strips spoofable headers, no-store CDN
Cloudflare Tunnel  (cloudflared, config ~/.cloudflared/metislab-work.yml)
      |
Mac Mini M4  127.0.0.1:8790  aerobrain_server.py  --  static/Range, /api/*, SQLite jobs.db
      |                                  |
  drone-vault (SSD)               worker.py (single heavy queue)
                                         |  SSH (alias `pc`), WoL
                                  PC RTX 4060 Ti / WSL2  (ODM CUDA, gsplat 1K-40K)
```

## 1. Mac control plane

The Mac owns the request, the SQLite queue, the vault, provenance, publication and every gate.
The Mac never trains and never runs ODM (PC-only policy since 2026-09-28).

| Piece | Label / file | Notes |
|---|---|---|
| Web origin | `com.aerobrain.web` runs `pipeline/aerobrain_server.py` | Port 8790 on 127.0.0.1, KeepAlive. It does authentication, static files with HTTP Range, upload and all `/api/*`. If you restart it, jobs continue to run. |
| Worker | `com.aerobrain.worker` runs `pipeline/worker.py` | It claims one `3d` or `splat` job at a time from `manifest/jobs.db`. KeepAlive. |
| Watchdog | `com.aerobrain.watchdog` runs `pipeline/ops_watchdog.py` | StartInterval 60 s. It heals the web origin, the worker and the tunnel. It probes the stream and the auth boundary. It writes `ALERT`. |
| Tunnel | `com.metislab.tunnel` runs `cloudflared tunnel --config ~/.cloudflared/metislab-work.yml run` | Tunnel `20543a36-...`. Ingress: `vuelos.metislab.work` and `www.metislab.work` go to `http://127.0.0.1:8790`. `workspace.metislab.work` and `*.metislab.work` go to `http://localhost:4310`. The catch-all returns 404. The `:4310` backend is external (not AeroBrain) and **is not listening now**. Those hostnames return 502 until someone starts it. |
| PC job queue (generic) | `com.macmini.pc-queue` runs `~/.local/scripts/pc-queue-runner.sh` | This is not AeroBrain code. Every 120 s it drains JSON jobs from `~/.local/pc-jobs/queue/` on the PC. It wakes the PC with WoL and uses `ssh pc`. It puts results in `done/` or `failed/`. It puts the PC to sleep only if it woke the PC. The AeroBrain lane does not use this queue (see section 2). |

A separate tunnel exists. `com.cloudflare.cloudflared` runs the tunnel `2b64631e-...` from `~/.cloudflared/config.yml`.
This tunnel serves only `ssh.danielreyes.work` to `ssh://localhost:22` (SSH access to the Mac).
It carries no AeroBrain traffic.
Do not confuse it with `com.metislab.tunnel`.
Never restart one tunnel to fix the other.

Logs are in `~/Library/Logs/AeroBrain/{web,worker,tunnel,watchdog,watchdog.launchd}.log`.
The `ALERT` file and `watchdog-state.json` are in the same directory.
Job logs are in `drone-vault/ops/job_logs/<job-id>.log`.

These services start the repo scripts (see [pipeline/README.md](../pipeline/README.md)).
`safe_restart.sh` is the only supported way to restart the services.

## 2. PC GPU workforce

The policy is in `pipeline/compute_policy.py`.
`route_odm` sets `backend=cuda, backend_policy=strict`.
For splat jobs, `route_splat` sets the CUDA strict policy.
A PC failure never moves the work to the Mac.
The policy applies in `/api/odm`, `/api/scene_improve` and `build_splat_job_spec`.
It applies again when `run_3d` starts.

`AEROBRAIN_COMPUTE=local` turns the policy off (legacy Metal 1K/2K, local ODM).

- Host: `ssh pc` is `192.168.1.5`, user `reyes`, key `~/.ssh/pc_gpu` (from `~/.ssh/config`).
  WoL uses `~/.local/scripts/pc-wake`. It sends a broadcast to 192.168.1.255. The MAC address is in `~/.config/pc-gpu.env`.
- `pipeline/gpu_lane.py` does these steps:
  1. It wakes the PC.
  2. It copies the COLMAP dataset with `scp -r` to the NTFS transfer folder on `D:` (`/mnt/d/gpu-vault/transfer`).
  3. It copies the dataset with `cp` into WSL ext4 at `/root/gpu-jobs/data` (Ubuntu).
  4. It runs nerfstudio splatfacto and gsplat in a held SSH session. WSL stops about 15 s after the last session closes.
  5. It exports the PLY.
  6. It copies the PLY back with `scp`.

  The `--probe` flag checks the node and the environment.
- `pipeline/odm_gpu_lane.py` runs ODM on the PC.
  It sends the images to the PC and runs the GPU ODM container (`/root/gpu-jobs/odm`).
  It checks if OpenSfM and OpenMVS can resume.
  It gets the outputs and puts them in `drone-vault/odm/proj_<id>/`.
- Bridge: WSL `/mnt/d/gpu-vault/transfer` is the same folder as Windows `D:\gpu-vault\transfer`.
  The team moved it off C:, which is almost full.
  `wsl.exe` stdout is not binary-safe.
  For this reason, binary-safe transfer goes from WSL to NTFS, then through `scp` to the Mac.
- Scratch roots on the PC: `/root/gpu-jobs/{data,runs,checkpoints,odm}`.
  `splat-env` is the Python environment. Never touch it.
- Retention: `pipeline/pc_janitor.py` runs at the start of every GPU job. It has no schedule.
  It follows these rules:
  - It never deletes active jobs.
  - It keeps a future `retain-until` date.
  - Terminal jobs expire after 7 days.
  - Leftovers with no Mac job expire after 30 days.
  - It deletes exact paths under the known roots only. Then it runs `fstrim`.

  For a manual run, start `python3 pipeline/pc_janitor.py` (dry run). Add `--apply` to delete the files.
- WSL is on `D:\WSL\Ubuntu\ext4.vhdx` (sparse).
  Its config is `%USERPROFILE%\.wslconfig` (24 GB, 8 CPUs, `vmIdleTimeout=60000`, `autoMemoryReclaim=gradual`, `sparseVhd=true`).
- The PC is never a publication authority.
  No PC asset replaces `current` before conversion, QA and the browser gate on the Mac.

## 3. On-demand OrbStack

OrbStack does not start at login now. `pipeline/docker_ondemand.py` controls it.
`ensure_up()` starts OrbStack just before a local container step.
These steps are publication post-processing with GDAL, PDAL and OpenSfM in the `opendronemap/odm` image, AOI, and OpenSfM to COLMAP export.
The idle loop of the worker calls `stop_if_idle()`.
`stop_if_idle()` stops OrbStack after 300 s without leases or containers.

Leases and the last-use marker are in `~/Library/Caches/AeroBrain/`.
Any `docker` command starts OrbStack, so probes must use `orb status` first.
The memory cap is 8 GB. It is a limit, not a reservation.

A caller that needs Docker for one step wraps the step in `docker_ondemand.session()`.
This context manager does these actions:

1. It takes a lease file first, so `stop_if_idle()` cannot stop the VM during the step.
2. It calls `ensure_up()`.
3. It always removes the lease on exit, also after a failure.

After the context manager removes the lease, the idle window starts again from that moment.

## 4. Cloudflare edge

- Worker `aerobrain-private-data-edge` (source `edge/`, config `edge/wrangler.toml`).
  It has the route `vuelos.metislab.work/*` only, with no `workers.dev` and no preview.
  Cloudflare removes `Cookie` after the Worker.
  For this reason, the Worker converts the session cookie to a 30 s HMAC envelope.
  The origin checks this envelope.
  The key is `AEROBRAIN_EDGE_AUTH_KEY` (Worker secret) and `drone-vault/.edge-auth-key` (0600).
  Tests: `node --test edge/test_private_data_worker.mjs`.
- Tunnel: see section 1.
  The system has no Pages, no R2 and no VPS.
  The SSD serves the media with Range and gzip sidecars ($0).
- Cache policy and dashboard settings: [OPERATIONS.md](OPERATIONS.md#cloudflare).

## 5. Vault layout (`/Volumes/SSD/drone-vault`)

The vault is data. It is outside the repo.
Paths that start with `/data/...` point to the vault.
The directories `ops/`, `trash/`, `odm/` and `raw/` are never public.

| Dir | Contents |
|---|---|
| `raw/` | Original DJI media, bit-perfect, checksummed. Never re-encoded or touched by cleanups. |
| `proxies/`, `proxies720/` | Web proxies (1080p H.264 / 720p). |
| `reels/` | Rendered reels (their posters are in `reel-posters/`). |
| `frames/`, `thumbs/`, `reel-posters/`, `photos/` | Keyframes for AI, thumbnails, posters, still photos. |
| `tracks/` | Per-clip 1 Hz GPS track (flight.json from SRT). |
| `ai/`, `audio/` | AI analysis output; audio assets. |
| `manifest/` | **App data, not just per-clip manifests**: `DJI_*.json` per clip, `flights.json` and `system.json` (indexes the web reads), `trips_meta.json`, `routes.json`, `geocode.json`, `capture/`, **`jobs.db`** (SQLite queue + sessions), and **`scenes/scene_<id>.json`** (stable scenes: `active_version`, `versions[]`, `source_evidence`). |
| `odm/` | ODM projects `proj_<clip-or-recon_id>/` (images + opensfm). They survive training (needed for re-splat and evals). |
| `models/<id>/` | Published 3D products per clip or `recon_<hash>`: ortho, DSM, cloud, mesh, `meta.json`, `scene.v2.json` (SceneManifestV2). |
| `splats/` | Current splat set `<id>.{splat,clean.sog,ksplat,cameras.json,meta.json}`; `history/` archived versions; `.training/` training staging (created on demand). |
| `worlds/`, `eval/`, `qa/`, `properties/` | Flightverse world assets, held-out eval runs, browser QA screenshots, property data. |
| `ops/` | Private ops data: `job_logs/`, `errors.jsonl`, `reports/`, `auth-events.jsonl`, `evidence/`, `transfer/` (created on demand). |
| `staging/`, `trash/` | `staging/` (created on demand) is scene-AOI scratch plus locks (browser uploads land in `raw/uploads`); `trash/` holds reversible deletes (`trash/{splats,clips/<cid>,reel,audio,...}`). |

## 6. Data flow: ingest to web

```text
SD card --ingest.py--> raw/ + manifest/<clip>.json (checksums)
   --process.py--> proxies/ (VideoToolbox), thumbs/, frames/ (keyframes), tracks/ (srt_parser.py)
   --ai/analyze.py--> ai/<clip>.json (Gemini vision + DeepSeek text via ai/router.py)
   --build_index.py--> manifest/flights.json + manifest/system.json
   --aerobrain_server.py--> /data/* (auth, Range) --> web/ (Flight Deck, Home V2, gallery, map)
```

Uploads from the web (`POST /upload`) enter the same chain. `POST /api/rescan` rebuilds the indexes.

## 7. Data flow: 3D request to scene manifest

```text
UI / API  POST /api/odm | /api/scene_improve | /api/splat | /api/splat_campaign
   -> compute_policy.route_*  (CUDA strict)          -> manifest/jobs.db  (queued)
   -> worker.py claims ONE job
   ODM:   odm_prep.py (frames + SRT->EXIF)  -> odm_gpu_lane.py ship images -> ODM on PC
          -> fetch outputs to odm/proj_<id>/ -> post-ODM OpenSfM gate (shared component, per-source registration)
          -> tresd_publish.py (OrbStack on demand) -> models/<id>/  -> browser_gate.py -> job done
   Splat: gpu_lane.py (dataset -> PC -> splatfacto/gsplat -> PLY) -> ply2splat.py -> splats/.training/
          -> quality gate -> publish (previous current -> splats/history/, keep 6) -> de-halo -> SOG
          -> browser_gate.py -> job done
   Scene: scenes.py records recon_<hash> version (status, merge_label, required_artifacts_ok)
          -> POST /api/scene_promote (only ready + SINGLE/FULL + artifacts ok) sets active_version
          -> scene_manifest.py writes models/<id>/scene.v2.json; build_index.py refreshes system.json
```

A version becomes active only through promotion.
The system never promotes `PARTIAL` merges and never trains them automatically.
The web app `Studio 3D` and `Mundo` (Flightverse) read the same active version.
