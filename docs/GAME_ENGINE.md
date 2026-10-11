# FLIGHTVERSE: engine map (three.js r180 optimized frontier)

## Modules (web/flightverse/)
- `three.js`: SHIM: every module of the game imports three from here (r180). Never
  import three180 directly from game modules.
- `scene.js`: SceneManifestV2 becomes terrain (heightfield and ortho, nodata mask, and
  rasterized triangle coverage), visual structural mesh, aligned Spark
  splat (Umeyama matrix, ±cm), and track. One generation owns one `fv-world` group.
  It frees the stale asynchronous loads.
- `world-collision.js`: one query for BVH, DSM, and edge, for the drone, the MG, and the missiles.
  It has continuous sweeps, a slide of up to two contacts, and proximity with line of sight.
- `site.lod.json`: stable identity, active version, and checked coverages of
  100/200/400/600/1000 m. Mundo never duplicates versions of the same site. Volar selects the
  circle or the square. It blocks an extent that is not ready and does not invent terrain.
- `runtime.js`: the main loop of the game.
  - The loop uses a FIXED timestep of 1/120 (determinism of replays).
  - It handles input.
  - It does the physics for each mode (Normal target-speed · Dios noclip · 6DOF ecctrl
    available).
  - It uses continuous BVH collision with an envelope that comes from the GLB.
  - It does slide and escape. The chase camera shortens at the first real contact.
  - The terrain protection keeps an AGL of 1.20 m, independent of the structural radius.
  - When the user hides the tab, it pauses the render. It resumes with a clean clock
    and does not charge the physics debt.
- `render-quality.js`: pure governor of the Auto resolution. It uses windows of frame
  time. It lowers the resolution after two slow windows. It recovers the resolution after three stable windows. A cooldown
  separates the changes. It ignores isolated spikes and limits DPR to 1–2.
- `objects.js`: scene objects (SCENE_OBJECTS.md): GLB or primitives,
  ground anchor, spin and bob. Static objects get frozen matrices.
- `gaterush.js`: challenge: a course on the real track, a Mario-Galaxy path,
  the course records at 60Hz. The record goes to the replay and to the Director.
- `sky.js`: shader dome with 3 stops, and sun, moon, galaxy, and clouds. It controls the lights.
- `audio.js` (synthesized WebAudio) · `touch.js` (RC Mode 2) ·
  `recorder.js` (live WebM) · `export.js` (deterministic WebCodecs 1080p).

## Golden rules
1. NEVER send heavy assets to the client without LOD or preparation (dsm_lod, clean.sog,
   collision_bake with band [ground-2, +32]).
2. Every batch of web edits ends with `pipeline/bump_web_version.py`.
3. Do not call anything done until the audit and the CDP gate are green
   (`audit_world.py`, `flightverse_collision_gate.py <cid> --stress 100`,
   `browser_matrix.py --flightverse`). The gate needs at least 50 FPS, one world group,
   no duplicate structural layers, and no GPU growth.
4. Static objects: matrixAutoUpdate=false. Post-processing: one EffectPass only.
   The DPR governor runs in 'auto'. The manual presets go from HD to ultra. `window.__volar.render`
   publishes DPR, mean and p95 of the frame, draw calls, triangles, geometries, textures,
   and pauses and resumes. The matrix rejects counters that are not finite.
5. Renames: regex \b, never a `substring` (the team learned this the hard way in v80).
6. The terrain shader mixes the native frontier with the atmospheric color of the sky.
   It never discards more geometry and does not create another
   structural layer. `?diagnostic=1` keeps exact diagnostic pixels.
7. On touch, Imagen opens compact: immediate presets, and advanced settings
   on demand, with a ceiling of 44dvh and an internal scroll.
8. The drone normalized to 0.85 m publishes its active structural radius in
   `window.__volar.collision.radius_m` (safe range 0.42–0.70 m) and its source in
   `radius_source`. Production needs `glb`, not a fallback that a clamp accepted.
   Director, arrival, tour, and FPV get no camera correction. The rigs of the chase camera
   publish queries and contacts in `window.__volar.camera.collision_checks` and
   `collision_hits`. The deploy gate tests the chase camera with queries and at least
   one real contact. It tests FPV separately. For FPV, it needs no anti-clipping work (zero).

## Extend (new game or mode in about 1 module)
Create `flightverse/<modo>.js`. It exports `create<Modo>({scene, terrain,
ghost, ...})` with a deterministic `update(dt)`, and a UI in the volar dock. Make a gate with
`&autotest=<modo>` that reports in `window.__volar`.
