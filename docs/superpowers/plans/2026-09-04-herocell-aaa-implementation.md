# AeroBrain Hero Cell R0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compilar una escena AeroBrain real en una Hero Cell 100×100 m determinista, truth-aware y exportable a Unreal, con artefactos, tests y aceptación medidos.

**Architecture:** `world_compiler` lee el vault sin mutarlo, selecciona un AOI por evidencia, construye Truth Field/geometría/materiales/completion en capas y promueve atómicamente un `game_scene.v1.json`. Unreal consume ese contrato mediante scripts reproducibles; la ausencia actual del editor se registra como bloqueo externo y no invalida los gates independientes.

**Tech Stack:** Python 3.14, stdlib, NumPy, Pillow, JSON Schema local, OBJ/PLY/GLB existentes, Unreal 5 C++/Python cuando el editor esté disponible.

**Spec:** `docs/superpowers/specs/2026-09-04-herocell-aaa-design.md`

## Global Constraints

- Originales, escenas publicadas y manifests del vault son read-only.
- Todas las escrituras derivadas quedan bajo `/Volumes/SSD/drone-vault/worlds` o dentro del worktree Git.
- Presupuesto externo US$0; ninguna imagen, cámara o ubicación privada sale de las máquinas de Daniel.
- Frame AeroBrain: metros, `+X east`, `+Y up`, `+Z south`; Unreal usa centímetros con mapping `[X,Z,Y]`.
- Toda geometría exportada tiene una clase de provenance; generated nunca reemplaza observed.
- `scene_manifest.build()` y `scene_aoi.py` no se usan como lectores porque escriben derivados.
- Production code sigue RED→GREEN→REFACTOR; cada test nombra el fallo que detecta y ejercita comportamiento real.
- Los gates Unreal/RTX se ejecutan sólo con herramientas reales; resultados ausentes se marcan `blocked_external`.
- El fallo baseline `ac30_cannon/ultra` y la discontinuidad de ops 24 h se registran por separado de regresiones Hero Cell.

---

### Task 1: Safe build identity and filesystem confinement

**Files:**
- Create: `world_compiler/__init__.py`
- Create: `world_compiler/config.py`
- Create: `world_compiler/ids.py`
- Create: `world_compiler/storage.py`
- Create: `world_compiler/tests/test_ids.py`
- Create: `world_compiler/tests/test_storage.py`

**Interfaces:**
- Produces: `canonical_json(value) -> bytes`, `hero_id(request, source_hashes, adapter_hashes) -> str`.
- Produces: `WorldPaths(vault, scene_id, hero_id)` and `atomic_world_build(paths)` context manager.

- [ ] **Step 1: Write failing ID tests**

```python
def test_hero_id_is_order_independent_and_changes_with_source_hash():
    a = hero_id({"scene_id": "scene_a", "size_m": 100}, {"manifest": "aa"}, {})
    b = hero_id({"size_m": 100, "scene_id": "scene_a"}, {"manifest": "aa"}, {})
    c = hero_id({"scene_id": "scene_a", "size_m": 100}, {"manifest": "bb"}, {})
    assert a == b
    assert a != c
    assert a.startswith("hero_") and len(a) == 21
```

- [ ] **Step 2: Run RED**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_ids -v`

Expected: import failure because `world_compiler.ids` does not exist.

- [ ] **Step 3: Implement canonical ID functions**

Use canonical UTF-8 JSON with sorted keys, compact separators and no NaN; hash the request/source/adapters envelope with SHA-256 and expose 16 hex chars.

- [ ] **Step 4: Write and run failing confinement/atomicity tests**

The tests use `tempfile.TemporaryDirectory`, reject a vault path outside `worlds/`, verify failed staging never replaces an accepted directory, and verify a successful build promotes a complete directory with no `.staging-*` residue.

- [ ] **Step 5: Implement `WorldPaths` and `atomic_world_build`**

Resolve every path, require `output_root == vault/worlds`, create staging on the same filesystem, fsync JSON/files where practical, and use `os.replace` only after validation callback success.

- [ ] **Step 6: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_ids world_compiler.tests.test_storage -v`

Commit: `feat(world-compiler): add deterministic safe build storage`

### Task 2: Read-only AeroBrain repository adapter

**Files:**
- Create: `world_compiler/aerobrain/__init__.py`
- Create: `world_compiler/aerobrain/repository.py`
- Create: `world_compiler/aerobrain/manifests.py`
- Create: `world_compiler/tests/fixtures/vault/manifest/scenes/scene_fixture.json`
- Create: `world_compiler/tests/fixtures/vault/models/recon_fixture/scene.v2.json`
- Create: `world_compiler/tests/test_repository.py`

**Interfaces:**
- Produces: `WorldRepository(vault).resolve_scene(scene_id, version_id=None) -> SceneVersion`.
- `SceneVersion` exposes only sanitized IDs, paths, capability facts, active flag, source hashes, world extent and asset availability.

- [ ] **Step 1: Write fixture and failing reader tests**

Test active-version default, explicit historical version, missing capability rejection, path traversal rejection, and absence of filesystem writes by comparing a recursive stat snapshot before/after.

- [ ] **Step 2: Run RED**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_repository -v`

- [ ] **Step 3: Implement strict manifest parsing**

Require scene schema ≥2, version `ready`, merge `SINGLE|FULL`, required artifacts, `scene.v2.json` v2 and real assets. Hash only manifests and selected source files; stream large files in 8 MiB chunks.

- [ ] **Step 4: Verify real candidate facts read-only**

Run a CLI-free Python probe for `scene_0cadd1911f/recon_4e4245a1f4_aoi130` and assert active/aligned/collider-v3 facts. Snapshot mtimes for the scene/model manifests before/after.

- [ ] **Step 5: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_repository -v`

Commit: `feat(world-compiler): read immutable AeroBrain scene inputs`

### Task 3: Explicit coordinate contract

**Files:**
- Create: `world_compiler/aerobrain/coordinates.py`
- Create: `world_compiler/tests/test_coordinates.py`

**Interfaces:**
- Produces: `CoordinateContract(aoi_center_ab_m).ab_to_ue(points)`, `ue_to_ab(points)`, `matrix`, `inverse`, `flip_winding(indices)`.

- [ ] **Step 1: Write failing literal round-trip tests**

Use hand-derived values: AB `[1,2,3]` relative to center maps to UE `[100,300,200]`; eight AOI corners/axes round-trip within `1e-9`; one triangle changes winding exactly once.

- [ ] **Step 2: Run RED**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_coordinates -v`

- [ ] **Step 3: Implement vectorized transforms and inverse**

Reject non-finite/wrong-shape arrays. Serialize matrices row-major and include determinant/handedness metadata.

- [ ] **Step 4: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_coordinates -v`

Commit: `feat(world-compiler): define reversible Unreal coordinates`

### Task 4: Deterministic 100×100 m Hero Cell selection

**Files:**
- Create: `world_compiler/selection/__init__.py`
- Create: `world_compiler/selection/hero_cell.py`
- Create: `world_compiler/selection/view_scoring.py`
- Create: `world_compiler/tests/test_selection.py`

**Interfaces:**
- Produces: `score_candidate(metrics) -> CandidateScore` with the nine approved components.
- Produces: `select_hero_cell(scene, evidence, size_m=100, step_m=10) -> SelectionReport`.

- [ ] **Step 1: Write failing score tests**

Literal fixture proves weights sum to 1, missing metrics earn zero and remain `unavailable`, ties sort by center `(x,z)`, nodata/excess-boundary candidates are rejected, and a fully contained 100 m square wins over a diameter-only claim.

- [ ] **Step 2: Run RED**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_selection -v`

- [ ] **Step 3: Implement scoring and deterministic grid enumeration**

All values clamp to `[0,1]`; report raw/normalized/source/reason per component. Candidate containment uses actual extent/mask, not `coverage.ready` alone.

- [ ] **Step 4: Run a read-only real selection probe**

Use AOI130 metadata/mask to produce top candidate centers without writing the vault. Do not print geographic coordinates; print local center and evidence scores.

- [ ] **Step 5: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_selection -v`

Commit: `feat(world-compiler): select Hero Cell from measured evidence`

### Task 5: Truth Field MVP and provenance schema

**Files:**
- Create: `world_compiler/evidence/__init__.py`
- Create: `world_compiler/evidence/truth_field.py`
- Create: `world_compiler/evidence/visibility.py`
- Create: `world_compiler/schemas/truth_field.v1.schema.json`
- Create: `world_compiler/tests/test_truth_field.py`

**Interfaces:**
- Produces: `TruthClass` enum and `classify_surface(SurfaceEvidence, Calibration) -> TruthSample`.
- Produces: `build_truth_field(samples, cameras, occluder) -> TruthField`.

- [ ] **Step 1: Write failing calibration/visibility tests**

Fixture has one multi-view plane, one single-oblique plane, one occluded patch, one inferred patch and one generated patch. Assert confidence ordering and immutable class semantics.

- [ ] **Step 2: Run RED**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_truth_field -v`

- [ ] **Step 3: Implement bounded evidence scoring**

Keep class separate from confidence. Generated input can never yield an observed class. Unknown has no source camera IDs.

- [ ] **Step 4: Add schema validation and debug legend metadata**

Schema requires version, calibration ID, five classes, confidence range, source camera refs and coverage summary. Legend colors are green/yellow/red/black per approved contract.

- [ ] **Step 5: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_truth_field -v`

Commit: `feat(world-compiler): compute calibrated truth provenance`

### Task 6: Semantic cleanup and layered structural geometry

**Files:**
- Create: `world_compiler/semantics/masks.py`
- Create: `world_compiler/semantics/scene_graph.py`
- Create: `world_compiler/geometry/structuralize.py`
- Create: `world_compiler/geometry/collision.py`
- Create: `world_compiler/tests/test_semantics.py`
- Create: `world_compiler/tests/test_geometry.py`

**Interfaces:**
- Produces: `compose_static_mask(class_masks)`, `SceneGraph`.
- Produces: `GeometryBundle` with six non-overlapping layer descriptors and per-layer provenance.

- [ ] **Step 1: Write failing mask composition tests**

Prove vehicle/person/vegetation transient masks are excluded while adjacent wall pixels remain. Absent detector evidence produces explicit empty masks, not guessed classes.

- [ ] **Step 2: Implement semantic contracts**

Use a stable class enum and mask source/method/confidence metadata.

- [ ] **Step 3: Write failing geometry separation tests**

Fixture planes/roof/ground must yield separate observed/inferred/generated/collision layers; generated overlap with high-confidence observed raises `HallucinationFirewallError`.

- [ ] **Step 4: Implement baseline structuralization**

Use deterministic plane fit/connected components over fixture and published geometry. Collision strips material/UV data and contains only clean ground/major structures.

- [ ] **Step 5: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_semantics world_compiler.tests.test_geometry -v`

Commit: `feat(world-compiler): separate clean geometry and collision layers`

### Task 7: Evidence Atlas and tiered material recipes

**Files:**
- Create: `world_compiler/appearance/camera_selection.py`
- Create: `world_compiler/appearance/evidence_atlas.py`
- Create: `world_compiler/appearance/pbr.py`
- Create: `world_compiler/tests/test_evidence_atlas.py`
- Create: `world_compiler/tests/test_materials.py`

**Interfaces:**
- Produces: `rank_observations(observations) -> list[RankedObservation]`.
- Produces: atlas metadata and `MaterialRecipe` tiers A/B/C with resident-byte estimates.

- [ ] **Step 1: Write failing camera ranking tests**

Literal observations prove occluded/blurred/dynamic samples lose to a sharp, frontal, dense observation; incompatible exposures never blend.

- [ ] **Step 2: Implement Evidence Atlas metadata**

Emit dominant camera index, weights, confidence, generated mask, seam/repair mask and source detail reference.

- [ ] **Step 3: Write failing material budget tests**

Assert 4K allocation is limited to measured tier-A surfaces and total resident unique bytes cannot exceed configured budget.

- [ ] **Step 4: Implement Reality Sandwich recipes**

Store physical base, source microdetail, procedural variation, decals and wetness separately. No raw capture lighting is treated as roughness/normal truth.

- [ ] **Step 5: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_evidence_atlas world_compiler.tests.test_materials -v`

Commit: `feat(world-compiler): preserve camera evidence in PBR recipes`

### Task 8: Completion escrow and active reflight

**Files:**
- Create: `world_compiler/completion/hypotheses.py`
- Create: `world_compiler/completion/validator.py`
- Create: `world_compiler/completion/missing_views.py`
- Create: `world_compiler/tests/test_completion.py`

**Interfaces:**
- Produces: `validate_hypothesis(hypothesis, observations) -> RefutationReport`.
- Produces: `rank_missing_views(truth_field, visibility) -> MissingViewsReport`.

- [ ] **Step 1: Write failing render-to-refute tests**

Reject silhouette crossing, observed-corner mismatch and neighbor penetration; accept the strongest non-refuted rule-based hypothesis while retaining all scores.

- [ ] **Step 2: Implement escrow validator**

Every accepted hypothesis remains `GENERATED_CONSTRAINED` with method, constraints, seed and source observations.

- [ ] **Step 3: Write and implement missing-view ranking tests**

Higher uncertainty × gameplay visibility ranks first. Output contains local camera position, AGL, pitch, heading, orbit/pass radius, expected information gain, reason and safety/legal note field.

- [ ] **Step 4: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_completion -v`

Commit: `feat(world-compiler): escrow completion and recommend reflights`

### Task 9: Game scene schema, compiler CLI and real build

**Files:**
- Create: `world_compiler/schemas/game_scene.v1.schema.json`
- Create: `world_compiler/export/manifest.py`
- Create: `world_compiler/cli.py`
- Create: `world_compiler/__main__.py`
- Create: `world_compiler/tests/test_manifest.py`
- Create: `world_compiler/tests/test_cli.py`

**Interfaces:**
- Produces CLI: `python3 -m world_compiler build --scene ID --version ID --size 100 --center auto --profile hero-r0`.
- Produces: complete promoted world directory and machine-readable stdout summary without private geographic coordinates.

- [ ] **Step 1: Write failing schema/CLI tests**

Assert required transforms/inverse, six geometry roles, provenance coverage, source hashes, materials, reference cameras, missing views, dependency hashes, cost and run records. Invalid asset escape fails before staging.

- [ ] **Step 2: Implement manifest builder and CLI orchestration**

Use Tasks 1–8 boundaries; `--dry-run` performs no writes; normal build writes only `worlds/`.

- [ ] **Step 3: Run fixture build twice**

Assert identical Hero ID and byte-identical canonical JSON. Inject a failure before promotion and prove accepted output remains unchanged.

- [ ] **Step 4: Run first real AOI130 build**

Compile `scene_0cadd1911f/recon_4e4245a1f4_aoi130`, size 100, center auto. Record local-only selection report and source hashes; do not emit WGS84 in Git.

- [ ] **Step 5: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest discover -s world_compiler/tests -v`

Commit: `feat(world-compiler): compile reproducible game scene manifest`

### Task 10: Architecture, model intake and operational docs

**Files:**
- Create: `docs/HEROCELL_ARCHITECTURE.md`
- Create: `docs/HEROCELL_MODEL_INTAKE.md`
- Create: `world_compiler/schemas/model_intake.v1.schema.json`
- Create: `world_compiler/model_intake.py`
- Create: `world_compiler/tests/test_model_intake.py`

**Interfaces:**
- Produces: `evaluate_model_intake(record) -> production|research-only|rejected`.

- [ ] **Step 1: Write failing license/privacy gate tests**

Reject missing checkpoint hash/license, private upload without opt-in, noncommercial weights for production and unmeasured hardware claims.

- [ ] **Step 2: Implement intake validator and baseline records**

Register existing ODM/OpenSfM/OpenMVS as production baseline; record optional MapAnything/DepthAnything/VGGT/WorldLabs as not evaluated without downloading or uploading data.

- [ ] **Step 3: Document boundaries and reproducible commands**

Architecture doc maps existing AeroBrain contracts to compiler modules and records the selected AOI/version decision.

- [ ] **Step 4: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_model_intake -v`

Commit: `docs: define Hero Cell architecture and model intake`

### Task 11: Unreal project and headless importer contract

**Files:**
- Create: `unreal/DroneWorld/DroneWorld.uproject`
- Create: `unreal/DroneWorld/Config/DefaultEngine.ini`
- Create: `unreal/DroneWorld/Config/DefaultGame.ini`
- Create: `unreal/DroneWorld/Scripts/import_hero_cell.py`
- Create: `unreal/DroneWorld/Scripts/build_hero_cell.py`
- Create: `unreal/DroneWorld/Scripts/capture_reference_views.py`
- Create: `unreal/DroneWorld/Scripts/run_acceptance.py`
- Create: `world_compiler/tests/test_unreal_contract.py`

**Interfaces:**
- Importer consumes only `game_scene.v1.json` and emits `unreal/import_report.json` with engine/project/version, assets, layers, materials, shader status, cameras and errors.

- [ ] **Step 1: Write failing pure-Python importer contract tests**

Validate transform, asset paths, provenance layers, reference camera definitions and generated-content rebuild recipe without importing `unreal` outside the editor.

- [ ] **Step 2: Implement project/config/scripts**

Inside Unreal, import observed/inferred/generated/collision separately, create parameterized day/sunset/night/rain profiles and F8 provenance material mode. Outside Unreal, fail with a structured `blocked_external` report.

- [ ] **Step 3: Run local contract tests**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_unreal_contract -v`

- [ ] **Step 4: Run real editor gate when available**

Run: `UnrealEditor-Cmd unreal/DroneWorld/DroneWorld.uproject -run=pythonscript -script=unreal/DroneWorld/Scripts/import_hero_cell.py -- <game_scene>`.

Current expected result: `blocked_external` because no Unreal executable is installed.

- [ ] **Step 5: Commit**

Commit: `feat(unreal): add reproducible Hero Cell importer`

### Task 12: Playable drone slice

**Files:**
- Create: `unreal/DroneWorld/Source/DroneWorld/DroneWorld.Build.cs`
- Create: `unreal/DroneWorld/Source/DroneWorld/DroneWorld.cpp`
- Create: `unreal/DroneWorld/Source/DroneWorld/ABDronePawn.h`
- Create: `unreal/DroneWorld/Source/DroneWorld/ABDronePawn.cpp`
- Create: `unreal/DroneWorld/Source/DroneWorld/ABDroneHUD.h`
- Create: `unreal/DroneWorld/Source/DroneWorld/ABDroneHUD.cpp`
- Create: `unreal/DroneWorld/Config/DefaultInput.ini`
- Create: `world_compiler/tests/test_drone_route_contract.py`

**Interfaces:**
- Pawn supports hover, FPV/third-person, AGL, collision, reset, HUD and deterministic acceptance route.

- [ ] **Step 1: Write failing route contract tests**

Validate the route JSON contains 30 s of monotonic samples inside AOI bounds, starts above valid ground and names both camera modes.

- [ ] **Step 2: Implement Unreal module and pawn**

Keep physics/config values explicit and route replay deterministic. Reuse compiler collision and spawn/reference points.

- [ ] **Step 3: Run static contract checks**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_drone_route_contract -v`.

- [ ] **Step 4: Run compile/play gate when Unreal is available**

Record hover drift, clipping, reset, camera jitter and 30-second completion in import/acceptance reports.

- [ ] **Step 5: Commit**

Commit: `feat(unreal): add Hero Cell drone flight slice`

### Task 13: QA metrics and acceptance report

**Files:**
- Create: `world_compiler/qa/geometry_metrics.py`
- Create: `world_compiler/qa/performance.py`
- Create: `world_compiler/qa/report.py`
- Create: `world_compiler/tests/test_qa.py`
- Create: `docs/HEROCELL_001_ACCEPTANCE.md`

**Interfaces:**
- Produces: `metrics.json`, `acceptance.md`, verdict `accepted|partially accepted|blocked`.

- [ ] **Step 1: Write failing metric/verdict tests**

Literal distributions verify median/p95, provenance totals sum to 100%, FPS/1%-low/VRAM gates, missing measurements cannot pass, and external-tool absence yields partial/blocked rather than fabricated success.

- [ ] **Step 2: Implement metric aggregation and report writer**

Report exact source scene/version, Hero ID, paths, commands, costs, model intake, truth breakdown, defects and 200×200 decision.

- [ ] **Step 3: Produce real current report**

Include successful compiler evidence, baseline failures, missing Unreal/RTX measurements and one exact operator action only if it remains the final hard blocker.

- [ ] **Step 4: Verify and commit**

Run: `/Volumes/SSD/_system/venv/bin/python3 -m unittest world_compiler.tests.test_qa -v`

Commit: `docs: record Hero Cell R0 measured acceptance`

### Task 14: Full regression and branch closure

**Files:**
- Modify only files required by failures attributable to Hero Cell; reproduce each with a failing regression test first.

**Interfaces:**
- Produces final clean branch and measured completion report; no merge/push.

- [ ] **Step 1: Run compiler suite and fresh rebuild**

```bash
/Volumes/SSD/_system/venv/bin/python3 -m compileall -q pipeline ai world_compiler
/Volumes/SSD/_system/venv/bin/python3 -m unittest discover -s world_compiler/tests -v
python3 -m world_compiler build --scene scene_0cadd1911f --version recon_4e4245a1f4_aoi130 --size 100 --center auto --profile hero-r0
```

- [ ] **Step 2: Run existing gates without masking exit codes**

```bash
/Volumes/SSD/_system/venv/bin/python3 pipeline/test_smoke.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_vault.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_splats.py
/Volumes/SSD/_system/venv/bin/python3 pipeline/audit_world.py --all --vault /Volumes/SSD/drone-vault
```

- [ ] **Step 3: Run Unreal/RTX gates or preserve structured blockers**

Require five fixed shots, 30-second route, avg/1%-low/VRAM and Mac stability from real runs. If tools remain absent, acceptance stays partial and 200×200 expansion is rejected.

- [ ] **Step 4: Verify Git/source integrity**

Compare original source hashes/snapshots, confirm outputs only under `worlds/`, inspect `git status`, `git diff --check` and commit history.

- [ ] **Step 5: Final local commit**

Commit: `chore: finalize measured Hero Cell R0 evidence`
