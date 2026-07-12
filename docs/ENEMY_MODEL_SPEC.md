# Enemigos GLB ultra-HD — spec + prompts (Modo Invasión)

Suelta cada modelo en **`web/assets/enemies/<tipo>.glb`** y marca el tipo en
**`web/assets/enemies/manifest.json`** (ej. `{"dragon": true, "gigante": true}`).
Corre `python3 pipeline/bump_web_version.py`. El juego lo usa al iniciar una
invasión con ese tipo; sin GLB, vuela el procedural (fallback honesto).

Tipos válidos: `zombie` · `arquero` · `soldado` · `ufo` · `avion` · `dragon` · `gigante`

## Contrato técnico (idéntico para los 7)
- **Formato**: glTF binario (.glb), texturas EMBEBIDAS.
- **Ejes**: +Y arriba, el frente del enemigo mira a **-Z**.
- **Origen**: terrestres = entre los PIES a nivel del suelo (el juego lo apoya
  en el terreno real); voladores (ufo/avion/dragon) = centro geométrico.
- **Escala REAL en metros**: zombie/arquero/soldado ~1.8m alto · gigante
  ~12m alto · ufo ~4m diámetro · dragon ~8m largo · avion ~6m envergadura.
- **Presupuesto**: ≤ 80k triángulos, ≤ 6 materiales PBR (baseColor + normal +
  metallicRoughness; emissive donde brille), texturas ≤ 2048².
- **Animaciones (AnimationClips) con estos nombres EXACTOS**:
  - `walk` (loop) — terrestres. `fly` (loop) — voladores.
  - `attack` (one-shot) — se dispara al atacar (mordida/flecha/ráfaga/plasma/fuego).
  - `idle` (loop, opcional), `death` (opcional, aún no usado).
  - Preferir jerarquía RÍGIDA (tracks TRS sobre nodos) o skinning estándar
    glTF — ambos soportados (SkeletonUtils vendorizado).
- **Sin** luces/cámaras embebidas. **Sin logos ni personajes de franquicias**
  (diseños 100% originales, brand-free). glTF-Validator: 0 errores.

## PROMPT COPIA-PEGA (uno por modelo; sustituye [TIPO])
> Create an ORIGINAL, brand-free game enemy in **binary glTF (.glb)** for a
> Three.js AAA-style game. No copyrighted characters or logos — original
> design only. Technical contract (STRICT):
> - Axes: +Y up, character faces **-Z**. Real-world meter scale.
> - Origin: between the feet at ground level (ground units) / geometric
>   center (flying units).
> - Budget: ≤ 80k triangles, ≤ 6 PBR materials, embedded textures ≤ 2048²
>   (baseColor + normal + metallicRoughness, emissive where it glows).
> - **AnimationClips named exactly**: `walk` (loop) or `fly` (loop for
>   flyers), `attack` (one-shot), optional `idle`. Rigid node hierarchies
>   (TRS tracks) or standard glTF skinning both accepted.
> - No embedded lights/cameras. Must pass glTF-Validator with 0 errors.
> - Also return a validation JSON: triangles, materials, clip names, bounds.
>
> [TIPO] — pega UNA de estas descripciones:
> - **zombie**: gaunt undead humanoid 1.8m, tattered dark clothes, mossy-green
>   decayed skin, hunched posture, arms-forward shamble in `walk`, lunging
>   double-hand grab in `attack`. Gritty realistic PBR, weathered.
> - **arquero**: undead archer 1.8m, leather straps + quiver, primitive
>   wooden bow in left hand; `walk` shamble; `attack` = draw and loose arrow.
> - **soldado**: modern-generic infantry 1.8m (NO real-world insignia),
>   olive fatigues + helmet + fictional rifle; `walk` = tactical jog;
>   `attack` = shoulder rifle and fire burst (recoil).
> - **ufo**: sleek 4m saucer, brushed-metal hull, emissive teal dome and
>   rotating light ring (animate ring in `fly`); `attack` = dome pulse.
> - **avion**: fictional 6m-wingspan attack jet, matte grey, canards,
>   twin tails; `fly` = subtle control-surface flutter; `attack` = brief
>   wing-cannon muzzle glow.
> - **dragon**: 8m western dragon, dark crimson scales, horned head,
>   membrane wings; `fly` = wingbeat cycle + tail S-curve; `attack` = rear
>   head and open jaws (fire breath moment). Emissive ember glow in mouth.
> - **gigante**: 12m colossal ORIGINAL humanoid (generic giant — NOT from
>   any franchise), weathered skin, muscular, barefoot; `walk` = heavy
>   stomping gait; `attack` = overhead two-hand smash.

## Archivos que debes darle a ChatGPT junto al prompt
1. `docs/ENEMY_MODEL_SPEC.md` (este archivo — el contrato)
2. `web/flightverse/invasion.js` (cómo carga/anima/mueve el motor)
3. `docs/DRONE_MODEL_SPEC.md` (convenciones de ejes/validación del proyecto)
4. Opcional si pide contexto de escena: `docs/SCENE_OBJECTS.md`

## Qué debe devolverte (por cada enemigo)
1. `<tipo>.glb` (texturas embebidas, clips nombrados)
2. `<tipo>_validation.json` (triángulos, materiales, clips, bounds, 0 errores)
3. (opcional) el script generador para regenerar/ajustar

## Instalación al recibirlos
1. Copia a `web/assets/enemies/<tipo>.glb`
2. `manifest.json`: `{"<tipo>": true, ...}`
3. `python3 pipeline/bump_web_version.py`
4. Gate: `python3 pipeline/flightverse_spike_gate.py --page volar.html --global __volar --extra '&autotest=1&invasion=<tipo>&rig=1'`
   → `invasion.alive > 0` y 0 errores de consola.
