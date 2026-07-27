# Flightverse mobile command HUD QA — 2026-07-27

Status: PASS

## Scope

Task 3 validates the Flightverse command HUD with real Chrome DevTools Protocol
touch events. The gate covers phone and iPad portrait/landscape layouts, while
retaining a desktop mouse Fire check.

Test target:

- Loopback: `http://127.0.0.1:8790`
- Clip: `recon_c97cd120a1`
- Flightverse web build: v310

## Automated evidence

The four touch profiles passed at 60 FPS with nine Mundo islands:

| Viewport | Closed HUD | Weapon picker | Menu sheet | Real-touch combat |
| --- | --- | --- | --- | --- |
| Phone portrait | PASS | PASS | PASS | PASS |
| Phone landscape | PASS | PASS | PASS | PASS |
| iPad portrait | PASS | PASS | PASS | PASS |
| iPad landscape | PASS | PASS | PASS | PASS |

Each Volar result includes `touchCommandHud` evidence for:

- exact one-shot Fire behavior;
- machine-gun hold/repeat and release;
- short/medium/long missile hold lock, release, and repress;
- `touchCancel` cleanup;
- owner-pointer isolation;
- rapid double tap without a held or ghost shot;
- simultaneous left stick, right stick, and Fire input;
- viewport zoom, text-selection, and tap-highlight guards;
- closed, weapon-picker, and Menu geometry.

The geometry gate checks collision-free visible controls, visual-viewport
bounds, minimum targets (Fire 72×72, weapon 56×56, Menu 52×52, picker rows
44×48), picker visibility, Menu focus, hidden flight controls, safe-area gaps,
and bounded sheets. Phone portrait retained 12 px clearance between Fire and
the right-stick zone. The phone-landscape picker stayed within x=356..488 and
y=12..230.

## Screenshot review

The following 12 artifacts were reviewed at original resolution under
`/Volumes/SSD/drone-vault/qa/`:

- `matrix-volar-mobile_portrait-{closed,weapons,menu}.png`
- `matrix-volar-mobile_landscape-{closed,weapons,menu}.png`
- `matrix-volar-ipad_portrait-{closed,weapons,menu}.png`
- `matrix-volar-ipad_landscape-{closed,weapons,menu}.png`

Visual review passed for overlap, hierarchy, typography, tap-target clarity,
and preservation of the world view. Closed controls are separated; picker
rows are readable and unclipped; Menu sheets retain clear focus and dismiss
targets while hiding flight controls. The landscape picker partially covers
the FPV telemetry strip while open, but remains bounded and does not obscure
the world or collide with interactive controls.

## Commands and results

```text
python3 pipeline/browser_matrix.py recon_c97cd120a1 --flightverse \
  --viewport mobile_portrait --viewport mobile_landscape \
  --viewport ipad_portrait --viewport ipad_landscape

mundo/mobile_portrait: ok · 9 islas
volar/mobile_portrait: ok · 60fps
mundo/mobile_landscape: ok · 9 islas
volar/mobile_landscape: ok · 60fps
mundo/ipad_portrait: ok · 9 islas
volar/ipad_portrait: ok · 60fps
mundo/ipad_landscape: ok · 9 islas
volar/ipad_landscape: ok · 60fps
```

Focused phone portrait and landscape runs also passed independently.

## Protocol note

CDP requires `touchEnd` and `touchCancel` to carry an empty active-point list;
it cannot lift only one contact while preserving the other contacts in the
same dispatch. The three-pointer scenario therefore ends the complete physical
set and immediately restarts the two logical stick contacts at the same IDs and
coordinates before sampling continued flight input. Every event remains a real
CDP touch event, and the evidence records this restart explicitly.
