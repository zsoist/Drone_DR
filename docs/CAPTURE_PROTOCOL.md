# Capture protocol: DJI Flip and DJI Neo 2 (manual flights)

This is workstream W6 of the [World upgrade plan](WORLD_UPGRADE_PLAN.md). The quality of the input has the largest effect on
every result that follows (ODM mesh, splats, Blender scene). Neither drone has waypoint missions or MSDK
support. The pilot controls the overlap, the altitude and the gimbal angle. This page is the field recipe.

Legend: **[V]** means specific to this protocol and to the AeroBrain pipeline. **[G]** means a general practice of photogrammetry,
**not checked on these specific drones**. Compare the first flight with the post-flight checks below.

## 1. Choose the mode first

| Goal | Capture | Why |
|---|---|---|
| Mesh, orthophoto, DSM, measurements | **Stills** (Timed Shot) | Sharp, rich EXIF, no compression smear, native to ODM |
| Gaussian splat / visual walkthrough | Slow **video**, frames extracted | Denser, continuous coverage. Frame selection handles the blur |
| Both | Stills for the mesh, then one extra slow video orbit | Two datasets, separate scenes |

## 2. Pre-flight settings
<!-- ste:procedural -->

> **WARNING:** Do not fly over people. A drone that falls can cause serious injury.

> **WARNING:** Keep the drone in visual line of sight (VLOS) for the whole flight. The drone can hit a person or an object that you do not see.

> **WARNING:** Do not fly in airspace where the local rules for drones do not allow it. The drone can cause a collision with an aircraft or hurt a person.

> **WARNING:** Do not fly when the wind is above about 8 m/s. Strong wind can push the drone into a person, a building or a tree.

> **WARNING:** Do not fly with a damaged battery. A damaged battery can catch fire in the air or on the ground.

> **CAUTION:** Do not take off before the drone has a good GPS position. Without it, the drone can drift and hit an object.

> **CAUTION:** Do not clear the SD card before you copy the photos of the last flight. You lose the data.

- Set **Stills, Timed Shot (interval) 2–3 s** [V]. At about 5 m/s, a 2 s interval gives a photo about every 10 m.
  At 3 s, slow down to 3 m/s or less. Forward overlap is what matters (see section 4).
- Set **manual exposure** [G]. Use a shutter of **1/500 s** or faster (1/800 s or faster in wind or on orbits).
  Set the ISO as low as the shutter allows. Cap it at about 800, because noise is worse than a slightly dark image.
  Set the EV with the histogram, not by eye.
- **Lock** the white balance, the focus and the exposure [G]. Set the white balance to a fixed Kelvin value:
  5200–5600 K in sun, and the preset "cloudy" under overcast. Lock the focus at infinity (or tap-locked far).
  Auto exposure between shots creates steps of brightness. These steps make the match of features and the blend of textures worse.
- Use JPEG on the DJI Flip. If the model offers RAW, you can use RAW [G]. **The DJI Neo 2 gives JPEG only** [V]. Do not plan on RAW.
- Process the Neo 2 images with ODM `--camera-lens brown` (COLMAP: `OPENCV` camera model) [V].
  The Neo 2 has a wide lens (about 120°) with strong distortion. If an app can "crop / correct" distortion
  before export, turn that function off. Keep one camera model for each dataset. Do not mix drones or zoom levels.
- Set the full sensor resolution. If the drone offers 4:3, use it [G]. It gives more vertical coverage.
- For the video variant, set 4K/30. Set a fixed shutter of `1/(2×fps)` or faster (1/120 s is ideal).
  If you can, turn off the crop of the digital stabilisation [G]. A warped image breaks the pinhole model.
  Use the normal color profile [G]. If you do not grade the video, do not use D-Log.
- Clean the lens [G].
- Charge 2 batteries [G].
- Clear the SD card [G].
- Set the date and the clock correctly [G]. The EXIF time sets the order of the photos.
- Check the wind [G]. If it is above about 8 m/s, do not capture. The drone crabs (it points into the wind and
  moves sideways), and the shutter does not fix this.
- Fly in overcast light, or with the sun high and behind you [G]. Avoid long shadows that move during the flight.
  Avoid passes that mix sun and shade. If you can, avoid glass, water and shiny roofs.
- Follow the local rules for drones (VLOS, height limits, people, RPAS rules of the country).
  Fly a 0° facade pass and low orbits only in safe open areas. Fly the small Neo 2 only in safe open areas.

## 3. Flight patterns: one building (150–300 photos) [V]
<!-- ste:procedural -->

> **WARNING:** Keep the 10–20 m standoff from the wall. A drone that is nearer can hit the wall, glass, a wire or a tree.

> **WARNING:** Do not continue a pass when the GPS signal is weak or lost. The drone can drift into a wall, a tree or a person.

> **CAUTION:** Do not continue a pass when the battery level is low. The drone can land by itself in an unsafe place or fall.

Do the passes in this order. Keep the same camera settings for all passes.

> **WARNING:** Do not put a hot battery in the charger. A battery that charges while hot can catch fire.

If you must swap the battery, land the drone between passes 1 and 2. Then swap the battery.

1. Fly the **nadir lawnmower** at 40–60 m AGL with the gimbal at **−90°**. Fly straight parallel lines across the site.
   Add one building-width beyond each edge. Use a forward overlap of at least 80 % and a side overlap of at least 70 %
   (see section 4). Expect about 60–120 photos.

> **WARNING:** Fly a low orbit only in a safe open area. The drone can hit people, trees and wires.

2. Fly **oblique orbits, 3 rings**. Point the camera always at the center of the building. Keep a standoff of 10–20 m
   from the wall. If the roof is high, or if trees or lines are near, use a larger standoff.
   - Fly ring A at a height of about 1/3 of the building height, with the gimbal at about **−25°**.
   - Fly ring B at a height of about 2/3 of the building height, with the gimbal at about **−45°**.
   - Fly ring C at the roof height plus 5 m, with the gimbal at about **−60°**.

   Shoot every **10–15° of yaw** (24–36 photos per ring). Fly the ring slowly. If Timed Shot smears the photos,
   use stop-and-shoot. The cause of orbit blur is the yaw rate, not the speed. Close each ring with an overlap on the first frames.

> **WARNING:** Fly the 0° facade pass only where it is safe and legal. The drone can hit people, glass, wires or trees.

3. Fly **facade strips at 0°** (gimbal level) only where it is safe and legal. Fly a horizontal line parallel to the
   wall at the same 10–20 m standoff. Fly the drone sideways. Shoot every about 2 s. Fly one strip for each floor band.
   If the drone is near people, glass, wires or trees, skip the strip.
4. Take 5–10 wide frames from a higher position (overshoot). The frames show the building in context.
   They help the scale of the whole block and the orientation.

<!-- ste:descriptive -->
Notes [G]: One ring does not give walls. Corners, eaves and balconies need the oblique rings.
Use a different height for each ring. Do not take all shots at one altitude. This improves the camera calibration and
prevents doming.

## 4. Overlap arithmetic

The ground footprint (nadir) is about `2·H·tan(FOV/2)` [G]. For a flight at 40–60 m and an effective FOV of about 80°, the
footprint is about 70–100 m wide. A distance of about 15–20 m between photos along the line gives 80 % overlap.
With a 2 s interval, this means 7–10 m/s or less, but only in theory.

In practice, fly at **4–5 m/s or less**. This keeps blur and rolling shutter low. A distance of about 25–30 m
between lines gives 70 % overlap. Adjust the values after the first flight (section 9). Do not trust the sums.

## 5. Open land / terrain variant
<!-- ste:procedural -->

> **WARNING:** Do not fly above the height limit of the local rules for drones. The drone can collide with an aircraft.

> **CAUTION:** Do not fly toward higher ground without a check of the clearance. The drone cannot follow the terrain, so it can hit the slope or a tree.

- Fly a nadir lawnmower only, with the gimbal at −90° [V]. Fly at 60–100 m AGL (or the legal ceiling).
  Use a forward overlap of at least 80 % and a side overlap of at least 70 %.
- If slopes or vegetation are present, fly a **second** grid that crosses the first grid [G].
  Rotate the grid by 90°. Use a different height (20 m above or below the first height).
  This is the cheapest fix for doming and holes in vegetation.
- If you want slopes or walls that hold back earth, add one gentle 30° oblique pass along each edge [G].
- Avoid vegetation, water, bare uniform sand and snow [G]. They do not reconstruct well. Prefer overcast. Avoid wind.
- Pick one AGL at the highest point of the flight area [G]. The drone cannot follow the terrain.
  Keep the height of the home point in mind. The DJI Flip and the DJI Neo 2 report the height above take-off.
- Plan for 300–600 photos per 5–10 ha [G]. This is a typical order of magnitude.
  Do not go above what the RTX 4060 Ti lane can process (see [Splat pipeline](SPLAT_PIPELINE.md) and [Operations](OPERATIONS.md)).

## 6. Video for splats [V]
<!-- ste:procedural -->

> **WARNING:** Do not fly the loop at head height near people. The drone can hit and injure a person.

- Fly at **1–2 m/s** with a smooth yaw. Do not make whip pans or sudden altitude changes.
- Set a **fixed shutter** (1/120 s or faster for 4K/30). Lock the white balance and the exposure. Do not use auto-zoom.
- Use the same three-ring orbit plan as in section 3, plus the nadir pass.
  If the subject is compact, add an extra loop at head height around it. End where you started, to close the loop.
- Let AeroBrain select the frames. The extraction is offline, not in the drone.
  AeroBrain picks frames by **sharpness** and by the gap between frames (`pipeline/capture_quality.py` `choose_frames`, `pipeline/odm_prep.py`).
  It drops the blurriest frames (the thresholds are in the code profiles). Hand-pick frames only if you must.

Frames from video have smear from compression and have no lens EXIF. Expect a lower metric quality than from stills.
Splats do not need scale. Keep the flight steady. Prefer more coverage over precision.

## 7. Scale and georeferencing (3–4 GCPs or a scale bar)
<!-- ste:procedural -->

The drones do not give survey-grade GPS. For true scale or position, use one of these methods:

**A. Scale bar (fastest, scale only).**
- Place a rigid object of known length flat near the building. Make sure the object is visible in the nadir frames.
- Use a 2 m rule that folds. Or use two targets that you measure with a tape (to within 2 mm).
- Write down the length. Place two bars in different places if the site is large.

**B. 3–4 GCPs (scale + georeference).** [G]
1. Mark 3–4 targets (A3 checkerboard or painted cross) around the edges of the site. Do not put them in a line.
   If possible, put them at different heights. Make each target visible in several photos from different passes.
2. Measure the coordinates of each target with an external GNSS. Use a phone RTK receiver, a survey rover,
   or at least a phone with a stated accuracy. Write down the EPSG code, X/Y/Z and accuracy.
   If you have no external measurement, use only a measured distance (option A).
3. Photograph each target in at least 5 frames (more if possible) at nadir and oblique.

> **CAUTION:** Do not rename the photos or change the file list after capture [V]. A new name breaks the tie between `gcp_list.txt` and the image set.

ODM needs a `gcp_list.txt` next to the images, or you pass it with `--gcp`:

```
EPSG:32618
<x> <y> <z> <im_x> <im_y> <image_name> [gcp_name]
```

Each line is one observation of a target in an image. The first line is the coordinate system.
Each other line has the world coordinates X, Y and Z, then the pixel position in that image, then the file name.

- Use at least 3 targets and at least 3 images for each target [G].
- Record the pixel positions with the GCP editor of ODM or with any tool that tags images.
- Keep the CSV file of the world coordinates next to the dataset. Then you can tag the images again.
- For splat scenes, register the scene with the alignment helper (`model_aligner` step). Use the same target coordinates.

If you captured no GCP and no scale bar, the model has an arbitrary scale. Then the AeroBrain measurements
are approximate. Do not claim survey accuracy.

## 8. Flight records
<!-- ste:procedural -->

> **CAUTION:** Do not delete or edit photos on the card. The pipeline selects the photos and needs the original files.

- Log the date, site, drone, battery, settings (shutter, ISO, WB, interval), wind and sun.
  Two lines in the note field of the upload are enough.
- Put the photos of each pass in one folder (`nadir`, `ringA`, `ringB`, `ringC`, `facade`, `video`) [V]. Upload all folders as one scene.
- Do not use the crop, beauty or filter modes of the app.
- Ingest the files through the SD-card flow (video + SRT). Or use the `Fotos · malla 3D` mode (photos and 3D mesh)
  of the direct upload (JPG/DNG). Drop the whole folder. Each subfolder becomes a pass under `raw/<set>/<pass>/`.
  Note: a set of stills only does not yet feed ODM from the 3D page. The job still starts from a video clip.
  That link is pending.

## 9. Post-flight quick checks (5 minutes, on site)
<!-- ste:procedural -->

> **WARNING:** Do not check the photos while the drone is in the air. You can lose sight of the drone, and it can hit a person.

1. **Count** the photos. One building needs 150–300 photos. If the count is below 120, fly another ring.
2. **Scroll** through the nadir pass. Consecutive frames must share at least 80 % of the content.
   If frames skip a part of the site, fly the pass again.
3. **Zoom** to 100 % on 10 random frames. Text on signs and the edges of roof tiles must be crisp.
   If 3 of 10 are soft, use a faster shutter or fly slower. Then fly the ring again.
4. Check the **histogram**. Light roofs must show no clipped highlights. Dark areas must keep their detail.
   The brightness must look consistent from frame to frame.
5. Check the **coverage of the walls**. Each facade needs at least 3 oblique frames from different angles.
6. Check the **targets**. Each GCP and each scale bar must be visible in at least 5 frames. Write down the coordinates.
7. Check the **EXIF**. Each frame must open with a GPS position and the same camera model.

## 10. Common failures, symptoms in AeroBrain and fixes

| Failure | Symptom in AeroBrain | Fix in the field / next flight |
|---|---|---|
| Not enough overlap / gaps | Holes in the mesh, missing roof patches, ODM drops images | Overlap of at least 80 / 70 %, fly a second grid |
| Only nadir, no obliques | Smeared walls, roof-only model, empty facades | Add the three oblique rings |
| Single altitude, wide lens not calibrated | **Doming / bowl**: flat ground is curved | Add a crossing grid at other height, at least 3 GCPs, `--camera-lens brown` for Neo 2 |
| Motion blur (slow shutter, orbit yaw) | Soft textures, noisy low-poly walls, blurry splat | Shutter 1/500 s or faster, slow down, stop-and-shoot on orbits |
| Auto exposure / auto WB | Visible brightness patches in the texture, seams | Lock exposure and WB |
| Moving objects (people, cars, trees in wind) | **Floaters**, ghost cars, fuzzy vegetation | Shoot fast, avoid people. Remove them in Splat Lab, or mask if needed |
| Sun/shadow change during the flight | Shadow ghosting, lighting mismatch between sides | Shoot in overcast light or in a short time window |
| Glass, water, shiny roof, uniform surface | Holes, noisy planes, spikes in the mesh | Avoid direct glare, add obliques, accept the limits |
| Lens distortion not modelled (Neo 2) | Bent building edges | Use `--camera-lens brown` / OPENCV model. Do not crop-correct |
| No scale reference | Wrong measurements, wrong sizes on the dashboard | Scale bar or 3–4 GCPs (section 7) |
| Too few images per feature | Splat floaters / fog, sparse cloud | More frames from more angles. Yaw steps of 10–15° |

The Splat Lab auto-clean removes splat floaters and fog (see
[Splat Lab v2 plan](SPLATLAB_V2_PLAN.md)). But capture is always cheaper than repair.

## 11. One-page printable checklist

Read the WARNING and CAUTION notes in sections 2, 3, 5, 6, 7, 8 and 9 before each flight. Then use this checklist.

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
