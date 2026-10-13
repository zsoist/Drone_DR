# AeroBrain design system

This document describes the W1 foundation for the October 2026 redesign.
The page body remains the responsibility of its workstream.
Use Spanish for interface text.
Use the current local assets. Do not add CDN dependencies.

## Load order

Load `ui/theme.js` and `ui/transitions.js` as classic scripts in the document head.
The head script loads `ui/fonts.css` before page scripts.
Load `css/shell.css` after the page styles to keep the component cascade.
Load `ui/skeleton.css` after the shell styles.
Keep `icons.js` before `shell.js`.
Page scripts call `renderShell()` and get the main element.

The function creates only one shell.

Login requests its local stylesheet and the two public font files.
Its CSS cover does not expose private media.
The current login CSP blocks fonts. Integration needs `font-src 'self'` before the login can use Mona Sans.
That CSP change needs authorization because H0 can edit only the public asset list in the server.

Share, property, and login pages have no app navigation.
Volar uses a separate navigation mount and keeps its canvas layout.

## Fonts

Mona Sans is the interface font. JetBrains Mono is the telemetry font.
The Mona Sans subset uses the family name AeroBrain Sans because its license reserves the original name.
Both fonts use WOFF2, variable weights, and `font-display: swap`.
The files contain Latin characters, Spanish characters, punctuation, and the euro sign.

Mona Sans has the `tnum` feature after the subset operation.
Use `.ui-figure` for separate statistics, telemetry, and timecodes. Use `.ui-unit` for their units.
Keep sentences, metadata lines, and their numbers in Mona Sans.
The older `.ui-figures` class remains an alias.
Set `--figure-width` when a value needs a fixed width.

The font sources, revisions, hashes, and axes are in `web/vendor/fonts/sources.json`.
The source repositories are [Mona Sans](https://github.com/github/mona-sans) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono).
Each font has an OFL license file in the same folder.

## Tokens

All color tokens use OKLCH. Current token names remain available to page code.

| Token | Use |
|---|---|
| `--bg` | Page surface; dark lightness 0.14 |
| `--surface` | Navigation and sheets; dark lightness 0.17 |
| `--surface-2` | Raised content; dark lightness 0.21 |
| `--surface-3` | Selected controls; dark lightness 0.25 |
| `--text`, `--text-2`, `--text-3` | Main, secondary, and quiet text |
| `--line`, `--line-strong` | Inner hairlines and control boundaries |
| `--accent`, `--accent-fg` | Amber fill and text for active states |
| `--data` | Cyan for GPS tracks and charts |
| `--danger`, `--success` | Error and success states |
| `--media-bg` | Pure black behind full-screen media |
| `--r-sm`, `--r-lg`, `--r-xl` | Control, card, and sheet radii: 6, 12, 20 px |
| `--sp-1` through `--sp-10` | 4, 8, 12, 16, 20, 24, 32, 40, 56, 72 px |
| `--fs-xs`, `--fs-sm` | 12 and 13 px |
| `--fs-md`, `--fs-lg` | Phone: 15 and 17 px; desktop: 14 and 16 px |
| `--fs-xl`, `--fs-2xl`, `--fs-3xl` | 20 px; 24–26 px; 30–34 px |
| `--fs-4xl`, `--fs-display` | 40–48 px; 40–64 px |
| `--lh-base`, `--lh-tight` | Body: 1.45; title: 1.1 |
| `--z-base`, `--z-sticky`, `--z-nav` | 0, 20, 100 |
| `--z-overlay`, `--z-modal`, `--z-toast` | 200, 300, 400 |

The light theme uses warm paper surfaces and dark text.
Pair `--accent-solid` with `--text-on-accent`.
Use `--accent-fg` for amber text. It changes with the theme.
Do not use a hairline as the only control state indicator.

Use one glass layer at most. Only the tab bar uses glass in the shell.
Use a solid surface for sheets, dialogs, and content.

Eyebrows use sentence case, the interface font, and the secondary text color.
Use `.ui-eyebrow` for new labels. The legacy `.eyebrow` class uses the same style.

The `--tr-eyebrow` token is `0.01em`. The `--tr-caps` token is `0.02em`.
Set letter space between zero and `0.02em`. Reserve the mono font for telemetry.
Write label text in sentence case. Do not use uppercase mono labels.

## Page layout

Use `.ab-page` on the main element from `renderShell()` for new page layouts.
Use `.ab-page--wide` with `.ab-page` for editors that need more space.
All app pages use these classes.
Login places the form beside a CSS cover on desktop.
The phone form uses the same cover as its background.

| Token or class | Contract |
|---|---|
| `--page-content-max` | Maximum content width: 1280 px, plus the outer padding |
| `--page-editor-max` | Maximum editor width: 1600 px, plus the outer padding |
| `--page-grid-gap` | Space between rows and columns: 24 px |
| `.ab-page` | Centered grid; one column below 1024 px, twelve columns from 1024 px |
| `.ab-page--wide` | Uses the editor width limit |

The grid uses the available width after the desktop rail.
The shell keeps its bottom space for phone navigation and its outer padding from `--main-px`.
Direct children use the full row by default.

Set column spans in page CSS at the desktop breakpoint.
Keep headers across the full row. Put related content and controls in columns next to each other.
Do not add a second narrow container around the page grid.

```js
const main = renderShell();
main.classList.add('ab-page');
// For an editor: main.classList.add('ab-page', 'ab-page--wide');
```

```css
@media (min-width: 1024px) {
  .page-content { grid-column: span 8; }
  .page-controls { grid-column: span 4; }
}
```

## Theme

`AeroTheme.set('dark' | 'light' | 'system')` changes the preference.
`AeroTheme.preference` returns the current preference.
Manual choices use the current `ab_theme` localStorage key.
Storage failures do not stop the page.

The app follows system changes when no manual choice exists.
Guía, Ventas, and Propiedades use light as their default.
The head script restores the preference after the legacy property initializer.
Listen for `ab-theme-change` to update page controls.

## Navigation and palette

Phone navigation has five labeled destinations and a circular search button at the right end of the same bar.
The search target is 44 px. Its screen reader label is Buscar.
The button stays inside the bar and shares its single glass layer.
Do not position search above page content.

The desktop rail starts at 1024 px. Its closed and open widths are 64 and 240 px.
The rail stores its state in `ab_rail`.

The bottom toggle expands or closes it. Closed controls show labels on hover and keyboard focus.
The active destination uses an amber pill. Dots show real activity only.

Más contains four large tiles: Dron, Sistema, Guía, and Ventas.
Each tile has an icon, a label, and one short description.
The theme control sits below the tiles: Automático, Claro, Oscuro.
Other sections remain available through the tabs and palette.
The map and upload aliases keep their current redirects.
The destination state follows the actual URL, with each alias query.

The palette opens with Command+K, Control+K, or the search button.
Arrow keys select a result. Enter opens it. Escape closes the palette.
Search ignores accents and supports ordered partial characters.
Local results remain available if a data source fails.

Each result has an icon and a secondary hint. Matched label characters have an underline and increased weight.
Results appear in groups: Acciones, Secciones, Viajes, Clips, and Mundos.
A query puts the group with the best match first.

An empty query shows Recientes first, followed by actions and sections.
Recientes excludes the current URL. Section hints describe the destination task.
Desktop shows arrow, Enter, and Escape hints. The button to close the panel shows an Esc key cap.

The `ab_palette_recent` key stores the last five unique destinations. Storage errors do not stop navigation.
The shell records section visits. The palette also records destinations opened from registered sources.

The desktop palette is a centered 640 px panel. Its height follows the content, with a maximum of 70vh.
Results scroll within the panel. Its entrance uses a subtle scale and fade.

The shell uses GET `/api/search` for queries with at least two characters.
The source waits 200 ms and cancels the previous request when the query changes.
It caches up to 64 completed queries in memory for the page session.
Clip results keep the server order, even without a literal text match.

Each clip shows `caption_short` and stored match evidence.
Matched tags or caption text explain literal matches.
Semantic results show a stored description or tags. Results without evidence stay hidden.
The source adds dates from the flight manifest and place names from collections.
It never shows coordinates as place names.

A zero or absent matched time does not appear as a highlight.

Clip previews use the filtered `cover` from GET `/api/clip/<clip_id>/insight`.
The shared server filter rejects text, people, quality flags, and dark frames.
Only covers with `quality.eligible: true` appear. An absent or failed cover uses the clip icon.

Covers remain cached for the page session. Failed requests can retry with another query.
The preview represents the clip. The link still opens the matched time.
Never use an unchecked matched frame or thumbnail.

Query-specific results replace duplicate entries from the local index.

The Clips heading shows `Sugerido` once. These read-only results need no accept or dismiss controls.
Enter or a tap opens `flight.html?id=<clip_id>&t=<seconds>`.
A skeleton appears while the request runs. Errors show an inline message and preserve local navigation.

```js
import { registerPaletteSource } from './ui/palette.js';
const unregister = registerPaletteSource(async ({ query, signal }) => {
  const response = await fetch(`/api/search-index?q=${encodeURIComponent(query)}`, { signal });
  // This URL is an example. Supply the endpoint for your workstream.
  return response.json();
});
// Item: {id, label, keywords?, icon?, hint?, group?, href? OR action?}
// Optional: thumbnail, suggested, queryMatch (the source already matched this query).
// unregister();
```

Use the same asset version query as `shell.js` for each module import.

Classic scripts can call the global `registerPaletteSource(fn)` with the same contract.
Use stable item IDs and same-origin links.
Return Spanish labels. Use `action` for a function and `href` for navigation.

Set `group` to Acciones, Secciones, Viajes, Clips, or Mundos.
Set `icon` to a name from `icons.js`. Set `hint` to short Spanish context.
Without these fields, the palette supplies a group icon and a navigation hint.
Actions need specific hints, such as "Abre el editor" or "Sube videos y fotos".
An action without a hint shows only its label.

Clip results use place labels from `/api/collections?all=1`, with membership from `clip_ids`.
If a place label is absent, the source uses the place or trip label of the clip.
If no name is available, it shows "Lugar sin identificar". Never show coordinates as place names.
The palette shows up to 40 search results and five recent destinations.

## Sheet

```js
import { createSheet } from './ui/sheet.js';
const content = document.createElement('p');
content.textContent = 'Tu escena está lista.';
const sheet = createSheet({ title: 'Escena', content, size: 'half' });
sheet.open(button);
// sheet.close(); sheet.setSize('full'); sheet.destroy();
```

`createSheet` accepts `title`, `content`, `size`, `className`, and `onClose`.
It returns `element`, `body`, `open`, `close`, `setSize`, and `destroy`.
Sizes are `peek`, `half`, and `full` on phone.
Desktop sheets open as right panels. The palette opens in the center.

Phone sheets have a visual grab handle. Use the Cerrar button or backdrop to dismiss them.
The handle does not imply a supported drag gesture.
Focus rings appear only with `:focus-visible`.

Native dialogs make the background inert.
The shared layer stack handles Escape and Tab. Close restores focus to the opener.
A backdrop tap closes the sheet. A drag from its content does not.

Use `textContent` for data. Destroy sheets after their last use.

## Toast and activity

```js
import { showToast } from './ui/toast.js';
const dismiss = showToast('Clip eliminado', { undo: restoreClip });
// dismiss();
```

`showToast(message, {undo, duration})` replaces the current toast.
The default duration is 5000 ms. Pointer hover and keyboard focus pause the timer.
Undo messages remain until the user selects Deshacer or Cerrar.
The legacy `toast(message, options)` function returns a Promise for the dismiss function.

```js
import { mountActivity } from './ui/activity.js';
const stop = mountActivity({ interval: 10000 });
// stop();
```

The shell mounts one activity pill. Do not mount another pill in a page.
It reads GET `/api/jobs` and shows queued or active jobs.
A tap opens a Sistema sheet with a link to the full page.

The pill keeps its last count and shows a connection label after a request error.
Hidden pages do not poll. `stop()` removes the pill and its listeners.
Tests can supply `fetchJobs(signal)`, which returns an array or an object with a `jobs` array.

## CSS components

| Class | Contract |
|---|---|
| `.ui-button` | Base control with a minimum 44 px target |
| `.ui-button--primary` | Main action; neutral high contrast |
| `.ui-button--secondary` | Secondary action on a raised surface |
| `.ui-button--quiet` | Quiet action without a filled surface |
| `.ui-button--danger` | Destructive action |
| `.ui-chip` | Static label; use a button for a filter |
| `.ui-segmented` | Group of buttons with `aria-pressed` states |
| `.ui-empty` | One sentence, one main action, one example |
| `.ui-skeleton` | Base placeholder with an opacity pulse |
| `.ui-skeleton--text` | Text placeholder; set `--skeleton-width` |
| `.ui-skeleton--media` | Media placeholder; set `--dominant-color` and `--media-ratio` |

Give segmented controls a group label. Update `aria-pressed` after selection.
Use `aria-busy` on the content region and `aria-hidden` on skeleton elements.
Match the skeleton geometry to the final content.
Page workstreams must check legacy controls for 44 px targets and 12 px minimum text.
New phone inputs must use at least 16 px text.

## Motion

| Token | Duration |
|---|---|
| `--dur-fast` | 140 ms for press and toggle |
| `--dur-base` | 220 ms for menus |
| `--dur-slow` | 340 ms for pages |
| `--dur-sheet` | 450 ms for the sheet spring |
| `--dur-exit` | 150 ms for menu exits |

Animate only transform and opacity. `--ease-spring` uses `linear()` with a fallback curve.
Cross-document transitions need no router. Unsupported browsers use normal navigation.
The head script sets forward, back, or crossfade transition types.
3D pages and Volar use only crossfades.

For shared elements, set `data-transition-key` on one static element per document.
Use the same key on the destination element.
Keys start with `clip-`, `trip-`, `pin-`, or `world-`.
The script sets transition names only during `pageswap` and `pagereveal`.
Do not name a live WebGL canvas.

Reduced motion uses a 150 ms opacity crossfade and a static skeleton.
Page code can read `document.documentElement.dataset.motion`.
When its value is `reduced`, stop automatic previews and camera moves.
Page workstreams own these media behaviors.

## R5 shared APIs

Open `/ui/demo.html` to test the components with archive media.
The demonstration does not change owner data.
Page groups H1–H5 own adoption in their page files.

### Formatting

```js
import { fmt, figure } from './ui/format.js';
fmt.number(1200);        // 1.200
fmt.number(16.24, 1);    // 16,2
fmt.duration(219);      // 3 min 39 s
fmt.duration(4800);     // 1 h 20 min
fmt.distance(1200);     // 1,2 km
fmt.area(16.24);        // 16,2 ha
fmt.date('2026-07-24');  // 24 jul 2026
fmt.relative(timestamp); // hace 2 h
fmt.shutter('1/400.0');  // 1/400
```

Every `fmt` method returns plain text. None adds HTML or font classes.

Numbers use `Intl` with `es-CO`. Dates use the Bogotá time zone.
Pass seconds to `duration`, metres to `distance`, and hectares to `area`.
Pass epoch milliseconds, a Date, or an ISO string to date methods.
Pass seconds or a fraction string to `shutter`.

Absent measurements show an em dash. Absent dates return an empty string.
Negative durations become zero. Durations of one hour or more omit seconds.

Use `fmt.clock(seconds)` only for media positions. `fmt.dur` remains its compatibility alias.
`fmt.km`, `fmt.gb`, and `fmt.hours` remain available for older pages.
Use `duration` for prose, summaries, and flight totals.

The shell remains a classic script. It exposes the same module through `shell.ready`.
New classic consumers must await that promise before they use `shell.fmt`, `shell.figure`, or `shell.term`.
The legacy `fmt` global also points to the shared formatter.
ES pages must import the module directly.

```js
await shell.ready;
const text = shell.fmt.distance(1200);
```

Use `figure(value, unit)` only for a separate statistic, telemetry value, or timecode.
The helper returns escaped HTML. The unit is optional and uses `.ui-unit`.
Pass a formatted value. The helper does not format numbers or parse units.

Do not use it in sentences, card metadata, dates, or count labels.
Remove page helpers that insert figure spans into these text lines.
Page groups own these changes in their files.

```js
summary.textContent = `${fmt.distance(1200)} de recorrido`;
stat.innerHTML = figure(fmt.number(16.24, 1), 'ha');
timecode.innerHTML = figure(fmt.clock(219));
```

### Tabs and segmented controls

The rule is **max one tab layer per page**.
Tabs use an amber underline with neutral text.
Segmented settings use a raised neutral surface inside a shared container.
Do not use tab underlines for settings. Do not add a second tab row.

Use segmented buttons for a setting. Use tabs for panels in the same page.
Do not make segmented settings into another navigation layer.

```html
<div class="ui-segmented" role="group" aria-label="Tema">
  <button type="button" aria-pressed="true">Automático</button>
  <button type="button" aria-pressed="false">Claro</button>
  <button type="button" aria-pressed="false">Oscuro</button>
</div>
<div class="ui-tabs" aria-label="Vista">
  <button type="button" role="tab" aria-selected="true" aria-controls="map-panel">Mapa</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="video-panel">Video</button>
</div>
<section id="map-panel">…</section>
<section id="video-panel" hidden>…</section>
```

```js
import { mountTabs } from './ui/tabs.js';
const tabs = mountTabs(document.querySelector('.ui-tabs'), {
  onChange(tab) { /* Resize the map or pause the hidden video here. */ },
});
// tabs.destroy();
```

`mountTabs` controls panel visibility, labels, selection, and keyboard focus.
Left and Right select the next tab. Home and End select the first and last available tabs.
The selected tab is the only tab stop. The helper skips unavailable tabs.

Setting controls keep normal button focus. Their caller updates `aria-pressed`.

### Suggested content and back links

```js
import { Suggested } from './ui/suggested.js';
container.append(Suggested({
  content: 'Prueba un tono más cálido.',
  onAccept: () => saveOwnerChoice(),
  onDismiss: () => dismissSuggestion(),
}));
container.innerHTML = shell.backLink('Viajes', '/trips.html');
```

`Suggested` returns a section with the label Sugerido and text or a DOM node.
The section must contain the content that its label describes.
Empty content hides the section, its label, and its actions.
The content wrapper remains available for asynchronous updates.
The component shows the section when content arrives. It hides the section if the content becomes empty.

On localhost, the helper also writes a console warning. Whitespace and empty text elements count as empty content.
Media nodes, such as images and videos, count as content.

Both callbacks are optional. Omit them for read-only explanations, such as search results.
Use both for editable suggestions. The callbacks own persistence.

The component turns off actions during a save. An error keeps the content and lets the user try again.
A successful action shows its result. It does not delete owner data.
Use `.ui-suggested-label` for compact disclosures only inside a group that contains the suggested content.
Never place this label beside an empty region or outside the content group.

`backLink` returns escaped HTML for a same-origin link: arrow, then section name.
Do not use a bare chevron or browser history for this control.

### Map skin

```js
import { mapSkinOptions, skinMap } from './ui/map-skin.js';
const map = new maplibregl.Map({
  ...mapSkinOptions, container: 'map', style: mapStyle,
});
const skin = skinMap(map);
// Before page teardown: skin.destroy(); map.remove();
```

Load the local MapLibre stylesheet before `css/shell.css`.
Keep `attributionControl: false` from `mapSkinOptions`.
The helper adds navigation controls and an Info button in the same corner.

Set `navigation: false` only when the map already has navigation controls.
The options supply Spanish labels. The skin supplies Mona Sans and dark 44 px controls in both themes.
Do not place another info button in that corner.

Info opens a sheet with each source attribution and its provider links.
The helper reads attribution from the active style when the sheet opens.
It keeps safe links and text. It does not insert provider HTML.
Keep provider attribution in every raster or vector source.

### Player skin

```js
import { skinPlayer } from './ui/player.js';
const player = skinPlayer(document.querySelector('video'), { label: 'Recorrido del vuelo' });
// Before page teardown: player.destroy();
```

Load `icons.js` and `css/shell.css` before this helper.
Set the actual video source and poster on the video element.
The helper adds play, pause, seek, mute, time, and fullscreen controls.
Controls stay visible on touch screens and support keyboard focus.

The helper removes native controls and does not start playback.
Pause hidden videos when tabs or sheets close.
`destroy()` pauses playback, removes listeners, and restores the original control attributes.
Safari uses native video fullscreen when element fullscreen is unavailable.
Do not describe a source video as an assembled reel.

### Spanish glossary

```js
import { term } from './ui/terms.js';
heading.textContent = term('splat');
```

Use these terms in visible labels. Keep internal keys in requests and stored data.
An unknown key returns unchanged, so callers must use the documented keys.

| Internal key | UI term |
|---|---|
| `splat` | Escena fotorrealista |
| `mesh`, `malla` | Modelo 3D |
| `cloud`, `pointCloud`, `nube` | Puntos |
| `frontier` | Detalle avanzado |
| `grandmaster` | Detalle máximo |
| `gateRush`, `gate-rush` | Carrera de aros |
| `fast` | Vista previa |
| `medium` | Detalle medio |
| `cinematic` | Cinemático |
| `ultra` | Detalle alto |
| `ultra20` | Detalle superior |
| `splatLab` | Taller de escenas |
