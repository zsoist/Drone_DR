# AeroBrain Flightverse — Design Spec v1

Scope: browser three.js drone game over real Bogotá photogrammetry. English spec, Spanish UI copy (in quotes). Baseline: audit scores (first impression 4, HUD 3.5, weapons 3, FX 2.5, enemies 3, audio 3, a11y 3). Target: every axis ≥ 7.
PRESERVE untouched: Mundo select cards, loading card, altitude photogrammetry look, Cenital camera, Gate Rush result-card hierarchy, defeat-card typography, 60 fps engine, safe-area wiring, weapon ammo/cooldown logic, mono data type, Imagen presets.

## 1. Pillars and tone

1. **Real place, your drone.** The city is the hero. Chrome never covers it; at rest the HUD occupies < 12 % of the screen.
2. **One instrument language.** A single HUD grammar for every camera and mode (fighter/FPV: tapes, contextual data). No second HUD system.
3. **Readable action.** Every shot, hit, threat and damage source is legible in < 200 ms by shape first, colour second.
4. **Every second is a run.** 20 s to first shot, < 1 s to respawn, a reason to retry (medals, records, ghost).

Tone: premium, restrained, cinematic; graphite glass, thin hairlines, one accent. NOT neon, no glow-bloom UI, no emojis, no gradients on controls, no pulsing decoration. Sound and light do the drama, not the chrome.

## 2. HUD system

### 2.1 Palette (mapped to `web/DESIGN.md`; media chrome only, identical in both themes)
| HUD token | Value / source | Meaning |
|---|---|---|
| `--h-ink` | `--on-media` #E6EBF2 | primary numerals, reticle |
| `--h-ink-2` | `--on-media-2` #B7C2D0 | labels, ticks |
| `--h-plate` | `--media-scrim` rgba(8,10,14,.72) | text plates, blur 8px only on menus |
| `--h-line` | `--media-line` | hairlines, 1 px |
| `--h-cand` | #E0A458 (`--warn`) | candidate / capture / lock in progress |
| `--h-friend` | #45A0E6 (`--accent`) | friendly, confirmed, own drone, gates, objectives |
| `--h-ok` | #52C79A (`--ok`) | confirmed kill, healthy, link OK |
| `--h-hostile` | #D96A6A (`--err`) | hostile + warning + damage ONLY |
Rule: red never decorates. Yellow=candidate, blue/green=friendly/confirmed, red=hostile/warning. Every state pairs colour with shape (Section 14).

### 2.2 Type
Numbers: `--mono` tabular, 14 px/600 (primary), 12 px/500 (secondary). Labels: site sans (`--font`), 12 px/500, uppercase only for 3-letter units, `--tr-caps`. Never below 12 px on phone HUD. Plates use 8 px radius `--r-md`, padding 4x8.

### 2.3 Layout — one grid, three viewports
Safe area = `env(safe-area-inset-*)` + 12 px gutter. Zones: **T** top strip, **L/R** edge columns, **C** centre (reserved for reticle; nothing else within 96 px of centre), **B** bottom controls.

**Phone portrait 430x932**
- T-left (x 12–60, y safe+8): back chevron `‹` icon-only 44x44 (replaces "Mundo" pill), then pause icon 44x44 at T-right. No other top-left/right chrome.
- T-centre (y safe+8, h 28): mission/context plate (mode timer, wave, gates "3/10") only when a mode is active; otherwise a compass heading strip 200x20 (N/E/S/W + degrees, mono 12).
- Speed tape: left edge, x 12, y 300–560 (260 px), 44 px wide, ticks every 2 m/s, readout plate on the centre line. Altitude (AGL) tape: mirrored right edge. Both 60 % opacity at rest, 100 % while changing > 0.5 unit/s. **Tapes appear in every camera** (in non-FPV they shrink to numeric plates only: `12.4 m/s`, `86 m`, y 300, no ticks).
- Under the compass: vertical-speed arrow + wind arrow chip (Section 11) at T-left below back button, 12 px.
- C: reticle (Section 3). FPV only: pitch ladder ±30° in 10° steps, horizon line, 1 px, 40 % opacity; roll from drone attitude (Section 11).
- B-left: floating move stick zone (x 0–215, y 560–932). B-right: aim/look zone (x 215–430, y 560–932); fire button 76 px at x 430-12-76, y 932-safe-150; weapon chip 56 px above it; boost 56 px left of fire.
- B-centre y 932-safe-96 (h 56): minimap only when the mode needs it (Gate Rush, Invasión, Tour). Hidden otherwise.
- Bottom rail (y 932-safe-32, h 20): integrity bar 96x4, battery bar 96x4 + `74 %` mono 12, left/right of centre. Shown only if < 100 % or in a mode.

**Phone landscape 932x430**: gutters use left/right safe insets (notch side ≥ 44 px). Tapes at x 16 / right-16, y 120–310. Stick zones = left 40 % / right 40 % of width, y ≥ 150. Fire cluster at right, y 430-safe-92. Top strip identical, y 8. Minimap 96 px top-right below pause. Result/menus become two-column sheets (Section 8). Height rule: no HUD element may sit in the y 130–300 centre band except tapes and reticle.

**Desktop 1440x900+**: tapes at x 10 % / 90 %, y 32–68 % height; bottom-left cluster: weapon strip (6 slots, 44 px each, key numbers 1-6); bottom-right: ammo/heat readout; minimap 160 px bottom-right above it. No touch controls. Keyboard hints appear only when `pointer:fine` (never `H` on touch).

### 2.4 Always / contextual / never
- **Always:** reticle, speed, AGL, heading, pause icon, back icon.
- **Contextual (fade 150 ms ease-out, hide after 2.5 s idle unless critical):** weapon chip + ammo (visible 2.5 s after fire/switch, permanent in combat modes), integrity/battery (< 100 % or mode), wind chip (> 3 m/s or gusts), attitude ladder (FPV), lock box, threat arrows, minimap, gimbal readout (appears 1.5 s on change, then hides), REC dot (while recording), FPS (debug `?debug=1` only).
- **Never:** "60 fps" badge in production, DIST/FLT/HS/VS status line, `H` key hint on touch, world-space aim rings, permanent gimbal pill.

### 2.5 Motion and states
Enter/exit: opacity + 4 px translate, 150 ms `--ease-out`. Value change: no animation on numerals except 100 ms colour flash on threshold cross. Warning state: colour to `--h-hostile` + border style change (dashed) + 2 Hz blink for 1 s, then steady. Disabled: opacity .4. Reduced motion: no translate, no blink (steady colour + icon).

### 2.6 Elements to DELETE
`.vl-fpv-head` (status line), `.vl-osd-home`, `.vl-osd-gimbal` (pill on crosshair), `.vl-fpv-br` corner brackets, `.vl-fpv-sig` bars, `.vl-fpv-rec` "REC" (becomes 8 px red dot in T-centre plate), `.vl-fpv-cross` (replaced by reticle system), `.vl-corner.tr` metric tiles (`vl-agl/spd/vs` + bars) — replaced by tapes, `#vl-fps` production badge, `.vl-trigger`/"FUEGO" (one fire button only), `.vl-fire` "DISPARAR" in combat dialog, `.vl-command-hud` + `.vl-weapon-toggle` old text tile, `.vl-gimbal-tools` toggle (gimbal moves into the Cámara pause tab; live ±5° via stick-tilt on look zone), `.vl-flight-tools-left` CAM/chevron/Menú trio, `.vl-fab` "Menú" (becomes pause icon), `.vl-dock`+`.vl-combat` bottom sheets and `.vl-help`, `.vl-kills` panel (kills go to the T-centre plate), `.vl-goto`, `.vl-compass canvas tape` (replaced by heading strip), the two-HUD split (`fpv-active` class branches for layout; keep only FPV extras: ladder + horizon).

## 3. Reticle system (screen-space only)
Delete the world-space pink ring entirely. The aim point is a screen-space element positioned at the projected hit point when the ray hits within 400 m, else at screen centre. Size is constant in px, never grows with proximity.
- **Base:** 4 tick marks (each 8x1.5 px, gap 10 px) + 2 px centre dot, `--h-ink`, 70 % opacity.
- **Per class:** gun (MG/AC): ticks + spread ring diameter = spread angle (MG 22 px, AC 14 px) 1 px; missile (MISIL): ring 28 px with 4 gaps + lock box; swarm: 8 small dots on 30 px circle that fill as targets are added (max 8); rail: thin vertical/horizontal hairlines 60 px + charge arc; nova: dashed circle 40 px + arc showing splash radius projected at aim point (screen-space, drawn on the HUD canvas, not in the world).
- **Lead pipper (MG, AC, SWARM, enemy targets only):** 6 px hollow square, `--h-cand`, at predicted intercept including bullet drop (MG 3.6 m @200 m, AC 5.2 m @200 m compensated for both aim point and tracer). Shown only when a target is within 250 m and in the front 30° cone. Turns `--h-friend` when target is inside the pipper for 0.2 s.
- **Lock box (MISIL guided, SWARM):** rectangle sized to the target's projected bounds (min 32 px), corners-only brackets 2 px. Yellow while acquiring (fills a 1 px progress line around the perimeter over 0.8 s), solid blue when locked with tone; red only for incoming missiles on the player. Lock lost: box shrinks and fades in 150 ms.
- **Heat/cooldown ring:** 1.5 px arc around the reticle, radius 20 px. MG/AC: fills with heat, `--h-ink` → `--h-cand` at 70 % → `--h-hostile` at 100 % (overheat 1.2 s lockout, ring dashed). Missiles/rail/nova: ring is a cooldown sweep clockwise, 2 px tick when ready + 40 ms flash.
- **Hit markers:** 4 diagonal ticks around the centre, 100 ms ease-out. Full hit: white, 12 px. Graze: 60 % opacity, 8 px. Deflect (no damage): short horizontal dash, grey. Kill: red-tinted X, 16 px, 250 ms, plus 2-tone sound (Section 12). Numbers: none.
- **Damage arcs:** 60° arcs on a ring radius 32 % of the shorter screen side, `--h-hostile`, 4 px thick, fade over 1.2 s, pointing toward the source; max 3 simultaneous; low health adds a 6 % red vignette on the edge only (no screen tint).

## 4. Weapons (9 → 6)
Justification: three missile tiers (M·S/M·M/M·L) and VIPER-X differ only by numbers on a touch screen. Merge them into one **MISIL** with two behaviours: tap = unguided (M·M profile, 56 m/s); press-and-hold on a target to lock then release = guided (VIPER-X profile, 62 m/s, turn 1.9 rad/s). M·S/M·L/VX profiles stay in `weapon-registry.js` as internal variants (ammo/cooldown logic untouched), no UI. Result: MG, AC-30, MISIL, SWARM-8, RAIL, NOVA. Phone weapon strip = 6 slots.

| Weapon | Role | Cadence / ammo (existing) | Projectile visual | Muzzle | Impact FX | Shake | Hit-stop | Sound layers | HUD readout | Icon |
|---|---|---|---|---|---|---|---|---|---|---|
| MG | sustain anti-light | 0.085 s auto, 120 rd | tracer every 3rd round: additive streak 1.2 m long × 0.035 m wide, core `#FFF3D6`, edge `#FFB25A`, alpha .9→0 over the tail; non-tracer invisible | 3-frame flash sprite 0.35 m, warm, plus 1 spent-casing puff | spark burst 6, dust puff, 0.4 s | T1 (0.02) | none | crack 90 ms + body 60 ms + tail 250 ms; pitch ±4 % random | ammo mono + heat ring | three ticks over a bar |
| AC-30 | heavy kinetic | 0.16 s auto, 48 rd | tracer 2.0 m × 0.06 m, core white, edge `#FF8A3D`, every round | 5-frame flash 0.7 m + smoke wisp | spark 12, debris 6, scorch decal 0.5 m, smoke 0.8 s | T1→T2 on 10th round | none | low thump + metallic crack + mechanical ring-down 400 ms | ammo + heat | single thick bar |
| MISIL | general purpose | 0.9 s, 8 | missile mesh (from models) + engine flare sprite 0.5 m + smoke trail 1.5 m, 24 puffs max | backblast puff 0.6 m | Explosion M (Sect. 5), crater decal 2 m | T2 (0.06) | 50 ms on kill | launch whoosh + rising Doppler loop + blast (thump + crack + debris rain 1.2 s) | ammo + lock state | triangle nose over a fin |
| SWARM-8 | area denial vs groups | 3.2 s, 4 pods × 8 rockets, 0.085 s interval | 8 mini missiles, trail 0.8 m, spread cone 6°, each with slight roll | 8 small flashes | 8 × Explosion S, staggered | T1 per hit, 8-hit budget caps at T2 | none | 8 staggered pops, pitch stepping +2 semitones per rocket | pods left `3/4` + rocket dots | cluster of 8 dots |
| RAIL | precision pierce | 1.7 s, 10; 0.35 s charge | 0.25 s straight beam 0.06 m wide, core white, edge `#8FD3FF`, plus a distortion ripple line and a 1.2 s fading afterglow (fixes "invisible") | ring flash 0.5 m + charge whine | white flash 0.12 s, shockwave ring 3 m, hole decal | T3 (0.14) | 70 ms on any hit | charge rise (350 ms) + electric crack + sub thump | charge arc on reticle | thin line with ring |
| NOVA | skill / nuke-class | 4.8 s, 2; 0.6 s charge, hold to arm | bomb mesh falling with heat shimmer and 3 m smoke trail; projected splash ring on HUD | drop clunk | Explosion XL (fireball 18 m splash, shockwave, dust column, debris, screen white flash 80 ms) | T3 (0.22) + 0.6 s low rumble | 80 ms | pre-drop siren (charge), whistle, sub boom + crack + long rumble tail 2 s | charge arc + `2` | circle in circle |

Weapon switching (touch): tap weapon chip = cycle next; long-press or swipe-up on it opens a radial wheel of 6 icons (52 px, radius 96 px around the chip), 150 ms scale in, release on an icon to select. Each slot shows icon + ammo mono 12 px; no text tiles. Desktop: keys 1-6, wheel to cycle, Tab = last.

## 5. FX library
All effects use pooled instanced meshes/sprites (one InstancedMesh per type, one shared additive atlas). Times are total lifetimes.
- **Muzzle:** flash sprite (2 crossed quads + 1 billboard), 50–80 ms; smoke wisp 300 ms.
- **Explosion S (swarm/M·S):** flash 60 ms (billboard, additive, 1.5 m) + fireball 220 ms (6 sprites, 1.2 m) + smoke 700 ms (6 puffs, 2 m growth) + debris 8 shards ballistic 600 ms + light pulse 100 ms (1 point light pooled, range 8 m).
- **Explosion M (MISIL):** flash 80 ms + fireball 380 ms (10 sprites, 3 m) + smoke 1.5 s (12 puffs) + shockwave ring 250 ms (expanding quad, alpha .6→0, 6 m) + debris 16 shards + 12 sparks 500 ms + crater decal 6 s fade + light pulse 160 ms.
- **Explosion XL (NOVA):** flash 100 ms full-screen 15 % white + fireball 700 ms (16 sprites, 9 m) + shockwave 500 ms (18 m) + dust column 2.5 s (20 puffs) + debris 32 shards 1.2 s + heat-haze pass 400 ms (single fullscreen distortion, desktop only) + light 300 ms.
- **Bullet impacts:** surface-typed (concrete: grey dust + sparks; foliage: leaf cards 4; metal: sparks 8; ground: dirt puff) 350 ms, 6 particles + decal 0.15–0.5 m fading over 8 s (ring buffer 64).
- **Crash (player):** dust burst + 10 debris shards + 4 propeller fragments, 800 ms; FPV static (noise overlay) 400 ms + 200 ms freeze-frame, see Section 11.
- **Hit-stop:** kills and Explosion M/XL only: 40 / 60 / 80 ms (S / M / XL). Time scale 0.05 for that window, audio not affected. Skipped in reduced-motion.
- **Shake tiers** (camera trauma model, decays 3/s): T1 0.02–0.05, T2 0.06–0.10, T3 0.14–0.22. Budget: sum of active trauma clamped at 0.35 (0.20 in reduced motion → 0). Max one T3 per 1.5 s.
- **Pool caps per tier**: low (phone, `coarse` or governor DPR < 1.5): 64 sprites, 24 debris, 16 decals, 2 pooled lights, no haze. mid: 160 / 48 / 32 / 3 / no haze. high (desktop): 320 / 96 / 64 / 4 / haze. Over cap: oldest particle killed first, never skip the flash.
- **Detonation of enemies:** enemy-specific dissolve + explosion S/M by size; Gigante uses XL minus haze. All debris dies under the world collision floor (query once at spawn).

## 6. Controls

### Touch (RC Mode 2 layout, Bogotá users are the target; left-handed swap in Controles)
- **Left floating stick:** touch anywhere in the left zone (y ≥ 40 % of height) spawns the base under the thumb, radius 56 px. Default = move (forward/back + strafe); "RC Mode 2" (throttle/yaw) is an option in Controles. Dead zone 9 %, expo 0.35 (`v = sign(x)·(|x|·(1-e)+e·x³)`); past max radius the nub stays on the rim.
- **Right look/aim zone:** drag rotates yaw + aim pitch, 0.22°/px base (settings 0.10–0.45), expo 0.25, inertia 90 ms. Double-tap = recenter gimbal. Vertical component doubles as gimbal tilt in FPV.
- **Vertical:** dedicated ascend/descend via left stick vertical when in RC Mode 2; default mode uses a 44x44 up/down pair to the left of boost. Boost: hold button 56 px, auto-sprint when the stick is pushed past 95 %.
- **Fire:** 76 px round button. Hold = auto-fire for MG/AC, tap = single shot for others; press-and-hold on MISIL locks then releases fires. Setting "Disparo automático" (default OFF): fires at reticle while the look zone is touched.
- **Haptics:** iOS has no `navigator.vibrate`; use the hidden `<input type=checkbox switch>` label-toggle trick for single ticks (fire: 1 tick per 3 MG rounds; hit: 1 tick; kill: 2 ticks; damage: 1 long tick; crash: 3 ticks). Android: `vibrate([10])`, `[15,30,15]`, `[60]`. Settings toggle "Vibración".
- All targets ≥ 44 px; buttons keep gap ≥ 8 px; zones never overlap HUD plates.

### Gamepad (standard mapping)
LS move (fwd/strafe), RS look, LT descend, RT fire, RB cycle weapon next, LB cycle previous, A boost, B brake, X recenter / camera-lock, Y cycle camera, D-pad up/down gimbal ±5°, D-pad left/right weapon 1–6 step, Start pause, Select photo mode (in Tour). Dead zone 0.10, expo 0.30, rumble weak=hit, strong=damage.

### Keyboard / mouse
WASD move, Q/E yaw, R/F up/down, Shift boost, Space brake, 1–6 weapons, LMB fire, RMB/Tab weapon cycle, C camera, P photo, T tour, Esc pause. **Mouse-look fix:** click canvas captures pointer lock in every camera (not only FPV); Esc releases and pauses; `movementX/Y` sensitivity 0.0022 rad/px yaw, 0.0018 pitch (settings ×0.5–2), mouse acceleration off, invert Y setting, sensitivity applied to a smoothed 1-frame lerp. Prompt "Haz clic para capturar el mouse" plate if lock lost. Scroll wheel = gimbal tilt ±3° per notch.

## 7. Cameras
- **FPV (default):** tilt 28° up (configurable 25–30), FOV 96° horizontal on phone portrait mapped to 78° vertical. Follow attitude roll at 100 %, smoothed tau 60 ms. Pitch ladder + horizon on.
- **Chase (Cerca/Lejos):** critically damped spring arm, length 6 m (Cerca 4, Lejos 10), stiffness 90, damping 19, yaw lag tau 0.25 s, pitch clamp −55°/+20°. Collision: sphere cast radius 0.4 m, pull-in in 60 ms, ease-out 350 ms; never render with near plane inside geometry (near 0.15 m minimum; if camera-inside-mesh detected, fade drone to 40 % and force pull-in).
- **Orbit/Cine:** auto-orbit 0.14 rad/s radius 25 m, framing thirds, slow FOV breathing ±1.5°; Cinemático mode drives Tour spline (Section 10).
- **Cenital:** unchanged (preserved).
- **Crash camera:** on crash, detach to a 3 m chase orbit at the wreck for 0.8 s (slow orbit 0.6 rad/s), then respawn snap fade 200 ms; skippable by tap.
- **Reduced motion:** shake off, hit-stop off, no FOV breathing, orbit speed −50 %, crash camera → hard cut with 200 ms fade; FPV static overlay replaced by a solid red edge for 300 ms.
- **Mode button fix:** the mode/camera picker lives in Pause > "Cámara" as a card list (FPV, Cerca, Lejos, Cenital, Órbita, Lateral, Cinemático, Dios). Quick swap: tap the heading compass strip cycles FPV↔Cerca↔Cenital; long-press opens the full list as a 320 px popover.

## 8. Game loop and menus

### First run (20 s onboarding)
0–3 s: "Toca para empezar" full-screen plate (unlocks audio + haptics + fullscreen prompt), over the loaded world. 3–8 s: drone takes off automatically (1.5 s), coach mark on the left zone "Arrastra para volar". 8–14 s: one blue gate placed 25 m ahead and 3 m above, chevron arrow; passing it plays confirm + "Bien". 14–20 s: a stationary target drone 40 m away, coach mark on fire "Toca para disparar", first hit ends onboarding (medal "Primer vuelo"). Skippable with `×`; stored in `localStorage ab_fv_onboarded`. Never shown again.

### Mode select (replaces 12-tile menu)
Full-screen sheet from Pause or on world entry, 4 cards: **Explorar** ("Recorre Bogotá a tu ritmo" → free flight, Normal profile), **Tour** ("Un recorrido guiado" → Cinemático spline, Section 10), **Gate Rush** ("Aros sobre tu ruta real" → difficulty chips Fácil/Media/Difícil inline), **Invasión** ("Defiende la ciudad" → enemy chips). **Libre · Dios** is a card variant of Explorar (toggle chip "Sin colisión") using the God profile. Cards: 16 px radius `--r-lg`, `--surface` + `--line`, icon 24 px, title 16/600, 2-line description 12; the selected card gets `--accent` 1 px border (no coloured category borders). Phone: cards stack in 1 column, 96 px height each; landscape: 2x2. Closes on selection.

### Pause menu (opened by pause icon or Esc; game freezes)
List in this order: **Reanudar** (primary button) · Cámara · Vista (3D, foto-real, mixta) · Imagen (presets Natural/Vivo/Cine + advanced with `Brillo` and `Brillo 3D` plain labels; rename "Brillo Gaussian" → "Brillo de foto-real") · Sonido (Maestro, Efectos, Música, Vibración) · Controles (sens., expo, invert, left-handed, RC Mode 2, auto-fire) · Foto (photo mode) · Grabar · Salir. Sheet 480 px max width, list rows 48 px, sections open as sub-pages with back arrow. The menu never stays open after an action that changes mode.

### End screens
Same card component for results/defeat/victory: max width `min(92vw, 420px)`, vertical scroll inside if needed, buttons in a flex-wrap column on phone (**full width, 48 px, stacked; primary first**) — fixes the 430 px overflow; landscape: buttons in a row below the stats with `flex-wrap`. Gate Rush result keeps hierarchy (time large, splits, medal, record). Defeat keeps typography, adds "Reintentar" (primary, one tap, respawn < 1 s) and "Cambiar modo".
- **Medals** (Gate Rush): bronze = complete; silver = time ≤ 1.25× par; gold = time ≤ par and 0 misses. Par per difficulty/track stored in the world JSON. Invasión: bronze = wave 3, silver = wave 6, gold = wave 10 without dying.
- **Records:** local top-10 per (world, mode, difficulty) in `localStorage ab_fv_records` (score, date, medal); best run auto-saved as ghost (existing 60 Hz recorder), shown as a translucent blue drone; toggle "Fantasma" in Gate Rush start.
- **Gate Rush start:** starting position must be ≥ 12 m from any collision wall (query world-collision); else the spawn moves along the track to the first clear point. Timer is always visible in T-centre (fixes "hidden on phones").
- **Audio unlock:** the first-touch plate above; on later visits the plate shows only as "Toca para empezar" if the AudioContext is suspended.

## 9. Enemies and fair damage
- **Markers:** every hostile within 300 m gets a diamond marker (10 px, `--h-hostile`, 1.5 px outline) above its projected centre, distance in mono 12 below it, max 6 markers on phone (nearest), others collapse to edge arrows. Off-screen: a triangle 14 px on the edge ring pointing toward the enemy, opacity by distance; nearest 3 only.
- **Health:** enemy HP bar 48x4 px min (was a hairline), only when damaged or locked, red fill on graphite plate, tiered 25 % segments for Gigante/Dragon (bosses get a top-centre 220x6 bar with name). Text in enemy HUD ≥ 12 px.
- **Silhouettes:** all enemies use a rim-light material pass (Fresnel, `#FFB25A` at 35 %) to separate from mesh; Gigante gets the real GLB material instead of grey mannequin (`docs/ENEMY_MODEL_SPEC.md` assets), tinted hostile red-orange 15 % over the base.
- **Telegraphs:** every ranged attack has a 0.5 s (0.8 s Dragon, 1.0 s Gigante melee) pre-fire cue: red glow + unique sound + damage arc appears at wind-up start, not at impact. Projectile speed in Invasión ≤ 60 m/s at Media difficulty.
- **Difficulty ramp:** Fácil hp ×0.8, accuracy 0.72 (existing table). Wave n: hp ×(1+0.1n), spawn cap 3 + n concurrent (max 12 phone), enemy types introduced by wave (1: zombie, 2: +arquero, 3: +soldado, 4: +avion, 5: +ufo, 7: +dragon, 9: +gigante).
- **Fair damage:** grace 3 s after any hit (no further damage), 5 s invulnerability after respawn, HP loss per hit ≤ 15 % max on Fácil/Media; a player who has not moved for 10 s and takes damage gets a HUD warning "Muévete" plus a friendly drone repositioning offer; no defeat possible in < 30 s of a wave start (enemy spawn radius ≥ 80 m, first attack after 6 s, tuned so a stationary player dies in ≥ 45 s on Media). Health packs: blue floating repair kit, +25 HP, one every 2 waves.

## 10. Showcase / Tour
- **World POI JSON** (`web/assets/tour/<world>.json`):
```json
{ "world": "chapinero-01", "pois": [
  { "id": "torre", "name": "Torre Colpatria", "short": "El edificio más alto de la ciudad",
    "spline": [[x,y,z,t]], "look": [x,y,z], "dwell": 3.5, "fov": 55, "tod": "golden", "mask": [] }],
  "masks": [{ "id": "hole1", "type": "sphere|box", "c": [x,y,z], "r": 40, "why": "malla rota" }],
  "edge": { "fog": [250,420], "warn": 380 } }
```
- **Spline camera:** Catmull-Rom through 5–8 POIs per world (loop), speed 6–9 m/s, look-at blend with 1.2 s lag, FOV 50–60°, min AGL 12 m, min distance to geometry 6 m (raycast, otherwise re-route). Label card at each POI: name 16/600 + one line 12, bottom-left, 4 s fade, `--h-plate`.
- **Per-world no-camera masks:** spline points and free cameras inside a mask are pushed out along the gradient; POI framing must not include a mask centre within the 40° cone (validated by an offline script).
- **Time of day:** presets Día, Dorada (golden hour, sun elevation 8°, warm grade), Atardecer, Noche (fix black: ambient floor 0.14, moonlight cool fill, lamp glow emissives on window textures ×1.5). Tour default = Dorada. Photo mode has a continuous slider (elevation −5°…70°).
- **Photo mode:** pause menu > Foto: free-cam (WASD/sticks), focal length 18–85 mm (FOV 100°–24°), DOF (aperture f/1.8–f/16, focus by tap-to-focus), exposure ±2 EV, time of day, hide HUD, save PNG at canvas × DPR (max 2560 px long side). Camera bound to the mask and edge rules.
- **World edge:** beyond `edge.warn` (default 30 m inside the boundary) show a bottom plate "Borde de la zona · gira"; from `fog[0]` fog density ramps to opaque at `fog[1]`; movement is soft-limited (thrust component outward × (1 − s), s from 0 to 1 across the last 30 m). Dios is also bounded. Removes flying into the gradient.

## 11. Physics v2 integration UX
- **Profiles map to modes:** Cine → Explorar "Cine" chip (18°, 6.7 m/s, cmdTau 0.6 s); Normal → Explorar default (30°, 10.4 m/s); Sport → Gate Rush Difícil and Invasión (42°, 14 m/s); Dios keeps noclip arcade model outside `physics/`. Gate Rush Fácil/Media use Normal.
- **Wind indicator:** 24 px arrow chip at T-left under back button, arrow rotates to wind-from bearing relative to heading, length by speed, mono `4 m/s`; turns `--h-cand` at gust > 6 m/s. Preset selector in Pause > Controles: Calmo / Brisa / Racheado (default Brisa in Explorar, Racheado in Sport modes).
- **Attitude:** FPV ladder rolls with body roll; non-FPV cameras show a 32 px artificial horizon disc, T-left.
- **Integrity and battery:** two 4 px bars bottom rail (Section 2.3). Integrity < 40 % turns `--h-cand`, < 20 % `--h-hostile` with an audible motor stutter; battery < 20 % adds a chime and thrust-fade warning "Batería baja".
- **Crash feedback:** energy classes → bounce (no effect, soft thud + 1 haptic tick), wobble (integrity −5 %, shake T1, prop sound stutter 0.3 s), prop strike (integrity −20 %, shake T2, FPV static 250 ms, motor whine drop), crash (integrity to 0 / cut: FPV static 400 ms + 200 ms freeze, wreck camera 0.8 s, debris).
- **Respawn flow:** snapshot at last stable hover (every 5 s while AGL > 3 m and speed < 2 m/s). Crash → wreck camera (0.8 s) → one-tap "Reaparecer" plate auto-accepting after 1 s → 200 ms fade → drone at snapshot, 1.5–2 s invulnerability with 8 Hz flicker (drone mesh opacity .4/1), integrity restored to 100 %. Gate Rush: respawn adds +3 s penalty. Invasión: respawn costs 1 of 3 lives.
- **VRS/ground effect:** VRS shows a 400 ms yellow "Descenso brusco" caption when B_vrs > 0.4; ground effect has no UI.

## 12. Audio direction
- **Buses:** `master → comp`; sub-buses `sfx` (weapons, impacts), `engine` (rotors, wind), `ui`, `music`, `amb`. Default gains: master 0.85, engine 0.5, sfx 0.8, music 0.35, amb 0.3. Sidechain ducking: on explosion M/XL and kills, duck `engine`+`music`+`amb` by −6 dB / −9 dB, attack 20 ms, release 600 ms.
- **Per-event layers** (synthesised, pooled voices, max 24): fire = crack (bandpassed noise 2–6 kHz, 30–90 ms) + body (sine/saw sweep, 60–300 Hz) + tail (convolver reverb send, 250 ms); explosion = sub thump (40–70 Hz sine drop, 300 ms) + crack (noise 4 kHz hipass, 60 ms) + debris rain (granular noise 1.2 s, lowpass sweeping down) + distance-based delay (d/343 s, cap 1 s). Hit marker tick (short 1.8 kHz sine 20 ms), kill confirm two tones (E5 then B5, 70 ms each, pitch steps +1 semitone per consecutive kill up to +6, reset after 3 s), damage taken = low thud + filtered hiss, lock tone (accelerating beeps 3→12 Hz), locked = continuous 1.2 kHz, lock lost = falling 2-tone.
- **Nine distinct fire sounds → six:** each weapon has its own spectral centroid (MG 3 kHz, AC 1.2 kHz, MISIL 400 Hz whoosh, SWARM 2 kHz pops, RAIL 8 kHz crack with 60 Hz sub, NOVA sub 45 Hz).
- **iOS unlock:** create/resume `AudioContext` inside the "Toca para empezar" pointerup, play a silent 1-sample buffer, then start engine loops; retry `resume()` on every `touchend` until state is `running`; on `visibilitychange`, resume. Haptics switch trick initialised on the same gesture.
- Engine loop pitch tracks rotor speed (from physics `m[i]`), wind whistle scales with airspeed and gust.

## 13. Performance budgets
| Tier | Detect | Draw calls | Particles (live) | DPR | Post | Notes |
|---|---|---|---|---|---|---|
| Phone (low) | `pointer:coarse` + governor | ≤ 100 | ≤ 64 sprites + 24 debris | ≤ 1.5 (governor 1–2) | tone map only (AgX) + single grade LUT, no bloom | shadows off, decals ≤ 16 |
| Tablet (mid) | coarse + `innerWidth ≥ 768` | ≤ 160 | ≤ 160 | ≤ 2 | AgX + grade + light bloom | decals ≤ 32 |
| Desktop (high) | fine | ≤ 260 | ≤ 320 | ≤ 2 (ultra 3 explicit) | AgX + grade + bloom + haze + DOF in photo | decals ≤ 64 |
One tonemapper (ACES→AgX, one) + one grade pass; `window.__volar.render` continues to publish DPR, p95, draw calls. Gate: ≥ 50 fps median on the deploy matrix (existing) plus p95 frame ≤ 22 ms on phone during a 3-explosion stress test. HUD uses DOM for text/plates and one 2D canvas for reticle/lock/arrows (single redraw per frame, dirty-rect).

## 14. Accessibility
Min text 12 px on phone HUD; contrast ≥ 4.5:1 (all text on `--h-plate` ≥ 7:1). Colour-blind safe: state is shape+colour (candidate = square pipper, hostile = diamond, friendly = circle/bracket, locked = solid vs acquiring = progress outline). Reduced motion: honour `prefers-reduced-motion` and an in-game toggle (Section 7 list). Hold vs toggle settings for Boost, Fire (hold / toggle), Look zone aim assist. One-handed mode: all critical actions reachable in the lower 55 % right zone. All buttons carry `aria-label` and 44 px hit target; menus focus-trapped with `openModal`. Text size setting 100/115/130 % for menus. Screen-reader announcements (aria-live polite) for gate progress, wave, low integrity. No information conveyed by audio alone (icons/captions "Lock", "Impacto").

## 15. Implementation plan

### 15.1 Splitting volar.js — DONE (Phase A0, pure refactor, zero behaviour change)
`web/volar.js` went from 2 557 to 773 lines and is now **orchestration only** (boot of the world, the fixed-step/render loop, lifecycle). Everything else lives in per-workstream modules wired through one shared `ctx` and an event `bus`. Install order in `main()` (this order is load-bearing: DOM listener order and dependencies):
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
Loop contract (volar.js): `update(dt)` picks who moves the drone (`tour.director.stepDirector` > `tour.director.stepReplay` > `tour.autopilot.step` > `enemies.gaterush.stepFly` > `controls.step` + `enemies.gaterush.afterStep` + `controls.afterStep`), then `fx.update`, `enemies.update`, `fx.afterUpdate`, `tour.ghost.update`. `render()` calls `controls.camera.updateFov`, pulses, `ctx.droneModel.update`, one of the camera sources (director / arrival / orbit / `controls.camera.update`), reports (`enemies.report`, `fx.report`, `controls.report`), `ui.weapons.update`, `fx.render` (aim ring + shake), composer, then `fx.audioFrame` and `ui.update`.

**ctx (shared context, one object, created at module load in volar.js)**
| Field | Meaning |
|---|---|
| `THREE, $, esc, Q, CID, AT, AUTOTEST, report, bus, flags, auto, P` | constants; `report` = `window.__volar`; `P` = interpolated drone position (Vector3); `auto` = `{until:5}` in autotest |
| `flags` (frozen) | `fv2` (`?fv=2`, default false — parsed ONCE here, nothing reads it yet), `debug` (`?debug=1`), `autotest`, `coarse` (pointer:coarse) |
| `state` (S) | shared mutable game state: `simT, modeKey, reto, replay, retoFly, retoMode, resultShown, director, ghost, sceneObjects, firing, lastInvasionRun`. Former closure `let`s of main(); read/write directly |
| `trigger` | fire-trigger telemetry (`held, locked, source, pointerId, presses, releases, accepted, mode`), dumped in `report.weaponState.trigger` |
| `actions` | named entry points modules register and call lazily: `setMode setRig cycleRig releaseFiring beginFiring startReto startReplay exitReplay startInvasionRun enterDirector toggleGhost toggleSound toggleRec cycleVista cycleCalidad` |
| boot-assigned | `man W renderer scene camera worldGroup composer post(post-process effects) terrain fxLevel sky syncLook world collision drone droneModel input audio loop` |
| module APIs | `ui`, `fx`, `controls`, `enemies`, `tour` (each filled by its install hook; shape documented in the header of each index.js) |
`window.__volar.ctx` exposes it for debugging (non-enumerable, so `JSON.stringify(window.__volar)` is unchanged).

**bus (`web/flightverse/bus.js`, no deps)**: `createBus({validate,strict})` -> `on(type,fn)` (returns unsubscribe), `once`, `off`, `emit(type, detail)`, `clear`, `count`, `stats`. A throwing handler is logged and never breaks the emitter. `BUS_EVENTS` is the schema: `fire{weapon,origin,dir}`, `hit{target,weapon,damage,kill}`, `explode{pos,size}`, `damage{amount,dir,source}`, `crash{energyClass}`, `respawn`, `lock{target,state}`, `wave{n}`, `gate{i,n}`, `mode{key}`, `pause` (A0 adds `{active, overlay}`), `tod{key}`. **Emitted today (A0)**: `fire` (fx.doFire), `mode` (controls.setMode), `pause` (overlay change), `tod` (sky chip), `gate` (Gate Rush gate passed, `i` = new index), `wave` (invasion wave change), `damage` (invasion hit, `dir:null`, `source:'invasion'`), `crash` (`energyClass:'soft'`, on the soft-crash edge). **Not emitted yet** (no source exists): `hit`, `explode`, `respawn`, `lock` — B/C/D add them at the point they are produced.

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
| `input/bindings.js` | trigger state machine, fire pointers, touch sticks, hotkeys, blur/orientation reset, flight input sampling, crash edge | C |
| `input/camera.js` | rig controller, gimbal, flight tools, FOV kick, camera pose + collision | C |
| `input/drone-model.js` | procedural/GLB drone, props, nav lights, hover bob, hardpoints | C |
| `modes/index.js` | `installEnemies` | D |
| `modes/invasion-mode.js` | invasion + player HP, run start/stop, local best, defeat logic, QA URL start | D |
| `modes/gaterush-mode.js` | start/fly-in/cues/result data/replay exit, `?autotest=gaterush` | D |
| `tour/index.js` | `installTour`: ghost, autopilot, cinematic, director, recorder, `autotestRecord` | E |
| `tour/ghost.js` `autopilot.js` `cinematic.js` `director.js` | real-flight ghost, Arcade autopilot + trail, arrival swoop + orbit, keyframe director + replay playback | E |
Unchanged files keep the ownership table below. Shared: `runtime.js` (C only), `scene.js`/`sky.js` (E only for presentation). Tests that used to grep `volar.js` read `pipeline/fv_source.py` (volar.js + all module files) or the specific module.

**Ownership of the pre-existing files (unchanged from plan)**
| WS | Scope | Owns (only these files) | Depends on |
|---|---|---|---|
| A | HUD, reticle canvas, menus, screens, onboarding, settings UI, a11y, mode select, end screens | `web/volar.js`, `web/css/volar.css`, new `web/css/hud.css`, `web/css/screens.css`, `web/flightverse/ui/*.js`, `bus.js`, `hud-format.js`, `flight-tools.js`, `panels.js`, `mobile-command.js`, `render-quality.js` | bus events from B-E |
| B | Weapons, projectiles, tracers, FX, impacts, decals, shake/hit-stop, audio | `weapons.js`, `weapon-effects.js`, `weapon-models.js`, `weapon-registry.js`, `aiming.js`, `audio.js`, `fx/*.js`, new `audio/*.js` | bus `fire/hit/explode` |
| C | Controls, cameras, physics v2 wiring, wind, haptics | `touch.js`, `camera-rigs.js`, `runtime.js`, `physics/*`, `collision-math.js`, `world-collision.js`, `scene-object-collision.js`, `drone-envelope.js`, `input/*.js` | emits `damage/crash/respawn`; reads `mode` |
| D | Enemies, invasion, Gate Rush loop, medals/records, difficulty | `invasion.js`, `invasion-policy.js`, `gaterush.js`, `objects.js`, enemy assets, `modes/*.js` | A for screens, B for fx |
| E | World presentation, Tour, photo mode, time of day, world edge | `sky.js`, `scene.js`, `visual-coverage.js`, `vegetation.js`, `layer-load-state.js`, `recorder.js`, `export.js`, `tour/*.js`, `photo.js`, `web/assets/tour/*.json` | A for menu entries |

### 15.3 Order and acceptance
Order: A step 0 (day 1) → B, C, D, E in parallel → A UI polish (day 3) → integration pass (day 4) → deploy gate. Every stream ships behind `?fv=2` until the integration pass, then flips default.

**A acceptance:** screenshots at 430x932, 932x430, 1440x900 for FPV, Cerca, Cenital, Pause, Mode select, GR result, defeat, Onboarding; deleted-element list absent from DOM (test greps class names); no clipped buttons at 430 px (Playwright overflow assertion); all text ≥ 12 px (computed-style test on `.vl-*` HUD); contrast test; `H` hint absent on touch.
**B acceptance:** 6 weapons produce visible tracer/projectile in FPV and chase (screenshot per weapon); distinct spectral fingerprint test (FFT centroid ordered as in table ±15 %); FX pool caps enforced (test spawns 500 events, live count ≤ cap); 3-explosion stress ≤ 22 ms p95 on phone emulation; hit-stop only on kills; existing ammo/cooldown unit tests pass unchanged.
**C acceptance:** touch stick dead zone/expo unit tests; mouse-look works in every camera (Playwright pointer-lock test); FPV tilt 28°, chase spring arm has zero near-plane intrusion in the collision gate; physics v2 imported in `runtime.js` with wind/attitude on `window.__volar.physics`; crash → respawn < 1 s; ≥ 50 fps gate green; `pipeline/test_physics_*.mjs` green.
**D acceptance:** stationary player survives ≥ 45 s Media on wave 1 (simulated test); markers and off-screen arrows visible in screenshots at 3 viewports; telegraph precedes every enemy shot by ≥ 0.5 s (assertion in policy test); Gate Rush timer visible at 430 px; start ≥ 12 m from walls; medals and records persist across reload.
**E acceptance:** Tour runs 5–8 POIs on every world without entering a mask (offline validator + screenshots), camera min distance 6 m; edge fog + warning triggers before boundary in all worlds; photo mode saves PNG; night shot mean luma ≥ 0.06; golden-hour screenshot per world; no draw call regression vs budget.
**Global:** `tsc`/typecheck exit 0 before push; `audit_world.py`, collision gate `--stress 100`, `browser_matrix.py --flightverse` green; `pipeline/bump_web_version.py` after every batch (one owner, WS A at integration).
