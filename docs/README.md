# AeroBrain documentation index

Last audited: 2026-09-28.

Docs in English follow STE (see [STE_STYLE_GUIDE.md](STE_STYLE_GUIDE.md)). Run `python3 pipeline/ste_lint.py docs/<file>.md` to check a file.

This index is the contract for discovery and freshness of first-party documents. A document marked
**current** describes live behavior. A document marked **evidence** records measured results. A
document marked **historical** stays for provenance. A **historical** document must not override a
current contract.

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
| [STE style guide](STE_STYLE_GUIDE.md) | current | Rules for Simplified Technical English (STE) in English docs, with the linter `pipeline/ste_lint.py` |
| [Redesign plan, October 2026](REDESIGN_2026_10.md) | current | Full redesign: design decisions, anti-patterns, worktree process, workstreams and success criteria |

## Design system

UI tokens, components and visual rules are in [`web/DESIGN.md`](../web/DESIGN.md). Read it before you change `web/style.css`
or add UI. Acceptance evidence: [Design QA](qa/design-qa.md).

## Current engineering contracts

- [Agent access and acceptance](../AGENTS.md)
- [Auth and security](AUTH_SECURITY.md)
- [Splat Lab v2 plan](SPLATLAB_V2_PLAN.md)
- [World upgrade plan: Blender, reconstruction, AI agents](WORLD_UPGRADE_PLAN.md) (2026-09-29, proposed)
- [Capture protocol: DJI Flip / Neo 2 manual flights](CAPTURE_PROTOCOL.md) (W6). It is a field checklist. The upload flow also summarizes it.
- [Engineering pitfalls](../CLAUDE.md)
- Test entry point: `python3 pipeline/run_all_tests.py`
  - Flags: `--fast`, `-k NEEDLE`, `-j JOBS`, `-v`.
  - The command runs every `pipeline/test_*.py` file except `test_smoke.py`.
  - It also runs `node --test` on the `test_*.mjs` files in `pipeline/`, `edge/` and `tools/`.
  - The number of tests increases, so do not trust counts. To list the tests, run `ls pipeline/test_*`.
  - `test_smoke.py` is the pre-commit gate. It calls the command with `--fast`.
  - See [Runbooks](RUNBOOKS.md#run-all-tests).
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

- [Bug Hunt backlog](BUGHUNT_BACKLOG.md): active items and closed forensic history.
- [Design QA](qa/design-qa.md): production acceptance evidence for Home V2 on desktop, tablet and iPhone (screenshots in `qa/home-v2-*.png`).
- [Splat experiments](SPLAT_EXPERIMENTS.md): frozen dataset of MPS/OpenSplat experiments.

## Historical snapshots

These documents are in [`archive/`](archive/). One more document is below because code comments still cite it. The header of each document states what replaced it.

- [3D pipeline audit](archive/3D_PROCESSING_AUDIT.md)
- [3D frontier audit](archive/3D_FRONTIER_AUDIT.md)
- [Case study baseline v1](archive/CASE_STUDY_BASELINE_V1.md): frozen held-out baseline.
- [Flightverse UI audit](archive/FLIGHTVERSE_UI_AUDIT.md)
- [Game experience v1](archive/GAME_EXPERIENCE_SPEC.md)
- [Trainer migration research](archive/MIGRATION_SPEC.md)
- [2026-07-10 bug-hunt triage](archive/HUNT_2026-07-10_TRIAGE.md)
- [Legacy Mac trainer (OpenSplat/MPS)](archive/LEGACY_MAC_TRAINER.md)
- [Flightverse renderer decision](FLIGHTVERSE_RENDERER_DECISION.md): it is still in `docs/` because `web/flightverse/scene.js` cites it.

## Dated implementation plans and design specs

Each file records the approved intent at one point in time. If the future tense or the task status of
a plan does not match production, the current contracts above win.

Plans:

- [CUDA splat frontier](superpowers/plans/2026-07-13-cuda-splat-frontier.md)
- [Flightverse mobile HUD](superpowers/plans/2026-07-13-flightverse-mobile-hud.md)
- [Flightverse touch workspace](superpowers/plans/2026-07-13-flightverse-touch-workspace.md)
- [Incremental scenes](superpowers/plans/2026-07-13-incremental-scenes.md)
- [Jobs console](superpowers/plans/2026-07-13-jobs-console.md)
- [Scene similarity UI](superpowers/plans/2026-07-13-scene-similarity-ui.md)
- [Truthful stability](superpowers/plans/2026-07-13-truthful-stability.md)
- [Cinematic Home V2](superpowers/plans/2026-07-15-home-v2-cinematic-dashboard.md)
- [Flightverse adaptive visual UI](superpowers/plans/2026-07-25-flightverse-adaptive-visual-ui.md)
- [Flightverse near-structure flight](superpowers/plans/2026-07-25-flightverse-near-structure-flight.md)
- [Flightverse world collision stability](superpowers/plans/2026-07-25-flightverse-world-collision-stability.md)
- [World premium invasion mobile](superpowers/plans/2026-07-25-world-premium-invasion-mobile.md)
- [Flightverse mobile command HUD](superpowers/plans/2026-07-27-flightverse-mobile-command-hud.md)
- [Flightverse premium FPV combat arsenal](superpowers/plans/2026-07-27-flightverse-premium-fpv-combat-arsenal.md)
- [Home light theme layout](superpowers/plans/2026-08-02-home-light-theme-layout.md)
- [Scene improvement workspace](superpowers/plans/2026-08-02-scene-improvement-workspace.md)
- [Unified 3D viewer](superpowers/plans/2026-08-03-unified-3d-viewer.md)

Design specs:

- [CUDA splat frontier design](superpowers/specs/2026-07-13-cuda-splat-frontier-design.md)
- [Flightverse mobile HUD design](superpowers/specs/2026-07-13-flightverse-mobile-hud-design.md)
- [Flightverse touch workspace design](superpowers/specs/2026-07-13-flightverse-touch-workspace-design.md)
- [Scene similarity UI design](superpowers/specs/2026-07-13-scene-similarity-ui-design.md)
- [Truthful scene operations](superpowers/specs/2026-07-13-truthful-scene-operations-design.md)
- [Cinematic Home V2 design](superpowers/specs/2026-07-15-home-v2-cinematic-dashboard-design.md)
- [Flightverse adaptive visual UI design](superpowers/specs/2026-07-25-flightverse-adaptive-visual-ui-design.md)
- [Flightverse near-structure flight design](superpowers/specs/2026-07-25-flightverse-near-structure-flight-design.md)
- [Flightverse world collision stability design](superpowers/specs/2026-07-25-flightverse-world-collision-stability-design.md)
- [World premium invasion mobile design](superpowers/specs/2026-07-25-world-premium-invasion-mobile-design.md)
- [Flightverse mobile command HUD design](superpowers/specs/2026-07-27-flightverse-mobile-command-hud-design.md)
- [Flightverse premium FPV combat arsenal design](superpowers/specs/2026-07-27-flightverse-premium-fpv-combat-arsenal-design.md)
- [Home light theme layout design](superpowers/specs/2026-08-02-home-light-theme-layout-design.md)
- [Scene improvement workspace design](superpowers/specs/2026-08-02-scene-improvement-workspace-design.md)
- [Unified 3D viewer design](superpowers/specs/2026-08-03-unified-3d-viewer-design.md)

## Freshness rules

1. Measured facts include the date, the scene/version and the backend. Label estimates as estimates.
2. Since 2026-09-28, the default compute policy is **PC-only** (`pipeline/compute_policy.py`). All ODM and splat
   jobs run on the RTX PC. `AEROBRAIN_COMPUTE=local` turns the legacy Mac paths on again. The tiers 7K–40K are
   NVIDIA CUDA-only. The Mac-local envelope is legacy: Fast 1K, Medium 2K and legacy custom 500–2,000
   iterations. Details: [Architecture](ARCHITECTURE.md).
3. Strict CUDA keeps the tier and the backend. It retries only `d1→d2` after a classified OOM.
4. A multi-source splat waits for the final saved `reconstruction.json` to pass the check against the
   current shared-component logic.
5. Historical documents stay unchanged. Only supersession or freshness notices can change them.
6. After each edit to `web/` documentation or code, run `pipeline/bump_web_version.py`.
7. The jobs UI, SQLite and the event log hold live job stage, memory and progress. Current Markdown records
   only closed milestones and durable gates. Never write an unqualified `currently running`.
