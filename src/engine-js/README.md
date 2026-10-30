# Engine

A JavaScript port of glbase, the C++ engine by Tuomo Hirvonen.

WebGL2. Self-contained: the GLSL lives in `shaders/` and is bundled as strings
at build time, so there is no runtime fetch and no asset directory to keep in
sync.

## Layout

| File | Purpose |
|---|---|
| `index.js` | Entry point, render loop, command API, audio/texture ingest |
| `cymatics.js` | Wave field — envelope follower + uniform setup |
| `modes.js` | Plate modes: Bessel functions, mode lists, picking (pure, unit-tested) |
| `polygons.js` | Triangle, pentagon and hexagon geometry (field 3–5) |
| `plate-modes.js` | Mode lists for the polygon plates (picking is in `modes.js`) |
| `plate-corners.js` | Fractional-order corner terms of the polygon modes |
| `plate-data.js` | Shipped mode data, format PLT2 (generated, do not edit) |
| `plate-bake.js` | Bakes picked polygon modes into an R32F (R16F on the half-float fallback) LRU cache of 8 |
| `shaders/plate_bake.fsh` | The bake pass: evaluates a mode over the plate |
| `liquidsim.js` | Ping-pong Jacobi pressure solver |
| `renderer.js` | PBR/refraction uniforms, emissive colour state |
| `view.js` | Render path selection, pass sequencing |
| `glutil.js` | Programs with uniform caching, FBOs, textures |
| `shaders/` | GLSL, `#version 300 es` |

About 1,400 lines, of which the per-frame CPU work is: average ~1,030 FFT bins
into 4 bands, set uniforms, draw. Everything else is on the GPU.

## Render paths

`view.js` picks one, in this order:

1. **Liquid** — `liquid_mode` on. The height field shaded as a liquid surface:
   normals from the field gradient, reflecting a procedural studio environment.
   `liquid_material` selects mercury (high F0, pure reflection) or water (F0
   0.02 plus refraction through a procedural pool floor). 3 passes, or 2 with
   viscosity at zero. Forces `contour_mode` off for its own pass and restores it
   after — contour lines are flat-topped, so they produce no usable gradient.
2. **Contour** — `contour_mode > 0.5` and emissive off. Height field straight to
   screen. 2 passes.
3. **Emissive** — `emissive_mode` on. Colourised height field. 2 passes. **The
   app's shipped default**; the fluid solver and PBR shader are constructed but
   never run.
4. **PBR** — fluid sim → temporal blend → PBR shading. ~52 passes.

## Fields

`field_mode` picks what the music excites. It changes the wave field only, so
every render path above draws it.

- **0, sources** (default) — circular ripples, `cos(k·r − ωt)`, radiating from
  the centre and the poles, one wavenumber per band. Every preset before plate
  fields renders through this unchanged.
- **1, square plate** and **2, round plate** — standing waves: the plate's own
  resonant modes, picked by the music. Square: `cos(nπx)cos(mπy) ±
  cos(mπx)cos(nπy)`, Chladni's free plate, ringing ∝ m² + n². Round:
  `Jₙ(α·r)·cos(nθ)`, with α the s-th zero of Jₙ, ringing ∝ α². Adapted from
  [evoluteur/cymatics](https://github.com/evoluteur/cymatics) (MIT).
- **3, triangle**, **4, pentagon** and **5, hexagon** — Neumann modes, like
  the square's: a dish of water with a wall, rather than a free plate. They
  are computed offline by `npm run plate-modes` (`scripts/plate-modes/`, about
  14 minutes): a Galerkin solve over a disc Fourier–Bessel basis plus corner
  functions, refit as a centre series plus fractional-order corner terms and
  stored as format PLT2 in `plate-data.js`. At runtime the picked modes are
  baked on the GPU (`plate-bake.js`, `shaders/plate_bake.fsh`) into an R32F (R16F on the half-float fallback)
  texture cache holding the last 8, so the field pass samples a texture and
  costs about what the square does.

Round uses the zeros of Jₙ where a dish would use those of Jₙ′ (the Neumann
condition); that is noted and unchanged.

Each mode follows the spectrum a semitone either side of its frequency through
the same envelope as the bands; `faraday_threshold` gates them, and the
strongest four ring, weighted so the loudest carries the figure. A plate's
shape only breathes (75–100%), never flattens, so its nodal lines stay put. In
contour mode a plate draws only its nodal lines, where sand would gather —
`contour_count` is unused there, as are `freq_detail_scale` and the poles.

`view_scale` (Distance) is the plate's size: the lowest mode is 40 Hz at the
factory 0.1, and a plate twice the size rings every mode two octaves lower
(f ∝ 1/L²), so the same note lands on a finer figure. The lists reach 40 lines
across (square) and 30 diameters × 20 circles (round), which a whistle at full
Distance still fits inside.

Worth knowing:

- **Both halves of each square pair are listed.** A real plate splits the
  degenerate pair, the − and + figures ringing at slightly different pitches;
  the + sits a third of a semitone up here. Listing only − puts the diagonal on
  every figure, since it is a nodal line of all of them.
- **The Bessel table is computed, not tabulated.** `besselJ` integrates
  `cos(nτ − x·sin τ)` by the trapezoid rule, which converges spectrally for this
  integrand and stays accurate where the power series cancels terms of ~eˣ. It
  matches an 80-digit series to 1e-15 over the whole table. Building it costs
  ~0.1 s, once, the first time the round plate is chosen.
- **The sampler is bound even when unused.** An unbound `besselTable` reads
  unit 0, which can hold the field's own render target; WebGL refuses that draw
  as a feedback loop and the field goes blank on every path, sources included.

## Testing without audio

`/engine-test.html` on the dev server drives the engine with a synthetic
spectrum, so both looks can be exercised without an audio source or a user
gesture:

```
/engine-test.html?mode=emissive
/engine-test.html?mode=liquid
/engine-test.html?mode=water
/engine-test.html?mode=pbr
```

Add `&field=square`, `round`, `triangle`, `pentagon` or `hexagon` to drive a plate with a tone gliding
40 Hz → 5 kHz and back, and `&distance=0.5` for the largest plate.

Note that `requestAnimationFrame` is throttled whenever the tab is not
foregrounded, so `stats.fps` reads zero under automation. To measure, drive
`view.render()` directly in a loop and force a sync with a 1x1 `readPixels`
afterwards — without that flush the timing only covers command submission.

## Things worth knowing

**Float texture fallback.** The wave field is a float32 render target sampled
with LINEAR filtering. That needs `EXT_color_buffer_float` *and*
`OES_texture_float_linear`; without the latter, filtering silently degrades to
NEAREST and normals go blocky. `glutil.js` detects this and falls back to
`RGBA16F`, which WebGL2 filters natively. `engine.stats.floatCaps` reports what
the browser actually gave you.

**No `gl.finish()` / `gl.flush()`.** Both are hard pipeline stalls; the engine
deliberately never calls them.

**Identity projection in the PBR path.** Not an oversight. `main.vsh` feeds the
projection `vec4(cameraCoord.xy, -cameraCoord.z, 1.0)` and the quad sits at z=0
through an identity camera, so identity maps it exactly to the viewport — which
is what every `worldPos` / `toView` expression in the fragment shader assumes. A
real perspective matrix cannot work: the quad lies in the camera plane, so
`w = 0` for every vertex.

**Two preserved quirks.** Both predate this engine, both only affect the
non-default PBR path, and both are kept because existing presets are tuned
around them. Changing either changes how saved scenes render:

- `liquidsim.js` — `liquidity_slowdown` writes `velocitySlowdown`, so
  `liquiditySlowdown` can never actually be set from a preset.
- `renderer.js` — loading lights duplicates the list, so a 2-light preset yields
  4 lights and double the intensity. Toggle `COMPAT_DUPLICATE_LIGHTS` to opt
  out.

**The liquid path's environment is radial, not a horizon.** `environment()`
shades along `r.z` — the axis pointing up out of the pool toward the viewer —
rather than along `r.y`. An ordinary horizon-based environment map looks correct
in isolation but maps to a dead-straight bright line across the middle of the
frame, because for the flat regions of a screen-filling plane the reflection
direction's y component is just a linear function of screen y. The softbox's
normal is tilted off vertical for the same reason: it keeps still water outside
the band, so the streak only appears where a ripple turns the surface toward the
light.

**Curvature terms need a scale, and the scale is not obvious.** The liquid
path's occlusion and caustics both come from the field's Laplacian. The gradient
taps scale their first derivative by 40 to reach a usable 0..1 range; curvature
is a second derivative over a 2-texel span and needs roughly the square of that,
which is what `CURV_SCALE` is. Get it wrong low and the term is silently inert —
it computes, costs its taps, and changes nothing visible.

Caustics additionally cannot use a fixed threshold. `freq_detail_scale` alone
spans 0.1 to 10 and curvature grows with the square of spatial frequency, so a
constant tuned on a broad swell is an order of magnitude too hot on a finely
detailed field and floods the frame. Dividing by the local slope drops that from
quadratic in wavenumber to linear and removes the amplitude dependence; what
remains is scene-dependent enough that `caustic_strength` is a control.

**Envelope release scales the decay; it does not replace it.** Tied to a single
speed, the top of the range decays by half per frame and the picture strobes
between transients — hence a separate `freq_release`. But that control cannot
simply own the falling edge, and it cannot be linear in the per-frame multiplier
either. Both were tried and measured:

- Linear in the multiplier: the whole usable range collapses into the bottom
  fifth of the slider, and its midpoint still falls to 0.4% of peak between
  beats. Decay is exponential in time, so the control has to be logarithmic.
- Owning the fall outright: Response Speed is left governing only the rising
  edge. Its attack behaviour is unchanged — a step still settles in 12 frames at
  0.1 and 1 frame at 1.0 — but tracking error against a 2 Hz modulation drops
  from a 0.231..0.046 spread to 0.142..0.094, and the slider stops reading as
  "speed" at all.

`releaseToDecay(responseSpeed, release)` therefore takes the original coupling as
its base curve and scales that time constant by up to 32x in either direction.
Release is neutral at 0.5, so presets written before it existed reproduce the old
behaviour exactly, with no conversion.

**Dead physics.** `cymatics.js` solves the water dispersion relation at
construction, then `insertFreqSpectrum()` overwrites every wavenumber each frame
with a plain `log2` mapping. The solver is kept because it is the model the
project README describes and the natural thing to switch back on.
