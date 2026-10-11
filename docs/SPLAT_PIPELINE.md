# SPLAT_PIPELINE: trainer and stable policy (audit 2026-07-14, reorganized 2026-09-28)

> Current contract. The **production path** is CUDA on the RTX PC.
> Since 2026-09-28 the default policy is **PC-only** (`pipeline/compute_policy.py`).
>
> All OpenSplat, MPS and Metal content is in the appendix, [Legacy Mac path](#legacy-mac-path-opensplat--mps).
> That content applies only with `AEROBRAIN_COMPUTE=local`.
>
> General architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Procedures: [RUNBOOKS.md](RUNBOOKS.md).

## Production path (CUDA)

| Item | Detail |
|---|---|
| Trainer | `nerfstudio` splatfacto + gsplat 1.4 (CUDA 12.4) in WSL2 Ubuntu on the PC, RTX 4060 Ti 8 GB |
| Lane | `pipeline/gpu_lane.py` (SSH `pc`, WoL, held SSH session). ODM runs in `pipeline/odm_gpu_lane.py` |
| Tiers | Fast 1K and Medium 2K also run on CUDA under PC-only. Cinematic 7K to Grandmaster 40K run only on CUDA |
| Authority | The Mac publishes. The PC is a disposable accelerator. Scratch retention: `pipeline/pc_janitor.py` |
| Auxiliary queue | `com.macmini.pc-queue` (LaunchAgent, 120 s) drains JSON from `~/.local/pc-jobs/queue/` to the PC. It is a generic queue. It is not part of this lane |


## Presets (`pipeline/splat_presets.py`, single source of truth)

| Preset | iters | train_args |
|---|---|---|
| fast | 1000 | — |
| medium | 2000 | — |
| cinematic | 7000 | CUDA strict · photo-real, shareable |
| ultra | 15000 | CUDA strict · full growth |
| ultra20 | 20000 | CUDA strict · refinement after densification |
| frontier | 30000 | CUDA strict · full schedule (interactive default until 2026-09-30) |
| grandmaster | 40000 | CUDA strict · maximum campaign |
| **mcmc1m** (`Equilibrado (MCMC 1M)`) | 15000 | **interactive default since 2026-09-30** (`DEFAULT_SPLAT_PRESET`): splatfacto + MCMC, cap of 1M gaussians. It won on PSNR, LPIPS and SOG in Dialectica (W2) and in one rural scene (W2b). `select_only` |
| mcmc3m (`Calidad (MCMC 3M)`) | 15000 | Cap of 3M. Best quality in Dialectica, but the SOG is larger. In the rural scene it crashed two times on 8 GB (W2b). `select_only` |

`Equilibrado (MCMC 1M)` and `Calidad (MCMC 3M)` are the product labels that the web app shows.
They mean "Balanced (MCMC 1M)" and "Quality (MCMC 3M)".

`mcmc1m` is only the preset that the UI selects first (`default: true` in `/api/splat_profiles`).
A request with only `iters`, or a request with no preset, resolves as before (`select_only`).
The splats that exist now do not change.

Fast and Medium accept Metal/CPU (only with `AEROBRAIN_COMPUTE=local`, legacy) or CUDA.
Under PC-only they go to CUDA.
The other presets accept only CUDA.
On CUDA, `auto` uses `d1` and goes to `d2` only after a classified OOM.
In short: `full = d1` and `half = d2`.

The system never changes Ultra to Medium on its own.
It never changes CUDA to Mac on its own.

The sidecar keeps these values:

- the requested preset and the effective preset
- the resolution
- the tries
- the GPU and the driver
- the duration
- the number of gaussians
- the parameters
- the hash

The legacy `custom` requests keep Metal/CPU only between 500 and 2,000 iterations, inside the local Fast/Medium envelope.
Any custom request above 2,000 iterations is CUDA strict.
If the request gives no backend, the system selects CUDA.
The system rejects a request for Metal/CPU before it enqueues the job.

## Mac and PC

The path of a job is `UI → Mac API → SQLite → Mac worker → SSH/WSL → RTX → PLY → Mac → .splat/SOG → gate`.
The system first copies the dataset to WSL ext4. NTFS is only a bridge.
After the system gets the PLY and checks it, it cleans the remote temporary folders.
The Mac keeps the ODM poses, the request, the metadata, and current/history.
Only the Mac can publish.

The campaign `/api/splat_campaign` does these steps:

1. It does a dry run on active sites and loose models.
2. It checks the environment and the disk.
3. It estimates the queue time.
4. It enqueues all jobs or none.

The legacy OpenSplat path has no absolute cap on gaussians.
Flags limit the densification budget (see the appendix).

## Training data: how the trainer uses the ODM project

- The trainer reads `opensfm/reconstruction.json` and **iterates over ALL shots**
  (`opensfm.cpp:75-126`). `image_list.txt` is only a map from filename to path.
- So a manifest cannot make a train/test split.
  To make a split, remove shots from a **copy** of `reconstruction.json`
  (surgery, never on the original).
- The pose of each shot has `rotation` (axis-angle), `translation` and a Brown camera.
  These values are enough to render held-out views.

## Artifact life cycle

```
train → splats/.training/<job>/<cid>.splat
  → quality gate (splat_quality: convergence + size + cameras)
  → publish_splat_stage: archives the previous version to splats/history/ (keep=6)
  → splats/<cid>.splat + <cid>.meta.json (sidecar)
  → crop_floaters (de-halo) → compressed SOG with splat-transform
  → Spark loads sog > spz > legacy ksplat > source splat > ply
```

**Retention**: the ODM project (`images/` + `opensfm/`) SURVIVES the training run.
The system deletes only the stage.
A retroactive eval is possible, but it has a trap.
The splats that exist now trained with ALL views.
So any eval on them is *train-view reproduction*, not held-out.
For an honest baseline, train again with a split.

## Run sidecar (`splats/<cid>.meta.json`): seed schema of `splat_runs[]`

```json
{"passed", "reason", "bytes", "cameras", "final_loss", "last_step",
 "steps_logged", "target_iters", "preset", "requested_preset", "effective_preset",
 "input_scale", "fallback", "attempts", "preset_label", "backend",
 "backend_note", "duration_s",
 "peak_mib",       // ← new 2026-07-11: phys_footprint_peak of the kernel — ps RSS
 "peak_source",    //   underestimates MPS processes by ~20× (RSS 489 MiB vs 10 GB real)
 "mem_cap_mib"}    // ← cap in force at train time (context of the peak)
```

The system also adds the run to `reconstruction.splat_runs[]`.
If the run belongs to a scene, the system also adds it to the metrics of that scene version.
The system already saves `params_hash`, `trainer`, `stage_timings`, the tries and the CUDA telemetry.
The field `eval:{psnr,ssim,lpips}` is still optional and is not in every run.

## Measured evidence

The measured CUDA runs are in one place only.
They include 7K to 40K, times, gaussians, peak VRAM and `params_hash`.
See [README, section `Measured evidence`](../README.md#measured-evidence-single-record).
This document does not copy them.

## Legacy Mac path (OpenSplat / MPS)

> **Legacy.** This path applies only with `AEROBRAIN_COMPUTE=local`.
> The local OpenSplat build is broken today (opencv dylibs).
> Rules and gotchas: [archive/LEGACY_MAC_TRAINER.md](archive/LEGACY_MAC_TRAINER.md).
> Note: `taskpolicy -m`, `--sh-degree-interval` and the other details below describe this path.
> The SH degree 0 limit also applies to the public route from `.splat` to SOG.

### Identity

The production contract has two families of trainer:

| Build | Runtime (CMakeCache) | Use |
|---|---|---|
| `splat/OpenSplat/build-mps/opensplat` | **MPS** (Metal) | Local Fast 1K and Medium 2K |
| `splat/OpenSplat/build/opensplat` | CPU | Backup (`--cpu`) |
| PC WSL2 `nerfstudio-splatfacto` + gsplat 1.4 | CUDA 12.4 / RTX 4060 Ti | The only path for 7K to 40K |

`choose_splat_backend()` (worker.py) selects the backend.
It selects MPS if `GPU_RUNTIME==MPS` and `xcrun --find metal` answers.
If not, it selects CPU.
The trainer runs **natively**, not in Docker (Docker is only for ODM).
`DYLD_LIBRARY_PATH=splat/libtorch/lib`.

### Exact command (`opensplat_train_cmd`, worker.py)

```
/usr/sbin/taskpolicy -m <caps.opensplat_mib> \
  <BIN> <PROJECT_DIR> [--cpu] \
  -n <ITERS> -o <OUT>.splat \
  --sh-degree-interval <ITERS+1> \
  <preset train_args...> <oom-rung extra...>
```

- `taskpolicy -m` sets a hard cap on RSS.
  The system sends SIGKILL (-9) when the process goes above the cap.
  The value is `caps.opensplat_mib` in `config/hardware.json` (11000 MiB, calibrated for 16GB).
- **`--sh-degree-interval = iters+1` ALWAYS locks SH at degree 0.**
  This is a workaround for a real NaN divergence.
  The harmonics jump at step 1000 made the loss NaN on CPU (3 runs).
  So no trained splat has view-dependent color, "ultra" included.
  Original note: the `.splat` format does not export SH coefficients.
  So with `.splat` export the system loses nothing.
  If the project exports `.ply` or `.spz` with SH one day, this workaround changes from harmless to a restriction.
  The next step is **Experiment 2.0 of the frontier plan**: reproduce the NaN, find the cause, fix it, and measure.
- The policy for tries is explicit:
  - Local Fast and Medium use the M4 memory preflight and can recommend `-d2`.
  - The old Metal runs of Cinematic and Ultra keep their historical ladder in the metadata.
    Users can no longer enqueue them from the product.
  - CUDA 7K to 40K keeps the tier and the backend. `auto` does `d1→d2` only after a classified OOM.
  - Each try saves the preset, the input scale, the cause, the rc, the duration and the observed peak.

### What the CLI exposes (v1.1.5, `--help` checked): map of Phase 2 levers

| Lever | Flag? | Implication |
|---|---|---|
| Pose refinement (2.1) | ❌ | Needs a trainer swap |
| Appearance embeddings (2.2) | ❌ | Needs a swap |
| Antialiasing / mip (2.3) | ❌ in the trainer (the viewer sets `antialiased:true` at render, which is not the fix) | Needs a swap |
| Depth regularization (2.4) | ❌ (only `--ssim-weight`) | Needs a swap |
| Densification budget (2.5) | ⚠️ indirect (flags above) | Can be tuned in place |
| SH degree (2.0, new) | ✅ `--sh-degree`, `--sh-degree-interval` | Turned off today by the NaN workaround |
| Checks | ✅ `--val`, `--val-image <name>`, `--val-render <dir>` | **The pipeline never used them.** One hold-out for each run |

**Trainer decision (stay, or migrate to nerfstudio/gsplat): the team makes it when the Phase 1 baseline exists, not before.**

### Hardware config (`config/hardware.json`)

`pipeline/hwconfig.py` is the single source of truth.
`machine` has the detected facts (16GB, 4P+6E, 10 GPU cores, Docker 9.77 GiB).
`caps` has the calibrated limits for operation (opensplat 11000 MiB, ODM 7g×4 / 8500m×2).
At each start, `load()` compares the real RAM with the recorded RAM (about 5 ms).
`--detect` regenerates `machine`.

### Eval environment (checked 2026-07-11)

- Python 3.14.6 (`/Volumes/SSD/_system/venv`)
- torch 2.13.0 **MPS=True**
- torchvision 0.28.0
- lpips 0.1.4 (forward pass tested, AlexNet weights cached)
- scikit-image 0.26.0 (you can import PSNR and SSIM)

LPIPS does not block the work. It is there.

### Legacy measurement: "the Mac can do it"

The 16 GB M4 was the local backup only for Fast 1K and Medium 2K (with `AEROBRAIN_COMPUTE=local`).
The tiers from 7K to 40K were never current Mac routes.
See the CUDA evidence linked above.
