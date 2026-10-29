# Cymatics

**Another Dimension of Music** — a web app that visualizes how sound waves
affect a fluid surface in real time.

Audio input (files, radio streams, microphone) drives a WebGL2 simulation that
renders dynamic cymatic wave patterns on an HTML5 canvas.

**Try it at [cymatics.app](https://cymatics.app).**

It ships three ways:

- **The app**: a full studio with presets, a 9-band EQ, an XY light pad and
  every engine parameter on a knob.
- **`<cymatics-view>`**: the engine as a single-file web component for any page.
- **The studio as a library**: the whole app, mountable inside another page.

Plain JavaScript and GLSL. Vite is the only build tool, and the engine has no
runtime dependencies. It needs a browser with WebGL2.

## Prerequisites

[Node.js](https://nodejs.org/) 18 or newer. That's it.

## Quick Start

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:3000`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server on :3000 (`start` is an alias) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (`node --test`) for the element and studio modules |
| `npm run build:element` | `<cymatics-view>` as one ES module in `dist-element/` |
| `npm run build:studio` | The studio as a library in `dist-studio/` |

## `<cymatics-view>`

```html
<script type="module" src="cymatics-view.js"></script>
<cymatics-view look="water"></cymatics-view>
```

- `look`: `water`, `mercury`, `lines` or `glow`. `max-dpr` caps the pixel ratio (default 2).
- `element.connect(audioNode)` taps any Web Audio node and returns a disconnect
  function. `element.push(bins, sampleRate)` takes 1,024 bins of 0..1 from
  anything else. With neither, it eases into an idle swell.
- `paused` and `zoom` properties, and a read-only `supported`.
- Fires `cymatics-unsupported` when WebGL2 is missing.

`/element-test.html` on the dev server drives it with a synthetic song (`?look=…`).

## The studio as a library

`npm run build:studio` produces `cymatics-studio.js` and `style.css`. Mount it
with `mountStudio(root, host)`, where `host` supplies preset storage, audio
sources and the standalone-only chrome; see `src/studio/host.js`.
`/?host=fake` on the dev server runs a hosted studio on a synthetic spectrum.

## Project Structure

```
cymatics/
├── index.html
├── engine-test.html      # dev-only engine harness (see below)
├── element-test.html     # dev-only <cymatics-view> harness
├── styles.css
├── vite.config.js
├── docs/                 # design notes
├── public/               # icons, static assets
├── test/                 # node --test unit tests
└── src/
    ├── index.js          # app bootstrap, PWA, drag-and-drop
    ├── controls.js       # the 29 controllable parameters
    ├── default-presets.js
    ├── storage.js        # IndexedDB CRUD for user scenes
    ├── mpeg.js           # MPEG frame parsing for radio streams
    ├── components/       # web components: canvas, controls, audio, EQ, presets
    ├── element/          # <cymatics-view>
    ├── studio/           # the studio as a library (mountStudio, host seams)
    └── engine-js/        # the engine — WebGL2, see its README
        ├── index.js      # entry point, render loop, command API
        ├── cymatics.js   # wave field
        ├── liquidsim.js  # fluid solver
        ├── renderer.js   # PBR / emissive rendering
        ├── view.js       # render path selection and pass sequencing
        ├── glutil.js     # programs, FBOs, textures
        └── shaders/      # GLSL (#version 300 es)
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  HTML5 Canvas                                        │
└─────────────────────────┬────────────────────────────┘
                          │
┌─────────────────────────┴────────────────────────────┐
│  Engine (src/engine-js/) — WebGL2                    │
│  - Cymatics wave field         (GPU, fragment shader)│
│  - Fluid dynamics              (GPU, ping-pong FBOs) │
│  - PBR / emissive rendering    (GPU, fragment shader)│
└──┬──────────────────────────────────────┬────────────┘
   │  Command API                         │  Audio
   │  engine.sendCommand(str)             │  pushAudioSpectrum(Float32Array)
   │                                      │
┌──┴──────────────────────────────────────┴────────────┐
│  Web UI (Vite + Web Components)                      │
│  - Audio capture (Web Audio API)                     │
│  - Controls, presets, EQ                             │
│  - File/stream/microphone input                      │
└──────────────────────────────────────────────────────┘
```

Essentially all the work happens on the GPU. Per frame the JS averages ~1,030
FFT bins into 4 bands, sets uniforms, and issues the draw calls.

## Engine API

```js
// Text commands — used by saved presets and existing call sites.
engine.sendCommand('set cymatics {"contour_mode":1}')
engine.sendCommand('get renderer')   // → the config object

// Audio, once per frame.
engine.pushAudioSpectrum(float32Bins, numBins, sampleRate)

// Reflection / refraction maps, from encoded PNG/JPEG bytes.
engine.upload('reflection', bytes)
```

New code can also reach `engine.view.cymatics`, `.renderer` and `.liquid`
directly and set properties without going through the command strings.

## Engine harness

`/engine-test.html` (dev server only, not in the production build) drives the
engine with a synthetic spectrum, so the render paths can be exercised without
an audio source or a user gesture:

```
http://localhost:3000/engine-test.html?mode=emissive   # default look, 2 passes
http://localhost:3000/engine-test.html?mode=pbr        # fluid + PBR, ~52 passes
```

It reports fps, frame time, and which float texture formats the browser
supports.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm test` and
`npm run build`, and check the change in a browser: most of what matters here
is visual and lives on the GPU, so a screenshot or short clip helps a review a
lot. Design notes are in `docs/` and in `CLAUDE.md`, which documents the
architecture in more depth than this README.

By submitting a contribution you agree that it is licensed under the same
PolyForm Noncommercial License, and that the copyright holders may also
license it to others under commercial terms.

## Credits

The rendering engine is a JavaScript port of **glbase**, the C++ engine written
by **Tuomo Hirvonen**, which first powered Cymatics as WebAssembly.

The knob control is adapted from [precision-inputs](https://github.com/jhnsnc/precision-inputs)
by Chris Johnson (MIT). The dither texture is from Christoph Peters'
[free blue noise textures](http://momentsingraphics.de/BlueNoise.html) (CC0). Radio search uses the [Radio Browser](https://www.radio-browser.info/) API.

## License

Cymatics is **source-available** under the
[PolyForm Noncommercial License 1.0.0](LICENSE). You are free to use, modify
and share it for any noncommercial purpose: personal projects, art, study,
research, teaching, and use by charities, schools and public institutions.

**Commercial use needs a separate license.** That includes using Cymatics or
`<cymatics-view>` in a product, a paid service, a client project, a commercial
venue or a brand's website. To ask about a commercial license, contact
[Miika Kuisma](https://github.com/miikakuisma).

Copyright 2026 Miika Kuisma; engine portions copyright 2021-2022 Tuomo
Hirvonen. See [NOTICE](NOTICE) for third-party attributions.
