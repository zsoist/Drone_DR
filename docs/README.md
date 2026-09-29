# AeroBrain documentation index

Last audited: 2026-09-28.

This index is the discoverability and freshness contract for first-party documentation. A document
marked **current** describes live behavior; **evidence** records measured results; **historical** is
preserved for provenance and must not override a current contract.

## Start here

| Document | Status | Purpose |
|---|---|---|
| [README](../README.md) | current | Product overview, architecture and measured production evidence |
| [SPEC](../SPEC.md) | current | Product and safety contract |
| [Architecture](ARCHITECTURE.md) | current | Single source of truth: Mac control plane, PC GPU workforce, OrbStack on demand, Cloudflare, vault, data flows |
| [Runbooks](RUNBOOKS.md) | current | Restart, PC unreachable, rerun, promote, purge, key rotation, tests, web version bump |
| [Operations](OPERATIONS.md) | current | 24/7 services, SLO, Cloudflare settings, recovery, Mac↔RTX lane and post-ODM gate |
| [Pipeline map](../pipeline/README.md) | current | One line per script, grouped, entry points marked (retired scripts: [archive](../pipeline/archive/README.md)) |
| [Splat pipeline](SPLAT_PIPELINE.md) | current | Trainer, tiers, retries, metadata and measured CUDA runs |
| [Multi-source 3D](MULTISOURCE_3D.md) | current + live evidence | Scene/version semantics and shared-component registration gate |
| [Roadmap](../ROADMAP.md) | current | Shipped scope and outstanding acceptance work |

## Current engineering contracts

- [Agent access and acceptance](../AGENTS.md)
- [Auth and security](AUTH_SECURITY.md)
- [Splat Lab v2 plan](SPLATLAB_V2_PLAN.md)
- [Engineering pitfalls](../CLAUDE.md)
- Test entry point: `python3 pipeline/run_all_tests.py` (flags `--fast`, `-k NEEDLE`, `-j JOBS`, `-v`; runs
  every `pipeline/test_*.py` except `test_smoke.py`, plus `node --test` over `pipeline/`, `edge/` and `tools/`
  `test_*.mjs`; about 40+ Python modules and ~17 Node files as of 2026-09-28, still growing; count with `ls pipeline/test_*`). `test_smoke.py` is the pre-commit gate
  and calls it with `--fast`. See [Runbooks](RUNBOOKS.md#run-all-tests).
- [Scene objects](SCENE_OBJECTS.md)
- [Game engine](GAME_ENGINE.md)
- [World collision/stability design](superpowers/specs/2026-07-25-flightverse-world-collision-stability-design.md)
- [World context prompt](WORLD_CONTEXT_PROMPT.md)
- [Drone model specification](DRONE_MODEL_SPEC.md)
- [Enemy model specification](ENEMY_MODEL_SPEC.md)
- [Flightverse implementation ledger](FLIGHTVERSE_IMPLEMENTATION.md)
- [Design system](../web/DESIGN.md)
- [Home V2 design QA](qa/design-qa.md)
- [Asset pipeline notes](../web/assets/README.md)
- [Props asset notes](../web/assets/props/README.md)
- [Destruction third-party notices](../web/assets/destruction/THIRD_PARTY.md)

## Evidence and active backlogs

- [Bug Hunt backlog](BUGHUNT_BACKLOG.md) — active items plus explicitly closed forensic history.
- [Design QA](qa/design-qa.md) — production acceptance evidence for Home V2 across desktop, tablet and iPhone (screenshots in `qa/home-v2-*.png`).
- [Splat experiments](SPLAT_EXPERIMENTS.md) — frozen MPS/OpenSplat experiment dataset.

## Historical snapshots

Kept in [`archive/`](archive/) (and the two below that code comments still cite). Their headers state what superseded them.

- [3D processing audit](archive/3D_PROCESSING_AUDIT.md)
- [3D frontier audit](archive/3D_FRONTIER_AUDIT.md)
- [Case study baseline v1](archive/CASE_STUDY_BASELINE_V1.md) — frozen held-out baseline.
- [Flightverse UI audit](archive/FLIGHTVERSE_UI_AUDIT.md)
- [Game experience v1](archive/GAME_EXPERIENCE_SPEC.md)
- [Trainer migration research](archive/MIGRATION_SPEC.md)
- [2026-07-10 bug-hunt triage](archive/HUNT_2026-07-10_TRIAGE.md)
- [Legacy Mac trainer (OpenSplat/MPS)](archive/LEGACY_MAC_TRAINER.md)
- [Flightverse renderer decision](FLIGHTVERSE_RENDERER_DECISION.md) — still in `docs/` because `web/flightverse/scene.js` cites it.

## Dated implementation plans and design specs

These files document approved intent at a point in time. The current contracts above win when a
plan's future tense or task status no longer matches production.

Plans:

- [CUDA splat frontier](superpowers/plans/2026-07-13-cuda-splat-frontier.md)
- [Flightverse mobile HUD](superpowers/plans/2026-07-13-flightverse-mobile-hud.md)
- [Flightverse touch workspace](superpowers/plans/2026-07-13-flightverse-touch-workspace.md)
- [Incremental scenes](superpowers/plans/2026-07-13-incremental-scenes.md)
- [Jobs console](superpowers/plans/2026-07-13-jobs-console.md)
- [Scene similarity UI](superpowers/plans/2026-07-13-scene-similarity-ui.md)
- [Truthful stability](superpowers/plans/2026-07-13-truthful-stability.md)
- [Cinematic Home V2](superpowers/plans/2026-07-15-home-v2-cinematic-dashboard.md)

Design specs:

- [CUDA splat frontier design](superpowers/specs/2026-07-13-cuda-splat-frontier-design.md)
- [Flightverse mobile HUD design](superpowers/specs/2026-07-13-flightverse-mobile-hud-design.md)
- [Flightverse touch workspace design](superpowers/specs/2026-07-13-flightverse-touch-workspace-design.md)
- [Scene similarity UI design](superpowers/specs/2026-07-13-scene-similarity-ui-design.md)
- [Truthful scene operations](superpowers/specs/2026-07-13-truthful-scene-operations-design.md)
- [Cinematic Home V2 design](superpowers/specs/2026-07-15-home-v2-cinematic-dashboard-design.md)

## Freshness rules

1. Measured facts include date, scene/version and backend; estimates are labeled as estimates.
2. Compute policy: since 2026-09-28 the default is **PC-only** (`pipeline/compute_policy.py`; all ODM and splats
   on the RTX PC, `AEROBRAIN_COMPUTE=local` re-enables the legacy Mac paths). 7K–40K are NVIDIA CUDA-only; the
   Mac-local envelope (Fast 1K, Medium 2K, legacy custom 500–2,000 iterations) is legacy. Details: [Architecture](ARCHITECTURE.md).
3. Strict CUDA preserves tier/backend and retries only `d1→d2` after classified OOM.
4. A multi-source splat waits for final persisted `reconstruction.json` validation against the
   current shared-component logic.
5. Historical documents remain immutable except for supersession/freshness notices.
6. Every `web/` documentation or code edit is followed by `pipeline/bump_web_version.py`.
7. Live job stage, memory and progress belong to the jobs UI/SQLite/event log. Current Markdown
   records only closed milestones and durable gates, never an unqualified “currently running”.
