# Desktop Studio Implementation Plan

**Goal:** Part 3 of the studio redesign. On desktop (anything not matching
`PHONE_QUERY`) the two overlapping panels (a 260px preset list on the left, a
long control column on the right) become one panel on the right: Looks and
Presets as thumbnail grids, the five tabs with all of a tab's controls, and
Save / Save As… / Set as Default at the bottom. The plate fills the stage left
of it.

**Spec:** `docs/superpowers/specs/2026-10-30-studio-controls-redesign-design.md`,
"The organisation: five tabs" and "Desktop (> 768px)".

**Architecture:** The two components keep their jobs, as on phone:
`cymatics-presets` draws the grids and `cymatics-controls` the tabs and footer.
`mount.js` puts both in one `div.studio-panel`, which is `display: contents`
on a phone (its children are fixed sheets there, unchanged) and the fixed
right-hand column on desktop. The desktop studio's open / closed state moves
from a local in `mount.js` to a tiny module (`src/studio/desk-studio.js`) so
the cog, Tab, both nav buttons and a tap on the plate all toggle the one panel
through one function. The panel's tiles reuse `presets-sheet.js` (tile, row,
menus) and the thumbnail queue; the controls reuse `phone-editor.js`
(`toolWrapper`, `sliderHead`, `EQ_TOOL`) and every existing control builder,
so global selectors and control behaviour are unchanged.

**Global constraints:** vanilla JS + CSS, no new dependencies; host seams only
(`presets`, `chrome.standalone`, `actions` with `needsSaved`); `?host=fake`
keeps working; loading goes through `loadLook` / `loadFactory` / `loadOwn` /
`overDefaults`; no control becomes unreachable; phone unchanged; ⌘S / ⇧⌘S
unchanged; no edits to `src/engine-js/**`, `src/controls.js`,
`src/default-presets.js`, `scripts/**` (another branch owns them).

---

### Task 1: Pure logic

**Files:** `src/studio/control-tabs.js`, `src/studio/desk-studio.js` (new),
`test/control-tabs.test.js`, `test/desk-studio.test.js` (new).

- `irrelevantReason(control, state): string | null`: why a control does
  nothing in the current state ("Not used by plate fields", "Not drawn while
  Liquid is on", "Turn on Liquid to use this", "Water only"), or null.
  `isRelevant` becomes `irrelevantReason(...) === null`, so phone and desktop
  can never disagree about what is relevant.
- `createDeskStudio({ show })` → `{ open, set(on), toggle(), close(), onChange }`;
  `deskStudio()` facade and `initDeskStudio(show)`, like `phoneStudio()`.
- Tests: every reason matches `isRelevant`; the table cases; desk studio
  toggles, notifies once per change, ignores no-op sets.

### Task 2: One panel, shell and plate

**Files:** `src/studio/mount.js`, `src/components/studio-panel.css` (new),
`src/components/p-nav.js`, `src/components/cymatics-component.js`
(plate tap), `src/components/cymatics-component.css`,
`src/components/p-nav.css`, `src/components/p-audio.css`, `styles.css`
(fullscreen button), `test/phone-query.test.js` (new CSS file listed).

- `div.studio-panel` holds `cymatics-presets` then `cymatics-controls`.
  `.desk` on it (desktop layout, set from `phoneQuery()`) makes it a 320px
  fixed column; `body.studio-desk` (desktop studio open) slides it in.
- `setStudio` → `deskStudio().set`; cog, Tab, nav grid, nav sliders and the
  plate tap call `deskStudio().toggle()` / `close()` off a phone.
- The plate: the wrapper stops at the panel; `p-cymatics` is the largest
  square in the stage; canvas scales during the slide and is resized after
  (`fitPlate`'s timer, as on phone). The nav, the source menu, the tone
  controls and the fullscreen button centre on / move clear of the stage.

### Task 3: Looks and Presets grids

**Files:** `src/components/cymatics-presets.js`,
`src/components/cymatics-presets.css`.

- `listDesk()` replaces the old `<ul>` list: a header (open preset's name and
  a ⋯ holding host actions that need no saved preset, hidden when empty),
  Looks grid, Presets grid (factory, own, ＋ Save). The selected own tile's ⋯
  holds Rename, Delete and all host actions (`needsSaved` disabled unless
  own), exactly as on phone. Thumbnails through `paint()`.
- Menu CSS moves out of the phone query (identical rules, so phone is
  unchanged); desktop tile CSS is its own block (4 across).

### Task 4: Tabs, controls and footer

**Files:** `src/components/cymatics-controls.js`,
`src/components/cymatics-controls.css`, `src/components/phone-editor.js`
(desktop shell builder).

- `renderDesk()`: tab row, a scrolling body holding every control in a
  `toolWrapper` (band meter and EQ in Audio), and a footer of Save,
  Save As…, Set as Default (standalone only). All controls stay in the DOM;
  only the selected tab's show.
- Controls use the phone's presentation (name, Auto pill, value) on both
  layouts; `syncDesk()` greys (inert, dimmed, reason as title) whatever
  `irrelevantReason` names, again whenever Field / Liquid / Material change.
- Selected tab shared with the phone editor for the session.

### Task 5: Verify, build, document

- Browser: 1440×900, 1024×768, phone portrait (iframe harness), `?host=fake`;
  no console errors; phone unchanged; widening mid-edit ends as Done.
- `npm test`, `npm run build`, `npm run build:studio`.
- CLAUDE.md: a "Desktop studio" note beside "Phone studio".
