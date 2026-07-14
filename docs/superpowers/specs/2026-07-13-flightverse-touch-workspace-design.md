# FLIGHTVERSE Touch Workspace Design

> **Implemented dated design.** Retained as acceptance provenance.

## Problem

On touch devices, the flight menu closes after every action, the combat panel does not prove that a shot was accepted, and the image editor covers the scene it edits. The panels are fixed sheets, so the operator cannot move them away from the subject.

## Approved interaction

- Menu controls are persistent. Mode, camera, view, sky, sound and recording stay available until the operator presses Close, the launcher again, or Escape.
- Opening a task-specific surface such as Image may replace the menu, but changing a slider never closes Image. The scene remains visible behind a compact inspector.
- Menu, Combat and Image have a touch drag handle in their header. Dragging clamps the panel inside the visual viewport and stores a normalized position per panel. Resize and orientation changes re-clamp the saved position.
- Combat uses full weapon names and a large DISPARAR control. Pointer down fires immediately, holds MG fire, and pointer up or cancellation stops it. The control owns its gesture so scrolling cannot steal the shot.
- Image is a bottom inspector no taller than 46dvh in portrait. It scrolls internally, applies every slider live, and can be dragged upward or sideways to inspect the affected scene.

## Boundaries

- `web/flightverse/panels.js` owns dragging, clamping and persistence only.
- `web/volar.js` owns menu/combat/image state and weapon actions.
- `web/style.css` owns responsive size, drag handles and touch targets.
- `pipeline/test_volar_mobile.py` owns static interaction contracts.
- `pipeline/browser_matrix.py` proves visible layout, persistent menu, draggable bounds and real ammo decrement.

## Failure behavior

Stored positions that are missing, corrupt or outside the current viewport are ignored or clamped. A drag never starts from a button, range input or interactive child. Pointer cancellation releases drag and weapon firing.

## Success criteria

At mobile and iPad viewports: menu remains open after editing controls, Close works, a shot decrements the selected weapon, Image leaves at least 45% of the scene unobscured, and all three panels can be moved without leaving the viewport.
