# FLIGHTVERSE — mapa del motor (three.js r180 optimized frontier)

## Módulos (web/flightverse/)
- `three.js` — SHIM: todo el juego importa three de aquí (r180). Nunca
  importar three180 directo desde módulos del juego.
- `scene.js` — SceneManifestV2 → terreno (heightfield+orto, máscara nodata y
  cobertura rasterizada de triángulos), malla estructural visual, splat Spark
  alineado (matriz Umeyama ±cm), track. Una generación posee un solo grupo
  `fv-world` y libera cargas asíncronas obsoletas.
- `world-collision.js` — consulta única BVH+DSM+borde para dron, MG y misiles:
  sweeps continuos, slide de hasta dos contactos, proximidad con línea de visión.
- `site.lod.json` — identidad estable, versión activa y coberturas verificadas de
  100/200/400/600/1000 m. Mundo nunca duplica versiones del mismo sitio; Volar selecciona
  círculo/cuadrado y bloquea una extensión pendiente en vez de inventar terreno.
- `runtime.js` — loop timestep FIJO 1/120 (determinismo de replays), input,
  física por modo (Normal velocidad-objetivo · Dios noclip · 6DOF ecctrl
  disponible), colisión BVH continua con envolvente derivada del GLB,
  slide+escape y cámara chase que se acorta ante el primer contacto real.
  La protección de terreno conserva AGL 1,20 m independiente del radio
  estructural. Pausa el render al ocultar la pestaña y vuelve con reloj limpio,
  sin cobrar deuda física.
- `render-quality.js` — governor puro de resolución Auto. Usa ventanas de frame
  time, dos ventanas lentas para bajar, tres estables para recuperar y cooldown
  entre cambios. Ignora spikes aislados y queda limitado a DPR 1–2.
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
3. Nada se declara hecho sin audit y gate CDP verdes
   (`audit_world.py`, `flightverse_collision_gate.py <cid> --stress 100`,
   `browser_matrix.py --flightverse`). El gate exige ≥50 FPS, un grupo de mundo,
   cero capas estructurales duplicadas y cero crecimiento GPU.
4. Estáticos: matrixAutoUpdate=false. Post: un solo EffectPass.
   Governor DPR en 'auto'; presets manuales HD→ultra. `window.__volar.render`
   publica DPR, media/p95 de frame, draw calls, triángulos, geometrías, texturas
   y pausas/reanudaciones; la matriz rechaza contadores no finitos.
5. Renames: regex \b, jamás substring (v80 se aprendió con sangre).
6. La frontera nativa se mezcla con el color atmosférico del cielo desde el
   shader del terreno. Nunca descarta geometría adicional ni crea otra capa
   estructural. `?diagnostic=1` conserva píxeles de diagnóstico exactos.
7. En touch, Imagen abre compacta: presets inmediatos y ajustes avanzados bajo
   demanda, con techo de 44dvh y scroll interno.
8. El dron normalizado a 0,85 m publica su radio estructural activo en
   `window.__volar.collision.radius_m` (rango seguro 0,42–0,70 m) y su procedencia
   en `radius_source`; producción exige `glb`, no un fallback aceptado por clamp.
   Director, llegada, tour y FPV no reciben corrección de cámara; los rigs chase
   publican consultas/contactos en `window.__volar.camera.collision_checks` y
   `collision_hits`. El gate de deploy prueba persecución con consultas y al menos
   un contacto real, y prueba FPV por separado exigiendo cero trabajo anti-clipping.

## Extender (nuevo juego/modo en ~1 módulo)
Crea `flightverse/<modo>.js` exportando `create<Modo>({scene, terrain,
ghost, ...})` con `update(dt)` determinista + UI en volar dock; gate con
`&autotest=<modo>` reportando en `window.__volar`.
