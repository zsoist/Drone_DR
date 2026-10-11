# FLIGHTVERSE: Implementation ledger

## v284 (2026-07-25): continuous collision and single-representation world

- The team published the structural collider from OBJ/GLB. It has a fingerprint, an atomic write, and a coverage mask aligned to the DSM. The team regenerated and audited the 11 current worlds.
- The drone, the MG, and the S/M/L missiles query one single BVH+DSM+edge world. The queries use continuous sweeps. The proximity fuze needs a structural line of sight.
- Terrain, mesh, and splat follow one exclusive policy. The mesh cuts the terrain only inside its real triangles. Outside the triangles, a continuous fallback stays. The drop of stale loads happens by generation. Spark uses a refcount.
- Release gate: a deterministic fixture of 10.000 queries plus 100 samples of the live world. The gate needs at least 50 FPS, stable memory, one `fv-world` group, and zero duplicates.

> **Cumulative ledger.** The early decisions stay as history. If one entry contradicts another entry, the newer version has priority. The current contract in [GAME_ENGINE.md](GAME_ENGINE.md) also has priority.

> Branch: `feat/flightverse-v2` (from a clean main, main commit 64).
> Full spec: in the prompt of the assignment (47 sections). This ledger is the execution memory between sessions.
> It records the real state, the decisions with their reasons, and the next executable step.
> Rule for this arc: a task is done only after a check in the browser.

## Relevant earlier context (do not rediscover)
- Codex ran the v1 prompt (world-flight) for about 25 min. It stopped when FLIGHTVERSE v2 arrived. It made 0 commits. Its partial edits stayed as forensic WIP in `feat/world-flight-experience`. The new work did NOT inherit these edits. Nobody reviewed them.
- The 11 REPO FACTS (gz-trap, hook, session, assets, CSP, urllib, python-argv, MapLibre globals, icons, preflight) are in `/tmp/world-flight-prompt.md` and in the project memory. They remain valid.
- FLIGHTVERSE SUPERSEDED the earlier G0-G3 plan (`docs/archive/GAME_EXPERIENCE_SPEC.md`). The team keeps that plan as a reference for the thesis DSM=terrain.

## Decisions taken (with reasons, can be updated)
- D1 [Phase 0]: two parallel read-only auditors. The integrator also made screenshots of the breakpoints. Auditor A covered the renderer, the state, and the assets. Auditor E covered the showcase, the AI, saved data, and the Studio. Integration: one single mind (this session). The agents do not choose the architecture (rule of section 3).
- D2 [early, to check in Phase 1]: the incumbent renderer (three.js + GaussianSplats3D, WebGL) starts as the FAVORITE of the decision gate. Integration is worth 25 pts. The renderer already renders real scenes. If the spike shows a hard block in collision or in the data stream, use PlayCanvas or Babylon. If not, do not use them. The team runs the gate anyway (section 5).
- D3: the vertical slice (section 42) has priority over breadth. The slice has this order: World, Volar, Gate Rush, Result, Replay, Director, Export 1080p, and World again. It runs in ONE real scene (candidate: scene 1 of the baseline, with DSM, ortho, splat, and full track).

## Status by phase
| Phase | Status | Evidence |
|---|---|---|
| P0 baseline+audit | DONE | archive/FLIGHTVERSE_UI_AUDIT.md (A+E consolidated, I1-I4, perf baseline) |
| P1 renderer gate + SceneManifest V2 | DONE | FLIGHTVERSE_RENDERER_DECISION.md. Spike OK (92/100 incumbent, 5/5 questions, qa/*-flightverse-spike.png). dsm_lod.py (126MB to 234KB) + spike_flightverse.{html,js} + flightverse_spike_gate.py |
| P2 world shell (/mundo) | DONE | mundo.html/js + NAV globe + `BLOQUE 28`. 6 scenes. Checked in the browser pane (desktop and 390px, 0 errors, no overflow) |
| P3 playable flight (fixed loop, modes, rigs) | DONE (core) | volar.{html,js} + flightverse/runtime.js: fixed timestep 120Hz, 5 modes, 6 rigs, ghost of the real track, HUD with 4 corners. CDP gate: 62fps, real AGL, 0 errors (qa/*-volar.png). Open items: mobile touch, 4 more rigs, audio |
| P4 Gate Rush (slice) | DONE (core) | flightverse/gaterush.js: circuit on the REAL track (8 gates), countdown, timer, result, record in localStorage, replay at 60Hz. CDP gate autotest=gaterush ok (detection, result, and replay checked, 0 errors) |
| P5 God/creator | — | |
| P6 Director | — | |
| P7 Video Studio | Quick Record DONE | flightverse/recorder.js: captureStream+MediaRecorder VP9, button and V key, gate: 2.3MB WebM/2.5s, 0 errors. Missing: deterministic WebCodecs 1080p export, photo mode |
| P8 AI creator | — | |
| P9 Showcase | — | |
| P10 perf/resilience | — | |
| P11 polish/QA | — | |

## Arc 10/10 (2026-07-11/12): overhaul with a researched stack
The team audited 6 libs in parallel (workflow, verdicts with evidence measured in the scratchpad). The team integrated these items and passed them through the gates (CDP, 0 errors, 73-78fps):
- **Splat-to-terrain alignment.** `splat_align.py` aligns the cameras to reconstruction.topocentric with the Umeyama method. The RMSE is 0.003-0.018m for 5 scenes. The hero splat now shows IN /volar (view `P`, photo-real). The HUD shows accuracy to within centimeters.
- **Spark 2.1 and three r180** (shim flightverse/three.js). Spark reads ksplat natively and uses a fixed-budget LOD. The team removed GS3D from the game. The legacy tresd and share pages stay on r160. The migration of these pages is a separate task. The CSP connect-src gets `data:` added.
- **Building collision.** The chain is: splat-transform (in tools/), then a collision GLB, then collision_bake.py (baked matrix), then three-mesh-bvh `closestPointToPoint`. It runs at 120Hz and is deterministic. It does push-out and bounce.
- **`postprocessing` 6.39.** SMAA, Bloom, ACES, and Vignette in one EffectPass.
- **Synthesized audio** (rotors, wind, events). The `M` key mutes it. **Dual-stick touch controls.** **Ortho minimap.** **Cinematic arrival.** LOD 512.
- The team vendored camera-controls 3.1.2 for the Director (P6). Nothing uses it yet.
- The port of ecctrl (6DOF rotor model) is an open game-feel upgrade. The constants are in the journal of workflow wf_710e9b72-d8a.

## Status of the plan '10/10 closure' (2026-07-12)
- Step 0: done.
- A (nodata): done.
- B (6DOF): done.
- G (SOG): done. 5 scenes, -50% weight.
- C (Director): done. It uses camera-controls, keyframes, and `Grabar toma` (Record take).
- D (deterministic 1080p export): done (WebCodecs+webm-muxer, CDP green).
- F (matrix): done. `browser_matrix --flightverse`: world and volar in 3 viewports at 71-76fps.
- Phase E: done (2026-07-12). The team ported splatview to Spark. tresd and share run on r180. The team DELETED GS3D, three160, addons160, and pp637 from the repo. Now one single stack remains. Gates: browser_gate splat + matrix share/workspace 6/6 (real macro).
- PLAN COMPLETE 7/7. The slice of section 42 is COMPLETE: World, Volar, Gate Rush, Result, Replay, Director, Export 1080p, and World again.

## Next executable step (next session)
The plan '10/10 closure' is 7/7 and the slice of section 42 is complete. The rest of the backlog from the original spec follows, in order of value:
- P5 challenge creator: in God mode, place gates. The result is a JSON in the vault through a new handler (pattern of /api/property).
- P8 AI creator: template /api/analyze + ai/router. The drafts have a structure. They are NEVER executable code (rule of the spec).
- P9 showcase: use the pattern of `share.html` inside the private session. If access from outside comes back in the future, the system needs an explicit opt-in before it exposes `center_wgs84`.
- P10 rest: progressiveLoad and the SOG stream. COOP/COEP, if WebCodecs needs multithread one day. Gamepad support.
- P11: formal checklist of the 43 acceptance criteria.

Minor open items: photo mode (P7), 4 more rigs, a fine adjustment of the 6DOF with a real controller, and an optional MapLibre minimap.

## v93 (2026-07-12): realistic sky v5 + scale LEDs + premium dock
- **Root bug of the "orange wall"** (`muro naranja`). The lower hemisphere of the dome rendered the pure horizon color (`h=clamp(d.y,0,1)=0`). This filled half of the screen. Fix: haze below the horizon toward uFogC. Diagnosis: debug stripes by h in the shader (reusable pattern).
- Real moon. It is a solid disc through `mix()` (not additive, so no bloom blob). It uses local UV, seas from value-noise, a darker edge, and a tight halo. It starts low on the horizon, just after moonrise (about 9°), in the default frame.
- Stars. The az/el mapping is stable, so the horizon has no stretch. There are 2 layers. Each cell has its own magnitude, tint, and twinkle (new uTime).
- Sunset. The horizon band is narrow (midPos .10, topPos .46). The headroom is `R<1` (anti-clamp). A Mie scatter in toy form acts only near the horizon and toward the azimuth of the sun.
- Clouds. They use tileable fbm value-noise (4 octaves, wrap). The cumulus clouds have a flat base and a shaded belly.
- The drone LEDs have real scale (0.055/0.075, hard core). They have a slow pulse.
- Premium dock: sheen sweep, glow by section color, staggered entrance, and `prefers-reduced-motion`.
- Debug: `window.__skyUni` exposes the sky uniforms for QA through CDP.

## v94 (2026-07-12): audio overhaul, acoustics of a real quad
- 4 independent rotors (PeriodicWave with 16 harmonics 1/n^1.25, even harmonics attenuated). Each rotor has a fixed detune (quad beat) plus a sinusoidal wander (flight controller corrections).
- The WaveShaper `tanh` gives grit. Motor/ESC whine (saw ×9.5 BPF, very faint). Propwash is bandpass noise with an AM chop at the blade-pass frequency. Wind is proportional to v², as a separate layer.
- Spatial bus: gain 1/d + air-absorption lowpass + StereoPanner. It gets its data from volar with `camera.worldToLocal(P)`. The FPV rig puts the ear on the drone. The `Lejos` rig (Far) moves the ear away.
- The BPF follows `propSpin` (the propeller inertia that the code already has) plus lift.
- Headless check: OfflineAudioContext render gives RMS 0.074 / peak 0.21 (CDP probe with a monkey-patch of AudioContext). The code exposes `report.audioArmed` for gates.

## v96 (2026-07-12): armament + ultra-HD model pipeline
- weapons.js has these parts: missiles (light ballistics, smoke trail), a multi-layer explosion, and fragmentation of destructibles (14 chunks with bounce). The explosion has a flash + PointLight, a fireball, smoke, 70 spark Points with gravity, and a shock wave that grows at ground level. It also leaves scorch marks that stay (maximum 12, FIFO). All of it uses pools. It needs zero assets.
- objects.json: the flag `destructible` makes an object a hittable (center + radius²). The sample scene has 3 test boxes. Honest limit: the photogrammetry takes scorch and shrapnel marks. It does not break. Only the game objects are destructible.
- UI: a premium FIRE button with a circular shape (ammo 8 + reload 2.5s per unit, cooldown bar, flash animation, empty state) and key `X`. The camera shake scales with distance.
- Audio: `launch()` whoosh with bandpass, and `boom()` with lowpass noise from 2.6k to 180 plus a sub from 72 to 28Hz.
- Ultra-HD: procedural environment map (scene.environment). Metallic PBR no longer turns out black. Maximum anisotropy on all GLB textures. receiveShadow. Spec v2: 120k tris / 8 mats / 2048² / hardpoints / gimbal / copy-and-paste prompts.
- Gate: `&fuego=1` fires at 1s with pitch -0.55. It sets `report.weapons {fired, exploded}`. Result: fired 1 / exploded 1 / 68fps / 0 errors.

## v102 (2026-07-12): armament v2, real craters + engine-level VFX
- Research: the team evaluated three.quarks (`GPU instancing`, `stretched billboards`, `trails`, `Shuriken parity`) and three-nebula. The team ported the techniques NATIVELY (zero deps, CSP intact). Points with a soft texture (no more square sparks). LineSegments streaks stretched by velocity. Color-over-life ramps in sprites (white to orange to dark red, and the smoke gets lighter). Rotation for each particle.
- REAL CRATERS: `terrain.crater(x,z,r,depth)` presses down the heightfield hf and the geometry with a cosine falloff. heightAt closes over hf. So the collision of the drone and the placement of objects see the crater. Only the patch gets new normals (central differences of the regular grid, no global computeVertexNormals).
- Debris STAYS: when a chunk settles (after a bounce, with speed below 0.9), it freezes as static rubble (matrixAutoUpdate=false). The limit is 240, FIFO. There are 18 chunks. The code chars 30% of them.
- Residual fires: 5.5s of flames with a ramp, smoke, and a PointLight with flicker. A maximum of 3 run at the same time. Missile: roll, fins, nozzle flicker, thin trail, and hardpoints that alternate left and right.
- Impact reticle: a ballistic simulation of 80 steps against the heightfield on each frame. An orange ring that pulses shows where the missile will land. A `DERRIBOS n` chip (kill counter) shows the kills.
- QA params: `&fuego=1` (fires), `&boom=1` (detonates on the ground), `&rig=N` (camera). 6 consecutive green gates, 66-75fps, 0 errors.

## v104 (2026-07-12): destruction kit integrated + ultra-HD drone
- The team integrated the destruction kit from ChatGPT (threejs_destruction_kit) WITHOUT Rapier. The team uses its pre-fractured GLBs (extras: role/massKg/mode/explosive) with OUR physics from weapons.js. This adds zero new deps and keeps the determinism. Rapier stays as a future option (the physics/ folder of the kit is in Downloads).
- objects.json `type:'kit'` points to assets/destruction/models/ (explosive barrel, concrete block, wall of 70 bricks, pine, debris_pack, 17MB). The team copied THIRD_PARTY.md.
- smash v3: REAL fragments of the kit fly from the impact point. Their velocity is in proportion to 1/√massKg. Barrels detonate in a chain (+0.12s). When no kit fragments exist, the code uses shatter instead.
- CSP: connect-src + blob: (the GLTFLoader reads embedded textures through blob). The team applied `safe_restart.sh web`.
- Ultra-HD drone: pipeline/generate_drone_hd.py (derived from the generator of the operator). It has 40,336 tris and 3 mats (EMISSIVE orange accent). It has blades with twist, 12 cooling/motor fins, fasteners, antennas, a GPS puck, and 24 spokes. It has REAL hardpoint_1..4. `doFire` fires from the hardpoint in turn.
- Gates: 12 objects load clean, customDrone true, fired/exploded 1/1, 67fps.

## v106 (2026-07-12): explosion v3, real power + performance recovered
- White-hot core (7 flash sprites with a ramp to orange). 22 TALL flames (non-uniform tall scale 1.5-2x + rise). A smoke column that rises (18, life 3.2-5.4s, grows to 11-18m). A DUST ring close to the ground, with earth color (14). EJECTA: 12 pieces of ground or building that fly in an arc and STAY as rubble. This detail was absent when a shot hit the photogrammetry.
- More effects: embers go from 60 to 110. Streaks go from 26 to 40. Flash 24m. Light 150. Missiles explode at big 1.25. The cap is 460 sprites (drawcalls).
- Residual fire: flames stretched 2.1x with vertical acceleration.
- Billboard clouds went up from 170 to 300m and got soft shadows. They looked like bug blobs at low urban altitude.
- PERF: kit fragments have no castShadow (70 bricks make 140 drawcalls in the shadow pass). This moved the game from 47fps to 71fps.
- Visual evidence: scorch and ejecta are visible on a roof (zenithal crop).

## v107 (2026-07-12): Gate Rush v2, difficulties + HD rings + approach
- DIFFS: easy 8×9m green / medium 10×6.5m blue / hard 13×4.2m purple (with varied height in the fallback). The records in localStorage are PER difficulty.
- Premium picker under the HUD (colors by level). It remembers the last difficulty in localStorage. `T` starts directly with the last difficulty.
- HD rings: torus 24×96 + thin inner ring + glow 12×72. The active ring rotates, pulses, and projects a light BEAM to the ground. A white ring flash shows when the drone passes each gate.
- 14 light crumbs move along the route (animated getPointAt). Splits: the HUD shows +Δs for each gate for 1.6s.
- Graceful approach: at the start, the drone FLIES to the entry point (easeInOut + small arc, pattern of the arcade transit). Then the countdown runs. No more teleport.
- Green autotest: challenge {time 3.62, gates 10 (medium), recFrames 217}, replay active, 70fps, 0 errors.

## v109 (2026-07-12): result modal v2 + clean replay
- The modal of Gate Rush v2 shows an animated badge `NUEVO RÉCORD` (NEW RECORD) or the delta compared with the record. A grid of 4 stats (gates, max speed, honest AVERAGE speed, which is the real distance of poses divided by time, and meters). A SPLITS TABLE for each gate with the best leg highlighted. A `Dificultad` button (Difficulty) reopens the picker. `Reintentar` (Retry) repeats the same difficulty.
- z-index bug: the FPV OSD (HOME/GIMBAL) painted OVER the buttons of the modal. Fix: `vl-result` z-60, and the FPV hides when the result shows.
- Replay and Director show the PURE FLIGHT. The circuit (rings, beams, crumbs, tube) is additive. It turned into giant veils when the drone flew inside it. Fix: setVisible(false) on entry and restore on exit (ESC and exitDirector).

## v111 (2026-07-12): senior VFX pass + complete arsenal
- REAL SMOKE: procedural multi-lobe texture (26 blobs with variable density, an irregular silhouette, not an ink disc). VFX opacity curve (fast entry ×5, quadratic exit, cap 0.6, never solid black). The smoke is BORN LIT by the fire (ramp `0xb56a34` to gray `0x8f8b86`). This applies to the column, dust, trail, and residual fires.
- Scorch with a soft radial gradient (no more black `landing pad` that floats).
- Ejecta: gravity 30 + aerodynamic drag, sizes 0.1-0.36, bounce 0.24.
- ARSENAL (export `ARSENAL`): MG (auto 11.8/s, ballistic tracers with spread, cumulative damage against the health of the kit, impacts with small dust and spark). Missiles S/M/L, each with its own speed, boom, cooldown, ammo, and regen. L has scale 1.5 and big 2.2.
- A premium selector UI above FIRE (MG/S/M/L). `Z` cycles the weapons. Hold-to-fire works with the pointer and with the held `X` key. The HUD shows ammo and cooldown for each weapon.
- Audio: percussive `mg()` 60ms bandpass 1.6k. `boom(big)` gives the L missile a deeper thunder (sub 80 to 20Hz) and a longer one (about 1.9s). The body has a deeper lowpass.
- Premium collision: red vignette flash for 0.5s on a crash (vl-hitfx).
- QA: `&fuego=mg` gives a sustained burst. Result: 18 bullets/1.6s, 0 errors, 70fps.

## v113 (2026-07-13): Ground Mode (`Modo Tierra`), ORIGINAL zombie horde
- LEGAL: the team did NOT extract anything from the APK/DZ of Black Ops Zombies (Activision copyright). The team took only the mechanics (an idea, not protectable): zombies that are original and procedural, made from primitives, with chase AI and waves. Zero third-party assets.
- zombies.js: hunched humanoid (capsules and spheres) with a walk animation (legs and arms move in turn, and the body sways). It chases the drone in XZ. The y value follows the terrain.
- WALKABLE ground: `walkable()` samples 4 neighbors and rejects a slope above 4.5m. The zombies do not stand on the cliffs of the photogrammetry. The places where they CAN go make physical sense. This directly improves the ground-level collision limit.
- Waves: 4+2·wave zombies. Hp and speed grow with each wave. Zombies spawn in a walkable ring 12-40m around the drone.
- Weapon integration: zombies are hittables (`.zombie`). MG damage is cumulative and makes blood. A direct missile kills. An explosion splashes in its radius. HUD: wave, kills, and active zombies + health bar (bite −8hp with a red flash).
- The `Modo Tierra` button is in the dock (game section). QA `&zombies=1` gives wave 1, 6 active, 70fps, 0 errors.

## v114 (2026-07-12): INVASION MODE (`Modo Invasión`) + VFX v4 + MG overhaul
- invasion.js (replaces zombies.js): 7 ORIGINAL procedural enemies. Zombies. Archers (arrows in an arc with ballistic compensation). Soldiers (bursts of 3). UFOs (closed orbit + plasma). Planes (passes). Dragon (snake path + fireballs + wing beats). Giants of about 12m (melee swipe). A multi-type selection modal opens when the player presses `Modo Invasión`. Each wave mixes the enemy types.
- Ground: `walkable()` with a footprint for each type (giant 5m/slope 6) and SMOOTHED HEIGHT (lerp dt*8, no steps). Flyers have their own patterns.
- Enemy projectiles do damage to health (arrow 6 / bullet 3 / plasma 10 / fire 15) with a red flash. A metallic enemy explodes when it dies (fx bridge to weapons).
- weapons v4: generic `hitEnemy` (blood ONLY on organics, spark on metal). MG with muzzle FLASH + tracer with glow (the bullets are clearly visible). Missile with cinematic ignition (25% to 100% in 0.6s + exit puff). Embers without confetti (80×0.42, fall at 34). Textures of 128/192px (42 lobes). Shock wave v2: bright front of 64seg + dark compression band (compressed air).
- Concussion FOV punch: a near explosion hits the FOV up to +7° with decay. This is the 'distortion' of a real detonation.
- HUD: mini ammo bar under each weapon in the selector (`--ammo` CSS var).
- Gate: `invasion=zombie,ufo,gigante,dragon` gives wave 1, 8 alive, 73fps, 0 errors. A UFO in orbit is visible in the screenshot.

## v115 (2026-07-12): ultra-HD enemy GLB pipeline (engine ready)
- SkeletonUtils vendored (official three 0.180, import through the shim). The team needs it to clone models with a skeleton.
- invasion.js: if assets/enemies/<type>.glb exists (manifest.json), the code loads it and clones it for each spawn. AnimationMixer with the clips 'walk', 'fly', 'attack', and 'idle'. The attack clip plays in melee and when the enemy fires projectiles. The impact center and radius come from the real bbox. The procedural model shows while the GLB loads (honest progressive load).
- docs/ENEMY_MODEL_SPEC.md has the full contract (axes, origin, real scale, clips, budget 80k/6mats/2048²). It also has copy-and-paste prompts for the 7 types (ORIGINAL, brand-free designs). It lists the files to deliver to ChatGPT. It gives install steps and a check gate.
- Gate: procedural invasion intact (71fps, 0 errors).

## v116 (2026-07-12): destruction kit v3, real PBR ejecta + regenerability
- The team compared the 3 kits. The GLBs are byte-identical. Kit-3 adds the GENERATOR (generate_destruction_kit.py goes to pipeline/). So the kit is regenerable and adjustable at will. Kit-3 also adds the intermediate passes (not vendored).
- REAL EJECTA: debris_pack.glb (16 PBR concrete and brick fragments from the kit, original, brand-free) loads lazily. Each explosion clones fragments with textures, not colored boxes. The fragments share geometry and material, so they are cheap. A procedural fallback runs while the GLB loads or when the GLB is absent.
- impact_crater.glb added to assets/destruction/models. It is available as a `type:'kit'` prop to dress scenes with persistent craters.
- Gate: fuego=1 green, 77fps, 0 errors.

## v117 (2026-07-12): ULTRA enemy GLBs installed (external pack v1.1)
- 7 final GLBs (13.8MB, 16.9k-77.5k tris, embedded 2K PBR, clips walk/fly/attack/idle/death) + LOD1/LOD2 available + manifest 7/7 + enemy_catalog. The issuer of the pack checked it: 56 GLBs passed the official validator with 0 errors. The team checked load, clone, and clips in three.
- The team REVIEWED the external patch. The team did not apply it blindly, because our file evolved. The team took these parts:
  - The cache-bust ?v=N (the bumper refreshes it).
  - Fliers y2=0 (center origin, contract).
  - The DEATH clip before removal (the mixer continues in the dead branch).
  - `!e.mixer` guards in the procedural animations (ring and wings).
  - A π flip after lookAt (the model points +Z, the front is −Z) in plane and dragon.
- OWN FINDING in the review: the procedural facings were inconsistent (zombie arms +Z, soldier rifle −Z). The team standardized EVERYTHING to the −Z contract. The team flipped the parts of the zombie and the archer. Ground units use a universal atan2+π. There is one single rule.
- Gate 7/7 types with GLB: all OK, 0 console errors, 70fps.

## v124 (2026-07-13): photogrammetry mesh, fix of double buildings + HD textures
- BUG 'broken map' (scene 0117 orbital house). The DSM-LOD sank -0.55m under the ODM mesh. But its EXTRUDED buildings (3-10m) still crossed the mesh. This gave double buildings and a mix of sharp and melted. FIX: the radial terrain mask (free since the mixed v4 view) cuts the DSM inside the FOOTPRINT of the mesh. The footprint is the bbox: XZ center + radius (w+d)/4, dithered edge. The DSM shows only the surroundings.
- Textures: the manifest exported only mesh_mtl_low (vtl 3.4MB thumbnails). On desktop it looked low-res. scene_manifest.py now exports mesh_mtl (vth 8.4MB) and mesh_mtl_extra (vtx 12.8MB). attachVisualMesh picks by device: coarse gets low, desktop gets vth. The team regenerated the manifests.
- applyVista() runs again when the mesh resolves (the mask is active on arrival).
- Gate 0117: visualMesh true, 69fps, 0 errors. The capture shows a sharp mesh without doubles.

## v125 (2026-07-13): scenes with a mesh, ONLY the high-res representation
- The melted DSM ring around the mesh still looked 'broken'. New rule: if the scene has a photogrammetry mesh, the code NEVER draws the visual DSM (no cut, no ring). Only the sharp mesh shows. The physics (heightAt, collision, craters) stays on the heightfield. A scene without a mesh follows the usual rules. The radial mask is free again.
- Gates 0117 + 0104 (both with a mesh): 71fps, 0 errors. Zenithal capture: pure high-res.

## v129 (2026-07-13): texture ladder of the mesh (the 'ugly' was texel)
- The problem was 'first it looks HD and then the ugly one stays'. The DSM+ortho (27MP) loaded first. The mesh arrived with downscaled viewer textures. So the swap LOWERED the perceived sharpness. The fix is a ladder:
  - Desktop default: viewer_extra/vtx (12.8MB, the sharpest viewer tier).
  - Quality extra/4K/ultra: `upgradeTextures()` goes up to the ORIGINAL ATLASES of the geo (about 90MB, 73 PNGs, swap by material name, lazy, one time). The principle is the same as ortho_full: a higher sample rate does not invent texture.
  - Mobile: low (3.4MB) as always.
- The manifest exports mesh_mtl_geo. scene.js saves material.name as an anchor and exposes upgradeTextures(). volar starts it when the quality goes up AND when the mesh resolves. The player can set the quality before the OBJ arrives. The first gate caught this bug: meshTexMax was null because setCalidad ran before the mesh.
- New QA param: `&calidad=auto|hd|extra|4k|ultra`.
- Gate 0117 extra: meshTexMax true, 71fps, 0 errors. The badge `· máx` is visible.

## v132 (2026-07-13): complete iPad pass + phantom bug of the gate
- COMBAT DEAD on iPad: the landscape sticks measured 52vh. The invisible zone on the right covered the FAB and captured the pointer. Fix: sticks 40vh landscape, explicit z-index:1, FABs and sheets z-44/43 with touch-action:manipulation. The team checked it with CDP + real touch emulation. A tap opens the panel. FIRE lowers the ammo from 8 to 7.
- iPad gets the desktop texture. Only a screen of <700px gets the low tier (an iPad M can handle vtx 13MB). The quality chip is visible on touch (extra+ gives the geo atlases also on iPad).
- Premium touch HUD: canvas TAPE compass (5° ticks, cardinal points, lubber line). It replaces the "N 0°" pill.. Telemetry with vertical speed (`VS`) in m/s (bipolar mint/amber bar). Redesigned metric cards (glass, tabular nums). The ghost chip is out on touch. Bigger sticks (base 132/156px, nub 58/66).
- PHANTOM BUG of the gate (bisect + 4 probes). `report.weaponState` held weapons.state (from the codex refactor). It exposed missiles and particles with THREE meshes: 27MB and 'Object reference chain is too long' in CDP returnByValue. This happened ONLY after a shot. So the fire gates hung with a clean console. Double fix: a scalar summary in the report, and the gate now serializes IN PAGE (JSON.stringify). This is immune to deep graphs from now on. RULE: `window.__volar` carries only flat data.
- Micro-fixes: doFire painted `[object Object]` in the ammo chip (the loop already paints for each weapon). report.weapons is live in the loop (it was frozen in the snapshot of the autotest).

## v136 (2026-07-13): touch, closes unlocked + arsenal by touch
- 'I CANNOT CLOSE ANYTHING' (iPad/mobile). Three causes stacked:
  - Cause 1: when a sheet opened, the FABs died (opacity:0 + pointer-events:none from the refactor). The panel and `Cerrar` (Close) never opted back out of the pointer-events:none of the HUD. So there was zero way to close. Fix: `BLOQUE 54` (.vl-dock/.vl-combat/head/buttons pointer-events:auto), FABs always alive as a toggle, and a universal tap-outside-closes (document pointerdown capture).
  - Cause 2: touch-action:none on the weapon buttons killed the synthesized click. So the selector was dead. Fix: touch-action only on FIRE. The selector uses pointerdown with DELEGATION to the document (it survives re-renders of the panel).
  - Cause 3: my v132 summary of report.weaponState ended up OUTSIDE the loop (the original site of the refactor was boot-time). The snapshot was frozen: the weapon always read 'm' and the ammo was full. Two rounds of bug search chased a fault of the THERMOMETER, not of the game. The team moved the summary into the loop (live).
- The touch E2E check (CDP touch) passed 5 checks. The checks were: `Cerrar` (the panel closes), a second tap on the FAB, and a tap outside the panel. The last two were the selection of L and fire L (ammo 3 to 2). There were 0 errors.
- LESSON: when the instrument says 'broken' but the mechanic looks healthy, check the instrument. The pair `selApplied:true` and `weapon:'m'` was impossible, except with a frozen snapshot.

## v139 (2026-07-13): black patches in 4K/ultra + iPad drift + HUD polish
- BLACK PATCHES in 4K/ultra (and the dance of reloads). The geo tier was 73 atlases of 4096². This is 6.5GB of uncompressed VRAM. With the 4× framebuffer, Metal evicted textures. The mesh painted black in patches. The load order decided which textures survived (this is why it 'sometimes worked'). The team REMOVED the geo tier, with the cause documented. vtx 2048² (1.6GB) is the healthy ceiling until KTX2/basis exists. The qualities extra+ give a higher sample rate and anisotropy (edges), not more texel.
- DRIFT to the left on iPad: the deterministic wind pushed the drone in hover. Honest GPS-hold: with no input and low speed, the drone STAYS (like a real drone with the sticks released). The wind comes back when the drone moves.
- FIRE: the button changed from a circle that overflowed to a horizontal pill (icon + label + ammo badge). It has order:9 in the column, so ghost and fps no longer overlap it.
- Premium FPS chip: glass, tabular nums, status dot (green, amber below 45fps).
- Check: zenithal ultra with no gaps (PIL 15.3% dark, which is legitimate shadows), gates 42/25fps, different for each rig, 0 errors.

## v140 (2026-07-13): honest view when no aligned splat exists
- Report 'I cannot change the view / old drone' in UPZs. The gate proved that the scene loads perfectly fresh (drone GLB + mesh + 59fps). The session of the operator was a LIVE TAB from before v124 (the headers are already no-store/no-cache, and a reload updates the tab). It was NOT a cache of the server.
- What WAS a bug (UX): UPZs has an 'unaligned' splat. So the photo-real and mixed views do not exist, for honesty. But the button for the view gave no message. Now a click with no splat shows the notice `esta escena no tiene splat alineado — solo vista 3D` (this scene has no aligned splat, 3D view only). This follows the pattern of the arcade. The chip has 45% opacity. It turns on again if the splat arrives async.

## v143 (2026-07-13): World overhaul, premium map selection
- Compact header (hero padding -40%). Cards with MINI-STATS (hectares, cm/px, GPS route) + badge `MALLA 3D` (3D MESH) + hover with lift, poster zoom, and glow.
- START OPTIONS in the mission panel: `Cielo` (Sky: day, sunset, night), `Calidad` (Quality: auto, HD, extra), and `Modo` (Mode: Normal, Arcade, `Dios` is God). The chips have a gradient state. The code saves them (ab.fv.launchcfg) and injects them into the deep link.
- Decluttered map: pin labels show ONLY on hover (the swarm of text was unreadable). Blue glow on hover of the poster-pin. Side fix: the pins used `fv-pin2`, which Codex DID style. The legacy `.fv-pin` stayed as an open item.
- Premium load overlay in volar: FLIGHTVERSE + scene name + indeterminate bar + steps TERRAIN/MESH/SPLAT that light up when each resolves. It fades out at 0.5s of sim (opacity only, 60fps).
- Sticks and FABs use the SAME formula `min(34vh,300px)`. On iPad portrait, the FAB with a cap ended INSIDE the zone of the stick without a cap (the matrix caught it).
- The team aligned the matrix to weaponState v132 (fired lives in report.weapons).
- Matrix 6/6 green: volar 71-75fps in 3 viewports, world 7 islands in 3 viewports.
