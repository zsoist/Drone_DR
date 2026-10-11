# Home V2 — Design QA

- Source visual truth: `/var/folders/fd/r0q1r2614bq9tvzckhxdrzl00000gn/T/TemporaryItems/NSIRD_screencaptureui_Kv2Ky2/Screenshot 2026-07-15 at 11.31.28 AM.png`
- Rendered implementation: `docs/qa/home-v2-default-revised2.png`
- Combined comparison: `docs/qa/home-v2-comparison.png`
- Responsive evidence: `docs/qa/home-v2-iphone.png`, `docs/qa/home-v2-tablet.png`
- Transition evidence: `docs/qa/home-v2-void.png`
- Production URL: `https://vuelos.metislab.work/home.html`
- Viewports: 1280×720 desktop, 820×1180 tablet, 390×844 iPhone
- State: dark theme, live production data, public jobs response, a real GLB drone is loaded

## Full-view comparison evidence

The combined comparison keeps these features of the source:

- The Instrument Graphite shell.
- The identity of the cosmic Flight Deck.
- The module imagery that comes from data.
- The blue and mint hierarchy.
- The complete navigation model.

Home V2 intentionally puts the approved cinematic hero above the module grid. Immediately after the hero, all seven modules stay in place. Full-card anchors link to them.

## Focused comparison evidence

The iPhone capture shows these items:

- The hero and both primary controls.
- The complete five-cell telemetry.
- The real drone model.
- The bottom navigation and the safe-area gaps.
- No horizontal overflow.

The tablet run shows a two-column 388 px module grid. The void capture shows the single-canvas star transition. It does not show a build-up of DOM particles.

## Findings

- No actionable P0, P1, or P2 findings remain.
- Typography: the SF/Inter stack, the headline scale, the monospace telemetry, the line breaks, and the optical hierarchy are coherent at all tested widths.
- Layout and gaps: the runs at 1280, 820, and 390 px report `scrollWidth === clientWidth`. The card grids resolve to four, two, and one columns as designed. The mobile CTAs stay 44 px high.
- Colors and tokens: the graphite, accent blue, mint, amber, and semantic data states are the same as before. Gradients and bloom stay subordinate to content contrast.
- Image quality: the page uses the pixel hero, the live flight thumbs, the icon library, the `ovi-drone.png` fallback, and the real `drone.glb`. All of them are old assets of the product. The change adds no placeholder art and no handcrafted replacement art.
- Copy and content: the page keeps the seven product routes of the product. Telemetry comes from live manifests. Unavailable values show `Sin datos` (Spanish for "no data") and not invented zeros.
- Accessibility: the page has semantic links and regions, alt text, visible focus rules, reduced-motion fallbacks, safe touch targets, and a bounded navigation delay.

## Comparison history

1. The first pass on production found gzip responses that were immutable and stale. It also found an oversized GLB that the right edge cropped at 1280 px.
2. The fix regenerated the sidecars and advanced the immutable asset versions. It reduced the model normalization scale and shifted the rig toward its visual center. It also reduced the height of the desktop hero for better information density.
3. The post-fix production evidence shows these results:
   - Seven cards and five telemetry cells.
   - The GLB canvas is active.
   - No broken images.
   - No application console errors.
   - Zero horizontal overflow at 1280, 820, and 390 px.

   The test harness in the in-app browser emits its own isolated warning about a second instance of Three.js v205. In the production module graph of AeroBrain, the GLB loader and the other modules both resolve the single v209 graph.

## Primary interactions tested

- The navigation from the full card `Viajes` completed through the cinematic transition.
- `3D` navigation created exactly one `canvas.hv2-void` and completed within the 620 ms ceiling.
- All seven module links (hrefs) matched the routes of the product.
- The production loads on desktop, tablet, and iPhone gave seven cards and five telemetry cells.

## Follow-up polish

- P3: the immersive hero intentionally places the first module card below the 720 px desktop fold. This is the approved cinematic-hybrid tradeoff. The sidebar and the hero CTAs give immediate access to tasks.

final result: passed
