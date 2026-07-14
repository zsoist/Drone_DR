# Truthful Scene Operations — Approved Design

> **Implemented dated design.** Current operational and trainer contracts are
> [../../OPERATIONS.md](../../OPERATIONS.md) and [../../SPLAT_PIPELINE.md](../../SPLAT_PIPELINE.md).

**Date:** 2026-07-13  
**Status:** Approved  
**Product objective:** Build the most accurate stable representation this Mac can produce from several videos and photos of the same place, while preserving provenance and allowing the place to improve through versioned reprocessing over time.

## Evidence that constrains the design

- The machine is a Mac mini M4 with 16 GB unified memory. It has completed ODM Alta and OpenSplat Ultra workloads; it has also produced content-dependent OOMs. Capability is proven, universal reliability is not.
- The existing Ultra preflight projects more than 100 GB by extending a short failed-run slope to 15,000 iterations. That number is not a measured peak and must not be presented as fact.
- The 2026-07-12 Alta job registered 238/238 cameras and completed in 98 minutes, but its dense quality fell from requested `high` to effective `medium` and its final pipeline mode was `ortho_25d_fallback`.
- The same request visibly selected an Ultra splat, but the stored job spec omitted `then_splat` and `splat_preset`; no splat job was queued.
- Measured Medium baselines exist at 30, 81, and 214 cameras. Cinematic/Ultra have successful historical runs and failed contemporary runs, but not enough controlled data for precise peak forecasts.

## Product truth contract

1. Always separate requested, attempted, and effective quality.
2. Never call a projection a measurement. Never show an ETA without a calibrated basis.
3. Every automatic retry, resolution reduction, dense-quality fallback, and product downgrade is a structured event visible to the operator.
4. A completed degraded product is `completed_with_fallback`, not an unqualified success and not a failure.
5. Raw logs and historical failures are immutable. A later DeepSeek diagnosis is an annotation with its own timestamp and resolution state.
6. A source is part of a combined scene only when SfM reports that it registered. Global registration percentages cannot hide a dropped source.

## Architecture

### Stable scene, immutable versions

`scene_id` is the durable identity of a real place. Each processing attempt creates an immutable reconstruction version whose `reconstruction_id` remains the deterministic hash of its exact video/photo source set. Adding captures creates a new version; it does not overwrite the prior version.

```text
scene_<id>
  active_version -> recon_<hash-v2>
  versions:
    recon_<hash-v1>  [video A, video B]
    recon_<hash-v2>  [video A, video B, video C, photos 1..8]
```

Current ODM and OpenSplat cannot safely append geometry/gaussians to an existing trained artifact. “Improve over time” therefore means: reuse the scene membership, add compatible captures, rerun co-registration and training, compare quality gates, then promote the better version. Previous versions remain selectable and reversible.

Scene manifests live at `VAULT/manifest/scenes/<scene_id>.json` and contain title, geographic anchor, source inventory, immutable version records, active version, and comparison metrics. Model/splat artifacts continue to use `recon_<hash>` paths, avoiding mutable data aliases.

### Best-available processing policy

- ODM starts at the requested preset. OpenMVS instability gets one same-preset stable-dense retry, then the existing lower-preset chain, then the 25D product fallback. The effective output is recorded precisely.
- Local Fast/Medium preflight calculates the deterministic image-load floor and may use the calibrated M4 peak model. Named 7K–40K bypass that Mac model and use CUDA node/environment/disk/registration preflight; missing full-resolution evidence is reported as unverified, never as a fabricated VRAM prediction.
- CUDA `auto` always attempts full-resolution `d1` first and may move to `d2` only after a classified CUDA OOM. It never starts at `d2` from a Mac-side estimate; explicit `full` and `half` remain one-attempt policies.
- Historical MPS policy (superseded) allowed `best_available=true` to descend Ultra → Cinematic → Medium. The current product permits no cross-tier fallback: named 7K–40K and custom work above 2K are CUDA-only, while an automatic retry may only keep the same CUDA tier and move `d1→d2` after classified OOM. Old artifacts retain their original fallback provenance.
- A source merge that becomes PARTIAL never auto-trains the splat; the operator sees which source failed and can remove or replace it.

### Job observability

SQLite remains the summary store. Add `job_events(job_id, ts, level, event, message, data)` for structured transitions. Full subprocess output is appended to `VAULT/ops/job_logs/<job_id>.log`; `jobs.log` remains a short tail for cheap polling.

APIs:

- `GET /api/jobs`: normalized summaries and counts; no full logs.
- `GET /api/job?id=<id>`: parsed spec, events, provenance, artifacts, and metrics.
- `GET /api/job_log?id=<id>&after=<line>&limit=<n>`: bounded log chunks with next cursor.

The Jobs tab becomes an operational list with status/type filters, search, requested/effective quality, current stage, source/camera counts, fallback timeline, artifacts, and an expandable log console. ETA is absent until calibrated; elapsed time is always factual.

### DeepSeek annotations

Automated analysis may create a structured `diagnosis` event with cause, confidence, evidence, and suggested action. It may create a later `resolved` event after a passing regression. It never mutates the original error detail or log.

## Quality gates

- Multi-source: per-source `submitted`, `registered`, ratio, and merged state.
- ODM: requested/effective preset, dense quality, product mode, camera registration, DSM/ortho presence, browser gate.
- Splat: requested/effective preset, rung/input scale, final step/loss, peak footprint/cap, artifact size, browser gate, and optional held-out metrics.
- Promotion: a new scene version is not made active when it loses required artifacts or source registration. Quality comparisons are descriptive until enough matched held-out views exist.

## Out of scope

- In-place incremental ODM or warm-start OpenSplat training.
- Claims that Cinematic/Ultra always fit 16 GB.
- Automatic merging based only on geographic proximity.
- Replacing OpenSplat in this delivery; the measured pose/appearance limitations remain documented inputs to a future trainer decision.
