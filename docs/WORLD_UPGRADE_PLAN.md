# World upgrade plan — Blender, reconstruction, AI agents (2026-09-29)

Goal: make the worlds and models built from drone captures (Dialectica first) look and run far
better — clean buildings, no holes, light assets, richer terrain — with automatable, $0-runtime tools.

Inputs: 5 parallel research agents (inventory, Blender, Unreal/RealityScan, AI agents/models,
capture/reconstruction), then an independent code-grounded review whose 12 corrections are applied
(texture counts, no re-bake, CSP already wasm-ready, gltfpack-first, exact mesh frame, CUDA baseline). Sources are listed per section; items marked
*(unverified)* came from secondary sources.

## 0. Facts that shape the plan

| Fact | Consequence |
|---|---|
| PC GPU = RTX 4060 Ti **8 GB** (8188 MiB), 34 GB RAM, WSL capped at 23 GB | No MILo/splatfacto-big/Unreal Nanite+Lumen comfortably. MCMC splats, Cycles baking, RealityScan fit. |
| PC C: has 46 GB free (94% used); D: 267 GB free (HDD); WSL ext4 919 GB free | Everything new installs/writes to D: or WSL, never C:. |
| Blender 5.2 LTS already installed: PC (`C:\Program Files\Blender Foundation\Blender 5.2`) and Mac (5.2.2) | Blender lane costs nothing to start. Headless runs on Windows over SSH (not in WSL). |
| Unreal not installed; RealityScan not installed | Both are optional adds, not dependencies. |
| Dialectica active world `recon_4e4245a1f4_aoi130`: 428 cams, 529k-face ODM mesh as **OBJ+MTL, 106 atlas pages** (geo PNG 121 MB / 202 Mpx; derived JPG tiers `vtl` 4.7 MB, `vth`, `vtx` 16.5 MB / 102 Mpx). Viewer OBJ 53 MB raw / 13.9 MB gz. Desktop first load ≈ 30 MB, mobile ≈ 18.6 MB (`scene.js:206-221`). Mesh coverage 72.5% (`mesh_coverage.json`), splat `sh-degree 0` | The heavy part is **geometry bytes and GPU memory** (`vtx` ≈ 540 MB decoded with mips), not download of textures. |
| Web runtime: three r180 + Spark 2.1, no build step; CSP already has `script-src 'self' 'wasm-unsafe-eval'` + `worker-src blob:` (`aerobrain_server.py:89`); only `GLTFLoader` vendored | KTX2/meshopt need only vendoring `KTX2Loader`, basis transcoder, `MeshoptDecoder` — no CSP change. |
| DJI Flip / Neo 2: **no waypoint missions, no MSDK support** (Litchi/Dronelink can't fly them) | Capture quality comes from a disciplined manual protocol, not automation. |
| Splat baseline frozen in `SPLAT_EXPERIMENTS.md` (LPIPS 0.57–0.67, PSNR 11–14) | Every splat change is A/B'd against it with held-out views. |

## 1. Verdict on Unreal Engine

**Parked.** For a $0 web site Unreal only adds value as an offline cinematic renderer: interactive
Unreal on the web needs Pixel Streaming (always-on GPU, ~$0.5–1/h cloud), which conflicts with a
sleeping PC and a $0 budget. On 8 GB VRAM Nanite+Lumen+vegetation is marginal, headless automation
(Movie Render Queue, Python) is brittle across versions, and C: has no room. Blender (already
installed, fully headless) covers cleanup, baking, glTF and cinematics.

Revisit if: the GPU becomes ≥16 GB **and** there is a concrete need (e.g. cinematic trailers
Blender can't reach, or a desktop build of Flightverse). Then: install UE 5.7 on D:, Cesium for
Unreal + 3D Tiles from our own data, MRQ command-line renders.

Sources: RealityScan/Unreal research — dev.epicgames.com/documentation/realityscan,
cesium.com/learn/cesium-unreal, vagon.io/blog/best-pixel-streaming-platforms.

## 2. Workstreams (ordered by gain per effort)

### W1 — Mesh → GLB (meshopt + KTX2) · **highest ROI, no new capture**

What: convert the ODM textured mesh to GLB **keeping the 106 atlas pages and their UVs** (no re-bake:
baking 202 Mpx into one 4K atlas = 12× fewer texels; one 8K = ⅓ and 256 MB decoded).

1. **Prototype with `gltfpack`** (meshoptimizer; reads OBJ): `gltfpack -i geo.obj -o lod0.glb -cc -tc
   -si <ratio>` — UV-seam-aware simplification, meshopt compression, KTX2 textures in one command.
   Blender is used only if cleanup is needed (drop floating components, merge by distance) —
   `blender -b -P pipeline/blender/clean_mesh.py` before gltfpack.
2. Tiers **per device** (one GLB per tier, no distance LOD → no popping): mobile ~120k tris + ETC1S
   textures from `vtl`; desktop ~300k tris + UASTC+Zstd from `vtx`; "extra" = full mesh + UASTC geo.
   Distance-based LOD would need spatial chunking (Obj2Tiles / 3D Tiles) — deferred.
3. **Exact frame**: the GLB must reproduce the OBJ vertex frame (`scene.js:261-264` applies
   `mesh_offset` and `rotation.x = -π/2`; GLB/Blender Y-up conversion must not double-rotate). The
   GLB loader reuses the same unlit `MeshBasicMaterial` + `applyVisualCoverageMask` path. No normal
   maps (material is unlit).
4. Publish `models/<cid>/glb/{mobile,desktop,extra}.glb` + `glb/meta.json` (tris, bytes, source
   fingerprint, params); `scene_manifest.py` capability `glb_mesh`; `scene.js`/`tresd.js` prefer GLB,
   fall back to the OBJ ladder. `collision.bin` stays sourced from the viewer OBJ (fingerprint
   unchanged). Splat alignment is camera-based (`splat_align.py`), unaffected.

Gates (fail closed):
- Frame: GLB bbox + centroid in OBJ frame within 1 cm of source.
- Visual: fixed cameras OBJ vs GLB → SSIM ≥ 0.97 per tier + per-facade sharpness (Laplacian) ≥ 95%.
- Budget: **geometry bytes, GPU texture MB, first-frame time** each ≤ today (baseline ~30 MB desktop /
  18.6 MB mobile download, ~540 MB GPU for `vtx`); target GPU ≤ ¼ via KTX2.
- Live: `browser_matrix --flightverse` desktop + mobile_portrait green, fps not lower.

Expected: geometry 13.9 MB gz → a few MB; GPU texture memory ~4× lower; faster first frame on mobile.
Effort: 3–4 days (gltfpack path) incl. vendoring, loader + fallback, gates.

### W2 — Splat quality on 8 GB (training upgrade)

What: move training to gsplat **MCMC with a Gaussian cap** (1–3M), antialiased rasterization,
bilateral grid / appearance embeddings for exposure drift, SH degree >0 within the cap.
gsplat's own benchmark: MCMC 1M = 2.0 GB, 3M = 5.0 GB, higher PSNR than default at fewer splats.

- **First** record a CUDA baseline on Dialectica with the current preset (held-out views,
  PSNR/SSIM/LPIPS): `SPLAT_EXPERIMENTS.md` is a frozen Mac/OpenSplat baseline on other scenes, not
  comparable. Today `gpu_lane.py` runs `ns-train splatfacto --sh-degree 0 --stop-split-at 15000`.
- Verify the installed nerfstudio/gsplat exposes an MCMC strategy + cap; if not, train with
  gsplat's `simple_trainer.py mcmc` directly (same COLMAP/OpenSfM inputs) in the same lane.
- New preset(s) in `splat_presets.py` (`mcmc1m`, `mcmc3m`), existing presets untouched. Promote
  only if it wins on Dialectica and one rural site, incl. size after SOG.
- Sky: crop by height/bbox (already partly in auto-clean); optional sky mask later.

Effort: 1–2 days + GPU time. Source: docs.gsplat.studio/main/tests/eval.html.

### W3 — Reconstruction A/B: RealityScan vs ODM (same 428 frames)

What: install RealityScan 2.x on the PC (on D:), run it via its CLI on the Dialectica frames, export
mesh + textures + COLMAP; compare to ODM on: mesh coverage measured by `pipeline/mesh_coverage.py` on the same AOI (72.5% today), facade detail
(side renders), and splats trained on RealityScan cameras vs OpenSfM cameras.

- If it wins: `recon_backend = realityscan|odm` in `compute_policy`, ODM kept for ortho/DSM.
- Needs **Daniel**: create/sign in to the Epic account and accept the license (I can't do that).
- Risk: CLI over SSH may need an interactive session / scheduled task on Windows *(unverified)*.

Cheaper parallel experiment (no install): ODM building recipe —
`--pc-quality ultra --feature-quality ultra --mesh-octree-depth 12 --mesh-size 300000
--use-3dmesh --camera-lens brown --use-fixed-camera-params --rolling-shutter` (watch the 23 GB WSL cap).

Effort: 1 day each + processing time.

### W4 — Clean buildings (LoD2 shell + baked facade)

What: for the Dialectica building, produce a clean, low-poly architectural model to use for far LOD,
collision and "clean look" mode, while the photogrammetry mesh stays for near views.

1. Footprint: segment the building from DSM − DTM (height > 2.5 m, connected region) + ortho edges;
   OSM footprint as fallback where available.
2. Shell: **Roofer** (3DBAG, GPLv3, CLI) from point cloud + footprint → LoD2 roof/walls; fallback
   LoD1 extrusion to DSM height.
3. Texture: Cycles bake "selected to active" from the textured ODM mesh onto the clean shell (much
   simpler than per-face camera projection); where the ODM mesh has holes, fall back to the
   best-facing drone photo projection (later).
4. Output `models/<cid>/buildings/<id>.glb`; collision via the existing hook — `collision_bake.py` already prefers an aligned `collision.collision.glb` when present.

Effort: ~1 week for a prototype (Roofer input format prep included). Sources: github.com/3DBAG/roofer, innovation.3dbag.nl/roofer.

### W5 — Living terrain (vegetation + props)

What: vegetation mask from the ortho (ExG greenness + DSM height class: grass / shrub / tree) →
instance points JSON (`models/<cid>/scatter.json`) → three.js `InstancedMesh` with CC0 low-poly
assets (Quaternius / Poly Haven), density capped by device tier. Existing trees in the photogrammetry
mesh stay; scatter only fills bare DSM-only terrain and the out-of-coverage ring.
Later: bespoke props via Hunyuan3D-2mini (~5 GB, fits 8 GB; Tencent Community License — check
territory terms) through the W1 decimate/bake path.

Effort: 2–3 days.

### W6 — Capture protocol (biggest long-term quality lever)

Manual protocol for Flip / Neo 2, documented in [`docs/CAPTURE_PROTOCOL.md`](CAPTURE_PROTOCOL.md) and shown as a checklist
in the upload flow:
- **Stills, not video**, for mesh sites (Timed Shot 2–3 s); fixed shutter ≥1/500, ISO and WB locked.
- Nadir lawnmower at 40–60 m (gimbal −90°) + oblique orbits at 3 heights (−25°, −45°, −60°),
  ~10–15° yaw between shots, 10–20 m standoff; facade strips at 0° where safe.
- 150–300 photos per building. Video only for splats, with sharpness-based frame selection.
- 3–4 GCPs or a measured scale bar for true scale; `--gcp` in ODM / `model_aligner` for splats.
- Neo 2's ~120° lens: use `--camera-lens brown` (ODM) / OPENCV model (COLMAP).

### W7 — AI agent loop (parameter tuning, not free-form modeling)

Principle: deterministic scripts do the work; an LLM only **tunes parameters and fixes errors** in a
bounded loop (≤8 iterations): run `blender -b -P` → render fixed cameras → numeric checks
(tris, holes, bbox drift, SigLIP similarity to drone photos) → model proposes a param diff → repeat.
No MCP in production (arbitrary code exec); Blender Lab MCP only for interactive sessions.

Model routing (automation never uses Claude Max OAuth):
| Use | Model | Approx. cost/building |
|---|---|---|
| Default automation | Codex CLI `codex exec --image` with **GPT-6.1 Sol** (ChatGPT plan) | plan quota |
| Cheap bulk / OpenRouter key | GPT-6 Luna, or DeepSeek V4 Pro (code) + Gemini 3.8 Flash (vision) | ~$0.05–0.20 |
| Hard cases | GPT-6 Astra | ~$4.50 |
| Interactive design/review | Claude (this session) | — |

OpenRouter key read through `pipeline/keys.py` (never committed). Prices from OpenAI's pricing page
and third-party snippets — verify on openrouter.ai before budgeting. Benchmark reference: 3DCodeBench
(arXiv 2606.01057): error-feedback loops lift executability 70%→97%; SigLIP-2 similarity tracks
human preference (r≈0.96).

## 3. Sequencing

| Phase | Work | Gate to advance |
|---|---|---|
| **A (week 1–2)** | W1 GLB (Mac, no GPU) · W2 baseline + MCMC A/B (PC GPU) · W6 protocol doc | GLB live behind fallback, all W1 gates green; MCMC verdict vs CUDA baseline |
| **B (week 2–3)** | W3 RealityScan/ODM-recipe A/B · W5 scatter | Winner raises `mesh_coverage.py` coverage by ≥10 pts with no facade regression; scatter keeps 60 fps mobile |
| **C (weeks 3–4)** | W4 clean building · W7 tuning loop over W1/W4 params | Building GLB + collision gate; loop cost logged per run |
| **D (next capture)** | Re-fly Dialectica with W6 protocol → full pipeline | Before/after report (metrics + renders) |

Parallelism: W1, W2, W6 touch disjoint files (glb pipeline + web loaders / splat presets / docs) and
W1 runs on the Mac (gltfpack/Blender 5.2.2 there), so they can run as parallel agents. Everything that
uses the PC GPU (W2 training, W3 reconstruction, any Cycles bake) **serializes on the single 8 GB GPU lane**.

## 4. Decisions for Daniel

1. **RealityScan**: create/sign in to the Epic account on the PC and accept the license (W3).
2. **Model/plan for automation**: Codex (ChatGPT plan, GPT-6.1 Sol) as default, OpenRouter key as
   fallback — confirm the key is in the keys env file.
3. **Re-fly Dialectica** with the W6 protocol when convenient (the biggest quality jump overall).
4. **GPU**: a 16 GB card would unlock MILo meshes, splatfacto-big and a real Unreal option —
   only worth it after A–C prove the pipeline.

## 5. Explicitly not doing (now)

Unreal runtime / Pixel Streaming · MCP servers in automation · TRELLIS.2 (24 GB) / MILo (≥10 GB)
on this GPU · replacing three.js · hand-modeled assets.

## W3 results — RealityScan blocked; ODM "building recipe" A/B (2026-09-30)

**RealityScan: not possible on this PC.** The CPU is an Intel i7-3770S (Ivy Bridge, AVX but **no AVX2**); RealityScan 2.x
exits with "required instruction set AVX2 is not supported". Hardware limit, nothing to install or sign in. It would need a
newer CPU (the GPU is fine). The Epic launcher also had no RealityScan installed at the time (only UE 5.8).

**Fallback experiment: ODM building recipe on the same 428 frames** (3072x1728, the parent `proj_recon_4e4245a1f4` images),
PC CUDA lane, experiment workdir `/root/gpu-jobs/experiments/w3-odm/` (removed afterwards), production untouched.
Recipe: `--pc-quality ultra --feature-quality ultra --mesh-octree-depth 12 --mesh-size 300000 --use-3dmesh --camera-lens brown
--use-fixed-camera-params --rolling-shutter --pc-skip-geometric --orthophoto-resolution 2 --dem-resolution 4` (+ `--max-concurrency 8
--dsm --dtm --skip-report`, 20 GB container cap, as `odm_gpu_lane.remote_run_argv`).

Run log (what actually happened):
1. SfM (feature-quality ultra, rolling-shutter two-pass): ~100 min (production medium-quality run: 28 min). 428/428 cameras, 391,939
   sparse points (production: 208,922). `--rolling-shutter` made ODM run match/reconstruct twice and was a no-op: every shot logged
   "Cannot compute velocity (delta time 0)" because the extracted video frames carry no per-frame capture time. Pure cost.
2. `--pc-quality ultra`: DensifyPointCloud stalled at depth-map 317/428 for 40+ min (container 18-19 GiB of 20, IO pressure ~86%, WSL
   commands hanging). Killed after 145 min wall. Peak VRAM 1.6 GB (OpenMVS runs `--cuda-device -1`; the GPU is used mainly for SIFT).
3. `--pc-quality high`: OOM-killed at depth-map fusion 95% (20 GiB cap), ODM retried with tiling and **segfaulted (exit 139,
   "strange values")**. 37 min lost.
4. `--pc-quality medium` (= what production actually ran for this scene): completed, octree 12 did **not** crash here.
   Stages: openmvs 966 s, meshing 337 s, texturing 288 s, georef 108 s, DEM 165 s, ortho 46 s; 34 min for this leg. VRAM < 2 GB, container RAM peak 6.7 GB.
5. Ablation: re-mesh the same cloud with production mesh settings (octree 11, mesh-size 600k): meshing 100 s, texturing 476 s.

| mesh (same 428 frames, AOI = recon_4e4245a1f4_aoi130 grid) | tris | mesh_coverage (AOI) | cameras | sparse pts |
|---|---|---|---|---|
| production aoi130 (published) | 529k | **72.53 %** (reproduced exactly by `w3_coverage.py`) | 428/428 | 208,922 |
| production parent mesh, uncropped (600k target) | 812k | 79.74 % | 428/428 | 208,922 |
| recipe (ultra SfM, octree 12, 300k) | 282k | 54.50 % (only-ODM cells 22.0 %, only-recipe 4.0 %) | 428/428 | 391,939 |
| ablation: same ultra SfM, octree 11, 600k | 702k | 55.91 % (only-ODM 21.5 %) | 428/428 | 391,939 |

Facade renders (Blender Workbench, flat textured, 5 fixed viewpoints incl. tower b01 and b02; side-by-sides in
`sxs_recipe/` and `sxs_oct11/`): **the recipe is visibly worse**. The production tower has straight mullions and clean slabs; both
recipe meshes have sheared/wavy facades, collapsed or noisy b02 wall (window grid broken, roofs melted into walls), floating junk above
the tower and ragged vegetation. The ablation shows the mesh parameters are not the cause (55.9 % vs 54.5 %); the damage is upstream, in
the cloud/SfM geometry of the ultra+brown+fixed-params+rolling-shutter run. I did not isolate which flag is responsible (one run is
~100 min); `--rolling-shutter` and `--use-fixed-camera-params` are the prime suspects and the first things to drop.

**Verdict: do not adopt the recipe (as a building preset or otherwise); keep the current ODM settings.** It is worse on coverage
(-17 to -18 pts), worse on facades, ~4x slower in SfM, and `pc-quality ultra/high` do not fit the 20 GB WSL cap on this scene. Not
evaluated: splats trained on the new cameras (pointless given geometry). Side finding: the uncropped parent mesh covers the AOI
better (79.7 %) than the published aoi130 mesh (72.5 %); the AOI re-crop pipeline loses ~7 pts of coverage and is a cheaper lever than
any recon change (not investigated). RealityScan remains unevaluated until a CPU with AVX2 is available.

Artifacts: `/Volumes/SSD/drone-vault/experiments/w3-realityscan-2026-09-30/` (`scripts/` w3_coverage.py, w3_render.py, w3_montage.py,
w3_cameras.py, w3_odm_run.sh, w3_sampler.sh; `odm_renders/`, `recipe_renders/`, `oct11_renders/`, `sxs_*`; `odm_exp/` logs, samples,
coverage JSON/PNG, and the recipe + oct11 textured meshes). Frame: `w3_coverage.py --frame odm-geo` (x=X+22.98, y=Z-2586.79, z=-(Y+47.44)).
