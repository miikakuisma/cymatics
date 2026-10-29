# Physically accurate cymatic patterns

> Design note carried over from the earlier C++/WASM era. The engine is now
> pure JS/WebGL2 (`src/engine-js/`), so the "C++ engine" below means the
> simulation core in general. Items 1-3 of the summary are done; the
> dispersion solver exists in `cymatics.js` but its result is overwritten
> each frame, so the physics here is still largely unrealised.

### What real cymatics looks like

There are two related physical phenomena:

**Chladni figures** (solid plate):  
Sand placed on a vibrating plate migrates to nodal lines — the lines of zero displacement. Each resonant frequency of the plate has a unique modal shape. Higher frequencies produce more nodes and finer patterns.

**Faraday waves** (liquid surface):  
A container of fluid is driven by vertical oscillation. Above a critical acceleration threshold, standing waves spontaneously appear on the surface at **half the driving frequency** (subharmonic parametric resonance). Pattern geometry (hexagons, squares, stripes) depends on viscosity, surface tension, and forcing amplitude.

### What the engine currently does (inferred)

- Wave sources ("poles") are placed at configurable positions.
- Audio amplitude drives pressure at these poles.
- A simplified 2D fluid/wave solver propagates the disturbance.
- All audio frequencies drive the same pattern — there is no frequency-to-wavelength mapping.
- Wave speed appears to be constant, not dispersive.

### Why that diverges from real water

On real water, wave speed depends on wavelength — this is called **dispersion**. The dispersion relation for surface waves on water of depth *d* is:

```
ω² = (g·k + σ·k³/ρ) · tanh(k·d)
```

Where:
- `ω` = angular frequency (2π × Hz)  
- `k` = wavenumber (2π / wavelength)  
- `g` = gravitational acceleration (9.81 m/s²)  
- `σ` = surface tension (~0.072 N/m for water)  
- `ρ` = density (1000 kg/m³)  
- `d` = water depth  

Consequences:
- **Gravity waves** (long, k small): `c ∝ 1/√k` — longer waves travel faster.
- **Capillary waves** (short, k large): `c ∝ √k` — shorter waves travel faster.
- There is a **minimum phase speed** (~0.23 m/s for water) at the crossover scale (~17 mm wavelength).
- Waves of different frequencies arrive at different times — real water has that characteristic "ripple ring" look.

### Proposed improvements to the C++ engine

**1. Frequency-to-wavenumber mapping (most impactful)**

Receive the audio spectrum from JS (N frequency bins). For each significant frequency component *f*:
- Solve the dispersion relation for the corresponding wavenumber *k*.
- Add a wave source at the pole positions with spatial frequency *k* and amplitude proportional to the bin magnitude.
- This means bass frequencies (50–200 Hz) create large slow waves; high frequencies (2–10 kHz) create tiny fast ripples — exactly as in real cymatics.

```
audio frequency f  →  k = solve_dispersion(2πf)  →  λ = 2π/k
```

**2. Dispersive wave propagation**

Replace the current constant-speed wave propagator with one that correctly handles dispersion. Options:
- **Pseudo-spectral method**: evolve the wave field in Fourier space where each wavenumber component advances at its own phase speed. This is exact and fast for periodic boundary conditions.
- **Finite-difference with dispersion correction**: add higher-order spatial derivatives to the wave equation stencil to approximate dispersion.

The pseudo-spectral approach works well for WebAssembly because FFTs are cache-friendly and can be optimized with SIMD.

**3. Faraday instability threshold**

Real cymatic patterns have a threshold: below a critical excitation amplitude, the surface stays flat; above it, patterns snap into existence. This is a **parametric resonance** (Mathieu equation):

```
d²h/dt² + ω₀²(1 + ε·cos(2ω₀t)) · h = 0
```

Implementation: modulate the restoring force at twice the driving frequency. The result is that quiet passages show smooth water, and loud passages trigger crisp geometric patterns rather than a proportional linear response. This on/off threshold behavior is one of the most visually striking things about real cymatics.

**4. Viscous damping per wavenumber**

High-frequency (short) waves are damped much faster than low-frequency waves. Damping rate:

```
γ(k) = 2·ν·k²   (kinematic viscosity ν ≈ 10⁻⁶ m²/s for water)
```

In practice: apply a per-wavenumber exponential decay each timestep in spectral space. This gives the characteristic effect where high-frequency ripples die out quickly while bass-driven swells persist.

**5. Multi-scale pattern superposition**

With a proper dispersive solver and frequency-mapped sources, music naturally creates multi-scale patterns:
- **Sub-bass (20–80 Hz)**: large-scale, slow-moving surface undulation.
- **Bass (80–250 Hz)**: primary cymatic geometry — hexagons, squares, concentric rings.
- **Midrange (250 Hz–2 kHz)**: medium-scale interference patterns, complex overlapping geometries.
- **High frequencies (2–20 kHz)**: fine capillary ripples, very short-lived, create texture.

**6. Chladni mode excitation (alternative approach)**

Instead of (or in addition to) simulating wave propagation, solve the eigenmodes of the plate/container:
- Precompute the first N modal shapes for the chosen container geometry (rectangular, circular, custom).
- Each audio frequency bin excites the mode whose natural frequency is closest.
- The visual is the weighted superposition of modal shapes — Chladni figures.
- This gives the iconic sand-pattern look. The wave propagation approach gives the water look. Both are valid.

**7. Realistic boundary conditions**

- **Reflecting walls**: standing wave resonances depend on container dimensions.
- **Absorbing edges**: add a PML (Perfectly Matched Layer) at boundaries to absorb outgoing waves, simulating an infinite fluid.
- **Free surface at walls**: wave amplitude should go to zero at a rigid wall (Dirichlet BC) or have zero slope (Neumann BC), not wrap around periodically.

### Summary of recommended changes

| Change | Physics gained | Complexity |
|--------|---------------|------------|
| Send frequency spectrum from JS, not time-domain | Frequency-selective excitation | Low (JS only) |
| Dispersion relation for wave speed | Realistic multi-scale ripple timing | Medium |
| Per-frequency wave source amplitude | Correct frequency-to-pattern mapping | Low |
| Viscous damping per wavenumber | High-freq ripples die, bass persists | Low |
| Faraday threshold (parametric resonance) | On/off pattern snap, not linear | Medium |
| Pseudo-spectral propagator | Exact dispersion, efficient SIMD | High |
| Chladni mode decomposition | Iconic sand-pattern look | High |

Start with the first three — they are mostly JS-side changes and will immediately make the patterns respond to different instruments and frequency ranges in a musically meaningful way.
