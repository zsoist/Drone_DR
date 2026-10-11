# Scene objects: the platform for games on your splats and ODM scenes

Each scene can have a file `models/<cid>/objects.json`. The file lists 3D elements. The game places them on the real terrain with `heightAt` of the DSM.
The runtime is `web/flightverse/objects.js`. The `/volar` page loads the objects automatically.

## The objects.json contract (v1)
```json
{"version":1,"objects":[
 {"type":"beacon","pos":[-40,0,30],"scale":1.6,"color":"#7dffc9","ground":true},
 {"type":"ring","pos":[10,18,10],"scale":2.2,"spin":true,"bob":true},
 {"type":"glb","file":"arbol.glb","pos":[5,0,-12],"yaw":1.2,"scale":3},
 {"type":"kit","file":"brick_wall.glb","pos":[8,0,-4],"destructible":true,
  "collidable":true,"materialClass":"brick"}
]}
```
- `type` has one of these values:
  - `glb`: a file from `web/assets/props/`.
  - `kit`: a file from `web/assets/destruction/models/`.
  - `ring`, `beacon` and `box`: primitive shapes.
- `pos` is `[x,y,z]` in METERS in the frame of the scene. The origin is the center of the DSM. East is the +x direction. South is the +z direction.
  - With `ground:true` (the default), Y is the height above the real ground at that point.
  - With `ground:false`, Y is the absolute height in the world.
- `yaw` is in radians. `scale` is from 0.05 to 50.
- `spin` and `bob` animate the object. Static objects freeze their matrices, so they cost nothing in the render.
- `color` is for primitive shapes.
- `collidable` is `true` by default for all objects except `ring`. Set it to `false` only for decoration that the drone can fly through. The drone, the camera, the reticle and the weapons use the same collider.
- `destructible:true` makes the object a target for the weapons. The collider becomes invalid in the same fixed step in which the object breaks.
- `materialClass` keeps the surface class for impacts and effects. The values are `metal`, `wood`, `brick`, `concrete`, `crate` and others.

## Write the objects
- Write the file by hand in the vault, or use the API (needs authentication):
  `POST /api/scene_objects {"clip_id":"...","objects":[...]}`.
  The API checks the contract (maximum 200 objects, types and ranges) and writes the JSON.
- After you edit the file, do these steps:
  1. Run `python3 pipeline/scene_manifest.py <cid>`. This command exposes the asset.
  2. Reload the page.
  3. Check the gate: `report.objects` is the number of objects that the game placed.

## GLB props (same rules as the drone)
- The +Y axis points up.
- The origin is at the center of the base.
- The budget is at most 20k triangles and at most 2 PBR materials.
- Do not put lights, cameras or animations in the file.
- Put the files in `web/assets/props/`. Then run `bump_web_version.py`.
- For the full LLM prompt, see `DRONE_MODEL_SPEC.md`. Change the proportions to fit the object.
