# Objetos de escena — la plataforma para hacer juegos sobre tus splats/ODM

Cada escena puede tener `models/<cid>/objects.json` con elementos 3D que el
juego instancia ANCLADOS al terreno real (heightAt del DSM). Runtime:
`web/flightverse/objects.js` · consumo automático en /volar.

## Contrato objects.json (v1)
```json
{"version":1,"objects":[
 {"type":"beacon","pos":[-40,0,30],"scale":1.6,"color":"#7dffc9","ground":true},
 {"type":"ring","pos":[10,18,10],"scale":2.2,"spin":true,"bob":true},
 {"type":"glb","file":"arbol.glb","pos":[5,0,-12],"yaw":1.2,"scale":3}
]}
```
- `type`: `glb` (de `web/assets/props/`) · `ring` · `beacon` · `box`.
- `pos` [x,y,z] en METROS del frame de la escena (origen=centro del DSM,
  +x este, +z sur). Con `ground:true` (default) la Y es ALTURA SOBRE EL
  SUELO real en ese punto; con `false`, Y absoluta del mundo.
- `yaw` rad · `scale` 0.05–50 · `spin`/`bob` animan (los estáticos congelan
  matrices = gratis en render) · `color` para primitivas.

## Escribirlos
- A mano en el vault, o vía API (auth):
  `POST /api/scene_objects {"clip_id":"...","objects":[...]}`
  — valida el contrato (máx 200, tipos/rangos) y escribe el json.
- Tras editar: `python3 pipeline/scene_manifest.py <cid>` (expone el asset)
  y recarga. Gate: `report.objects` = nº instanciado.

## Props GLB (mismas reglas que el dron)
+Y arriba, origen en el centro-base, ≤20k tris, ≤2 materiales PBR,
sin luces/cámaras/animaciones. Suéltalos en `web/assets/props/` +
`bump_web_version.py`. Prompt LLM completo: ver DRONE_MODEL_SPEC.md
(cambia proporciones/semántica del objeto).
