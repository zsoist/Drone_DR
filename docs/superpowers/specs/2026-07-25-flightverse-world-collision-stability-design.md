# FLIGHTVERSE World Collision and Stability Design

**Date:** 2026-07-25

**Status:** Approved by the operator
**Scope:** `web/flightverse/`, `web/volar.js`, world publication, collision assets, and deployment gates

## Problem

FLIGHTVERSE currently renders real photogrammetry, but its gameplay collision contract is incomplete:

- six of eleven published models have no structural collider, including the active stable-site reconstruction;
- bullets and missiles sample only their final point for each rendered frame and never query the structural BVH;
- the drone queries the BVH only at its final position and temporarily disables collision after becoming stuck;
- world boundaries exist only when a diameter is explicitly selected;
- a visual mesh hides the entire DSM, including areas and holes not covered by valid mesh triangles;
- the mixed view may render mesh and splat representations of the same structure simultaneously;
- asynchronous scene layers have no shared generation token or complete teardown contract;
- existing browser gates accept worlds without colliders and accept a visual result with holes, floating edge fragments, or duplicated representations;
- the runtime gate accepts 20 fps although the documented contract requires 50 fps.

These are systemic contract failures, not isolated tuning issues.

## Goals

1. The drone cannot tunnel through structural geometry at any supported non-noclip speed.
2. Bullets and missiles hit the earliest real obstacle along their swept path.
3. Missiles support deterministic proximity fuses for live targets while static structures use exact contact.
4. Every active, flyable world with a mesh has a valid structural collider before it is publishable.
5. The playable boundary is always explicit and enforced, including Auto coverage.
6. A visible point has one authoritative structural representation. Mesh, splat, and DSM do not overlap as duplicate buildings.
7. Mesh holes and boundaries fall back to DSM/orthophoto without exposing the sky below the world or reintroducing doubled structures.
8. Re-entry, reload, stale asynchronous completion, or scene replacement cannot duplicate scene layers.
9. Automated gates reject missing collision, tunneling, invalid borders, duplicate layers, visual holes, console errors, and performance below 50 fps.
10. A deterministic 100-run stress gate must pass before the work is approved.

## Non-goals

- The real photogrammetry asset is not destructively modified by gameplay explosions.
- FLIGHTVERSE will not add Rapier or another runtime dependency.
- The project will not add a browser build step, CDN dependency, or CSP exception.
- Noclip in God mode remains intentionally exempt from physical collision.
- This work does not attempt to reconstruct geometry that the captured source data never observed.

## Approaches Considered

### Selected: unified world-query service on three-mesh-bvh

Load the collision geometry once and expose deterministic queries shared by flight and weapons. Use segment casts for fast projectiles, conservative sphere sweeps for the drone, DSM segment intersection for the ground, and a single playable-boundary contract.

This reuses the vendored BVH, keeps CSP and the no-build architecture intact, and makes the collision behavior testable through one interface.

### Rejected: patch each current point sampler

Sub-stepping bullets, missiles, and the drone independently would reduce some tunneling but preserve duplicated logic, inconsistent hit ordering, missing structural collision, and frame-rate dependence.

### Rejected: introduce a full rigid-body engine

Rapier would provide continuous collision primitives but adds WASM lifecycle, integration, CSP, determinism, and performance risk that is unnecessary for the current kinematic drone and projectile model.

## Architecture

### 1. Collision asset contract

`pipeline/collision_bake.py` becomes a publication-grade collider builder with two accepted sources:

1. an existing aligned `collision.collision.glb`; or
2. the published viewer OBJ plus `mesh_offset`, transformed with the same mapping used by `attachVisualMesh`.

The builder:

- triangulates supported OBJ faces;
- transforms vertices into FLIGHTVERSE world coordinates;
- removes non-finite and degenerate triangles;
- filters triangles to a DSM-relative vertical band;
- compacts unused vertices;
- records source path, source size/mtime fingerprint, bounds, vertex count, triangle count, and format version;
- writes `collision.bin` and `collision.json` atomically;
- refuses empty, implausibly small, non-finite, or out-of-world results.

Publication and manifest generation must build or validate this asset automatically whenever a flyable mesh is present. `scene.v2.json` declares a versioned collision capability only after validation.

### 2. Unified world-query service

A focused browser module owns:

- structural BVH loading and validation;
- `closestStructure(point, maxDistance)`;
- `castStructureSegment(start, end, radius)`;
- `castGroundSegment(start, end, radius)`;
- `castWorldSegment(start, end, radius)`, returning the earliest hit;
- `sweepDrone(start, end, radius)`;
- boundary projection and inward normal;
- load state and scalar QA counters;
- deterministic disposal.

Every hit returns a plain contract:

```js
{
  kind: 'structure' | 'terrain' | 'boundary',
  point: THREE.Vector3,
  normal: THREE.Vector3,
  distance: number,
  fraction: number
}
```

The service never exposes the BVH or Three.js object graph through `window.__volar`.

### 3. Drone collision

Each fixed 1/120-second physics step retains the previous position and sweeps the drone sphere to the proposed position.

- The first impact resolves at a skin distance before contact.
- Remaining motion is projected onto the contact plane for sliding.
- A bounded second sweep handles corners.
- Inward velocity is removed; tangential velocity is preserved with small impact friction.
- Initial penetration uses deterministic depenetration from the closest point.
- The old timed collision-disable escape is removed.
- Repeated unresolved penetration restores the last known safe pose and zeros inward velocity; it never disables collision.
- God mode remains noclip.

### 4. Projectile collision and proximity

Weapon simulation moves from render-time wall-clock delta to the fixed gameplay update.

For every bullet or missile step:

1. retain the start point;
2. integrate velocity deterministically;
3. compute the proposed end point;
4. find the earliest hit among dynamic targets and `castWorldSegment`;
5. place the projectile at the exact hit point;
6. apply one impact and remove it.

Dynamic targets use segment-versus-sphere intersection rather than endpoint distance. The existing target radius contract is normalized so every target stores `radius` and `radiusSq`; squared values are never squared a second time.

Missile proximity is target-only:

- S, M, and L tiers use explicit fuse radii scaled to their blast tier;
- only living enemies or intact destructibles can trigger the fuse;
- line-of-sight against the structural world must be clear;
- static structures and terrain detonate only on swept contact;
- the chosen trigger and hit kind are exposed as scalar QA counters.

### 5. Playable boundaries

Every flyable scene gets an effective boundary:

- selected verified circle or square when the operator requests one;
- otherwise the valid DSM rectangle inset by the drone radius;
- if a site coverage product is active, the effective boundary cannot exceed its verified extent.

The drone sweeps against the boundary plane/curve and slides along it. Projectiles detonate at the boundary instead of flying through an undefined world. UI and QA report the effective shape, size, hit count, and whether it came from explicit coverage or native terrain.

### 6. Visual representation and border continuity

The renderer becomes an explicit state machine:

- `terrain`: DSM/orthophoto only;
- `mesh`: visual mesh plus DSM only where the mesh coverage mask is absent;
- `splat`: aligned splat plus DSM only outside its trusted footprint;
- no mode renders mesh and splat structures simultaneously.

The selected state respects `coverageProduct.preferred_renderer`. If the preferred asset is unavailable or unaligned, fallback is deterministic: mesh, then terrain.

The mesh publication path produces a grid-aligned coverage mask by rasterizing valid mesh triangles in world XZ. The mask is dilated slightly and feathered in the terrain shader. DSM is discarded under covered mesh triangles and remains visible in real holes and outside the mesh boundary. This removes duplicate buildings without opening the world to the sky.

The runtime reports one active structural representation. A gate fails if more than one is visible for the same structural footprint.

### 7. Scene lifecycle and duplicate prevention

All asynchronous layer loads receive a scene-generation token. A stale completion disposes its asset immediately instead of adding it.

Each layer handle implements idempotent `dispose()` and removes:

- scene nodes;
- geometries, materials, and owned textures;
- Spark meshes and the shared Spark renderer when its refcount reaches zero;
- event listeners and pending callbacks.

`pagehide` and explicit teardown stop the loop and dispose the complete world. Boot has a single-flight guard so bfcache or repeated initialization cannot create another terrain, mesh, splat, objects, weapons, or drone group.

### 8. Error handling

- A flyable mesh without a valid collider is `collision: blocked`, not silently collision-free.
- Terrain-only worlds remain playable with terrain and boundary collision and explicitly report `structure_collision: unavailable`.
- Corrupt collider metadata, mismatched byte lengths, non-finite bounds, and stale source fingerprints fail closed.
- Unsupported preferred renderers visibly fall back and record a scalar reason.
- Browser reports remain plain serializable data.

## Testing Strategy

### Unit and contract tests

Tests are behavioral and use literal fixtures:

- segment-sphere hit, miss, tangent, starting-inside, and earliest-target cases;
- terrain segment crossing between endpoints;
- circle and square boundary crossing;
- high-speed drone wall impact;
- wall slide and corner second-contact behavior;
- deterministic depenetration and last-safe recovery;
- missile and MG structure impact between frames;
- target proximity with and without structural line of sight;
- no double-squaring of enemy radii;
- collider builder OBJ transformation, degenerate filtering, vertical-band filtering, atomic metadata, and stale fingerprint rejection;
- active-world audit rejects any flyable mesh without a valid collider;
- visual-state reducer never enables mesh and splat together;
- stale scene-generation completion disposes instead of attaching.

Every production behavior is introduced through a red-green cycle.

### Browser gates

The FLIGHTVERSE gate gains deterministic scenarios:

- drone approaches a real collider and stops at the modeled surface;
- boosted drone cannot tunnel through it;
- MG and each missile tier hit the structure before the terrain behind it;
- a proximity missile triggers near a target but not through a wall;
- native and requested boundaries stop both drone and missiles;
- active representation matches the coverage preference;
- scene group names are unique;
- renderer reports no invalid numbers, errors, or duplicated structural layers;
- mobile, iPad, and desktop remain at least 50 fps after warm-up.

Visual checks measure the bottom/background continuity and representation state rather than accepting the mere existence of a canvas.

### Stress and deployment gate

A deterministic stress runner executes 100 complete collision scenario iterations in one browser session while checking:

- identical hit classifications and bounded hit coordinates;
- stable scene/group counts;
- no growth in live missiles, bullets, parts, listeners, Spark workers, or renderer memory counters after cleanup;
- no console errors or unhandled rejections;
- no frame below the agreed sustained performance gate due to accumulated resources.

CI and local publish checks run the active-world collider audit and the collision browser gate. A failed gate blocks publication; “100 deploys” is enforced by making the invariant part of every deployment rather than relying on a one-time manual claim.

## Acceptance Criteria

The work is approved only when:

1. every current active flyable mesh has a validated collider;
2. the active stable-site reconstruction reports structural collision in the browser;
3. deterministic high-speed tests prove no projectile or drone tunneling;
4. proximity behavior passes visible-target and occluded-target tests;
5. Auto coverage enforces a native world boundary;
6. the 1000 m active-world view respects its terrain preference;
7. mesh coverage fallback removes the visible sky holes without duplicate buildings;
8. scene reload/re-entry tests keep exactly one instance of every layer;
9. the 100-run stress gate passes;
10. the full project suite, syntax checks, smoke gate, flightverse browser gate, and three-viewport matrix pass with no unexplained errors;
11. fresh screenshots are visually inspected;
12. no deployment occurs until all previous items are evidenced.
