# Flightverse mobile command HUD

**Date:** 2026-07-27  
**Status:** Approved  
**Scope:** Mobile and coarse-pointer Flightverse UI only

## Problem

The v305 mobile HUD is functionally tested but remains difficult to use on a
real phone:

- The live weapon block is 303 CSS pixels wide in a 390-pixel viewport.
- The `Combate` launcher occupies `y=363..415` while the higher-z live weapon
  block occupies `y=357..521`, so the launcher is visually and interactively
  covered.
- The full-screen HUD, canvas, weapon status, menu launcher, and stick zones
  retain WebKit's default blue tap highlight. Most also retain
  `user-select:auto`.
- A real emulated double tap on the weapon status emits two `selectstart`
  events. This matches the reported blue selection/highlight behavior.
- The existing combat browser gate dispatches mouse events after enabling
  touch emulation. It does not prove real touch, multitouch, cancellation,
  rapid taps, or simultaneous stick and trigger input.
- Camera, four weapon choices, status copy, fire, menu, and an optional combat
  sheet occupy the same central band. The result looks like several desktop
  panels compressed onto a phone.

## Product goal

Flightverse mobile should feel like a purpose-built premium controller:

- the world remains visually dominant;
- flight and fire are always reachable;
- secondary controls stay one tap away but are collapsed by default;
- no browser zoom, text selection, callout, drag ghost, or blue tap flash can
  steal a gesture;
- every touch has deterministic ownership and cleanup.

Desktop layout and normal text selection elsewhere in AeroBrain must remain
unchanged.

## Chosen direction

Use a compact mobile command HUD.

The default closed state contains only:

1. the two dynamic sticks;
2. one persistent fire trigger;
3. one compact weapon button showing the selected weapon and ammo;
4. one compact menu button;
5. the minimal FPV OSD.

Everything else is collapsible.

This replaces the current full-width weapon carousel and removes the redundant
mobile `Combate` launcher from the closed state.

## Layout

### Persistent controls

- **Left stick:** lift and yaw, dynamic origin, lower-left safe zone.
- **Right stick:** pitch and roll, dynamic origin, lower-right safe zone.
- **Fire:** a 72-by-72 CSS-pixel circular/rounded trigger directly above the
  right stick with at least 12 pixels of separation.
- **Weapon:** a 56-by-56 compact control above fire. It shows a short weapon
  label and the remaining ammo.
- **Menu:** a 52-by-52 compact control above the left stick.
- **OSD:** one compact top flight strip. Duplicate corner telemetry remains
  hidden in FPV.

Visible stick bases are reduced and softened, while their touch zones remain
large. This improves clarity without shrinking the usable gesture area.

### Weapon picker

Tapping the weapon control opens a vertical picker anchored above it:

- MG
- Misil S
- Misil M
- Misil L

Each target is at least 48 CSS pixels. Selecting an item updates the persistent
weapon control and closes the picker. Tapping outside, pressing Escape, opening
another overlay, orientation change, or page teardown also closes it.

The picker is not a modal sheet. It owns only its compact region and never
disables the sticks. Its geometry must not intersect either stick, the fire
trigger, safe-area insets, or the viewport edge.

### Sheets

Menu becomes the single entry point for secondary actions:

- camera;
- flight mode;
- visual representation;
- sky and quality;
- Gate Rush;
- Invasion;
- audio;
- image controls;
- recording;
- guide.

Combat configuration can remain as a sheet for detailed weapon information,
but it is opened from Menu rather than a second floating launcher.

Opening any modal sheet:

- closes the weapon picker;
- releases and cancels held fire;
- resets and disables flight input;
- hides persistent command controls;
- traps focus inside the dialog;
- restores focus to Menu after close.

The sheet itself provides its close control and the scrim provides outside
dismissal when allowed.

## Gesture ownership

### Flight surface

On `.vl-body` and the Flightverse HUD subtree:

- `user-select:none`;
- `-webkit-user-select:none`;
- `-webkit-touch-callout:none`;
- `-webkit-tap-highlight-color:transparent`;
- `overscroll-behavior:none`.

Canvas, sticks, fire, and the compact weapon picker use explicit
`touch-action:none`. Ordinary buttons and scrollable sheets use
`touch-action:manipulation`.

`selectstart`, `dragstart`, and `contextmenu` are prevented only inside the
Flightverse interaction surface. Range inputs and deliberate sheet scrolling
remain usable.

The existing viewport lock remains, but correctness does not rely on
`user-scalable=no` because modern iOS may ignore it for accessibility.

### Fire trigger

The fire control uses one explicit pointer owner:

- the first valid pointerdown owns the trigger;
- pointer capture persists through small movement;
- pointerup, pointercancel, lost capture, blur, visibility change, pagehide,
  overlay open, and controller disposal all release it exactly once;
- secondary pointers cannot replace or release the owner;
- a released hold never resumes automatically;
- a new press is required after interruption;
- click, double-click, selection, context-menu, and ghost-tap behavior cannot
  create extra shots.

MG repeats only while the owning pointer is held. Each missile fires at most
once per hold and rearms after release.

Optional haptic feedback is best-effort and never participates in correctness.

## Typography and visual language

- Action names use the system UI font for quick recognition.
- Monospaced type is limited to telemetry, ammo, and short weapon codes.
- Persistent controls use one neutral graphite surface.
- Fire alone uses the warm combat accent.
- Active weapon uses a restrained amber highlight.
- Labels avoid excessive tracking and remain readable at normal phone distance.
- Controls have a visible pressed state without scaling far enough to move
  their hit geometry.

## Responsive behavior

The same command hierarchy applies to:

- phone portrait;
- phone landscape;
- iPad portrait;
- iPad landscape.

Landscape uses a tighter edge cluster and shorter top OSD. iPad may increase
control size slightly but does not restore the desktop panel layout when the
pointer is coarse.

All geometry is derived from the visual viewport and safe-area insets. Rotation
closes transient pickers, cancels active fire, clamps sheets, and preserves the
selected weapon.

## Accessibility

- All persistent controls are native buttons.
- Weapon and menu buttons expose `aria-expanded`.
- The picker exposes a named listbox/menu relationship and current selection.
- Trigger exposes `aria-pressed` only while genuinely held.
- Sheet dialogs retain role, modal state, inert background, focus trap, and
  focus restoration.
- Focus-visible styling remains present even though touch is the primary input.
- Reduced-motion preference removes nonessential transitions.

## Test strategy

### Unit contracts

- Pointer-owner state machine: rapid taps, hold, cancel, lost capture,
  secondary pointer, blur, visibility, pagehide, disable, and disposal.
- Weapon picker: exclusive open/close, selection, outside dismissal,
  orientation close, and accessibility state.
- Touch suppression is scoped to Flightverse and preserves range controls.

Every new behavior starts with a failing test.

### Real browser contracts

Use `Input.dispatchTouchEvent`, not mouse events, for:

- one touch shot;
- MG hold cadence;
- missile single-shot hold/release/repress;
- rapid taps without duplicate/ghost shots;
- movement slop while held;
- pointer cancellation;
- simultaneous left stick, right stick, and fire pointer ownership;
- weapon selection while sticks remain available;
- double tap and long press with visual viewport scale fixed at 1;
- zero `selectstart`, zero text selection, transparent tap highlight;
- rotation cleanup.

Measure closed and open geometry in all four touch profiles. Assert no overlap
among sticks, fire, weapon control, picker, menu, safe areas, and viewport.

Capture closed state, weapon picker, and Menu sheet for visual inspection in
each orientation.

### Regression and release gates

- focused Node and Python mobile suites;
- full smoke;
- gzip freshness and one web fingerprint bump;
- Flightverse collision fixture and stress100;
- full phone/iPad/desktop browser matrix;
- independent review;
- fail-closed `safe_restart.sh server`;
- public and loopback canary.

## Non-goals

- No desktop HUD redesign.
- No change to flight physics, weapon damage, collision geometry, or Invasion
  AI.
- No global prohibition on text selection outside Flightverse.
- No gesture-only firing or hidden critical control.
- No new font download or frontend dependency.

## Acceptance

The work is complete only when:

- the blue selection/tap flash and page zoom cannot be reproduced;
- real touch and three-pointer flight-plus-fire tests pass;
- every fire gesture has exactly one lifecycle and no stuck state;
- the closed mobile HUD exposes only the agreed persistent controls;
- no control overlaps in all four touch profiles;
- desktop remains unchanged;
- production canary is healthy after gated deployment.
