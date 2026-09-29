# Capture protocol — DJI Flip and DJI Neo 2 (manual flights)

Workstream W6 of the [World upgrade plan](WORLD_UPGRADE_PLAN.md). Input quality is the biggest lever on
every downstream result (ODM mesh, splats, Blender scene). Neither drone has waypoint missions or MSDK
support, so overlap, altitude and gimbal angle are all the pilot's job. This page is the field recipe.

Legend: **[V]** = specific to this protocol / AeroBrain pipeline. **[G]** = general photogrammetry practice,
**not verified on these specific drones** (check the first flight against the post-flight checks below).

## 1. Choose the mode first

| Goal | Capture | Why |
|---|---|---|
| Mesh, orthophoto, DSM, measurements | **Stills** (Timed Shot) | Sharp, EXIF-rich, no compression smear, ODM-native |
| Gaussian splat / visual walkthrough | Slow **video**, frames extracted | Denser, continuous coverage; blur is handled by frame selection |
| Both | Stills for the mesh, then one extra slow video orbit | Two datasets, separate scenes |

## 2. Pre-flight settings

- **Stills, Timed Shot (interval) 2–3 s** [V]. At ~5 m/s a 2 s interval gives a photo every ~10 m; at 3 s slow to
  ≤3 m/s (forward overlap is what matters, see section 4).
- **Manual exposure** [G]: shutter **≥ 1/500 s** (≥ 1/800 in wind or on orbits), ISO as low as the shutter
  allows (cap ~800; noise is worse than a slightly dark image), EV set by histogram, not by eye.
- **Lock** [G]: white balance to a fixed Kelvin (5200–5600 K in sun, preset "cloudy" under overcast), focus
  (infinity / tap-locked far), exposure. Auto exposure between shots creates brightness steps that hurt
  feature matching and texture blending.
- **Format**: DJI Flip — JPEG (RAW only if the model exposes it, [G]). **DJI Neo 2 — JPEG only** [V]; do not
  plan on RAW.
- **Lens model** [V]: Neo 2 has a wide (~120°) lens with strong distortion. Process with ODM
  `--camera-lens brown` (COLMAP: `OPENCV` camera model). Do not let any app "crop / correct" distortion
  before export if it can be turned off. Keep one camera model per dataset: do not mix drones or zoom levels.
- Resolution: full sensor, 4:3 if offered (more vertical coverage) [G].
- Video variant: 4K/30, fixed shutter ≈ 1/(2×fps) or faster (1/120 s ideal), no digital stabilisation
  cropping if it can be disabled (warping breaks the pinhole model) [G], normal colour profile (not D-Log unless
  graded) [G].
- Clean lens, battery for 2 packs, SD card cleared, date/clock right (EXIF time drives ordering) [G].
- Wind: skip capture above ~8 m/s; the drone will crab and the shutter will not save you [G].
- Light: overcast or sun high-and-behind you. Avoid long shadows that move during the flight and mixed
  sun/shade passes [G]. Avoid glass/water/shiny roofs when possible.
- Legal/safety: fly where and how it is legal (VLOS, height limits, people, RPAS rules of the country). A 0°
  facade pass, low orbits and the Neo 2's small size are for safe open areas only.

## 3. Flight patterns — one building (150–300 photos) [V]

Do the passes in this order; land and swap the battery between passes 1 and 2 if needed. Keep the same
camera settings across all passes.

1. **Nadir lawnmower**, 40–60 m AGL, gimbal **−90°**. Straight parallel lines across the site plus one
   building-width beyond each edge. Forward overlap ≥ 80 %, side overlap ≥ 70 % (see section 4). ~60–120 photos.
2. **Oblique orbits, 3 rings**, camera always pointing at the building centre, 10–20 m standoff from the
   wall (more if roof is high or trees/lines are near):
   - Ring A — height ≈ 1/3 of building height, gimbal ≈ **−25°**.
   - Ring B — height ≈ 2/3, gimbal ≈ **−45°**.
   - Ring C — roof height + 5 m, gimbal ≈ **−60°**.
   Shoot every **10–15° of yaw** (24–36 photos per ring). Fly the ring slowly and stop-and-shoot if
   Timed Shot would smear (yaw rate, not speed, causes orbit blur). Close each ring by overlapping the first
   frames.
3. **Facade strips at 0°** (gimbal level) — only where safe and legal. Fly a horizontal line parallel to the
   wall at the same 10–20 m standoff, sideways, shooting every ~2 s; repeat one strip per floor band. Skip
   if it puts the drone near people, glass, wires or trees.
4. Overshoot: also take 5–10 wide frames from a higher position showing the building in context (helps
   scale of the whole block and orientation).

Notes [G]: never fly a single ring and expect walls; corners, eaves and balconies need the oblique rings.
Vary height between rings (do not stack all shots at one altitude) — this improves camera calibration and
avoids doming.

## 4. Overlap arithmetic

Footprint on the ground (nadir) ≈ 2·H·tan(FOV/2) [G]. For a 40–60 m flight and ~80° effective FOV the
footprint is ~70–100 m wide; forward spacing for 80 % overlap ≈ 15–20 m. With a 2 s interval that means
≤ 7–10 m/s only on paper; practice **≤ 4–5 m/s** so blur and rolling shutter stay low. Side spacing for 70 %
overlap ≈ 25–30 m between lines. Adjust after the first flight (section 9) instead of trusting the sums.

## 5. Open land / terrain variant

- Nadir lawnmower only, gimbal −90° [V], 60–100 m AGL (or the legal ceiling), forward ≥ 80 %, side ≥ 70 %.
- Fly a **second, crossing** grid rotated 90° at a different height (±20 m) if slopes or vegetation are
  present [G] — this is the cheapest fix for doming and vegetation holes.
- Add one gentle 30° oblique pass along each edge if you want slopes or retaining walls [G].
- Vegetation, water, bare uniform sand and snow do not reconstruct well [G]; prefer overcast, avoid wind.
- Terrain following is not available: pick one AGL at the highest point of the flight area and keep the
  home-point height in mind (Flip/Neo 2 report height above take-off) [G].
- 300–600 photos per 5–10 ha is a typical order of magnitude [G]; do not exceed what the RTX 4060 Ti lane
  can process (see [Splat pipeline](SPLAT_PIPELINE.md) and [Operations](OPERATIONS.md)).

## 6. Video for splats [V]

- Speed **1–2 m/s**, smooth yaw, no whip pans, no sudden altitude changes.
- **Fixed shutter** (≥ 1/120 s for 4K/30), locked WB, locked exposure, no auto-zoom.
- Same three-ring orbit plan as section 3 plus the nadir pass; extra loop at head height around the subject
  if it is compact. Include loop closure (end where you started).
- Extraction is offline, not in the drone: AeroBrain picks frames by **sharpness** and spacing
  (`pipeline/capture_quality.py` `choose_frames`, `pipeline/odm_prep.py`), dropping the blurriest frames
  (thresholds live in the code profiles). Do not hand-pick frames unless you must.
- Video-derived frames carry compression smear and no lens EXIF; expect a lower metric quality than stills.
- Splats do not need scale; keep the flight steady and prefer more coverage over precision.

## 7. Scale and georeferencing (3–4 GCPs or a scale bar)

The drones do not give survey-grade GPS. For true scale/position use one of:

**A. Scale bar (fastest; scale only).** Place a rigid object of known length (2 m folding rule or two
targets measured with a tape, ± 2 mm) flat and visible in nadir frames near the building. Record the length.
Place two bars at different places if the site is large.

**B. 3–4 GCPs (scale + georeference).** [G]
1. Mark 3–4 targets (A3 checkerboard / painted cross) spread around the site edges (not in a line), at
   different heights if possible. Keep them visible from several photos in different passes.
2. Measure each target's coordinates with an external GNSS (phone RTK receiver, survey rover, or at least a
   phone with a stated accuracy) and write down EPSG code, X/Y/Z, and accuracy. Without an external
   measurement, use only a measured distance (option A).
3. Photograph each target from ≥ 5 frames (more if possible) at nadir and oblique.

ODM expects a `gcp_list.txt` next to the images or passed with `--gcp`:

```
EPSG:32618
<x> <y> <z> <im_x> <im_y> <image_name> [gcp_name]
```

One line per (target, image) observation: first line is the coordinate system, then world X Y Z followed by
the pixel position in that image and the file name. Provide ≥ 3 targets, ≥ 3 images each [G]. Record the
pixel positions with ODM's GCP editor or any tagging tool; keep the CSV of world coordinates next to the
dataset so it can be re-tagged.

For splat scenes, register with the alignment helper (`model_aligner` step) using the same target
coordinates. Keep the file list and photo names unchanged after capture [V]; renaming breaks the tie between
`gcp_list.txt` and the image set.

If no GCP or scale bar was captured, the model is only up to an arbitrary scale — AeroBrain measurements
are approximate in that case. Do not claim survey accuracy.

## 8. Recording the flight

- Log: date, site, drone, battery, settings (shutter, ISO, WB, interval), wind, sun. Two lines in the note
  field of the upload is enough.
- One folder per pass (`nadir`, `ringA`, `ringB`, `ringC`, `facade`, `video`) [V]; upload as one scene.
- Do not delete or edit photos on the card; the pipeline handles selection. Do not use in-app crop, beauty,
  or filter modes.
- Ingest via the SD-card flow (video + SRT) or the direct upload's **Fotos · malla 3D** mode (JPG/DNG, drop the
  whole folder — each subfolder becomes a pass under `raw/<set>/<pass>/`). Note: a stills-only set does not yet
  feed ODM from the 3D page (processing still starts from a video clip); that link is pending.

## 9. Post-flight quick checks (5 minutes, on site)

1. **Count**: 150–300 photos for one building; if < 120, fly another ring.
2. **Scroll the nadir pass**: consecutive frames must share ≥ 80 % of content. Hop-scotch gaps mean re-fly.
3. **Zoom to 100 %** on 10 random frames: text on signs / roof tile edges must be crisp. If 3 of 10 are soft,
   raise shutter or slow down and re-fly the ring.
4. **Histogram**: no clipped highlights on light roofs; shadows not crushed. Brightness must look consistent
   frame to frame.
5. **Coverage of walls**: each façade has ≥ 3 oblique frames from different angles.
6. **Targets**: every GCP / scale bar visible in ≥ 5 frames; coordinates written down.
7. **EXIF**: opens with a GPS position and the same camera model on all frames.

## 10. Common failures → what you see in AeroBrain → fix

| Failure | Symptom in AeroBrain | Fix in the field / next flight |
|---|---|---|
| Not enough overlap / gaps | Holes in the mesh, missing roof patches, ODM drops images | ≥ 80 / 70 % overlap, fly a second grid |
| Only nadir, no obliques | Walls smeared, roof-only model, empty facades | Add the three oblique rings |
| Single altitude, wide lens uncalibrated | **Doming / bowl**: flat ground is curved | Add crossing grid at other height, ≥ 3 GCPs, `--camera-lens brown` for Neo 2 |
| Motion blur (slow shutter, orbit yaw) | Soft textures, low-poly noisy walls, blurry splat | Shutter ≥ 1/500, slow down, stop-and-shoot on orbits |
| Auto exposure / auto WB | Visible brightness patches in texture, seams | Lock exposure and WB |
| Moving objects (people, cars, trees in wind) | **Floaters**, ghost cars, fuzzy vegetation | Shoot fast, avoid people; remove in Splat Lab / mask if needed |
| Sun/shadow change during flight | Shadow ghosting, lighting mismatch between sides | Shoot in overcast or in a short window |
| Glass, water, shiny roof, uniform surface | Holes, noisy planes, spikes in the mesh | Avoid direct glare, add obliques, accept limits |
| Lens distortion not modelled (Neo 2) | Bending building edges | `--camera-lens brown` / OPENCV model; do not crop-correct |
| No scale reference | Wrong measurements, dashboard sizes off | Scale bar or 3–4 GCPs (section 7) |
| Too few images per feature | Splat floaters / fog, sparse cloud | More frames from more angles; 10–15° yaw steps |

Splat-specific floaters and fog are cleaned with the Splat Lab auto-clean (see
[Splat Lab v2 plan](SPLATLAB_V2_PLAN.md)), but capture is always cheaper than repair.

## 11. One-page printable checklist

```
AEROBRAIN — CAPTURE CHECKLIST  (Flip / Neo 2, manual flight)          Date ____  Site ________

BEFORE
[ ] Wind < 8 m/s   [ ] Sun/overcast stable   [ ] Legal & safe area   [ ] 2 batteries, SD cleared
[ ] STILLS, Timed Shot 2-3 s   [ ] JPEG (Neo 2: JPEG only)   [ ] Full resolution
[ ] Manual: shutter >= 1/500, ISO <= 800, EV by histogram
[ ] WB locked (fixed K)   [ ] Focus locked   [ ] No crop/filters
[ ] Targets/scale bar placed (3-4 GCPs or 1-2 m bar), coordinates measured & noted

FLY
[ ] 1 NADIR lawnmower  40-60 m, gimbal -90, overlap >= 80 fwd / 70 side
[ ] 2 RING A  1/3 height   gimbal -25   10-20 m standoff   yaw step 10-15
[ ] 3 RING B  2/3 height   gimbal -45   same
[ ] 4 RING C  roof + 5 m   gimbal -60   same
[ ] 5 FACADE strips at 0 deg (only if safe & legal)
[ ] 6 A few wide context frames   [ ] Video variant for splats: 1-2 m/s, fixed shutter

AFTER (on site)
[ ] 150-300 photos   [ ] 10 frames at 100% are sharp   [ ] Histogram OK / consistent
[ ] Each wall has >= 3 oblique frames   [ ] Each target in >= 5 frames
[ ] Don't rename or edit photos   [ ] Upload by pass, note settings + wind

NEO 2 -> ODM --camera-lens brown        NO SCALE REF -> approximate measurements only
```
