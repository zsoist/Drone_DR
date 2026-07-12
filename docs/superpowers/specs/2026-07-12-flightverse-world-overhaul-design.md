# FLIGHTVERSE World and Invasion Overhaul Design

**Status:** Approved design baseline
**Date:** 2026-07-12
**Repository:** AeroBrain
**Branch:** `codex/world-overhaul`

## Goal

Turn the FLIGHTVERSE world and Invasion mode into a deterministic, terrain-aware, visually coherent, production-quality game slice. The overhaul must repair the defects introduced or left unverified in v113-v116 while preserving the real-photogrammetry premise, the existing world-to-flight flow, and all platform constraints.

The finished experience must support a ground-zombie preset and a mixed Invasion mode with seven original enemy classes. Every class must spawn, navigate or fly, attack, take damage, die, clean up, and pass deterministic gameplay, visual, and performance gates.

## Product Contract

- The world is the operator's real Bogotá photogrammetry. The game may deform the DSM-backed game terrain, but must never claim to destroy the Gaussian splat.
- All enemies, models, names, sounds, and effects must be original and brand-free.
- UI text is Spanish. UI icons are SVG; no emoji UI.
- The Invasion dock control remains the entry point. The selector includes a one-action `Zombies en tierra` preset that preserves the original ground-zombie request.
- Desktop, iPad, and 390x844 mobile layouts are first-class.
- Missing scene capabilities or invalid optional GLBs must produce an honest Spanish explanation and a safe procedural fallback, never a silent failure.
- The existing Gate Rush, Director, recording, export, world selection, and flight modes must continue working.

## Hard Technical Constraints

- Vanilla JavaScript ES modules, no build step, and no runtime npm dependencies.
- Use vendored Three.js r180 only through `web/flightverse/three.js`.
- Respect the current strict CSP: no CDNs, external fetches, or `eval`.
- Simulation runs at the existing fixed `STEP = 1 / 120`.
- Replayable game logic must not use `Date.now()`, `performance.now()`, `setTimeout()`, or unseeded `Math.random()`.
- Rendering interpolates simulation state; render cadence must not change gameplay results.
- After any web edit, run `python3 pipeline/bump_web_version.py` to update fingerprints and `.gz` sidecars.
- Required browser acceptance: zero console errors and at least 50 FPS in the project CDP environment.
- Model budgets remain: drone <=120k triangles, enemy <=80k, prop <=40k, embedded enemy textures <=2048 square, at most six enemy materials.

## Audit Findings Addressed

The design explicitly repairs these observed defects:

1. `weapons.update()` and `invasion.update()` run from `render()` with wall-clock deltas instead of the fixed simulation loop.
2. The existing gate accepts 20 FPS although the documented contract requires 50 FPS.
3. The gate proves that an enemy exists, not that it moves, attacks, damages, dies, or cleans up.
4. GLB UFOs and dragons enter code that assumes procedural-only animation nodes.
5. GLB collision radii are squared and then treated as linear radii.
6. Airplanes have no damaging attack.
7. Player health can reach zero without defeat, pause, retry, or exit behavior.
8. Ground enemies use straight-line stepping and freeze at cliffs or obstacles.
9. An unspawnable queue item can stall a wave forever.
10. Soldier burst `setTimeout()` callbacks can fire after Invasion mode stops.
11. Optional GLB load errors are swallowed, so fallback status is unverifiable.
12. The current 84 m-altitude screenshots do not validate ground enemies visually.
13. The mobile selector leaves excessive live-game HUD clutter visible behind it.
14. Game-state randomness inside fixed-step code violates the replay contract.
15. Endpoint-only projectile collision can tunnel through enemies at high speed.

## Architecture

### 1. Deterministic simulation: `web/flightverse/invasion-sim.js`

This module owns replayable state and has no Three.js or DOM dependency. It exports:

- a seeded PRNG with serializable state;
- enemy definitions and wave planning;
- mode states: `stopped`, `loading`, `running`, `betweenWave`, and `defeated`;
- enemy lifecycle states: `spawning`, `moving`, `telegraph`, `attacking`, `recovering`, `dying`, and `dead`;
- fixed-step schedules for bursts, cooldowns, damage, invulnerability windows, wave transitions, and defeat;
- deterministic event output for rendering, audio, UI, and projectiles.

The seed is explicit in QA and derived from scene ID plus a local run counter during normal play. Given the same seed, selected enemies, inputs, and terrain query results, the simulation must emit identical state hashes.

### 2. Terrain navigation: `web/flightverse/invasion-navigation.js`

Navigation uses the real `heightAt(x, z)` sampler and the existing collision query.

- Build bounded local grids around the player using cached DSM samples.
- Maintain separate human and giant profiles for footprint, maximum step, and slope cost.
- Mark nodata, excessive slope, buildings, and invalid terrain as blocked.
- Rebuild only when the target crosses a grid cell, the relevant terrain is cratered, or the cache expires.
- Generate reverse flow fields from the player target so many enemies share one path solution.
- Add deterministic separation steering to prevent stacking without changing reachability.
- Select spawn cells from reachable rings, not arbitrary points.
- Give each queued spawn a finite attempt budget. If no reachable cell exists, skip it and emit `NO_HAY_SUELO_TRANSITABLE`; never stall the wave.
- Sample and smooth visual Y placement independently from logical reachability so movement does not stair-step.

Navigation work is time-budgeted and cached. The expected steady-state limit is two flow fields and no per-enemy A* search.

### 3. World adapter and models: `web/flightverse/invasion.js`

`invasion.js` becomes the Three.js adapter rather than the source of game truth.

- Create a stable entity root for position, heading, hit bounds, and lifecycle.
- Attach either a procedural visual or a cloned GLB visual beneath that root.
- Map semantic animation actions (`move`, `attack`, `hit`, `death`, `idle`) without exposing model-specific nodes to shared movement code.
- Await selected GLBs before wave one. The loading state shows progress and remains cancellable.
- Validate finite bounds, real-world scale, ground/flying origin, forward axis metadata when available, and required `walk` or `fly` plus `attack` clips.
- Invalid models fall back to procedural visuals and record a structured reason in `window.__volar.capabilities.enemies`.
- Use one linear `hitRadiusM` contract everywhere.
- Cross-fade movement and attack clips, use `LoopOnce` with `clampWhenFinished` for attacks and deaths, and restore locomotion after recovery.
- Replace browser timers with simulation events.
- Stop and dispose mixers, projectiles, cloned roots, and temporary resources on disable or page teardown.

Procedural visuals remain a complete fallback and expose semantic animation hooks rather than hard-coded fields such as `ring`, `wL`, or `segs` in shared branches.

### 4. Combat and weapons: `web/flightverse/weapons.js`

- Move all weapon updates to the fixed simulation step.
- Use seeded spread for the MG and deterministic effect seeds for replay/export.
- Replace endpoint collision with swept segment-versus-sphere collision for bullets and projectiles.
- Use `hitRadiusM` for enemies and preserve the existing squared-radius contract for scene objects behind an explicit adapter.
- Preserve the MG and S/M/L arsenal, ammo regeneration, cooldowns, hardpoints, craters, rubble, residual fires, and capped particle systems.
- Pool short-lived bullets and enemy projectiles to reduce allocation spikes.
- Separate gameplay damage from visual effect intensity.
- Keep VFX caps, remove per-fragment shadows, and ensure disabled modes leave no live projectile or scheduled attack.

## Enemy Behaviors

Every behavior uses the same lifecycle and event contracts.

| Enemy | Movement | Attack | Counterplay |
|---|---|---|---|
| Zombie | Human flow field, slow pursuit, separation | Short telegraphed lunge and grab | Maintain altitude/distance; interrupt during telegraph |
| Archer | Human flow field, holds a firing band | Predictive ballistic arrow | Change direction or break line of sight |
| Soldier | Faster flow field, lateral repositioning | Deterministic three-round burst | Use terrain, movement, and attack recovery window |
| UFO | Closing orbit with minimum terrain clearance | Charged plasma shot | Read the charge pulse and dodge |
| Airplane | Repeating approach, strafe, exit, and re-entry path | Telegraphed cannon strafe | Move perpendicular to the attack lane |
| Dragon | Pursuit with bounded serpentine offset and terrain clearance | Telegraph followed by fire projectile or short cone | Break range during wind-up |
| Giant | Giant flow field, slow turns, broad separation | Radial stomp with visible warning ring | Gain distance before impact |

Counts, health, and speed scale by wave within explicit caps. Attack frequency and projectile density also have caps so later waves become harder without making 50 FPS impossible.

## Player and Mode Lifecycle

- Starting Invasion resets health, score, wave state, schedules, and deterministic seed.
- Disabling the mode cancels all pending simulation events and removes all active enemies/projectiles in the same fixed step.
- Health reaching zero transitions once to `defeated`; damage and spawning stop.
- The defeat UI offers `REINTENTAR`, `CAMBIAR ENEMIGOS`, and `SALIR`.
- Retry uses the same selection and a new normal-play seed; QA may request the same seed.
- Player damage has a short fixed invulnerability window to prevent multiple overlapping projectiles from deleting health in one frame.
- Wave transition occurs only after all live, dying, queued, and scheduled enemies are resolved.

## UI and Accessibility

- Add a modal backdrop that visually quiets the game and blocks pointer input behind the selector.
- Trap focus within the selector, close with Escape, restore focus to the dock button, and expose pressed/selected states through ARIA.
- Provide concise Spanish behavior descriptions for each enemy.
- Add `ZOMBIES EN TIERRA` as the fast preset and retain multi-selection for mixed invasions.
- Show loading/fallback status before starting a wave.
- Keep player health, wave, active enemies, kills, selected weapon ammo, and cooldown readable without covering the center reticle.
- Show a boss bar only for the currently engaged giant or dragon.
- On 390x844, collapse nonessential dock controls while the selector or defeat dialog is open and keep all actions inside safe-area bounds.
- Respect `prefers-reduced-motion` for HUD animation without changing gameplay timing.

## Data Flow

1. `volar.js` accepts UI or QA input and requests a mode transition.
2. The model adapter loads or rejects optional GLBs and reports capabilities.
3. `invasion-sim.js` starts with a selection and seed.
4. Each `createLoop.update(STEP)` advances player physics, navigation budgets, invasion simulation, weapons, and projectiles in a stable order.
5. Simulation emits events. The Three.js adapter updates entity targets and starts semantic animations; audio and UI consume the same events.
6. `render(alpha)` only interpolates transforms, updates visual mixers/effects, and renders. It does not apply gameplay damage, spawn entities, advance cooldowns, or create attacks.
7. QA reads structured state and event counters from `window.__volar`.

## Error Handling and Honest Degradation

- No DSM or no reachable ground: disable ground selections with a clear Spanish reason; flying selections may still run.
- No collision proxy: ground navigation uses DSM-only slope/nodata rules and reports that limitation.
- Missing/invalid GLB: use procedural fallback and expose the exact reason.
- Missing required animation: reject that GLB rather than silently using an unrelated first clip.
- Spawn budget exhausted: skip the spawn, count it, continue the wave, and surface the diagnostic in QA.
- Runtime model exception: isolate and replace the visual with the procedural fallback without corrupting simulation state.
- Performance governor may lower optional VFX density, never simulation frequency or damage rules.

## Performance Design

- Target 60 FPS; hard acceptance floor 50 FPS in the existing CDP environment.
- Reuse geometry and materials across procedural enemies.
- Pool projectiles, warning decals, hit flashes, and other short-lived objects.
- Do not cast shadows from particles, debris fragments, projectiles, or every child of an enemy GLB. Select only bounded primary meshes when allowed by the quality tier.
- Cap active enemies, projectiles, particles, residual fires, rubble, and simultaneous boss enemies.
- Update distant animation mixers at a reduced visual cadence while simulation remains fixed.
- Recompute navigation fields incrementally and only when invalidated.
- Record peak active counts and per-system timing in QA diagnostics.

## Testing Strategy

### Pure deterministic tests

Use Node's built-in test runner with no npm packages. Tests cover:

- identical seed/input produces identical state hashes;
- different seeds alter placement while preserving invariants;
- wave planning and caps for all seven types;
- fixed-step burst scheduling and cancellation;
- damage, invulnerability, death, defeat, retry, and stop;
- finite spawn failure and wave progress;
- navigation around blocked cells, nodata, cliffs, and crater invalidation;
- human versus giant footprints;
- projectile sweep collision and radius contracts;
- airplane attack events;
- cleanup leaves zero entities, projectiles, schedules, and mixers.

Every behavioral change follows red-green-refactor: introduce a failing regression test, verify the expected failure, implement the smallest passing change, then run the related and full suites.

### Browser gameplay gates

Extend the QA contract with an explicit seed and deterministic low-altitude setup. For each enemy type, assert:

- mode reaches `running`;
- expected count spawns on valid terrain or valid airspace;
- at least one enemy moves meaningfully;
- at least one attack event occurs;
- player damage occurs when QA holds position;
- the enemy takes weapon damage and dies;
- stopping the mode produces zero remaining live objects and schedules;
- no console errors occur;
- FPS is at least 50.

Mixed-wave, defeat/retry, unwalkable-terrain, missing-GLB, invalid-GLB, and deterministic-repeat scenarios receive separate gates. The gate itself fails when `fps < 50`; it does not merely trust `report.ok`.

### Visual QA

- Capture low-altitude desktop evidence for the ground-zombie preset and each enemy family.
- Capture selector, active HUD, damage, boss bar, defeat, and retry states.
- Capture mobile 390x844, iPad, and desktop layouts.
- Inspect terrain contact, foot placement, obstacle routing, projectile readability, attack telegraphs, modal backdrop, safe areas, and absence of HUD collisions.
- Run the required Flightverse browser matrix after the focused gates.

### Full verification

- `node --check` for all modified JavaScript modules.
- Node deterministic/unit suite.
- `/Volumes/SSD/_system/venv/bin/python pipeline/test_smoke.py`.
- Focused per-enemy and mixed-invasion CDP gates.
- `python3 pipeline/browser_matrix.py <clip_id> --flightverse`.
- `python3 -m py_compile pipeline/*.py ai/*.py` when Python gate code changes.
- `python3 pipeline/bump_web_version.py`, followed by a clean diff check confirming source and `.gz` parity.

## Acceptance Criteria

The overhaul is complete only when all of the following are proven by current evidence:

1. The zombie-ground preset starts from the UI and produces grounded, reachable zombies.
2. All seven enemy types have distinct movement and damaging attacks.
3. Ground enemies route around blocked terrain and never stall the wave indefinitely.
4. Flying enemies maintain valid terrain clearance.
5. Procedural and valid GLB visuals use the same simulation without model-specific crashes.
6. Invalid or missing GLBs fall back honestly with a recorded reason.
7. Player damage, defeat, retry, selection change, and exit work.
8. MG and missiles damage enemies reliably at high projectile speeds.
9. Disabling or restarting leaves no stale attacks, projectiles, models, timers, or mixers.
10. Repeating the same deterministic QA scenario produces the same state hash.
11. Browser gameplay gates cover movement, attacks, damage, death, cleanup, and performance for every enemy type.
12. Low-altitude screenshots prove ground contact and visual readability on desktop and mobile.
13. All focused tests, full smoke tests, and the Flightverse browser matrix pass.
14. Every browser gate reports zero console errors and at least 50 FPS.
15. CSP, vanilla-ESM, honesty, original-content, versioning, and asset-budget constraints remain intact.

## Non-Goals

- Copying code, models, textures, audio, maps, or identifiable characters from Black Ops, Attack on Titan, or any other franchise.
- Replacing the existing renderer or adding a new physics engine.
- Generating final ultra-HD enemy GLBs in this implementation. The engine and validation path will be proven with a deterministic fixture; production GLBs remain separate assets governed by `docs/ENEMY_MODEL_SPEC.md`.
- Reworking unrelated AeroBrain ingestion, ODM, splat training, Studio, or account flows.
- Claiming visual AAA fidelity from procedural fallback geometry. The target is production-grade mechanics, integration, presentation, and asset readiness with honest fallbacks.

## Rollout and Recovery

- Work stays on `codex/world-overhaul` until all gates pass.
- Commit by independently testable behavior rather than one large diff.
- Preserve existing URL parameters while adding deterministic QA parameters.
- Keep procedural fallbacks so models can be introduced one at a time.
- If a new behavior misses the performance floor, reduce optional visual density or update cadence, not gameplay correctness.
- The previous v116 behavior remains recoverable from Git; no destructive migration or external-state change is required.
