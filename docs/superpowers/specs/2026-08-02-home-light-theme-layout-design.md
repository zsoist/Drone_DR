# Home Light Theme and Balanced Layout Design

## Problem

The Home V2 cards keep a dark photographic surface in both themes, but their
headings inherited the global `--text` token. In light mode that token becomes
`#17202B`, producing dark headings over dark photographs. The hero heading and
the dark lower summary panels had the same inheritance bug.

The module grid also used `grid-auto-rows: minmax(280px, 34vw)`. At the reported
2048 px viewport this creates 696 px rows. The nine-card sequence fills only half
of its final four-column row, leaving two large blank columns and an unnecessarily
tall page.

## Considered approaches

1. Add isolated light-theme color overrides only. This restores legibility but
   preserves the oversized rows and empty final columns.
2. Convert every Home card to a white surface. This is consistent with a light
   theme, but destroys the photographic module identity and weakens the existing
   Flight Deck direction.
3. Use a hybrid light theme with semantic on-media colors and a balanced grid.
   This keeps imagery cinematic, makes data panels genuinely light, and fixes
   both layout defects. This is the selected approach.

## Visual system

- Hero and photographic module titles use a fixed near-white on-media color in
  both themes. They never inherit the canvas text token.
- Light mode uses a slightly stronger dark image wash, light body copy, and dark
  translucent chips over photos.
- The latest-flight and vault summaries become white surfaces in light mode with
  dark text and a 16.43:1 measured title contrast.
- The light canvas uses restrained blue and mint radial atmosphere so unused
  margins feel intentional without reducing readability.

## Responsive layout

- Above 1100 px: twelve columns. Spans are `6, 3, 3 / 3, 3, 3, 3 / 6, 6`, so
  every row is full. Row height is capped at 430 px.
- From 681–1100 px: two columns. The feature card spans both columns and the
  remaining eight cards pair evenly. Row height is capped at 390 px.
- At 680 px and below: one column, capped at 400 px, with no horizontal overflow.
- Skeleton cards use the same spans as loaded content to prevent layout shift.

## Acceptance contract

The real-browser gate covers 2048×1218, 1024×609, and 390×844. It requires nine
cards, no horizontal overflow, light on-media headings, dark section text on the
light canvas, WCAG AA lower-panel contrast, no gap larger than 24 px below the
grid, a maximum 460 px wide-screen row, and 98% or greater final-row coverage.
