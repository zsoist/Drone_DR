# AeroBrain redesign (October 2026)

This plan is the single source of truth for the full redesign of AeroBrain.
Every builder agent (Codex or Claude) reads this file before it starts.

## Goal

AeroBrain must look and work like a premium 2026 product. It has one owner: a drone pilot with an iPhone 15 Pro Max and a desktop.
The footage is the hero. The interface is quiet, fast and exact.
The target score is 10/10 from an independent design QA agent on each page, on phone and on desktop.

## Rules for all builders

1. Read `CLAUDE.md` first. The Karpathy rules apply: think first, keep it simple, make surgical changes, work to a goal.
2. Work only in your git worktree. Change only the files of your workstream (see "Workstreams").
3. Do not edit the main checkout at `/Volumes/SSD/work/forge-projects/aerobrain`. That folder is production.
4. Test on your own read-only preview server (see "Preview server"). Do not test on port 8790.
5. Run one browser gate at a time. `pipeline/browser_gate.py` holds a lock for the full Mac.
6. Keep the UI in Spanish. Keep code, commits and docs in English. Docs use STE (`docs/STE_STYLE_GUIDE.md`).
7. Keep the strict CSP: `script-src 'self'`. Put fonts, scripts and styles in `web/`. Do not load them from a CDN.
8. Do not use Inter, Roboto, purple gradients, gradient text, sparkle icons or glass on glass (see "Anti-patterns").
9. After you edit `web/`, run `python3 pipeline/bump_web_version.py`.
10. Commit on your branch with clear messages. Do not push. Do not merge. The integrator merges.

## Design decisions

### Typography

- Main face: **Mona Sans** variable font (OFL). Numbers and telemetry: **JetBrains Mono** variable font (OFL).
- Put the `woff2` files in `web/vendor/fonts/`, with a Latin and Spanish subset and `font-display: swap`.
- Phone scale (px): 12, 13, 15, 17, 20, 24, 30, 40. Desktop scale (px): 12, 13, 14, 16, 20, 26, 34, 48, 64. Use `clamp()` between the two scales.
- Body line height is 1.45. Title line height is 1.1.
- Inputs on the phone use 16 px or more, because iOS zooms on smaller inputs.
- Telemetry uses `font-variant-numeric: tabular-nums slashed-zero` and a fixed width. Units are smaller and use a secondary color.

### Color and surfaces

- Dark theme first. Write all tokens in OKLCH.
- Surfaces use lightness steps of about 0.14, 0.17, 0.21 and 0.25, with a low chroma and one cool hue.
- The full-screen media viewer uses pure black.
- One accent color: aviation amber, only for active, live and record states. One data color: cyan, only for GPS tracks and charts.
- Media has no border and no rounded overlay. The corner radius scale is 6 (controls), 12 (cards) and 20 (sheets).
- Elevation on dark: a lightness step and a 1 px inner hairline (white at 6 to 8%). Use shadows only on layers that float.
- Glass: only for controls that float over media and maps (tab bar, player controls, map overlays). Use a maximum of one glass layer on the screen, and a solid fallback.
- Light theme: the default for Ventas, Propiedades and Guía. Use a warm paper white and the same accent. The app follows the system setting, with a manual override.

### Motion

- Use cross-document View Transitions (`@view-transition { navigation: auto; }`) as a progressive enhancement. Safari iOS 18.2 and Chrome 126 support them.
- Set `view-transition-name` only in `pageswap` and `pagereveal`. The `pagereveal` script is a classic script in `<head>`.
- Shared elements:
  - clip thumbnail to player
  - trip card to trip header
  - map pin to Flight Deck map
  - world card to the poster image of the 3D viewer (do not morph a live WebGL canvas)
- Pages with a heavy start (3D, Volar) use a crossfade only.
- Durations:
  - press and toggle: 120 to 160 ms
  - menus: 200 to 240 ms
  - pages: 300 to 380 ms
  - sheet spring: about 450 ms
- Exits are about 30% faster than entrances.
- Use `linear()` spring curves as tokens. Animate only `transform` and `opacity`.
- With `prefers-reduced-motion`, use a 150 ms opacity crossfade. Stop autoplay previews. Stop camera fly-to moves.

### Navigation

- Five destinations:
  1. **Inicio**
  2. **Viajes**: list and map views. Flight Deck is the detail view of a flight.
  3. **Studio**: Subir is the primary action.
  4. **3D**: Escenas, Mundo and Volar.
  5. **Más**: `Dron`, `Sistema`, `Guía` and `Ventas`.
- Phone: a tab bar that floats, with 5 tabs and visible labels. A search button opens the command palette as a full-height sheet.
- Desktop: a left rail (64 px closed, 240 px open) with the same groups. `⌘K` opens the command palette.
- The palette finds sections, trips, clips, worlds and actions (`Subir`, `Nuevo reel`, `Ir al vuelo del 3 oct`).
- Share pages and property pages are not in the app navigation. They need a session, like all other pages. Do not add them to `PUBLIC_RESOURCES` (see `CLAUDE.md`).

### Components

- **Sheet**: `<dialog>` with three heights on the phone (peek, half, full). On the desktop, the same content opens as a panel on the right. Close it on a backdrop tap and on Escape (Safari iOS does not support `closedby`).
- **Toast**: one toast at a time, above the tab bar on the phone and at the bottom right on the desktop. A destructive action gets "Deshacer".
- **Activity pill**: long jobs (upload, splat training, render) show a persistent pill. A tap opens the Sistema sheet. Do not use toasts for long jobs.
- **Skeleton**: it has the same layout as the final content. A media item shows its dominant color until the image loads.
- **Empty state**: one sentence, one primary action and one example.
- **Buttons**: primary, secondary, quiet and danger, with the same heights everywhere (44 px minimum touch target).

### Visual AI features

One structured Gemini Flash call for each clip at ingest returns JSON. All features read this stored JSON.
The JSON has a Spanish caption, tags, subjects, shot type, best-frame times, highlight segments, light and color notes, and quality flags.
The cost is about $0.003 for a clip of 60 s.

| Feature | How it shows in the UI |
|---|---|
| Semantic search | Search field in the palette. The results grid shows the matched moment. |
| Tag chips | Chips on cards. They are also filters. |
| Smart collections | "Colecciones" row on Inicio (place, time, subject, shot type). |
| Best-frame cover | Automatic poster. The owner can select a different frame. |
| Highlight reel | Studio "Reel automático": preview, then accept or edit on the timeline. |
| Quality flags | Small "Inestable" or "Horizonte" labels and a filter. |
| Color suggestion | Studio shows "Sugerido: cálido, −0.3 EV" as a preset. |
| Flight summary | Flight Deck header: distance, maximum altitude, best moment and 2 sentences. |
| Trip recap | Trip page: route map, the 6 best frames and a summary. |
| 3D scene description | Subtitle on the Mundo card and in the info sheet of the viewer. |
| Capture coach | After a 3D job: for example "Faltan ángulos bajos al norte". |
| Map moments | Map pins with a size that shows the highlight score. |

AI output shows as "Sugerido" with accept and dismiss. AI output never replaces the data of the owner.

## Anti-patterns

Do not use these patterns. They make a page look "AI-generated":

- Inter or Roboto with a purple-to-indigo gradient.
- Rows of three identical rounded cards with small icons.
- Gradient text, neon glow, and "Live" or "New" badges on items that are not live or new.
- A thick colored border on one side of a card, or one radius on all items.
- Gray text on a colored background, or wide space between all letters.
- Sparkle icons, chat bubbles for all features, and filler text.
- Glass on glass, or blur on content.
- Stock or AI-generated illustrations. Use the frames of the owner.

## Process

### Preview server

Each worktree runs its own read-only server. POST requests get 403, and the server does not touch production jobs.

```bash
AEROBRAIN_PREVIEW_PORT=8801 python3 pipeline/aerobrain_server.py &
echo $! > .preview.pid                     # stop it later with: kill "$(cat .preview.pid)"
export AEROBRAIN_BASE_URL=http://127.0.0.1:8801
```

CAUTION: Stop the preview server only by its PID. Do not use `pkill` with a pattern, because production runs the same file.

The gates read `AEROBRAIN_BASE_URL`, so they test your preview and not production.

### Waves

| Wave | Content | Agents |
|---|---|---|
| R0 | Read-only bug hunt in 6 areas, and design research | 6 Codex, 1 Claude |
| R1 | Foundation: fonts, tokens, motion, shell navigation, palette, sheet, toast, skeleton | 1 Codex |
| R2 | Page redesigns on the foundation, and backend bug fixes | 4 to 5 Codex |
| R3 | Visual AI features (backend pass, search, collections, summaries) | Codex |
| R4 | Independent design QA and a second bug hunt. Do the loop until each page gets 10/10 | Claude |

### Workstreams

| ID | Owns these files | Depends on |
|---|---|---|
| W1 Foundation | `web/css/shell.css`, `web/shell.js`, `web/vendor/fonts/`, new `web/ui/` components, the `<head>` of each HTML page | none |
| W2 Viajes | `web/home.*`, `web/trips.*`, `web/map.*`, `web/flight.*`, `web/index.html`, `web/app.js`, their CSS | W1 |
| W3 Studio | `web/studio.*`, `web/photoeditor.js`, `web/subir.*`, their CSS | W1 |
| W4 3D | `web/tresd.*`, `web/share.*`, `web/splatlab.*`, `web/splatview.js`, `web/scene-improve*`, `web/mundo.*`, their CSS | W1 |
| W5 Más | `web/drone.*`, `web/system.*`, `web/guia.*`, `web/ventas.*`, `web/p.*`, `web/login.*`, their CSS | W1 |
| W6 Backend | `pipeline/` and `ai/` bug fixes from R0, and the AI pass and APIs for R3 | none |

Flightverse (`web/volar.*`, `web/flightverse/`) has its own plan (`docs/FLIGHTVERSE_DESIGN_SPEC.md`). The redesign changes only its entry in the navigation.

### Success criteria

- `python3 pipeline/run_all_tests.py` passes in the worktree.
- `python3 pipeline/browser_matrix.py <clip_id>` passes on desktop, iPad and phone viewports on the preview server.
- No text is smaller than 12 px on the phone. All touch targets are 44 px or more. Text contrast is 4.5:1 or more.
- No console errors on any page.
- Each page works with `prefers-reduced-motion` and without View Transitions.
- The independent design QA agent gives each page 10/10 on phone and desktop.

## R0 findings

The R0 bug hunt reports are in `/Volumes/SSD/tmp/agents/aerobrain/r0/`. The integrator gives each defect to the workstream that owns the file.
