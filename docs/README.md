# AeroBrain documentation index

Last audited: 2026-07-14.

This index is the discoverability and freshness contract for first-party documentation. A document
marked **current** describes live behavior; **evidence** records measured results; **historical** is
preserved for provenance and must not override a current contract.

## Start here

| Document | Status | Purpose |
|---|---|---|
| [README](../README.md) | current | Product overview, architecture and measured production evidence |
| [SPEC](../SPEC.md) | current | Product and safety contract |
| [Operations](OPERATIONS.md) | current | 24/7 services, recovery, Mac↔RTX lane and post-ODM gate |
| [Splat pipeline](SPLAT_PIPELINE.md) | current | Trainer, tiers, retries, metadata and measured CUDA runs |
| [Multi-source 3D](MULTISOURCE_3D.md) | current + live evidence | Scene/version semantics and shared-component registration gate |
| [Roadmap](../ROADMAP.md) | current | Shipped scope and outstanding acceptance work |

## Current engineering contracts

- [Agent access and acceptance](../AGENTS.md)
- [Engineering pitfalls](../CLAUDE.md)
- [Scene objects](SCENE_OBJECTS.md)
- [Game engine](GAME_ENGINE.md)
- [World context prompt](WORLD_CONTEXT_PROMPT.md)
- [Drone model specification](DRONE_MODEL_SPEC.md)
- [Enemy model specification](ENEMY_MODEL_SPEC.md)
- [Flightverse implementation ledger](FLIGHTVERSE_IMPLEMENTATION.md)
- [Design system](../web/DESIGN.md)
- [Asset pipeline notes](../web/assets/README.md)
- [Props asset notes](../web/assets/props/README.md)
- [Destruction third-party notices](../web/assets/destruction/THIRD_PARTY.md)

## Evidence and active backlogs

- [Bug Hunt backlog](BUGHUNT_BACKLOG.md) — active items plus explicitly closed forensic history.
- [Design QA](../design-qa.md) — acceptance evidence for the current 3D UI.
- [Case study baseline v1](CASE_STUDY_BASELINE_V1.md) — frozen held-out baseline.
- [Splat experiments](SPLAT_EXPERIMENTS.md) — frozen MPS/OpenSplat experiment dataset.

## Historical snapshots

These are intentionally retained. Their headers state what superseded them.

- [3D processing audit](../3D_PROCESSING_AUDIT.md)
- [3D frontier audit](../3D_FRONTIER_AUDIT.md)
- [Flightverse renderer decision](FLIGHTVERSE_RENDERER_DECISION.md)
- [Flightverse UI audit](FLIGHTVERSE_UI_AUDIT.md)
- [Game experience v1](GAME_EXPERIENCE_SPEC.md)
- [Trainer migration research](MIGRATION_SPEC.md)
- [2026-07-10 bug-hunt triage](HUNT_2026-07-10_TRIAGE.md)

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

Design specs:

- [CUDA splat frontier design](superpowers/specs/2026-07-13-cuda-splat-frontier-design.md)
- [Flightverse mobile HUD design](superpowers/specs/2026-07-13-flightverse-mobile-hud-design.md)
- [Flightverse touch workspace design](superpowers/specs/2026-07-13-flightverse-touch-workspace-design.md)
- [Scene similarity UI design](superpowers/specs/2026-07-13-scene-similarity-ui-design.md)
- [Truthful scene operations](superpowers/specs/2026-07-13-truthful-scene-operations-design.md)

## Freshness rules

1. Measured facts include date, scene/version and backend; estimates are labeled as estimates.
2. 7K–40K are NVIDIA CUDA-only. Mac fallback is limited to Fast 1K, Medium 2K and legacy
   custom requests within the same 500–2,000-iteration envelope; custom work above 2K is CUDA-only.
3. Strict CUDA preserves tier/backend and retries only `d1→d2` after classified OOM.
4. A multi-source splat waits for final persisted `reconstruction.json` validation against the
   current shared-component logic.
5. Historical documents remain immutable except for supersession/freshness notices.
6. Every `web/` documentation or code edit is followed by `pipeline/bump_web_version.py`.
7. Live job stage, memory and progress belong to the jobs UI/SQLite/event log. Current Markdown
   records only closed milestones and durable gates, never an unqualified “currently running”.
