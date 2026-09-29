# AeroBrain architecture (current)

Single source of truth for how the system is wired today. Paths and names were checked against
the code and the live LaunchAgents on 2026-09-28. Procedures live in [RUNBOOKS.md](RUNBOOKS.md),
service SLOs and Cloudflare settings in [OPERATIONS.md](OPERATIONS.md), auth in [AUTH_SECURITY.md](AUTH_SECURITY.md).
Anything tagged **legacy** only runs with `AEROBRAIN_COMPUTE=local`.

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
It never trains or runs ODM (PC-only policy since 2026-09-28).

| Piece | Label / file | Notes |
|---|---|---|
| Web origin | `com.aerobrain.web` runs `pipeline/aerobrain_server.py` | :8790 on 127.0.0.1, KeepAlive. Auth, static + HTTP Range, upload, all `/api/*`. Restarting it does not kill jobs. |
| Worker | `com.aerobrain.worker` runs `pipeline/worker.py` | Claims one `3d`/`splat` job at a time from `manifest/jobs.db`. KeepAlive. |
| Watchdog | `com.aerobrain.watchdog` runs `pipeline/ops_watchdog.py` | StartInterval 60 s. Heals web/worker/tunnel, probes the stream and the auth boundary, writes `ALERT`. |
| Tunnel | `com.metislab.tunnel` runs `cloudflared tunnel --config ~/.cloudflared/metislab-work.yml run` | Tunnel `20543a36-...`. Ingress: `vuelos.metislab.work` and `www.metislab.work` to `http://127.0.0.1:8790`; `workspace.metislab.work` and `*.metislab.work` to `http://localhost:4310`; catch-all 404. The `:4310` backend is external (not AeroBrain) and **currently not listening**, so those hostnames return 502 until it is started. |
| PC job queue (generic) | `com.macmini.pc-queue` runs `~/.local/scripts/pc-queue-runner.sh` | Not AeroBrain code. Every 120 s it drains JSON jobs from `~/.local/pc-jobs/queue/` on the PC (WoL wake, `ssh pc`, results to `done/` or `failed/`, sleeps the PC only if it woke it). AeroBrain's own lane does not use it (see section 2). |

Separate tunnel: `com.cloudflare.cloudflared` runs the tunnel `2b64631e-...` from `~/.cloudflared/config.yml`,
which only serves `ssh.danielreyes.work` to `ssh://localhost:22` (SSH access to the Mac). It carries no
AeroBrain traffic; do not confuse it with `com.metislab.tunnel`, and never restart one hoping to fix the other.

Logs: `~/Library/Logs/AeroBrain/{web,worker,tunnel,watchdog,watchdog.launchd}.log`, plus the `ALERT` file and
`watchdog-state.json` in the same directory. Job logs: `drone-vault/ops/job_logs/<job-id>.log`.

Repo scripts (see [pipeline/README.md](../pipeline/README.md)) are launched by these services; `safe_restart.sh`
is the only supported way to restart them.

## 2. PC GPU workforce

Policy (`pipeline/compute_policy.py`): `route_odm` forces `backend=cuda, backend_policy=strict`, `route_splat`
forces CUDA strict. A PC failure never spills onto the Mac. Applied in `/api/odm`, `/api/scene_improve`,
`build_splat_job_spec` and again when `run_3d` starts. `AEROBRAIN_COMPUTE=local` disables it (legacy Metal 1K/2K, local ODM).

- Host: `ssh pc` = `192.168.1.5`, user `reyes`, key `~/.ssh/pc_gpu` (from `~/.ssh/config`). WoL: `~/.local/scripts/pc-wake`
  (broadcast to 192.168.1.255, MAC in `~/.config/pc-gpu.env`).
- `pipeline/gpu_lane.py`: wakes the PC, copies the COLMAP dataset with `scp -r` to the NTFS staging on `D:` (`/mnt/d/gpu-vault/transfer`) and then `cp` into WSL ext4 at `/root/gpu-jobs/data` (Ubuntu),
  runs nerfstudio splatfacto + gsplat in a held SSH session (WSL dies ~15 s after the last session closes), exports
  the PLY and brings it back with scp. `--probe` checks node and environment.
- `pipeline/odm_gpu_lane.py`: ODM on the PC. Ships images, runs the GPU ODM container (`/root/gpu-jobs/odm`),
  handles OpenSfM/OpenMVS resume checks and fetches outputs to `drone-vault/odm/proj_<id>/`.
- Bridge: WSL `/mnt/d/gpu-vault/transfer` = Windows `D:\gpu-vault\transfer` (moved off C:, which sits near full).
  Binary-safe transfer goes WSL to NTFS to `scp` to the Mac, because `wsl.exe` stdout is not binary-safe.
- Scratch roots on the PC: `/root/gpu-jobs/{data,runs,checkpoints,odm}`; `splat-env` is the Python environment (never touched).
- Retention: `pipeline/pc_janitor.py` runs at the start of every GPU job (no schedule). Active jobs never; future
  `retain-until` honored; terminal jobs expire at 7 days; leftovers with no Mac job at 30 days; deletes exact
  paths under the known roots only, then `fstrim`. Manual: `python3 pipeline/pc_janitor.py` (dry run) / `--apply`.
- WSL lives on `D:\WSL\Ubuntu\ext4.vhdx` (sparse). Its config is `%USERPROFILE%\.wslconfig` (24 GB, 8 CPUs,
  `vmIdleTimeout=60000`, `autoMemoryReclaim=gradual`, `sparseVhd=true`).
- The PC is never a publication authority: no PC asset replaces `current` without conversion, QA and the browser gate on the Mac.

## 3. On-demand OrbStack

`pipeline/docker_ondemand.py`: OrbStack no longer starts at login. `ensure_up()` boots it right before a local
container step (publication post-processing with GDAL/PDAL/OpenSfM in the `opendronemap/odm` image, AOI, OpenSfM to
COLMAP export). The worker's idle loop calls `stop_if_idle()`, stopping it after 300 s without leases or containers.
Leases and the last-use marker live in `~/Library/Caches/AeroBrain/`. Any `docker` command starts OrbStack, so
probes must use `orb status` first. Memory cap 8 GB (a limit, not a reservation).

Callers that need Docker for one step wrap it in `docker_ondemand.session()`, a context manager that takes a lease file
first (so `stop_if_idle()` cannot stop the VM under the step), calls `ensure_up()`, and always removes the lease on exit,
even on failure; the idle window then restarts from that moment.

## 4. Cloudflare edge

- Worker `aerobrain-private-data-edge` (source `edge/`, config `edge/wrangler.toml`), route `vuelos.metislab.work/*` only,
  no `workers.dev`, no preview. Cloudflare removes `Cookie` after the Worker, so the Worker converts the session
  cookie to a 30 s HMAC envelope validated by the origin. Key: `AEROBRAIN_EDGE_AUTH_KEY` (Worker secret) and
  `drone-vault/.edge-auth-key` (0600). Tests: `node --test edge/test_private_data_worker.mjs`.
- Tunnel: see section 1. No Pages, no R2, no VPS: media is served from the SSD with Range and gzip sidecars ($0).
- Cache policy and dashboard settings: [OPERATIONS.md](OPERATIONS.md#cloudflare).

## 5. Vault layout (`/Volumes/SSD/drone-vault`)

The vault is data, outside the repo. Web paths `/data/...` map to it (with `ops/`, `trash/`, `odm/`, `raw/` never public).

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

A version becomes active only through promotion; `PARTIAL` merges are never promoted or auto-trained. Web
Studio 3D and Mundo/Flightverse read the same active version.
