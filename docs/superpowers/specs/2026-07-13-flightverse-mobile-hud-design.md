# FLIGHTVERSE Mobile HUD — Design Specification

> **Implemented dated design.** Retained as acceptance provenance.

**Date:** 2026-07-13  
**Status:** Approved

## Problem

The portrait touch HUD assigns the same bottom-right area to the right flight stick, weapon selector, fire control, minimap, and flight status. The menu also opens as a horizontally clipped strip, so important actions are hidden and hard to discover.

## Design

Keep the current dark glass AeroBrain visual system and desktop HUD unchanged. On coarse-pointer devices:

- Reserve the lower-left and lower-right zones exclusively for the two flight sticks.
- Place a 52 px **Menú** launcher above the left stick and a 52 px **Combate** launcher above the right stick.
- Center the minimap and compact flight status in the safe space between the sticks.
- Open **Menú** as a readable two-column sheet with all flight actions visible through vertical scrolling only.
- Open **Combate** as a compact sheet containing the weapon grid, fire control, ammunition, and kills.
- Keep only one sheet open at a time. A visible **Cerrar** action, the launcher, Escape, or selecting a menu action closes it.

## Accessibility and Interaction

- Launchers expose `aria-controls`, `aria-expanded`, and descriptive labels.
- Sheets use dialog semantics and labelled headings.
- Every touch target is at least 44 × 44 px; primary controls target 48–56 px.
- Focus remains visible, sheets have no horizontal scrolling, and reduced-motion preferences are respected.
- Opening a sheet must not cover either stick interaction zone.

## Acceptance Criteria

At 390 × 844 and tablet touch viewports:

1. The two sticks, minimap, launchers, and visible combat actions do not overlap.
2. The closed HUD exposes both Menú and Combate without covering a stick.
3. The menu exposes every action without horizontal scrolling.
4. The combat sheet exposes all four weapons and fire without covering the right stick.
5. All actionable mobile controls are at least 44 × 44 px.
6. Desktop/fine-pointer layout and controls remain unchanged.
7. Automated browser QA measures geometry, not only document overflow.
