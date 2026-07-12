# WORLD CONTEXT PROMPT — para Codex/ChatGPT (copia-pega)

Prompt maestro para que un LLM externo entienda TODO el mundo FLIGHTVERSE
antes de pedirle assets, análisis o propuestas de código. Adjunta los
archivos de la lista del final.

---

## THE PROMPT (copy-paste everything between the lines)

You are joining **FLIGHTVERSE**, a production browser video game built on top
of REAL photogrammetry scenes (the operator's own drone scans of Bogotá,
Colombia), live at vuelos.metislab.work. Read this contract carefully — every
suggestion you make must fit it.

### Platform & hard constraints
- **Stack**: vanilla JavaScript ES modules, **NO build step, NO npm at
  runtime**. Everything is vendored under `web/vendor/`: three.js r180 (via
  shim `web/flightverse/three.js`), Spark 2.1 (Gaussian splat renderer),
  three-mesh-bvh, camera-controls, postprocessing (r180 build), webm-muxer,
  GLTFLoader + BufferGeometryUtils + SkeletonUtils.
- **CSP is strict**: `script-src 'self' 'wasm-unsafe-eval'`, `connect-src
  'self' data: blob:` + two map tile hosts. No CDNs, no external fetches, no
  eval. Any proposal that violates CSP is invalid.
- **Determinism**: fixed timestep 1/120s (`STEP`) for physics/game logic;
  rendering interpolates. Replays re-simulate — never use Date.now/random
  inside fixed-step logic that must replay.
- **Honesty rules**: no fake data ever. If a scene lacks a capability
  (no GPS track → no Arcade), the UI says so and degrades gracefully.
  The photogrammetry is a real scan: explosions crater the GAME terrain
  heightfield but we never pretend to destroy the real world's splat.
- **Language**: UI text in Spanish, code + comments in English or Spanish,
  **NO emojis in UI** (SVG icons only). Original content only — no
  copyrighted characters, logos, or franchise likenesses.
- After ANY web file edit: `python3 pipeline/bump_web_version.py` rewrites
  `?v=N` cache-busters and regenerates .gz. Verification is headless CDP
  gates: `python3 pipeline/flightverse_spike_gate.py --page volar.html
  --global __volar --extra '&autotest=1'` must report 0 console errors and
  fps ≥ 50.

### World data model (per scene, `models/<cid>/`)
- `scene.v2.json` — manifest: capabilities (only-if-exists), asset paths,
  splat↔terrain alignment matrix (Umeyama, RMSE ~cm), datum.
- `dsm_lod.bin/json` — 512² Float32 heightfield (meters, row 0 = north,
  +x = east, +z = south, heights relative to elev_min) + nodata mask.
  `makeHeightSampler` gives `heightAt(x, z) -> meters | null`. The terrain
  mesh is a displaced PlaneGeometry; `terrain.crater(x, z, r, depth)`
  deforms BOTH the mesh and the heightfield (collision follows).
- `collision.bin` — pre-baked triangle soup (from the splat, band-filtered)
  loaded into three-mesh-bvh for drone collision (slide + anti-stuck).
- `<cid>.clean.sog / .ksplat` — Gaussian splat, rendered by Spark, aligned.
- `objects.json` — scene objects: prims (ring/beacon/box) or GLBs from
  `assets/props/` or `type:"kit"` from `assets/destruction/models/`
  (pre-fractured GLBs with extras: role/massKg/mode/explosive). Flag
  `destructible:true` registers them as weapon targets.
- `track.json` — real GPS flight track (ghost replay + Gate Rush course).

### Game modules (`web/flightverse/`)
- `runtime.js` — fixed loop, input, `MODES` (cinematico/asistido='Normal'/
  arcade=autopilot over real track/dios=noclip), `RIGS` (cameras: Muy cerca,
  Cerca, Lejos, FPV, Cenital, Órbita, Lateral), drone physics (velocity-
  target + deterministic wind), MIN_AGL ground clamp, BVH collision.
- `volar.js` (~1400 lines) — the game page orchestrator: HUD, quality ladder
  (auto/HD/extra/4K/ultra supersampling), grade panel (exposure/bloom/etc),
  weapon UI, invasion modal, Gate Rush UI, replay/Director, camera shake +
  FOV concussion punch, minimap, QA URL params (`&autotest=1`, `&fuego=1|mg`,
  `&boom=1`, `&rig=N`, `&cielo=dia|atardecer|noche`, `&invasion=tipo,...`,
  `&reto=1&dif=facil|media|dificil`).
- `sky.js` — procedural sky v5: 3-stop gradient dome + below-horizon haze,
  real moon (solid disc, value-noise mares, limb darkening), 2-layer
  twinkling stars, Mie-toy sunset scattering, tileable fbm clouds + shaded
  cumulus billboards, sun/moon DirectionalLight with follow-focus shadows.
- `weapons.js` — `ARSENAL`: MG (auto 11.8/s, ballistic tracers, cumulative
  damage) + missiles S/M/L (speed/boom/cooldown/ammo/regen per tier).
  Explosions: white-hot core, tall flame sprites with color-over-life,
  structured multi-lobe smoke (lit-by-fire ramp), ground dust ring, ejecta
  chunks that persist as rubble, ember Points, velocity-stretched spark
  streaks, double shockwave ring, PointLight flash, persistent soft scorch,
  crater deformation, residual fires. Hittables contract: scene objects
  `{node, center:Vector3, r2, color, hp?}` and enemies `{enemy:true, g,
  center, r2, hp, blood}`. Sprite cap 460.
- `invasion.js` — `ENEMIES`: zombie/arquero/soldado/ufo/avion/dragon/gigante.
  Ground units walk ONLY on walkable terrain (per-type footprint + max slope,
  smoothed height); flyers have per-type patterns (orbit/pass/serpentine).
  Enemy projectiles damage player health. External GLBs per
  `docs/ENEMY_MODEL_SPEC.md` (clips walk/fly/attack) with procedural
  fallback. Waves scale hp/speed/count.
- `gaterush.js` — `DIFFS` fácil/media/difícil (count/radius/colors), HD tori
  rings with spin/beacon/pass-flash, flowing light crumbs, splits per gate,
  graceful approach flight, records per difficulty (localStorage).
- `objects.js` / `audio.js` (synth quad acoustics + weapon sounds) /
  `recorder.js` (WebM) / `export.js` (deterministic 1080p WebCodecs) /
  `touch.js` (mobile RC sticks) / `gaterush`, `director` in volar.
- `mundo.html/js` — world select: island carousel + map (sat/dark/plano
  layers, coverage footprints, real route lines, mission popups).

### Performance budgets
60fps target on M-series Safari/Chrome. DPR governor ≤2 in auto. Shadow
map 2048 with tight follow frustum. Fragment-heavy assets must NOT cast
per-fragment shadows (70-brick wall taught us: -24fps). Additive particles
capped. GLB budgets: drone ≤120k tris, enemies ≤80k, props ≤40k.

### What we want from you
1. Answer questions about design/architecture within these constraints.
2. When asked for assets: follow `DRONE_MODEL_SPEC.md` / `ENEMY_MODEL_SPEC.md`
   exactly (axes -Z forward, +Y up, real meters, named nodes/clips, embedded
   textures, glTF-Validator 0 errors, validation JSON alongside).
3. When proposing code: full functions/patches referencing exact file +
   anchor, vanilla ESM, CSP-safe, deterministic-safe, with a QA plan using
   our gate params. Never introduce npm deps or external URLs.
4. Flag anything that would break: CSP, determinism, honesty rules, 60fps.

---

## Archivos para adjuntar junto al prompt
Mínimo (contexto de juego):
1. `docs/FLIGHTVERSE_IMPLEMENTATION.md` — ledger completo de features
2. `docs/GAME_ENGINE.md` — mapa de módulos + reglas de oro
3. `web/flightverse/runtime.js` · `weapons.js` · `invasion.js` · `sky.js`
4. `web/volar.js`
Si va a generar modelos: 5. `docs/DRONE_MODEL_SPEC.md` + `docs/ENEMY_MODEL_SPEC.md`
Si va a tocar escena/objetos: 6. `docs/SCENE_OBJECTS.md` + `web/flightverse/objects.js` + `scene.js`
Si va a proponer pipeline: 7. `pipeline/scene_manifest.py` + `dsm_lod.py` + `splat_align.py`
