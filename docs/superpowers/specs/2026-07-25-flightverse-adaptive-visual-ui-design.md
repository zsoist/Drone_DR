# FLIGHTVERSE Adaptive Visual Performance and Flight UI Design

**Status:** Approved under the operator's standing full-access authorization.

## Outcome

FLIGHTVERSE must preserve the real-world reconstruction as the hero asset while
holding a stable frame budget and keeping flight controls readable on desktop,
iPad, and phone. The renderer must react to sustained load rather than a single
FPS sample, the touch image inspector must stop covering the flight, and the
edge of the captured world must transition into the environment instead of
reading as a hard floating slab.

## Scope

This delivery is one coherent runtime-and-presentation slice:

- adaptive render resolution with deterministic hysteresis;
- truthful renderer telemetry and browser acceptance thresholds;
- visibility-aware render lifecycle;
- compact, progressive image controls on coarse pointers;
- visually softened native world frontier without adding a second structural
  representation.

It does not rewrite Three.js, change the collision contract, alter source
photogrammetry, add a build system, or add a new runtime dependency.

## Approaches Considered

### Selected: bounded adaptive governor plus presentation polish

A small pure governor consumes stable frame samples and moves through explicit
resolution tiers. The runtime applies the tier to the existing renderer and
composer, records render counters, and pauses the loop while hidden. UI changes
stay in the current DOM/CSS architecture. The world edge uses the existing
terrain material and scene atmosphere, so collision and visual ownership remain
unchanged.

This is measurable, reversible, and compatible with the no-build deployment.

### Rejected: fixed device presets

User-agent or device-memory presets cannot account for thermals, viewport size,
other GPU load, or unusually heavy worlds. They also degrade permanently when a
device could recover quality.

### Rejected: renderer rewrite or WebGPU migration

That would mix infrastructure risk with a presentation pass, invalidate the
existing collision and browser gates, and provide no measured benefit for the
current real-world assets.

## Architecture

### Adaptive quality governor

`web/flightverse/render-quality.js` is dependency-free and owns a state machine:

- tiers: `1.00`, `1.25`, `1.50`, `1.75`, `2.00` DPR, capped by the device;
- a rolling window uses frame time, not rounded FPS;
- downgrade only after sustained slow windows;
- upgrade only after a longer stable recovery;
- a cooldown prevents oscillation after every change;
- manual HD/Extra/4K/Ultra bypasses the governor;
- Auto reports the actual tier, reason, and change count.

The pure module is covered with Node tests for downgrade, recovery, cooldown,
device caps, isolated spikes, and tab-resume reset.

### Runtime and telemetry

`web/volar.js` wires the governor to both `WebGLRenderer` and `EffectComposer`.
It avoids redundant resize calls and records:

- DPR and quality tier;
- average and p95 frame milliseconds;
- render calls, triangles, geometries, and textures;
- governor change count and last reason;
- visibility pause/resume counts.

The animation loop stops on `document.hidden` and resumes with timing reset on
visibility return. Gameplay simulation must not catch up through a hidden-tab
time gap.

### Touch image inspector

Desktop keeps a draggable inspector. Coarse pointers receive a bottom sheet:

- collapsed header remains visible with preset buttons;
- expanded controls occupy at most `38dvh`;
- controls scroll inside the sheet, never the document;
- flight sticks and combat/menu launchers remain reachable;
- close, expand, and presets are 44px targets;
- opening Image closes other mobile sheets;
- Escape/back-layer behavior remains deterministic.

Advanced sliders remain available but are progressive, not the first thing
covering the world.

### World frontier presentation

The native terrain owns the outer transition. The terrain shader derives an
edge factor from UV distance and applies a short atmospheric fade near the
outermost valid cells. A low-opacity ground haze continues into the scene fog.
The effect:

- never hides collision geometry near the playable boundary;
- never renders mesh and splat simultaneously;
- does not discard additional terrain;
- remains subtle in overhead views and stronger at grazing angles;
- is disabled for capture/diagnostic modes when exact pixels are required.

This delivery does not invent geometry beyond the capture. It makes the honest
data boundary visually intentional.

## Error and Lifecycle Rules

- Invalid governor samples are ignored.
- A zero-sized or background viewport never changes quality.
- Resume resets the sample window before making a quality decision.
- Resize/DPR application is idempotent.
- UI state restoration is clamped to the current visual viewport.
- All new listeners are removed by the existing page teardown path.
- QA data remains scalar/serializable; no Three.js objects leak through
  `window.__volar`.

## Verification

### Unit and contract tests

- pure governor transitions and anti-oscillation;
- source contract for renderer/composer resize parity;
- visibility pause/resume and timing reset;
- scalar renderer metrics;
- touch sheet height, internal scroll, 44px targets, and mutual exclusion;
- frontier uniforms and no extra structural layer.

### Browser gates

Desktop `1440x900`, iPad portrait, and phone portrait must show:

- no document overflow;
- no overlapping menu/combat/image surfaces;
- Image controls reveal the world above the sheet;
- sustained `fps >= 50` after warm-up;
- finite frame-time and render counters;
- exactly one world group and one active structural representation;
- no console errors or unhandled rejections.

The browser test also injects synthetic slow/stable samples into the pure
governor fixture so the transition behavior is deterministic.

## Acceptance Criteria

1. Auto quality does not react to one isolated slow frame.
2. Auto quality downgrades after sustained load and later recovers without
   oscillating.
3. Hidden tabs stop rendering and resume without a physics time jump.
4. QA exposes finite frame p95, DPR, calls, triangles, geometries, and textures.
5. The touch Image sheet leaves at least 56% of the viewport available to the
   world and keeps launchers reachable.
6. The native terrain edge reads as an atmospheric capture frontier rather than
   a black/hard slab, without changing collision or duplicating structures.
7. Node tests, Python contracts, smoke, and the three-viewport browser matrix
   pass.
8. Every `web/` edit batch bumps the web version and regenerated gzip assets are
   current.
