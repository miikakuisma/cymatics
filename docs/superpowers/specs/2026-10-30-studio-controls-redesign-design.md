# Studio controls redesign: phone first, then desktop

Date: 2026-10-30. Status: agreed in conversation, awaiting final read.

## Why

On a phone, opening the studio (the cog, or the grid / sliders buttons in the
bottom bar) slides two full-height panels over the plate: a list of Looks and
Presets from the left, and a long tabbed column of ~25 sliders from the right.
They overlap each other and the plate, the Tone Generator popup sits on top of
both, and the thing you are adjusting is mostly hidden while you adjust it.
Playing music works well and is out of scope.

The owner's idea, which this design follows: open first to a **compact choice
of looks and presets**, and only on request go into **adjusting**, with the
controls in a compact, horizontally scrolling form like Instagram's photo
editor. On seeing the mockups, the owner asked for desktop to move to the same
organisation, laid out more openly.

## Goals

- On a phone, the plate stays visible and large the whole time the studio is open.
- Picking a look or preset is one tap on a thumbnail, applied live, and you can
  keep flicking through.
- Adjusting shows one control at a time, chosen from a scrolling row of tool
  icons, so you watch the plate change as you drag.
- **Cancel** in the phone editor puts back the settings you had when you tapped
  Adjust; **Done** keeps them.
- Thumbnails are rendered from each preset's actual settings by the engine,
  not hand-drawn art.
- Phone and desktop share one organisation of the controls (the same five
  tabs, below), so learning one teaches the other.

## Non-goals

- The audio source picker (file, radio, mic, tone, music). It stays on the play
  button menu as now. The Tone Generator popup is untouched except that it
  must not collide with the new sheet (see Constraints).
- Player mode (`mode="player"`, the knob UI) and the simple/non-studio UI.
- The preset file format (`src/preset.js`). Thumbnails are not stored in it.
- Engine changes. New controls. Changing what any control does.

## Anti-goals (would be a failure even if it works)

- The plate gets covered again on a phone, by the sheet, the editor, or the two
  stacked.
- Any existing preset renders or loads differently.
- A control that exists today becomes unreachable on either layout.
- Thumbnails make the phone stutter or the sheet slow to open.

## The organisation: five tabs

Every studio control lands in exactly one tab, on both layouts. Controls that do
nothing in the current state are **hidden** (not greyed) on phone, to keep the
icon row short; on desktop they may stay greyed as today (`sourcesOnly`).

| Tab | Controls | Shown only when |
|---|---|---|
| **Shape** | Field, Formation, Distance, Freq Detail, Contour Detail | Formation, Freq Detail, Contour Detail: Field = No plate. Contour Detail also hidden while Liquid is on (`view.js` forces contour off then) |
| **Motion** | Response Speed, Release, Faraday Threshold, Viscosity | Viscosity: Liquid on |
| **Surface** | Liquid, Material, Depth, Ripple Depth, Surface Polish, Caustics, Pool Floor | material-specific ones: only for the material that uses them |
| **Color** | Background Color, Line Color, Emissive Strength, Lights, Light Distance | Lights / Light Distance: Liquid on |
| **Audio** | Audio Gain, Input Sensitivity, EQ | — |

The "only when" column for Surface and Color follows what each control actually
affects in the engine (see the liquid path in CLAUDE.md); the builder confirms
each against `view.js` / the shaders rather than trusting this table blindly.

The existing per-control **Dynamic** toggle (`autoToggle` / `autoKey`, and the
light-colour one) becomes a small **Auto** pill beside the control's name. Its
sub-settings (Band, At silence, At peak, Trigger, Speed) appear when it is on, as
they do now.

## Phone

"Phone" means width ≤ 768px (the existing `_mobileQuery` breakpoint) **or** a
touch device held sideways: `(pointer: coarse) and (max-height: 500px)`. An
iPhone in landscape is 844–932px wide and must not get the desktop panel, which
would cover the plate. *(Builder-check call.)*

In landscape the sheet and editor dock as a narrow column on the right instead
of the bottom, plate on the left; same contents, same order top to bottom.

Rotating or resizing across the breakpoint must not lose an open editor
session: the snapshot outlives the re-render, and if the new layout is desktop
the session ends as Done.

### Opening

- The cog and the bottom bar's **grid** button open the **picker sheet**.
- The bottom bar's **sliders** button opens the picker sheet straight into the
  **editor**.
- Closing: tap the button again, or swipe the sheet down.

### Picker sheet

A bottom sheet, no taller than roughly the lower 40% of the screen, sitting above
the bottom bar. The plate shrinks or shifts up so it is not covered.

- **Looks** row, then **Presets** row: horizontally scrolling thumbnails with a
  name under each. The current one is outlined.
- Presets row order as today: factory presets, then the user's own, then a
  **＋ Save** tile (Save As).
- Tapping a thumbnail applies it immediately (`loadConfig`, as the panel does
  today) and the sheet stays open.
- The user's own presets: rename and delete move to a long-press (or a small
  "⋯" on the selected tile) menu. Host `actions` (the desktop app's extra
  preset buttons) go in that same menu, keeping their `needsSaved` rule.
- **Save** (over the open preset when it is the user's own) and **Set as
  Default** (standalone only) live in that menu or a "⋯" at the sheet's top
  right; ⌘S / ⇧⌘S keep working as now.
- An **Adjust ›** button at the bottom of the sheet opens the editor.

### Editor

Replaces the sheet in the same place.

- Top of screen: **Cancel** (left) and **Done** (right).
- Bottom, upward: tab names (Shape / Motion / Surface / Color / Audio), then a
  horizontally scrolling row of round tool icons for that tab, then the selected
  tool's control.
- A slider tool shows one slider with its name, value, and Auto pill.
- Tools that are not a single slider (Field and Material selects, Liquid toggle,
  Formation, Lights pad, colour pickers, Pool Floor, EQ) open a taller panel in
  the same spot, reusing the existing components (`pole-config`, `xy-control`,
  the colour and image pickers, `p-equalizer`). It may cover more of the plate
  while open, but never all of it.
- The band meter, if kept on phone, is small and does not push the plate down.

### Cancel and Done

- Tapping **Adjust** takes a snapshot of everything the editor can change: the
  preset as `currentPreset()` returns it, the modulator globals
  (`dynamicState`), the EQ, and Input Sensitivity.
- **Cancel** restores that snapshot exactly, without a visible jump beyond the
  settings changing back, and returns to the picker sheet.
- **Done** keeps the changes in the live state and returns to the picker sheet.
  It does not save; saving stays an explicit Save / Save As, as today.
- **Every other way out keeps the edits, as Done does**: the grid / sliders /
  cog buttons, swiping down, the Tab key, crossing to desktop. Only Cancel ever
  reverts, so nothing is thrown away by accident. All routes go through one
  editor-exit function. *(Builder-check call.)*
- Picking a source that loads its own preset (Tone loads a plate via
  `matchSource()`) first ends the edit session as Done, then loads.
- Tapping the plate does **not** close the sheet or editor on phone. Today a
  plate tap clicks every active `p-nav` button (`cymatics-component.js`, around
  line 512), which closes the panels; that is too easy to hit while dragging a
  slider just above the plate. *(Builder-check call.)*

## Desktop (> 768px)

Same organisation, laid out openly, as in the mockup:

- The plate fills the stage. One panel on the right, replacing today's two.
- Top of the panel: **Looks** and **Presets** as thumbnail grids (four across),
  with the ＋ Save tile and the rename / delete / host-action affordances.
- Below: the five tabs, showing **all** of the selected tab's controls at once
  as sliders / components, with Auto pills.
- Bottom: Save, Save As…, Set as Default (standalone only).
- No Adjust mode and no Cancel / Done; changes apply live as today.
- The cog and Tab key toggle the panel as today. The `p-nav` bottom bar stays;
  its grid and sliders buttons both toggle the one panel.

## The mockups

`.superpowers/brainstorm/73042-1793348828/content/mobile-flow.html` and
`desktop-layout.html` illustrate layout and feel. Where they differ from this
document, the document wins: there is no now-playing label, no "‹ Back" level
inside the editor (picking another tool icon is the way back), and slider
values are shown as plain numbers. *(Builder-check call.)*

## Thumbnails

- Rendered by the engine (`src/engine-js/`) on one small hidden canvas, one
  preset after another, then the canvas and its WebGL context are disposed.
  Never one context per thumbnail: browsers cap live WebGL contexts.
- Every thumbnail is driven by the same fixed, music-like spectrum (bass, a
  mid bump and a broad tail), run for enough frames that the envelope has
  settled, so thumbnails are comparable and stable rather than a snapshot of
  whatever is playing. *(Changed during build: the idle swell was tried first
  and left most thumbnails near-black — the plates barely move on it.)*
- Auto modulators **run** in the thumbnail renderer (`src/element/modulate.js`
  plus its band follower, stepped with the envelope), so a thumbnail shows what
  the preset looks like with music playing, Auto colours and detail included.
  All three factory presets have Line Color and Freq Detail on Auto, so base
  values alone would draw a visibly different pattern. *(Builder-check call.)*
- Square, the same crop the plate shows. Size around 128px on the long side,
  device-pixel aware.
- Cached by a hash of the preset's content, kept across visits (IndexedDB,
  alongside `storage.js`, works in the hosted studio too since it keys by
  content, not by preset id). Regenerated when a preset's content changes, and
  rendered at save time for a newly saved preset.
- Rendered lazily, when the sheet / panel first needs them; a plain placeholder
  tile shows until each is ready. Rendering must not drop the live plate's frame
  rate noticeably; yield between thumbnails.
- If WebGL2 is unavailable, or rendering fails, the tile keeps its placeholder
  with the name. The picker still works.

## Constraints

- Vanilla JS web components and CSS, as the rest of `src/components/`. No new
  framework or UI library.
- The studio is also a library (`npm run build:studio`, `mountStudio(root,
  host)`) hosted by the desktop app: everything here must work through the
  `host` seams (`presets`, `chrome.standalone`, `actions`) with no new
  assumptions about storage or chrome. `?host=fake` must keep working.
- Safe areas: the sheet and editor respect iOS's home indicator and Safari's
  bottom toolbar (`env(safe-area-inset-bottom)`).
- The Tone Generator popup (and any other source popup) must not overlap the
  sheet or editor: either it docks above them or they push it.
- Touch targets at least 44px. Horizontal rows scroll by swipe with momentum and
  do not fight the page's own scroll.
- Loading a look / preset must go through the same path as today so modulators,
  legacy keys and `overDefaults` behave identically.

## Order of work

1. Thumbnail renderer (shared by both layouts).
2. Phone: picker sheet, editor, Cancel / Done.
3. Desktop: the single right-hand panel.

Phone ships and gets tried on a real iPhone before desktop starts.

## Left to the builder

- Icons for each tool (consistent set; `src/icons.js` has a few to start from).
- Exact sheet height, animations, and how the plate makes room (shrink vs. shift).
- Whether long-press or "⋯" carries the own-preset menu, as long as both rename
  and delete stay reachable.
- Where Save / Set as Default sit on phone within the sheet.
- Whether the band meter survives on phone.
- How tab and tool selection are remembered within a session.
