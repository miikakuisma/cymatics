import { test } from 'node:test'
import assert from 'node:assert/strict'
import { besselFrac, fundamentalQuadrature, fundamentalTriangle, neumannDiscZeros, solveClass } from '../scripts/plate-modes/galerkin.mjs'
import { insidePolygon, polygon, symmetryClasses } from '../src/engine-js/polygons.js'
import { exactSquare, exactTriangle } from './exact-modes.js'

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`)

// Every eigenvalue of the shape up to kMax², a 2-D class's counted twice (its sin partner).
function solveAll(sides, kMax) {
	const ks = []
	for (const cls of symmetryClasses(sides)) for (const m of solveClass(sides, cls, { kMax })) {
		ks.push(m.k ** 2)
		if (cls.partner) ks.push(m.k ** 2)
	}
	return ks.sort((a, b) => a - b)
}

// Points for a mode's edge flux, shared by every mode of a shape so that
// evalMany evaluates the basis once per class: 40 points on edge 0 (5% clear of
// each corner) at ±h along the outward normal, then a 61×61 grid's points inside
// the plate at ±h in x and in y.
const H = 1e-5
function fluxPoints(sides) {
	const { vertices, offset } = polygon(sides)
	const [a, b] = vertices
	const nx = Math.sin(offset + Math.PI / sides), ny = Math.cos(offset + Math.PI / sides)
	const pts = []
	for (let i = 0; i < 40; i++) {
		const t = 0.05 + 0.9 * i / 39
		const x = a[0] + t * (b[0] - a[0]), y = a[1] + t * (b[1] - a[1])
		pts.push(x + H * nx, y + H * ny, x - H * nx, y - H * ny)
	}
	for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
		const x = -1 + i / 30, y = -1 + j / 30
		if (insidePolygon(sides, x, y)) pts.push(x + H, y, x - H, y, x, y + H, x, y - H)
	}
	return Float64Array.from(pts)
}

// max |∂u/∂n| on the edge over max |∇u| on the plate, both by central differences.
function edgeFluxRatio(mode, points) {
	const u = mode.evalMany(points)
	let flux = 0, grad = 0
	for (let i = 0; i < 40; i++) flux = Math.max(flux, Math.abs(u[2 * i] - u[2 * i + 1]) / (2 * H))
	for (let p = 80; p < u.length; p += 4) grad = Math.max(grad, Math.hypot(u[p] - u[p + 1], u[p + 2] - u[p + 3]) / (2 * H))
	return flux / grad
}

test('neumannDiscZeros: the constant, then the zeros of Jₙ′', () => {
	const z0 = neumannDiscZeros(0, 11)
	assert.equal(z0[0], 0)
	near(z0[1], 3.8317059702075123, 1e-12, "j′₀,₁")
	near(z0[3], 10.173468135062722, 1e-12, "j′₀,₃")
	assert.equal(z0.length, 4)
	const z1 = neumannDiscZeros(1, 6)
	assert.deepEqual(z1.map((z) => +z.toFixed(10)), [1.8411837813, 5.3314427735])
	near(neumannDiscZeros(5, 7.5)[0], 6.4156163757, 1e-9, "j′₅,₁")
})

test('besselFrac matches the closed forms of half-integer order', () => {
	const out = new Float64Array(3)
	for (const x of [1e-3, 0.7, 9, 60, 200]) {
		besselFrac(0.5, x, 2, out)
		const c = Math.sqrt(2 / (Math.PI * x))
		near(out[0], c * Math.sin(x), 1e-14, `J½(${x})`)
		near(out[1], c * (Math.sin(x) / x - Math.cos(x)), 1e-14, `J3/2(${x})`)
		// The closed form cancels badly for small x; the series' leading term stands in there.
		const j52 = x < 0.01 ? Math.sqrt(2 / Math.PI) * x ** 2.5 / 15 : c * ((3 / x ** 2 - 1) * Math.sin(x) - 3 * Math.cos(x) / x)
		near(out[2], j52, 1e-14, `J5/2(${x})`)
	}
})

test('the fundamental-triangle quadrature integrates what it should', () => {
	for (const sides of [3, 5, 6]) {
		const [, V] = fundamentalTriangle(sides)
		for (const corner of [0, 4]) {
			const { x, y, w } = fundamentalQuadrature(sides, 8, corner)
			let area = 0, sing = 0
			for (let i = 0; i < w.length; i++) {
				area += w[i]
				sing += w[i] * Math.hypot(x[i] - V[0], y[i] - V[1]) ** -0.5
			}
			near(area * 2 * sides, (sides / 2) * Math.sin(2 * Math.PI / sides), 1e-13, `${sides}-gon area`)
			// ∫ r′^(−½) over the triangle, r′ from vertex 0: only the graded corner patch gets it right.
			if (corner) {
				const ref = fundamentalQuadrature(sides, 30, 12)
				let want = 0
				for (let i = 0; i < ref.w.length; i++) want += ref.w[i] * Math.hypot(ref.x[i] - V[0], ref.y[i] - V[1]) ** -0.5
				near(sing / want, 1, 1e-12, `${sides}-gon singular integral`)
			}
		}
	}
})

test('the square comes out exact', () => {
	const got = solveAll(4, 14)
	const want = exactSquare(14 ** 2)
	assert.equal(got.length, want.length)
	got.forEach((v, i) => near(v / want[i], 1, 1e-6, `square λ${i}`))
})

test('the equilateral triangle comes out exact', () => {
	const got = solveAll(3, 20)
	const want = exactTriangle(20 ** 2)
	assert.equal(got.length, want.length)
	got.forEach((v, i) => near(v / want[i], 1, 1e-6, `triangle λ${i}`))
})

test('eigenfunctions are normalised over the plate, and eval agrees with evalMany', () => {
	const sides = 5
	const pts = []
	const { x, y, w } = fundamentalQuadrature(sides, 12, 4)
	for (let i = 0; i < w.length; i++) pts.push(x[i], y[i])
	const points = Float64Array.from(pts)
	// The 1-D class integrates over F × 2N; the 2-D class needs its partner too, so check a 1-D one.
	for (const m of solveClass(sides, { j: 0, parity: 'cos', partner: false }, { kMax: 12 })) {
		const u = m.evalMany(points)
		let norm = 0
		for (let i = 0; i < w.length; i++) norm += w[i] * u[i] ** 2
		near(norm * 2 * sides, 1, 1e-6, `∫u² for k=${m.k}`)
		near(m.eval(points[10], points[11]), u[5], 1e-12, 'eval vs evalMany')
	}
})

test('every eigenfunction has a zero normal derivative on the edge', () => {
	for (const sides of [3, 5, 6]) {
		const points = fluxPoints(sides)
		for (const cls of symmetryClasses(sides)) {
			for (const m of solveClass(sides, cls, { kMax: 15 })) {
				assert.ok(edgeFluxRatio(m, points) < 2e-3, `${sides}-gon class ${cls.j}${cls.parity} k=${m.k}`)
			}
		}
	}
})
