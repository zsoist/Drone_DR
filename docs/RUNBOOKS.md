# AeroBrain runbooks

Short, copy-pasteable procedures. Context in [ARCHITECTURE.md](ARCHITECTURE.md); SLOs, Cloudflare and recovery
background in [OPERATIONS.md](OPERATIONS.md). Local agent access needs no login: `http://127.0.0.1:8790`
is in constrained dev mode (see [AGENTS.md](../AGENTS.md)); do not proxy it or change the Host header.

## Where things are

| What | Where |
|---|---|
| Service logs | `~/Library/Logs/AeroBrain/{web,worker,tunnel,watchdog,watchdog.launchd}.log` |
| Active alert | `~/Library/Logs/AeroBrain/ALERT` (exists only while something fails; watchdog removes it on recovery) |
| Per-job full log | `/Volumes/SSD/drone-vault/ops/job_logs/<job-id>.log` (also in UI: 3D, Trabajos) |
| Error reports (DeepSeek triage) | `/Volumes/SSD/drone-vault/ops/reports/`, read through the authenticated endpoint |
| Job queue | `/Volumes/SSD/drone-vault/manifest/jobs.db` (SQLite) and `curl http://127.0.0.1:8790/api/jobs` |
| Generic PC queue log | `~/.local/logs/pc-queue.log` (`com.macmini.pc-queue`, see ARCHITECTURE) |
| cloudflared for SSH (separate) | `~/Library/Logs/com.cloudflare.cloudflared.{out,err}.log` |

## Reading ops_status

```bash
python3 pipeline/ops_status.py          # human summary, first line PASS or FAIL
python3 pipeline/ops_status.py --json   # everything, machine readable
```

The verdict is the AND of: the four LaunchAgents loaded (web, worker, tunnel, watchdog); local and public
`/api/healthz` and `www`; the local Range probe returning 206; the public auth boundary (401, private cache, no
shared `HIT`) and the HMAC bridge; jobs (no stale `running`); resources (heavy workload processes such as
OpenSplat/ODM/ffmpeg without an active job make it FAIL; idle web+worker+tunnel should stay under 15% CPU and
500 MB RSS); log rotation; latency p95; 24 h reliability; power settings; the tunnel config
(`~/.cloudflared/metislab-work.yml` must contain both AeroBrain hostnames pointing at `http://127.0.0.1:8790`);
`flights.json` and `system.json` parse. A FAIL names the failing block; fix that block, rerun.

## Safe restart

```bash
pipeline/safe_restart.sh web      # also: "server" (alias). Refreshes gzip sidecars, runs the world preflight
pipeline/safe_restart.sh worker   # refuses while a running splat/3d job exists in jobs.db
pipeline/safe_restart.sh both     # worker first, then web
pipeline/safe_restart.sh tunnel   # kickstarts com.metislab.tunnel only
```

- `web`/`both` first run `audit_world.py`, `world_runtime_sweep.py` and `flightverse_collision_gate.py <active world> --stress 100`;
  a red gate aborts the restart. After the kickstart it waits for `/api/healthz`.
- Never `launchctl kickstart -k com.aerobrain.worker` by hand: it killed a 63% splat once (2026-07-05).
  Check `curl http://127.0.0.1:8790/api/jobs` first, or use the script.
- Break-glass for web only: `AEROBRAIN_SKIP_WORLD_GATE=1 AEROBRAIN_BREAK_GLASS_RECOVERY=I_UNDERSTAND_NO_WORLD_GATE pipeline/safe_restart.sh web`,
  then run the audit, sweep and 100x gate manually.
- Backend `.py` edits need a web restart; edits in `worker.py` need a worker restart.

## PC unreachable

The PC is `ssh pc` = `192.168.1.5` (MAC `BC:5F:F4:45:7E:B8`). Check before assuming it is off.

1. `ssh -o ConnectTimeout=5 pc 'echo ok'` and `nc -z -G 2 192.168.1.5 22`.
2. `arp -a | grep -i "bc:5f:f4:45:7e:b8"`: the PC's MAC must appear at `192.168.1.5`. **The .3 vs .5 trap:** on
   2026-09-28 `~/.ssh/config` pointed at `192.168.1.3` (a different device) and the GPU lane was silently broken.
   `ssh -G pc | grep -i hostname` must print `192.168.1.5`; if the MAC shows up at another address (DHCP drift),
   fix `HostName` and `HostKeyAlias` in `~/.ssh/config`, and keep the router reservation on .5.
3. Asleep: `~/.local/scripts/pc-wake` sends the magic packet to `192.168.1.255:9`. `gpu_lane.py` resends it every 20 s while
   waiting for SSH. Give Windows up to about 90 s.
4. Verify the lane end to end: `python3 pipeline/gpu_lane.py --probe` (node + CUDA environment, exit 0/1).
5. SSH answers but WSL jobs die: WSL exits about 15 s after the last session closes, and the lane holds a session on
   purpose. Check free space on the PC (D: bridge and the WSL disk), then run `pc_janitor.py`.
6. Failed job because the PC was down: the workdir is kept on the PC; re-enqueue (below) once `--probe` passes.

## Rerun a failed ODM or splat

There is no dedicated retry button; a rerun is a new request. Inspect the cause first (UI 3D, Trabajos, or the job log
in `ops/job_logs/`). Never restart the worker while something is `queued|running`. Cancel with
`curl -X POST http://127.0.0.1:8790/api/job_cancel -d '{"id":"<job-id>"}'`.

```bash
# ODM for a clip (PC CUDA strict by policy)
curl -X POST http://127.0.0.1:8790/api/odm -d '{"clip_id":"<clip>","preset":"alta"}'
# splat for a clip or recon_<hash>; resolution auto retries d1 -> d2 only after a classified CUDA OOM
curl -X POST http://127.0.0.1:8790/api/splat -d '{"clip_id":"<id>","preset":"frontier","backend":"cuda","backend_policy":"strict","resolution":"auto"}'
# new version of an existing scene with more sources
curl -X POST http://127.0.0.1:8790/api/scene_improve -d '{"scene_id":"<scene>","new_sources":["<clip>"]}'
```

- A splat must not be queued for a multi-source scene until its persisted `opensfm/reconstruction.json` passes the
  post-ODM gate (chosen component, exact cameras, per-source contribution); `PARTIAL` stops the handoff. Details in
  [OPERATIONS.md](OPERATIONS.md#gates-post-odm-y-recuperación-multi-fuente).
- Multi-source ODM runs with `--sfm-no-partial`; OpenMVS `rc=139` is not OOM without positive `oom_kill` evidence.
- Undo a bad Auto-Clean: `POST /api/splat_revert?cid=<id>` (restores the pre-clean raw, or `&to=<history file>`).

## Promote a scene version

Only a version with `status=ready`, `merge_label` `SINGLE` or `FULL`, and `required_artifacts_ok` can be promoted.

```bash
python3 -c "import json;d=json.load(open('/Volumes/SSD/drone-vault/manifest/scenes/<scene>.json'));print(d['active_version'],[(v['id'],v['status'],v.get('merge_label')) for v in d['versions']])"
curl -X POST http://127.0.0.1:8790/api/scene_promote -d '{"scene_id":"<scene>","version_id":"<recon_...>"}'
```

The endpoint rewrites `active_version`, regenerates `models/<id>/scene.v2.json` for every version and rebuilds the
index. A 409 carries the reason. Rolling back is promoting the previous ready version. Do not edit the scene JSON by hand.

## Purge trash and ODM projects safely

Rules: `raw/` is never deleted. Nothing is removed while a job for that clip is pending. Delete by exact path, never by glob on a parent.

- **Splat delete is reversible:** `/api/splat_delete` moves files to `drone-vault/trash/splats/`. Clip delete goes to `trash/clips/<cid>/`.
  There is no purge endpoint; to reclaim space, list first (`du -sh /Volumes/SSD/drone-vault/trash/*`), confirm you no
  longer need them, then `rm -r` the specific subfolder.
- **Full model removal:** `POST /api/model_delete {"clip_id":"<id>"}` removes `models/<id>`, its splat set and history, and marks it
  `failed` in any scene. It refuses (400) if the model is the scene's `active_version` (promote another first) and
  (409) if a job is active. Add `"purge_source": true` to also delete `odm/proj_<id>` (GBs of frames and stages).
- **Keep ODM projects** that back an active scene version or a splat you may retrain (`odm/proj_recon_<active>`): they
  survive training on purpose.
- **PC scratch:** `python3 pipeline/pc_janitor.py` (dry run), then `--apply`. It never touches active jobs or `splat-env`.
- Check space after: `df -h /Volumes/SSD` (internal disk must not be used for any of this).

## Rotate the edge auth key

Documented in [AUTH_SECURITY.md](AUTH_SECURITY.md#credential-rotation) (do not duplicate secrets anywhere else). Summary:
the key lives in `drone-vault/.edge-auth-key` (0600) and in the Worker secret `AEROBRAIN_EDGE_AUTH_KEY`; upload the exact
file bytes without a trailing newline, wait for propagation, restart `com.aerobrain.web`. A mismatch fails closed with 401,
a missing binding with 503. Wrangler needs a pseudo-TTY in non-interactive shells (`script -q /dev/null ...`) and
`CLOUDFLARE_ACCOUNT_ID` exported. Then `node --test edge/test_private_data_worker.mjs` and an anonymous `curl -I` (401,
`X-AeroBrain-Edge: private-data-v1`).

## Run all tests

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py            # everything
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py --fast     # skip modules > 60 s (currently none qualify)
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py -k scenes  # only suites whose name contains "scenes"
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py -j 4 -v    # 4 suites in parallel, show passing output
```

It runs every `pipeline/test_*.py` except `test_smoke.py` (as `python -m unittest`), and `node --test` over
`pipeline/test_*.mjs`, `edge/test_*.mjs` and `tools/test_*.mjs`. Tests run against a temp sandbox for job logs and
`errors.jsonl`, never the live vault. `test_smoke.py` runs it with `--fast`. Run the smoke test **without a pipe**
(or `set -o pipefail`) before any commit. Extra 3D acceptance checks: [AGENTS.md](../AGENTS.md#3d-acceptance-checks-for-agents).

## Rebuild SuperSplat

`/supersplat/` is served from `splat/supersplat/dist`, which is gitignored (build output). The source is a fork checked out
in `splat/supersplat` (branch `aerobrain-fork`; `origin` = upstream playcanvas, `backup` = private `github.com/zsoist/aerobrain-supersplat`).
Local patches are listed in `splat/supersplat/AEROBRAIN_PATCHES.md`.

```bash
cd splat/supersplat && npm ci && npm run build    # npm ci only on a fresh checkout; regenerates dist/
git push backup aerobrain-fork                     # keep the private backup current after fork commits
```

No server restart is needed; the static server reads `dist` on demand.

## Node tooling in `tools/`

`cd tools && npm ci` installs `@playcanvas/splat-transform` (lockfile-pinned). The server's splat convert/clean/export paths (`aerobrain_server.py`) shell out to
`tools/node_modules/@playcanvas/splat-transform/bin/cli.mjs`, and Auto-Clean (`pipeline/autoclean.mjs`) uses it for the GPU floater filter
(it degrades to the local filter result when missing); without `tools/node_modules` the server paths fail. `tools/node_modules` is gitignored.

## Bump the web version

After ANY edit under `web/` (code or docs):

```bash
python3 pipeline/bump_web_version.py        # ?v=N -> max+1 in html/js/vendor, regenerates .gz sidecars
python3 pipeline/bump_web_version.py 345    # explicit N
```

Skipping it makes the browser/edge mix old and new modules (Safari incident 2026-07-12). `safe_restart.sh` also
regenerates sidecars (`gzip_assets.sh`) but does not bump `?v=`.
