# Legacy Mac trainer (OpenSplat / MPS)

> **Legacy.** Since 2026-09-28 the default compute policy is PC-only (`pipeline/compute_policy.py`):
> all ODM and all splat training run on the RTX PC. Everything below only applies when the worker
> is started with `AEROBRAIN_COMPUTE=local`, and the local OpenSplat build is currently broken.
> Current behaviour: [ARCHITECTURE.md](../ARCHITECTURE.md), [SPLAT_PIPELINE.md](../SPLAT_PIPELINE.md).
> Moved out of `CLAUDE.md` on 2026-09-28.

## Build state

- The local build `splat/OpenSplat/build-mps/opensplat` links opencv `.413` dylibs, but Homebrew now
  ships opencv 5, so it does not start. It would need a rebuild
  (`pipeline/archive/build_opensplat_mps.sh`) before `AEROBRAIN_COMPUTE=local` splats could work.
- The weekly canary (`pipeline/archive/canary_splat.py`, LaunchAgent archived) was retired for the same reason.
- `xcodebuild -downloadComponent MetalToolchain` runs as a normal user (no sudo), about 688 MB. Launch it
  in the background and let it finish; do not cancel because it looks slow.
- MobileAsset gotcha: `xcodebuild -downloadComponent` can fetch a STALE asset from an older Xcode
  (finishes and stays `Status: uninstalled` with no error). Retrying the same command brings the right version.

## Rules learned on the MPS trainer

- Post-patch gate (P0, 11 Jul): after ANY rebuild/patch of OpenSplat, run a known cinematic
  (`proj_...133809_0101_D`) BEFORE declaring the binary good. "Additive by diff intent" is not evidence;
  a fast run is not enough (minimal densification does not expose per-gaussian overhead).
- The trainer is always invoked with an explicit minimal env (`splat_eval._minimal_env`); the Claude Code
  shell carries `MallocNanoZone=0` and `nohup` children inherit it.
- `ps` RSS underestimates MPS/Metal processes about 20x (RSS 489 MiB vs phys_footprint 10 GB on the same
  opensplat). Use `footprint -f bytes <pid>` (phys_footprint_peak is what `taskpolicy -m` enforces).
- `taskpolicy -m <caps.opensplat_mib>` gives a hard RSS cap (SIGKILL on excess), value in
  `config/hardware.json` (11000 MiB, calibrated for 16 GB).
- `image_list.txt` from OpenSfM carries container paths; the worker rewrites `/datasets/code` to the host project path.
- The Fast/Medium local ODM caps (7g x4 / 8500m x2) and the adaptive priority (ODM 10 to 7 cores, OpenSplat
  to background while a viewer streams, restored after 45 s) also belong to this path. Under PC-only there is no
  heavy local compute to yield.
- Historic OrbStack note: with the VM at 3.9 GB, local ODM hit OOM 137 in mvs_texturing.

Full MPS detail (invocation, memory ladder, SH degree workaround): the "Legacy Mac path" appendix of
[SPLAT_PIPELINE.md](../SPLAT_PIPELINE.md#legacy-mac-path-opensplat--mps).
