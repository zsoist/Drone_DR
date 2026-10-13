# AeroBrain

This file is the single source of truth for agents that write code (Claude Code and Codex).
`AGENTS.md` is a symlink to this file. It lists the daily-driver pitfalls.

For the current system, read `docs/ARCHITECTURE.md`. For procedures, read `docs/RUNBOOKS.md`. For the script map, read `pipeline/README.md`.
For the legacy Mac trainer (`OpenSplat`, `MPS`, `xcodebuild`), read `docs/archive/LEGACY_MAC_TRAINER.md`.

## General rules

- English docs use STE. To check a file, run `python3 pipeline/ste_lint.py <file>` (style guide: `docs/STE_STYLE_GUIDE.md`).
- Read the pitfalls in this file before you change code.
- Use `/Volumes/SSD/_system/venv/bin/python3`. The system `python3` does not have `scipy` and `trimesh`, so some tests fail falsely.
- Put scratch files and screenshots in `/Volumes/SSD/tmp/agents/aerobrain`. Put QA captures that you keep in `/Volumes/SSD/archive/`. Do not write them to `/private/tmp`, `~` or `~/Downloads`.

## Browser gates and Mac memory

CAUTION: Do not run two headless Chrome browsers at the same time. Chrome fills RAM, and the swap files are on the small internal disk. With less than about 12 GB free, the Mac panics (this happened on 2026-10-08 and 2026-10-09).

- Run one browser gate at a time. Do not run gates in parallel shells.
- `pipeline/browser_gate.py` holds a lock for the full Mac (`browser-gate.lock`), so a second Chrome waits.
- Before it starts Chrome, the gate waits while free memory is less than 30% or the internal disk has less than 15 GB free. After 10 minutes, it stops with an error.
- The Chrome profiles are in `/Volumes/SSD/tmp/agents/aerobrain`. The gate always starts Chrome with `--mute-audio`, so tests make no sound.

## Working rules (Karpathy)

1. **Think before you code.** Write your assumptions. If a request has two meanings, show both. If a simpler method exists, say so. If the request is not clear, stop. Then ask.
2. **Keep it simple.** Write the minimum code. Do not add features, options or abstractions that nobody asked for. If the code is too complex, write it again.
3. **Make surgical changes.** Change only the lines that the task needs. Keep the style of the code that is there. Remove only the dead code that your change made.
4. **Work to a goal.** Write the success criteria as tests or checks first. Loop until they pass. For long work, write a plan with checkpoints.

Source: the observations of Andrej Karpathy on mistakes of LLM agents that write code (repo forrestchang/andrej-karpathy-skills).

## Local agent access (dev mode)

Agents on the Mac test the app in a constrained dev mode. The server binds only `127.0.0.1:8790`.
Codex and Claude Code can use full dev access on that origin, without a browser login.
The check needs all of these conditions:

- The client IP is loopback.
- The Host is exactly `127.0.0.1:8790` or `localhost:8790`.
- The request has no Cloudflare or forwarded headers.
- The `Sec-Fetch` metadata of the browser request is same-origin or none.

These conditions stop DNS attacks that point a public name to loopback. They also stop cross-site browser requests that can look like an agent.
The dev bypass exists only on loopback with an exact Host and without proxy headers.

```bash
# any agent ON the Mac — full read+write, no token, no login:
curl http://localhost:8790/api/whoami                      # -> dev_mode:true, user:daniel
curl http://localhost:8790/api/jobs                        # job list
curl -X POST http://localhost:8790/api/search -d '{"q":"selva verde"}'   # semantic search
curl -X POST http://localhost:8790/api/odm    -d '{"clip_id":"...","preset":"alta"}'    # premium ODM video route
curl -X POST http://localhost:8790/api/splat  -d '{"clip_id":"...","preset":"medium","backend":"metal"}'   # PC-only policy (default) overrides backend to CUDA on the GPU PC; metal only honored with AEROBRAIN_COMPUTE=local
curl -X POST http://localhost:8790/api/splat  -d '{"clip_id":"recon_...","preset":"frontier","backend":"cuda","backend_policy":"strict","resolution":"auto"}'
```

The preview browser that points to `http://127.0.0.1:8790` is also in dev mode.
Do not proxy that URL. Do not replace its Host header. Each of these changes turns off the exception.

### Why dev mode is safe (not a backdoor)

- The `127.0.0.1` loopback is reachable only from the Mac. Nothing on the LAN or the internet can reach it, except through the tunnel. The tunnel adds Cloudflare headers, so the gate blocks those requests.
- Dev mode rejects a request with an unexpected `Host`, `Origin` or `Sec-Fetch` value. It also rejects a request with proxy headers.
- A local process already has full filesystem access to the vault. Trust in localhost does not widen the attack surface.
- The public surface has no localhost fallback. Only the session of Daniel gates it. The server rejects header and query-string master tokens.

## Public access and authentication

- Auth is mandatory. Without a session, production gives only `login.html`, its local assets, `whoami` and the minimum health check.
- Every HTML, data, media and share path needs the cookie of Daniel. The server does not accept `X-Token` or query tokens.
- For external requests, the server asks for auth before it returns HTML, APIs, videos, maps, models, splats, share pages or vault data.
- The only remote path is the 24-hour browser session of Daniel. The server rejects header and query master tokens on purpose.
- Agents must use loopback dev mode. Do not put the password of Daniel in a command or a test fixture.
- Never widen `PUBLIC_RESOURCES` to fix a 401.
- The session lasts 24 h absolute. The cookie is `__Host-ab_session`, `Secure`, `HttpOnly` and `SameSite=Strict`.
- The `Secure` cookie works only over HTTPS. Local UI tests use `http://localhost:8790` (trusted, no cookie needed).
- SQLite stores a digest, not the bearer token. Every browser mutation passes the central CSRF gate.
- Approved automation uses only the strict loopback of the Mac.

### Operator sign-in

- The canonical user is `daniel`. There is no registration and no second account.
- On the first successful login, the system migrates the legacy SHA-256 verifier to a salted, memory-hard scrypt record. The record is at `/Volumes/SSD/drone-vault/.operator-auth.json` with mode `0600`.
- The system never stores passwords and session tokens in plaintext.
- For the threat model, the rotation procedure and the tests, read `docs/AUTH_SECURITY.md`.

### Private edge

- Each public path of AeroBrain crosses the versioned Cloudflare Worker in `edge/`.
- The Worker replaces the browser cookie with a 30-second HMAC envelope. It strips bridge headers that a client can spoof, bypasses the shared cache and keeps Range and Set-Cookie.
- `edge/wrangler.toml` keeps the Worker only on `vuelos.metislab.work/*`. It has no preview and no `workers.dev` route.
- The full route is mandatory. Cloudflare removes `Cookie` after the Worker, and the origin gets a signed session with an HMAC window of 30 s.
- Never forward headers that the client supplies. Never store `AEROBRAIN_EDGE_AUTH_KEY` in the repo.
- Never narrow the route. Never expose the key that signs the session. Never add a `workers.dev` or preview route.
- After a change, run `node --test edge/test_private_data_worker.mjs`. Then deploy with Wrangler.

## Restart the server after backend edits

```bash
pipeline/safe_restart.sh server     # alias for web; picks up backend changes
pipeline/safe_restart.sh tunnel     # Cloudflare tunnel only
pipeline/safe_restart.sh worker     # refuses while a 3D/splat job is running
tail -20 ~/Library/Logs/AeroBrain/watchdog.log
python3 pipeline/ops_status.py        # one-shot 24/7 ops audit
python3 pipeline/external_probe.py    # public healthz, login redirect, whoami/manifest/media 401 gates
```

`safe_restart.sh web/server/both` runs these checks automatically: `audit_world.py`, the FLIGHTVERSE gate with 100 stress on the active world, and `world_runtime_sweep.py`.
The recovery escape `AEROBRAIN_SKIP_WORLD_GATE=1` is explicit. After you use it, run the manual gate.

## Web edits and cache

- HTML is no-store. The server replaces each placeholder `?v=` with the exact `st_mtime_ns` of the asset. JS/CSS URLs with the same `?v=` are immutable.
- Even so, every batch of edits in `web/` must end with `python3 pipeline/bump_web_version.py`.
- The script raises `?v=N` in html, js and vendor files, refreshes the explicit references to assets and regenerates the `.gz` files.
- Vendored libraries cache for 24 h.
- Before you deploy web changes, run `python3 pipeline/page_load_gate.py` (desktop) and `--viewport phone`. The gate loads every app page and fails on any JS error. If a module export is not there, the page stays blank and the server shows no error (Ventas, 2026-10-13).
- If you edit modules without a bump, the browser and the edge mix old and new modules. Example: the Safari incident of 2026-07-12 (`terrain.splatMask` undefined).
- `var(--x)` does NOT resolve in SVG presentation ATTRIBUTES in WebKit. `fill="var(--x)"` becomes black on iPhone and iPad. ALWAYS set the colors of inline SVG through a CSS class, so that themes work.

## 3D acceptance checks for agents

Before you say that a 3D or splat change works, run these checks:

```bash
python3 -m py_compile pipeline/*.py ai/*.py
python3 pipeline/test_smoke.py
node --check web/icons.js web/tresd.js web/share.js web/splatview.js web/splatlab.js
python3 pipeline/audit_vault.py
python3 pipeline/audit_splats.py
python3 pipeline/audit_world.py
python3 pipeline/flightverse_collision_gate.py <clip_id> --stress 100
python3 pipeline/browser_gate.py model <clip_id>
python3 pipeline/browser_gate.py splat <clip_id>
python3 pipeline/browser_matrix.py <clip_id>          # share + 3D workspace, mobile/iPad/desktop
```

For splat history bugs, check both the current URL and the archived URL:

```bash
curl -I http://127.0.0.1:8790/data/splats/<clip>.ksplat
curl -I http://127.0.0.1:8790/data/splats/history/<clip>-<timestamp>.ksplat
```

## Pitfalls

### Git and tests

- NEVER chain `test_smoke.py | tail && git commit`. The pipe hides the exit code, so `&&` commits with red tests (this happened on 2026-07-11).
- Run the smoke test WITHOUT a pipe, or with `set -o pipefail`, before each commit.
- After a structural refactor (code moved between modules, dispatch tables, renames), smoke checks that assert source literals or AST shapes fail. Update them to the new invariant. Do not revert the refactor to satisfy them.
- Tests must never write into the real vault. Point `AEROBRAIN_JOB_LOG_DIR`, `AEROBRAIN_ERRLOG` and `AEROBRAIN_VAULT` at a temp dir before you import anything that touches them.

### Tools and platform

- macOS ships **openrsync**, not GNU rsync. `--info=progress2` fails with exit 1. Use plain `rsync -a`. Monitor progress with `du -sh` on the destination.
- DJI SD cards also carry a `HYPERLAPSE/` folder next to `DCIM/DJI_001/`. Ingest copies all of DCIM. Do not assume that DJI_001 is the only source of media.
- `wrangler` (OAuth) refuses writes in non-interactive shells. Wrap the command with `script -q /dev/null …` for a pseudo-TTY. Export `CLOUDFLARE_ACCOUNT_ID`.
- R2 needs a one-time dashboard activation (error 10042) and a card on file. The design AVOIDS R2. Media comes from the vault through Cloudflare Tunnel ($0).
- `cloudflared tunnel route dns` uses the default cert zone (danielreyes.work). For metislab.work, pass `TUNNEL_ORIGIN_CERT=~/.cloudflared/zone-certs/metislab.work.pem`.
- The first try made a stray CNAME, `vuelos.metislab.work.danielreyes.work`. It is harmless. Delete it in the dashboard when you have time.
- `aerobrain_server.py` (stdlib) serves media behind the tunnel. It has HTTP Range, so you do not need a Caddy swap.

### ODM photogrammetry

- ODM photogrammetry on the frames of a video NEEDS geotags with GPS data in the EXIF. They come from the SRT track through `pipeline/odm_prep.py`. Without them the orthophoto is 67x66px garbage.
- The best default for DJI video is now the preset `alta`. It uses 3072px frame prep, `pc-quality high`, `feature-quality high`, DSM, DTM, ortho, point cloud (`nube`) and `--skip-3dmodel`.
- A full mesh is expensive and weak for nadir-only video. The premium outputs are splat, point cloud and DSM.
- The GeoTIFF from ODM: ffmpeg reads it as BLACK (tiled TIFF). ALWAYS convert with GDAL inside the container:

```bash
docker run --entrypoint bash opendronemap/odm -c "python3 -c 'from osgeo import gdal; gdal.Translate(...)'"
```

- On `DJI_20260706133809_0101_D`, ODM `alta` passed the check: 30/30 cameras, DSM/DTM, feathered ortho, browser gate OK.
- If OpenMVS fails, the worker goes back to stable dense or 25D with explicit QA. It never does this silently.
- The measured time of about 12.6 min is from the M4 (the **legacy** route `AEROBRAIN_COMPUTE=local`). Today the job runs on the CUDA PC.
- `gdal_array` (`ReadAsArray`) is BROKEN in the ODM image (numpy mismatch). To measure, export the DSM as ENVI binary in `tresd_publish`. Then read it with numpy on the HOST (memmap).
- The textures of an ODM mesh (44-57 pages of 4096²) are 2.5-3.8 GB UNCOMPRESSED on the GPU. Desktop Chrome holds them. Safari and iPhone remove textures from the GPU SILENTLY. Black patches appear ("broken mesh"), with no error in the console.
- The viewer must use the `vt_*.jpg` set with a budget of at most 600 MB (`make_viewer_textures` in `tresd_publish`). The fine detail lives in the orthophoto, not in the mesh.

### Splat and scenes

- The local Mac trainer (`OpenSplat`/`MPS`) is **legacy, broken and unused**. It works only with `AEROBRAIN_COMPUTE=local`.
- For all details, the rules after the patch, MPS memory and `xcodebuild`, read `docs/archive/LEGACY_MAC_TRAINER.md`. The weekly canary-splat does not run any more.
- Splat profiles come only from `pipeline/splat_presets.py`.
- Fast 1K and Medium 2K can use Apple Metal/CPU only with `AEROBRAIN_COMPUTE=local` (legacy). The default PC-only mode forces CUDA.
- Cinematic 7K, Ultra 15K, Ultra+ 20K, Frontier 30K and Grandmaster 40K need NVIDIA CUDA.
- Strict CUDA never changes the tier or the backend.
- `resolution=auto` tries `d1`. It tries the same tier at `d2` only after a classified CUDA OOM.
- SH stays at degree 0. The public path from `.splat` to SOG cannot keep higher coefficients.
- Legacy custom requests above 2K are also CUDA-only. Requests from 500–2K stay inside the local envelope.
- A publish is atomic.
- CUDA is a disposable accelerator. The Mac owns SQLite, the vault, the immutable request, provenance, publish, the browser gate and the current/history swap. Never publish directly from the PC.
- A stable scene gets a new version by a new run that trains the scene again. It does not change the model online. A video is part of the scene only when the SfM registration of that source says so.
- Keep failed tries and their reasons in `source_evidence`. Do not erase a source. Do not call a source integrated because the global ratio passes.
- Coverage diameters (100/200/400/600/1000 m) are output extents, not capture altitudes.
- `ready` needs the real dimensions of the world. Altitude bands are separate capture evidence.
- The GaussianSplats3D library in `vendor/` imports `"/vendor/three.module.js"` (a browser URL). To use it in Node (`make_ksplat.mjs`), rewrite that import to `file://` in a temporary copy. Shim window, self, document and navigator BEFORE the import. Do not use npm.

### Infrastructure and jobs

- The worker launchd job (`~/Library/LaunchAgents/com.aerobrain.worker.plist`) runs `/Volumes/SSD/_system/venv/bin/python3`. The worker imports `scipy` (through `scene_manifest` and `scatter`), and `/opt/homebrew/bin/python3` does not have it. On 2026-10-13 the worker stopped for about 2 h in a crash loop for this reason. After a change to the plist, run `bash pipeline/safe_restart.sh worker`. Then read `~/Library/Logs/AeroBrain/worker.log`.
- Docker runs in OrbStack, on demand since 2026-09-28 (`docker_ondemand.py`). It does not start with the session. It stops after 5 min without use.
- ANY `docker` command turns OrbStack on. The probes look at `orb status` first.
- The OrbStack limit is 8 GB. The Mac now does only post-processing. ODM runs on the PC.
- History: with the VM at 3.9 GB, ODM on the Mac gave OOM 137 in mvs_texturing.
- The GPU PC is `ssh pc`, at 192.168.1.5 (MAC BC:5F:F4:45:7E:B8).
- If the PC "does not respond", check the IP with `arp -a` before you assume that it is off. On 2026-09-28, `~/.ssh/config` pointed to 192.168.1.3 (another machine). The GPU lane was broken and nothing reported it.
- Heavy jobs run in a decoupled worker (`com.aerobrain.worker`). A restart of the web server does NOT kill them (tested live).
- A restart of the WORKER kills its orphan processes before it claims jobs again (fix from codex).
- (2026-07-05) NEVER run `launchctl kickstart -k com.aerobrain.worker` without a check of `/api/jobs` first. It killed a 7k splat at 63% (3.8 h of CPU).
- When the worker restarts, the job store marks the orphan jobs as error.
- `drawtext`/`HAS_DRAWTEXT` needs only a restart of `com.aerobrain.web`. `run_edit` lives in the server, not in the worker.
- Use `pipeline/safe_restart.sh`.
