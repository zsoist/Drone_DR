# CUDA Splat Frontier Implementation Plan

> **Dated execution plan (2026-07-13).** Most implementation tasks are shipped; unchecked prose
> is not live status. Current acceptance status is in [../../../ROADMAP.md](../../../ROADMAP.md).

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Apply superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before declaring success.

**Goal:** Make Mac-orchestrated RTX Gaussian splat jobs reliable and truthful across every entry point, add strict CUDA Ultra 15K / Ultra+ 20K / Frontier 30K / Grandmaster 40K tiers, expose accurate backend-specific estimates and execution details in a premium UI, build progressive multi-video site models with 100/200/400/600/1,000 m altitude products for Estudio 3D and Mundo, and validate the full path on the real RTX 4060 Ti.

**Architecture:** Keep the Mac as API, queue, artifact, and publication authority. Centralize splat profile/backend/resolution rules in `pipeline/splat_presets.py`, normalize every API route into the same immutable job schema, and make `pipeline/worker.py` execute a strict CUDA attempt plan through `pipeline/gpu_lane.py`. The PC remains a disposable accelerator; produced assets return to the Mac and are published only after quality and browser gates pass.

**Tech Stack:** Python 3.14, SQLite job queue, stdlib HTTP server, JavaScript/CSS frontend, Nerfstudio Splatfacto + gsplat/CUDA in WSL, SSH/rsync/scp transfer, Playwright browser gates.

---

## Task 1: Centralize the 15K/20K/30K/40K profile contract

**Files:**

- Modify: `pipeline/splat_presets.py`
- Modify: `pipeline/test_smoke.py`
- Create: `pipeline/test_splat_frontier.py`

**Step 1: Write failing contract tests**

Add focused tests asserting:

- `ultra` resolves to exactly 15,000 iterations and supports only `cuda`.
- `ultra20` resolves to exactly 20,000 iterations and supports only `cuda`.
- `frontier` resolves to exactly 30,000 iterations and supports only `cuda`.
- `grandmaster` resolves to exactly 40,000 iterations and supports only `cuda`.
- CUDA profiles serialize labels, backend compatibility, strict policy, and full-first resolution defaults.
- aliases and legacy exact-iteration inference remain deterministic.
- invalid backend/profile pairs raise an explicit validation error.

Run:

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_splat_frontier -v
```

Expected: FAIL because Ultra+ and Frontier and the shared helpers do not exist.

**Step 2: Implement the profile contract**

Extend `SPLAT_PRESETS` with explicit fields:

```python
"frontier": {
    "label": "Frontier 30K",
    "iters": 30_000,
    "supported_backends": ("cuda",),
    "default_backend": "cuda",
    "cuda": {
        "resolution": "auto",
        "strict": True,
        "train_args": [
            "--pipeline.model.sh-degree", "0",
            "--pipeline.model.stop-split-at", "15000",
        ],
    },
}
```

Add small validated helpers for keys, labels, backend compatibility, resolution normalization, iteration inference, public serialization, and a normalized immutable request. Keep legacy custom iteration support bounded to 40K; custom requests above the 2K local envelope are CUDA-only.

**Step 3: Run focused and smoke tests**

```bash
/Volumes/SSD/_system/venv/bin/python3 -m unittest pipeline.test_splat_frontier -v
/Volumes/SSD/_system/venv/bin/python3 pipeline/test_smoke.py
```

Expected: PASS.

**Step 4: Commit**

```bash
git add pipeline/splat_presets.py pipeline/test_splat_frontier.py pipeline/test_smoke.py
PATH=/Volumes/SSD/_system/venv/bin:$PATH git commit -m "feat: define strict CUDA splat frontier tiers"
```

## Task 2: Normalize every API entry point and expose profiles/preflight

**Files:**

- Modify: `pipeline/aerobrain_server.py`
- Modify: `pipeline/preflight.py`
- Modify: `pipeline/jobs.py`
- Modify: `pipeline/test_scenes.py`
- Modify: `pipeline/test_jobs_observability.py`
- Modify: `pipeline/test_splat_frontier.py`

**Step 1: Write failing route and queue tests**

Cover:

- direct `/api/splat` preserves tier, exact iterations, strict CUDA backend, resolution, and requested downscale;
- `/api/odm` and `prepare_scene_version` preserve the identical follow-up splat contract;
- CUDA bypasses Mac memory preflight and local OpenSplat binary checks;
- every named 7K–40K tier and every custom request above 2K reject local execution;
- `/api/splat_profiles` returns the central serialized contract;
- CUDA preflight reports node/environment/disk/registration facts without a fabricated VRAM prediction;
- rapid batch enqueue produces collision-safe unique job IDs;
- job summaries distinguish requested and effective values.

Run the focused tests and confirm failure before implementation.

**Step 2: Add shared request normalization**

Create one server helper that accepts API JSON and produces:

```json
{
  "preset": "frontier",
  "iters": 30000,
  "backend": "cuda",
  "backend_policy": "strict",
  "resolution": "auto",
  "requested_downscale": 1
}
```

Use it from direct splat, ODM follow-up, and scene-version preparation. Preserve the whole spec in SQLite instead of rebuilding it later.

**Step 3: Split Mac and CUDA preflight**

Retain calibrated MPS/OpenSplat checks only for local jobs. For CUDA, validate profile compatibility, COLMAP registration, node probe, WSL CUDA/gsplat environment, WSL free space, and bridge free space. Do not require a local OpenSplat executable.

**Step 4: Add collision-safe job IDs**

Replace millisecond-only IDs with a monotonic/random-safe suffix while keeping readable prefixes and existing job lookup compatibility.

**Step 5: Expose profile and preflight APIs**

Serve the serialized central contract and backend-aware preflight results for the UI. Responses must contain measured/unknown states separately from estimates.

**Step 6: Verify and commit**

Run focused tests, `pipeline/test_smoke.py`, and `python3 -m py_compile` on modified Python modules. Commit the API slice.

## Task 3: Harden the RTX lane, attempt planning, telemetry, and cleanup

**Files:**

- Modify: `pipeline/gpu_lane.py`
- Modify: `pipeline/worker.py`
- Create: `pipeline/test_gpu_lane_frontier.py`
- Modify: `pipeline/test_smoke.py`

**Step 1: Write failing execution tests**

Using command-runner fakes, assert:

- `auto` plans only `[d1, d2]`, `full` only `[d1]`, and `half` only `[d2]`;
- retry occurs only for classified CUDA OOM;
- tier and exact iterations remain unchanged across retry;
- command contains SH0, `stop-split-at=15000`, exact max iterations, and exact downscale;
- strict CUDA never calls the Metal/CPU path;
- connectivity, disk, cancellation, export, and trainer failures remain typed and do not trigger a resolution retry;
- VRAM sampling records peak MiB/GPU/driver/CUDA versions;
- verified transfer cleanup removes bridge input/output and successful WSL workspaces;
- failed/cancelled WSL state receives a 24-hour retention marker;
- cleanup refuses to touch active job paths.

**Step 2: Introduce an immutable CUDA attempt plan**

Build attempts from the normalized request. Each attempt records requested/effective downscale, timestamps, stage, exit classification, peak telemetry, transfer bytes, and artifact checksums.

**Step 3: Parameterize remote training**

Remove the hard-coded `downscale=2`. Generate the Nerfstudio command from the central profile and attempt. Use the installed pinned environment and avoid dependency changes.

**Step 4: Make remote progress and telemetry observable**

Stream trainer progress through the tracked process and sample `nvidia-smi` during the sustained SSH session. Store peak VRAM, utilization/temperature samples, driver, GPU, torch, CUDA, gsplat, stage durations, and transfer sizes.

**Step 5: Implement classified failure and strict fallback rules**

Raise typed errors. Only a positive CUDA OOM signature with `resolution=auto` advances from d1 to d2. All other failures end the strict CUDA job; no branch invokes local training.

**Step 6: Implement deterministic cleanup**

Delete bridge staging after verified copies, delete successful WSL datasets/runs after required evidence reaches the Mac, retain failed state for 24 hours, and add a safe report/sweep command.

**Step 7: Verify and commit**

Run focused tests, smoke, Python compilation, and a read-only real-PC probe. Commit the RTX lane slice.

## Task 4: Persist truthful attempt/result metadata and recoveries

**Files:**

- Modify: `pipeline/worker.py`
- Modify: `pipeline/aerobrain_server.py`
- Modify: `pipeline/build_index.py`
- Modify: `pipeline/audit_splats.py`
- Modify: `pipeline/test_jobs_observability.py`
- Modify: `pipeline/test_splat_frontier.py`

**Step 1: Write failing metadata tests**

Require sidecars, `reconstruction.splat_runs[]`, index summaries, and job summaries to include requested/effective profile, backend, iteration count, resolution/downscale, attempts, peak VRAM, trainer, params hash, stage timings, and artifact identity.

Add a recovered-job regression: after a historical failure is repaired and the artifact passes its gate, the displayed terminal event is recovery/success, not the stale traceback.

**Step 2: Persist requested and effective fields separately**

Never infer requested values from the final attempt. Preserve `d1→d2` history and explicit CUDA identity in the sidecar and job API.

**Step 3: Extend index inference and audits**

Recognize 20K, 30K and 40K without breaking legacy 1K/2K/7K/15K assets. Audit required profile evidence, exact iterations, artifact existence, browser QA, and backend/resolution provenance.

**Step 4: Repair recovery presentation**

Append a success/recovery event and make summary logic prefer that terminal event while retaining the old traceback in complete logs.

**Step 5: Verify and commit**

Run focused tests, smoke, rebuild the index atomically, audit the vault and splats, then commit.

## Task 5: Build one premium backend-aware 3D UI contract

**Files:**

- Modify: `web/tresd.js`
- Modify: `web/shell.js`
- Modify: `web/tresd.html`
- Modify: `web/system.html`
- Modify: `pipeline/browser_matrix.py`
- Modify: `pipeline/test_smoke.py`

**Step 1: Add failing JS/static/browser assertions**

Verify:

- all direct and phased modals render Ultra 15K, Ultra+ 20K, Frontier 30K and Grandmaster 40K from API data;
- the CUDA row remains visible while ready, sleeping, busy, or unavailable;
- sleeping copy says it will wake instead of hiding the option;
- every 7K–40K named tier forces CUDA strict;
- confirmation renders exact backend, iterations, resolution policy, estimated transfer bytes, and ODM prerequisite;
- payloads from direct, ODM, and scene flows are identical;
- job cards render requested→effective backend/profile/resolution, exact completed iterations, Gaussians, peak VRAM, and measured elapsed time;
- fallback is named precisely: `Completa → media por VRAM`, never generic `fallback`;
- no stale “integration in progress” text remains;
- desktop/iPad/mobile layouts have no overflow and keyboard controls remain operable.

**Step 2: Replace hard-coded profile arrays with API bootstrap data**

Load `/api/splat_profiles` once, cache it safely, and use one card renderer across the main Estudio 3D flow and direct splat modal. Provide a resilient bundled fallback matching the server contract only for offline rendering.

**Step 3: Add backend/resolution-aware estimates**

Show estimates as ranges and label their source:

- measured history for the same tier/backend/resolution when available;
- calibrated range for known local profiles;
- `Primera medición en esta GPU` where no CUDA observation exists.

Never present a Mac estimate as a CUDA estimate. During execution use measured elapsed time, stage, trainer progress, and iteration count; do not count queued time as processing time.

**Step 4: Make node/fallback state explicit**

Always show NVIDIA CUDA. Render `Listo`, `Dormido · se despertará`, `Ocupado`, or `No disponible`, with useful preflight detail. Default new premium jobs to CUDA + auto full-first + strict.

**Step 5: Upgrade job cards and bulk campaign UI**

Add `Reprocesar en CUDA…`, a dry-run preview, eligible/skipped reasons, total transfer size, deduplicated ordered enqueue, and progress. Keep existing good splats linked throughout replacement runs.

**Step 6: Bump web version and verify**

```bash
python3 pipeline/bump_web_version.py
node --check web/tresd.js
node --check web/shell.js
/Volumes/SSD/_system/venv/bin/python3 pipeline/test_smoke.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/browser_matrix.py
```

Visually inspect desktop, iPad, and mobile screenshots. Commit the UI slice.

## Task 6: Add dry-run-first CUDA batch reprocessing

**Files:**

- Modify: `pipeline/aerobrain_server.py`
- Modify: `pipeline/jobs.py`
- Modify: `pipeline/worker.py`
- Modify: `web/tresd.js`
- Create: `pipeline/test_splat_batch.py`

**Step 1: Write failing batch tests**

Assert eligibility, skip reasons, input byte totals, immutable ordered specs, no mutation during dry run, active-job dedupe, collision-safe IDs, sequential heavy-queue behavior, and safe resume.

**Step 2: Implement dry-run and enqueue endpoints**

Use the same normalized profile contract as single jobs. Default to Frontier 30K/CUDA strict/auto full-first. Require the UI to present and confirm the dry run before mutation.

**Step 3: Implement resume-safe campaign metadata**

Track campaign ID/order/spec hash and per-project job ID without adding a second heavy worker. Preserve current published assets until each replacement passes.

**Step 4: Verify and commit**

Run batch tests, full smoke, and browser matrix. Commit.

## Task 7: Update operational documentation

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/SPLAT_PIPELINE.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/BUGHUNT_BACKLOG.md`

**Step 1: Document the verified architecture and contracts**

Describe the Mac authority / disposable RTX accelerator model, all profiles, exact backend and resolution policies, request schema, metadata, cleanup, failure types, recovery, and bulk campaign process.

**Step 2: Add executable operator commands**

Document node probe/Wake-on-LAN, safe restart, CUDA preflight, cleanup report/sweep, cancellation, queue inspection, exact browser gates, audits, and recovery steps.

**Step 3: Separate measurements from estimates**

Record the recovered 15K result as measured evidence. Mark 20K/30K/40K timings as unverified until acceptance runs complete, then replace estimates with observed results.

**Step 4: Close wiring bugs with evidence and commit**

Update the bug-hunt backlog with the route propagation, local-preflight leakage, local-binary leakage, hard-coded d2, silent Metal fallback, stale UI, cleanup, and browser-gate parser regressions, each linked to its test/verification evidence.

## Task 8: Full verification and real RTX acceptance

**Files:**

- Verify only unless a failing gate exposes a defect.

**Step 1: Run static and automated gates**

```bash
/Volumes/SSD/_system/venv/bin/python3 -m py_compile pipeline/aerobrain_server.py pipeline/worker.py pipeline/gpu_lane.py pipeline/splat_presets.py pipeline/preflight.py pipeline/jobs.py pipeline/build_index.py pipeline/audit_splats.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/test_smoke.py
node --check web/tresd.js
node --check web/shell.js
```

**Step 2: Restart safely and verify health**

Inspect `/api/jobs` first. If no heavy job is active, use `pipeline/safe_restart.sh` for backend/worker changes and verify server/worker PIDs and health endpoints.

**Step 3: Run audits and browser matrix**

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_vault.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_splats.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/browser_matrix.py
```

Run share/workspace browser gates against the recovered representative project and inspect console/network errors.

**Step 4: Record remote storage baseline**

Capture WSL ext4, bridge free space, remote data/run directories, GPU identity, driver, CUDA, torch, and gsplat state.

**Step 5: Run the same representative project at all tiers**

Sequentially enqueue and monitor:

1. Ultra 15K, CUDA strict, full-first.
2. Ultra+ 20K, CUDA strict, full-first.
3. Frontier 30K, CUDA strict, full-first.
4. Grandmaster 40K, CUDA strict, full-first.

For each, verify exact iterations, effective downscale, CUDA backend, peak VRAM, sidecar, index, artifact checksum, browser gate, viewer canvas, and no console errors. If d1 produces a classified OOM, verify only the same tier retries at d2 and UI/history report it honestly.

**Step 6: Verify cleanup and run a batch canary**

Confirm remote transient storage returns near baseline. Dry-run a small multi-project campaign, enqueue only eligible projects, and verify sequential execution and asset continuity.

**Step 7: Enable the full campaign only after canary proof**

If all acceptance evidence is green, expose/enable the all-project Frontier campaign and enqueue it only from the confirmed dry-run result. Continue monitoring until the requested campaign reaches terminal states.

**Step 8: Final verification commit**

Update measured docs with actual 15K/20K/30K/40K timings and results, rerun the complete gate set, inspect `git diff --check` and `git status`, then commit the acceptance evidence.

## Completion criteria

- Every splat entry point persists one identical normalized CUDA request.
- Ultra 15K, Ultra+ 20K, Frontier 30K and Grandmaster 40K execute exact iterations on the RTX path.
- Strict CUDA never silently switches backend or tier.
- d1→d2 is the only automatic fallback and only follows classified CUDA OOM.
- UI estimates and live timing are backend/resolution-aware and distinguish measured from unverified.
- Requested/effective data, attempts, peak VRAM, and timings appear in jobs, sidecars, index, and audits.
- Remote storage cleanup is measured and safe.
- Desktop/iPad/mobile browser gates pass.
- Real RTX 15K/20K/30K runs and a small batch canary pass before all-project Frontier processing is enabled.
- Real RTX 40K evidence is recorded separately before Grandmaster becomes the default highest-resolution campaign.
- Stable site identities expose immutable source/version history, altitude bands at 100/200/400/600/1,000 m, contribution status per video, and validated LOD assets shared by Estudio 3D and Mundo.
