# World Premium: Invasion, Mobile and Deployment Safety

## Outcome

AeroBrain World must feel reliable on every active map: physical structures stop
the drone and weapons, Invasion uses the shipped high-resolution GLB enemy set
without sacrificing frame rate, and touch users can fly, aim, fire, change
weapons, and dismiss menus without overlapping controls.

## Scope and sequence

This release is split into three independently testable subsystems:

1. Deployment and collision integrity.
2. Invasion rendering, behavior, and game loop.
3. Mobile flight and combat interaction.

The deployment subsystem lands first because every later visual or gameplay
change depends on a gate that can reject a bad build without leaving it live.

## Deployment and collision integrity

Collision GLBs are parsed through their default glTF scene graph. Node matrices
and TRS transforms are accumulated, and every node instance contributes its own
world-space triangle set. Geometry filtering keeps triangles that intersect the
playable vertical band instead of deleting an entire tall wall by centroid.

Precompressed assets are accepted only when their source-derived freshness can be
proven; filesystem ctime is not evidence of matching content. A guarded restart
validates the candidate while the current service remains live, then restarts,
then runs a short live health check. If post-restart health fails, the operation
reports a production failure rather than claiming a safe abort.

The browser collision gate performs actions, not repeated snapshots: it fires a
missile into the deterministic fixture, checks the resulting impact/explosion,
reloads the World scene, and verifies stable renderer memory and lifecycle state.
Terrain-only worlds are valid when their manifest declares no structural
collider; worlds that advertise a preferred mesh must actually activate a clipped
visual mesh.

## Invasion rendering and AI

The existing `enemy_catalog.json` is the source of truth. Each enemy starts with
LOD2 or LOD1 according to device class and distance; the full 2K-textured GLB is
used only within the near-detail budget. Assets are preloaded before the first
wave and procedural geometry remains an explicit recovery fallback. The runtime
publishes model source, LOD counts, AI state counts, spawn failures, and active
projectile counts for QA.

Enemies use explicit states: spawn, pursue, strafe/orbit, attack, evade, recover,
and dead. Ground enemies sample alternate steering directions when the direct
route is blocked and separate from nearby allies. Ranged enemies maintain a
useful engagement band, lead the drone using its velocity, and expose telegraphed
attack windups. Air enemies use bounded attack runs and disengage before
reacquiring. Difficulty scales through bounded health, cadence, accuracy, and
wave composition; it never creates unbounded enemy or projectile counts.

The player sees a clear pre-game sheet with enemy mix and difficulty, then a
compact wave HUD with health, remaining enemies, score, and a short next-wave
countdown. Starting and stopping Invasion are reversible and release every timer,
model, animation mixer, projectile, and scene object.

## Mobile interaction

Touch flight uses two adaptive RC zones whose centers follow the initial thumb
position within safe bounds. Each stick has a visible label, dead-zone response,
pointer cancellation, and a `dispose()` method. The combat action remains
reachable without covering either stick.

Menu, Combat, Invasion, Image, Guide, and Difficulty are mutually exclusive
mobile sheets. They use the visual viewport and safe-area insets, expose proper
dialog state, and close through their close button, Escape, or a pointer-down on
the scrim/outside area. Opening a sheet suspends stick input so a menu tap cannot
move the drone. Layout rules cover phone portrait, phone landscape, and iPad
portrait/landscape; minimum interactive target size is 44 CSS pixels.

## FPV, weapons, impact and scenery damage

FPV is the default camera for new flight sessions. The selected rig persists only
after an intentional user change, and a one-tap camera control remains visible in
every device layout. The center reticle is the aiming source of truth. A ray from
the rendered camera selects the first enemy, structural collider, terrain, or
playable-boundary point; the projectile then travels from the current weapon
hardpoint toward that point. This removes disagreement between gimbal pitch,
camera framing, and missile direction.

Weapon selection and firing are independent controls. Desktop keeps shortcuts;
touch gets a thumb-reachable weapon carousel with icon, name, ammo, reload/cooldown,
and one separate trigger that never sits inside a flight-stick zone. Holding fire
is allowed only for the machine gun. Missiles require discrete presses and show
lock/proximity state. The selected weapon is visible without opening a menu.

Weapons use authored high-detail geometry with distance LODs and physically
plausible proportions. Muzzle flash, tracer, motor smoke, exhaust, impact sparks,
dust, fire, and explosion smoke use pooled particles and device budgets. Smoke
inherits projectile velocity, impacts orient to the hit normal, and effects scale
by weapon energy and material class.

Scenery damage is localized to the exact hit point. Structural hits produce a
normal-aligned decal, bounded chips/fragments, and a shallow deformation mark only
when that representation supports it. A roof hit cannot create a decal on an
unrelated top surface, and a wall hit cannot use terrain height for placement.
Damage is visual and locally persistent for the session; the original collision
BVH remains authoritative unless a destructible object explicitly owns a
replacement collider. Pools cap decals, fragments, fires, smoke, and rubble and
dispose oldest entries deterministically.

## Performance budgets

- World remains at or above 50 fps in browser gates; target is 60 fps.
- Enemy count and projectile count are capped per device tier.
- Full-resolution enemy GLBs are distance- and budget-limited.
- Weapon, projectile, and effect assets use LOD and fixed pools per device tier.
- Inactive World visual representations do not load.
- No duplicate structural layers, scene groups, pointer handlers, or model
  instances survive a restart or page lifecycle transition.

## Verification

Unit tests cover glTF transforms/instancing, tall-wall filtering, gzip freshness,
terrain-only contracts, preferred mesh activation, AI transitions, LOD selection,
touch normalization, sheet exclusivity, camera-to-reticle aim, muzzle trajectory,
impact-normal placement, effect-pool bounds, and cleanup. Browser tests run every
active map on phone, iPad, and desktop profiles; the live gate fires weapons and
reloads. Production verification checks authenticated loopback World, public
health, the login boundary, console errors, transfer size, and screenshots.
