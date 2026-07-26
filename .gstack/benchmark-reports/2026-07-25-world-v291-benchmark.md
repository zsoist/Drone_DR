# World v291 to v305 Performance Benchmark

Branch: `codex/scene-ops-stability`

Release base: `8f98c907`

Target: local production process at `http://127.0.0.1:8790`

Measured: 2026-07-26 with a cold gstack Chromium navigation and network idle

## Comparable before/after

| Page | Metric | v291 | v305 | Delta |
|------|--------|-----:|-----:|------:|
| Mundo | FCP | 72 ms | 60 ms | -16.7% |
| Mundo | Requests | 26 | 19 | -26.9% |
| Mundo | Transfer | 6.57 MB | 2.82 MB | -57.1% |
| Volar, exact v291 scene | FCP | 84 ms | 124 ms | +40 ms |
| Volar, exact v291 scene | Load | n/a | 77 ms | informational |
| Volar, exact v291 scene | Requests | 124 | 47 | -62.1% |
| Volar, exact v291 scene | Transfer | 32.83 MB | 12.77 MB | -61.1% |
| Volar, exact v291 scene | OBJ requests | 1 | 0 | -100% |

The exact comparison scene is
`DJI_20260706133809_0101_D`. The 40 ms FCP movement remains below the
500 ms absolute regression threshold and the page completes load in 77 ms.
The deterministic payload indicators improved materially: 77 fewer requests,
20.06 MB less transfer and no inactive OBJ request.

## Active release scene

The release gates use `recon_c97cd120a1`:

| Metric | v305 |
|--------|-----:|
| FCP | 144 ms |
| Load | 89 ms |
| Requests | 46 |
| Transfer | 9.89 MB |
| JS transfer | 915,673 bytes |
| CSS transfer | 75,851 bytes |
| OBJ requests | 0 |
| Authoritative GPU matrix | 60 fps on all five profiles |

## Runtime budgets

- Every-map sweep: 9/9 worlds at 60 fps.
- Invasion: 60 fps with eight GLB enemies and all device caps respected.
- Collision stress: 100/100 at 60 fps.
- Touch/desktop matrix: 5/5 profiles at 60 fps.
- Collision fixture: 10,000 queries in 8.9 ms.
- VFX renderer memory: 2/0 geometry/textures baseline, 150/5 persistent,
  428/5 peak, 150/5 settled, 2/0 teardown.

## Verdict

No performance regression blocks v305. The branch removes the two largest v291
startup costs: the nine-card eager image burst and the inactive photogrammetry
mesh. The remaining payload is active gameplay data, while runtime stays at the
60 fps measurement ceiling on every supported device profile.
