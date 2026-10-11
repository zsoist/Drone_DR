# World upgrade plan: Blender, reconstruction, AI agents (2026-09-29)

Goal: make the worlds and models from drone captures (Dialectica first) look and run far better.
The aims are clean buildings, no holes, light assets and richer terrain.
The tools must be automatic and must cost $0 at runtime.

Inputs: 5 parallel research agents (inventory, Blender, Unreal/RealityScan, AI agents/models, capture/reconstruction).
After that, an independent review of the code gave 12 corrections.
This plan includes all 12 corrections (texture counts, no re-bake, CSP already wasm-ready, gltfpack-first, exact mesh frame, CUDA baseline).
Each section lists its sources.
Items marked *(unverified)* came from secondary sources.

## 0. Facts that shape the plan

| Fact | Consequence |
|---|---|
| PC GPU = RTX 4060 Ti **8 GB** (8188 MiB), 34 GB RAM, WSL capped at 23 GB | The GPU fits MCMC splats, Cycles bakes and RealityScan. It is too small for MILo, splatfacto-big and Unreal Nanite+Lumen. |
| PC C: has 46 GB free (94% used); D: 267 GB free (HDD); WSL ext4 919 GB free | Install and write all new data on D: or in WSL. Never use C:. |
| Blender 5.2 LTS is already installed: PC (`C:\Program Files\Blender Foundation\Blender 5.2`) and Mac (5.2.2) | The Blender lane costs nothing to start. Headless runs happen on Windows over SSH (not in WSL). |
| Unreal is not installed; RealityScan is not installed | Both are optional additions, not dependencies. |
| Dialectica active world `recon_4e4245a1f4_aoi130`: 428 cams, 529k-face ODM mesh as **OBJ+MTL, 106 atlas pages** (geo PNG 121 MB / 202 Mpx; derived JPG tiers `vtl` 4.7 MB, `vth`, `vtx` 16.5 MB / 102 Mpx). Viewer OBJ 53 MB raw / 13.9 MB gz. Desktop first load is about 30 MB, mobile is about 18.6 MB (`scene.js:206-221`). Mesh coverage 72.5% (`mesh_coverage.json`), splat `sh-degree 0` | The heavy part is **geometry bytes and GPU memory** (`vtx` is about 540 MB decoded with mips). The download of textures is not the heavy part. |
| Web runtime: three r180 + Spark 2.1, no build step. The CSP already has `script-src 'self' 'wasm-unsafe-eval'` + `worker-src blob:` (`aerobrain_server.py:89`). Only `GLTFLoader` is vendored | KTX2 and meshopt need only these vendored files: `KTX2Loader`, the basis transcoder and `MeshoptDecoder`. No CSP change is necessary. |
| DJI Flip / Neo 2: **no waypoint missions, no MSDK support** (Litchi and Dronelink cannot fly them) | Capture quality comes from a disciplined manual protocol, not from automation. |
| Splat baseline frozen in `SPLAT_EXPERIMENTS.md` (LPIPS 0.57–0.67, PSNR 11–14) | Test every splat change against this baseline (A/B) with held-out views. |

## 1. Verdict on Unreal Engine

**Parked.** For a $0 web site, Unreal adds value only as an offline cinematic renderer.
Interactive Unreal on the web needs Pixel Streaming.
Pixel Streaming needs an always-on GPU that costs about $0.5–1/h in the cloud.
This conflicts with a PC that goes to sleep and with a $0 budget.

There are more reasons:
- On 8 GB VRAM, Nanite+Lumen+vegetation is marginal.
- Headless automation (Movie Render Queue, Python) is brittle across versions.
- C: has no room.

The PC and the Mac already have Blender, and it runs fully headless.
Blender can clean meshes, bake textures, export glTF and render cinematics.

Revisit this verdict if both of these conditions are true:
- The GPU has at least 16 GB.
- There is a concrete need. For example, cinematic trailers that Blender cannot make, or a desktop build of Flightverse.

In that case, do these steps:
- Install UE 5.7 on D:.
- Use Cesium for Unreal with 3D Tiles from our own data.
- Make command-line renders with MRQ (Movie Render Queue).

Sources for the RealityScan and Unreal research: dev.epicgames.com/documentation/realityscan,
cesium.com/learn/cesium-unreal, vagon.io/blog/best-pixel-streaming-platforms.

## 2. Workstreams (ordered by gain per effort)

### W1: Mesh to GLB (meshopt and KTX2): highest ROI, no new capture

What: convert the ODM textured mesh to GLB and **keep the 106 atlas pages and their UVs** (no re-bake).
A bake of 202 Mpx into one 4K atlas gives 12 times fewer texels.
One 8K atlas gives one third of the texels and needs 256 MB when decoded.

1. **Prototype with `gltfpack`** (meshoptimizer, reads OBJ).
   Use this command: `gltfpack -i geo.obj -o lod0.glb -cc -tc
   -si <ratio>`.
   This one command does UV-seam-aware simplification, meshopt compression and KTX2 textures.
   If the mesh needs cleanup, use Blender before gltfpack.
   The cleanup drops the components that float and merges vertices by distance.
   Run `blender -b -P pipeline/blender/clean_mesh.py` for this cleanup.
2. Make the tiers **for each device**.
   Make one GLB for each tier.
   Do not use distance LOD, so the mesh has no sudden changes of detail.
   - mobile: about 120k tris and ETC1S textures from `vtl`
   - desktop: about 300k tris and UASTC+Zstd from `vtx`
   - "extra": full mesh and UASTC geo

   Distance-based LOD needs a split of the mesh into spatial chunks (Obj2Tiles / 3D Tiles).
   The team deferred this work.
3. **Exact frame**: the GLB must have the same vertex frame as the OBJ.
   `scene.js:261-264` applies `mesh_offset` and `rotation.x = -π/2`.
   The GLB or Blender Y-up conversion must not rotate the mesh twice.
   The GLB loader uses the same unlit `MeshBasicMaterial` and the same `applyVisualCoverageMask` path as the OBJ loader.
   There are no normal maps, because the material is unlit.
4. Publish `models/<cid>/glb/{mobile,desktop,extra}.glb` and `glb/meta.json` (tris, bytes, source fingerprint, params).
   Add the capability `glb_mesh` to `scene_manifest.py`.
   `scene.js` and `tresd.js` prefer the GLB.
   If no GLB exists, they use the OBJ ladder instead.
   `collision.bin` stays sourced from the viewer OBJ (the fingerprint does not change).
   The splat alignment uses cameras (`splat_align.py`), so the GLB does not change it.

Gates (fail closed):
- Frame: the GLB bbox and centroid in the OBJ frame are within 1 cm of the source.
- Visual: with fixed cameras, OBJ against GLB gives SSIM of at least 0.97 per tier.
  The sharpness (Laplacian) of each facade is at least 95%.
- Budget: **geometry bytes, GPU texture MB and first-frame time** must each be at or below today's value.
  The baseline is about 30 MB desktop / 18.6 MB mobile download and about 540 MB GPU for `vtx`.
  The target for the GPU is at most one quarter of today's value, through KTX2.
- Live: `browser_matrix --flightverse` desktop and mobile_portrait are green, and fps is not lower.

Expected: geometry goes from 13.9 MB gz to a few MB.
GPU texture memory is about 4 times lower.
The first frame is faster on mobile.
Effort: 3–4 days (gltfpack path).
This includes the vendored libraries, the loader, the fallback and the gates.

### W2: Splat quality on 8 GB (training upgrade)

What: move the training to gsplat **MCMC with a Gaussian cap** (1–3M).
Also use antialiased rasterization.
Use a bilateral grid or appearance embeddings for exposure drift.
Use SH degree above 0 within the cap.
The own benchmark of gsplat shows these results:
- MCMC with 1M splats uses 2.0 GB.
- MCMC with 3M splats uses 5.0 GB.
- PSNR is higher than the default strategy, with fewer splats.

- **First**, record a CUDA baseline on Dialectica with the current preset (held-out views, PSNR/SSIM/LPIPS).
  `SPLAT_EXPERIMENTS.md` is a frozen Mac/OpenSplat baseline on other scenes, so it is not comparable.
  Today, `gpu_lane.py` runs this command: `ns-train splatfacto --sh-degree 0 --stop-split-at 15000`.
- Check that the installed nerfstudio and gsplat have an MCMC strategy with a cap.
  If they do not, train with `simple_trainer.py mcmc` of gsplat directly (same COLMAP/OpenSfM inputs) in the same lane.
- Add new presets to `splat_presets.py` (`mcmc1m`, `mcmc3m`).
  Do not change the presets that exist.
  If a preset wins on Dialectica and on one rural site, promote it.
  Include the size after SOG in the comparison.
- Sky: crop by height or bbox (auto-clean already does part of this). A sky mask is optional for later.

Effort: 1–2 days and GPU time. Source: docs.gsplat.studio/main/tests/eval.html.

### W3: Reconstruction A/B: RealityScan against ODM (same 428 frames)

What: install RealityScan 2.x on the PC (on D:).
Run it through its CLI on the Dialectica frames.
Export mesh, textures and COLMAP.
Compare it with ODM on these points:
- the mesh coverage on the same AOI, measured by `pipeline/mesh_coverage.py` (72.5% today)
- the facade detail (side renders)
- splats trained on RealityScan cameras, compared with splats trained on OpenSfM cameras

Then:
- If RealityScan wins, set `recon_backend = realityscan|odm` in `compute_policy`. Keep ODM for ortho and DSM.
- Needs **Daniel**: create or sign in to the Epic account and accept the license. The agent cannot do that.
- Risk: the CLI over SSH can need an interactive session or a scheduled task on Windows *(unverified)*.

Cheaper parallel experiment (no install): the ODM building recipe.
The recipe is
`--pc-quality ultra --feature-quality ultra --mesh-octree-depth 12 --mesh-size 300000
--use-3dmesh --camera-lens brown --use-fixed-camera-params --rolling-shutter`.
Watch the 23 GB WSL cap.

Effort: 1 day each, and the time to process the data.

### W4: Clean buildings (LoD2 shell and baked facade)

What: for the Dialectica building, make a clean, low-poly architectural model.
Use it for far LOD, for collision and for a "clean look" mode.
The photogrammetry mesh stays for near views.

1. Footprint: segment the building from DSM minus DTM (height above 2.5 m, connected region) and ortho edges.
   Use the OSM footprint as a fallback where it exists.
2. Shell: use **Roofer** (3DBAG, GPLv3, CLI) with the point cloud and the footprint to make the LoD2 roof and walls.
   As a fallback, extrude to the DSM height (LoD1).
3. Texture: use a Cycles bake of type "selected to active" from the textured ODM mesh onto the clean shell.
   This is much simpler than a camera projection for each face.
   Where the ODM mesh has holes, use a projection of the best-facing drone photo (later).
4. Output `models/<cid>/buildings/<id>.glb`.
   For collision, use the hook that exists.
   `collision_bake.py` already prefers an aligned `collision.collision.glb` when one exists.

Effort: about 1 week for a prototype (includes the preparation of the Roofer input format).
Sources: github.com/3DBAG/roofer, innovation.3dbag.nl/roofer.

### W5: Living terrain (vegetation and props)

What: make a vegetation mask from the ortho (ExG greenness and DSM height class: grass / shrub / tree).
Then make instance points in JSON (`models/<cid>/scatter.json`).
Then use a three.js `InstancedMesh` with CC0 low-poly assets (Quaternius / Poly Haven).
The device tier sets a cap on the density.

The trees that exist in the photogrammetry mesh stay.
The scatter fills only the bare terrain that has DSM data only, and the ring outside the coverage.

Later: make bespoke props with Hunyuan3D-2mini (about 5 GB, fits 8 GB).
Its license is the Tencent Community License.
Check the territory terms.
Use the W1 decimate and bake path.

Effort: 2–3 days.

### W6: Capture protocol (biggest long-term quality lever)

This is a manual protocol for Flip / Neo 2.
It is in [`docs/CAPTURE_PROTOCOL.md`](CAPTURE_PROTOCOL.md).
The upload flow shows it as a checklist:
- **Stills, not video**, for mesh sites (Timed Shot 2–3 s). Use a fixed shutter of 1/500 or faster. Lock ISO and WB.
- Nadir lawnmower at 40–60 m (gimbal −90°) and oblique orbits at 3 heights (−25°, −45°, −60°).
  Turn the yaw by about 10–15° between shots. Use a standoff of 10–20 m. Fly facade strips at 0° where it is safe.
- Take 150–300 photos for each building. Use video only for splats, with frame selection by sharpness.
- Use 3–4 GCPs or a measured scale bar to get true scale. Use `--gcp` in ODM or `model_aligner` for splats.
- Neo 2 has a lens of about 120°. Use `--camera-lens brown` (ODM) or the OPENCV model (COLMAP).

### W7: AI agent loop (parameter tuning, not free-form modeling)

Principle: deterministic scripts do the work.
An LLM only **tunes parameters and fixes errors** in a bounded loop (at most 8 iterations):
1. Run `blender -b -P`.
2. Render fixed cameras.
3. Do numeric checks (tris, holes, bbox drift, SigLIP similarity to drone photos).
4. The model proposes a param diff.
5. Repeat.

Do not use MCP in production, because it runs arbitrary code.
Use Blender Lab MCP only in interactive sessions.

Model routing (automation never uses Claude Max OAuth):
| Use | Model | Cost per building (about) |
|---|---|---|
| Default automation | Codex CLI `codex exec --image` with **GPT-6.1 Sol** (ChatGPT plan) | plan quota |
| Cheap bulk / OpenRouter key | GPT-6 Luna, or DeepSeek V4 Pro (code) + Gemini 3.8 Flash (vision) | $0.05–0.20 |
| Hard cases | GPT-6 Astra | $4.50 |
| Interactive design/review | Claude (this session) | — |

The script `pipeline/keys.py` reads the OpenRouter key. The key is never in a commit.

The prices come from the pricing page of OpenAI and from third-party snippets.
Check them on openrouter.ai before you make a budget.
Benchmark reference: 3DCodeBench (arXiv 2606.01057).
Loops with error feedback raise the executability from 70% to 97%.
Human preference follows SigLIP-2 similarity (r is about 0.96).

## 3. Sequencing

| Phase | Work | Gate to advance |
|---|---|---|
| **A (week 1–2)** | W1 GLB (Mac, no GPU) · W2 baseline + MCMC A/B (PC GPU) · W6 protocol doc | The GLB is live behind a fallback and all W1 gates are green. The MCMC verdict against the CUDA baseline is ready. |
| **B (week 2–3)** | W3 RealityScan/ODM-recipe A/B · W5 scatter | The winner raises the `mesh_coverage.py` coverage by at least 10 pts with no facade regression. The scatter keeps 60 fps on mobile. |
| **C (weeks 3–4)** | W4 clean building · W7 tuning loop over W1/W4 params | The building GLB and the collision gate pass. The cost of the loop is logged for each run. |
| **D (next capture)** | Re-fly Dialectica with the W6 protocol, then run the full pipeline | Before/after report (metrics and renders) |

Parallelism: W1, W2 and W6 touch different files (the glb pipeline and web loaders / splat presets / docs).
W1 runs on the Mac (gltfpack and Blender 5.2.2 are there).
So these three workstreams can run as parallel agents.
Everything that uses the PC GPU **runs one job at a time on the single 8 GB GPU lane**.
This includes W2 training, W3 reconstruction and any Cycles bake.

## 4. Decisions for Daniel

1. **RealityScan**: create or sign in to the Epic account on the PC and accept the license (W3).
2. **Model and plan for automation**: Codex (ChatGPT plan, GPT-6.1 Sol) is the default and an OpenRouter key is the fallback.
   Make sure the key is in the keys env file.
3. **Re-fly Dialectica** with the W6 protocol when it is convenient. It is the biggest jump in quality overall.
4. **GPU**: a card with 16 GB allows meshes from MILo, splatfacto-big and a real Unreal option.
   Buy it only after phases A to C prove the pipeline.

## 5. Explicitly not doing (now)

- Unreal runtime / Pixel Streaming
- MCP servers in automation
- TRELLIS.2 (24 GB) and MILo (at least 10 GB) on this GPU
- A replacement of three.js
- Hand-modeled assets

## W3 results: RealityScan blocked; ODM "building recipe" A/B (2026-09-30)

**RealityScan: not possible on this PC.**
The CPU is an Intel i7-3770S (Ivy Bridge).
It has AVX but **no AVX2**.
RealityScan 2.x exits with `required instruction set AVX2 is not supported`.

This is a hardware limit. There is nothing to install or to sign in to.
RealityScan needs a newer CPU (the GPU is fine).
The Epic launcher also had no RealityScan at the time (only UE 5.8).

**Fallback experiment: ODM building recipe on the same 428 frames** (3072x1728, the parent `proj_recon_4e4245a1f4` images).
The experiment ran on the PC CUDA lane.
The experiment workdir was `/root/gpu-jobs/experiments/w3-odm/` (removed afterwards).
The experiment did not touch production.
The recipe:
`--pc-quality ultra --feature-quality ultra --mesh-octree-depth 12 --mesh-size 300000 --use-3dmesh --camera-lens brown
--use-fixed-camera-params --rolling-shutter --pc-skip-geometric --orthophoto-resolution 2 --dem-resolution 4`
The run also used `--max-concurrency 8
--dsm --dtm --skip-report` and a 20 GB container cap, as in `odm_gpu_lane.remote_run_argv`.

Run log:
1. SfM (feature-quality ultra, rolling-shutter two-pass) took about 100 min (production medium-quality run: 28 min).
   The result was 428/428 cameras and 391,939 sparse points (production: 208,922).
   With `--rolling-shutter`, ODM ran the match and reconstruct stages twice. It had no effect.
   Every shot logged `Cannot compute velocity (delta time 0)`, because the extracted video frames have no per-frame capture time.
   It was a pure cost.
2. `--pc-quality ultra`: DensifyPointCloud stalled at depth-map 317/428 for more than 40 min.
   The container used 18-19 GiB of 20, IO pressure was about 86% and WSL commands hung.
   I killed it after 145 min wall time.
   Peak VRAM was 1.6 GB.
   OpenMVS runs `--cuda-device -1`, so the GPU is mainly for SIFT.
3. `--pc-quality high`: the OOM killer stopped it at depth-map fusion 95% (20 GiB cap).
   ODM retried with tiles and then **segfaulted (exit 139, `strange values`)**.
   The run lost 37 min.
4. `--pc-quality medium` (this is what production ran for this scene) completed.
   Octree 12 did **not** crash here.
   Stages: openmvs 966 s, meshing 337 s, texturing 288 s, georef 108 s, DEM 165 s, ortho 46 s.
   This leg took 34 min. VRAM stayed below 2 GB. The container RAM peak was 6.7 GB.
5. Ablation: re-mesh the same cloud with the production mesh settings (octree 11, mesh-size 600k).
   Meshing took 100 s and texturing took 476 s.

| mesh (same 428 frames, AOI = recon_4e4245a1f4_aoi130 grid) | tris | mesh_coverage (AOI) | cameras | sparse pts |
|---|---|---|---|---|
| production aoi130 (published) | 529k | **72.53 %** (reproduced exactly by `w3_coverage.py`) | 428/428 | 208,922 |
| production parent mesh, uncropped (600k target) | 812k | 79.74 % | 428/428 | 208,922 |
| recipe (ultra SfM, octree 12, 300k) | 282k | 54.50 % (only-ODM cells 22.0 %, only-recipe 4.0 %) | 428/428 | 391,939 |
| ablation: same ultra SfM, octree 11, 600k | 702k | 55.91 % (only-ODM 21.5 %) | 428/428 | 391,939 |

Facade renders (Blender Workbench, flat textured, 5 fixed viewpoints with tower b01 and b02): **the recipe is visibly worse**.
Side-by-side images are in `sxs_recipe/` and `sxs_oct11/`.
The production tower has straight mullions and clean slabs.
Both recipe meshes show sheared and wavy facades.
The b02 wall collapsed or shows noise: the window grid is broken and the roofs melted into the walls.
Junk floats above the tower, and the edges of the vegetation are ragged.

The ablation shows that the mesh parameters are not the cause (55.9 % compared with 54.5 %).
The damage is upstream, in the cloud and SfM geometry of the run with ultra, brown, fixed-params and rolling-shutter.
I did not find which flag is responsible (one run takes about 100 min).
`--rolling-shutter` and `--use-fixed-camera-params` are the main suspects.
Drop them first.

**Verdict: do not adopt the recipe (as a building preset or in any other form). Keep the current ODM settings.**
The recipe is worse on coverage (-17 to -18 pts) and worse on facades.
It is about 4 times slower in SfM.
The settings `pc-quality ultra/high` do not fit the 20 GB WSL cap on this scene.
The test did not evaluate splats trained on the new cameras, because the geometry is bad.

Side result: the parent mesh without crop covers the AOI better (79.7 %) than the published aoi130 mesh (72.5 %).
The AOI re-crop step of the pipeline loses about 7 pts of coverage.
This is a cheaper lever than any recon change (not investigated).
RealityScan stays unevaluated until a CPU with AVX2 is available.

Artifacts are in `/Volumes/SSD/drone-vault/experiments/w3-realityscan-2026-09-30/`:
- `scripts/`: `w3_coverage.py`, `w3_render.py`, `w3_montage.py`, `w3_cameras.py`, `w3_odm_run.sh`, `w3_sampler.sh`
- `odm_renders/`, `recipe_renders/`, `oct11_renders/`, `sxs_*`
- `odm_exp/`: logs, samples, coverage JSON/PNG, and the recipe and oct11 textured meshes

Frame: `w3_coverage.py --frame odm-geo` (x=X+22.98, y=Z-2586.79, z=-(Y+47.44)).
