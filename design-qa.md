# Home V2 — Design QA

- Source visual truth: `/var/folders/fd/r0q1r2614bq9tvzckhxdrzl00000gn/T/TemporaryItems/NSIRD_screencaptureui_Kv2Ky2/Screenshot 2026-07-15 at 11.31.28 AM.png`
- Rendered implementation: `artifacts/home-v2-default-revised2.png`
- Combined comparison: `artifacts/home-v2-comparison.png`
- Responsive evidence: `artifacts/home-v2-iphone.png`, `artifacts/home-v2-tablet.png`
- Transition evidence: `artifacts/home-v2-void.png`
- Production URL: `https://vuelos.metislab.work/home.html`
- Viewports: 1280×720 desktop, 820×1180 tablet, 390×844 iPhone
- State: dark theme, live production data, public jobs response, real GLB drone loaded

## Full-view comparison evidence

The combined comparison preserves the source's Instrument Graphite shell, cosmic Flight Deck identity, data-backed module imagery, blue/mint hierarchy, and complete navigation model. Home V2 intentionally promotes the approved cinematic hero above the module grid; all seven modules remain present immediately after the hero and are reachable from full-card anchors.

## Focused comparison evidence

The iPhone capture verifies the hero, both primary controls, complete five-cell telemetry, real drone model, bottom navigation, safe-area spacing, and absence of horizontal overflow. The tablet run verifies a two-column 388 px module grid. The void capture verifies the single-canvas star transition rather than DOM particle accumulation.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Typography: the existing SF/Inter stack, display scale, monospace telemetry, wrapping, and optical hierarchy remain coherent at all tested widths.
- Spacing and layout: 1280, 820, and 390 px runs report `scrollWidth === clientWidth`; card grids resolve to four/two/one columns as designed; mobile CTAs remain 44 px high.
- Colors and tokens: existing graphite, accent blue, mint, amber, and semantic data states are retained. Gradients and bloom stay subordinate to content contrast.
- Image quality: the existing pixel hero, live flight thumbs, icon library, `ovi-drone.png` fallback, and real `drone.glb` are used. No placeholder or handcrafted replacement art was introduced.
- Copy and content: seven existing product routes are preserved; telemetry comes from live manifests and unavailable values show `Sin datos` instead of invented zeros.
- Accessibility: semantic links/regions, alt text, visible focus rules, reduced-motion fallbacks, safe touch targets, and bounded navigation delay are present.

## Comparison history

1. Initial production pass found stale immutable gzip responses and an oversized right-cropped GLB at 1280 px.
2. Regenerated sidecars, advanced immutable asset versions, reduced the model normalization scale, shifted the rig toward its visual center, and reduced desktop hero height for better information density.
3. Post-fix production evidence shows seven cards, five telemetry cells, the GLB canvas active, no broken images, no console errors/warnings, and zero horizontal overflow at 1280, 820, and 390 px.

## Primary interactions tested

- Full-card `Viajes` navigation completed through the cinematic transition.
- `3D` navigation created exactly one `canvas.hv2-void` and completed within the 620 ms ceiling.
- All seven module hrefs were reconciled against the existing routes.
- Desktop, tablet, and iPhone production loads returned seven cards and five telemetry cells.

## Follow-up polish

- P3: the immersive hero intentionally places the first module card below the 720 px desktop fold. This is the approved cinematic-hybrid tradeoff; the sidebar and hero CTAs preserve immediate task access.

final result: passed
