# 🛸 AeroBrain: Personal Drone Intelligence Platform

**Live:** https://vuelos.metislab.work · **Repo:** https://github.com/zsoist/Drone_DR

Connect the SD card of the DJI Flip / Neo 2. The Mac Mini M4 processes all the data. Then you can
browse your flights on the web. The web has a satellite map that follows the video. It also
has AI analysis of scenes and auto-edited travel reels.

## Architecture ($0/month, a deliberate decision)

```
SD card ──ingest──▶ drone-vault (SSD 1TB)          Mac Mini M4 · control plane
                      raw/ proxies/ frames/         · ffmpeg + VideoToolbox (HW)
                      tracks/ thumbs/ ai/           · Gemini vision + DeepSeek
                            │                       · web/API/SQLite/publish/gates
                            │
                            ├── LAN/SSH ──▶ PC RTX 4060 Ti · WSL2
                            │              · ODM depthmaps CUDA
                            │              · gsplat 7K/15K/20K/30K/40K
                            ▼
              Cloudflare Worker /*          ←── HMAC session + private cache bypass
                            │
              Cloudflare Tunnel (metislab)  ←── $0: no R2, no VPS, no egress
                            │
                            ▼
                https://vuelos.metislab.work
```

**Why not R2/VPS:** the M4 is already a 24/7 server with plenty of SSD space. The free space changes, so
check it with `df -h /Volumes/SSD`. Cloudflare Tunnel serves the vault directly. Storage costs $0, egress
costs $0 and you do not need a card. R2 is a possible future option for trips. The script
[sync_r2.py](pipeline/archive/sync_r2.py) is archived, and its cap is 9GB on the free tier.

## Private access

AeroBrain has one account, `daniel`. The server needs authentication before it sends any page, API, video,
photo, map, model, splat or share link. The session is absolute and lasts 24 hours. The UI shows the session
time in Colombia time. The session cookie has the `__Host-` prefix and the Secure, HttpOnly and
SameSite=Strict attributes. The password check uses scrypt.

SQLite keeps only the hash of each session token. Codex and Claude Code have development access only
through strict loopback at `http://127.0.0.1:8790`. Supabase works only as a server-side index. The roles
`anon` and `authenticated` have no access to the schema, the tables or the RPCs. The Mac uses only its
secret key. Details and checks: [docs/AUTH_SECURITY.md](docs/AUTH_SECURITY.md).

The versioned Worker in `edge/` protects the whole host before the Cloudflare cache. It converts the cookie
of Daniel to an ephemeral HMAC envelope for the origin. It removes headers that an attacker can forge. It
keeps `Range` support for video streams. An old CDN entry cannot skip the gate. A transformation rule cannot
break the session.

## Modules

| Module | What it does |
|---|---|
| `pipeline/ingest.py` | SD → vault, resumable rsync + integrity manifest |
| `pipeline/srt_parser.py` | DJI SRT telemetry → GPS 1Hz + stats (dist, alt, bbox) |
| `pipeline/process.py` | 1080p H.264 proxy (VideoToolbox) + keyframes + thumbs |
| `pipeline/policy.py` | Compute tiers per clip (full/standard/skim) |
| `pipeline/build_index.py` | Collects manifests → flights.json |
| `ai/router.py` | LLM lanes: Gemini (vision) · DeepSeek (text) · OpenAI (fallback) |
| `ai/analyze.py` | Keyframes → summary, tags, highlights, travel_score (about $0.002/clip) |
| `ai/reel.py` | Auto-editor: top highlights → 1080p reel or 9:16 vertical reel |
| `pipeline/worker.py` | Single heavy queue: all ODM/splat jobs go to the CUDA PC (PC-only policy), publish and gates |
| `pipeline/compute_policy.py` | Routes ODM/splat to the PC (strict); `AEROBRAIN_COMPUTE=local` = legacy Mac |
| `pipeline/docker_ondemand.py` | OrbStack runs only while a job uses a local container; it stops after 5 min |
| `pipeline/pc_janitor.py` | Keeps scratch data on the GPU PC: 7 d for terminal jobs, 30 d for orphans |
| `pipeline/scenes.py` | Stable sites, immutable versions and the registered contribution of each video |
| `pipeline/scene_manifest.py` | `Mundo`/Flightverse contract with checked coverage at 100/200/400/600/1000 m |
| `pipeline/external_probe.py` | Public SLO from GitHub Actions (best-effort, see OPERATIONS): healthz, redirect to login, `whoami` 401, manifest 401 and media 401 with Worker headers |
| `pipeline/browser_gate.py` | Real QA in headless Chrome (CDP stdlib) before a 3D job is set to done |
| `pipeline/browser_matrix.py` | QA of splats on different screen sizes: share + workspace on mobile/iPad/desktop, macro zoom, overflow and screenshots |
| `pipeline/audit_splats.py` | Splat health auditor: assets, current/history, metadata, jobs, legacy warnings |
| `pipeline/make_ksplat.mjs` | .splat/.ply → .ksplat with the vendored viewer library (no npm) |
| `/supersplat/` | SuperSplat editor (MIT), self-hosted, for splat post-process work. It is served from `splat/supersplat/dist` (gitignored). The fork is in `splat/supersplat` (branch `aerobrain-fork`, private backup `github.com/zsoist/aerobrain-supersplat`). For the rebuild, see [RUNBOOKS](docs/RUNBOOKS.md#rebuild-supersplat) |
| `web/` | Flight Deck V2: cinematic Home, gallery, MapLibre/Esri map and synchronized telemetry |
| `web/home-data.js` | Truthful view of the Home: flights, jobs, vault and seven modules that fail independently |

## Current 3D pipeline

The control, the vault and the publication are local. The premium compute uses the RTX PC on the LAN:

1. `odm_prep.py` extracts frames with VideoToolbox, filters blur and duplicates, and writes GPS EXIF from the SRT.
2. The worker is a launchd process, separate from the web server. It claims the ODM job from the SQLite queue. It sends the job to the GPU PC through SSH (PC-only policy, `compute_policy.py`). Docker/OrbStack on the Mac starts only on demand for the post-process step. A restart of the web server does not kill jobs.
3. The preset `alta` uses 3072px, `pc-quality high`, `feature-quality high`, DSM/DTM/ortho and a dense cloud. The remote CUDA route can produce a full mesh for orbital/oblique captures. For nadir captures, DSM, ortho, cloud and splat stay the main product.
4. `tresd_publish.py` publishes ortho/DSM/hillshade WebP files with alpha feather and a binary DSM for measurements. It also publishes a gzip PLY cloud and, if one exists, a re-centered viewer mesh. It publishes the QA result and an atomic `system.json`.
5. The single splat contract defines Fast 1K and Medium 2K. Metal runs them only with `AEROBRAIN_COMPUTE=local` (legacy). By default, the policy is **PC-only** (`pipeline/compute_policy.py`) and all jobs go to CUDA. Cinematic 7K, Ultra 15K, Ultra+ 20K, Frontier 30K and Grandmaster 40K are strict NVIDIA CUDA tiers. They never use a lower tier and never run on the Mac. `auto` tries full resolution and retries with `-d2` only after a classified CUDA OOM.
6. The publication of splats is atomic. The pipeline archives `current` in `splats/history/`. It generates SOG and rebuilds the index. The browser gate must pass before the pipeline marks the job `done`.
7. The viewer gets a real matrix test. `share.html` and `tresd.html` on mobile, iPad and desktop must render a canvas. They must show the versions. They must not overflow horizontally. They must allow a measurable macro zoom.

### Measured evidence (single record)

This is the only record of CUDA measurements. ROADMAP.md and SPLAT_PIPELINE.md link here.
Measured 2026-07-14 (`DJI_20260712135736_0117_D`, RTX 4060 Ti):

- ODM `alta`: 238/238 cameras, DSM/DTM/ortho/cloud/mesh, browser gate OK.
- Cinematic 7K CUDA: 435.5 s end-to-end, 238 cameras, `-d2`.
- Ultra 15K CUDA: 928.4 s end-to-end, 649,150 source gaussians, SOG 8.3 MB, browser gate OK.
- Ultra+ 20K CUDA: 1,215.4 s end-to-end. A classified OOM at `d1` came first, then `d2` succeeded.
  It had 649,314 gaussians and peak 1,698 MiB VRAM. The job saved the `params_hash`.
- Frontier 30K CUDA FULL on the cumulative version: 5,339.4 s train time and 5,714.6 s
  end-to-end. It had 3,236,419 gaussians, peak 7,755 MiB VRAM and SOG 37.1 MB. It passed atomic
  publication and browser QA.
- Grandmaster 40K CUDA FULL on the same version: 7,500.3 s train time and 7,877.2 s
  end-to-end. The trainer output had 3,067,353 gaussians. After de-halo, 2,881,394 gaussians remained.
  Peak 7,730 MiB VRAM, SOG 34,903,178 bytes, atomic publication and browser QA. The job finished in one
  `d1` try. It had no OOM, no retry and no fallback
  (`params_hash=38db2479b3b89e748b3dac09c7789d7cb94e8c58b5d4e0d00de6c96103eca129`).
- The cumulative version `recon_60b23208db` (1,019 entries, 10 sources):
  - It already passed the OpenSfM gate. The shared component has 996 cameras and 951,994 points. The
    contribution is valid for 10/10 sources.
  - OpenMVS produced 46,731,480 dense points.
  - A post-write `rc=139` without OOM happened. The recovery checked 37,473,907 filtered points and
    resumed from `odm_filterpoints`.
  - The final package closed with 37,386,157 filtered dense points. It has an orthophoto/DSM/DTM of
    30,539×33,664, a published cloud of 795,450 points and a mesh of 744,416 vertices.
  - All needed assets passed atomic publication and browser QA. The splat gate is open.
  - Current state, checked on 2026-09-28: the **active** version of `scene_64f22e89f2` is
    `recon_b2fbe03239` (`manifest/scenes/scene_64f22e89f2.json`). `recon_60b23208db` is still `ready`
    but it is not the active version.

## Sites that improve over time

`scene_<id>` is the ID of a real place. Each improvement creates a reproducible `recon_<hash>` with the full
list of videos/photos. The system never overwrites the active version. OpenSfM records the contribution of
each source (`submitted`, `registered`, ratio, reason). The system does not promote or auto-train a `PARTIAL`
merge.

If a registration fails, the system keeps the evidence and the reason. A failed registration does not mean
that the system integrated the source.

`scene.v2.json` and `site.lod.json` list circular/square products of 100/200/400/600/1000 m. They mark a
product `ready` only when the real ODM extent reaches the diameter. `Estudio 3D` and `Mundo` use the same
active version and the same contract.

## Operation

```bash
python3 pipeline/ingest.py            # SD inserted → copy everything
python3 pipeline/process.py --all     # process new clips
python3 ai/analyze.py --all           # AI analysis of scenes
python3 pipeline/build_index.py       # refresh flights.json (the web updates itself)
python3 ai/reel.py --vertical         # reel for IG/TikTok
python3 pipeline/ops_status.py        # 24/7 audit: services, health, streaming, resources
python3 pipeline/external_probe.py    # same public probe that GitHub Actions runs
```

launchd services: `com.aerobrain.web` (:8790) · `com.aerobrain.worker` (3D/splat queue) ·
`com.metislab.tunnel` (Cloudflare) · `com.aerobrain.watchdog` (local health check every minute).
The watchdog is the check at minute level. The external GitHub monitor is best-effort.

`com.macmini.pc-queue` (every 120 s) is a generic command queue to the GPU PC (WoL + `ssh pc`). It is
separate from the AeroBrain code.

PC-only policy (default): all ODM jobs and heavy splat jobs run on the CUDA PC. The Mac only serves web
and video, and it does light post-process work. So there is no heavy local compute to give way to a viewer.

The adaptive local priority applies only with `AEROBRAIN_COMPUTE=local`. During playback, ODM goes from 10
to 7 cores and OpenSplat goes to background. The system restores the values after 45 s.

Service logs are in `~/Library/Logs/AeroBrain/` (`web.log`, `worker.log`, `tunnel.log`, `watchdog.log`,
`watchdog.launchd.log`). Runbook: [docs/OPERATIONS.md](docs/OPERATIONS.md).

The production Home uses a hybrid renderer. It loads content and metrics before the GLB. It keeps a static
fallback if WebGL or the model fails. It pauses the animation when the canvas is off screen.

The renderer limits the navigation effect to one canvas with a budget per viewport. With partial data, it
shows `Sin datos`. It never turns a failed request into an invented zero.

## Documentation

The index [docs/README.md](docs/README.md) classifies each document as a current contract, measured
evidence, a runbook or a historical snapshot. Read these documents first:

- `SPEC.md` for the product
- `docs/ARCHITECTURE.md` for the architecture of the system now
- `docs/RUNBOOKS.md` for procedures
- `docs/SPLAT_PIPELINE.md` for the trainer
- `docs/MULTISOURCE_3D.md` for cumulative scenes
- `pipeline/README.md` for the script map

## Roadmap

See [ROADMAP.md](ROADMAP.md) (single source for the scope that is done and the scope that is not done).

---
*For personal use by Daniel only. Code is in English. Content is in Spanish.*
