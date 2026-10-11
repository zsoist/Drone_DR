# AeroBrain runbooks

These are short procedures that you can copy and paste.
The context is in [ARCHITECTURE.md](ARCHITECTURE.md).
The background on SLOs, Cloudflare and recovery is in [OPERATIONS.md](OPERATIONS.md).

An agent on the local machine needs no login.
`http://127.0.0.1:8790` is in constrained dev mode (see [AGENTS.md](../AGENTS.md)).
Do not proxy it.
Do not change the Host header.

## Where things are

| What | Where |
|---|---|
| Service logs | `~/Library/Logs/AeroBrain/{web,worker,tunnel,watchdog,watchdog.launchd}.log` |
| Active alert | `~/Library/Logs/AeroBrain/ALERT` (it exists only while a part fails, and the watchdog removes it on recovery) |
| Per-job full log | `/Volumes/SSD/drone-vault/ops/job_logs/<job-id>.log` (also in the UI: `3D → Trabajos`) |
| Error reports (DeepSeek triage) | `/Volumes/SSD/drone-vault/ops/reports/`, read through the authenticated endpoint |
| Job queue | `/Volumes/SSD/drone-vault/manifest/jobs.db` (SQLite) and `curl http://127.0.0.1:8790/api/jobs` |
| Generic PC queue log | `~/.local/logs/pc-queue.log` (`com.macmini.pc-queue`, see ARCHITECTURE) |
| cloudflared for SSH (separate) | `~/Library/Logs/com.cloudflare.cloudflared.{out,err}.log` |

## Reading ops_status

```bash
python3 pipeline/ops_status.py          # human summary, first line PASS or FAIL
python3 pipeline/ops_status.py --json   # everything, machine readable
```

The verdict is PASS only if all of these checks pass:

- The four LaunchAgents are loaded (web, worker, tunnel, watchdog).
- Local and public `/api/healthz` and `www` answer.
- The local probe for Range returns 206.
- The public boundary for auth works (401, private cache, no shared `HIT`).
  The HMAC bridge works.
- Jobs: there is no stale `running` job.
- Resources: heavy workload processes such as OpenSplat, ODM or ffmpeg without an active job make the verdict FAIL.
  Idle web+worker+tunnel must stay under 15% CPU and 500 MB RSS.
- Log rotation works.
- The latency p95 is in range.
- The 24 h reliability is in range.
- The power settings are correct.
- The tunnel config is correct: `~/.cloudflared/metislab-work.yml` must contain both AeroBrain hostnames.
  Both hostnames must point to `http://127.0.0.1:8790`.
- `flights.json` and `system.json` parse.

A FAIL names the block that failed.
Fix that block.
Then rerun the command.

## Safe restart

```bash
pipeline/safe_restart.sh web      # also: "server" (alias). Refreshes gzip sidecars, runs the world preflight
pipeline/safe_restart.sh worker   # refuses while a running splat/3d job exists in jobs.db
pipeline/safe_restart.sh both     # worker first, then web
pipeline/safe_restart.sh tunnel   # kickstarts com.metislab.tunnel only
```

> **CAUTION:** Do not run `launchctl kickstart -k com.aerobrain.worker` by hand. It stopped a splat job at 63% once (2026-07-05).

- Before a worker restart, check `curl http://127.0.0.1:8790/api/jobs`, or use the script.
- `web` and `both` first run `audit_world.py`, `world_runtime_sweep.py` and `flightverse_collision_gate.py <active world> --stress 100`.
  A red gate stops the restart.
  After the kickstart, the script waits for `/api/healthz`.
- Break-glass for the web only: run `AEROBRAIN_SKIP_WORLD_GATE=1 AEROBRAIN_BREAK_GLASS_RECOVERY=I_UNDERSTAND_NO_WORLD_GATE pipeline/safe_restart.sh web`.
  Then run the audit, the sweep and the 100x gate by hand.
- A change in a `.py` file of the backend needs a web restart.
  A change in `worker.py` needs a worker restart.

## PC unreachable

The PC is `ssh pc` at `192.168.1.5` (MAC `BC:5F:F4:45:7E:B8`).
Check it before you decide that it is off.

**The .3 and .5 trap:** on 2026-09-28 `~/.ssh/config` pointed to `192.168.1.3`, a different device.
The GPU lane was silently broken.

<!-- ste:procedural -->

1. Run `ssh -o ConnectTimeout=5 pc 'echo ok'`.
2. Run `nc -z -G 2 192.168.1.5 22`.
3. Run `arp -a | grep -i "bc:5f:f4:45:7e:b8"`. The MAC of the PC must appear at `192.168.1.5`.
4. Run `ssh -G pc | grep -i hostname`. It must print `192.168.1.5`.
5. If the MAC shows up at another address (DHCP drift), fix `HostName` and `HostKeyAlias` in `~/.ssh/config`.
6. Keep the router reservation on .5.
7. If the PC is asleep, run `~/.local/scripts/pc-wake`. It sends the magic packet to `192.168.1.255:9`. `gpu_lane.py` sends the packet again every 20 s while it waits for SSH. Wait up to about 90 s for Windows.
8. Run `python3 pipeline/gpu_lane.py --probe`. It checks the node and the CUDA environment. The exit code is 0 or 1.
9. If SSH answers but WSL jobs die, check the free space on the PC (D: and the WSL disk). WSL exits about 15 s after the last session closes. The lane holds a session on purpose.
10. Run `pc_janitor.py` to free space.
11. If a job failed because the PC was down, re-enqueue it after `--probe` passes. The workdir stays on the PC. See "Rerun a failed ODM or splat".

<!-- ste:descriptive -->

## Rerun a failed ODM or splat

There is no dedicated retry button.
A rerun is a new request.
First find the cause in the UI (`3D → Trabajos`) or in the job log in `ops/job_logs/`.
Never restart the worker while a job is `queued|running`.
To cancel a job, run `curl -X POST http://127.0.0.1:8790/api/job_cancel -d '{"id":"<job-id>"}'`.

```bash
# ODM for a clip (PC CUDA strict by policy)
curl -X POST http://127.0.0.1:8790/api/odm -d '{"clip_id":"<clip>","preset":"alta"}'
# splat for a clip or recon_<hash>; resolution auto retries d1 -> d2 only after a classified CUDA OOM
curl -X POST http://127.0.0.1:8790/api/splat -d '{"clip_id":"<id>","preset":"frontier","backend":"cuda","backend_policy":"strict","resolution":"auto"}'
# new version of an existing scene with more sources
curl -X POST http://127.0.0.1:8790/api/scene_improve -d '{"scene_id":"<scene>","new_sources":["<clip>"]}'
```

<!-- ste:procedural -->

- Do not queue a splat for a multi-source scene before its saved `opensfm/reconstruction.json` passes the post-ODM gate.
  The gate checks the chosen component, the exact cameras and the contribution of each source.
  `PARTIAL` stops the handoff.
  The details are in [OPERATIONS.md](OPERATIONS.md#post-odm-gates-and-multi-source-recovery).
- Multi-source ODM runs with `--sfm-no-partial`.
  Do not call an OpenMVS `rc=139` an OOM without positive `oom_kill` evidence.
- To undo a bad Auto-Clean, run `POST /api/splat_revert?cid=<id>`.
  It restores the raw file from before the clean.
  Add `&to=<history file>` to restore a different file.

<!-- ste:descriptive -->

## Promote a scene version

You can promote only a version that has `status=ready`, a `merge_label` of `SINGLE` or `FULL`, and `required_artifacts_ok`.
First list the versions of the scene.

```bash
python3 -c "import json;d=json.load(open('/Volumes/SSD/drone-vault/manifest/scenes/<scene>.json'));print(d['active_version'],[(v['id'],v['status'],v.get('merge_label')) for v in d['versions']])"
```

Then promote the version.

```bash
curl -X POST http://127.0.0.1:8790/api/scene_promote -d '{"scene_id":"<scene>","version_id":"<recon_...>"}'
```

The endpoint rewrites `active_version`.
It regenerates `models/<id>/scene.v2.json` for every version.
It also rebuilds the index.
A 409 gives the reason.
To roll back, promote the previous ready version.
Do not edit the scene JSON by hand.

## Purge trash and ODM projects safely

These rules apply:

- Never delete `raw/`.
- Do not remove anything while a job for that clip is in the queue.
- Delete by exact path.
  Never delete by glob on a parent folder.

Then use these methods:

- **Splat delete can be undone.** `/api/splat_delete` moves the files to `drone-vault/trash/splats/`.
  A clip delete moves them to `trash/clips/<cid>/`.
  There is no purge endpoint.
  To get space back, list the folder first (`du -sh /Volumes/SSD/drone-vault/trash/*`).
  Make sure that you do not need the files.
  Then run `rm -r` on the specific subfolder.
- **Full model removal:** `POST /api/model_delete {"clip_id":"<id>"}` removes `models/<id>`, its splat set and its history.
  It marks the model `failed` in any scene.
  It refuses with 400 if the model is the `active_version` of the scene (promote another version first).
  It refuses with 409 if a job is active.
  Add `"purge_source": true` to also delete `odm/proj_<id>` (GBs of frames and stages).
- **Keep the ODM projects** that back an active scene version or a splat that you can retrain (`odm/proj_recon_<active>`).
  They survive training on purpose.
- **PC scratch:** run `python3 pipeline/pc_janitor.py` (dry run), then `--apply`.
  It never touches active jobs or `splat-env`.
- After the purge, check the space with `df -h /Volumes/SSD`.
  Do not use the internal disk for any of this.

## Rotate the edge auth key

The full procedure is in [AUTH_SECURITY.md](AUTH_SECURITY.md#credential-rotation).
Do not copy secrets to any other place.
The key lives in `drone-vault/.edge-auth-key` (0600) and in the Worker secret `AEROBRAIN_EDGE_AUTH_KEY`.
A mismatch fails closed with 401.
If the Worker has no secret for the key, the result is 503.
In non-interactive shells, Wrangler needs a pseudo-TTY (`script -q /dev/null ...`) and an exported `CLOUDFLARE_ACCOUNT_ID`.

<!-- ste:procedural -->

1. Upload the exact bytes of the key file as the Worker secret. Do not add a newline at the end.
2. Wait for propagation.
3. Restart `com.aerobrain.web`.
4. Run `node --test edge/test_private_data_worker.mjs`.
5. Run an anonymous `curl -I`. The result must be 401 with `X-AeroBrain-Edge: private-data-v1`.

<!-- ste:descriptive -->

## Run all tests

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py            # everything
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py --fast     # skip modules > 60 s (currently none qualify)
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py -k scenes  # only suites whose name contains "scenes"
/Volumes/SSD/_system/venv/bin/python3 pipeline/run_all_tests.py -j 4 -v    # 4 suites in parallel, show passing output
```

The script runs every `pipeline/test_*.py` except `test_smoke.py` (as `python -m unittest`).
It also runs `node --test` on `pipeline/test_*.mjs`, `edge/test_*.mjs` and `tools/test_*.mjs`.
Tests run against a temp sandbox for job logs and `errors.jsonl`, never the live vault.
`test_smoke.py` runs the script with `--fast`.
Run the smoke test **without a pipe** (or with `set -o pipefail`) before any commit.
For more 3D acceptance checks, see [AGENTS.md](../AGENTS.md#3d-acceptance-checks-for-agents).

## Rebuild SuperSplat

The server serves `/supersplat/` from `splat/supersplat/dist`.
Git ignores that folder because it is build output.
The source is a fork checked out in `splat/supersplat` (branch `aerobrain-fork`).
The remote `origin` is the upstream playcanvas repository.
The remote `backup` is the private repository `github.com/zsoist/aerobrain-supersplat`.
The file `splat/supersplat/AEROBRAIN_PATCHES.md` lists the local patches.

```bash
cd splat/supersplat && npm ci && npm run build    # npm ci only on a fresh checkout; regenerates dist/
git push backup aerobrain-fork                     # keep the private backup current after fork commits
```

You do not need a server restart.
The static server reads `dist` on demand.

## Node tooling in `tools/`

To install `@playcanvas/splat-transform` (locked by the lockfile), run `cd tools && npm ci`.
The server paths for splat convert, clean and export (`aerobrain_server.py`) call `tools/node_modules/@playcanvas/splat-transform/bin/cli.mjs` in a subprocess.
Auto-Clean (`pipeline/autoclean.mjs`) uses the same tool for the GPU floater filter.
If the tool is not there, Auto-Clean uses the result of the local filter instead.
Without `tools/node_modules`, the server paths fail.
Git ignores `tools/node_modules`.

## Bump the web version

After any edit under `web/` (code or docs), bump the version:

```bash
python3 pipeline/bump_web_version.py        # ?v=N -> max+1 in html/js/vendor, regenerates .gz sidecars
python3 pipeline/bump_web_version.py 345    # explicit N
```

If you skip this step, the browser and the edge mix old and new modules (Safari incident 2026-07-12).
`safe_restart.sh` also regenerates sidecars (`gzip_assets.sh`), but it does not bump `?v=`.
