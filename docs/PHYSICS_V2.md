# AeroBrain Flightverse — Physics v2

Status: stages S0 (+ the pure parts of S2/S3/S4) are implemented as standalone
modules under `web/flightverse/physics/`. **Nothing in the live game imports them yet.**
Integration is stage S1 (below).

```
web/flightverse/physics/
  params.js    constants, flight profiles, wind presets, ISA density helper, makeParams()
  quad.js      state, controllers (angle / attitude / acro), mixer, motors, stepQuad(), fixed-step accumulator
  wind.js      mean profile + Dryden turbulence + urban shelter (injected heightAt), 30 Hz cache
  aero.js      ground / ceiling / wall effect, VRS, battery sag, environment probe (injected rayDist)
  contact.js   impulse contact solver, energy classes, damage, respawn snapshot, vegetation drag
  rng.js       mulberry32 + gaussian (seeded, copyable state)
pipeline/test_physics_{quad,wind,contact,perf}.mjs   (node --test)
```

Design rules: pure ES modules, no three.js. The other flightverse modules use a `?v=N` cache-buster only on
their imports of `three.js`/siblings from `runtime.js`; inside `physics/` imports are plain relative paths (no `?v=`),
so `runtime.js` should import `physics/quad.js?v=N` and bump that single entry when the folder changes.
Preallocated
scratch, **zero allocations inside `stepQuad` / `resolveContact` / `sampleWind`**
(source-grep test + heap-growth test). Node loads them directly (Node >= 22 syntax
detection; no `package.json` needed).

## 1. Model

Frames: world y up. Body: x right, **y up = thrust axis**, z back (forward = -z).
`q = (w,x,y,z)` rotates body -> world; angular velocity `w` is in the body frame.

State: `p, v, q, w`, four normalised motor speeds `m[i]` (0..1), per-motor damage `dmg[i]`,
`soc`, `integrity`, `cut` (motors cut after a crash), integrators `iv`, smoothed velocity command `vcf`, seeded `rng`.

* **Motors.** `T_i = Tmax * rhoR * m_i^2 * batt * (1 - dmg_i) * groundEffect * ceilingEffect * (1 - 0.25 B_vrs)`.
  First-order lag with exact update `m += (1-exp(-dt/tau)) (cmd - m)`, tau_up 30 ms, tau_down 50 ms.
  `Tmax` is per motor at sea level: `twr*m*g/4` (TWR 2.5).
* **Yaw reaction torque** `s_i * kQ * T_i` (kQ = 0.016 m), X frame, arm half-spacing 0.078 m.
* **Translation.** `m dv/dt = R (0, sum T, 0) - m g y + F_drag(va) + F_wall`, `va = v - wind`.
  Drag = linear rotor drag in body axes `m*diag(k1) va_b` (k1x = k1z = 0.35 1/s from Faessler et al.
  arXiv 1712.02402) + quadratic `1/2 rho CdA_i |va| va_b,i` (CdA_xz 0.0077, CdA_y 0.044 m^2).
* **Rotation.** `I dw/dt = tau - w x (I w) - Cw w` (damping implicit), I = (1.0e-3 roll, 1.9e-3 yaw, 1.0e-3 pitch).
* **Integrator.** Semi-implicit Euler at 120 Hz (`STEP_DT`); quaternion advanced with the exact
  increment `q <- q (x) exp(w dt/2)` and renormalised.
* **Air density.** ISA `rho = 1.225 (1 - 0.0065 h/288.15)^4.256`; `makeParams(over, altM)` sets `rhoR`
  (Bogota 2600 m -> 0.773). Only thrust, quadratic drag and `vh` scale with density (see deviations).

### Aero extras (`aero.js`)
* Ground effect `T/T0 = 1/(1 - rhoG (R_eff/4z)^2)`, `z >= 0.5 R_eff` (1.0667 at z = R_eff; max 1.333).
* Ceiling effect same form with `rhoC = 1.5`, capped at 1.5.
* Wall effect: lateral pull of `wallK (wallR/d)^2` of thrust toward the nearest wall, zero beyond `4 wallR`.
* VRS: `B(r) = sin^2(pi (r-0.3)/1.3)` for `r = descent_rate/vh in [0.3, 1.6]`, smoothly killed by horizontal
  airspeed (0 at 0.6 vh); thrust `*= 1 - 0.25 B`; plus seeded buffet torque on roll/pitch (scaled by rotor flow).
* Battery (optional, `battery: 1`): thrust multiplier 1 -> 0.85 as SoC falls below 35%; SoC drains
  proportional to `mean(m^3)`, calibrated so hover lasts `hoverSeconds` (1200 s [U]).
* `probeEnvironment(rayDist, x,y,z, rEff, env)` fills `env.agl / ceil / wallDist / wnx / wnz` from an
  **injected** `rayDist(ox,oy,oz,dx,dy,dz,maxDist) -> metres | Infinity` (6 rays; run it at ~30 Hz, not per step).

## 2. Controller (`quad.js`, `control()`)

Three input modes on one `cmd` object (`createCmd()`): `fwd, right, climb, yaw` in [-1,1], `thr` in [0,1]
(acro), `pitchDeg, rollDeg` (attitude mode).

**MODE_VEL (angle / "normal" flight).**
1. `v_cmd` = stick * `vmax`, rotated by the drone heading; optional first-order smoothing `cmdTau` (Cine 0.6 s).
2. `a = kv (v_cmd - v) + iv` (`iv` = wind-cancelling integrator, `kiH` 1.2), limited so the resulting tilt
   stays within `tiltMax` (`|a_h| <= (g + a_y) tan(tiltMax)`); integrator freezes while saturated.
3. Vertical: `a_y = kvz (vz_cmd - vy) + iv_y` (`kvz` 3, `kiV` 1.5). Collective `T = m (g + a_y) / max(b_y, 0.3)`.
4. `n_des = normalize(a_h, g + a_y)` clamped to tiltMax; attitude error = rotation of the thrust axis toward `n_des`
   (`angle * axis`, expressed in the body); `w_des = kp * e` (`kp` 7.5, clamp 12 rad/s); yaw rate from the yaw stick.
5. Rate loop `tau = I kr (w_des - w) + w x Iw` with `kr` 30 (`kr*dt = 0.25 <= 0.4`).
6. Mixer: X mixer; if roll/pitch differential does not fit, **attitude has priority** (collective is shifted to
   leave headroom, an airmode-style rule — see deviations), then roll/pitch is scaled, yaw is dropped first.

Top speed *emerges* from tilt limit vs. drag; `vmax` is only the stick scale (must exceed the emergent speed).
Braking is the tilt reversing.

| Profile | tilt | stick vmax | climb / descend | cmdTau | kv | yaw rate | emergent top speed (sea level) |
|---|---|---|---|---|---|---|---|
| cine | 18 deg | 9 | 3 / 2.5 | 0.6 s | 1.8 | 1.2 rad/s | 6.7 m/s |
| normal | 30 deg | 14 | 5 / 4 | 0.08 s | 2.5 | 2.2 | 10.4 m/s |
| sport | 42 deg | 20 | 7 / 6 | 0 | 2.5 | 3.5 | 14.0 m/s |

**MODE_ATT**: direct tilt targets (`pitchDeg` forward, `rollDeg` right, heading-relative) with the same vertical
loop. Used for tests and for a future "assist off / attitude" mode.

**MODE_RATE (acro)**: Betaflight-style `rate = rateMax ((1-expo) s + expo s^3)` (rateMax 9 rad/s, yaw 4.5, expo 0.35);
throttle 0.5 = hover (linear to `twr*weight` at 1.0, hover-relative so it is density independent until saturation).

## 3. Wind (`wind.js`)

`createWind({seed, preset|w20, sigmaMul, dirRad, terrain:'urban'|'open', heightAt, veer})`,
`sampleWind(w, t, x, y, z, agl, speed, out)` -> `out = [wx, wy, wz]`.

* Mean: `W(h) = W20 (h/6)^alpha`, alpha 0.30 urban / 0.14 open, slow veer (`+-0.15 rad`, 90 s period).
* Turbulence: Dryden low-altitude (MIL-F-8785C / MIL-HDBK-1797), per axis exact first-order update
  `x' = a x + sqrt(1-a^2) sigma eta`, `a = exp(-Vref dt/L)`, `Vref = max(5, |v|)`,
  `sigma_w = 0.1 W20`, `sigma_u = sigma_v = sigma_w/(0.177+0.000823 h_ft)^0.4`,
  `L_w = h`, `L_u = L_v = h/(0.177+0.000823 h_ft)^1.2` (feet), seeded mulberry32.
* Presets: calm 0.5 / breezy 4 / gusty 7 m/s (gusty sigma x1.4).
* Urban shelter (needs `heightAt(x,z)`): 8 samples upwind at `d_k = 8*1.5^k`; `theta_k = atan((h_k - y)/d_k)`;
  `s = smoothstep(5 deg, 30 deg, max theta)`; mean `*= (1 - 0.8 s)` and `-0.3 s` recirculation; sigma `*= (1 + 1.5 s)`.
  Windward updraft (obstacle just downwind, up to 0.5 W), street-canyon speed-up (walls on both cross-wind sides, up to x1.35).
* Evaluated at 30 Hz with caching (`WIND_HZ`); time-driven so a fixed physics step gives identical output.

## 4. Contact (`contact.js`)

Velocity-level, caller supplies the hit `{nx,ny,nz (out of the surface), px,py,pz, kind}`; the solver picks the
support point on the oriented box (0.29 x 0.09 x 0.29 m times `bodyScale`) and applies
`j = -(1+e) vn / (1/m + n . ((I^-1 (r x n)) x r))` plus Coulomb friction (mu 0.4, clamped to never reverse slip).
`e`: concrete 0.3, terrain 0.25, foliage 0; `e = 0` if `|vn| < 0.3`. Energy `E = 1/2 m vn^2`:

| E (J) | class | consequence |
|---|---|---|
| < 0.15 | `CLS_SCRAPE` | bounce/scrape, negligible integrity loss |
| 0.15-1 | `CLS_WOBBLE` | integrity -0.02 (the impulse itself wobbles the attitude) |
| 1-3 | `CLS_PROP` | if the normal is mostly horizontal (`|ny| < 0.5`), motors within `propNear` of the contact get 20-60% damage (ramp with E) |
| > 3 | `CLS_CRASH` | motors cut (`s.cut = 1`), integrity -0.4, drone tumbles |

Helpers: `resolvePlane` (ground plane + depenetration), `supportExtent`, `recordSafe / restoreSafe`
(last-safe snapshot; restore keeps position + yaw, levels the drone, clears motion/damage/cut),
`vegetationDrag` (soft `exp(-k density dt)` velocity/spin damping, no impulse).

## 5. Parameter table

`[U]` = unverified, kept as a named param. All in `params.js` (`DEFAULTS`).

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

* Feel is set by `kp` (attitude bandwidth) and `kr` (rate loop). Rise time (10-90% of a 20 deg step) is 0.167 s at
  `kp 7.5 / kr 30`, overshoot ~0. Raising `kp` to 10-14 makes it snappier (rise 0.1 s) but overshoots 8-35% because the
  rate loop is limited by the 30 ms motor lag. If you raise `kp`, raise `kr` (keep `kr*dt <= 0.4`; 40 is the ceiling).
* Top speed per profile: change `tiltDeg` (speed ~ where `k1 v + k2 v^2 ~ g tan(tilt)` including the y-axis drag from the tilted body).
* Wind hold quality: `kiH`. Faster = better gust rejection but more overshoot on stops.
* Sag / endurance: `hoverSeconds`, `sagStart`.
* Ground feel: `rEff` is a game-scale knob (not the 0.045 m rotor), bigger = ground cushion up to higher altitudes.
* Run `node --test pipeline/test_physics_*.mjs` after every change; the tests encode the targets.

## 7. Integration plan

* **S0 (done)**: modules + tests, no game changes.
* **S1**: `createDrone` in `runtime.js` behind `?phys=v2` (default off). Per frame: fixed 120 Hz accumulator
  (`advanceQuad`) driven by the existing `STEP`; map input to `createCmd()` (sticks -> `fwd/right/climb/yaw`;
  profile picker -> `setProfile`); at 30 Hz call `sampleWind` (wind -> `env.wx..wz`) and `probeEnvironment`
  with a `rayDist` adapter over `world-collision.js`; write `s.p / s.q` to the three.js object (interpolate between
  previous/current state as today). Keep the current `MIN_AGL` and 0.59 m collision radius initially: collision
  detection stays the game's; on hit call `resolveContact` with the hit normal/kind and `bodyScale` chosen so the
  box is inside the 0.59 m sphere. **Dios (noclip) and Arcade modes are untouched** and keep the old integrator.
* **S2**: wind: `createWind` per world (preset in world config, `rhoR` from `worldDensityRatio`, `heightAt`
  from the DSM/building grid); wind vane / HUD arrow from `wind.cache`.
* **S3**: contact: replace the ad-hoc bounce with `resolveContact`; energy class -> HUD/audio/haptics; crash -> `restoreSafe`.
* **S4**: aero extras live: ground/ceiling/wall via `probeEnvironment`; VRS/prop damage feedback in the HUD.
* **S5**: HUD (SoC, integrity, motor bars, wind), audio (motor pitch from `s.m`, wind noise from |va|), camera hooks
  (shake from VRS buffet `s.vrs` and impacts, FOV from speed), replay determinism check (seed + input log).

## 8. Deviations from the research design

* Dryden `L_u = L_v = h / (0.177 + 0.000823 h)^1.2` (division), not the multiplication written in the summary — the
  multiplication gives nonsense (1.3 ft at 10 ft); MIL-HDBK-1797 divides.
* Linear rotor drag `k1` is **not** scaled by density (only quadratic drag and thrust are). With k1 scaled it would
  make top speed lower at altitude but rotor drag is roughly independent of air density at constant thrust (rotors spin
  faster in thin air). Consequence: tilt-limited top speed at Bogota is slightly *higher* (normal 11.1 vs 10.4 m/s) while
  climb and thrust margin are lower (acro full-throttle 5 s: 9.6 vs 11.0 m/s; sport saturates the motors and sinks 1.4 m/s).
* Collective is shifted to keep roll/pitch authority when thrust saturates (airmode-style) instead of strictly keeping
  the collective: without it sport at Bogota lost attitude control and flipped.
* Angle-mode acceleration limit uses `(g + a_y) tan(tilt)` rather than `g tan(tilt)`, so the vertical integrator
  (compensating body-axis drag) does not silently shrink the tilt limit.
* VRS buffet torque is scaled by rotor flow (thrust / weight) so a motors-off fall is not shaken.
* Kp 7.5 / Kr 30 instead of 14 / <=40: at 14/40 a 20 deg step rises in 0.07 s with 13-22% overshoot.

## 9. Test summary (node --test, all in `pipeline/`)

`test_physics_quad.mjs` (18): ISA density, hover |v| < 1e-4 at rho 1 and 0.77, terminal velocity within 2%,
pitch step rise/overshoot, wind hold tilt, per-profile top speed, Bogota performance, braking, yaw, acro, motor lag,
mixer, ground/ceiling/wall, VRS, battery, damage.
`test_physics_wind.mjs` (10): PRNG, power law, presets, Dryden scales, sigma within 5% (measured ratios 0.97-1.02),
correlation, cache, seeds, shelter, canyon/updraft.
`test_physics_contact.mjs` (12): bounce e^2 h, resting, energy fuzz (4000 random impacts), materials, friction,
energy classes, prop strike, tumble, snapshot, vegetation.
`test_physics_perf.mjs` (6): bit-identical determinism, chunk independence, no-alloc source + heap tests, probe, speed
(~0.85 us/step, 7200 steps in ~6 ms).
