# Flightverse mobile command HUD QA — 2026-07-27

Status: PASS

## Scope

Task 3 validates the Flightverse command HUD with real Chrome DevTools Protocol
touch events. The gate covers phone and iPad portrait/landscape layouts, while
retaining a desktop mouse Fire check.

Test target:

- Loopback: `http://127.0.0.1:8790`
- Clip: `recon_c97cd120a1`
- Flightverse web build: v311

## Automated evidence

The four touch profiles passed at 60 FPS with nine Mundo islands:

| Viewport | Closed HUD | Weapon picker | Menu sheet | Combat input |
| --- | --- | --- | --- | --- |
| Phone portrait | PASS | PASS | PASS | PASS · real touch |
| Phone landscape | PASS | PASS | PASS | PASS · real touch |
| iPad portrait | PASS | PASS | PASS | PASS · real touch |
| iPad landscape | PASS | PASS | PASS | PASS · real touch |
| Desktop | n/a | n/a | n/a | PASS · mouse |

Each Volar result includes `touchCommandHud` evidence for:

- exact one-shot Fire behavior;
- machine-gun hold/repeat and release;
- short/medium/long missile hold lock, release, and repress;
- `touchCancel` cleanup;
- owner-pointer isolation;
- rapid double tap without a held or ghost shot;
- simultaneous left stick, right stick, and Fire input;
- original stick-contact continuity after releasing only Fire;
- viewport zoom, text-selection, and tap-highlight guards;
- closed, weapon-picker, and Menu geometry;
- the established Menu/overlay acceptance: forward, backward, and re-entry
  focus trap; canvas/command inertness; held-MG cancellation; neutral flight
  input; blocked/restored flight, camera, weapon, and record hotkeys; Fire
  repress; scrim dismissal; sheet actions/targets; overlay exclusivity; image
  drag; camera cycle; and chase-HUD collision/bounds.

The geometry gate checks collision-free visible controls, visual-viewport
bounds, minimum targets (Fire 72×72, weapon 56×56, Menu 52×52, picker rows
44×48), picker visibility, Menu focus, hidden flight controls, safe-area gaps,
and bounded sheets. CDP emulated non-zero safe insets and the CSS probe
resolved them exactly as top 17 px, right 13 px, bottom 23 px, and left 11 px.
Phone portrait retained 12 px clearance between Fire and the right-stick zone.
In phone landscape the command HUD now starts below the emulated top inset;
the picker stayed within x=356..488 and y=29..247.

## Screenshot review

The following 12 artifacts were reviewed at original resolution under
`/Volumes/SSD/drone-vault/qa/`:

- `matrix-volar-mobile_portrait-{closed,weapons,menu}.png`
- `matrix-volar-mobile_landscape-{closed,weapons,menu}.png`
- `matrix-volar-ipad_portrait-{closed,weapons,menu}.png`
- `matrix-volar-ipad_landscape-{closed,weapons,menu}.png`

Visual review passed for interactive-control separation, hierarchy,
typography, tap-target clarity, and clipping. Closed controls are separated;
picker rows are readable and bounded; Menu sheets retain clear focus and
dismiss targets while hiding flight controls. The open picker visibly covers
part of the telemetry/world imagery in phone landscape, iPad landscape, and
iPad portrait. This is a minor, noninteractive occlusion rather than a control
collision; enough world context remains visible.

## Commands and results

```text
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse

mundo/mobile_portrait: ok · 9 islas
volar/mobile_portrait: ok · 60fps · touch=real
mundo/mobile_landscape: ok · 9 islas
volar/mobile_landscape: ok · 60fps · touch=real
mundo/ipad_portrait: ok · 9 islas
volar/ipad_portrait: ok · 60fps · touch=real
mundo/ipad_landscape: ok · 9 islas
volar/ipad_landscape: ok · 60fps · touch=real
mundo/desktop: ok · 9 islas
volar/desktop: ok · 60fps
```

The focused phone landscape run also passed independently on v311. The default
matrix revalidated phone portrait on v311.

## Protocol note

Empirical Chrome 150/CDP evidence corrected the initial protocol assumption.
`touchMove([left,right])` does not release an omitted Fire contact. A
`touchEnd([fire])` dispatch lifts exactly Fire: Chrome emitted `pointerup` for
the Fire owner and `touchend` with `changed=[903]`, while `touches=[901,902]`
remained active. A following `touchMove` retained those original stick IDs and
continued non-zero flight input without restarting either contact. The gate
stores this event/state log and asserts the ordering.

When Menú opens during a physical MG hold, the overlay cancels runtime
ownership. The remaining device contact is cleared with `touchCancel`; using
`touchEnd` after focus moves into the sheet makes Chrome retarget and synthesize
a click on the focused close button.
