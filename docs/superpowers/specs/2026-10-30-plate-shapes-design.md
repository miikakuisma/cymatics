# More plate shapes: triangle, pentagon, hexagon

Date: 2026-10-30. Status: agreed in conversation, builder-checked, awaiting the owner's read.

## Why

The Field control offers No plate (radiating sources), Square plate and Round
plate. The plates are the part of Cymatics for exploring: pick one, sweep the
Tone Generator, and watch the plate's resonant figures appear one after
another, as on a real Chladni plate. The owner wants more shapes to explore
that way: **triangle, pentagon and hexagon** (a plain six-sided hexagon, not a
six-pointed star).

The owner chose **realism**: the figures should match what sand would really
do on a plate of that shape, not just look five- or six-fold.

## Goals

- Three new Field options, **Triangle plate**, **Pentagon plate** and
  **Hexagon plate**. They behave exactly like Square and Round:
  - a pure tone shows one clean resonant figure, and sweeping the Tone
    Generator walks through them in order of pitch;
  - with music the strongest four ring together (`MAX_ACTIVE_MODES`, `pickModes`),
    as now;
  - Distance (`view_scale`) is the plate's size, through `plateFundamentalHz`,
    as now;
  - contour mode draws only the nodal lines; every render path (contour,
    emissive, liquid, PBR) works on them as it does on Square and Round.
- The figures are the shape's real modes as a **stiff metal Chladni plate**
  rings them: thin-plate (Kirchhoff) bending, `D∇⁴w = ρhω²w`, with **free
  edges** (zero bending moment and zero effective shear force on the boundary),
  Poisson's ratio of a metal plate (~0.3). The three zero-frequency rigid-body
  modes are not listed. A mode's `ratio` is its frequency over the lowest
  elastic mode's frequency, so pitch spacing comes straight from the physics.
  *(Owner's choice, after the builder check: the owner picked true stiff-plate
  physics over matching Square's simpler drum-skin model, knowing the new
  shapes will then be more physically faithful than Square and Round until
  those are upgraded the same way, a separate later project.)*
- Not modelled: the stud a real plate is bolted to at its centre, and the way
  driving it at one point favours some modes. All modes are listed, as Square
  and Round list theirs. *(My call.)*
- Nothing is drawn outside the plate's outline, as Round does today.
- One factory preset per new shape, alongside "Square Plate" and "Round Plate",
  so each appears as a thumbnail in the picker.

## Non-goals

- Changing Square or Round, or the radiating-sources field. Moving them to
  stiff-plate physics is a likely follow-up project, not this one; the work
  here should make that easy (a solver and data format that a square and a
  disc could reuse), without doing it.
- New sliders or controls. The only UI change is three more Field options.
- Shapes beyond these three, or user-drawn shapes.

## Anti-goals (would be a failure even if it works)

- Any existing preset renders differently.
- Figures that only look polygonal — e.g. a round plate's figure clipped to a
  hexagon, or plane waves summed at 60° and cut out — rather than the shape's
  actual modes. That is the specific thing the owner ruled out.
- A visible stutter or long pause the first time a new shape is chosen, or the
  live plate's frame rate dropping on them.
- The app's download growing by more than about **1 MB gzipped** in total for
  all three shapes, or `<cymatics-view>` (`dist-element/cymatics-view.js`, ~443 KB
  today) growing by more than **~250 KB gzipped**. *(My call, from the builder
  check: the element is meant to be a light drop-in, and it carries the same
  data.)*

## How fine the new plates go

*(My call, from the builder check.)* Each new shape lists about as many modes
as Round does (~620), so at any Distance a tone sweep on a new plate stops
finding figures at roughly the pitch Round does. Above its last mode a plate
falls silent, as Square and Round already do above theirs — never garbage.  The builder
reports the pitch where each new plate runs out at the factory presets'
Distance.

## How (decided)

- No free stiff plate has closed-form modes — not even the triangle (Lamé's
  formulas are for the membrane). So **all three shapes' modes are computed
  once, offline, by a script in the repo** (as `scripts/make-icons.mjs` is for the
  icons), and the results are **shipped with the app as data** the engine reads.
  The script is checked in so the data can be regenerated; its output is
  committed so the app build does not run it.
- Orientation: triangle and pentagon **point up**; hexagon **flat top**.
- Every shape fills the same frame the Round plate does: its corners touch the
  Round plate's circle (`plateUv` radius 1). *(My call: keeps the plates the
  same size on screen, so Distance means the same thing on each.)*
- `field_mode` values: **3 triangle, 4 pentagon, 5 hexagon**, after the existing
  0–2. *(My call.)* In the Field menu they are listed by number of sides: No
  plate, Triangle, Square, Pentagon, Hexagon, Round. *(My call.)*
- Factory presets are named "Triangle Plate", "Pentagon Plate", "Hexagon Plate",
  built from the existing "Square Plate" preset with only `field_mode` (and
  colours, for variety) changed. *(My call.)*

## Constraints

- **The element stays one module.** `npm run build:element` produces
  `dist-element/cymatics-view.js` with no imports and no fetches beyond what the
  page asks for; the studio library (`build:studio`) is hosted by the desktop
  app. The shipped mode data must reach the engine in both builds
  without a separate network request the host would have to serve — inlined in
  the bundle, or generated cheaply on the client from something small that is.
- `src/engine-js/` stays self-contained (its README says so).
- WebGL2 only, no extensions the engine does not already rely on. Textures
  within what WebGL2 guarantees (the Bessel table already notes 2048 as the
  widest guaranteed width).
- Pure logic stays testable under `node --test`, as `modes.js` is today.
- A preset saved with `field_mode` 3–5 and opened by an older build falls back
  to No plate (the engine already clamps unknown values to 0). Acceptable.

## Things that must keep working

- `control-tabs.js` and `cymatics-controls.js` treat any non-zero `field_mode`
  as "on a plate" (hiding Formation, Freq Detail, Contour Detail). The new
  values must count as plates there too — they do as written, but tests should
  cover one.
- `matchSource` (cymatics-presets.js) only ever moves between No plate and the
  Round plate on the first source pick of a launch; a new shape counts as "on a
  plate" there as well.
- Thumbnails (`src/studio/thumbnailer.js`) render the new factory presets
  through the real engine like any other.
- `engine-test.html`'s `&field=` gains `triangle`, `pentagon`, `hexagon`.

## Left to the builder

- **How the modes are represented and evaluated.** Two reasonable shapes of
  answer, with their trade-off:
  - each mode sampled on a grid and stored in a texture array — simple to
    evaluate, but detail is capped by grid resolution and mode count by the
    1 MB budget;
  - each mode as a short expansion the shader evaluates (for example
    plate-equation particular solutions `[Jₙ(k·r) + c·Iₙ(k·r)]·cos/sin(nθ)`
    restricted by the shape's symmetry, reusing and extending the existing
    Bessel table) — tiny data and arbitrary resolution, but convergence near
    the corners needs checking.
  Whichever is chosen, the builder demonstrates accuracy. The solver is first
  checked on shapes with published free-plate results — the free square plate
  (Leissa, *Vibration of Plates*) and the free disc — then its first several
  frequencies for each new shape are compared against an independent
  computation or published values, and its nodal lines must hold still and
  cross the plate cleanly, with no smearing near the corners.
- **Degenerate pairs.** All three shapes have modes that come in symmetric
  pairs with the same pitch, as Square's do. Square lists both combinations with a third
  of a semitone between them (`SPLIT`); do the equivalent, choosing the pair's
  basis so each listed figure is the clean, symmetric one a real plate shows.
- Where the numeric solver runs (Node script with its own small FEM or other
  method), its resolution, and its dependencies — none at runtime; a dev-only
  dependency for the offline script is acceptable if justified.
- The outline test in the shader for each polygon, and whether the plate's edge
  is drawn.
- Colours of the three new factory presets.
- Any memoisation of mode lists / tables so first selection does not stall (the
  round plate's one-off ~100 ms `roundModes`/`besselTable` cost is a known
  follow-up; do not make it worse, fixing it is welcome).
