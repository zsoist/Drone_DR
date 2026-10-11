# Ultra-HD enemy GLB files: spec and prompts (Invasion mode, `Modo Invasión`)

Put each model in **`web/assets/enemies/<tipo>.glb`**. Mark the type in
**`web/assets/enemies/manifest.json`**, for example `{"dragon": true, "gigante": true}`.
Run `python3 pipeline/bump_web_version.py`. The game uses the model when an
invasion starts with that type. If there is no GLB, the game uses the procedural enemy.

Valid types: `zombie` · `arquero` · `soldado` · `ufo` · `avion` · `dragon` · `gigante`

The type names are Spanish identifiers. `arquero` is an archer. `soldado` is a soldier.
`avion` is an airplane. `gigante` is a giant.

## Technical contract (the same for all 7 types)
- **Format**: binary glTF (.glb) with EMBEDDED textures.
- **Axes**: +Y is up. The front of the enemy looks toward **-Z**.
- **Origin**:
  - Ground units: between the FEET at ground level. The game puts the origin on the real terrain.
  - Units that fly (`ufo`, `avion`, `dragon`): the geometric center.
- **REAL scale in meters**:
  - `zombie`, `arquero` and `soldado`: about 1.8 m tall.
  - `gigante`: about 12 m tall.
  - `ufo`: about 4 m in diameter.
  - `dragon`: about 8 m long.
  - `avion`: about 6 m of wingspan.
- **Budget**: at most 80k triangles and at most 6 PBR materials.
  Use baseColor, normal and metallicRoughness. Use emissive where the surface glows.
  Textures are at most 2048².
- **Animations (AnimationClips) with these EXACT names**:
  - `walk` (loop) is for ground units. `fly` (loop) is for units that fly.
  - `attack` (one-shot) starts when the enemy attacks. The attack can be a bite, an arrow, a burst, plasma or fire.
  - `idle` (loop) is optional. `death` is optional and the game does not use it yet.
  - Use a RIGID hierarchy (TRS tracks on nodes) or standard glTF skins.
    The game supports both. The project includes SkeletonUtils.
- **No** embedded lights or cameras. **No** logos and no characters from franchises.
  The designs are 100% original and brand-free. glTF-Validator must report 0 errors.

## COPY-PASTE PROMPT (one for each model, replace [TIPO])
> Create an ORIGINAL, brand-free game enemy in **binary glTF (.glb)** for a
> Three.js AAA-style game. Use no copyrighted characters or logos. Use an
> original design only. Technical contract (STRICT):
> - Axes: +Y up. The character faces **-Z**. Real-world meter scale.
> - Origin: between the feet at ground level (ground units).
>   For units that fly, the origin is the geometric center.
> - Budget: at most 80k triangles and at most 6 PBR materials.
>   Embedded textures are at most 2048² (baseColor + normal + metallicRoughness,
>   emissive where it glows).
> - **AnimationClips with exact names**: `walk` (loop), or `fly` (loop for
>   flyers), `attack` (one-shot), and optional `idle`.
>   Use rigid hierarchies of nodes (TRS tracks) or standard glTF skins.
> - No embedded lights or cameras. The file must pass glTF-Validator with 0 errors.
> - Also return a JSON check file. It lists triangles, materials, clip names and bounds.
>
> [TIPO]: paste ONE of these descriptions:
> - **zombie**: gaunt undead humanoid, 1.8 m, tattered dark clothes, mossy-green
>   decayed skin and hunched posture. In `walk`, it shambles with the arms forward.
>   In `attack`, it lunges and grabs with both hands. Gritty realistic PBR, weathered.
> - **arquero**: undead archer, 1.8 m, leather straps and a quiver,
>   primitive wooden bow in the left hand. `walk` is a shamble.
>   In `attack`, it draws the bow and looses an arrow.
> - **soldado**: modern generic infantry, 1.8 m (NO real-world insignia),
>   olive fatigues, a helmet and a fictional rifle. `walk` is a tactical jog.
>   In `attack`, it shoulders the rifle and fires a burst (with recoil).
> - **ufo**: sleek 4 m saucer, brushed-metal hull, emissive teal dome and a
>   light ring that turns (animate the ring in `fly`). In `attack`, the dome pulses.
> - **avion**: fictional attack jet, 6 m wingspan, matte grey, canards and
>   twin tails. In `fly`, the control surfaces flutter a little.
>   In `attack`, the wing cannons glow briefly at the muzzle.
> - **dragon**: 8 m western dragon, dark crimson scales, horned head and
>   membrane wings. In `fly`, the wings beat and the tail moves in an S-curve.
>   In `attack`, the head rears back and the jaws open (the moment of fire breath).
>   Add an emissive ember glow in the mouth.
> - **gigante**: colossal ORIGINAL humanoid, 12 m (a generic giant, NOT from
>   any franchise), weathered skin, muscular and barefoot.
>   `walk` is a heavy gait. Each step stomps. In `attack`, it smashes down with both hands overhead.

## Files to give to ChatGPT with the prompt
1. `docs/ENEMY_MODEL_SPEC.md` (this file, the contract)
2. `web/flightverse/invasion.js` (how the engine loads, animates and moves the enemies)
3. `docs/DRONE_MODEL_SPEC.md` (project conventions for axes and checks)
4. Optional, if ChatGPT asks for scene context: `docs/SCENE_OBJECTS.md`

## What the generator must return (for each enemy)
1. `<tipo>.glb` (embedded textures, named clips)
2. `<tipo>_validation.json` (triangles, materials, clips, bounds, 0 errors)
3. Optional: the generator script, to regenerate or adjust the model

## Install the files
1. Copy the file to `web/assets/enemies/<tipo>.glb`.
2. In `manifest.json`, set `{"<tipo>": true, ...}`.
3. Run `python3 pipeline/bump_web_version.py`.
4. Run the gate: `python3 pipeline/flightverse_spike_gate.py --page volar.html --global __volar --extra '&autotest=1&invasion=<tipo>&rig=1'`.
5. Make sure the result shows `invasion.alive > 0` and 0 console errors.
