# Cymatics - CLAUDE.md

## Project Overview

**Cymatics** ("Another Dimension of Music") is a web app that visualizes how sound waves affect a fluid surface in real time. Audio input (files, radio streams, microphone) drives a WebGL2 simulation that renders dynamic cymatic wave patterns on an HTML5 canvas.

Pure JavaScript — no build step beyond Vite, no native toolchain.

## Build Commands

```bash
npm install
npm run dev      # Vite dev server on :3000 (`start` is an alias)
npm run build    # Production build into dist/
npm run preview  # Serve the production build
```

## Web component

`<cymatics-view>` puts the engine on any page with one module and no build step:

```bash
npm run build:element   # → dist-element/cymatics-view.js, one ES module, no imports
npm test                # node --test over the element's pure modules (test/)
```

```html
<script type="module" src="cymatics-view.js"></script>
<cymatics-view look="water"></cymatics-view>
```

- Attributes `look` (`water`, `mercury`, `lines`, `glow`: `src/element/looks.js`) and `max-dpr` (default 2).
- Properties `look`, `paused`, `zoom` (1 = as authored, scales `view_scale`), read-only `supported`.
- `connect(audioNode)` taps a Web Audio node and returns a disconnect function; `push(bins, sampleRate)` takes 1,024 bins of 0..1 from anything else. With neither, it eases into an idle swell (`src/element/idle.js`).
- `cymatics-unsupported` fires, synchronously on connect, when WebGL2 is missing.
- The module also exports `LOOKS`, `DEFAULT_LOOK`, `BINS`, `FFT_SIZE` and `createSpectrumTap(node)`.

The canvas is a square on the box's longer side, centred and cropped: the engine samples its
square wave field across the whole canvas, so a 16:9 canvas would stretch the pattern.
`element-test.html` on the dev server drives it with a synthetic song (`?look=…`).

## The studio as a library

`npm run build:studio` → `dist-studio/cymatics-studio.js` + `style.css`: the whole studio,
mounted by `mountStudio(root, host)`. The desktop's Cymatics app hosts it.

`host` (`src/studio/host.js`) is three seams: `presets` (list/read/save/rename/remove;
standalone: IndexedDB through `storage.js`), `sources` (`file`, `mic`, `radio`, `tone`, or `music`
with an `external.subscribe(onFrame)`), `chrome.standalone` (the about modal, the simple
UI, Set as Default), plus `actions` for the presets panel. `?host=fake` on the dev server
runs a hosted studio on a synthetic spectrum.

A preset file (`src/preset.js`) wraps the studio's preset as
`{ format: 'cymatics', version: 1, preset }`. Modulators are the studio's saved keys
(`dynamicLineColor…`), run by `src/element/modulate.js` everywhere: the studio, the element,
Music and the desktop. The studio keeps them as `window.__…` globals for its panel;
`src/dynamic-state.js` moves them in and out of a preset.

## Phone studio

A phone is `(max-width: 768px), (pointer: coarse) and (max-height: 500px)` —
`PHONE_QUERY` in `src/studio/layout.js`, copied verbatim into the CSS — so a phone
held sideways is still one. There the studio is three phases (`src/studio/phone-studio.js`):
closed, the **picker** (`cymatics-presets` as a bottom sheet of look and preset
thumbnails) and the **editor** (`cymatics-controls`, one control at a time under five
tabs, `src/studio/control-tabs.js`); sideways both are a 300px column on the right.
The cog, Tab and the nav's grid open the picker; its Adjust (in the sheet's header,
so no screen height hides it), or the nav's sliders,
opens the editor. `mount.js` `show()` puts each phase on screen. The plate is sized by
`fitPlate`, which measures the space the open panel leaves — upright, above the sheet
(and below Cancel / Done in the editor); sideways, left of the column and above the
nav — into `--plate-top`, `--plate-bottom` and `--plate-width`, again whenever the panel
changes size (a ResizeObserver). `.sheet-picker` / `.sheet-editor` on the wrapper only
say which panel is open.

Adjust snapshots everything the editor can change (`src/studio/studio-snapshot.js`).
**Only Cancel reverts it.** Every other way out keeps the edits, as Done does: the
nav buttons, the cog, Tab, swiping the sheet's header or the editor's tabs down
(`src/studio/swipe.js`), widening to desktop, a source that loads its own
preset (`matchSource`), and a host opening a preset (`open`). An own preset still
being read when Adjust is tapped is dropped, not loaded after the snapshot. A tap on the plate closes nothing on a phone.

Thumbnails are the real engine (`src/studio/thumbnailer.js`) driven by one fixed,
music-like spectrum (`thumbSpectrum`), not the idle swell, rendered one at a time
(`thumbnails.js`, `thumbs.js`), each spread over several animation frames so the
live plate keeps its frame rate and cached in their own IndexedDB database,
`CymaticsThumbs` (`thumb-cache.js`). The sheet's and editor's parts are built in
`src/components/presets-sheet.js` and `phone-editor.js`.

## Project Structure

The repository root *is* the app — Vite, vanilla JS web components, and the engine.

- `src/engine-js/` — the engine. WebGL2, self-contained, including its GLSL in `shaders/`. See its README.
- `src/element/` — `<cymatics-view>`, the engine as a web component for other pages (below).
- `src/components/` — UI web components and the audio pipeline.
- `docs/` — design notes.
- `engine-test.html` — dev-only harness that drives the engine with a synthetic spectrum (`?mode=emissive|pbr`, `&field=square|round`). Not in the production build.

## Architecture

```
HTML5 Canvas ← Engine (src/engine-js/, WebGL2)
                    ↕ Command API (text, for presets and existing call sites)
                    ↕ pushAudioSpectrum(Float32Array) / upload(target, bytes)
               Web UI (Vite + Web Components + Web Audio API)
```

Essentially all work is on the GPU. Per frame the JS averages ~1,030 FFT bins into 4 bands, sets uniforms, and issues the draw calls — that is the entire CPU cost.

### Engine API

**Text commands** via `engine.sendCommand(str)`:
- `set renderer <json>` / `get renderer` — PBR lighting, reflection, refraction, emissive params
- `set cymatics <json>` / `get cymatics` — wave field, poles, audio params
- `set liquid <json>` / `get liquid` — fluid dynamics params

New code can also reach `engine.view.cymatics`, `.renderer`, `.liquid` and set properties directly.

**Audio**, once per frame: `engine.pushAudioSpectrum(bins, numBins, sampleRate)`.

**Textures**: `engine.upload('reflection' | 'refraction', bytes)` — raw encoded PNG/JPEG, decoded by the browser.

### Envelope

`cymatics.js` runs a per-band envelope follower. `freq_response_speed` sets the
attack and the base decay, as it always did; `freq_release` then scales that
decay by up to 32x either way, logarithmically, and is **neutral at its 0.5
default** — so presets that predate it render identically and need no conversion.

Release deliberately scales the decay rather than replacing it. Owning the fall
outright leaves Response Speed governing only the rising edge, which measures as
a collapse of its tracking-error range from 0.231..0.046 down to 0.142..0.094 —
the slider still sharpens attacks but stops reading as "speed", because the fall
is at least half of what the eye sees as motion.

Raising Release is what stops the picture strobing on fast material. At Response
Speed 1.0 the level between beats goes from 0% of peak at the neutral default to
31% at Release 0.85.

### Audio Pipeline

JS captures audio via Web Audio API (`src/components/p-audio.js`):
1. Source (file/stream/mic) → EQ chain → AnalyserNode (2048-point FFT)
2. Each frame: `getFloatFrequencyData()` → normalize to 0..1 → `pushAudioSpectrum`
3. The engine folds the bins into 4 bands and drives wave excitation

### Radio streaming

A station is played twice over. The `<audio>` element makes the sound, and a
second `fetch` of the same URL is cut on MPEG frame boundaries (`src/mpeg.js`),
decoded with `decodeAudioData` and scheduled as buffer sources into the analyser
chain at a gain of zero.

The obvious path — one element, `createMediaElementSource` — is what this
replaced. **Safari hands the analyser silence for cross-origin media**, even
when the stream sends CORS headers, so it left the plate dead on every iPhone
and every Mac not running Chrome; the radio menu used to be hidden on iOS for
exactly that reason. The design comes from an earlier project, where the three
candidate paths were measured on a real device.

The two halves fail independently on purpose:

- The element carries no `crossorigin` attribute, so it needs no permission from
  the station. SomaFM refuses any request carrying an `Origin` header — it plays
  in the element and 403s the copy, and the result is a station you hear with a
  plate at rest, which is why the shipped `defaultStations` are ones whose bytes
  can be read as well as played.
- If the element will not play (autoplay refusal, a codec it lacks), the graph
  sounds the decoded copy instead — quieter on iOS, where Web Audio sits on the
  ringer's volume curve rather than the media one. An element that starts late
  takes the sound back (`onplaying`), because otherwise both play at once.

Decoding a stream in lumps has two arithmetic traps, both handled in
`src/mpeg.js` and documented there: Layer III frames borrow bytes from their
predecessors (the bit reservoir), so each lump is fed the previous lump's last
frames as warm-up and their samples are then skipped; and `decodeAudioData`
treats every lump as a whole file, emitting its own startup silence, which is
measured rather than assumed. `scan(fed)` must be taken **before** the decode
call — `decodeAudioData` detaches the buffer it is given.

The copy is kept close to the live edge (`STREAM_MAX_PLATE_AHEAD`) whenever the
element is sounding the station: a station opens by sending several seconds at
once, and left alone that backlog becomes a standing two-to-three second gap
between the music and the picture.

### Fields

`field_mode` (the studio's **Field**) picks what the music excites: **0**
radiating sources, the default every existing preset uses; **1** a square plate
and **2** a round plate, ringing their own standing-wave modes (Chladni
figures), from `src/engine-js/modes.js`. On a plate, Distance (`view_scale`) is
the plate's size and so its level of detail, contour mode draws only nodal
lines, and Freq Detail, Contour Detail and Formation do nothing — the studio
greys them out (`sourcesOnly` in `controls.js`). Details in the engine README.

The **Tone Generator** source (`tone`, `p-audio.js`) plays one sine — 20 Hz–10 kHz
on a logarithmic slider, or any typed value from 1 Hz to 20 kHz — for finding
what a single frequency does to a plate. It is heard at 0.15 gain; the analyser
still gets it at full level.

### Render paths

`view.js` picks one of four, in this order:
1. **Liquid** (`liquid_mode` on) — height field shaded as a liquid surface, 3 passes (2 at zero viscosity). `liquid_material` picks mercury (0) or water (1). Wins over everything else, and forces `contour_mode` off for its own pass: contour lines carry no usable gradient for surface normals.
2. **Contour** (`contour_mode > 0.5`, emissive off) — height field straight to screen, 2 passes.
3. **Emissive** (`emissive_mode` on) — colourised height field, 2 passes. **This is the shipped default**; the fluid solver and PBR shader are allocated but never run.
4. **PBR** — fluid sim → temporal blend → PBR shading, ~52 passes.

The liquid path repurposes the two colour pickers per material. Mercury:
`color_outer` is the metal's tint (renormalised into the 0.5–0.95 reflectance
range real metals occupy), `color_inner` the ambient. Water: `color_outer` is the
body tint driving Beer-Lambert absorption, `color_inner` the pool floor. Existing
presets therefore stay meaningful with the toggle on.

Water's pool floor is either `floor_image` — a downscaled JPEG data URL stored
inside the preset, cover-fitted to the frame — or, when that is empty, an empty
black floor: what the factory Default's `/empty.png` gave, without fetching it
(`preset.js` turns that old path into `''`). The shader's procedural tile grid is
no longer reached. The refraction warp is kept to a few percent of the frame:
a repeating grid hides a much larger displacement, but a fitted image does not.

Its lights come from `renderer.lightsAuthored`, driven by the `xy-control` pad in
the control panel. Each `pos` is normalised to a direction through `abs(z)`, with
x and y spread 4x so the pad has authority across the whole `light_distance`
range. **The look is sensitive to light count**: a single near-overhead light on
a smooth field leaves most of the frame outside every specular lobe and the
surface goes dull. Two lights, or a detailed field, avoids that.

Note that `view_scale` in the shipped presets is tuned around contour mode, where
`contour_count` multiplies one wave period into ~15 lines; the smooth field
wants a considerably larger value.

### Key Engine Files

| File | Purpose |
|------|---------|
| `src/engine-js/index.js` | Entry point, render loop, command API, audio/texture ingest |
| `src/engine-js/cymatics.js` | Wave field: envelope follower + uniform setup |
| `src/engine-js/modes.js` | Plate modes: Bessel functions, mode lists, picking |
| `src/engine-js/liquidsim.js` | Ping-pong Jacobi pressure solver |
| `src/engine-js/renderer.js` | PBR/refraction uniforms, emissive colour state |
| `src/engine-js/view.js` | Render path selection, pass sequencing |
| `src/engine-js/glutil.js` | Programs with uniform caching, FBOs, textures |
| `src/engine-js/shaders/main_liquid.fsh` | Mercury and water shading — procedural studio environment |
| `src/engine-js/shaders/liquid_accum.glsl` | Viscosity: blur-and-blend wave field inertia |
| `src/engine-js/shaders/` | GLSL, `#version 300 es` |

### Key Web Files

| File | Purpose |
|------|---------|
| `src/index.js` | App bootstrap, PWA setup, drag-and-drop |
| `src/components/cymatics-component.js` | `engineApi`, `engine` class, canvas lifecycle |
| `src/components/p-audio.js` | Audio pipeline (Web Audio API → engine) |
| `src/components/cymatics-controls.js` | Control panel UI (sliders, knobs, XY pads) |
| `src/components/cymatics-presets.js` | Preset save/load UI |
| `src/components/p-equalizer.js` | 9-band EQ UI |
| `src/controls.js` | Definitions of all controllable parameters |
| `src/mpeg.js` | MPEG Layer III frame parsing: cut a stream where a decoder accepts it |
| `src/image-util.js` | Downscale + JPEG-encode a picked image to a preset-sized data URL |
| `src/default-presets.js` | Factory preset configurations |
| `src/storage.js` | IndexedDB CRUD for user scenes |

Global shorthand defined in `index.html`: `window.s = querySelector`, `window.sAll = querySelectorAll`.

## Engine State

```js
engine.state = {
  ready: bool,
  rendererConfig: { metalness, normal_power, emissive_mode, color_inner, ... },
  cymaticsConfig: { audio_amplify_mul, poles, wave_center, view_scale,
                    contour_mode, faraday_threshold, freq_detail_scale, ... },
  liquidConfig:   { liquidity_slowdown, pressure_leak, speed_mul,
                    velocity_slowdown, pressure_iterations, ... }
}
```

## Known quirks

Two behaviours are preserved deliberately because saved presets are tuned around them; both are flagged in the source and only affect the non-default PBR path:

- `liquidsim.js` — `liquidity_slowdown` writes `velocitySlowdown`, so `liquiditySlowdown` can never be set from a preset.
- `renderer.js` — loading lights duplicates the list, doubling effective intensity (`COMPAT_DUPLICATE_LIGHTS`).

## Physics Background

The simulation models two related phenomena:

**Chladni figures** — sand on a vibrating plate migrates to nodal lines. Each resonant frequency has a unique modal shape.

**Faraday waves** — a driven fluid surface develops standing wave patterns above a critical amplitude threshold (parametric resonance at half the driving frequency).

The water wave dispersion relation governs wave speed vs. frequency:
```
omega^2 = (g*k + sigma*k^3/rho) * tanh(k*d)
```
Bass frequencies create large slow waves; high frequencies create tiny fast-decaying capillary ripples.

Note that `cymatics.js` solves this relation at construction but then overwrites every wavenumber each frame with a plain `log2` mapping — so the dispersion physics is currently dead at runtime. The solver is kept because it is the natural thing to switch back on.
