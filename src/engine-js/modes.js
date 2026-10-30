// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Standing-wave modes of a bounded plate, for `field_mode` 1 and 2.
//
// The default field (mode 0) is circular ripples, cos(k·r − ωt), radiating from
// the poles. Real Chladni and Faraday figures are standing waves set by the
// plate's edge. Here the music picks which of the plate's resonant modes ring.
// The idea and the formulas follow evoluteur/cymatics (MIT, Olivier Giulieri).
//
// - Square plate, free edges: cos(nπx)cos(mπy) ± cos(mπx)cos(nπy), the two
//   degenerate modes of Chladni's square plate superposed. A stiff plate rings
//   in proportion to m² + n². A real plate splits the pair: the − and +
//   figures ring at slightly different pitches, so both are listed, the +
//   a third of a semitone up. Listing only − leaves the diagonal on every
//   figure, since it is a nodal line of all of them.
// - Round plate: Jₙ(α·r)·cos(nθ), with α the s-th zero of Jₙ — n nodal
//   diameters, s nodal circles. Those are membrane shapes; their frequency here
//   follows the stiff-plate law (∝ α²), so the modes span the audio range the
//   way the square plate's do.
//
// Everything here is pure, so it runs under node --test.

export const FIELD_SOURCES = 0
export const FIELD_SQUARE = 1
export const FIELD_ROUND = 2
export const FIELD_TRIANGLE = 3
export const FIELD_PENTAGON = 4
export const FIELD_HEXAGON = 5

// Field mode → number of sides, for the polygon plates.
export const POLYGON_SIDES = { 3: 3, 4: 5, 5: 6 }

// A saved or typed field_mode is rounded, and anything outside the known modes
// falls back to radiating sources, which every preset can render.
export function clampFieldMode(value) {
	const v = Math.round(Number(value))
	return Number.isFinite(v) && v >= FIELD_SOURCES && v <= FIELD_HEXAGON ? v : FIELD_SOURCES
}

// How many modes ring at once. A real plate under music rings dozens and turns
// to mush; the strongest few keep a readable figure.
export const MAX_ACTIVE_MODES = 4

// How fine a figure can get. A whistle at the largest plate size needs a few
// hundred times the lowest mode's frequency, so the lists reach well past it.
export const SQUARE_MAX_ORDER = 40 // up to 40 nodal lines across
export const ROUND_MAX_N = 30 // nodal diameters
export const ROUND_MAX_S = 20 // nodal circles

// The Bessel table the plates sample, one row per n. 2048 is the widest
// texture WebGL2 guarantees; at ~0.05 per texel a period gets ~115 samples.
// The round plate uses rows 0–30; the polygons need orders up to 100.
export const BESSEL_ROWS = 101
export const BESSEL_WIDTH = 2048
export const BESSEL_X_MAX = 112 // just past the largest zero used (J₃₀'s 20th, ~109.5)

// The plate's lowest mode, in Hz, from Distance (view_scale). A plate twice the
// size rings every mode two octaves lower (f ∝ 1/L²), so the same note lands on
// a finer figure: zooming out shows more detail, as it does on the radiating
// field. `vscale` is the zoom the vertex shader applies; the factory 0.1 maps
// to 40 Hz.
const BASE_HZ = 40
const BASE_VSCALE = 0.1 + 0.1 * 1.9

export function plateFundamentalHz(viewScale) {
	const vscale = 0.1 + Math.min(Math.max(viewScale, 0), 1) * 1.9
	return BASE_HZ * (BASE_VSCALE / vscale) ** 2
}

// J_n(x) = 1/π ∫₀^π cos(nτ − x·sin τ) dτ. The integrand is smooth, even and
// 2π-periodic, so the trapezoid rule converges spectrally. Unlike the power
// series it stays accurate at large x, where the series cancels terms of ~e^x.
export function besselJ(n, x) {
	// The error falls off once 2N − n exceeds x by a margin (~10·x^⅓, under 50
	// at x = 112), so N grows with x rather than paying for the worst case.
	const N = Math.ceil((x + n) / 2) + 32
	let sum = 0
	for (let i = 0; i <= N; i++) {
		const t = (i / N) * Math.PI
		const v = Math.cos(n * t - x * Math.sin(t))
		sum += i === 0 || i === N ? v / 2 : v
	}
	return sum / N
}

// The first `count` positive zeros of J_n: scan for sign changes, then bisect.
export function besselZeros(n, count) {
	const zeros = []
	// Consecutive zeros are always more than π apart, so this cannot step over
	// a pair.
	const step = 0.25
	// J_n has no zeros below n, and near 0 it is ~xⁿ: small enough that
	// rounding noise flips its sign. Start where the zeros can be.
	let x = Math.max(step, n)
	let prev = besselJ(n, x)
	while (zeros.length < count && x < 200) {
		const next = x + step
		const value = besselJ(n, next)
		if (prev * value < 0) {
			let lo = x
			let hi = next
			let flo = prev
			for (let i = 0; i < 50; i++) {
				const mid = (lo + hi) / 2
				const fm = besselJ(n, mid)
				if (flo * fm <= 0) hi = mid
				else { lo = mid; flo = fm }
			}
			zeros.push((lo + hi) / 2)
		}
		x = next
		prev = value
	}
	return zeros
}

// Every mode as { a, b, mix, ratio }, sorted by frequency. `ratio` is the
// frequency relative to the plate's lowest mode.
// Square: a = m, b = n (m ≤ n), mix = ±1 (0 when m = n: nothing to pair).
// Round: a = n, b = α, mix unused.
const SPLIT = Math.pow(2, 1 / 36)

export function squareModes(maxOrder = SQUARE_MAX_ORDER) {
	const modes = []
	for (let m = 0; m <= maxOrder; m++) {
		for (let n = m; n <= maxOrder; n++) {
			if (m + n === 0) continue // the flat plate is not a mode
			const ratio = m * m + n * n
			if (m === n) {
				modes.push({ a: m, b: n, mix: 0, ratio })
			} else {
				modes.push({ a: m, b: n, mix: -1, ratio })
				modes.push({ a: m, b: n, mix: 1, ratio: ratio * SPLIT })
			}
		}
	}
	return modes.sort((p, q) => p.ratio - q.ratio)
}

export function roundModes(maxN = ROUND_MAX_N, maxS = ROUND_MAX_S) {
	const base = besselZeros(0, 1)[0]
	const modes = []
	for (let n = 0; n <= maxN; n++) {
		const zeros = besselZeros(n, maxS)
		for (const alpha of zeros) {
			modes.push({ a: n, b: alpha, mix: 0, ratio: (alpha / base) ** 2 })
		}
	}
	return modes.sort((p, q) => p.ratio - q.ratio)
}

// J_n(x) for n = 0..nMax at once, by Miller's backward recurrence: start far
// above the order wanted with an arbitrary tiny value, recur downward (the
// stable direction), then fix the scale with J₀ + 2·ΣJ₂ₖ = 1.
const scratch = new Float64Array(512)
export function besselAllOrders(x, nMax, out) {
	out.fill(0, 0, nMax + 1)
	if (x === 0) {
		out[0] = 1
		return out
	}
	const m = 2 * Math.ceil((Math.max(nMax, x) + 30 + 10 * Math.cbrt(x)) / 2)
	const j = m + 2 > scratch.length ? new Float64Array(m + 2) : scratch
	j[m + 1] = 0
	j[m] = 1e-30
	let sum = 0 // J₀ + 2·ΣJ₂ₖ over the unscaled values
	for (let n = m; n > 0; n--) {
		j[n - 1] = (2 * n / x) * j[n] - j[n + 1]
		if (Math.abs(j[n - 1]) > 1e250) {
			for (let k = n - 1; k <= m; k++) j[k] *= 1e-250
			sum *= 1e-250
		}
		if (n - 1 > 0 && (n - 1) % 2 === 0) sum += 2 * j[n - 1]
	}
	sum += j[0]
	for (let n = 0; n <= nMax; n++) out[n] = j[n] / sum
	return out
}

// The sample position of table column i.
const tableX = (i) => (i / (BESSEL_WIDTH - 1)) * BESSEL_X_MAX

// Fill the table with raw J_n values, one column per recurrence.
function rawTable() {
	const data = new Float32Array(BESSEL_ROWS * BESSEL_WIDTH)
	const col = new Float64Array(BESSEL_ROWS)
	for (let i = 0; i < BESSEL_WIDTH; i++) {
		besselAllOrders(tableX(i), BESSEL_ROWS - 1, col)
		for (let n = 0; n < BESSEL_ROWS; n++) data[n * BESSEL_WIDTH + i] = col[n]
	}
	return data
}

// The divisor each row is scaled by: its largest |J_n| over the table. J₀
// peaks at 1 but J₈ only near 0.3, and an unscaled table would let low-n modes
// drown the rest.
let peaks = null
export function besselRowPeaks() {
	if (!peaks) {
		const data = rawTable()
		peaks = new Float64Array(BESSEL_ROWS)
		for (let n = 0; n < BESSEL_ROWS; n++) {
			let peak = 0
			for (let i = 0; i < BESSEL_WIDTH; i++) peak = Math.max(peak, Math.abs(data[n * BESSEL_WIDTH + i]))
			peaks[n] = peak
		}
	}
	return peaks
}

// J_n sampled over [0, BESSEL_X_MAX], each row scaled so its peak is 1.
export function besselTable() {
	const data = rawTable()
	const p = besselRowPeaks()
	for (let n = 0; n < BESSEL_ROWS; n++) {
		const row = n * BESSEL_WIDTH
		for (let i = 0; i < BESSEL_WIDTH; i++) data[row + i] /= p[n]
	}
	return data
}

// The FFT bins each mode listens to: a semitone either side of its frequency,
// and always at least the nearest bin. A mode above Nyquist gets lo > hi.
export function modeBinRanges(modes, fundamentalHz, sampleRate, numBins, fftSize = 2048) {
	const binHz = sampleRate / fftSize
	const semitone = Math.pow(2, 1 / 12)
	const ranges = new Int32Array(modes.length * 2)
	for (let i = 0; i < modes.length; i++) {
		const f = fundamentalHz * modes[i].ratio
		const center = Math.round(f / binHz)
		let lo = Math.min(Math.floor(f / semitone / binHz), center)
		let hi = Math.max(Math.ceil(f * semitone / binHz), center)
		lo = Math.max(lo, 0)
		hi = Math.min(hi, numBins - 1)
		if (center > numBins - 1) { lo = 1; hi = 0 }
		ranges[i * 2] = lo
		ranges[i * 2 + 1] = hi
	}
	return ranges
}

// The strongest `count` modes above `threshold`, as [index, weight] pairs into
// `out` (length ≥ count·2). Returns how many were picked.
//
// The weight is sharpened by (level / strongest)², so the loudest mode carries
// the figure and the others ghost in beneath it instead of averaging it away.
export function pickModes(env, threshold, count, out) {
	let picked = 0
	for (let i = 0; i < env.length; i++) {
		const level = env[i] - threshold
		if (level <= 0) continue
		// Insertion into a short sorted list; count is 4, env is ~90 long.
		let slot = picked
		while (slot > 0 && out[(slot - 1) * 2 + 1] < level) slot--
		if (slot >= count) continue
		const last = Math.min(picked, count - 1)
		for (let j = last; j > slot; j--) {
			out[j * 2] = out[(j - 1) * 2]
			out[j * 2 + 1] = out[(j - 1) * 2 + 1]
		}
		out[slot * 2] = i
		out[slot * 2 + 1] = level
		if (picked < count) picked++
	}
	const strongest = picked > 0 ? out[1] : 0
	for (let j = 0; j < picked; j++) {
		const level = out[j * 2 + 1]
		const rel = level / strongest
		out[j * 2 + 1] = level * rel * rel
	}
	return picked
}
