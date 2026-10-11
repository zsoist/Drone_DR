# Drone models: ULTRA HD spec v2 (drone.glb)

Put your model in **`web/assets/drone.glb`**. Set `"drone_glb": true` in
`web/assets/manifest.json`. Run `python3 pipeline/bump_web_version.py`.
The game uses the model automatically. If the file is not there, the game uses the procedural drone.

## What the engine supports now (v96+)
- **ULTRA budget**: up to **120k triangles** and **8 PBR materials**.
  Embedded textures can be up to **2048²** (baseColor, normal, metallicRoughness,
  emissive, AO). The raw GLB must be 15 MB or less. The game does not include Draco.
- **Real PBR**: the scene has an environment map, so metallic and roughness
  surfaces reflect it. Normal maps use the maximum anisotropy of the GPU.
  The drone casts shadows and gets shadows from other objects. This is automatic.
- **Emissive materials**: materials with `emissive` glow with the Bloom of the pipeline.
  Use this for LEDs, screens and nozzles.
- The game adds its own navigation LEDs, propeller blur and shadow.

## Named nodes (the game animates them by name)
- `prop_1`..`prop_4`: the propellers. The pivot is on the motor axis. They turn by themselves.
- `hardpoint_1`..`hardpoint_4`: optional mount points for weapons.
  If they exist, the missiles leave from there. If they do not exist, the missiles leave from under the body.
- `gimbal`: optional. The node tilts with the mouse wheel.

## Copy-paste prompt to generate the model (Meshy/Tripo/LLM/Blender)
> Create a photorealistic quadcopter drone in **binary glTF (.glb)**:
> - Axes: nose toward **-Z**, up **+Y** (glTF/three convention).
>   The gimbal camera looks at -Z. The origin is at the body center.
> - Use any uniform scale. The game normalizes the X wingspan to 0.85 m.
>   Use real DJI-class proportions: the body is about 60% of the span.
>   Include foldable arms and prop guards.
> - Budget: at most **120k triangles** and at most **8 PBR materials**.
>   Embedded textures are at most 2048² (baseColor + normal + metallicRoughness).
>   Use emissive for the LEDs and the camera lens ring.
>   Do not embed lights, cameras or animations.
> - Make each propeller a separate node. Name the nodes `prop_1`..`prop_4`.
>   The pivot is on its motor axis. Optional: `hardpoint_1`..`hardpoint_4` under the arms.
>   Optional: a `gimbal` node for the camera pod.
> - Surface detail: panel lines, screws and vents.
>   Use a normal map of carbon-fiber weave on the arms.
>   Use brushed metal on the motor bells.
>   Use a glossy, dark lens on the camera.
> - **No logos or brand marks** (copyright-free).
> - Make sure glTF-Validator reports 0 errors.

## Prompt for scene PROPS (assets/props/*.glb)
> Create a game prop in binary glTF (.glb). Use Y-up and real-world meters scale.
> The origin is at the center of the base.
>
> Budget: at most 40k triangles and at most 4 PBR materials.
> Textures are at most 1024². No logos.
> Make a single object with a clean silhouette.
>
> [Describe the prop here: crate, barrel, antenna, target balloon...]

Then add the prop to `models/<cid>/objects.json`:
`{"type":"glb","file":"tuprop.glb","pos":[x,0,z],"ground":true,"destructible":true}`.
With `destructible:true`, the missiles can blow up the prop (fragmentation and physics).

## Local check
1. Copy the file to `web/assets/drone.glb`. Then run `python3 pipeline/bump_web_version.py`.
2. Run `python3 pipeline/flightverse_spike_gate.py --page volar.html --global __volar --extra '&autotest=1'`.
3. Make sure the result shows `customDrone: true` and 0 errors.
   To test the weapons, add `&fuego=1`.
4. For a quick view, open `volar.html?m=<cid>`. Press C to change the camera. Press X to fire.
