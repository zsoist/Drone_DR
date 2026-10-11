# AeroBrain Flightverse — Physics v2

Status: the stages `S0-S4` are done. The game uses them behind the flag **`?fv=2` (or `?phys=v2`)**. See section 10.
If you do not use the flag, the game runs the legacy integrator as before.

```
web/flightverse/physics/
  params.js    constants, flight profiles, wind presets, ISA density helper, makeParams()
  quad.js      state, controllers (angle / attitude / acro), mixer, motors, stepQuad(), fixed-step accumulator
  wind.js      mean profile + Dryden turbulence + urban shelter (injected heightAt), 30 Hz cache
  aero.js      ground / ceiling / wall effect, VRS, battery sag, environment probe (injected rayDist)
  contact.js   impulse contact solver, energy classes, damage, respawn snapshot, vegetation drag
  rng.js       mulberry32 + gaussian (seeded, copyable state)
  sim.js       game-side simulation (WS C): stick mapping, 30 Hz probes, wind, sweep/recover collision + contact, crash/respawn
  vegetation-field.js  soft-drag density from scatter.json (same rows/cap as vegetation.js)
  index.js     barrel: runtime.js imports this one file (single module instance)
pipeline/test_physics_{quad,wind,contact,perf}.mjs   (node --test)
```

Design rules: the modules are pure ES modules. They do not use three.js.

* The other flightverse modules use a `?v=N` cache-buster on their imports of `three.js` and of the other modules from `runtime.js`.
* Inside `physics/`, the imports are plain relative paths (no `?v=`).
* So `runtime.js` imports `physics/quad.js?v=N`. When the folder changes, bump that single entry.
* The modules use preallocated scratch memory.
* There are **zero allocations inside `stepQuad` / `resolveContact` / `sampleWind`**. A source-grep test and a heap-growth test check this.
* Node loads the modules directly. This needs the syntax detection of Node `>= 22`. A `package.json` is not necessary.

## 1. Model

In the world frame, y is up. In the body frame, x is right, **y is up (the thrust axis)**, and z is back (forward is `-z`).
`q = (w,x,y,z)` rotates a vector from the body frame to the world frame. The angular velocity `w` is in the body frame.

The state has these fields:

* `p, v, q, w`.
* The four normalized speeds of the motors, `m[i]` (0..1).
* The damage of each motor, `dmg[i]`.
* `soc`, `integrity`, and `cut` (the code cuts the motors after a crash).
* The integrators `iv`.
* `vcf`, the filtered velocity command.
* The seeded `rng`.

The model has these parts:

* **Motors.** `T_i = Tmax * rhoR * m_i^2 * batt * (1 - dmg_i) * groundEffect * ceilingEffect * (1 - 0.25 B_vrs)`.
  The motor speed has a first-order lag with the exact update `m += (1-exp(-dt/tau)) (cmd - m)`.
  `tau_up` is 30 ms and `tau_down` is 50 ms.
  `Tmax` is the thrust of each motor at sea level: `twr*m*g/4` (TWR 2.5).
* **Yaw reaction torque** is `s_i * kQ * T_i` (`kQ = 0.016 m`). The frame is an X frame. The arm half-spacing is 0.078 m.
* **Translation.** The equation is `m dv/dt = R (0, sum T, 0) - m g y + F_drag(va) + F_wall`, with `va = v - wind`.
  The drag has two parts.
  The first part is linear rotor drag in the body axes: `m*diag(k1) va_b` (`k1x = k1z = 0.35 1/s` from Faessler et al.
  arXiv 1712.02402).
  The second part is quadratic drag: `1/2 rho CdA_i |va| va_b,i` (CdA_xz 0.0077, CdA_y 0.044 m^2).
* **Rotation.** The equation is `I dw/dt = tau - w x (I w) - Cw w`. The term `Cw w` is implicit.
  The inertia is `I = (1.0e-3 roll, 1.9e-3 yaw, 1.0e-3 pitch)`.
* **Integrator.** The integrator is semi-implicit Euler at 120 Hz (`STEP_DT`).
  The quaternion advances with the exact increment `q <- q (x) exp(w dt/2)`. Then the code renormalizes it.
* **Air density.** The ISA formula is `rho = 1.225 (1 - 0.0065 h/288.15)^4.256`.
  `makeParams(over, altM)` sets `rhoR` (Bogota 2600 m gives 0.773).
  Only thrust, quadratic drag and `vh` scale with density (see section 8).

### Aero extras (`aero.js`)
* Ground effect: `T/T0 = 1/(1 - rhoG (R_eff/4z)^2)` for `z >= 0.5 R_eff`. The value is 1.0667 at `z = R_eff`. The maximum is 1.333.
* Ceiling effect: the form is the same, with `rhoC = 1.5`. The cap is 1.5.
* Wall effect: a lateral pull of `wallK (wallR/d)^2` of thrust toward the nearest wall. The pull is zero beyond `4 wallR`.
* VRS: `B(r) = sin^2(pi (r-0.3)/1.3)` for `r = descent_rate/vh in [0.3, 1.6]`.
  The horizontal airspeed smoothly kills it (0 at 0.6 vh).
  The thrust gets the factor: thrust `*= 1 - 0.25 B`.
  A seeded buffet torque also acts on roll and pitch. The rotor flow scales this torque.
* Battery (optional, `battery: 1`): the thrust multiplier goes from 1 to 0.85 as SoC falls below 35%.
  SoC drains in proportion to `mean(m^3)`. The calibration makes hover last `hoverSeconds` (1200 s [U]).
* `probeEnvironment(rayDist, x,y,z, rEff, env)` fills `env.agl / ceil / wallDist / wnx / wnz`.
  It uses an **injected** `rayDist(ox,oy,oz,dx,dy,dz,maxDist) -> metres | Infinity` (6 rays).
  Run it at about 30 Hz, not at each step.

## 2. Controller (`quad.js`, `control()`)

The controller has three input modes on one `cmd` object (`createCmd()`).
`fwd, right, climb, yaw` are in [-1,1]. `thr` is in [0,1] (acro). `pitchDeg, rollDeg` are for attitude mode.

**MODE_VEL (angle / "normal" flight).**
1. `v_cmd` is the stick value times `vmax`, rotated by the drone heading. The optional filter `cmdTau` (Cine 0.6 s) smooths it.
2. `a = kv (v_cmd - v) + iv`. `iv` is the integrator that cancels the wind (`kiH` 1.2).
   A limit keeps the tilt within `tiltMax`: `|a_h| <= (g + a_y) tan(tiltMax)`.
   The integrator freezes while the limit is active.
3. Vertical: `a_y = kvz (vz_cmd - vy) + iv_y` (`kvz` 3, `kiV` 1.5). The collective is `T = m (g + a_y) / max(b_y, 0.3)`.
4. `n_des = normalize(a_h, g + a_y)`, clamped to tiltMax.
   The attitude error is the rotation of the thrust axis toward `n_des` (`angle * axis`, expressed in the body).
   `w_des = kp * e` (`kp` 7.5, clamp 12 rad/s). The yaw stick gives the yaw rate.
5. The rate loop is `tau = I kr (w_des - w) + w x Iw` with `kr` 30 (`kr*dt = 0.25 <= 0.4`).
6. The mixer is an X mixer. If the roll/pitch differential does not fit, **attitude has priority**.
   The mixer shifts the collective to leave headroom (an airmode-style rule, see section 8).
   Then it scales roll/pitch. It drops yaw first.

The top speed *emerges* from the tilt limit and the drag. `vmax` is only the stick scale. It must be more than the emergent speed.
To brake, the drone reverses the tilt.

| Profile | tilt | stick vmax | climb / descend | cmdTau | kv | yaw rate | emergent top speed (sea level) |
|---|---|---|---|---|---|---|---|
| cine | 18 deg | 9 | 3 / 2.5 | 0.6 s | 1.8 | 1.2 rad/s | 6.7 m/s |
| normal | 30 deg | 14 | 5 / 4 | 0.08 s | 2.5 | 2.2 | 10.4 m/s |
| sport | 42 deg | 20 | 7 / 6 | 0 | 2.5 | 3.5 | 14.0 m/s |

**MODE_ATT** gives direct tilt targets (`pitchDeg` forward, `rollDeg` right, relative to the heading).
It uses the same vertical loop. The tests use it. A future `assist off / attitude` mode will use it too.

**MODE_RATE (acro)** uses a Betaflight-style rate curve: `rate = rateMax ((1-expo) s + expo s^3)` (rateMax 9 rad/s, yaw 4.5, expo 0.35).
A throttle of 0.5 is hover. The throttle is linear up to `twr*weight` at 1.0.
It is relative to hover, so it does not depend on density until the motors saturate.

## 3. Wind (`wind.js`)

Create the wind with `createWind({seed, preset|w20, sigmaMul, dirRad, terrain:'urban'|'open', heightAt, veer})`.
Sample it with `sampleWind(w, t, x, y, z, agl, speed, out)`. The call writes `out = [wx, wy, wz]`.

* Mean wind: `W(h) = W20 (h/6)^alpha`. `alpha` is 0.30 for urban and 0.14 for open terrain.
  The slow veer is `+-0.15 rad` with a 90 s period.
* Turbulence: Dryden low-altitude model (MIL-F-8785C / MIL-HDBK-1797).
  Each axis has an exact update of first order: `x' = a x + sqrt(1-a^2) sigma eta`.
  * `a = exp(-Vref dt/L)`, `Vref = max(5, |v|)`.
  * `sigma_w = 0.1 W20`, `sigma_u = sigma_v = sigma_w/(0.177+0.000823 h_ft)^0.4`.
  * `L_w = h`, `L_u = L_v = h/(0.177+0.000823 h_ft)^1.2`. The height `h_ft` is in feet.
  * The generator is the seeded mulberry32.
* Presets: calm 0.5 / breezy 4 / gusty 7 m/s. The gusty sigma gets the factor `x1.4`.
* Urban shelter: it needs `heightAt(x,z)` and takes 8 samples upwind at `d_k = 8*1.5^k`.
  * `theta_k = atan((h_k - y)/d_k)`.
  * `s = smoothstep(5 deg, 30 deg, max theta)`.
  * The mean wind changes by `*= (1 - 0.8 s)` and `-0.3 s` (recirculation).
  * The sigma changes by `*= (1 + 1.5 s)`.
* Windward updraft (obstacle just downwind): up to 0.5 W.
* Street-canyon speed-up (walls on both cross-wind sides): up to `x1.35`.
* The code evaluates the wind at 30 Hz with a cache (`WIND_HZ`). The wind is time-driven, so a fixed physics step gives identical output.

## 4. Contact (`contact.js`)

The contact solver works at velocity level. The caller gives the hit `{nx,ny,nz (out of the surface), px,py,pz, kind}`.
The solver picks the support point on the oriented box (0.29 x 0.09 x 0.29 m times `bodyScale`).
It applies `j = -(1+e) vn / (1/m + n . ((I^-1 (r x n)) x r))`.
It also applies Coulomb friction (mu 0.4, clamped so that it never reverses the slip).

The restitution `e` is 0.3 for concrete, 0.25 for terrain and 0 for foliage. `e = 0` if `|vn| < 0.3`.
The energy is `E = 1/2 m vn^2`:

| E (J) | class | consequence |
|---|---|---|
| < 0.15 | `CLS_SCRAPE` | bounce/scrape, negligible integrity loss |
| 0.15-1 | `CLS_WOBBLE` | integrity -0.02 (the impulse itself wobbles the attitude) |
| 1-3 | `CLS_PROP` | if the normal is mostly horizontal (`|ny| < 0.5`), motors within `propNear` of the contact get 20-60% damage (ramp with E) |
| > 3 | `CLS_CRASH` | motors cut (`s.cut = 1`), integrity -0.4, drone tumbles |

These helpers exist:

* `resolvePlane`: the ground plane and depenetration.
* `supportExtent`.
* `recordSafe / restoreSafe`: the last-safe snapshot.
  The restore keeps the position and the yaw. It levels the drone. It clears the motion, the damage and `cut`.
* `vegetationDrag`: soft `exp(-k density dt)` damping of velocity and spin, with no impulse.

## 5. Parameter table

`[U]` means unverified. The code keeps each such value as a named parameter. All parameters are in `params.js` (`DEFAULTS`).

| Param | Value | Source / note |
|---|---|---|
| mass | 0.249 kg | Mini-class 249 g |
| twr | 2.5 | sea level, full throttle |
| rotorR | 0.045 m | airframe |
| armL | 0.078 m | X-mixer half spacing |
| kQ | 0.016 m | [U] yaw torque / thrust |
| Ix, Iy, Iz | 1.0e-3, 1.9e-3, 1.0e-3 | Iy = yaw axis |
| Cw | 2e-4 / 4e-4 / 2e-4 | [U] rotational damping |
| tauUp / tauDown | 30 / 50 ms | typical small quad ESC+prop |
| k1x, k1z | 0.35 1/s | Faessler et al. arXiv 1712.02402 |
| k1y | 0.15 1/s | [U] |
| cdaX / cdaZ / cdaY | 0.0077 / 0.0077 / 0.044 m^2 | design estimate |
| rEff | 0.25 m | [U] game-scale ground-effect radius |
| rhoG / rhoC | 1.0 / 1.5 | Cheeseman-Bennett / design |
| wallK, wallR | 0.04, 0.5 m | [U] |
| vrsDepth, vrsHorFrac, vrsNoise | 0.25, 0.6, 0.006 N m | [U] shape from design |
| sagMax / sagStart / hoverSeconds | 0.15 / 0.35 / 1200 s | [U] |
| kp / kr / omegaMax | 7.5 / 30 / 12 | tuned (see below) |
| kvz / kiH / kiV | 3 / 1.2 / 1.5 | tuned |
| rateMax / rateYawMax / expo | 9 / 4.5 rad/s / 0.35 | [U] feel |
| box | 0.29 x 0.09 x 0.29 m x bodyScale (1.0) | design |
| mu, eConcrete, eTerrain, eFoliage | 0.4, 0.3, 0.25, 0 | design |
| energy classes | 0.15 / 1 / 3 J | design |
| propNear | 0.11 m | [U] |
| vegDrag | 6 1/s | [U] |

## 6. Tuning notes

* `kp` (attitude bandwidth) and `kr` (rate loop) set the feel.
  The rise time (10-90% of a 20 deg step) is 0.167 s at `kp 7.5 / kr 30`, and the overshoot is about 0.
  If `kp` is 10-14, the response is faster (rise 0.1 s). But it overshoots 8-35%, because the motor lag of 30 ms limits the rate loop.
  If you raise `kp`, raise `kr` also. Keep `kr*dt <= 0.4`. 40 is the ceiling.
* To change the top speed of a profile, change `tiltDeg`.
  The speed is about where `k1 v + k2 v^2 ~ g tan(tilt)`, with the y-axis drag of the tilted body included.
* `kiH` sets the quality of the wind hold. A faster setting gives better gust rejection but more overshoot on stops.
* `hoverSeconds` and `sagStart` set the sag and the endurance.
* `rEff` sets the ground feel. It is a game-scale value, not the 0.045 m rotor. A bigger value gives a ground cushion up to higher altitudes.
* Run `node --test pipeline/test_physics_*.mjs` after every change. The tests encode the targets.

## 7. Integration plan

* **S0 (done)**: modules and tests. No game changes.
* **S1**: `createDrone` in `runtime.js` behind `?phys=v2` (default off). In each frame:
  * A fixed 120 Hz accumulator (`advanceQuad`) runs. The `STEP` of the game drives it.
  * The code maps the input to `createCmd()` (sticks to `fwd/right/climb/yaw`, profile picker to `setProfile`).
  * At 30 Hz the code calls `sampleWind` (wind to `env.wx..wz`) and `probeEnvironment` with a `rayDist` adapter over `world-collision.js`.
  * The code writes `s.p / s.q` to the three.js object. It interpolates between the previous state and the current state, as it does now.

  The plan keeps the current `MIN_AGL` and the 0.59 m collision radius at first.
  The game keeps the collision detection.
  On a hit, the code calls `resolveContact` with the hit normal and kind.
  The code chooses `bodyScale` so that the box is inside the 0.59 m sphere.
  **The `Dios` (noclip) and `Arcade` modes keep the old integrator.**
* **S2**: wind. One `createWind` for each world. The preset is in the world config, `rhoR` comes from `worldDensityRatio`, and `heightAt` comes from the DSM/building grid.
  The wind vane and the HUD arrow read `wind.cache`.
* **S3**: contact. `resolveContact` replaces the ad-hoc bounce. The energy class drives the HUD, the audio and the haptics. A crash calls `restoreSafe`.
* **S4**: aero extras live. The ground, ceiling and wall effects work through `probeEnvironment`. The HUD shows the VRS and prop damage feedback.
* **S5**: HUD, audio, camera hooks and a replay check.
  * HUD: SoC, integrity, motor bars, wind.
  * Audio: motor pitch from `s.m`, wind noise from `|va|`.
  * Camera hooks: shake from the VRS buffet `s.vrs` and from impacts, FOV from speed.
  * Replay determinism check: seed and input log.

## 8. Deviations from the research design

* Dryden uses `L_u = L_v = h / (0.177 + 0.000823 h)^1.2` (a division).
  The summary has a multiplication, but the multiplication gives nonsense (1.3 ft at 10 ft). MIL-HDBK-1797 divides.
* Density does **not** scale `k1`, the linear rotor drag. Only the quadratic drag and the thrust scale with density.
  If density scaled `k1`, the top speed at altitude will be lower.
  But the rotor drag is about independent of the air density at constant thrust, because the rotors spin faster in thin air.
  The consequences are:
  * The tilt-limited top speed at Bogota is slightly *higher* (normal 11.1 compared with 10.4 m/s).
  * The climb and the thrust margin are lower (acro full-throttle 5 s: 9.6 compared with 11.0 m/s).
  * Sport saturates the motors and sinks 1.4 m/s.
* If the thrust saturates, the controller shifts the collective to keep the roll/pitch authority (airmode-style). It does not strictly keep the collective.
  Without the shift, the drone lost attitude control and flipped in the sport profile at Bogota.
* The angle-mode acceleration limit uses `(g + a_y) tan(tilt)` instead of `g tan(tilt)`.
  With this limit, the vertical integrator (which compensates the body-axis drag) does not shrink the tilt limit silently.
* Rotor flow (thrust / weight) scales the VRS buffet torque. So a fall with the motors off does not shake.
* The values are Kp 7.5 and Kr 30 (not 14 and `<=40`). At 14/40 a 20 deg step rises in 0.07 s with 13-22% overshoot.

## 9. Test summary (node --test, all in `pipeline/`)

* `test_physics_quad.mjs` (18) checks ISA density, hover (`|v| < 1e-4` at rho 1 and 0.77), terminal velocity within 2%, and the pitch step rise and overshoot.
  It also checks the wind hold tilt, the top speed of each profile, Bogota performance, the brake response and yaw.
  The last checks are acro, motor lag, the mixer, ground/ceiling/wall, VRS, battery and damage.
* `test_physics_wind.mjs` (10) checks PRNG, power law, presets, Dryden scales, and sigma within 5% (measured ratios 0.97-1.02).
  It also checks correlation, cache, seeds, shelter, and canyon/updraft.
* `test_physics_contact.mjs` (12) checks the bounce `e^2 h`, rest contact, energy fuzz (4000 random impacts), materials and friction.
  It also checks energy classes, prop strike, tumble, snapshot and vegetation.
* `test_physics_perf.mjs` (6) checks bit-identical determinism, chunk independence, no-allocation source and heap tests, and the probe.
  It also checks the speed (about 0.85 us/step, 7200 steps in about 6 ms).

## 10. What is wired (WS C, `?fv=2` / `?phys=v2`)

**Files.**
* `physics/sim.js` (pure).
* `runtime.js` (`createDrone().attachV2`, `stepV2`, `lerpPose`).
* `input/physics-link.js` builds the sim for each world. It gets the profile and the wind from the context. It sets the bus and `ctx.phys`.
* `input/bindings.js` takes samples and times the step.

The fixed 120 Hz step of `createLoop` calls `drone.step`, which calls `sim.step`.
The render interpolates `prev.quat -> quat` (slerp). So the drone banks and pitches for real.
The `Dios` (noclip), `Arcade` (autopilot) and `Cinematico` (cinematic) modes keep their old code.
Any external move of `drone.pos/yaw` re-seeds the sim on the next `Normal` step.
Examples are the Gate Rush fly-in, the autopilot, the replay and the director.

**Mode to profile.**
* The `asistido` mode (labels `Normal` and `Explorar`) uses the `normal` profile (30 deg, about 10 m/s).
* The `cine` profile is only by user choice: `controls.physics.setProfile('cine')` or `?perfil=cine`. The game saves the choice in `ab.fv.profile`.
* The `sport` profile starts automatically while Gate Rush `Dificil` (hard) runs or Invasion is on.
* Gate Rush `Facil` (easy) and `Media` (medium) use `normal`.
* Boost adds +30 % tilt and +35 % stick speed, smoothed over 0.25 s.

**Air.**
* `rho/rho0` comes from `man.world.elev_min + 12 m` through the ISA model (Bogota 0.74-0.77).
* The wind speed follows a power law that saturates at 60 m AGL.
* Dryden turbulence applies. The urban shelter works through `collision.groundHeight`.
* `windGain` 0.5 scales the presets. The `Brisa` preset (breeze) is flyable upwind.
* The sky sets the wind: `dia` (day) and `atardecer` (dusk) give breezy, `noche` (night) gives calm, and sport contexts give gusty.
* An explicit choice wins: `ui.prefs.windPreset` (`calmo` is calm, `racheado` is gusty), `?viento=`, or `controls.physics.setWind`.
* The main wind direction is toward 2.75 rad (from ENE).

**Collision.**
* The sweep/recover code of the game decides *where* the drone can be.
  The radii are 0.59 for structure/boundary and 1.2 for terrain.
  The code uses 3 slide iterations and a `MIN_AGL` lift.
  There is no tunnelling: `test_physics_integration.mjs` makes 120 random fast runs at a 0.3 m wall.
* `resolveContact` decides *how* the drone reacts.
* The world collider is a sphere, so the contact acts through the centre (`P.contactLever`, new in contact.js).
  Only crash-level hits (a speed of at least about 5 m/s toward the surface) use the box corner and make the drone tumble.
* Damage happens once for each touch (0.3 s cooldown). Rest contact and scrape contact are free. Firm landings cost 2 %.
  While the drone is invulnerable, impacts have no consequences.
* Ray adapters (`sim.rayDist`) over `castSegment` feed the ground, ceiling and wall effects at 30 Hz. They subtract the surface offsets.

**Crash to respawn.**
1. The crash class (> 3 J) cuts the motors.
2. The body tumbles.
3. The game sends a `crash` event.
4. The wreck camera runs for 0.8 s.
5. The screen fades.
6. The drone respawns at `0.9 s` from the newest stable snapshot.
   The ring has 12 x 0.5 s snapshots. A snapshot must be at least 1.5 s old. The code prefers a hover snapshot.
   The integrity is 100 %. The invulnerability lasts 1.75 s. The mesh flickers at 8 Hz (.4/1).

A tap during the wreck camera skips it (`>= 0.3 s`).

**Vegetation.** The `scatter.json` rows go into a spatial hash (6 m cells). Inside a canopy, `vegetationDrag` acts (no impulse, no damage).

**Outputs.** `ctx.phys` is the same as `window.__volar.physics`. The game refreshes it in each render frame.
It has these fields: `active, profile, altM, densityRatio,
wind{x,y,z,speed,gust,fromDeg,relDeg,preset,shelter}, attitude{rollDeg,pitchDeg,yawDeg,tiltDeg}, battery, integrity (0-100),
motors[4], vrs, groundEffect, boost, invuln, agl, crash{active,phase('wreck'|'fade'),t,count,x,y,z}, impact{name,energy,speed,t,n},
vegetation, stats{steps,contacts,bumps,crashes,respawns,nonFinite,collisionFailures,embedded,probes}, stepUs`.
The bus events are: `crash{energyClass:'bounce'|'wobble'|'prop'|'crash',energy,speed,integrity,pos,normal}` (debounced 120 ms per class),
`damage{amount,dir,source:'impact',integrity}`, and `respawn{invulnerable,x,y,z,yaw}`.

**Measured.** A fixed step takes about 40-50 us in the browser (probes and sweeps included). In Node it takes 0.007 ms/step.
7200 steps take less than 100 ms.

Tests: `test_physics_integration.mjs` covers hover, wind hold, crash to respawn, determinism across frame timings, tunnelling, stuck, landing, teleport re-seed and vegetation.
The other tests are `test_fv_controls.mjs` and `test_fv_camera.mjs`.
Gate: `pipeline/flightverse_collision_gate.py <cid> --stress 100 --fv2` adds physics validators and a flight stress of 24 s with a real keyboard. You can also use `--both`.
