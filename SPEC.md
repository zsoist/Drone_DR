# AeroBrain: Personal Drone Intelligence Platform

The idea in one sentence: "I connect the drone, I upload, and the system analyzes." AeroBrain turns each flight of the DJI Flip / Neo 2 into
intelligence: maps, object detection, 3D scenes and travel diaries.

## Architecture
- **Mac Mini M4** is the control plane and the server. It does the SD ingest and the ffmpeg/VideoToolbox proxies.
  It also runs the web and video service, the API, SQLite, the vault, the publish step, the gates and the reels.
  GDAL/PDAL/OpenSfM post-processing runs in OrbStack **only on demand**, and OrbStack is off when the system is idle.
  Since 2026-09-28 the Mac does not train and does not run ODM.
- **PC RTX 4060 Ti + WSL2** is the workhorse. It runs all ODM (CUDA, strict) and all splats (Nerfstudio/gsplat, 1K–40K).
  It is never the authority for a publish. Its scratch space expires by itself (`pc_janitor.py`).
  `AEROBRAIN_COMPUTE=local` turns on the legacy Mac paths again.
- **Cloudflare** gives the tunnel and the domain (`vuelos.metislab.work` to `localhost:8790`).
  It also runs the REQUIRED edge Worker in `edge/` (private-data-v1: the auth gate and the HMAC bridge to the origin). Without the Worker there is no access.
  There are no Pages and no R2. The system serves the media from the local SSD with HTTP Range and gzip sidecars, so the real cost is $0 per month.
  (Updated 2026-07-05. See docs/archive/3D_PROCESSING_AUDIT.md.)
- **drone-vault** (`/Volumes/SSD/drone-vault/`) holds the data. It is outside the repo.

## 3D contract
- ODM runs from video frames, not from the WebODM SaaS: The steps are: SRT, EXIF GPS, OpenSfM/OpenMVS, and then DSM/DTM/ortho/cloud/mesh.
  By policy (`compute_policy.py`), all ODM goes to the CUDA node in strict mode.
- Preset `alta` is the stable video route (3072 px, DSM/DTM/ortho/cloud). For nadir video it can use `--skip-3dmodel`.
  Under the PC-only policy it also runs on the PC CUDA lane.
  The old "local Mac" run exists only with `AEROBRAIN_COMPUTE=local` (legacy).
  Remote CUDA Ultra is the full-product route for large orbital or oblique scene versions.
- Gaussian splats are first-class outputs. All of them run on CUDA (PC-only policy).
  The tiers 7K–40K are strict CUDA. The system allows `d1→d2` only after a classified OOM, and there is no fallback to the Mac.
  A publish is atomic. The system supports SOG and legacy formats, history versions, checksums and the Chrome browser gate.
- A stable scene keeps immutable `recon_<hash>` versions.
  A source counts as integrated only if it belongs to the chosen shared component and passes the gate for each source.
  The system trains no splat before it audits the final `reconstruction.json`.
- A finished job must have real artifacts and QA. Do not allow empty QA, stale artifact links, or confusion between the current and history paths.

## Principles
1. Keep the originals bit-perfect. Never encode them again (checksums are in the manifest).
2. Make 1080p proxies in hardware (hevc_videotoolbox) for the web.
3. Make cheap JPG keyframes as input for AI vision.
4. Convert the SRT telemetry to flight.json at 1 Hz (GPS, altitude, exposure).
5. Set a tier of compute for each clip. Spend compute only where it pays.
6. LLM lanes in `ai/router.py`: vision uses Gemini Flash (JPG frames), text uses DeepSeek, and the fallback is OpenAI. All of them use a paid API key. Never use OAuth in a headless job.

## Non-goals (v1)
- There is no live flight control and no DJI SDK.
- There is no multi-user mode and no SaaS.
- There is no VPS: the system uses the Mac Mini and a Cloudflare Tunnel.
- There is no fine-tuning of models.
