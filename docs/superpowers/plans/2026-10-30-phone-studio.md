# Phone Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the phone studio's two overlapping full-height panels with a picker sheet of rendered thumbnails and an Instagram-style one-control-at-a-time editor with Cancel / Done.

**Architecture:** Pure logic (tab rules, layout query, thumbnail queue, edit session, phone phase machine) lives in small modules under `src/studio/` with `node --test` coverage. The two existing components keep their jobs on phone: `cymatics-presets` becomes the picker sheet and `cymatics-controls` becomes the editor. The editor still builds every control with the existing `createSlider` / `createComponent` and only shows one at a time, so every control keeps today's behaviour and global selectors (`s('xy-control[controls="lights"]')` etc.) keep resolving. Thumbnails come from one short-lived hidden `CymaticsEngine` that applies presets exactly as `<cymatics-view>` does.

**Tech Stack:** Vanilla JS web components, CSS, WebGL2 engine in `src/engine-js/`, IndexedDB, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-studio-controls-redesign-design.md` (covers parts 1 and 2 of its "Order of work"; desktop, part 3, is a separate plan written after this ships and is tried on an iPhone).

## Global Constraints

- Phone = `(max-width: 768px), (pointer: coarse) and (max-height: 500px)`; one constant, used by JS and copied verbatim into CSS media queries.
- Vanilla JS web components and CSS. No new dependencies.
- Must work through the `host` seams (`presets`, `chrome.standalone`, `actions`); `?host=fake` keeps working; `npm run build:studio` and `npm run build:element` keep building.
- No engine changes (`src/engine-js/`), no preset file format changes, no change to how any control acts.
- Loading a look / preset goes through the existing paths (`loadFactory`, `loadOwn`, the look branch, `loadConfig`, `overDefaults`).
- Touch targets ≥ 44px; sheet and editor sit above `env(safe-area-inset-bottom)`.
- The plate is never fully covered on phone.
- Desktop (anything not matching the phone query) must look and behave exactly as today.
- Tests: `npm test`. Dev server: `npm run dev` (port 3000). Phone checks at 390×844 portrait and 844×390 landscape with touch emulation, plus `?host=fake`.

## Review Focus

1. **Cancel after non-slider edits** (Formation, Lights pad, Pool Floor image, Field, Material, colours, EQ, Input Sensitivity): everything returns to how it was at Adjust. Pinned in Task 6's browser check.
2. **Rotating or resizing mid-edit**: phone→phone keeps the session and the selected tool; phone→desktop ends it as Done. Pinned in Task 5's tests and Task 9's browser check.
3. **A thumbnail that cannot render** (no WebGL2, a preset with `lights: []`, a corrupt `floor_image`): the tile keeps its placeholder and name; the picker still works; the live plate is unaffected. Pinned in Task 3's tests and Task 4's browser check.
4. **Tapping thumbnails while thumbnails are still rendering**: the live plate shows the tapped preset; thumbnails finish; no WebGL context is leaked. Pinned in Task 3's tests (dispose after drain) and Task 7's browser check.
5. **Leaving the editor by any route except Cancel** (grid / sliders / cog buttons, Tab key, choosing Tone, crossing to desktop) keeps the edits. Pinned in Task 5's tests and Task 9's browser check.

---

### Task 1: Phone query and tab rules

**Files:**
- Create: `src/studio/layout.js`
- Create: `src/studio/control-tabs.js`
- Modify: `src/controls.js` (add `tab` and `icon` to each entry of `controls`; not `playerKnobs`)
- Test: `test/control-tabs.test.js`

**Interfaces:**
- Produces:
  - `PHONE_QUERY: string` = `'(max-width: 768px), (pointer: coarse) and (max-height: 500px)'`
  - `phoneQuery(): MediaQueryList` (memoised `matchMedia(PHONE_QUERY)`)
  - `TABS: Array<{ id: 'shape'|'motion'|'surface'|'color'|'audio', label: string }>` in that order, labels `Shape`, `Motion`, `Surface`, `Color`, `Audio`
  - `toolId(control): string`: `control.name`, else `control.label.toLowerCase()` (gives `'formation'`, `'lights'`)
  - `isRelevant(control, { cymatics, renderer }): boolean`
  - `toolsFor(tabId, controls, state): control[]` (the tab's controls, in `controls.js` order, filtered by `isRelevant`)

- [ ] **Step 1: Write the failing tests** in `test/control-tabs.test.js`

```js
import { controls } from '../src/controls.js'
const byId = (id) => controls.find((c) => toolId(c) === id)
const ripples = { cymatics: { field_mode: 0 }, renderer: { liquid_mode: false, liquid_material: 0 } }
const plate   = { cymatics: { field_mode: 2 }, renderer: { liquid_mode: false } }
const mercury = { cymatics: { field_mode: 0 }, renderer: { liquid_mode: true, liquid_material: 0 } }
const water   = { cymatics: { field_mode: 0 }, renderer: { liquid_mode: true, liquid_material: 1 } }

test('every studio control has exactly one known tab and an icon')
  // each c: TABS.some(t => t.id === c.tab) && typeof c.icon === 'string' && c.icon.length > 0
test('the spec table: tab membership')
  // shape:   field_mode, formation, view_scale, freq_detail_scale, contour_count
  // motion:  freq_response_speed, freq_release, faraday_threshold, viscosity
  // surface: liquid_mode, liquid_material, water_depth, ripple_depth, surface_polish, caustic_strength, floor_image
  // color:   color_inner, color_outer, emissive_strength, lights, light_distance
  // audio:   audio_amplify_mul, input_sensitivity
  // assert.deepEqual(controls.filter(c => c.tab === t).map(toolId), expected) for each t
test('a plate hides Formation, Freq Detail and Contour Detail')
  // isRelevant(byId(x), plate) === false for formation, freq_detail_scale, contour_count; true for view_scale
test('Liquid on hides Contour Detail; Liquid off hides every liquid-only control')
  // contour_count: ripples true, mercury false
  // with ripples: false for liquid_material, viscosity, ripple_depth, surface_polish, water_depth,
  //   caustic_strength, floor_image, lights, light_distance; true for liquid_mode, emissive_strength
test('water-only controls show for water, not mercury')
  // water_depth, caustic_strength, floor_image: water true, mercury false
  // ripple_depth, surface_polish, viscosity, lights: both true
test('toolsFor keeps controls.js order and filters')
  // toolsFor('shape', controls, plate).map(toolId) deepEqual ['field_mode', 'view_scale']
test('missing config keys read as engine defaults: field 0, liquid off, mercury')
  // isRelevant(byId('contour_count'), { cymatics: {}, renderer: {} }) === true
```

The EQ is not in `controls.js`: Task 8 adds `p-equalizer` to the Audio tab as a tool with id `'eq'`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/control-tabs.test.js`. Expected: FAIL, cannot find module `src/studio/control-tabs.js`.

- [ ] **Step 3: Implement** `layout.js`, `control-tabs.js`, and add `tab` + `icon` to all 23 entries of `controls` in `src/controls.js`. `icon` is a short key into `src/icons.js` (add simple 24×24 `currentColor` SVGs there for any missing). `isRelevant` reads `field_mode ?? 0`, `liquid_mode ?? false`, `liquid_material ?? 0`.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit** `git commit -m "Studio: tab and relevance rules for the phone editor"`

---

### Task 2: One way to put a preset on an engine

`<cymatics-view>._applyLook` already applies a preset the way the thumbnails need (engine defaults under it, modulator keys turned into modulators). Lift it out so the thumbnailer uses the same code.

**Files:**
- Create: `src/element/apply-preset.js`
- Modify: `src/element/cymatics-view.js` (`_applyLook` calls it)
- Test: `test/apply-preset.test.js`

**Interfaces:**
- Produces: `applyPreset(engine, defaults, preset): { mods, lights: Array, viewScale: number }`. `engine` needs only `command(str)`; `defaults` is `{ renderer, cymatics, liquid }`. `mods` is `createModulators(presetModulators(preset), { lights: () => <the returned lights array> })`.

- [ ] **Step 1: Write the failing tests** with a fake engine `{ sent: [], command(s) { this.sent.push(s) } }`:

```js
test('each section is the defaults with the preset over them, modulator keys removed')
  // defaults.cymatics = { view_scale: 0.2, contour_count: 12 }
  // preset.cymatics = { view_scale: 0.1, dynamicFreqDetail: true }
  // sent[1] === 'set cymatics ' + JSON.stringify({ view_scale: 0.1, contour_count: 12 })
  // order of sent: renderer, cymatics, liquid
test('returns the merged lights and view_scale')
  // preset.renderer.lights = [{ pos: [0,0,-10], color: [1,1,1] }] → result.lights deepEqual that; result.viewScale === 0.1
test('a preset with no lights section key gets the default lights; lights: [] stays empty')
test('a missing section is all defaults')
```

- [ ] **Step 2: Run** `node --test test/apply-preset.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `applyPreset`; make `_applyLook` call it and store `mods`, `lights`, `viewScale` on the element, then `_applyZoom()` as before.
- [ ] **Step 4: Run** `npm test && npm run build:element`. Expected: tests pass, build succeeds. Open `http://localhost:3000/element-test.html?look=water` and `?look=lines`: the element renders as before.
- [ ] **Step 5: Commit** `git commit -m "Element: share preset application with the studio"`

---

### Task 3: Thumbnail key and queue

**Files:**
- Create: `src/studio/thumbnails.js`
- Test: `test/thumbnails.test.js`

**Interfaces:**
- Produces:
  - `THUMB_VERSION = 1`
  - `presetKey(preset): string`: hex FNV-1a of `THUMB_VERSION + stableStringify(preset)` (object keys sorted at every depth).
  - `createThumbQueue({ cache, makeRenderer, pause }): { thumbnailFor(preset): Promise<string|null> }`
    - `cache`: `{ get(key): Promise<string|null>, put(key, url): Promise<void> }`
    - `makeRenderer()`: returns `{ render(preset): Promise<string>, dispose(): void }`; may throw (no WebGL2).
    - `pause()`: `Promise<void>` awaited between two renders (production: one `requestAnimationFrame`).

- [ ] **Step 1: Write the failing tests** (fakes count calls):

```js
test('presetKey ignores key order and changes with any value')
  // presetKey({a:1,b:{c:2,d:3}}) === presetKey({b:{d:3,c:2},a:1}); differs from {a:1,b:{c:2,d:4}}
test('a cached thumbnail is returned without rendering')
test('the same preset asked twice at once renders once')
  // Promise.all([q.thumbnailFor(p), q.thumbnailFor(structuredClone(p))]) → both same url; renders === 1
test('renders one at a time, pausing between, and caches each result')
test('the renderer is created lazily and disposed when the queue drains')
  // after three thumbnails resolve: makeRenderer called 1×, dispose 1×; a later request creates a new one
test('a renderer that cannot be made answers null now and later, without retrying')
  // makeRenderer throws → thumbnailFor resolves null; second call: makeRenderer not called again
test('one preset that fails to render answers null; the next still renders')
```

- [ ] **Step 2: Run** `node --test test/thumbnails.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** In-flight requests are de-duplicated by key in a `Map<key, Promise>`; a failed render is not cached.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Studio: thumbnail key and render queue"`

---

### Task 4: Thumbnail renderer and cache

**Files:**
- Create: `src/studio/thumbnailer.js` (WebGL, browser only)
- Create: `src/studio/thumb-cache.js` (IndexedDB, browser only)
- Create: `src/studio/thumbs.js` (wires them: exports the app's single `thumbnailFor`)

**Interfaces:**
- Consumes: `applyPreset` (Task 2), `createThumbQueue`, `presetKey` (Task 3), `idleSpectrum` and `createBandFollower` / `BINS` from `src/element/`.
- Produces:
  - `THUMB_CSS_PX = 64`; pixel size `Math.round(THUMB_CSS_PX * Math.min(devicePixelRatio || 1, 3))`.
  - `createThumbnailer(): { render(preset): Promise<string /* JPEG data URL, quality 0.85 */>, dispose() }`
  - `thumbCache: { get(key), put(key, url) }`: IndexedDB database `CymaticsThumbs` v1, store `thumbs`, keyPath `key`, plus an in-memory `Map` in front. Every IndexedDB failure resolves `null` / no-op. Do not touch `ScenesDB`.
  - `thumbnailFor(preset): Promise<string|null>` from `src/studio/thumbs.js`.

- [ ] **Step 1: Implement `createThumbnailer`.**
  - It owns one detached `<canvas>` at the pixel size and `new CymaticsEngine(canvas, { cymaticsSize: 512 })`. It records defaults the way `cymatics-view._mount` does, and never calls `engine.start()`.
  - `render(preset)`:
    1. Call `applyPreset`.
    2. If `preset.renderer?.floor_image`, `await engine.uploadFromSrc('refraction', floor_image)`.
    3. Run `THUMB_FRAMES = 90` frames with fixed `dt = 1/60`. Each frame does what `engine.start()`'s loop does: bind the default framebuffer, clear, push `idleSpectrum(i * dt, buf)` with sample rate 48000, step a fresh band follower and `mods` (writing back through `engine.command`, with `view_scale` set on `engine.view.cymatics.viewScale`), then `view.update(dt)` and `view.render(px, px)`.
    4. In the same task as the last render, `drawImage` the canvas onto a 2D canvas and return `toDataURL('image/jpeg', 0.85)`.
  - Frame 90 at 1/60 ends at t = 1.5 s, the idle swell's peak.
  - `dispose()`: `engine.dispose()`, then `WEBGL_lose_context`, as `cymatics-view._teardown` does.
- [ ] **Step 2: Implement `thumb-cache.js` and `thumbs.js`** (`pause` = one `requestAnimationFrame`).
- [ ] **Step 3: Verify in the browser.** On `npm run dev`, in the console at `http://localhost:3000`:
  ```js
  const { thumbnailFor } = await import('/src/studio/thumbs.js')
  const { LOOKS, lookPreset } = await import('/src/element/looks.js')
  const { defaultPresets } = await import('/src/default-presets.js')
  for (const p of [...LOOKS.map(l => lookPreset(l.id)), ...defaultPresets.map(f => f.preset)]) { const u = await thumbnailFor(p); const i = new Image(); i.src = u; document.body.append(i) }
  ```
  Expected:
  - Seven images, each recognisably the same look as tapping it in the studio with nothing playing (Round Plate round, Square Plate square, Lines as lines).
  - A second run returns instantly from cache.
  - `thumbnailFor({ ...defaultPresets[0].preset, renderer: { ...defaultPresets[0].preset.renderer, lights: [] } })` and one with `floor_image: 'data:image/jpeg;base64,AAAA'` each resolve to a URL or `null` without throwing, and the live plate keeps running.
  - If 512 visibly coarsens contour lines next to the live plate, raise `cymaticsSize` to 1024.
- [ ] **Step 4: Commit** `git commit -m "Studio: render preset thumbnails with the engine"`

---

### Task 5: Edit session and phone phases

**Files:**
- Create: `src/studio/edit-session.js`
- Create: `src/studio/phone-studio.js`
- Test: `test/phone-studio.test.js`

**Interfaces:**
- Produces:
  - `createEditSession({ capture, restore }): { begin(), cancel(), done(), get active(): boolean }`. `begin` while active keeps the first snapshot; `cancel` restores and ends; `done` ends without restoring; both are no-ops when inactive. `capture()` is called once per session; `restore` gets that exact snapshot object.
  - `createPhoneStudio({ session, show }): { get phase(): 'closed'|'picker'|'editor', open(phase), close(), cancel(), done(), leavePhone(), onChange(fn): () => void }`
    - `show(phase)` applies the phase to the DOM; it is called on every change.
    - Entering `'editor'` calls `session.begin()`.
    - Leaving the editor by `cancel()` calls `session.cancel()` and goes to `'picker'`.
    - Every other way out (`done()`, `open('picker')`, `close()`, `leavePhone()`) calls `session.done()`.
    - `done()` and `cancel()` go to `'picker'`; `close()` and `leavePhone()` go to `'closed'`.
  - `src/studio/phone-studio.js` also exports the app's instance `phoneStudio`, made lazily on first use with the capture/restore from Task 6 and the `show` from Task 9 (export `initPhoneStudio({ capture, restore, show })` and `phoneStudio()` getter, as `host()` does).

- [ ] **Step 1: Write the failing tests:**

```js
test('Adjust then Cancel restores the snapshot taken at Adjust and returns to the picker')
test('Done keeps changes: restore never called; phase picker')
test('closing from the editor keeps changes and closes')
test('opening the picker from the editor keeps changes')
test('leavePhone from the editor keeps changes; from closed does nothing')
test('re-entering the editor while already in it does not take a new snapshot')
  // capture called 1× across open('editor'), open('editor')
test('cancel or done outside the editor changes nothing')
test('show and onChange fire once per phase change, with the new phase')
```

- [ ] **Step 2: Run** `node --test test/phone-studio.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Studio: phone phases with an Adjust session Cancel can undo"`

---

### Task 6: Capture and restore what the editor can change

**Files:**
- Create: `src/studio/studio-snapshot.js`
- Modify: `src/components/p-equalizer.js` (add `get gains(): number[]` and `setGains(gains: number[])`, in `equalizerDefaults` order; `setGains` sets `window['eq'+f].gain.value` when the filter exists, updates `this.bands`, and re-renders its sliders)
- Modify: `src/components/p-audio.js` (`setInputGain` records `this.inputGain = value`; `inputGain` starts at `1`)

**Interfaces:**
- Consumes: `currentPreset()` from `src/components/cymatics-presets.js`.
- Produces:
  - `captureStudio(): { preset, eq: number[], inputSensitivity: number }`. `preset` is `structuredClone(currentPreset())`. `eq` is `s('p-equalizer')?.gains ?? []`. `inputSensitivity` is `s('p-audio')?.inputGain ?? 1`.
  - `restoreStudio(snapshot): void`:
    1. `s('p-cymatics').loadConfig(structuredClone(snapshot.preset))`.
    2. `s('p-equalizer')?.setGains(snapshot.eq)`.
    3. `s('p-audio')?.setInputGain(snapshot.inputSensitivity)`, and set the `input_sensitivity` slider's value to `snapshot.inputSensitivity * 100`.
    - It does not touch `cymatics-presets.current`.

- [ ] **Step 1: Implement** the three changes.
- [ ] **Step 2: Verify in the browser** on the desktop layout, which is still the old one: in the console, `const { captureStudio, restoreStudio } = await import('/src/studio/studio-snapshot.js'); const snap = captureStudio()`. Then change each of these:
  - Formation
  - one Lights handle position
  - Pool Floor (pick an image)
  - Field
  - Material
  - Line Color
  - one Auto toggle and its Band
  - one EQ band
  - Input Sensitivity
  - Release

  Run `restoreStudio(snap)`. Expected: the plate and every one of those controls are back as before. `JSON.stringify(captureStudio()) === JSON.stringify(snap)`.
- [ ] **Step 3: Commit** `git commit -m "Studio: snapshot and restore everything the editor changes"`

---

### Task 7: The picker sheet (phone `cymatics-presets`)

**Files:**
- Modify: `src/components/cymatics-presets.js`
- Modify: `src/components/cymatics-presets.css`
- Modify: `src/components/cymatics-controls.js` (Set as Default moves out of `initButtons` into `cymatics-presets.setAsDefault()`; the button calls it)

**Interfaces:**
- Consumes: `phoneQuery` (Task 1), `thumbnailFor` (Task 4), `phoneStudio()` (Task 5).
- Produces:
  - `cymatics-presets` methods `loadLook(look)` (the look branch of `listPresets`, extracted unchanged) and `setAsDefault()`.
  - On phone, `listPresets()` renders the sheet below instead of the list.

- [ ] **Step 1: Implement the phone render** (desktop `listPresets` output unchanged). Inside `.presets.sheet`:
  - **Header:** the current preset's name on the left, a `⋯` button on the right. The menu holds Save, and Set as Default only when `host().chrome.standalone`.
  - **Looks row:** one tile per `LOOKS` entry. Tapping calls `loadLook`.
  - **Presets row:** factory presets (tap: `loadFactory`), then `this.mine` (tap: `loadOwn`), then a `＋ Save` tile (tap: `saveAs`).
  - **Own-preset menu:** the selected own tile shows a `⋯` badge. Its menu holds Rename, Delete, then each `host().actions` entry, disabled unless `needsSaved` is satisfied.
  - **Adjust ›** button: `phoneStudio().open('editor')`.
  - **Tiles:**
    - Each tile is a ≥ 56px square `<img>` plus its name. The current tile is outlined.
    - The placeholder is a dark tile until `thumbnailFor(preset)` resolves. For own presets, the preset comes from `host().presets.read(id)`.
    - On `null` the placeholder stays.
    - Rows scroll horizontally with `overflow-x: auto; scroll-snap-type: x proximity; overscroll-behavior-x: contain`.
  - **Menus:** small popovers anchored to their button, closed by tapping outside.
  - **Visibility:** the sheet is shown and hidden by the `visible` attribute, as today; on phone it slides up from the bottom instead of from the left.
- [ ] **Step 2: CSS**, inside `@media (max-width: 768px), (pointer: coarse) and (max-height: 500px)`:
  - The sheet sits above the 48px nav and `env(safe-area-inset-bottom)`.
  - Height at most `40vh` (`40dvh` where supported).
  - In landscape (`(orientation: landscape)` within the query) it becomes a right-hand column 300px wide, the full height above the nav.
- [ ] **Step 3: Verify** at 390×844 with touch emulation, opening via the console `phoneStudio().open('picker')` until Task 9 wires the buttons:
  - Both rows scroll.
  - Tapping tiles applies them live and the outline moves. Tapping several while thumbnails are still loading shows the last tapped one on the plate.
  - `＋ Save` saves and the new tile appears with its thumbnail.
  - Rename and Delete work.
  - `?host=fake` shows the host actions.
  - On desktop width, the old panel appears unchanged.
- [ ] **Step 4: Commit** `git commit -m "Phone studio: looks and presets as thumbnail rows"`

---

### Task 8: The editor (phone `cymatics-controls`)

**Files:**
- Modify: `src/components/cymatics-controls.js`
- Modify: `src/components/cymatics-controls.css`

**Interfaces:**
- Consumes: `phoneQuery`, `TABS`, `toolId`, `isRelevant`, `toolsFor` (Task 1), `phoneStudio()` (Task 5).
- Produces:
  - On phone, `cymatics-controls` renders the editor.
  - `this.tab` (default `'motion'`) and `this.tool` (default the first relevant tool of the tab) survive `render()`, which `loadConfig` calls on every preset load.
  - `isMobileStudio` uses `phoneQuery()` in place of `_mobileQuery`.

- [ ] **Step 1: Replace the `isMobileStudio` markup**, top to bottom:
  - **Top bar** (fixed to the top of the screen): Cancel → `phoneStudio().cancel()`, Done → `phoneStudio().done()`.
  - **`.tool-area`:** every control is still built by `createSlider` / `createComponent`, inside a `<div class="tool" data-tool="{toolId}" data-tab="{tab}">` wrapper, plus one `data-tool="eq"` wrapper in the audio tab holding `<p-equalizer>`. Only the selected tool's wrapper is displayed. Wrappers marked `.tall` (components, the EQ, and any slider whose Auto is on) get the taller area.
  - **Icon row:** one round button per `toolsFor(this.tab, controls, engine.state)` plus EQ on the audio tab. Each shows `icons[control.icon]` and its label; the selected one is highlighted.
  - **Tab row:** `TABS` labels.
  - **Auto pill:** the existing ` Dynamic` checkbox label becomes a pill reading `Auto`, placed beside the slider's name. Its sub-controls stay as built, shown under the slider while on.
  - **Hidden controls:** `applyFieldMode()` on phone hides irrelevant tools (both the icon and the wrapper) using `isRelevant` instead of greying them, and runs again on every change to `field_mode`, `liquid_mode` or `liquid_material`. If the selected tool becomes hidden, select the tab's first visible tool.
  - Remove the old `.tab-bar` / `.tab-content` / `.sticky` phone markup and `initTabs`.
- [ ] **Step 2: CSS** (same phone query):
  - The slider area is about 96px tall; the `.tall` area is at most `45vh`.
  - Icons are 44px round buttons; the icon and tab rows scroll horizontally.
  - In landscape, the same stack sits in the right-hand 300px column.
- [ ] **Step 3: Verify** at 390×844, opening with `phoneStudio().open('editor')`:
  - Every one of the 23 controls plus EQ can be reached and works on some preset (Water for the water ones).
  - Switching a preset re-renders without losing the selected tab or tool.
  - On a plate, Formation, Freq Detail and Contour Detail are gone from Shape.
  - With Liquid off, Surface shows only Liquid; Color shows no Lights.
  - Cancel restores (Task 6's list); Done keeps.
  - Desktop width is unchanged.
- [ ] **Step 4: Commit** `git commit -m "Phone studio: one-control-at-a-time editor"`

---

### Task 9: Wiring, room for the plate, and docs

**Files:**
- Modify: `src/studio/mount.js` (call `initPhoneStudio`; `toggleStudio` and the Tab key: on phone, `closed → open('picker')`, otherwise `close()`; on desktop as today)
- Modify: `src/components/p-nav.js` (on phone, grid: `phase === 'closed' ? open('picker') : close()`; sliders: `phase === 'editor' ? close() : open('editor')`; the `activated` class follows `onChange`)
- Modify: `src/components/cymatics-component.js:~512` (the plate click does nothing while `phoneQuery().matches`)
- Modify: `src/components/cymatics-presets.js` and `cymatics-controls.js` (a downward swipe of at least 60px that starts on the sheet's header or the editor's tab row calls `phoneStudio().close()`; rows scrolling sideways never trigger it)
- Modify: `src/components/cymatics-presets.js` (`matchSource`: before loading, `if (phoneStudio().phase === 'editor') phoneStudio().done()`)
- Modify: `src/components/cymatics-component.css` (the old `.controls-open` rules are replaced by `.cymatics-wrapper.sheet-picker`, `.sheet-editor` and `.sheet-editor-tall`, which shrink the plate to the space above the sheet; in landscape they shrink its width instead)
- Modify: `src/components/p-audio.css` (inside the phone query, while the body has class `phone-sheet-open`, the source popup docks directly above the sheet / editor instead of overlapping it)
- Modify: `CLAUDE.md` (in "The studio as a library" or a new "Phone studio" paragraph: the phone query, picker / editor, the Cancel rule, thumbnails and their cache database)

**Interfaces:**
- Consumes: everything above. `show(phase)`:
  - Sets `visible` on `cymatics-presets` (`picker`) and `cymatics-controls` (`editor`), one at a time.
  - Sets the wrapper class (`sheet-picker` / `sheet-editor` / `sheet-editor-tall` from the editor's selected tool).
  - Toggles `phone-sheet-open` on `body`.
  - Toggles `studio-active` as `toggleStudio` does.
- On `phoneQuery()` change to not-phone: `phoneStudio().leavePhone()`, then the existing desktop re-render. A phone→phone change (rotation) re-renders without touching the phase.

- [ ] **Step 1: Implement** the wiring above.
- [ ] **Step 2: Verify** with touch emulation at 390×844, at 844×390, and at `?host=fake`:
  - The cog, the grid button and Tab open the picker; the sliders button opens the editor; swiping the sheet down closes it, keeping edits.
  - The plate is visible in every phase and orientation, and tapping it closes nothing.
  - Rotating mid-edit keeps the session and the selected tool; Cancel afterwards still restores.
  - Widening to desktop mid-edit keeps the edits and shows the old desktop panels.
  - Choosing Tone mid-edit ends the session, keeps the edits, then loads Round Plate.
  - The Tone popup sits above the sheet without overlapping.
  - `npm test`, `npm run build`, `npm run build:studio` and `npm run build:element` all succeed.
- [ ] **Step 3: Try it on an iPhone** over the LAN dev server (`npm run dev` binds `--host`): portrait, landscape, Safari's bottom toolbar, the home indicator. Note anything off for a follow-up before desktop starts.
- [ ] **Step 4: Commit** `git commit -m "Phone studio: wire the sheet and editor into the app"`
