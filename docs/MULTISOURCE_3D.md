# Multi-source 3D and incremental scenes — status (2026-07-14)

## Tested by experiment ✅
- **Fusion works** with compatible sources. Test 0103+0104 (aerial+aerial, same session, 31m,
  similar height) gave **169/169 (100%), 1 component, 17,006 cross-source matches, 2/2 sources**.
- **Fusion fails in a predictable way** with incompatible sources. Test 0106 (1m ground) +0101 (90m aerial)
  gave 0 matches, and the system dropped 0106 (0/7). The total of 82% was a FALSE pass.
  Diagnosis: 0 common features (geometry). The cause was not the config or bad frames
  (538 features/img in both).
- **The discriminant is view compatibility (height and angle)**, NOT the takeoff point.
- **video+PHOTO PASSES** (test #3): 0103 aerial + 3 photos of 0104 (same session, known-compatible source)
  gave 61/61, **3/3 photos co-registered, 24,152 photo↔video matches**. The photos are
  stills from the drone (foto4k). They inherit the GPS from the track of the parent clip.

## TESTED range (an honest map of what I know)
- Tested and PASSES: same session, at most 31m between centers, altitude overlap of at least 100m, same drone and camera.
- Outside that range there is NO data. I do not know the limit (150m? 4h of difference? partial overlap of height?).
- NOT tested: photos from ANOTHER camera (phone). It is a different axis (camera profile) and it needs its own cell.

## Shipped
- odm_prep multi-source (--sources/--photos, one prefix for each source, geotag by track, atomic swap).
- `worker.odm_registration` evaluates all components. It chooses the best
  shared component and reports `submitted/registered/ratio` for each prefix. A source counts only if
  it has at least 5 cameras and a ratio of at least 0.6 inside that same component.
- Gate: if the result is partial_merge, the system does not auto-enqueue a phased splat. The model always survives (a label, not a hard fail).
- UI: modal `Estudio 3D` (multi-select by place, photos, preset, phased). The predictive score is REMOVED.
  The UI now gives real compatibility warnings (ground+aerial, cross-session, different heights).
- Regression fixture for the geotag path (the bug that bit me).
- A stable `reconstruction` entity (`recon_<hash>` from the sources and photos) and a `scene_<hash>` entity
  with its own manifest. A scene keeps the inventory, the immutable history of versions, and
  one active version that a person promoted explicitly.
- The action `Mejorar esta escena` ("Improve this scene") creates another reconstruction with new captures or photos. It does not overwrite the
  active one. The system cannot promote a `PARTIAL` version or a version without the artifacts that it needs. GPS
  closeness is only a suggestion. `FULL/PARTIAL` depends on the real registration of each source.
- The system promotes the first valid version (`FULL` or `SINGLE`) automatically. It keeps the next
  versions as candidates until a person promotes one, with QA, requested and effective quality, and splat.
- Schema 2 keeps `source_evidence` for each video: measured altitude, bbox and date, number of tries,
  submitted/registered/ratio, and a state of `integrated|eligible|duplicate|insufficient_overlap|registration_failed`.
  A failure does not delete the source. A new measurement does not overwrite the registration verdict.
- `scene.v2.json` and `site.lod.json` publish five diameters of coverage (100/200/400/600/1000 m)
  as a circle and as a square. They are extensions of the product, not altitude bands. `ready` needs
  the real DSM to cover the diameter. Today the site 0117 passes 100/200/400 m and marks 600/1000 as not done.
- Mundo loads one island for each `scene_id` (the active version). The system still tracks the old versions,
  but they do not appear as duplicate places. Volar applies the requested metric limit.

## Cumulative milestone closed (2026-07-14)

0. **OpenSfM recovery, dense publication, and browser QA approved.**

   The first run of
   `recon_60b23208db` ended with `rc=139` and no OOM when it tried to merge three components with repeated IDs.
   The recovery `3d-1784034358954095000-b1152f` kept exactly 1,019 images,
   1,019 features, 1,019 matches, and 282,878,995 bytes of tracks. It archived only the truncated JSON and
   reconstructed with `--sfm-no-partial`. It did not delete caches.

   The new saved JSON (322,283,220 bytes,
   SHA-256 `0f89170ee32399e6689aa8486ed5fe4736ca9e2c70e3f775b8f5d605d68b9f44`) passed the logic of
   `worker.odm_registration`:
   - 2 components.
   - Selected component 0, with 996/1,019 cameras, 951,994 points, and 10/10 sources merged.
   - Component 1, with 16 cameras and 13,562 points from `s9` only.
   - 1,012 unique cameras in total, and zero repeated IDs between components.

   Evidence for each source of the selected component: `s0=238/238`, `s1=21/28`, `s2=29/29`, `s3=127/127`, `s4=108/108`,
   `s5=41/41`, `s6=116/116`, `s7=214/214`, `s8=30/30`, `s9=72/88`. The result was `FULL`.
   The immutable event `odm_final_shared_component_audited` and the copy under
   `ops/evidence/3d-1784034358954095000-b1152f/opensfm/` keep the proof. The shared gate
   passed.

   OpenMVS merged 993 depthmaps and produced 46,731,480 dense points. The visibility filter
   wrote artifacts that were valid before an `rc=139` after the write, with no OOM:
   - `scene_dense_dense_filtered.ply` (37,473,907 vertices, 1,049,269,665 bytes).
   - `scene_dense_dense_filtered.mvs` (2,423,785,757 bytes, magic `MVSI`).

   The immutable event `odm_filter_postwrite_segfault_classified` marks that crash as different from an OOM.

   The strict recovery run `3d-1784044407571700000-efa0fa` checked the size and count of the PLY and the magic
   of the MVS before it resumed from `odm_filterpoints`. Its statistical filter ended with 37,386,157
   points in 124.7 s. The final package published an ortho, DSM, and DTM of 30,539×33,664, a point cloud of 795,450
   points, and a mesh of 744,416 vertices. The browser QA passed, and so did all the assets that the package needs.
   A person promoted `recon_60b23208db` explicitly in `scene_64f22e89f2`. Then the event
   `odm_publish_browser_qa_completed` (immutable) opened the splat gate.

   Later, Frontier 30K ended on that same version on CUDA FULL `d1`: 3,236,419 gaussians, peak 7,755 MiB, SOG of 37,083,215 bytes,
   publication, and browser QA. Later, Grandmaster 40K ended on the same version, also on CUDA
   FULL `d1`, in a single try:
   - 3,067,353 source gaussians.
   - 2,881,394 gaussians published after de-halo.
   - Peak 7,730 MiB.
   - SOG of 34,903,178 bytes.
   - Publication and browser QA.

   There was no OOM, no retry, and no fallback to the Mac. `audit_splats.py` ended with 0 failures. The share/workspace/jobs matrix passed on mobile,
   iPad, and desktop.

   This document records only closed milestones. The stage in progress, the memory, and the measured progress
   are in the `Trabajos` section of the `3D` page and in the append-only events. This keeps short-lived telemetry out of
   the contract documentation.

   `odm-reconstruct` shows the count and the measured rate in cameras/min, but it does not invent an ETA to 1,019.
   OpenSfM can end validly with fewer registered cameras than submitted cameras. In the depth stage,
   the UI shows `Estimated`, `Filtered`, and `Fused depth-maps` separately and uses the native ETA of OpenMVS. It does not count
   `.dmap` files, because each sub-stage writes the variants again and that total counts the views too many times.
   The later filter keeps the real dense total and shows `Point visibility checks` in points,
   with the native ETA, as a different sub-stage.

## Pending (honest: NOT tested / deferred)

1. ~~video+photo e2e~~ ✅ DONE (test #3, 3/3 photos, 24k matches). Still to do: photos from a phone (another camera).
2. **Global frame budget and INTRA-source dedup**: today the cut works for each source. NOTE (result of
   the review): do NOT deduplicate cross-source. Those near-duplicates are the glue of the co-registration.
   Cap MAX_IMAGES + a floor for each source (at least 20).
3. **Suggestion by compatibility**: calibrate the limit with more pairs. The UI already sorts by
   geographic center and shows distance and height, but it does not promise compatibility.
4. **Disk preflight** before the system enqueues a heavy multi-source job.
