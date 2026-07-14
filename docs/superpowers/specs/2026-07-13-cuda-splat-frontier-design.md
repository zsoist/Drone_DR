# CUDA Splat Frontier Design

**Date:** 2026-07-13
**Status:** Approved
**Scope:** Mac Mini M4 orchestration, Windows/WSL RTX 4060 Ti execution, 15K/20K/30K Gaussian splat tiers, UI, observability, lifecycle, bulk reprocessing, tests, and operations documentation.

## 1. Outcome

AeroBrain will expose three explicit premium Gaussian splat tiers:

| Key | Label | Iterations | Backend policy | Resolution policy |
|---|---|---:|---|---|
| `ultra` | Ultra 15K | 15,000 | Metal when explicitly local; strict CUDA when CUDA selected | CUDA defaults to full-first |
| `ultra20` | Ultra+ 20K | 20,000 | CUDA only | full-first |
| `frontier` | Frontier 30K | 30,000 | CUDA only | full-first |

“Full” means `downscale=1` over the native images already registered by ODM. Current premium projects use 3072-pixel frames. A CUDA job may retry the same tier at `downscale=2` only after an observed CUDA memory failure. That retry is a resolution fallback, never a quality-tier or backend fallback.

The existing Fast 1K, Medium 2K, Cinematic 7K, and Ultra 15K Metal/OpenSplat behavior remains compatible. Historical `ultra` metadata continues to mean 15K.

## 2. Non-negotiable invariants

1. Selecting CUDA must persist through every route: direct splat, video→ODM→splat, scene-version processing, and bulk reprocessing.
2. A strict CUDA request never silently trains on Metal or CPU.
3. Ultra+ and Frontier are rejected unless CUDA is selected.
4. Requested and effective backend, tier, iterations, and input scale are stored separately and rendered in the UI.
5. Mac memory preflight never rejects a CUDA request. CUDA has its own node, disk, environment, and resolution preflight.
6. CUDA requests do not require a local OpenSplat binary.
7. Remote datasets, runs, and NTFS bridge files have bounded retention and deterministic cleanup.
8. The previous published splat remains live until training, conversion, indexing, and the browser gate all pass.
9. Bulk reprocessing is dry-run-first, deduplicated, sequential through the existing heavy worker, and safe to resume.
10. No tier is declared production-ready without a real CUDA run and browser validation.

## 3. Why these tiers

The installed Nerfstudio Splatfacto configuration and the upstream source use a 30,000-step schedule. Densification stops at step 15,000 by default, so:

- Ultra 15K reaches the end of Gaussian growth.
- Ultra+ 20K adds five thousand refinement steps with a stable Gaussian count.
- Frontier 30K completes the native optimizer schedule.

The public AeroBrain path converts Nerfstudio PLY into the 32-byte `.splat` representation and then SOG. That conversion retains only degree-zero color and discards higher spherical-harmonic coefficients. CUDA production profiles will therefore train `sh_degree=0`; spending GPU memory and optimizer work on SH1–SH3 would optimize data the published viewer cannot consume. This invariant must change if the viewer format later preserves SH.

## 4. Central quality contract

`pipeline/splat_presets.py` remains the single vocabulary. Each profile gains explicit backend and resolution metadata rather than spreading lists through server and UI code:

```python
{
  "iters": 30000,
  "label": "Frontier 30K",
  "supported_backends": ("cuda",),
  "default_backend": "cuda",
  "cuda": {
    "downscale": "auto",
    "strict": True,
    "train_args": [
      "--pipeline.model.sh-degree", "0",
      "--pipeline.model.stop-split-at", "15000",
    ],
  },
}
```

The module exports validated helpers for allowed preset keys, backend compatibility, iteration lookup, and labels. API handlers, phased job builders, worker commands, manifest inference, audits, and UI bootstrap data consume this contract or a serialized `/api/splat_profiles` representation. They do not maintain independent hard-coded lists.

## 5. Request and job schema

All splat entry points normalize into one job specification:

```json
{
  "clip_id": "DJI_...",
  "preset": "frontier",
  "iters": 30000,
  "backend": "cuda",
  "backend_policy": "strict",
  "resolution": "auto",
  "requested_downscale": 1,
  "best_available": false,
  "auto_model": false,
  "model_preset": "alta"
}
```

`resolution` accepts `auto`, `full`, or `half`:

- `auto`: CUDA tries `d1`, then the same tier at `d2` only for a classified CUDA OOM.
- `full`: CUDA tries only `d1` and reports failure honestly.
- `half`: CUDA starts at `d2`.

For strict CUDA, `best_available` is false because the worker may not change tiers or backends. A separate explicit UI control may allow local fallback for legacy 15K jobs, but it is off by default and unavailable for Ultra+/Frontier.

The run sidecar and `reconstruction.splat_runs[]` add:

- `requested_backend`, `effective_backend`, and `backend_policy`
- `resolution`, `requested_downscale`, and `effective_downscale`
- `remote_peak_vram_mib`, `remote_gpu`, `remote_driver`, and CUDA environment versions
- per-stage timings and transfer byte counts
- `trainer`, `trainer_args`, and `params_hash`
- a complete `attempts[]` entry for every resolution attempt

## 6. Backend-aware preflight

### Mac

The current calibrated/unverified OpenSplat preflight stays in place for local jobs.

### CUDA

CUDA preflight verifies:

1. SSH or Wake-on-LAN reachability.
2. WSL Ubuntu starts and the sustained-session path works.
3. `torch.cuda.is_available()`, pinned gsplat kernels, GPU identity, driver, and VRAM.
4. Free space on WSL ext4 and the NTFS transfer bridge.
5. Project images and COLMAP registration exist.
6. The requested tier supports CUDA.

Disk requirements are calculated from measured project bytes plus bounded transfer/export overhead. The preflight does not invent a VRAM prediction before enough `d1` runs exist. It reports `UNVERIFIED_FULL_RES` and lets the explicit full-first policy gather telemetry.

After real runs exist, observed peak VRAM by image width, camera count, Gaussian count, and scale may drive a conservative recommendation. Observations never silently override a user’s explicit `full` request.

## 7. Remote execution and lifecycle

The Mac remains the source of truth and queue owner. The PC is a disposable accelerator:

```text
UI → Mac API → SQLite job → Mac worker
   → wake/probe PC → stage COLMAP → copy to WSL ext4
   → sustained SSH ns-train → export PLY → NTFS bridge → Mac
   → PLY→splat → crop → SOG → index → browser gate → done
```

The remote training wrapper:

- emits progress continuously for `run_tracked`;
- samples NVIDIA VRAM/utilization/temperature and records the peak;
- writes a run manifest before training;
- classifies OOM separately from connectivity, cancellation, disk, export, and trainer errors;
- preserves the requested iteration count across `d1→d2` retry;
- uses the installed stable Nerfstudio environment without an unplanned dependency upgrade.

Cleanup policy:

- NTFS input staging is deleted immediately after the verified copy to WSL.
- NTFS output staging is deleted immediately after the verified fetch to Mac.
- Successful WSL datasets and runs are deleted after config/metrics are copied into the Mac sidecar.
- Failed/cancelled run state is retained for 24 hours for diagnosis, then swept.
- A manual cleanup command reports reclaimed bytes and never touches an active job.

This prevents a bulk campaign from exhausting the PC’s currently constrained C: bridge while preserving the large WSL ext4 volume as the hot path.

## 8. Failure policy

Failures are explicit and typed:

| Failure | Automatic action |
|---|---|
| CUDA OOM at `d1` with `resolution=auto` | retry same tier at `d2` |
| CUDA OOM at `d2` | fail; do not lower tier or switch backend |
| PC asleep | Wake-on-LAN and bounded wait |
| PC unreachable/environment invalid | fail strict CUDA job with actionable diagnosis |
| SSH disconnect during training | fail and retain remote state for 24h |
| export/fetch corruption | fail before publish; keep previous current splat |
| browser gate failure | fail publication completion; keep produced asset diagnosable |
| user cancellation | kill tracked SSH/remote child, clean transient bridge files, mark cancelled |

The UI may offer “Retry CUDA” using the same immutable request. It does not offer a misleading generic retry that changes backend, resolution, or quality.

## 9. UI

All direct and phased flows show the same profile cards and node contract:

- Ultra 15K
- Ultra+ 20K
- Frontier 30K

The CUDA node row is always visible. States are `Listo`, `Dormido · se despertará`, `Ocupado`, or `No disponible`; the option is not hidden merely because the PC sleeps.

CUDA defaults:

- backend: NVIDIA CUDA
- resolution: `Auto: completa primero`
- fallback: `Mantener CUDA y calidad` (strict)

Before enqueue, the confirmation summary states the exact tier, iterations, backend, resolution policy, estimated transfer size, and whether ODM base generation is required.

Job cards display requested→effective values without inference:

- `Frontier 30K solicitado · Frontier 30K efectivo`
- `NVIDIA CUDA`
- `Entrada completa` or `Completa → d2 por VRAM`
- iterations completed, Gaussian count, peak VRAM, duration, and artifact

Stale copy such as “worker integration in progress” is removed. A recovered job ends with a recovery event rather than leaving an old traceback as the apparent final result.

## 10. Bulk reprocessing campaign

The 3D workspace gains `Reprocesar en CUDA…` with a dry-run summary. It can target selected projects or every eligible reconstruction.

Eligibility requires:

- valid ODM `image_list.txt` and `reconstruction.json`;
- no queued/running 3D or splat job for that reconstruction;
- at least eight registered images;
- a current source video/model that has not been deleted.

The batch endpoint returns `eligible`, `skipped`, total input bytes, and ordered job specs before mutation. Confirmation enqueues immutable jobs using collision-safe IDs. Existing good splats remain available while the campaign runs. The queue remains one heavy job at a time so Mac publishing and browser QA cannot race.

The default campaign profile is Frontier 30K, CUDA strict, full-first. The user can choose Ultra 15K or Ultra+ 20K for comparative runs.

## 11. Testing and production gates

### Automated

1. Preset resolution and aliases map 15K/20K/30K exactly.
2. Unsupported backend/tier combinations are rejected.
3. Direct, phased ODM, and scene-version routes preserve the identical CUDA spec.
4. CUDA requests bypass Mac preflight and local-binary requirements.
5. Resolution attempt planning permits only `d1→d2` within the same tier.
6. CUDA command includes SH0, 15K densification stop, exact iteration count, and requested downscale.
7. OOM classification, strict failure, cleanup, cancellation, and disk checks are deterministic.
8. Sidecars, manifests, job summaries, and audits recognize Ultra+, Frontier, backend, resolution, and VRAM.
9. Batch dry run, deduplication, collision-safe IDs, and enqueue ordering are tested.
10. ESM parsing, smoke tests, Python compilation, JS checks, vault audits, and splat audits pass.

### Browser

The browser matrix verifies desktop, iPad, and mobile where applicable:

- every modal offers the correct tiers and CUDA state;
- sleeping-node copy remains actionable;
- direct and phased request payloads contain backend/resolution/tier;
- job cards update from queued through done and show truthful effective values;
- the generated SOG renders in share and workspace without console errors.

### Real RTX acceptance

Before production-ready status:

1. Run Ultra 15K at `d1` on a representative registered project.
2. Run Ultra+ 20K at `d1` on the same project.
3. Run Frontier 30K at `d1` on the same project.
4. If `d1` OOMs, verify automatic same-tier `d2` recovery and truthful UI history.
5. For every successful tier, verify exact iterations, CUDA backend, artifact metadata, browser gate, and viewer canvas.
6. Verify remote transient storage returns to its baseline after completion.
7. Run one small multi-project batch campaign before exposing “all projects” as production-safe.

## 12. Documentation

Update at minimum:

- `README.md`: architecture and current 3D/CUDA pipeline
- `AGENTS.md`: current API examples and acceptance commands
- `CLAUDE.md`: operational pitfalls and strict CUDA invariants
- `docs/SPLAT_PIPELINE.md`: backend-specific trainers and profile table
- `docs/OPERATIONS.md`: Wake-on-LAN, storage, cleanup, cancellation, and recovery
- `docs/BUGHUNT_BACKLOG.md`: close discovered wiring bugs with evidence

Documentation must distinguish measured production evidence from estimates and must not call the integration “in progress” after it is verified.

## 13. Rollout

1. Repair and test the central contract and propagation paths.
2. Harden the remote lane, full-resolution retry, telemetry, and cleanup.
3. Wire all UI surfaces and observability.
4. Update manifests, audits, and docs.
5. Run the real 15K/20K/30K acceptance sequence.
6. Run a small batch canary.
7. Enable the full Frontier reprocessing campaign after the canary passes.

No rollout step publishes over a known-good splat until the replacement passes its complete gate chain.
