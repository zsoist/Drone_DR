# AeroBrain Operations

Goal: `vuelos.metislab.work` works at all times while the Mac Mini is on and the FileVault session is unlocked.
The web and the video stream keep priority.
Since 2026-09-28 the Mac does not run ODM or splat jobs that train a model (PC-only policy, see "Resource policy").
The PC GPU does all the heavy compute.
The legacy route exists only with `AEROBRAIN_COMPUTE=local`.
On this route, ODM and OpenSplat use the whole machine when no playback is active.

See also: [ARCHITECTURE.md](ARCHITECTURE.md) for the design of the system today.
See [RUNBOOKS.md](RUNBOOKS.md) for the procedures.
They cover restart, PC down, rerun, promote and tests.

## SLO and definition of "up"

An external sample counts as available only if these tests pass without credentials:

1. `GET /api/healthz` returns 200 and `{"ok": true}`.
2. `GET /` ends at `login.html` and contains `AeroBrain`.
3. `GET /api/whoami` returns 401 and does not show private state.
4. The manifest and a protected route for media return 401 with private cache and CDN `no-store`.

The Mac watchdog adds one more test.
The last real proxy must answer `206 Partial Content` through a trusted loopback.
The same URL must answer 401 on the public origin.
A public `206 HIT` is a cache leak.
A cache leak makes `ops_status.py` report FAIL.

The monthly target is at least 99%.
In 30 days this allows a maximum of 7 h 18 min of downtime.
The workflow `.github/workflows/uptime.yml` tests from external infrastructure with cron `*/15`.
GitHub throttles the scheduled cron runs.
In practice the workflow ran every 3-4 h (99 runs in 15.5 days), so it is best-effort.
The minute-level check is the local watchdog (`com.aerobrain.watchdog`, 60 s).

The monthly availability is about:

```text
successful checks / scheduled checks * 100
```

The local watchdog repairs processes. The external workflow also detects a Mac that is off, no internet, and DNS or Cloudflare faults.

There is no local dashboard (Uptime Kuma does not run now, and nothing listens on `127.0.0.1:3001`).
Read the state with `python3 pipeline/ops_status.py` and `~/Library/Logs/AeroBrain/watchdog.log`.
If the auth boundary probe or the local probe fails, the watchdog writes `~/Library/Logs/AeroBrain/ALERT`.
It also sends a macOS notification (maximum 1 per hour for each cause).
The watchdog deletes the file when the system recovers.

## Architecture

```text
Browser/iPhone
    |
Cloudflare edge: TLS, HTTP/2+HTTP/3, Brotli
    |
Worker /*: session HMAC bridge + cache bypass
    |
cloudflared (QUIC preferred, HTTP/2 fallback)
    |
127.0.0.1:8790  AeroBrain web origin (daemon threads)
    |                         |
static/video Range            SQLite jobs.db
                              |
                     single launchd worker
                       |                     |
              Mac (on demand)          SSH/WSL2 PC RTX (all compute)
              OrbStack: GDAL/PDAL/     ODM CUDA + gsplat 1K–40K
              OpenSfM post-process
```

| Service | LaunchAgent | Function |
|---|---|---|
| Web origin | `com.aerobrain.web` | Serves `/web`, `/data`, the APIs and Range video |
| Worker | `com.aerobrain.worker` | Claims only one `3d`/`splat` job from SQLite |
| Tunnel | `com.metislab.tunnel` | Publishes the origin through Cloudflare Tunnel |
| Watchdog | `com.aerobrain.watchdog` | Local check every 60 s, public check every 5 min, stream and auth check every 15 min |
| Generic PC queue | `com.macmini.pc-queue` | Not AeroBrain code. Every 120 s it drains the JSON files of `~/.local/pc-jobs/queue/` on the PC (WoL, `ssh pc`). The AeroBrain GPU lane (`gpu_lane.py`) does not use it. |

`aerobrain-private-data-edge` is not a LaunchAgent.
It is the Cloudflare Worker that has its version in `edge/`.
Its scope is only `vuelos.metislab.work/*`.

All of them use `RunAtLoad`.
The web, the worker and the tunnel use `KeepAlive`.
OrbStack does **not** start at login (`app.start_at_login=false`, since 2026-09-28).
The worker turns it on only when a job needs a local container (see below).

## Resource policy

Operator decision (2026-09-28): **the PC GPU runs all heavy compute.**
The Mac serves the web and the video.
The Mac only does light post-process work on demand.

- `pipeline/compute_policy.py` routes each job.
  ODM goes to CUDA `strict`.
  A failure on the PC never moves the job to the Mac, not even in fast presets.
  Every splat goes to CUDA.
  The policy applies in `/api/odm`, `/api/scene_improve` and `build_splat_job_spec`.
  As a safety net, it also applies at the start of `run_3d`.
  `AEROBRAIN_COMPUTE=local` turns the legacy paths on again (Metal 1K/2K, local ODM) for one run.
- `pipeline/docker_ondemand.py`: OrbStack starts just before a local container (the publication `sh_in_odm`, AOI, and the OpenSfM to COLMAP export).
  The idle loop of the worker stops OrbStack after 5 min without use and without containers.
  The measured cold start is 1.3 s.
  At rest the Mac does not pay for the VM.
  Any `docker` command turns OrbStack on.
  A probe must run `orb status` first.
- OrbStack: the memory limit is `memory_mib=8192` (a limit, not a reservation).
  The image `opendronemap/odm` is present (GDAL 3.11, PDAL 2.9, OpenSfM) for the post-process work.

Hardware: Mac Mini M4 (10 cores, 16 GB).
PC: i7-3770S 4c/8t, 32 GB, RTX 4060 Ti 8 GB.
The GPU does the heavy work.
The PC CPU is the bottleneck in steps that do not use CUDA.

- The single SQLite queue has an atomic claim: two ODM or splat jobs never run at the same time.
- A cancel kills the process group and the container (local, or remote through WSL).
- The Mac keeps the request, the vault and the publication.
  The PC gets only the input data. It trains the splat and returns the results.
  No remote asset replaces `current` without conversion, QA and the browser gate on the Mac.

## PC GPU node (workhorse)

| What | Where |
|---|---|
| Network | `192.168.1.5` (MAC `BC:5F:F4:45:7E:B8`), alias `ssh pc`, WoL with `pc-wake` (if the PC does not answer, see RUNBOOKS, "PC unreachable"; do not confuse it with `.3`) |
| WSL | distro `Ubuntu`, disk `D:\WSL\Ubuntu\ext4.vhdx` (sparse), image `opendronemap/odm:gpu` |
| Job scratch | `/root/gpu-jobs/{data,runs,checkpoints,odm}` + `splat-env` (environment, do not touch) |
| WSL and Mac bridge | `D:\gpu-vault\transfer` is `/mnt/d/gpu-vault/transfer` in WSL (before it was C:, which is 94% full) |
| WSL config | `%USERPROFILE%\.wslconfig`: 24 GB, 8 CPUs, `vmIdleTimeout=60000`, `autoMemoryReclaim=gradual`, `sparseVhd=true` |

Cleanup of the PC (`pipeline/pc_janitor.py`) runs at the start of each GPU job.
It has no schedule.
These rules apply:

- The janitor never deletes active jobs.
- The janitor keeps a job with a future `retain-until` date.
- A terminal job (done, error, cancelled) expires after 7 days.
- Leftovers that have no job on the Mac expire after 30 days.

The janitor deletes by exact path.
It touches only direct children of the known roots.
It ends with `fstrim` to give the space back to D:.
For a manual run, use `python3 pipeline/pc_janitor.py` (dry run) or `--apply`.
First pass on 2026-09-28: 64 leftovers from Jul-Aug, 110.5 GB.

To compact the `.vhdx` file fully, use PowerShell **as administrator** on the PC.
Do these steps:

1. Run `wsl --shutdown`.
2. Run `diskpart`.
3. Run `select vdisk file="D:\WSL\Ubuntu\ext4.vhdx"`.
4. Run `attach vdisk readonly`.
5. Run `compact vdisk`.
6. Run `detach vdisk`.

To revert the sparse mode, run `wsl --manage Ubuntu --set-sparse false`.

`pipeline/ops_status.py` fails if it sees OpenSplat, ODM or ffmpeg without an active job.
At idle, web+worker+tunnel must stay under 15% CPU in total and under 500 MB RSS.
Normally they use about 0-2% and under 100 MB.

## Cloudflare

This is the real local config in `~/.cloudflared/metislab-work.yml`.
The job `com.metislab.tunnel` loads it.
`ops_status.py` needs both AeroBrain hostnames in it.
Both hostnames must point to `http://127.0.0.1:8790`.

```yaml
tunnel: 20543a36-a318-415e-b292-b88dd5f4a041
credentials-file: /Users/daniel_serverm4/.cloudflared/20543a36-a318-415e-b292-b88dd5f4a041.json

ingress:
  - hostname: vuelos.metislab.work
    service: http://127.0.0.1:8790
  - hostname: www.metislab.work
    service: http://127.0.0.1:8790
  - hostname: workspace.metislab.work
    service: http://localhost:4310
  - hostname: "*.metislab.work"
    service: http://localhost:4310
  - service: http_status:404
```

The two AeroBrain rules must stay before any wildcard.
The rule `*.metislab.work` goes to another local service on `:4310`.
That service is outside AeroBrain and has no process on that port now.
Those hostnames return 502 until that backend starts.

A second independent tunnel, `com.cloudflare.cloudflared` (`~/.cloudflared/config.yml`, tunnel `2b64631e-...`), publishes only `ssh.danielreyes.work` to `ssh://localhost:22`.
It gives SSH access to the Mac.
It does not carry AeroBrain traffic.
Do not restart it to fix the web.

For AeroBrain, use the explicit IPv4 address, not `localhost`.
macOS can resolve `localhost` to `::1` while the origin listens on `127.0.0.1`.
The `:4310` rule of `workspace` uses `localhost` because that service is not AeroBrain.
`cloudflared` negotiates QUIC and keeps redundant connections.
If UDP fails, it uses HTTP/2 instead.

Recommended settings in the Cloudflare dashboard:

- SSL/TLS: `Full (strict)`, Always Use HTTPS, TLS minimum 1.2, TLS 1.3 turned on.
  The origin also forces `308` for external HTTP and sends HSTS as defense in depth.
- Network: HTTP/2, HTTP/3 and Brotli turned on.
- Do not turn on 0-RTT.
  Some requests with the POST method need a login, so the risk of replay is not acceptable.
- WAF and rate limit: use them only for `/api/login`, uploads and mutations.
  Do not challenge `/api/healthz` or Range video after the session gate.
- The cache key keeps the query string.
  The origin rewrites the `?v=` placeholders of the HTML with `st_mtime_ns`.
  Only the exact fingerprint gets `immutable`.
- Do not remove the Worker route `vuelos.metislab.work/*`.
  Cloudflare removes `Cookie` after the Worker.
  The Worker changes it to a 30 s HMAC envelope, and the origin checks the envelope.
  If you limit the route to `/data/*` again, login breaks even when the form seems to work.
- The shared key exists only as the Worker secret `AEROBRAIN_EDGE_AUTH_KEY` and in `/Volumes/SSD/drone-vault/.edge-auth-key` (`0600`).
  A client can never supply bridge headers.
  The Worker removes them and signs again from the cookie.

These commands deploy the Worker and check it:

```bash
node --test edge/test_private_data_worker.mjs
npx wrangler deploy --config edge/wrangler.toml
curl -I -H 'Range: bytes=0-0' \
  https://vuelos.metislab.work/data/proxies/DJI_20260709145011_0101_D.mp4
# anonymous: 401, CF-Cache-Status DYNAMIC, X-AeroBrain-Edge private-data-v1
```

This is the cache policy that the origin sends:

| Asset | Cache-Control |
|---|---|
| Login HTML | `private, no-store` + CDN `no-store` |
| Login JS/CSS/icons | `private, no-cache` in the Worker |
| Authenticated HTML/API | `private, no-store` + CDN `no-store` |
| Authenticated MP4, photos, maps, splats and models | `private, no-cache` + CDN `no-store` |
| 401 response | `private, no-cache` + CDN `no-store` |

Cloudflare can compress the public login assets.
The private assets keep Range and revalidation in the browser of Daniel.
They must never become a shared `HIT` at the edge.

## Recovery and stability

The AC power config is:

```text
sleep=0  disksleep=0  autorestart=1  lowpowermode=0
```

The watchdog retries once before it restarts a service.
An isolated timeout does not kill an active ingest or edit.
If the process disappears from launchd, the watchdog restarts it at once.
The logs rotate at 5 MB with one earlier copy.

The log location changed on 2026-09-28.
The stdout and stderr of the LaunchAgents go to `~/Library/Logs/AeroBrain/{web,worker,tunnel,watchdog.launchd}.log`.
Before, they went to `/tmp/aerobrain-web.log`, `/tmp/aerobrain-worker.log`, `/tmp/metislab-tunnel.log` and `/tmp/aerobrain-watchdog.launchd.log`.
macOS cleared `/tmp` at each reboot.
`watchdog.log` lives in the new folder from before.
`ops_status.py` and the watchdog rotation use the new paths.

Known degraded state: the semantic search that uses Supabase does not work fully.
The Supabase project (`ehmfpq…`) does not resolve DNS (NXDOMAIN since 2026-09).
So `sync_supabase.py` cannot sync.
The schema is in `supabase/migrations/`.

Important physical limit: FileVault is on.
After a total power loss, `autorestart=1` turns the Mac on.
But macOS needs a manual unlock before it starts the LaunchAgents.
If you turn FileVault off, auto-login works.
But this is a security decision, and this project must not make that change alone.

Evidence from 2026-09-28 (upgrade to macOS 27.0): shutdown at about 05:50, boot at 06:18, login at 07:14.
This is about 80 min of real downtime.
The external workflow detected it (run 36412081105).
Since that day the watchdog log lives in `~/Library/Logs/AeroBrain/` and survives reboots.
Before, it was in `/tmp`, which deleted the evidence of the outage.

We found a drift on that day (OrbStack at 4 GB, no local ODM image).
The PC-only policy and the on-demand OrbStack fixed it.
See "Resource policy".

Thermal:

- Do not use fan control or an unsupported undervolt. macOS manages the M4.
- Keep the air inlets and outlets free.
  Do not put the Mini and the SSD in a closed space.
- Do not set the OrbStack limit above 8 GB.
  On this host OrbStack only does post-process work.
- During a long job, check `pmset -g therm`, `memory_pressure` and the UI.
  With PC-only, the heavy compute runs on the PC.
  (`docker stats` turns OrbStack on, so look at `orb status` first.)
- **Legacy (`AEROBRAIN_COMPUTE=local`):** the scheduler reduces CPU if a viewer appears.
  The ODM fallbacks and the memory limits (caps 8.5/11 GB) prefer a degraded or failed job to a hung host.

## Operations

### Jobs console and reports

The tab `3D → Trabajos` is the operations console.
The UI polls summaries of limited size and gets the detail on demand.
Each new job writes a full append-only log in `vault/ops/job_logs/<job-id>.log`.
SQLite keeps only the queue, the summary and the structured events (fallbacks, diagnostics, resolution and end).
The log view can paginate, search, filter by level, pause autoscroll, copy and download.
Jobs older than this policy show only their truncated SQLite tail, and the UI labels them as such.

The DeepSeek reports are triage, not authority.
`error_report.py` separates the tests of parameters from the workloads for each scene and requested quality.
It includes cameras, product and fallback.
It does not add OOM events that overlap.
It keeps the historical error separate from its resolution.

Medium is the measured local baseline.
The reports do not recommend a CUDA tier from 7K to 40K as a memory fix for another tier.
The Markdown bodies live in `ops/reports` (private).
The authenticated endpoint reads them, not the public `/data`.

### Status commands

```bash
python3 pipeline/ops_status.py
python3 pipeline/external_probe.py
curl http://127.0.0.1:8790/api/healthz
curl https://vuelos.metislab.work/api/healthz
curl -I -H 'Range: bytes=0-0' \
  https://vuelos.metislab.work/data/proxies/DJI_20260709145011_0101_D.mp4
tail -40 ~/Library/Logs/AeroBrain/watchdog.log
```

### Safe restart

```bash
pipeline/safe_restart.sh web
pipeline/safe_restart.sh tunnel
pipeline/safe_restart.sh worker  # refuses if a 3d/splat job is active
pipeline/safe_restart.sh both
```

### CUDA campaign

Use `3D → Procesamiento → Campaña CUDA`.
The dry run lists these items: active sites, loose models, cameras, bytes, current tier, node, CUDA environment and disk.
The approval is all-or-nothing. It queues jobs in strict sequence.
`auto` keeps the tier and changes `d1` to `d2` only after a classified CUDA OOM.
Never restart the worker while a job is `queued|running`.

### Post-ODM gates and multi-source recovery

The post-ODM gate applies to multi-source scenes.
Before you queue a splat, audit the saved `opensfm/reconstruction.json` with the current shared-component logic.
The audit needs the chosen component, the exact cameras and the contribution of each prefix.
These cases stop the handoff: `PARTIAL`, no file, or evidence from a worker older than the gate.
No fallback to the Mac compensates for them.

If a strict splat has an OOM, the only allowed automatic retry is CUDA `d1→d2`.
This retry keeps the tier, the iterations and `params_hash`.

ODM CUDA for multi-source scenes always uses `--sfm-no-partial`.
The internal merge of partial reconstructions can collide the IDs of shots and landmarks.
The run can then end with `rc=139`.

Sometimes OpenSfM already left features, matches and `tracks.csv`.
In this case, a recovery from `opensfm` is valid only if one condition is true. The remote count of the three artifacts must equal exactly the number of the new images.
The recovery archives only the truncated `reconstruction.json`.
It starts ODM without `--rerun-from opensfm`, because that option also deletes the checked caches.

The recovery keeps the workdir after another failure.
It must still pass the post-ODM gate.
By itself it never allows or queues a splat.

OpenMVS can also end with `rc=139` after it writes the whole filtered cloud.
Do not classify this as OOM without positive `memory.events` or `oom_kill` evidence.
The only acceptable recovery follows this order:

1. Check the PLY (header, count and size).
2. Check the `MVSI` magic of the MVS file.
3. Save the immutable diagnostic.
4. Only then, resume ODM from `odm_filterpoints`.

In the evidence of `recon_60b23208db`, the post-write artifact has 37.473.907 points.
The recovery produced 37.386.157 points after the statistical filter.
A partial file, a wrong magic or a count mismatch forces a rebuild of the phase.
In that case the system never publishes and never opens the splat gate.

### Documentation and monitoring

The documentation is not the monitor of a live job.
For stage, memory, progress and failures, use `3D → Trabajos`, `jobs.db`, `job_events` and `ops/job_logs/`.
The current Markdown files keep only contracts and closed milestones with a date and evidence.
So they have no states of active jobs that become old.

### Maintenance priority

1. Keep the power settings, the LaunchAgents and the Tunnel healthy. Keep OrbStack off at rest.
2. Keep the local watchdog and the external workflow green.
3. Do not break Range or cache. After a deploy, check `206`, Brotli and `HIT`.
4. Keep the single heavy queue (one heavy job at a time). The caps 8.5/11 GB and the adaptive priority are legacy (`AEROBRAIN_COMPUTE=local`).
5. Check `ops_status.py` before and after jobs and after any reboot.
6. For fully unattended recovery after an outage, choose between FileVault (security) and auto-login (availability). Or add a UPS in the future.
