# AeroBrain Flightverse — Design Spec v1

Scope: a drone game for the browser (three.js) over real photogrammetry of Bogotá. This spec is in English. The Spanish text of the user interface is in backticks. Baseline: audit scores (first impression 4, HUD 3.5, weapons 3, FX 2.5, enemies 3, audio 3, a11y 3). Target: at least 7 on every axis.

PRESERVE these items without change:
- The `Mundo` select cards, the world-load card, the altitude photogrammetry look and the `Cenital` camera.
- The hierarchy of the result card of Gate Rush and the typography of the defeat card.
- The 60 fps engine and the safe-area wiring.
- The weapon ammo and cooldown logic, the mono data type and the `Imagen` presets.

## 1. Pillars and tone

1. **Real place, your drone.** The city is the hero. Interface controls never cover it. At rest the HUD takes less than 12 % of the screen.
2. **One instrument language.** A single HUD grammar for every camera and mode (fighter/FPV: tapes, contextual data). No second HUD system.
3. **Readable action.** The player can read every shot, hit, threat and damage source in less than 200 ms. Shape comes first. Colour comes second.
4. **Every second is a run.** 20 s to the first shot. Less than 1 s to respawn. A reason to retry (medals, records, ghost).

Tone: premium, restrained and cinematic. Use graphite glass, thin hairlines and one accent. Do not use neon, glow-bloom UI, emojis, gradients on controls or decoration that pulses. Sound and light give the drama, not the controls.

## 2. HUD system

### 2.1 Palette (mapped to `web/DESIGN.md`; media chrome only, identical in both themes)
| HUD token | Value / source | Meaning |
|---|---|---|
| `--h-ink` | `--on-media` #E6EBF2 | primary numerals, reticle |
| `--h-ink-2` | `--on-media-2` #B7C2D0 | labels, ticks |
| `--h-plate` | `--media-scrim` rgba(8,10,14,.72) | text plates, blur 8px only on menus |
| `--h-line` | `--media-line` | hairlines, 1 px |
| `--h-cand` | #E0A458 (`--warn`) | candidate / capture / lock in progress |
| `--h-friend` | #45A0E6 (`--accent`) | friendly, own drone, gates, objectives |
| `--h-ok` | #52C79A (`--ok`) | registered kill, healthy, link OK |
| `--h-hostile` | #D96A6A (`--err`) | hostile + warning + damage ONLY |

Rule: red never decorates. Yellow means candidate. Blue and green mean friendly or good. Red means hostile or warning. Every state pairs colour with shape (Section 14).

### 2.2 Type
Numbers: `--mono` tabular, 14 px/600 (primary), 12 px/500 (secondary). Labels: site sans (`--font`), 12 px/500, uppercase only for 3-letter units, `--tr-caps`. Text is never below 12 px on the phone HUD. Plates use 8 px radius `--r-md` and padding 4x8.

### 2.3 Layout — one grid, three viewports
The safe area is `env(safe-area-inset-*)` plus a 12 px gutter. Zones: **T** top strip, **L/R** edge columns, **C** centre, **B** bottom controls. Zone C belongs to the reticle. Nothing else can be within 96 px of the centre.

**Phone portrait 430x932**
- T-left (x 12–60, y safe+8): back chevron `‹`, icon only, 44x44. It replaces the `Mundo` pill. T-right: pause icon 44x44. No other chrome at top-left or top-right.
- T-centre (y safe+8, h 28): a mission plate with mode timer, wave and gates "3/10". It shows only when a mode is active. Otherwise T-centre shows a compass heading strip 200x20 (N/E/S/W + degrees, mono 12).
- Speed tape: left edge, x 12, y 300–560 (260 px), 44 px wide, ticks every 2 m/s. A readout plate sits on the centre line.
- Altitude (AGL) tape: the mirror of the speed tape, on the right edge.
- Both tapes have 60 % opacity at rest. They have 100 % opacity while the value changes by more than 0.5 unit/s. **Tapes appear in every camera.** In non-FPV cameras they shrink to numeric plates only: `12.4 m/s`, `86 m`, y 300, no ticks.
- Under the compass: a vertical-speed arrow and a wind arrow chip (Section 11), 12 px. They sit at T-left below the back button.
- C: reticle (Section 3). In FPV only: pitch ladder ±30° in 10° steps and a horizon line, 1 px, 40 % opacity. Roll comes from the drone attitude (Section 11).
- B-left: move stick zone (x 0–215, y 560–932). The stick base appears under the thumb.
- B-right: aim/look zone (x 215–430, y 560–932).
- Fire button: 76 px at x 430-12-76, y 932-safe-150. The weapon chip is 56 px above it. The boost button is 56 px left of it.
- B-centre y 932-safe-96 (h 56): minimap. It shows only when the mode needs it (Gate Rush, `Invasión`, Tour). At other times it does not show.
- Bottom rail (y 932-safe-32, h 20): integrity bar 96x4 and battery bar 96x4, left and right of the centre. The battery bar has a `74 %` label in mono 12. The rail shows only if a value is less than 100 % or a mode is active.

**Phone landscape 932x430**
- The gutters use the left and right safe insets (notch side at least 44 px).
- Tapes at x 16 and right-16, y 120–310.
- Stick zones: left 40 % and right 40 % of the width, y at least 150.
- The fire cluster is at the right, y 430-safe-92.
- The top strip is the same as in portrait, y 8.
- Minimap 96 px, top-right, below the pause icon.
- Results and menus use two-column sheets (Section 8).
- Height rule: only tapes and the reticle can sit in the y 130–300 centre band. No other HUD element can sit there.

**Desktop 1440x900+**
- Tapes at x 10 % and 90 %, y 32–68 % of the height.
- Bottom-left cluster: weapon strip (6 slots, 44 px each, key numbers 1-6).
- Bottom-right: ammo/heat readout. The minimap is 160 px, bottom-right, above the readout.
- No touch controls.
- Keyboard hints appear only when `pointer:fine` (never `H` on touch).

### 2.4 Always / contextual / never
- **Always:** reticle, speed, AGL, heading, pause icon, back icon.
- **Contextual elements** fade in and out (150 ms ease-out). They hide after 2.5 s idle, if they are not critical:
  - Weapon chip and ammo: visible 2.5 s after fire or switch, permanent in combat modes.
  - Integrity and battery: when a value is less than 100 % or a mode is active.
  - Wind chip: when the wind is more than 3 m/s or has gusts.
  - Attitude ladder (FPV), lock box, threat arrows and minimap.
  - Gimbal readout: appears 1.5 s on a change, then hides.
  - REC dot: while the recorder is on.
  - FPS: debug `?debug=1` only.
- **Never:** "60 fps" badge in production, DIST/FLT/HS/VS status line, `H` key hint on touch, world-space aim rings, permanent gimbal pill.

### 2.5 Motion and states
- Enter and exit: opacity + 4 px translate, 150 ms `--ease-out`.
- Value change: no animation on numerals. The only exception is a 100 ms colour flash when a value crosses a threshold.
- Warning state: the colour changes to `--h-hostile`, the border style changes (dashed) and a 2 Hz blink runs for 1 s. Then the state is steady.
- Inactive control: opacity .4.
- Reduced motion: no translate, no blink (steady colour + icon).

### 2.6 Elements to DELETE
Delete these elements:
- `.vl-fpv-head` (status line), `.vl-osd-home`, `.vl-osd-gimbal` (pill on crosshair), `.vl-fpv-br` corner brackets and `.vl-fpv-sig` bars.
- `.vl-fpv-rec` `REC`. It becomes an 8 px red dot in the T-centre plate.
- `.vl-fpv-cross`. The reticle system replaces it.
- `.vl-corner.tr` metric tiles (`vl-agl/spd/vs` + bars). The tapes replace them.
- `#vl-fps` production badge.
- `.vl-trigger` and `FUEGO` (one fire button only). Also `.vl-fire` `DISPARAR` in the combat dialog.
- `.vl-command-hud` and the old text tile of `.vl-weapon-toggle`.
- `.vl-gimbal-tools` toggle. The gimbal moves into the `Cámara` pause tab. Live ±5° control comes from the stick tilt on the look zone.
- `.vl-flight-tools-left` CAM/chevron/`Menú` trio.
- `.vl-fab` `Menú` (it becomes the pause icon).
- `.vl-dock` and `.vl-combat` bottom sheets, and `.vl-help`.
- `.vl-kills` panel (kills go to the T-centre plate).
- `.vl-goto`.
- `.vl-compass canvas tape`. The heading strip replaces it.
- The two-HUD split: delete the `fpv-active` class branches for layout. Keep only the FPV extras: ladder and horizon.

## 3. Reticle system (screen-space only)
Delete the world-space pink ring completely. The aim point is a screen-space element. It sits at the projected hit point if the ray hits within 400 m. Otherwise it sits at the centre of the screen. Its size is constant in px. The size never grows when a target gets near.
- **Base:** 4 tick marks (each 8x1.5 px, gap 10 px) + 2 px centre dot, `--h-ink`, 70 % opacity.
- **Per class:**
  - Gun (MG/AC): ticks and a spread ring of 1 px. The ring diameter equals the spread angle (MG 22 px, AC 14 px).
  - Missile (MISIL): ring 28 px with 4 gaps, and a lock box.
  - Swarm: 8 small dots on a 30 px circle. The dots fill as the player adds targets (max 8).
  - Rail: thin vertical and horizontal hairlines, 60 px, and a charge arc.
  - Nova: dashed circle 40 px and an arc that shows the splash radius, projected at the aim point. Draw it on the HUD canvas (screen-space), not in the world.
- **Lead pipper** (MG, AC, SWARM, enemy targets only): 6 px hollow square, `--h-cand`. It sits at the predicted intercept point, with bullet drop added (MG 3.6 m @200 m, AC 5.2 m @200 m). The drop correction applies to both the aim point and the tracer. The pipper shows only when a target is within 250 m and in the front 30° cone. It turns `--h-friend` when the target is inside the pipper for 0.2 s.
- **Lock box** (MISIL guided, SWARM): a rectangle with the size of the projected bounds of the target (min 32 px). It has corner-only brackets of 2 px. The box is yellow while the lock builds. A 1 px progress line fills around the perimeter over 0.8 s. The box is solid blue when locked, with a tone. It is red only for missiles that approach the player. If the player loses the lock, the box shrinks and fades in 150 ms.
- **Heat/cooldown ring:** 1.5 px arc around the reticle, radius 20 px.
  - MG/AC: the ring fills with heat. The colour goes from `--h-ink` to `--h-cand` at 70 % and to `--h-hostile` at 100 %. At 100 % the weapon overheats: 1.2 s lockout, ring dashed.
  - Missiles, rail and nova: the ring is a clockwise cooldown sweep. A 2 px tick and a 40 ms flash show when the weapon is ready.
- **Hit markers:** 4 diagonal ticks around the centre, 100 ms ease-out.
  - Full hit: white, 12 px.
  - Graze: 60 % opacity, 8 px.
  - Deflect (no damage): short horizontal dash, grey.
  - Kill: red-tinted X, 16 px, 250 ms, plus 2-tone sound (Section 12).
  - Numbers: none.
- **Damage arcs:** 60° arcs on a ring. Ring radius: 32 % of the shorter screen side. Colour `--h-hostile`, 4 px thick. Each arc fades over 1.2 s and points toward the source. Maximum 3 arcs at the same time. Low health adds a 6 % red vignette on the edge only (no screen tint).

## 4. Weapons (9 → 6)
Reason: the three missile tiers (M·S, M·M, M·L) and VIPER-X differ only by numbers on a touch screen. Merge them into one **MISIL** weapon with two behaviours:
- Tap: unguided (M·M profile, 56 m/s).
- Press-and-hold on a target locks it. The release then fires a guided missile (VIPER-X profile, 62 m/s, turn 1.9 rad/s).

The M·S, M·L and VX profiles stay in `weapon-registry.js` as internal variants. They have no UI. The ammo and cooldown logic does not change. Result: MG, AC-30, MISIL, SWARM-8, RAIL, NOVA. The phone weapon strip has 6 slots.

| Weapon | Role | Cadence / ammo (current) | Projectile visual | Muzzle | Impact FX | Shake | Hit-stop | Sound layers | HUD readout | Icon |
|---|---|---|---|---|---|---|---|---|---|---|
| MG | sustain anti-light | 0.085 s auto, 120 rd | tracer every 3rd round: additive streak 1.2 m long × 0.035 m wide, core `#FFF3D6`, edge `#FFB25A`, alpha .9→0 over the tail; non-tracer invisible | 3-frame flash sprite 0.35 m, warm, plus 1 spent-casing puff | spark burst 6, dust puff, 0.4 s | T1 (0.02) | none | crack 90 ms + body 60 ms + tail 250 ms; pitch ±4 % random | ammo mono + heat ring | three ticks over a bar |
| AC-30 | heavy kinetic | 0.16 s auto, 48 rd | tracer 2.0 m × 0.06 m, core white, edge `#FF8A3D`, every round | 5-frame flash 0.7 m + smoke wisp | spark 12, debris 6, scorch decal 0.5 m, smoke 0.8 s | T1→T2 on 10th round | none | low thump + metallic crack + mechanical ring-down 400 ms | ammo + heat | single thick bar |
| MISIL | general purpose | 0.9 s, 8 | missile mesh (from models) + engine flare sprite 0.5 m + smoke trail 1.5 m, 24 puffs max | backblast puff 0.6 m | Explosion M (Sect. 5), crater decal 2 m | T2 (0.06) | 50 ms on kill | release whoosh + rising Doppler loop + blast (thump + crack + debris rain 1.2 s) | ammo + lock state | triangle nose over a fin |
| SWARM-8 | area denial against groups | 3.2 s, 4 pods × 8 rockets, 0.085 s interval | 8 mini missiles, trail 0.8 m, spread cone 6°, each with slight roll | 8 small flashes | 8 × Explosion S, staggered | T1 per hit, 8-hit budget caps at T2 | none | 8 staggered pops, pitch steps +2 semitones per rocket | pods left `3/4` + rocket dots | cluster of 8 dots |
| RAIL | precision pierce | 1.7 s, 10; 0.35 s charge | 0.25 s straight beam 0.06 m wide, core white, edge `#8FD3FF`, plus a distortion ripple line and a 1.2 s fading afterglow (fixes "invisible") | ring flash 0.5 m + charge whine | white flash 0.12 s, shockwave ring 3 m, hole decal | T3 (0.14) | 70 ms on any hit | charge rise (350 ms) + electric crack + sub thump | charge arc on reticle | thin line with ring |
| NOVA | skill / nuke-class | 4.8 s, 2; 0.6 s charge, hold to arm | bomb mesh falling with heat shimmer and 3 m smoke trail; projected splash ring on HUD | drop clunk | Explosion XL (fireball 18 m splash, shockwave, dust column, debris, screen white flash 80 ms) | T3 (0.22) + 0.6 s low rumble | 80 ms | pre-drop siren (charge), whistle, sub boom + crack + long rumble tail 2 s | charge arc + `2` | circle in circle |

**Weapon switch on touch:**
- Tap the weapon chip: next weapon.
- Long-press or swipe up on the chip: a radial wheel of 6 icons opens (52 px, radius 96 px around the chip). It scales in over 150 ms.
- Release on an icon to select it.
- Each slot shows an icon and the ammo in mono 12 px. No text tiles.

**Desktop:** keys 1-6, wheel to cycle, Tab for the last weapon.

## 5. FX library
All effects use pooled instanced meshes and sprites (one InstancedMesh per type, one shared additive atlas). Times are total lifetimes.
- **Muzzle:** flash sprite (2 crossed quads + 1 billboard), 50–80 ms. Smoke wisp 300 ms.
- **Explosion S** (swarm, M·S): flash 60 ms (billboard, additive, 1.5 m). Fireball 220 ms (6 sprites, 1.2 m). Smoke 700 ms (6 puffs, 2 m growth). Debris 8 shards, ballistic, 600 ms. Light pulse 100 ms (1 pooled point light, range 8 m).
- **Explosion M** (MISIL): flash 80 ms. Fireball 380 ms (10 sprites, 3 m). Smoke 1.5 s (12 puffs). Shockwave ring 250 ms (quad that scales up, alpha .6→0, 6 m). Debris 16 shards and 12 sparks, 500 ms. Crater decal with 6 s fade. Light pulse 160 ms.
- **Explosion XL** (NOVA): flash 100 ms, full-screen 15 % white. Fireball 700 ms (16 sprites, 9 m). Shockwave 500 ms (18 m). Dust column 2.5 s (20 puffs). Debris 32 shards, 1.2 s. Heat-haze pass 400 ms (one fullscreen distortion, desktop only). Light 300 ms.
- **Bullet impacts:** 350 ms, 6 particles, and a decal of 0.15–0.5 m that fades over 8 s (ring buffer 64). The effect depends on the surface:
  - Concrete: grey dust + sparks.
  - Foliage: leaf cards 4.
  - Metal: sparks 8.
  - Ground: dirt puff.
- **Crash (player):** dust burst, 10 debris shards and 4 propeller fragments, 800 ms. FPV static (noise overlay) 400 ms and 200 ms freeze-frame. See Section 11.
- **Hit-stop:** for kills and Explosion M/XL only. 40 / 60 / 80 ms (S / M / XL). Time scale 0.05 for that window. Hit-stop does not change the audio. Reduced motion skips hit-stop.
- **Shake tiers** (camera trauma model, decays 3/s): T1 0.02–0.05, T2 0.06–0.10, T3 0.14–0.22. Budget: clamp the sum of active trauma at 0.35 (0.20 in reduced motion, then 0). Maximum one T3 per 1.5 s.
- **Pool caps for each tier:**
  - Low (phone, `coarse` or governor DPR less than 1.5): 64 sprites, 24 debris, 16 decals, 2 pooled lights, no haze.
  - Mid: 160 / 48 / 32 / 3 / no haze.
  - High (desktop): 320 / 96 / 64 / 4 / haze.
  - Over the cap: kill the oldest particle first. Never skip the flash.
- **Detonation of enemies:** each enemy has its own dissolve, plus Explosion S or M by size. `Gigante` uses XL without haze. All debris dies under the world collision floor (query once at spawn).

## 6. Controls

### Touch (RC Mode 2 layout, left-handed swap in `Controles`)
The target users are in Bogotá.
- **Left stick:** a touch anywhere in the left zone (y at least 40 % of the height) puts the stick base under the thumb. Radius 56 px. The default function is move (forward, back and strafe). "RC Mode 2" (throttle and yaw) is an option in `Controles`. Dead zone 9 %, expo 0.35 (`v = sign(x)·(|x|·(1-e)+e·x³)`). Past the maximum radius the nub stays on the rim.
- **Right look/aim zone:** a drag rotates yaw and aim pitch. Base 0.22°/px (setting range 0.10–0.45), expo 0.25, inertia 90 ms. A double-tap recenters the gimbal. The vertical component also works as gimbal tilt in FPV.
- **Vertical:** in RC Mode 2, the vertical axis of the left stick controls ascend and descend. The default mode uses a 44x44 up/down button pair to the left of the boost button.
- **Boost:** hold button 56 px. Auto-sprint starts when the player pushes the stick past 95 %.
- **Fire:** 76 px round button.
  - Hold: auto-fire for MG/AC.
  - Tap: single shot for the other weapons.
  - MISIL: press-and-hold locks the target. The release fires.
  - Setting `Disparo automático` (default OFF): the weapon fires at the reticle while the player touches the look zone.
- **Haptics:** iOS has no `navigator.vibrate`. For single ticks, use the label-toggle trick with the hidden `<input type=checkbox switch>`.
  - Fire: 1 tick per 3 MG rounds.
  - Hit: 1 tick.
  - Kill: 2 ticks.
  - Damage: 1 long tick.
  - Crash: 3 ticks.
  - Android: `vibrate([10])`, `[15,30,15]`, `[60]`.
  - Settings toggle `Vibración`.
- All touch targets are at least 44 px. Buttons keep a gap of at least 8 px. Zones never overlap HUD plates.

### Gamepad (standard mapping)
- LS: move (forward/strafe). RS: look.
- LT: descend. RT: fire.
- RB: next weapon. LB: previous weapon.
- A: boost. B: brake.
- X: recenter / camera lock. Y: cycle camera.
- D-pad up/down: gimbal ±5°. D-pad left/right: step through weapons 1–6.
- Start: pause. Select: photo mode (in Tour).
- Dead zone 0.10, expo 0.30. Rumble: a weak pulse for a hit. A strong pulse for damage.

### Keyboard / mouse
- Keys: WASD move, Q/E yaw, R/F up/down, Shift boost, Space brake. 1–6 weapons, LMB fire, RMB/Tab weapon cycle. C camera, P photo, T tour, Esc pause.
- **Mouse-look fix:**
  - A click on the canvas captures the pointer lock in every camera (not only FPV).
  - Esc releases the lock and pauses.
  - `movementX/Y` sensitivity: 0.0022 rad/px yaw, 0.0018 pitch (setting ×0.5–2).
  - Mouse acceleration off. A setting inverts Y.
  - The code applies the sensitivity to a smoothed 1-frame lerp.
  - If the browser releases the lock, a plate shows the prompt `Haz clic para capturar el mouse`.
- Scroll wheel: gimbal tilt ±3° per notch.

## 7. Cameras
- **FPV (default):** tilt 28° up (configurable 25–30). FOV 96° horizontal, mapped to 78° vertical on phone portrait. The camera follows the attitude roll at 100 %, smoothed with tau 60 ms. Pitch ladder and horizon are on.
- **Chase (`Cerca`/`Lejos`):** critically damped spring arm. Length 6 m (`Cerca` 4, `Lejos` 10). Stiffness 90, damping 19. Yaw lag tau 0.25 s. Pitch clamp −55°/+20°.
  - Collision: sphere cast radius 0.4 m, pull-in in 60 ms, ease-out 350 ms.
  - Never render with the near plane inside geometry (near 0.15 m minimum). If the code finds the camera inside a mesh, fade the drone to 40 % and force a pull-in.
- **Orbit/Cine:** auto-orbit 0.14 rad/s, radius 25 m. Composition on thirds. Slow FOV oscillation ±1.5°. `Cinemático` mode drives the Tour spline (Section 10).
- **`Cenital`:** unchanged (preserved).
- **Crash camera:** on a crash, the camera detaches to a 3 m chase orbit at the wreck for 0.8 s (slow orbit 0.6 rad/s). Then the respawn snap fades over 200 ms. The player can skip it with a tap.
- **Reduced motion:**
  - Shake off. Hit-stop off. No FOV oscillation. Orbit speed −50 %.
  - Crash camera: a hard cut with a 200 ms fade.
  - A solid red edge for 300 ms replaces the FPV static overlay.
- **Mode button fix:** the mode/camera picker is in the Pause menu, `Cámara` tab, as a card list (FPV, `Cerca`, `Lejos`, `Cenital`, `Órbita`, `Lateral`, `Cinemático`, `Dios`). Quick swap: a tap on the heading strip cycles through FPV, `Cerca` and `Cenital`. A long-press opens the full list as a 320 px popover.

## 8. Game loop and menus

### First run (20 s onboarding)
- 0–3 s: a full-screen plate `Toca para empezar` over the loaded world. It unlocks audio and haptics and shows a fullscreen prompt.
- 3–8 s: the drone takes off automatically (1.5 s). A coach mark on the left zone says `Arrastra para volar`.
- 8–14 s: one blue gate, 25 m ahead and 3 m above, with a chevron arrow. When the drone passes the gate, the game plays a success tone and the text `Bien`.
- 14–20 s: a stationary target drone 40 m away. A coach mark on the fire button says `Toca para disparar`. The first hit ends the onboarding (medal `Primer vuelo`).

The player can skip the onboarding with `×`. The game stores the state in `localStorage ab_fv_onboarded`. The onboarding never shows again.

### Mode select (replaces 12-tile menu)
A full-screen sheet opens from Pause or on world entry. It has 4 cards:
- **`Explorar`** (`Recorre Bogotá a tu ritmo`): free flight, Normal profile.
- **Tour** (`Un recorrido guiado`): `Cinemático` spline (Section 10).
- **Gate Rush** (`Aros sobre tu ruta real`): inline chips for the difficulty (`Fácil`/`Media`/`Difícil`).
- **`Invasión`** (`Defiende la ciudad`): enemy chips.

`Libre · Dios` is a card variant of `Explorar` (toggle chip `Sin colisión`). It uses the God profile.

Cards: 16 px radius `--r-lg`, `--surface` + `--line`, icon 24 px, title 16/600, description of 2 lines at 12. The selected card gets a `--accent` 1 px border (no coloured category borders). Phone: cards stack in 1 column, 96 px height each. Landscape: 2x2. The sheet closes on selection.

### Pause menu (opened by pause icon or Esc; game freezes)
The menu has these entries, in this order:
1. **`Reanudar`** (primary button).
2. `Cámara`.
3. `Vista` (`3D`, `foto-real`, `mixta`).
4. `Imagen`: presets `Natural`/`Vivo`/`Cine`, and an advanced section with the plain labels `Brillo` and `Brillo 3D`. Rename `Brillo Gaussian` to `Brillo de foto-real`.
5. `Sonido` (`Maestro`, `Efectos`, `Música`, `Vibración`).
6. `Controles` (sensitivity, expo, invert, left-handed, RC Mode 2, auto-fire).
7. `Foto` (photo mode).
8. `Grabar`.
9. `Salir`.

The sheet is 480 px wide at most. List rows are 48 px. Sections open as sub-pages with a back arrow. The menu never stays open after an action that changes the mode.

### End screens
Results, defeat and victory use the same card component.
- Maximum width `min(92vw, 420px)`. The card scrolls vertically inside if needed.
- Phone: the buttons are in a `flex-wrap` column (**full width, 48 px, stacked, primary first**). This fixes the 430 px overflow.
- Landscape: the buttons are in a row below the stats with `flex-wrap`.
- The Gate Rush result keeps the hierarchy (large time, splits, medal, record).
- The defeat card keeps its typography. It adds `Reintentar` (primary, one tap, respawn in less than 1 s) and `Cambiar modo`.
- **Medals** (Gate Rush): Bronze: complete the track. Silver: time of at most 1.25 times par. Gold: time of at most par and 0 misses. The world JSON stores the par for each difficulty and track.
- **Medals** (`Invasión`): Bronze: wave 3. Silver: wave 6. Gold: wave 10 with no death.
- **Records:** local top-10 for each (world, mode, difficulty) in `localStorage ab_fv_records` (score, date, medal). The game saves the best run as a ghost, with the current 60 Hz recorder. The ghost shows as a translucent blue drone. The Gate Rush start has a `Fantasma` toggle.
- **Gate Rush start:** the start position must be at least 12 m from any collision wall (query world-collision). If not, the spawn moves along the track to the first clear point. The timer is always visible in T-centre. This fixes the problem "hidden on phones".
- **Audio unlock:** the first-touch plate above does the unlock. On later visits the plate shows `Toca para empezar` only if the AudioContext state is `suspended`.

## 9. Enemies and fair damage
- **Markers:** every hostile within 300 m gets a diamond marker (10 px, `--h-hostile`, 1.5 px outline) above its projected centre. The distance shows below the marker in mono 12. On phone there are max 6 markers (the nearest). The other hostiles collapse to edge arrows.
- **Off-screen:** a 14 px triangle on the edge ring that points toward the enemy, with opacity by distance. Only the nearest 3 show.
- **Health:** enemy HP bar, 48x4 px min (it was a hairline). It shows only after damage or a lock. Red fill on a graphite plate. `Gigante` and `Dragon` get tiered 25 % segments. Bosses get a top-centre 220x6 bar with the name. Text in the enemy HUD is at least 12 px.
- **Silhouettes:** all enemies use a rim-light material pass (Fresnel, `#FFB25A` at 35 %). The pass separates the enemy from the mesh. `Gigante` gets the real GLB material, not the grey mannequin (`docs/ENEMY_MODEL_SPEC.md` assets). A hostile red-orange tint of 15 % goes over the base.
- **Telegraphs:** every ranged attack has a pre-fire cue of 0.5 s (0.8 s `Dragon`, 1.0 s `Gigante` melee). The cue is a red glow, a unique sound and a damage arc. It appears at the start of the wind-up, not at impact. Projectile speed in `Invasión` is at most 60 m/s at `Media` difficulty.
- **Difficulty ramp:** `Fácil`: hp ×0.8, accuracy 0.72 (current table). Wave n: hp ×(1+0.1n). Spawn cap: 3 + n at the same time (max 12 on phone). New enemy types start at these waves: 1 `zombie`, 2 `arquero`, 3 `soldado`, 4 `avion`, 5 `ufo`, 7 `dragon`, 9 `gigante`. Each wave adds its type to the earlier types.
- **Fair damage:**
  - Grace: 3 s after any hit, with no further damage.
  - Invulnerability: 5 s after respawn.
  - HP loss per hit: at most 15 % of max on `Fácil` and `Media`.
  - If a player does not move for 10 s and takes damage, two things happen. The HUD shows the warning `Muévete`. The friendly drone gives a reposition offer.
  - No defeat is possible in the first 30 s of a wave. The enemy spawn radius is at least 80 m. The first attack comes after 6 s. The values make a stationary player die in at least 45 s on `Media`.
- **Health packs:** a blue repair kit that hangs in the air, +25 HP, one every 2 waves.

## 10. Showcase / Tour
- **World POI JSON** (`web/assets/tour/<world>.json`):
```json
{ "world": "chapinero-01", "pois": [
  { "id": "torre", "name": "Torre Colpatria", "short": "El edificio más alto de la ciudad",
    "spline": [[x,y,z,t]], "look": [x,y,z], "dwell": 3.5, "fov": 55, "tod": "golden", "mask": [] }],
  "masks": [{ "id": "hole1", "type": "sphere|box", "c": [x,y,z], "r": 40, "why": "malla rota" }],
  "edge": { "fog": [250,420], "warn": 380 } }
```
- **Spline camera:** Catmull-Rom spline through 5–8 POIs for each world (loop). Speed 6–9 m/s. Look-at blend with 1.2 s lag. FOV 50–60°. Min AGL 12 m. Min distance to geometry 6 m (raycast). If the distance is less, re-route. A label card at each POI: name 16/600 and one line 12, bottom-left, 4 s fade, `--h-plate`.
- **Per-world no-camera masks:** the code moves spline points and free cameras out of a mask along the gradient. The POI composition must not include a mask centre within the 40° cone. An offline script checks this rule.
- **Time of day:** presets `Día`, `Dorada` (golden hour, sun elevation 8°, warm grade), `Atardecer` and `Noche`. `Noche` fixes the black night: ambient floor 0.14, cool moonlight fill, lamp glow emissives on window textures ×1.5. The Tour default is `Dorada`. Photo mode has a continuous slider (elevation −5°…70°).
- **Photo mode:** in the Pause menu, the `Foto` entry. Controls:
  - Free-cam (WASD/sticks).
  - Focal length 18–85 mm (FOV 100°–24°).
  - DOF (aperture f/1.8–f/16, focus by tap-to-focus).
  - Exposure ±2 EV, time of day, hide HUD.
  - Save a PNG at the size of the canvas times DPR (max 2560 px long side).
  - The mask and edge rules limit the camera.
- **World edge:**
  - Beyond `edge.warn` (default 30 m inside the boundary), show a bottom plate `Borde de la zona · gira`.
  - From `fog[0]`, the fog density ramps to opaque at `fog[1]`.
  - Movement has a soft limit: the outward thrust component gets the factor (1 − s). The value s goes from 0 to 1 across the last 30 m.
  - The same limit applies to `Dios`.
  - This keeps the player out of the gradient.

## 11. Physics v2 integration UX
- **Profiles map to modes:**
  - Cine: `Explorar` chip `Cine` (18°, 6.7 m/s, cmdTau 0.6 s).
  - Normal: `Explorar` default (30°, 10.4 m/s).
  - Sport: Gate Rush `Difícil` and `Invasión` (42°, 14 m/s).
  - `Dios` keeps the noclip arcade model outside `physics/`.
  - Gate Rush `Fácil` and `Media` use Normal.
- **Wind indicator:** 24 px arrow chip at T-left under the back button. The arrow rotates to the wind-from bearing relative to the heading. Its length depends on the speed. The mono label is, for example, `4 m/s`. The chip turns `--h-cand` at a gust of more than 6 m/s. A preset selector is in the Pause menu, `Controles` tab: `Calmo` / `Brisa` / `Racheado`. The default is `Brisa` in `Explorar` and `Racheado` in Sport modes.
- **Attitude:** the FPV ladder rolls with the body roll. Non-FPV cameras show an artificial horizon disc of 32 px, T-left.
- **Integrity and battery:** two 4 px bars on the bottom rail (Section 2.3). Integrity below 40 % turns `--h-cand`. Integrity below 20 % turns `--h-hostile` and adds an audible motor stutter. Battery below 20 % adds a chime and a thrust-fade warning `Batería baja`.
- **Crash feedback**, by energy class:
  - Bounce: no effect, soft thud and 1 haptic tick.
  - Wobble: integrity −5 %, shake T1, prop sound stutter 0.3 s.
  - Prop strike: integrity −20 %, shake T2, FPV static 250 ms, motor whine drop.
  - Crash: integrity to 0 / cut, FPV static 400 ms + 200 ms freeze, wreck camera 0.8 s, debris.
- **Respawn flow:** the game takes a snapshot at the last stable hover. It takes one every 5 s while AGL is more than 3 m and speed is less than 2 m/s. After a crash, the sequence is:
  1. Wreck camera (0.8 s).
  2. A one-tap `Reaparecer` plate. It accepts itself after 1 s.
  3. A 200 ms fade.
  4. The drone appears at the snapshot. It has 1.5–2 s of invulnerability and an 8 Hz flicker (the opacity of the drone mesh switches between .4 and 1). Integrity returns to 100 %.

  Gate Rush: a respawn adds a +3 s penalty. `Invasión`: a respawn costs 1 of 3 lives.
- **VRS/ground effect:** VRS shows the yellow caption `Descenso brusco` for 400 ms when B_vrs is more than 0.4. Ground effect has no UI.

## 12. Audio direction
- **Buses:** `master → comp`. Sub-buses: `sfx` (weapons, impacts), `engine` (rotors, wind), `ui`, `music`, `amb`. Default gains: master 0.85, engine 0.5, sfx 0.8, music 0.35, amb 0.3.
- **Sidechain ducking:** on explosion M/XL and on kills, duck `engine`+`music`+`amb` by −6 dB / −9 dB, attack 20 ms, release 600 ms.
- **Per-event layers** (synthesised, pooled voices, max 24):
  - Fire: crack (bandpassed noise 2–6 kHz, 30–90 ms) + body (sine/saw sweep, 60–300 Hz) + tail (convolver reverb send, 250 ms).
  - Explosion layers: sub thump (40–70 Hz sine drop, 300 ms). Crack (noise 4 kHz hipass, 60 ms). Debris rain (granular noise 1.2 s, lowpass that sweeps down). Distance-based delay (d/343 s, cap 1 s).
  - Hit marker tick: short 1.8 kHz sine, 20 ms.
  - Kill sound: two tones (E5 then B5, 70 ms each). The pitch steps +1 semitone for each consecutive kill, up to +6. It resets after 3 s.
  - Damage taken: low thud + filtered hiss.
  - Lock tone: beeps that speed up from 3 to 12 Hz. Locked: continuous 1.2 kHz. Lock lost: a falling 2-tone.
- **The fire sounds go from nine to six.** Each weapon has its own spectral centroid:
  - MG 3 kHz.
  - AC 1.2 kHz.
  - MISIL 400 Hz whoosh.
  - SWARM 2 kHz pops.
  - RAIL 8 kHz crack with 60 Hz sub.
  - NOVA sub 45 Hz.
- **iOS unlock:**
  1. Create or resume `AudioContext` inside the `Toca para empezar` pointerup.
  2. Play a silent 1-sample buffer.
  3. Start the engine loops.
  4. On every `touchend`, retry `resume()` until the state is `running`.
  5. On `visibilitychange`, resume.
  6. Start the haptics switch trick on the same gesture.
- The pitch of the engine loop follows the rotor speed (from physics `m[i]`). The wind whistle scales with airspeed and gust.

## 13. Performance budgets
| Tier | Detect | Draw calls | Particles (live) | DPR | Post | Notes |
|---|---|---|---|---|---|---|
| Phone (low) | `pointer:coarse` + governor | ≤ 100 | ≤ 64 sprites + 24 debris | ≤ 1.5 (governor 1–2) | tone map only (AgX) + single grade LUT, no bloom | shadows off, decals ≤ 16 |
| Tablet (mid) | coarse + `innerWidth ≥ 768` | ≤ 160 | ≤ 160 | ≤ 2 | AgX + grade + light bloom | decals ≤ 32 |
| Desktop (high) | fine | ≤ 260 | ≤ 320 | ≤ 2 (ultra 3 explicit) | AgX + grade + bloom + haze + DOF in photo | decals ≤ 64 |

Use one tonemapper (ACES→AgX, one) and one grade pass. `window.__volar.render` continues to publish DPR, p95 and draw calls. Gate: at least 50 fps median on the current deploy matrix. Also a p95 frame time of at most 22 ms on phone in a 3-explosion stress test. The HUD uses the DOM for text and plates. It uses one 2D canvas for reticle, lock and arrows (one redraw per frame, dirty-rect).

## 14. Accessibility
- Min text 12 px on the phone HUD.
- Contrast at least 4.5:1 (all text on `--h-plate` at least 7:1).
- Colour-blind safe: state is shape and colour. Candidate: square pipper. Hostile: diamond. Friendly: circle or bracket. Locked: solid. Lock in progress: progress outline.
- Reduced motion: support `prefers-reduced-motion` and an in-game toggle (Section 7 list).
- Hold or toggle settings for Boost, Fire (hold / toggle) and aim help in the look zone.
- One-handed mode: all critical actions are reachable in the lower 55 % right zone.
- All buttons carry `aria-label` and a 44 px hit target. Menus trap the focus with `openModal`.
- Text size setting 100/115/130 % for menus.
- Screen-reader announcements (aria-live polite) for gate progress, wave and low integrity.
- Audio never carries information alone. Icons and captions show it too (`Lock`, `Impacto`).

## 15. Implementation plan

### 15.1 Splitting volar.js — DONE (Phase A0, pure refactor, zero behaviour change)
`web/volar.js` went from 2 557 to 773 lines. It is now **orchestration only**: boot of the world, the fixed-step/render loop and the lifecycle. All other code lives in modules for each workstream. The modules connect through one shared `ctx` and an event `bus`. The install order in `main()` is load-bearing, because of the DOM listener order and the dependencies:
```
mountUi(ctx)              // A  HUD markup + surface guards (before anything touches the DOM)
... world boot (manifest, renderer, terrain, collision, vista) ...   // stays in volar.js
createDroneModel(ctx)     // C  drone mesh, props, nav lights, hardpoints
await installTour(ctx)    // E  ghost (GPS track), autopilot, cinematic cams, recorder, director
input/audio created in volar.js
await installFx(ctx)      // B  weapons, weapon models, aim ring, shake, audio frame
installEnemies(ctx)       // D  Invasion + Gate Rush (needs fx.weapons)
installControls(ctx)      // C  trigger, sticks, hotkeys, camera rig, flight tools, setMode
installUi(ctx)            // A  weapon picker, menu/overlays, grade, screens, minimap
```
**Loop contract** (`volar.js`):
- `update(dt)` picks what moves the drone. The priority order, highest first, is:
  1. `tour.director.stepDirector`
  2. `tour.director.stepReplay`
  3. `tour.autopilot.step`
  4. `enemies.gaterush.stepFly`
  5. `controls.step` + `enemies.gaterush.afterStep` + `controls.afterStep`

  After that, `update(dt)` calls `fx.update`, `enemies.update`, `fx.afterUpdate` and `tour.ghost.update`.
- `render()` runs these calls in this order:
  1. `controls.camera.updateFov`, pulses and `ctx.droneModel.update`.
  2. One of the camera sources (director / arrival / orbit / `controls.camera.update`).
  3. The reports: `enemies.report`, `fx.report` and `controls.report`.
  4. `ui.weapons.update`.
  5. `fx.render` (aim ring + shake) and the composer.
  6. `fx.audioFrame` and `ui.update`.

**ctx (shared context, one object, created at module load in volar.js)**
| Field | Meaning |
|---|---|
| `THREE, $, esc, Q, CID, AT, AUTOTEST, report, bus, flags, auto, P` | constants; `report` = `window.__volar`; `P` = interpolated drone position (Vector3); `auto` = `{until:5}` in autotest |
| `flags` (frozen) | `fv2` (`?fv=2`, default false — parsed ONCE here, nothing reads it yet), `debug` (`?debug=1`), `autotest`, `coarse` (pointer:coarse) |
| `state` (S) | shared mutable game state: `simT, modeKey, reto, replay, retoFly, retoMode, resultShown, director, ghost, sceneObjects, firing, lastInvasionRun`. Former closure `let`s of main(); read/write directly |
| `trigger` | telemetry of the fire button (`held, locked, source, pointerId, presses, releases, accepted, mode`), dumped in `report.weaponState.trigger` |
| `actions` | named entry points modules register and call lazily: `setMode setRig cycleRig releaseFiring beginFiring startReto startReplay exitReplay startInvasionRun enterDirector toggleGhost toggleSound toggleRec cycleVista cycleCalidad` |
| boot-assigned | `man W renderer scene camera worldGroup composer post(post-process effects) terrain fxLevel sky syncLook world collision drone droneModel input audio loop` |
| module APIs | `ui`, `fx`, `controls`, `enemies`, `tour` (each filled by its install hook; shape documented in the header of each index.js) |

`window.__volar.ctx` exposes it for debug use. It is non-enumerable, so `JSON.stringify(window.__volar)` does not change.

**bus** (`web/flightverse/bus.js`, no deps):
- `createBus({validate,strict})` returns an object with `on(type,fn)` (returns unsubscribe), `once`, `off`, `emit(type, detail)`, `clear`, `count` and `stats`.
- The bus logs a handler that throws. It never breaks the emitter.
- `BUS_EVENTS` is the schema: `fire{weapon,origin,dir}`, `hit{target,weapon,damage,kill}`, `explode{pos,size}`, `damage{amount,dir,source}`, `crash{energyClass}`, `respawn`, `lock{target,state}`, `wave{n}`, `gate{i,n}`, `mode{key}`, `pause` (A0 adds `{active, overlay}`), `tod{key}`.
- **Integration pass (2026-09-30):** `BUS_EVENTS` now also carries these events:
  - E: `tour{state,index,n,poi}`, `photo{active}`, `edge{warn,s,fog,dist,m}`.
  - B: `kill`, `overheat{weapon,cleared?}`, `unlock`.
  - D: `telegraph`, `score`, `life`, `victory`, `defeat`, `record`, `markers`, `game-mode`, `warn`, `pack`, `reposition`, `onboard`, `damage-blocked`, `gr-miss`, `gr-penalty`.
  - `tod{key,elev}`.
- `ctx.tour.events` and `ctx.enemies.events` are aliases of `bus.on`. There are no local-only channels and no unknown-event warnings.
- B and C emit `hit`, `explode`, `lock`, `respawn` and `crash{energyClass}` (bounce|wobble|prop|crash, plus legacy `soft`).
- Hit-stop: `volar.js` gates the fixed step with `fx.timeScale()`. The whole world freezes: sim clock, physics, enemies and the Gate Rush timer. `volar.js` also scales the presentation dt.
- Crash count rule: the game counts a destroyed drone ONCE, on `respawn`. Gate Rush: miss + 3 s. Invasion: one life, never twice within 1.5 s. Enemy damage does not count while `ctx.phys.invuln > 0`.
- The code no longer has the URL flags `?fvfx=1` and `?fvd=1`. Use `?fv=2`. The flag `?phys=v2` stays (physics only).

### 15.2 Module map and ownership (ACTUAL)
| File | Contents | WS |
|---|---|---|
| `web/volar.js` (773) | boot of world/renderer/terrain/collision/vista/quality, ctx creation, update/render loop, pagehide | A (orchestration; other streams do NOT edit it: they expose `install*`) |
| `flightverse/bus.js` | typed event bus | A (contract; extend `BUS_EVENTS` by PR) |
| `ui/index.js` | `mountUi`, `installUi`, `ctx.ui.{update,setInvasionUi,dispose,overlay}` | A |
| `ui/hud.js` | full HUD markup assembly (fragments from all ui files, original DOM order), heading tape, minimap, FPV OSD, speed/AGL, challenge/count text, hit/gate flashes, invasion panel | A |
| `ui/menu.js` | dock/FAB/camera-picker/gimbal/grade/cine/director markup; overlay coordinator, draggable panels, grade + presets, sound, share, rec button, dock chips | A |
| `ui/screens.js` | boot/error screen, guide, invasion + difficulty pickers, Gate Rush result card, defeat card, toast | A |
| `ui/weapons-ui.js` | combat panel + command HUD markup, weapon picker, ammo/cooldown readouts | A |
| `fx/index.js` | `installFx`: weapons, weapon models, aim ring, shake, `doFire`, `resolveCombatAim`, weapons report, audio frame | B |
| `input/index.js` | `installControls`, `setMode`; re-exports `createDroneModel` | C |
| `input/bindings.js` | fire-button state machine, fire pointers, touch sticks, hotkeys, blur/orientation reset, flight input sampling, crash edge | C |
| `input/camera.js` | rig controller, gimbal, flight tools, FOV kick, camera pose + collision | C |
| `input/drone-model.js` | procedural/GLB drone, props, nav lights, hover bob, hardpoints | C |
| `modes/index.js` | `installEnemies` | D |
| `modes/invasion-mode.js` | invasion + player HP, run start/stop, local best, defeat logic, QA URL start | D |
| `modes/gaterush-mode.js` | start/fly-in/cues/result data/replay exit, `?autotest=gaterush` | D |
| `tour/index.js` | `installTour`: ghost, autopilot, cinematic, director, recorder, `autotestRecord` | E |
| `tour/ghost.js` `autopilot.js` `cinematic.js` `director.js` | real-flight ghost, Arcade autopilot + trail, arrival swoop + orbit, keyframe director + replay playback | E |

Unchanged files keep the ownership table below. Shared files: `runtime.js` (C only) and `scene.js`/`sky.js` (E only, for presentation). Tests that searched `volar.js` before now read `pipeline/fv_source.py` (volar.js and all module files) or the specific module.

**Ownership of the pre-existing files (unchanged from plan)**
| WS | Scope | Owns (only these files) | Depends on |
|---|---|---|---|
| A | HUD, reticle canvas, menus, screens, onboarding, settings UI, a11y, mode select, end screens | `web/volar.js`, `web/css/volar.css`, new `web/css/hud.css`, `web/css/screens.css`, `web/flightverse/ui/*.js`, `bus.js`, `hud-format.js`, `flight-tools.js`, `panels.js`, `mobile-command.js`, `render-quality.js` | bus events from B-E |
| B | Weapons, projectiles, tracers, FX, impacts, decals, shake/hit-stop, audio | `weapons.js`, `weapon-effects.js`, `weapon-models.js`, `weapon-registry.js`, `aiming.js`, `audio.js`, `fx/*.js`, new `audio/*.js` | bus `fire/hit/explode` |
| C | Controls, cameras, physics v2 wiring, wind, haptics | `touch.js`, `camera-rigs.js`, `runtime.js`, `physics/*`, `collision-math.js`, `world-collision.js`, `scene-object-collision.js`, `drone-envelope.js`, `input/*.js` | emits `damage/crash/respawn`; reads `mode` |
| D | Enemies, invasion, Gate Rush loop, medals/records, difficulty | `invasion.js`, `invasion-policy.js`, `gaterush.js`, `objects.js`, enemy assets, `modes/*.js` | A for screens, B for fx |
| E | World presentation, Tour, photo mode, time of day, world edge | `sky.js`, `scene.js`, `visual-coverage.js`, `vegetation.js`, `layer-load-state.js`, `recorder.js`, `export.js`, `tour/*.js`, `photo.js`, `web/assets/tour/*.json` | A for menu entries |

### 15.3 Order and acceptance
The order of work:
1. A step 0 (day 1).
2. B, C, D, E in parallel.
3. A UI polish (day 3).
4. Integration pass (day 4).
5. Deploy gate.

Every stream ships behind `?fv=2` until the integration pass. Then the default flips.

**A acceptance:**
- Screenshots at 430x932, 932x430 and 1440x900 for FPV, `Cerca`, `Cenital`, Pause, Mode select, GR result, defeat and Onboarding.
- The DOM has none of the deleted elements (a test searches for the class names).
- No clipped buttons at 430 px (Playwright overflow assertion).
- All text is at least 12 px (computed-style test on `.vl-*` HUD).
- Contrast test.
- The `H` hint is absent on touch.

**B acceptance:**
- 6 weapons produce a visible tracer or projectile in FPV and chase (screenshot per weapon).
- Test of the distinct spectral fingerprint (FFT centroid ordered as in the table ±15 %).
- The caps of the FX pools hold (the test spawns 500 events, live count at most the cap).
- 3-explosion stress at most 22 ms p95 on phone emulation.
- Hit-stop only on kills.
- The current unit tests for ammo and cooldown pass without change.

**C acceptance:**
- Touch stick dead zone and expo unit tests.
- Mouse-look works in every camera (Playwright pointer-lock test).
- FPV tilt 28°. The chase spring arm has zero near-plane intrusion in the collision gate.
- `runtime.js` imports version 2 of the physics code, with wind and attitude on `window.__volar.physics`.
- Crash to respawn in less than 1 s.
- At least 50 fps gate green.
- `pipeline/test_physics_*.mjs` green.

**D acceptance:**
- A stationary player survives at least 45 s on `Media` in wave 1 (simulated test).
- Markers and off-screen arrows are visible in screenshots at 3 viewports.
- A telegraph comes at least 0.5 s before every enemy shot (assertion in the policy test).
- The Gate Rush timer is visible at 430 px.
- The start is at least 12 m from walls.
- Medals and records stay after a reload.

**E acceptance:**
- Tour runs 5–8 POIs on every world with no camera point inside a mask (offline validator + screenshots). Camera min distance 6 m.
- Edge fog and warning start before the boundary in all worlds.
- Photo mode saves a PNG.
- Mean luma of the night shot: at least 0.06.
- Golden-hour screenshot per world.
- No draw call regression against the budget.

**Global:**
- `tsc`/typecheck exit 0 before push.
- `audit_world.py`, collision gate `--stress 100` and `browser_matrix.py --flightverse` green.
- Run `pipeline/bump_web_version.py` after every batch (one owner, WS A at integration).

### 15.4 Iteration 2 (2026-09-30) — behaviour changes worth knowing
- **`Invasión` start** no longer freezes the main thread. Before: a freeze of 3.8 s. Now: 0 long tasks above 50 ms.
  - `enemy-materials.js` built its noise fields per pixel. The fix: one field for each texture.
  - The game gets the GLB bytes once (`prewarm`, idle slices after the world loads, all types when the picker opens). It parses them one at a time, with yields.
  - The code decodes the minimap ortho off-thread (`createImageBitmap` at canvas size).
  - The wave intro shows as soon as the run starts. The horde waits for its models.
  - `invasion_runtime_gate.py` enforces the budget (`LONGTASK_BUDGET_MS = 200`).
  - Enemy GLBs have plain PNG textures (no meshopt/KTX2). Parse time is 13-36 ms each at 4x CPU throttle.
- **Hit-stop** scales the TIME that goes into the fixed-step accumulator (`loop-step.js`). The code never skips a step. The code eases `hitstop.scale()`: smoothstep in 16 ms, out in at most 24 ms. It averages the value over the next frame.
- **FPV signal loss** (`fx/fpv-static.js`): vignette, chromatic edge fringes, noise of at most 22 %, 2-3 tear lines and a `SEÑAL` plate. Duration at most 400 ms. Reduced motion: red edge 300 ms.
- **Weapon wheel** picks the first candidate layout that overlaps no control and stays in the safe area. The candidates are grids 6x1/3x2/2x3, column and fans. `fv2_layout_audit.py` checks it for each viewport and handedness.
- **Edge arrows** sit on the real screen edge, inside the safe area. They slide away from the fire cluster. Telegraph arcs have a dashed line. Damage arcs have a solid line.
- **Gate Rush result:** the `vel máx` value comes from position and time (250 ms window, teleports ignored, `gate-stats.js`). The card never shows it below `vel media`.
- **Photo mode** starts at the authored vantage of the nearest POI (at most 250 m away). Otherwise it starts at a 3/4 rear view of the drone, pitched about 20 degrees down.
- **Desktop:** the plate `Clic para controlar · clic de nuevo para disparar` shows until the game captures the pointer. The key bar lists the real bindings.
