# FLIGHTVERSE — mapa del motor (three.js r180 optimized frontier)

## Módulos (web/flightverse/)
- `three.js` — SHIM: todo el juego importa three de aquí (r180). Nunca
  importar three180 directo desde módulos del juego.
- `scene.js` — SceneManifestV2 → terreno (heightfield+orto, máscara nodata
  border-only, shader-injection única), splat Spark alineado (matriz Umeyama
  ±cm), track. heightAt = sampler bilineal O(1).
- `runtime.js` — loop timestep FIJO 1/120 (determinismo de replays), input,
  física por modo (Normal velocidad-objetivo · Dios noclip · 6DOF ecctrl
  disponible), colisión BVH slide+escape, rigs de cámara puros.
- `objects.js` — objetos de escena (SCENE_OBJECTS.md): GLB/primitivas,
  ancla a suelo, spin/bob; estáticos con matrices congeladas.
- `gaterush.js` — desafío: curso sobre el track real, camino Mario-Galaxy,
  rec 60Hz → replay/Director.
- `sky.js` — domo shader 3 paradas + sol/luna/galaxia/nubes; gobierna luces.
- `audio.js` (WebAudio sintetizado) · `touch.js` (RC Mode 2) ·
  `recorder.js` (WebM en vivo) · `export.js` (determinista WebCodecs 1080p).

## Reglas de oro
1. Assets pesados NUNCA al cliente sin LOD/preparación (dsm_lod, clean.sog,
   collision_bake con banda [suelo-2, +32]).
2. Todo batch de edits web termina con `pipeline/bump_web_version.py`.
3. Nada se declara hecho sin gate CDP verde
   (`flightverse_spike_gate.py`, `browser_matrix.py --flightverse`).
4. Estáticos: matrixAutoUpdate=false. Post: un solo EffectPass.
   Governor DPR en 'auto'; presets manuales HD→ultra.
5. Renames: regex \b, jamás substring (v80 se aprendió con sangre).

## Extender (nuevo juego/modo en ~1 módulo)
Crea `flightverse/<modo>.js` exportando `create<Modo>({scene, terrain,
ghost, ...})` con `update(dt)` determinista + UI en volar dock; gate con
`&autotest=<modo>` reportando en `window.__volar`.
