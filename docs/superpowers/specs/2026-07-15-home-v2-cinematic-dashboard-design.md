# AeroBrain Home V2, Cinematic Flight Deck

**Date:** 2026-07-15  
**Status:** Approved design direction  
**Reference:** User screenshot `Screenshot 2026-07-15 at 11.31.28 AM.png`  
**Existing system:** Instrument Graphite, `web/home.html`, `web/home.js`, `web/style.css`, `web/shell.js`

## Outcome

Home becomes the premium command deck for AeroBrain. It keeps the recognizable cosmic Flight Deck identity, but replaces the accumulated demo-like effects with a coherent cinematic system: a real interactive drone, truthful live data, complete module cards, fast loading, and an AAA-style star-void transition when a destination opens.

The page must feel playful without making navigation slower or less reliable. Content and links are usable before WebGL or decorative motion starts.

## Chosen direction

Use a progressive cinematic hybrid:

- Keep `assets/hero-pixel.webp` as the established visual world and art direction.
- Replace the 2D `ovi-drone.png` hero and superimposed SVG propellers with the existing real `assets/drone.glb` model.
- Restrict WebGL to the hero drone. Cards and navigation remain semantic HTML.
- Use one shared canvas effect controller for stars, hover energy and the click void. Never create a separate animation loop per card.
- Preserve Instrument Graphite typography, spacing, colors, hairlines and existing SVG icon set.
- Load data and render the useful dashboard before starting the hero renderer or ambient effects.

Rejected alternatives:

1. Full-page WebGL would make cards, accessibility and iPhone performance unnecessarily fragile.
2. Raster-only parallax would be faster but would not fix the fake drone or create the requested AAA dashboard response.

## Information architecture

### 1. Command hero

The first viewport contains:

- Time-aware greeting and current date.
- “Flight Deck” title, kept as the primary product identity.
- A concise operational line derived from the latest flight and active jobs.
- Primary CTA: **Continuar último vuelo** when a playable flight exists.
- Secondary CTA: **Abrir trabajos** when a job is active, otherwise **Explorar vuelos**.
- Real GLB drone occupying the right side on desktop and a compact top-right stage on phone.

The drone follows pointer movement with bounded yaw/pitch, eases back to idle, and performs a short safe flourish on click. It never crosses title or CTA hit targets. Keyboard and reduced-motion users receive a static model with the same content.

### 2. Live telemetry strip

Five compact cells show real values:

- Flights/clips.
- Hours airborne.
- Distance flown.
- Published 3D models and splats.
- Vault storage.

Each cell has a label, tabular value and a destination when meaningful. Loading uses stable-width skeletons. Missing fields show `Sin datos` instead of zero unless zero is semantically correct.

### 3. Explore modules

All seven existing destinations remain present and fully clickable:

1. Vuelos.
2. Viajes.
3. 3D.
4. Dron.
5. Studio.
6. Subir.
7. Sistema.

Desktop uses a deliberate editorial grid, not auto-fill: Vuelos spans two columns; Viajes and 3D are feature cards; the remaining four form a balanced second row. Tablet uses two columns. Phone uses one column with 16:10 media and compact copy.

Every card contains:

- A real vault thumbnail or existing product asset.
- Existing product icon.
- One-sentence benefit.
- Two or three truthful data chips.
- Permanently visible action label, never hover-only.
- Complete anchor hit area, visible keyboard focus and a minimum 44 px touch target.

Unavailable data does not remove a card. The card renders an honest empty state and still opens its module.

### 4. Continue and storage

The latest-flight card remains below Explore, with thumbnail scrubbing only on capable devices. Touch users get a stable preview. The vault panel remains visible but becomes a compact capacity card with total, category distribution and a direct Sistema link.

## Motion system

### Motion tiers

- **Micro, 120–180 ms:** focus, button press, chip response.
- **Component, 220–360 ms:** card lift, image depth, telemetry update.
- **Cinematic, 480–620 ms:** click void and route handoff.
- **Ambient, 8–24 s:** slow hero stars and drone idle motion.

All easing uses bounded, non-bouncy curves. No card may remain disabled if animation is interrupted.

### Star-void navigation

Activating a module card creates one fixed canvas over the app:

1. Capture the pointer origin, or card center for keyboard activation.
2. Pull the card image and accent color toward a dark radial void.
3. Emit a capped field of star particles with depth, streak and additive glow.
4. Expand the void to cover the viewport.
5. Navigate no later than 620 ms after activation.

Budgets:

- Desktop: at most 420 particles.
- Tablet: at most 260 particles.
- Phone: at most 160 particles.
- Device pixel ratio capped at 1.5 for the effect canvas.
- One animation frame loop, cancelled on `pagehide`, `visibilitychange` or completed navigation.
- If canvas initialization fails, navigate immediately.
- Repeated clicks are ignored only during the maximum 620 ms handoff.
- `prefers-reduced-motion` uses an 80 ms opacity transition with no particles.

The effect must work for pointer, touch, Enter and Space. The destination URL always comes from the real anchor.

### Hero motion

- GLB initializes after dashboard content is painted.
- Renderer pauses when the hero is outside the viewport or the page is hidden.
- Pixel ratio is capped at 1.5 on phone and 2 on desktop.
- Idle motion is subtle. Pointer response is clamped to avoid nausea.
- Loading failure shows the static existing `ovi-drone.png`, with no broken-model placeholder.
- Audio is off by default. No navigation or information depends on audio.

## Data and failure behavior

Home consumes the existing sources only:

- `getFlights()` for flights, duration, distance, latest flight and thumbnails.
- `manifest/system.json` for storage, models, splats, ingest, reels and photos.
- `/api/jobs` for authenticated active work.

Use independent loading boundaries. Flights failing must not suppress system cards; system manifest failing must not suppress flight navigation; jobs returning 403 remains a silent public state. Each resolved section replaces its own skeleton without shifting the page.

Derived values live in a pure `buildHomeViewModel(flights, system, jobs)` function so missing-data behavior can be unit tested without a browser.

## Responsive behavior

### Desktop, 1280 px and wider

- Existing sidebar stays at 220 px.
- Main content uses a centered maximum width of 1,560 px.
- Hero is a two-column composition with text/CTAs left and drone stage right.
- Editorial card grid uses four columns.

### Tablet, 641–1024 px

- Two-column cards.
- Hero drone reduces in size and cannot overlap actions.
- Telemetry becomes a horizontally scrollable snap row only when five cells do not fit.

### Phone, 390 × 844 baseline

- One-column cards.
- Hero title and CTA remain above the fold.
- Drone stage is decorative and `pointer-events:none` unless explicitly focused through its control.
- Bottom navigation remains accessible and safe-area aware.
- No horizontal document overflow.
- Touch interactions do not depend on hover or double-click.

### Small phone, 320 px

- Copy wraps without clipping.
- Chips may wrap; primary actions remain full width.
- Particle count drops to 100.

## Accessibility and input

- Semantic anchors remain the navigation source of truth.
- Focus rings meet contrast and are never removed.
- Cards expose destination, not decorative effect names, to assistive technology.
- Canvas and ambient background are `aria-hidden`.
- Drone control has an accessible label and does not trap focus.
- Color is not the only indicator for status.
- Reduced motion, forced colors and coarse pointer receive tested fallbacks.

## Performance budgets

- Existing hero background: 201,808 bytes.
- Existing drone GLB: 945,668 bytes, loaded only after useful content.
- Initial Home-specific JavaScript should remain below 90 KB compressed, excluding shared Three modules already cached by Flightverse.
- No long task above 50 ms during initial card interaction on the reference Mac.
- Target 60 fps desktop and at least 50 fps on the 390 × 844 mobile test during ambient motion.
- Click void must not delay navigation beyond 620 ms.
- No animation loop runs while the page is hidden.
- Images below the first viewport use lazy loading and explicit dimensions.

## Code boundaries

- `web/home.js`: data loading, view-model rendering and orchestration only.
- `web/home-drone.js`: GLB renderer, pointer response, pause/resume and static fallback.
- `web/home-effects.js`: shared ambient canvas and star-void transition.
- `web/style.css`: one final Home V2 block using `.home-v2` scope; obsolete Home V4–V10 selectors are removed after parity is verified.
- `web/home.html`: versioned module scripts and preload hints.
- `pipeline/test_home_v2.py`: source-contract and pure view-model tests.
- `pipeline/browser_home_v2.py`: desktop/tablet/phone visual, overflow, clickability and reduced-motion checks.

No new route, backend endpoint or persistence layer is needed.

## Acceptance gates

1. All seven module cards render even with partial manifest data.
2. Every card and CTA reaches the correct existing destination by mouse, touch and keyboard.
3. Star-void completes or safely falls through within 620 ms.
4. GLB failure produces the static drone fallback.
5. Desktop, iPad and 390 × 844 iPhone have zero horizontal overflow and no clipped actions.
6. Reduced-motion mode has no ambient loops or particle burst.
7. Home renders meaningful skeleton, empty and error states without layout collapse.
8. Browser console has zero uncaught errors.
9. Existing global navigation, light theme and authenticated/public behavior remain intact.
10. Reference screenshot and final captures are compared at the same desktop viewport; all P0, P1 and P2 findings are fixed before handoff.

## Non-goals

- Rebuilding destination pages.
- Adding new backend analytics.
- Replacing the global sidebar or bottom navigation.
- Turning the entire dashboard into a game engine scene.
- Autoplay audio.
