# WORLD CONTEXT PROMPT for Codex and ChatGPT (copy and paste)

This is the master prompt for an external LLM. It gives the LLM the full context of the FLIGHTVERSE world.
Use it before you ask the LLM for assets, analysis or code proposals.
Attach the files from the list at the end of this document.

---

## THE PROMPT (copy and paste everything between the lines)

You work on **FLIGHTVERSE**. FLIGHTVERSE is a video game for the browser and it is in production.
The game uses REAL photogrammetry scenes: the drone scans of Bogotá, Colombia, that the operator made.
It is live at vuelos.metislab.work.
Read this contract with care. Each suggestion you make must fit the contract.

### Platform and hard constraints
- **Stack**: ES modules in vanilla JavaScript. There is **NO build step** and **NO npm at runtime**.
  All libraries are in `web/vendor/`:
  - three.js r180 (through the shim `web/flightverse/three.js`)
  - Spark 2.1 (Gaussian splat renderer)
  - three-mesh-bvh
  - camera-controls
  - `postprocessing` (r180 build)
  - webm-muxer
  - GLTFLoader, BufferGeometryUtils and SkeletonUtils
- **CSP is strict**: `script-src 'self' 'wasm-unsafe-eval'`, `connect-src
  'self' data: blob:` and two hosts for map tiles. There are no CDNs, no external requests and no eval.
  A proposal that breaks the CSP is not valid.
- **Determinism**: physics and game logic use a fixed timestep of 1/120 s (`STEP`).
  Rendering interpolates between steps.
  Replays re-simulate the game. Inside fixed-step logic that must replay, do not use `Date.now` or random numbers.
- **Honesty rules**: never show fake data.
  If a scene does not have a capability, the UI says so and degrades gracefully.
  For example, a scene with no GPS track has no `Arcade` mode.
  The photogrammetry is a real scan.
  Explosions make craters in the GAME terrain heightfield.
  The game never pretends to destroy the splat of the real world.
- **Language**: UI text is in Spanish. Code and comments are in English or Spanish.
  Do **NOT** use emojis in the UI. Use SVG icons only.
  Use original content only. Do not use copyrighted characters, logos or franchise likenesses.
- After ANY edit of a web file, run `python3 pipeline/bump_web_version.py`.
  This script rewrites the `?v=N` cache-busters and regenerates the .gz files.
  The checks use headless CDP gates.
  The command `python3 pipeline/flightverse_spike_gate.py --page volar.html
  --global __volar --extra '&autotest=1'` must report 0 console errors and
  at least 50 fps.

### World data model (per scene, `models/<cid>/`)
- `scene.v2.json` is the manifest. It holds the capabilities (listed only if they exist), the asset paths,
  the splat-to-terrain alignment matrix (Umeyama, RMSE of about 1 cm) and the datum.
- `site.lod.json` holds the stable `scene_id` and the active version.
  It also holds the truth of the source registration and the checked circle and square coverage products at 100/200/400/600/1000 m.
  Coverage is an output diameter. Do not infer it from the capture altitude.
  The extent `pending` is off.
- `dsm_lod.bin/json` is a 512² Float32 heightfield with a nodata mask.
  Heights are in meters, relative to elev_min.
  Row 0 is north, +x is east and +z is south.
  `makeHeightSampler` gives `heightAt(x, z) -> meters | null`.
  The terrain mesh is a displaced PlaneGeometry.
  `terrain.crater(x, z, r, depth)` deforms BOTH the mesh and the heightfield, so the collision follows.
- `collision.bin` is a pre-baked triangle soup. It comes from the splat. A band filter cleans it.
  three-mesh-bvh loads it for the drone collision (slide and anti-stuck).
- `<cid>.clean.sog / .ksplat` is the Gaussian splat. Spark renders the aligned splat.
- `objects.json` lists the scene objects. An object is one of these types:
  - a primitive (ring, beacon or box)
  - a GLB from `assets/props/`
  - `type:"kit"` from `assets/destruction/models/` (pre-fractured GLBs with extras: role, massKg, mode, explosive)

  The flag `destructible:true` registers the object as a weapon target.
- `track.json` is the track of the real flight, from GPS. The ghost replay and the Gate Rush course use it.

### Game modules (`web/flightverse/`)
- `runtime.js` has the fixed loop, the input, the `MODES` and the `RIGS`.
  - `MODES`: `cinematico`, `asistido` (shown as `Normal`), `arcade` (autopilot over the real track) and `dios` (noclip).
  - `RIGS` (cameras): `Muy cerca`, `Cerca`, `Lejos`, `FPV`, `Cenital`, `Órbita` and `Lateral`.
  - It also has the drone physics (velocity target and deterministic wind), the MIN_AGL ground clamp and the BVH collision.
- `volar.js` (about 1400 lines) is the orchestrator of the game page. It has these parts:
  - the HUD
  - the quality ladder (auto, HD, extra, 4K and ultra with supersamples)
  - the grade panel (exposure, bloom and so on)
  - the weapon UI
  - the invasion modal
  - the Gate Rush UI
  - the replay and the Director
  - the camera shake and the FOV concussion punch
  - the minimap
  - the QA URL parameters: `&autotest=1`, `&fuego=1|mg`, `&boom=1`, `&rig=N`, `&cielo=dia|atardecer|noche`, `&invasion=tipo,...` and `&reto=1&dif=facil|media|dificil`
- `sky.js` is the procedural sky v5. It has these parts:
  - a dome with a 3-stop gradient and a haze below the horizon
  - a real moon (solid disc, value-noise mares, dark limb edge)
  - 2 layers of stars that twinkle
  - Mie-toy sunset scatter
  - tileable fbm clouds and shaded cumulus billboards
  - a sun and moon DirectionalLight with shadows that follow the focus
- `weapons.js` has `ARSENAL`.
  - `ARSENAL` has the MG (auto 11.8/s, ballistic tracers, cumulative damage) and the missiles S, M and L.
  - Each missile tier has its own speed, boom, cooldown, ammo and regen.
  - An explosion has these parts:
    - a white-hot core
    - tall flame sprites with color over life
    - structured multi-lobe smoke (lit-by-fire ramp)
    - a ground dust ring
    - ejecta chunks that stay as rubble
    - ember Points
    - velocity-stretched spark streaks
    - a double shockwave ring
    - a PointLight flash
    - a soft scorch mark that stays
    - crater deformation
    - residual fires
  - The hittables contract for scene objects is `{node, center:Vector3, r2, color, hp?}`.
  - The hittables contract for enemies is `{enemy:true, g, center, r2, hp, blood}`.
  - The sprite cap is 460.
- `invasion.js` has `ENEMIES`: `zombie`, `arquero`, `soldado`, `ufo`, `avion`, `dragon` and `gigante`.
  - Ground units walk ONLY on walkable terrain. Each type has its own footprint and maximum slope, and the height is smooth.
  - Each flyer type has its own pattern: orbit, pass or serpentine.
  - Enemy projectiles damage the player health.
  - External GLBs follow `docs/ENEMY_MODEL_SPEC.md` (clips walk, fly and attack). A procedural fallback exists.
  - Waves scale the hp, the speed and the count.
- `gaterush.js` has `DIFFS`: `fácil`, `media` and `difícil` (count, radius and colors).
  - It has HD tori rings with spin, beacon and pass-flash.
  - It has light crumbs that flow and splits for each gate.
  - It has a graceful approach flight.
  - It saves the records for each difficulty (localStorage).
- Other modules:
  - `objects.js`
  - `audio.js` (synth quad acoustics and weapon sounds)
  - `recorder.js` (WebM)
  - `export.js` (deterministic 1080p WebCodecs)
  - `touch.js` (mobile RC sticks)
  - `gaterush` and `director`, which are inside volar
- `mundo.html/js` is the world select screen. It has an island carousel and a map.
  The map has the layers `sat`, `dark` and `plano`, coverage footprints, real route lines and mission popups.

### Performance budgets
The target is 60 fps on M-series Safari and Chrome. In auto mode, the DPR governor is at most 2.
The shadow map is 2048 with a tight follow frustum.
Additive particles have a cap.
GLB budgets: drone at most 120k tris, enemies at most 80k, props at most 40k.

Assets with heavy fragment work must NOT cast shadows for each fragment.
The 70-brick wall showed this: it changed the frame rate by -24 fps.

### What we want from you
1. Answer questions about design and architecture. Stay inside these constraints.
2. When we ask for assets, follow `DRONE_MODEL_SPEC.md` and `ENEMY_MODEL_SPEC.md` exactly.
   The requirements are:
   - axes -Z forward and +Y up
   - real meters
   - named nodes and clips
   - embedded textures
   - glTF-Validator with 0 errors
   - a JSON file with the check results next to the asset
3. When you propose code, give full functions or patches.
   Name the exact file and anchor.
   Use vanilla ESM that is CSP-safe and deterministic-safe.
   Add a QA plan that uses our gate parameters.
   Never add npm dependencies or external URLs.
4. Flag each item that can break the CSP, the determinism, the honesty rules or the 60 fps target.

---

## Files to attach with the prompt
Minimum (game context):
1. `docs/FLIGHTVERSE_IMPLEMENTATION.md`: the full ledger of features
2. `docs/GAME_ENGINE.md`: the module map and the golden rules
3. `web/flightverse/runtime.js` · `weapons.js` · `invasion.js` · `sky.js`
4. `web/volar.js`

If the LLM will generate models: 5. `docs/DRONE_MODEL_SPEC.md` + `docs/ENEMY_MODEL_SPEC.md`

If the LLM will change the scene or the objects: 6. `docs/SCENE_OBJECTS.md` + `web/flightverse/objects.js` + `scene.js`

If the LLM will propose pipeline changes: 7. `pipeline/scene_manifest.py` + `dsm_lod.py` + `splat_align.py`
