# Triangle, Pentagon and Hexagon Plates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new Field options (`field_mode` 3 triangle, 4 pentagon, 5 hexagon) whose figures are the shapes' real free-edge (Neumann) Laplacian modes, behaving exactly like the Square and Round plates.

**Architecture:** An offline Node script solves each shape's modes (Galerkin over a disc Fourier–Bessel basis, one symmetry class at a time), refits every mode as a single-wavenumber expansion `Σ cₙ·Jₙ(k r)·cos/sin(nθ′)`, and writes the compact coefficients into a committed JS module. At runtime the engine decodes them lazily, lists the modes like `squareModes()`, and **bakes** each picked mode once into a small texture (LRU cache); the field shader then samples up to four baked textures, so per-pixel cost stays like Square's no matter how many terms a mode has.

**Tech Stack:** Vanilla JS (ES modules), WebGL2 / GLSL ES 3.00, `node --test`. No new dependencies, runtime or dev.

**Spec:** `docs/superpowers/specs/2026-10-30-plate-shapes-design.md`

## Global Constraints

- Physics: eigenfunctions of the Laplacian with zero normal derivative on the edge (Neumann), same as Square. `ratio` = eigenvalue / lowest non-zero eigenvalue of that shape.
- Shapes fill the Round plate's frame: circumradius 1 in `plateUv`. Triangle and pentagon point up (a vertex at `θ′ = 0`), hexagon flat top (vertices at `θ′ = ±30°`). `θ′ = atan2(x, y)`, the angle from +y towards +x, so every shape is mirror-symmetric about `x = 0`.
- `field_mode`: 3 triangle, 4 pentagon, 5 hexagon. Anything else outside 0–5 falls back to 0.
- About as many modes per shape as Round lists: **620** per shape (up to 622, so a degenerate pair is never cut), counting derived partners.
- If a numeric threshold in this plan proves unreachable (e.g. the corner fit residual on pentagon/hexagon), the implementer reports the achieved value and stops; the controller rules — never loosen a threshold silently.
- Bundle budget: every bundle (app, `build:studio`, `build:element`) grows by **≤ 150 KB gzipped** for all three shapes together.
- No visible stall the first time a shape is chosen; live frame rate on a polygon within 10% of Square's.
- Existing presets render identically: Square, Round and sources are untouched (Bessel table values may change only at the ~1e-9 level).
- `src/engine-js/` stays self-contained; the element stays one module with no runtime fetches (data is inlined via `import`).
- Pure logic is tested under `node --test test/*.test.js`.
- Degenerate pairs are listed separately: equal ratios get split by `SPLIT = 2^(1/36)` per step, mirror-symmetric (cos) member first, as Square does.
- Commits end with the session attribution lines the controller supplies.

## Review Focus

1. Switching between two polygons (or polygon → Square → polygon) with modes already baked must show the new shape's figures, never a cached texture of the previous shape. Pinned by the cache-key test in Task 6.
2. A preset with `field_mode` 6, −1, 2.6 or a string must not blank the plate or crash: 6 and −1 → 0, 2.6 rounds to 3. Pinned by `clampFieldMode` tests in Task 1.
3. A tone above a shape's last mode falls silent rather than ringing the top mode. Pinned by the "silence above the list" test in Task 5.
4. The first selection of a shape must not stall: decoding all three shapes' data and listing their modes takes < 50 ms in Node. Pinned by a timing test in Task 5.
5. A mode's figure must be the same whether evaluated in JS (generator, tests) or baked on the GPU; sign/parity mistakes in the shader would draw a different figure that still "looks fine". Pinned by the GPU-vs-JS readback check in Task 6.

---

## File structure

| File | Responsibility |
|---|---|
| `src/engine-js/modes.js` (modify) | Field constants, `clampFieldMode`, Bessel table via recurrence with more rows, `besselRowPeaks` |
| `src/engine-js/polygons.js` (create) | Regular-polygon geometry and its symmetry classes (pure) |
| `src/engine-js/plate-modes.js` (create) | Decode shipped data, list modes, evaluate one in JS (pure) |
| `src/engine-js/plate-data.js` (create, generated) | `PLATE_DATA` base64 strings, one per shape |
| `src/engine-js/plate-bake.js` (create) | GPU baker + pure LRU cache of baked mode textures |
| `src/engine-js/shaders/plate_bake.fsh` (create) | Evaluates one mode's expansion into a texture |
| `src/engine-js/shaders/cymatics_freq_bands.fsh`, `cymatics.js` (modify) | Polygon fields in the live field pass |
| `scripts/plate-modes/linalg.mjs` (create) | Dense symmetric (generalized) eigensolver |
| `scripts/plate-modes/galerkin.mjs` (create) | Solve one symmetry class of one polygon |
| `scripts/plate-modes/fit.mjs`, `encode.mjs`, `generate.mjs` (create) | Single-k refit, binary encoding, the CLI that writes `plate-data.js` |
| `src/controls.js`, `src/default-presets.js`, `engine-test.html`, docs (modify) | Field options, factory presets, harness, CLAUDE.md / engine README |

---

### Task 1: Field constants, clamping, and a faster, taller Bessel table

**Files:**
- Modify: `src/engine-js/modes.js`, `src/engine-js/cymatics.js:360-361`
- Test: `test/modes.test.js`

**Interfaces:**
- Produces (modes.js): `FIELD_TRIANGLE = 3`, `FIELD_PENTAGON = 4`, `FIELD_HEXAGON = 5`, `POLYGON_SIDES = { 3: 3, 4: 5, 5: 6 }` (field mode → sides), `clampFieldMode(value) → 0..5`, `BESSEL_ROWS = 101` (orders 0–100; `BESSEL_WIDTH` 2048 and `BESSEL_X_MAX` 112 unchanged), `besselAllOrders(x, nMax, out: Float64Array) → out` (Jₙ(x) for n = 0..nMax), `besselRowPeaks() → Float64Array(BESSEL_ROWS)` (the divisor each table row is scaled by), `besselTable()` same contract as today.

- [ ] **Step 1: Write the failing tests** in `test/modes.test.js`:

```js
test('clampFieldMode keeps 0–5 and drops the rest to sources', () => {
	for (const v of [0, 1, 2, 3, 4, 5]) assert.equal(clampFieldMode(v), v)
	assert.equal(clampFieldMode(6), 0)
	assert.equal(clampFieldMode(-1), 0)
	assert.equal(clampFieldMode(2.6), 3)
	assert.equal(clampFieldMode('hexagon'), 0)
	assert.equal(clampFieldMode(NaN), 0)
})

test('besselAllOrders agrees with the integral form', () => {
	const out = new Float64Array(101)
	for (const x of [0, 0.3, 5, 37.7, 80, 111.9]) {
		besselAllOrders(x, 100, out)
		for (const n of [0, 1, 7, 30, 64, 100]) near(out[n], besselJ(n, x), 1e-9, `J${n}(${x})`)
	}
})

test('the table is BESSEL_ROWS tall, every row peaks at 1, and the first 31 rows are what they were', () => {
	const table = besselTable()
	const peaks = besselRowPeaks()
	assert.equal(table.length, BESSEL_ROWS * BESSEL_WIDTH)
	for (let n = 0; n < BESSEL_ROWS; n++) {
		const row = table.subarray(n * BESSEL_WIDTH, (n + 1) * BESSEL_WIDTH)
		near(Math.max(...row.map(Math.abs)), 1, 1e-6, `row ${n} peak`)
	}
	for (const [n, i] of [[0, 0], [3, 400], [30, 2047]]) {
		const x = (i / (BESSEL_WIDTH - 1)) * BESSEL_X_MAX
		near(table[n * BESSEL_WIDTH + i], besselJ(n, x) / peaks[n], 1e-6, `row ${n} at ${i}`)
	}
})

test('the table is quick to build', () => {
	const t = performance.now()
	besselTable()
	assert.ok(performance.now() - t < 40, 'besselTable took too long')
})
```

Also fix the existing round-plate test: `modes.length` is `(ROUND_MAX_N + 1) * ROUND_MAX_S` (import `ROUND_MAX_N`), no longer `BESSEL_ROWS * ROUND_MAX_S`.

- [ ] **Step 2: Run** `node --test test/modes.test.js` — expect FAIL (`clampFieldMode` not exported).

- [ ] **Step 3: Implement.** `besselAllOrders` uses Miller's backward recurrence: start at an even order `M = 2·ceil((max(nMax, x) + 30 + 10·x^(1/3)) / 2)` with `J_{M+1} = 0, J_M = 1e-30`, recur `J_{n-1} = (2n/x)·J_n − J_{n+1}`, rescale on overflow, normalise with `J₀ + 2·Σ J_{2k} = 1`; `x === 0` returns `[1, 0, 0, …]`. `besselTable()` fills each column with one `besselAllOrders` call, then divides each row by its peak (the values `besselRowPeaks()` returns, memoised). `clampFieldMode`: non-finite → 0, else `Math.round`, outside 0–5 → 0. In `cymatics.js`, replace the clamp at lines 360–361 with `clampFieldMode`.

- [ ] **Step 4: Run** `npm test` — all pass.

- [ ] **Step 5: Commit** `Plates: field modes 3–5, clampFieldMode, Bessel table by recurrence with 101 rows`.

---

### Task 2: Regular polygons and their symmetry classes

**Files:**
- Create: `src/engine-js/polygons.js`
- Test: `test/polygons.test.js`

**Interfaces:**
- Produces:
  - `polygon(sides) → { sides, offset, apothem, vertices: [[x, y], …] }` — `offset` is 0 for 3, 4, 5 and `π/6` for 6; vertex i at `θ′ = offset + 2πi/sides`, i.e. `[sin θ′, cos θ′]`; `apothem = cos(π/sides)`.
  - `insidePolygon(sides, x, y) → boolean` — reduce `φ = θ′ − offset − π/sides` into `[−π/N, π/N)`; inside iff `r·cos φ ≤ apothem + 1e-12`. The shader repeats this exact test.
  - `symmetryClasses(sides) → [{ j, parity: 'cos' | 'sin', partner: boolean }]` — the classes the solver solves: `{0,'cos'}`, `{0,'sin'}`; for each `0 < j < N/2` one `{j,'cos',partner:true}` (its `sin` partner is derived, never solved); for even N also `{N/2,'cos'}` and `{N/2,'sin'}`. `partner` is false except for the E classes.
  - `classOrders(sides, j, parity, nMax) → Int32Array` — ascending `n ≤ nMax` with `n ≡ j` or `n ≡ −j (mod N)`; `n = 0` only for `j = 0, parity 'cos'`.
  - `partnerSign(sides, j, n) → 1 | -1` — `+1` if `n mod N === j`, else `−1`. The derived partner of an E-class mode `Σ cₙ Jₙ cos(nθ′)` is `Σ partnerSign·cₙ Jₙ sin(nθ′)`.
  - `thetaPrime(x, y) = Math.atan2(x, y)`.

- [ ] **Step 1: Write the failing tests:**

```js
test('vertices sit on the unit circle, triangle and pentagon point up, hexagon is flat on top', () => {
	for (const n of [3, 4, 5, 6]) for (const [x, y] of polygon(n).vertices) near(Math.hypot(x, y), 1, 1e-12, `${n}-gon vertex`)
	assert.deepEqual(polygon(3).vertices[0].map((v) => +v.toFixed(12)), [0, 1])
	assert.deepEqual(polygon(5).vertices[0].map((v) => +v.toFixed(12)), [0, 1])
	near(polygon(6).vertices[0][1], polygon(6).vertices[5][1], 1e-12, 'hexagon top edge is level')
})

test('insidePolygon agrees with the vertices', () => {
	for (const n of [3, 5, 6]) {
		assert.ok(insidePolygon(n, 0, 0))
		for (const [x, y] of polygon(n).vertices) {
			assert.ok(insidePolygon(n, 0.999 * x, 0.999 * y))
			assert.ok(!insidePolygon(n, 1.001 * x, 1.001 * y))
		}
		assert.ok(!insidePolygon(n, 0, -0.999))   // below every bottom edge
	}
	assert.ok(insidePolygon(6, 0, 0.866), 'hexagon top edge midpoint')
	assert.ok(!insidePolygon(3, 0, -0.51), 'triangle bottom edge is at y = −1/2')
})

test('symmetry classes and their orders', () => {
	assert.deepEqual(symmetryClasses(5).map((c) => [c.j, c.parity, c.partner]),
		[[0, 'cos', false], [0, 'sin', false], [1, 'cos', true], [2, 'cos', true]])
	assert.deepEqual(symmetryClasses(6).map((c) => [c.j, c.parity]),
		[[0, 'cos'], [0, 'sin'], [1, 'cos'], [2, 'cos'], [3, 'cos'], [3, 'sin']])
	assert.deepEqual([...classOrders(6, 0, 'cos', 13)], [0, 6, 12])
	assert.deepEqual([...classOrders(6, 0, 'sin', 13)], [6, 12])
	assert.deepEqual([...classOrders(5, 2, 'cos', 13)], [2, 3, 7, 8, 12, 13])
	assert.deepEqual([...classOrders(3, 1, 'cos', 8)], [1, 2, 4, 5, 7, 8])
	assert.equal(partnerSign(5, 2, 7), 1)
	assert.equal(partnerSign(5, 2, 8), -1)
})
```

- [ ] **Step 2: Run** `node --test test/polygons.test.js` — FAIL.
- [ ] **Step 3: Implement** `src/engine-js/polygons.js`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `Plates: regular polygon geometry and symmetry classes`.

---

### Task 3: Dense symmetric eigensolver for the offline script

**Files:**
- Create: `scripts/plate-modes/linalg.mjs`
- Test: `test/plate-linalg.test.js`

**Interfaces:**
- Produces:
  - `symEig(A: Float64Array, n) → { values: Float64Array (ascending), vectors: Float64Array (column j = eigenvector j, row-major n×n) }` — Householder tridiagonalisation + implicit QL (tred2/tqli), A symmetric row-major, not modified.
  - `genSymEig(K, M, n, { tol = 1e-11 } = {}) → { values, vectors }` — solves `K a = λ M a` for symmetric K, symmetric positive semi-definite M that may be near-singular: eigendecompose M, keep eigenvectors with `μ > tol·μ_max`, form `P = V_keep·diag(μ^-½)`, solve `Pᵀ K P`, return `a = P·y` (columns, M-orthonormal), ascending λ. The result may have fewer than n columns.

- [ ] **Step 1: Write the failing tests:** symEig on a fixed 4×4 matrix against known eigenvalues to 1e-12 and `A·v = λ·v` residual < 1e-10 for every pair; symEig on a random symmetric 200×200 (seeded LCG) with orthonormality `‖VᵀV − I‖∞ < 1e-10`; genSymEig on `K = diag(1..5)`, `M = I` → values 1..5; genSymEig with a rank-deficient M built as `B·Bᵀ` (B 6×4) and `K = B·D·Bᵀ` returns 4 values equal to D's to 1e-9; a 400×400 run completes in < 5 s.
- [ ] **Step 2: Run** `node --test test/plate-linalg.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `Plate modes script: dense symmetric eigensolver`.

---

### Task 4: Galerkin solver for one symmetry class, checked against exact shapes

**Files:**
- Create: `scripts/plate-modes/galerkin.mjs`
- Test: `test/plate-galerkin.test.js`

**Interfaces:**
- Consumes: `symmetryClasses`, `classOrders`, `polygon`, `thetaPrime` (Task 2); `besselJ`/`besselAllOrders` (Task 1); `genSymEig` (Task 3).
- Produces: `solveClass(sides, cls, { kMax, basisFactor = 1.35, quad = 'auto' }) → [{ k, eval(x, y) → number, evalMany(points) → Float64Array }]` — the class's eigenpairs with `0 < k ≤ kMax`, ascending, each eigenfunction M-normalised over the whole polygon. `neumannDiscZeros(n, kMax) → number[]` (positive zeros of Jₙ′ below kMax, plus 0 for n = 0).

Method (decided here, the implementer writes the code):
- Basis for class (j, parity): `φ(r, θ′) = Jₙ(β r)·cos|sin(nθ′)` for every `n` in `classOrders(sides, j, parity, ·)` and every `β` in `neumannDiscZeros(n, basisFactor·kMax)` (β = 0 only for n = 0: the constant).
- `K_ij = ∫ ∇φᵢ·∇φⱼ`, `M_ij = ∫ φᵢ φⱼ` over the polygon. Integrands are invariant under the polygon's group, so integrate over the fundamental triangle (origin, vertex 0, midpoint of the edge from vertex 0 to vertex 1) and multiply by `2N`. Subdivide it into small triangles with a degree-≥8 symmetric Gauss rule; choose the subdivision from `basisFactor·kMax` so that doubling it changes the first 20 eigenvalues by < 1e-9 relative (test this once in development; `quad: 'auto'` encodes the rule found).
- `genSymEig(K, M)`, keep `λ > 1e-8`, `k = √λ`.

- [ ] **Step 1: Write the failing tests** (small `kMax` so the suite stays fast):

```js
// Exact Neumann eigenvalues, both counted with multiplicity.
// Square side s = √2 (circumradius 1): λ = (π²/2)(m² + n²), m, n ≥ 0, not both 0, ordered pairs.
// Equilateral triangle side s = √3: λ = (16π²/27)(m² + mn + n²), same counting.
function solveAll(sides, kMax) {
	const ks = []
	for (const cls of symmetryClasses(sides)) for (const m of solveClass(sides, cls, { kMax })) {
		ks.push(m.k ** 2)
		if (cls.partner) ks.push(m.k ** 2)
	}
	return ks.sort((a, b) => a - b)
}

test('the square comes out exact', () => {
	const got = solveAll(4, 14)
	const want = exactSquare(14 ** 2)   // helper builds the sorted list above
	assert.equal(got.length, want.length)
	got.forEach((v, i) => near(v / want[i], 1, 1e-6, `square λ${i}`))
})

test('the equilateral triangle comes out exact', () => {
	const got = solveAll(3, 20)
	const want = exactTriangle(20 ** 2)
	assert.equal(got.length, want.length)
	got.forEach((v, i) => near(v / want[i], 1, 1e-6, `triangle λ${i}`))
})

test('every eigenfunction has a zero normal derivative on the edge', () => {
	for (const sides of [3, 5, 6]) for (const cls of symmetryClasses(sides)) {
		for (const m of solveClass(sides, cls, { kMax: 15 })) {
			// sample 40 points on edge 0 (excluding 5% near each corner), finite-difference ∂u/∂n,
			// compare against max |∇u| over the plate
			assert.ok(edgeFluxRatio(sides, m) < 2e-3, `${sides}-gon class ${cls.j}${cls.parity} k=${m.k}`)
		}
	}
})
```

- [ ] **Step 2: Run** `node --test test/plate-galerkin.test.js` — FAIL.
- [ ] **Step 3: Implement** `scripts/plate-modes/galerkin.mjs`.
- [ ] **Step 4: Run** `npm test` — PASS, and the new test file finishes in < 30 s.
- [ ] **Step 5: Commit** `Plate modes script: Galerkin solver per symmetry class, exact on square and triangle`.

---

### Task 5: Data format, refit, generator, and the engine's mode list

**Files:**
- Create: `scripts/plate-modes/fit.mjs`, `scripts/plate-modes/encode.mjs`, `scripts/plate-modes/generate.mjs`, `src/engine-js/plate-modes.js`, `src/engine-js/plate-data.js` (generated, committed)
- Modify: `package.json` (`"plate-modes": "node scripts/plate-modes/generate.mjs"`)
- Test: `test/plate-modes.test.js`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - Binary format v1, little-endian: ASCII `PLT1`; `uint8 sides`; `uint16 count`; then per stored mode `uint8 j`, `uint8 parity` (0 cos, 1 sin), `uint8 partner` (1 if its sin partner is to be derived), `float32 k`, `float32 scale`, `uint16 terms`, `int16[terms] q`. Coefficient `cᵢ = qᵢ·scale/32767` multiplies **the normalised table row** `Tₙ(x) = Jₙ(x)/besselRowPeaks()[n]`, for `n` = the first `terms` entries of `classOrders(sides, j, parity, BESSEL_ROWS − 1)`. Each mode is scaled so its peak |u| over the plate is 1.
  - `encodePlate(sides, modes) → Uint8Array` (encode.mjs) and `decodePlate(base64) → { sides, modes: [{ j, parity, partner, k, orders: Int32Array, coeffs: Float32Array }] }` (plate-modes.js).
  - `PLATE_DATA = { 3: '<base64>', 5: '<base64>', 6: '<base64>' }` (plate-data.js, header comment: generated by `npm run plate-modes`, do not edit).
  - `polygonModes(sides) → [{ a: storedIndex, b: k, mix: 0 | 1, ratio }]` — memoised; every stored mode, plus for each `partner` mode a second entry with `mix: 1` (the derived sin partner); sorted by λ; `ratio = λ / λ_min`; any run of equal λ (relative 1e-9) gets `ratio·SPLIT^i` for the i-th member, `mix: 0` (cos) first. The generator solves every class up to a `kMax` comfortably past the 620th eigenvalue (Weyl estimate × 1.15), then keeps the lowest 620 listed entries, extended by at most two so a degenerate run is never cut in half.
  - `evalPolygonMode(sides, entry, x, y) → number` — 0 outside `insidePolygon`; otherwise `Σ cᵢ·Tₙᵢ(k r)·(sin if parity sin or mix 1, else cos)(nᵢθ′)·(mix 1 ? partnerSign : 1)`, with `Tₙ` evaluated exactly (`besselAllOrders`/peak).
  - `plateCoeffTexture(sides) → { width, height, data: Float32Array }` — RG32F layout: row = stored mode, texel i = `(nᵢ, cᵢ)`, rest zero; `width = max terms` (≤ 128).
  - `fitSingleK(sides, cls, mode, nMax) → { coeffs: Float64Array, relResidual }` (fit.mjs): weighted least squares of the Galerkin eigenfunction onto `{Tₙ(k r)·trig(nθ′)}` for `n` in the class's orders up to `nMax = min(100, ceil(k + 10 + 3·k^(1/3)))`, at the fundamental triangle's quadrature points; trailing coefficients below `1e-4·max|c|` dropped.
  - `generate.mjs` prints a report per shape: modes solved per class, kMax reached, worst `relResidual`, worst edge-flux ratio, max |λ_galerkin/λ_exact − 1| over **all** triangle modes, bytes per shape; it **exits non-zero** if any `relResidual > 1e-3`, any triangle eigenvalue is off by more than 1e-4 relative, or the gzipped `plate-data.js` exceeds 150 000 bytes.

- [ ] **Step 1: Write the failing tests** in `test/plate-modes.test.js`:

```js
test('an encoded plate decodes to the same modes', () => { /* encodePlate → base64 → decodePlate round trip on 3 synthetic modes; coeffs within scale/32767 */ })

test('each shape lists 620 modes, sorted, starting at ratio 1, with pairs split', () => {
	for (const sides of [3, 5, 6]) {
		const modes = polygonModes(sides)
		assert.ok(modes.length >= 620 && modes.length <= 622, `${sides}: ${modes.length} modes`)
		near(modes[0].ratio, 1, 1e-12, 'lowest mode is the reference')
		for (let i = 1; i < modes.length; i++) assert.ok(modes[i].ratio > modes[i - 1].ratio, `${sides}: strictly rising at ${i}`)
		assert.ok(modes.some((m) => m.mix === 1), 'derived partners are listed')
	}
})

test('the triangle data matches the exact eigenvalues', () => {
	const got = polygonModes(3).map((m) => m.b ** 2).sort((a, b) => a - b)
	const want = exactTriangle(Infinity).slice(1, got.length + 1)   // drop λ = 0
	got.forEach((v, i) => near(v / want[i], 1, 1e-4, `λ${i}`))
})

test('every shipped mode is a figure: peak 1, zero edge flux', () => {
	for (const sides of [3, 5, 6]) for (const entry of polygonModes(sides).filter((_, i) => i % 31 === 0)) {
		// peak |evalPolygonMode| over a 200×200 grid inside the plate ≈ 1 (0.97–1.0)
		// finite-difference normal derivative along each edge < 5e-3 of max |∇u|
	}
})

test('shipped data fits the budget', () => {
	const gz = gzipSync(readFileSync(new URL('../src/engine-js/plate-data.js', import.meta.url))).length
	assert.ok(gz <= 150_000, `plate-data.js is ${gz} bytes gzipped`)
})

test('decoding and listing all three shapes is quick', () => { /* fresh import via a query string; decode + polygonModes for 3, 5, 6 < 50 ms */ })

test('a tone above the last mode rings nothing', () => {
	const modes = polygonModes(6)
	const fundamental = 40
	const ranges = modeBinRanges(modes, fundamental, 44100, 1024)
	const f = fundamental * modes.at(-1).ratio * 1.2
	const bin = Math.round(f / (44100 / 2048))
	for (let i = 0; i < modes.length; i++) assert.ok(!(ranges[i * 2] <= bin && bin <= ranges[i * 2 + 1]), `mode ${i} hears ${f} Hz`)
})
```

- [ ] **Step 2: Run** `node --test test/plate-modes.test.js` — FAIL.
- [ ] **Step 3: Implement** fit, encode, decode, listing, eval, coefficient texture, and the generator.
- [ ] **Step 4: Run** `npm run plate-modes` — it writes `src/engine-js/plate-data.js` and prints the report with exit code 0. Paste the report into the task report.
- [ ] **Step 5: Run** `npm test` — PASS.
- [ ] **Step 6: Commit** `Plate modes: generator, shipped data for triangle, pentagon and hexagon, mode listing`.

---

### Task 6: Bake picked modes and draw polygons in the field pass

**Files:**
- Create: `src/engine-js/plate-bake.js`, `src/engine-js/shaders/plate_bake.fsh`
- Modify: `src/engine-js/cymatics.js` (`plate()`, `render()`), `src/engine-js/shaders/cymatics_freq_bands.fsh`, `engine-test.html`
- Test: `test/plate-bake.test.js` (pure cache), browser check

**Interfaces:**
- Consumes: `polygonModes`, `plateCoeffTexture`, `evalPolygonMode` (Task 5); `POLYGON_SIDES` (Task 1); `polygon` (Task 2).
- Produces:
  - `createLru(capacity) → { get(key), put(key, value) → evicted | undefined, keys() }` — pure, in `plate-bake.js`. Keys are `` `${sides}:${listIndex}` ``.
  - `class PlateBaker { constructor(ctx, { size = 512, capacity = 8 }); texture(sides, listIndex) → WebGLTexture; dispose() }` — on a miss renders the listing entry through `plate_bake.fsh` into an `Fbo(ctx, size, size, { dataType: FLOAT32 })` (the field's own type, so the float fallback applies) recycled from the evicted entry; uploads each shape's `plateCoeffTexture` once (RG32F, NEAREST, `texelFetch`) and uses the existing Bessel texture.
  - Field shader: for `fieldMode >= 3`, uniforms `plateMode0..3` (sampler2D), `polySides` (int), `polyOffset` (float); `outside` is the same inside test as `insidePolygon`; `shape = texture(plateModeI, plateUv * 0.5 + 0.5).r`. Samplers always bound (placeholder texture when unused), as the Bessel table already is.

- [ ] **Step 1: Write the failing test** for `createLru`: capacity 2, put a, b, get a, put c → evicts b; keys of different shapes never collide (`'3:7'` vs `'5:7'`).
- [ ] **Step 2: Run** `node --test test/plate-bake.test.js` — FAIL.
- [ ] **Step 3: Implement** the cache, the baker, the bake shader and the field shader branch. In `cymatics.js`: `plate()` lists `polygonModes(POLYGON_SIDES[mode])` for modes 3–5; `render()` asks the baker for the active modes' textures **before** `this.fbo.bind()`; bake renders must not happen inside the field pass. `engine-test.html`: `&field=triangle|pentagon|hexagon` (3, 4, 5) and its status line names them.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Browser check** on the dev server (`engine-test.html?field=hexagon`, then `pentagon`, `triangle`, `square`, `hexagon` again in one tab via the console): figures inside the outline only, nodal lines crisp in contour mode, no console errors, switching shapes shows the new shape immediately. Read back one baked texture (bind its Fbo, `readPixels` a 9×9 grid) and compare to `evalPolygonMode` at the same points: max difference < 2e-3. Measure frame time per the engine README method for `square` and `hexagon` with four modes active: hexagon ≤ 1.1 × square. Time 40 consecutive bakes with a 1×1 readPixels flush: mean < 2 ms. Put the numbers in the report.
- [ ] **Step 6: Commit** `Plates: bake picked polygon modes and draw them in the field pass`.

---

### Task 7: Field options, factory presets, docs

**Files:**
- Modify: `src/controls.js:47-51`, `src/default-presets.js`, `test/control-tabs.test.js`, `CLAUDE.md` (Fields), `src/engine-js/README.md` (Fields), `src/engine-js/modes.js` header comment

**Interfaces:**
- Consumes: field values 3–5.

- [ ] **Step 1: Write the failing test** in `test/control-tabs.test.js`: with `{ cymatics: { field_mode: 5 } }` the Shape tab's tools are `['field_mode', 'view_scale']`, as for the Round plate. And in a new assertion against `controls`: the Field control's options are, in order, values `[0, 3, 1, 4, 5, 2]` with labels `No plate, Triangle plate, Square plate, Pentagon plate, Hexagon plate, Round plate`; and `defaultPresets` contains `Triangle Plate`, `Pentagon Plate`, `Hexagon Plate` with `field_mode` 3, 4, 5, listed after `Square Plate`.
- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement.** The three presets copy "Square Plate"'s preset object with only `field_mode`, `color_outer` and the `dynamicLineColorMin`/`Max` pair changed (pick three distinct palettes); `objectId`s `000003`–`000005` or the next free ones. Docs: CLAUDE.md's Fields paragraph and the engine README's Fields section describe modes 3–5, the offline generator (`npm run plate-modes`), the bake cache, and that Round uses Jₙ zeros where a dish would use Jₙ′ (noted, unchanged).
- [ ] **Step 4: Run** `npm test`, `npm run build`, `npm run build:element`, `npm run build:studio` — all succeed. Compare `gzip -c dist-element/cymatics-view.js | wc -c` with the same number on `main` before this branch: growth ≤ 150 000 bytes. Same for the app's largest JS chunk.
- [ ] **Step 5: Browser check** on the dev server at desktop and phone widths: the three presets appear with rendered thumbnails; picking each shows its plate; the Tone Generator sweep walks through figures; Shape tab hides Formation / Freq Detail / Contour Detail on them.
- [ ] **Step 6: Commit** `Plates: triangle, pentagon and hexagon in the Field menu, factory presets, docs`.
