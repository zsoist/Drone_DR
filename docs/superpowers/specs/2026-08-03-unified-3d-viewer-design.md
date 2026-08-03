# Unified 3D Viewer Design

## Objective

Replace the three separate project viewers with one large, predictable workspace for point cloud, textured mesh, and Gaussian splat inspection. The interaction model must match the private Share viewer: left drag pans, right drag rotates, wheel or pinch zooms toward the pointer, and double click or double tap focuses.

## Product contract

- One panel and one viewport, with `Nube`, `Malla`, and `Gaussian` tabs.
- The selected tab owns the viewport; switching tabs tears down the previous renderer before mounting the next one.
- A single contextual `Cargar` button reports `Cargando`, `Reintentar`, or `Recargar` without leaving stale controls behind.
- Shared camera actions remain in the same position for every renderer: center, zoom in, zoom out, autorotate, and fullscreen.
- Layer-specific controls remain available but secondary: cloud point size/color/clipping, mesh render/quality, and Gaussian appearance/measurement tools.
- Gaussian version selection appears only while the Gaussian tab is active.
- Weak or unavailable layers are disabled and explained; the user can always switch to another valid layer.
- Desktop viewport height is 64dvh with a 520px minimum. Mobile uses 62dvh with a 420px minimum and 44px touch targets.
- The map, quality report, downloads, and improvement flow keep their current behavior.

## Architecture

`tresd.js` will own one viewer state machine with three modes. It will centralize mode activation, renderer disposal, placeholder/error states, and contextual header state. Existing Three.js cloud/mesh builders and the shared `mountSplatViewer` remain the rendering engines; they receive the same host node and the same navigation contract.

The public Share viewer remains unchanged because it is the interaction reference. The internal workspace adopts its single-viewport structure while retaining operator-only controls.

## Lifecycle and failure handling

Every activation increments a load token. Async loaders compare that token before mounting, so a late cloud, mesh, or Gaussian response cannot replace the currently selected layer. Switching model, layer, or Gaussian version disposes the active Gaussian handle or detaches the Three.js canvas so its existing teardown releases geometry, textures, observers, and WebGL context.

Failures render inside the unified viewport and restore the contextual button as `Reintentar`. Switching away always clears the failure. Fullscreen is exited before any teardown.

## Accessibility and responsive behavior

The layer selector is a `tablist`; tabs expose `aria-selected`, `aria-controls`, and disabled state. The viewport exposes a stable label for the active layer and status messages use `aria-live=polite`. Keyboard users can activate tabs with Enter/Space, while browser-native button traversal supplies predictable focus order.

On narrow screens the tabs span the full header, the Gaussian version selector moves to its own row, and layer-specific HUDs scroll horizontally instead of covering the model.

## Verification

- Static contract tests prove there is one viewport and no legacy three-panel layout.
- State-machine tests prove mode normalization, availability fallback, and contextual labels.
- Syntax, gzip freshness, static 3D tests, smoke tests, and browser matrix checks cover integration.
- Manual browser QA covers desktop and mobile switching, gestures, fullscreen, project changes, slow-load races, and Gaussian version changes.
