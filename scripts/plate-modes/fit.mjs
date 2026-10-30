// Refit a Galerkin eigenfunction as one wavenumber's Fourier–Bessel series,
//   u ≈ Σ cᵢ·Tₙᵢ(k r)·cos|sin(nᵢθ′),   Tₙ = Jₙ / besselRowPeaks()[n],
// the form the engine evaluates (plate-modes.js) and bakes (Task 6's shader
// samples the same normalised Bessel table rows). An eigenfunction solves
// Δu + k²u = 0, so inside the polygon it *is* such a series, about the centre;
// the series converges wherever u extends — everywhere for the triangle, whose
// modes are trigonometric, but only slowly towards a pentagon's or hexagon's
// vertices, where u is singular (r′^(5/3), r′^(3/2)).
//
// For the pentagon and hexagon the series alone cannot do it: their vertices,
// on r = 1, are singular, and against the normalised rows the coefficients
// would have to grow like 1/Tₙ(k) past n ≈ k. So the fit carries the class's
// corner terms too (src/engine-js/plate-corners.js), and a small ridge keeps every
// coefficient O(1).
//
// The fit is weighted least squares over the fundamental triangle F's
// quadrature points, so the residual is an L2 norm over the plate:
// - a 1-D class transforms by a character, so u on F decides u everywhere and
//   ∫_P = 2N·∫_F;
// - a 2-D class's cos member u has a sin partner ũ, and ∫_P f² = N·∫_F (f² + f̃²)
//   (the solver's own identity). ũ is not an output of the solver, but u at the
//   points of F turned by δ = 2π/N gives it: u(Q p) = cos(jδ)·u(p) − sin(jδ)·ũ(p).
// Offline only.

import { BESSEL_ROWS, besselAllOrders, besselRowPeaks } from '../../src/engine-js/modes.js'
import { classOrders, partnerSign, thetaPrime } from '../../src/engine-js/polygons.js'
import { classCornerTerms, cornerValues } from '../../src/engine-js/plate-corners.js'
import { autoSubdivisions, fundamentalQuadrature } from './galerkin.mjs'

/** The highest order fitted at wavenumber k: past it Jₙ(k r ≤ k) is negligible. */
export const fitOrderMax = (k) => Math.min(BESSEL_ROWS - 1, Math.ceil(k + 10 + 3 * Math.cbrt(k)))

/** Trailing coefficients below this fraction of the largest are dropped. */
export const DROP = 1e-4

/**
 * Tikhonov weight on the coefficients, against the plate's area: a
 * coefficient of 1 costs what a misfit of √RIDGE everywhere would. Without it
 * the high orders, whose Tₙ(k r) is tiny over most of the plate, take
 * coefficients of 1e5 and more that one int16 scale per mode cannot hold;
 * with it they stay O(1) and the fit loses nothing measurable.
 */
export const RIDGE = 1e-12

/**
 * Points to fit a class at, for wavenumbers up to kMax: F's quadrature, and
 * for a 2-D class the same points turned by δ after them in `points`
 * (interleaved [x0, y0, …], what the solver's evalMany takes).
 */
export function fitSamples(sides, cls, kMax) {
	const { x, y, w } = fundamentalQuadrature(sides, autoSubdivisions(kMax))
	const count = w.length
	const points = new Float64Array((cls.partner ? 4 : 2) * count)
	const d = 2 * Math.PI / sides, cd = Math.cos(d), sd = Math.sin(d)
	for (let p = 0; p < count; p++) {
		points[2 * p] = x[p]
		points[2 * p + 1] = y[p]
		if (cls.partner) {
			// θ′ → θ′ + δ, with (x, y) = r·(sin θ′, cos θ′).
			points[2 * (count + p)] = x[p] * cd + y[p] * sd
			points[2 * (count + p) + 1] = y[p] * cd - x[p] * sd
		}
	}
	return { sides, cls, x, y, w, count, points }
}

/**
 * Every mode's values at `samples.points`, a chunk of points at a time. The
 * solver's evalMany caches its basis for the array it was last given, so all
 * modes see one chunk before the next is made: one basis evaluation per point
 * per class, and a cache of chunk × basis size rather than points × basis size.
 */
export function sampleModes(modes, samples, chunk = 1024) {
	const total = samples.points.length / 2
	const out = modes.map(() => new Float64Array(total))
	for (let s = 0; s < total; s += chunk) {
		const pts = samples.points.subarray(2 * s, 2 * Math.min(total, s + chunk))
		for (let i = 0; i < modes.length; i++) out[i].set(modes[i].evalMany(pts), s)
	}
	return out
}

// Least squares min ‖A c − b‖ by Householder QR, A column-major rows × cols.
// Columns are scaled to unit norm first: a high order's Tₙ(k r) is tiny over
// most of F. A and b are overwritten.
function leastSquares(A, rows, cols, b) {
	const scale = new Float64Array(cols)
	for (let j = 0; j < cols; j++) {
		let s = 0
		for (let i = 0; i < rows; i++) s += A[j * rows + i] ** 2
		scale[j] = s > 0 ? 1 / Math.sqrt(s) : 0
		for (let i = 0; i < rows; i++) A[j * rows + i] *= scale[j]
	}
	const diag = new Float64Array(cols)
	for (let j = 0; j < cols; j++) {
		const cj = j * rows
		let norm = 0
		for (let i = j; i < rows; i++) norm += A[cj + i] ** 2
		norm = Math.sqrt(norm)
		if (norm === 0) continue
		const alpha = A[cj + j] > 0 ? -norm : norm
		A[cj + j] -= alpha // v = x − α·e₁, kept in place
		let vtv = 0
		for (let i = j; i < rows; i++) vtv += A[cj + i] ** 2
		diag[j] = alpha
		const apply = (target, offset) => {
			let dot = 0
			for (let i = j; i < rows; i++) dot += A[cj + i] * target[offset + i]
			const f = 2 * dot / vtv
			for (let i = j; i < rows; i++) target[offset + i] -= f * A[cj + i]
		}
		for (let k = j + 1; k < cols; k++) apply(A, k * rows)
		apply(b, 0)
	}
	const c = new Float64Array(cols)
	for (let j = cols - 1; j >= 0; j--) {
		if (diag[j] === 0) continue
		let s = b[j]
		for (let k = j + 1; k < cols; k++) s -= A[k * rows + j] * c[k]
		c[j] = s / diag[j]
	}
	for (let j = 0; j < cols; j++) c[j] *= scale[j]
	return c
}

/**
 * The series for one mode from its values at `samples.points` (sampleModes),
 * with the class's corner terms (plate-modes.js cornerValues) at the same k.
 * @returns {{ coeffs: Float64Array, orders: Int32Array, corners: { ms, kinds,
 *   coeffs }, relResidual: number }} coeffs for the first coeffs.length orders
 *   of the class; relResidual the weighted L2 misfit over the plate relative
 *   to ‖u‖, after the drop.
 */
export function fitValues(samples, k, values, nMax = fitOrderMax(k), { ridge = RIDGE, corners = true } = {}) {
	const { sides, cls, x, y, w, count } = samples
	const all = classOrders(sides, cls.j, cls.parity, nMax)
	const cf = corners ? classCornerTerms(sides, cls.j, cls.parity, cls.partner) : { ms: new Int32Array(0), kinds: new Int32Array(0) }
	const nc = cf.ms.length
	const cv = new Float64Array(nc)
	const nd = all.length
	const cols = nd + nc
	const data = cls.partner ? 2 * count : count
	const rows = data + (ridge > 0 ? cols : 0)
	const A = new Float64Array(rows * cols), b = new Float64Array(rows)
	const peaks = besselRowPeaks()
	const J = new Float64Array(nMax + 2)
	const useSin = cls.parity === 'sin'
	const d = 2 * Math.PI / sides, cj = Math.cos(cls.j * d), sj = Math.sin(cls.j * d)
	for (let p = 0; p < count; p++) {
		const r = Math.hypot(x[p], y[p]), t = thetaPrime(x[p], y[p])
		besselAllOrders(k * r, nMax, J)
		const sw = Math.sqrt(w[p])
		b[p] = sw * values[p]
		if (cls.partner) b[count + p] = sw * (cj * values[p] - values[count + p]) / sj
		for (let i = 0; i < nd; i++) {
			const n = all[i], T = J[n] / peaks[n]
			A[i * rows + p] = sw * T * (useSin ? Math.sin(n * t) : Math.cos(n * t))
			if (cls.partner) A[i * rows + count + p] = sw * partnerSign(sides, cls.j, n) * T * Math.sin(n * t)
		}
		if (nc) {
			cornerValues(sides, cls.j, false, cf.ms, cf.kinds, nc, k, x[p], y[p], cv)
			for (let i = 0; i < nc; i++) A[(nd + i) * rows + p] = sw * cv[i]
			if (cls.partner) {
				cornerValues(sides, cls.j, true, cf.ms, cf.kinds, nc, k, x[p], y[p], cv)
				for (let i = 0; i < nc; i++) A[(nd + i) * rows + count + p] = sw * cv[i]
			}
		}
	}
	if (ridge > 0) {
		let area = 0
		for (let p = 0; p < count; p++) area += w[p]
		if (cls.partner) area *= 2
		for (let i = 0; i < cols; i++) A[i * rows + data + i] = Math.sqrt(ridge * area)
	}
	const A0 = Float64Array.from(A), b0 = Float64Array.from(b)
	const c = leastSquares(A, rows, cols, b)
	let max = 0
	for (let i = 0; i < nd; i++) max = Math.max(max, Math.abs(c[i]))
	let terms = nd
	while (terms > 1 && Math.abs(c[terms - 1]) < DROP * max) terms--
	for (let i = terms; i < nd; i++) c[i] = 0
	let err = 0, norm = 0
	for (let p = 0; p < data; p++) {
		let s = 0
		for (let i = 0; i < cols; i++) s += A0[i * rows + p] * c[i]
		err += (s - b0[p]) ** 2
		norm += b0[p] ** 2
	}
	return { coeffs: c.slice(0, terms), orders: all.slice(0, terms), corners: { ms: cf.ms, kinds: cf.kinds, coeffs: c.slice(nd) }, relResidual: Math.sqrt(err / norm) }
}

/** fitValues for one solver mode; pass `samples` to share one point set across a class. */
export function fitSingleK(sides, cls, mode, nMax = fitOrderMax(mode.k), samples = fitSamples(sides, cls, mode.k), options) {
	return fitValues(samples, mode.k, sampleModes([mode], samples)[0], nMax, options)
}
