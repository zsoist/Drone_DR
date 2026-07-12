# Modelos del dron — spec ULTRA HD v2 (drone.glb)

Suelta tu modelo en **`web/assets/drone.glb`**, pon `"drone_glb": true` en
`web/assets/manifest.json`, y corre `python3 pipeline/bump_web_version.py`.
El juego lo usa automáticamente (fallback: el procedural).

## Qué soporta el motor ahora (v96+)
- **Presupuesto ULTRA**: hasta **120k triángulos** y **8 materiales PBR**.
  Texturas embebidas hasta **2048²** (baseColor, normal, metallicRoughness,
  emissive, AO). GLB raw ≤ 15 MB (sin Draco — no está vendorizado).
- **PBR real**: hay environment map en escena — metallic/roughness reflejan
  de verdad. Normal maps con anisotropía al máximo del GPU. Sombras propias
  (cast + receive) automáticas.
- **Emisivos**: materiales con `emissive` brillan con el Bloom del pipeline
  (LEDs, pantallas, toberas — úsalo).
- El juego añade por su cuenta: LEDs de navegación, blur de hélices, sombra.

## Nodos con nombre (el juego los anima por nombre)
- `prop_1`..`prop_4` — hélices, pivote en el eje del motor (giran solas).
- `hardpoint_1`..`hardpoint_4` — (opcional) puntos de anclaje de armamento;
  si existen, los misiles salen de ahí (si no, bajo el cuerpo).
- `gimbal` — (opcional) el nodo se inclina con la rueda del mouse.

## Prompt COPIA-PEGA para generar el modelo (Meshy/Tripo/LLM/Blender)
> Create a photorealistic quadcopter drone in **binary glTF (.glb)**:
> - Axes: nose toward **-Z**, up **+Y** (glTF/three convention); gimbal
>   camera looks at -Z. Origin at body center.
> - Any uniform scale (game normalizes X wingspan to 0.85 m). Real
>   DJI-class proportions: body ≈ 60% of span, foldable arms, prop guards.
> - Budget: **≤ 120k triangles, ≤ 8 PBR materials**, embedded textures
>   ≤ 2048² (baseColor + normal + metallicRoughness; emissive for LEDs
>   and camera lens ring). No lights/cameras/animations embedded.
> - Each propeller as a separate node named `prop_1`..`prop_4`, pivot on
>   its motor axis. Optional: `hardpoint_1`..`hardpoint_4` under arms,
>   `gimbal` node for the camera pod.
> - Surface detail: panel lines, screws, vents, carbon-fiber weave normal
>   map on arms, brushed metal on motor bells, glossy dark camera lens.
> - **No logos or brand marks** (copyright-free).
> - Validate with glTF-Validator: 0 errors.

## Prompt para PROPS de escena (assets/props/*.glb)
> Create a game prop in binary glTF (.glb), Y-up, origin at base center,
> real-world meters scale. Budget ≤ 40k tris, ≤ 4 PBR materials,
> textures ≤ 1024². No logos. Single object, clean silhouette.
> [describe el prop: crate, barrel, antenna, target balloon…]
Luego en `models/<cid>/objects.json`: `{"type":"glb","file":"tuprop.glb",
"pos":[x,0,z],"ground":true,"destructible":true}` — destructible=true lo
hace volable por los misiles (fragmentación + física).

## Verificación local
1. Copia a `web/assets/drone.glb` → `python3 pipeline/bump_web_version.py`
2. `python3 pipeline/flightverse_spike_gate.py --page volar.html --global __volar --extra '&autotest=1'`
   → `customDrone: true` y 0 errores. Con `&fuego=1` prueba armamento.
3. Vista rápida: volar.html?m=<cid> — C cicla cámaras, X dispara.
