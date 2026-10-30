import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { encodePlate, quantise } from '../scripts/plate-modes/encode.mjs'
import { fitSingleK, fitSamples } from '../scripts/plate-modes/fit.mjs'
import { solveClass } from '../scripts/plate-modes/galerkin.mjs'
import { modeBinRanges } from '../src/engine-js/modes.js'
import { PLATE_DATA } from '../src/engine-js/plate-data.js'
import {
	CORNER_X_MAX, cornerBesselTable, cornerOrders, decodePlate, evalPolygonMode, evalStoredMode, modeGain, plateCoeffTexture,
	plateCornerTexture, plateStoredModes, polygonModes,
} from '../src/engine-js/plate-modes.js'
import { classOrders, insidePolygon, polygon, symmetryClasses, thetaPrime } from '../src/engine-js/polygons.js'
import { exactTriangle } from './exact-modes.js'

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`)
const toBase64 = (bytes) => Buffer.from(bytes).toString('base64')

test('an encoded plate decodes to the same modes', () => {
	const modes = [
		{ j: 0, parity: 'cos', partner: false, k: 3.1416, coeffs: Float64Array.from([1, -0.5, 0.25e-3]) },
		{ j: 1, parity: 'cos', partner: true, partnerGain: 1.0625, k: 4.5, coeffs: Float64Array.from([0.2, 7.5, -3, 1e-5, 2]),
			corners: { ms: [0, 1, 2], kinds: [3, 2, 2], coeffs: [0.5, -1.25, 9] } },
		{ j: 0, parity: 'sin', partner: false, k: 6.25, coeffs: Float64Array.from([-0.75]) },
	]
	const plate = decodePlate(toBase64(encodePlate(5, modes)))
	assert.equal(plate.sides, 5)
	assert.equal(plate.modes.length, 3)
	plate.modes.forEach((got, i) => {
		const want = modes[i]
		assert.equal(got.j, want.j)
		assert.equal(got.parity, want.parity)
		assert.equal(got.partner, want.partner)
		assert.equal(got.k, Math.fround(want.k))
		assert.deepEqual(Array.from(got.orders), Array.from(classOrders(5, want.j, want.parity, 100).slice(0, want.coeffs.length)))
		assert.equal(got.partnerGain, want.partner ? Math.fround(want.partnerGain) : 1)
		const corners = want.corners ?? { ms: [], kinds: [], coeffs: [] }
		const scale = Math.max(...want.coeffs.map(Math.abs), ...corners.coeffs.map(Math.abs))
		assert.equal(got.coeffs.length, want.coeffs.length)
		got.coeffs.forEach((c, n) => near(c, want.coeffs[n], scale / 32767, `mode ${i} c${n}`))
		assert.deepEqual(Array.from(got.cornerM), corners.ms)
		assert.deepEqual(Array.from(got.cornerKind), corners.kinds)
		got.cornerCoeffs.forEach((c, n) => near(c, corners.coeffs[n], scale / 32767, `mode ${i} d${n}`))
	})
})

test('quantising keeps the largest coefficient exact to float32', () => {
	const { scale, q, values } = quantise(Float64Array.from([0.5, -2, 1e-3]))
	assert.equal(scale, 2)
	assert.deepEqual(Array.from(q), [8192, -32767, 16])
	assert.equal(values[1], -2)
})

test('a single-k refit reproduces the solver’s modes, with coefficients int16 can hold', () => {
	// Triangle modes are trigonometric (entire): the series alone converges. The
	// pentagon's vertices are singular (r′^(5/3)); its corner terms carry that.
	for (const [sides, kMax] of [[3, 12], [5, 10]]) {
		for (const cls of symmetryClasses(sides)) {
			const samples = fitSamples(sides, cls, kMax)
			for (const mode of solveClass(sides, cls, { kMax })) {
				const { coeffs, corners, relResidual } = fitSingleK(sides, cls, mode, undefined, samples)
				const where = `${sides}-gon ${cls.j}${cls.parity} k=${mode.k}`
				assert.ok(relResidual < 1e-4, `${where}: residual ${relResidual}`)
				assert.ok(coeffs.length >= 1)
				assert.equal(corners.ms.length > 0, sides === 5, `${where}: corner terms`)
				// Against a solver mode of ∫u² = 1, whose peak is O(1).
				assert.ok(Math.max(...coeffs.map(Math.abs), ...corners.coeffs.map(Math.abs)) < 20, `${where}: coefficients`)
			}
		}
	}
})

test('each shape lists 620 modes, sorted, starting at ratio 1, with pairs split', () => {
	for (const sides of [3, 5, 6]) {
		const modes = polygonModes(sides)
		assert.ok(modes.length >= 620 && modes.length <= 622, `${sides}: ${modes.length} modes`)
		near(modes[0].ratio, 1, 1e-12, 'lowest mode is the reference')
		for (let i = 1; i < modes.length; i++) assert.ok(modes[i].ratio > modes[i - 1].ratio, `${sides}: strictly rising at ${i}`)
		assert.ok(modes.some((m) => m.mix === 1), 'derived partners are listed')
		// A pair is listed cos first, its partner a SPLIT up.
		const partner = modes.find((m) => m.mix === 1)
		const cos = modes.find((m) => m.a === partner.a && m.mix === 0)
		near(partner.ratio / cos.ratio, Math.pow(2, 1 / 36), 1e-9, `${sides}: partner split`)
	}
})

test('the triangle data matches the exact eigenvalues', () => {
	const got = polygonModes(3).map((m) => m.b ** 2).sort((a, b) => a - b)
	// Ruling R2: a finite bound past the largest listed eigenvalue (exactTriangle leaves λ = 0 out).
	const want = exactTriangle(got.at(-1) * 1.01).slice(0, got.length)
	assert.equal(want.length, got.length)
	got.forEach((v, i) => near(v / want[i], 1, 1e-4, `λ${i}`))
})

// A figure on a 200×200 grid over [−1, 1]² (0 outside the plate). Every listed
// figure is even or odd under x → −x (θ′ → −θ′: cos members even, sin and
// derived partners odd), so half the grid is evaluated and mirrored.
const GRID = 200
const gridX = (i) => -1 + 2 * i / (GRID - 1)
function figureGrid(sides, entry) {
	const mirror = plateModesOf(sides)[entry.a].parity === 'cos' && entry.mix === 0 ? 1 : -1
	const u = new Float64Array(GRID * GRID)
	for (let i = 0; i < GRID / 2; i++) for (let j = 0; j < GRID; j++) {
		const v = evalPolygonMode(sides, entry, gridX(i), gridX(j))
		u[i * GRID + j] = v
		u[(GRID - 1 - i) * GRID + j] = mirror * v
	}
	return u
}

// The largest |u| inside the plate: the grid, the vertices and points along
// each edge, then a pattern search from the best few, since a coarse grid
// misses a sharp peak of a high mode by several percent.
function peakOf(sides, entry, grid) {
	const u = (x, y) => Math.abs(evalPolygonMode(sides, entry, x, y))
	const { vertices } = polygon(sides)
	const cands = []
	for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
		if (insidePolygon(sides, gridX(i), gridX(j))) cands.push([Math.abs(grid[i * GRID + j]), gridX(i), gridX(j)])
	}
	for (let e = 0; e < sides; e++) {
		const [a, b] = [vertices[e], vertices[(e + 1) % sides]]
		for (let i = 0; i < 100; i++) {
			const t = i / 100, x = (a[0] + t * (b[0] - a[0])) * (1 - 1e-12), y = (a[1] + t * (b[1] - a[1])) * (1 - 1e-12)
			cands.push([u(x, y), x, y])
		}
	}
	cands.sort((p, q) => q[0] - p[0])
	let best = 0
	for (let [v, x, y] of cands.slice(0, 5)) {
		for (let s = 0.005; s > 1e-7; s /= 2) {
			for (let moved = true; moved;) {
				moved = false
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
					const nx = x + s * dx, ny = y + s * dy
					if (!insidePolygon(sides, nx, ny)) continue
					const nv = u(nx, ny)
					if (nv > v) { v = nv; x = nx; y = ny; moved = true }
				}
			}
		}
		best = Math.max(best, v)
	}
	return best
}

// max |∂u/∂n| along the edges (second-order one-sided differences from inside,
// 5% clear of each corner, as the solver's own test) over max |∇u| on the plate
// (central differences on the grid, between points all inside: at a grid step
// of 0.01 that reads a high mode's gradient up to ~10% low, which only makes
// the ratio stricter).
function edgeFluxRatio(sides, entry, grid) {
	const u = (x, y) => evalPolygonMode(sides, entry, x, y)
	const { vertices } = polygon(sides)
	const h = 1e-4, d = 1e-9
	let flux = 0
	for (let e = 0; e < sides; e++) {
		const [a, b] = [vertices[e], vertices[(e + 1) % sides]]
		let nx = b[1] - a[1], ny = a[0] - b[0]
		const len = Math.hypot(nx, ny)
		nx /= len; ny /= len
		if (nx * (a[0] + b[0]) + ny * (a[1] + b[1]) < 0) { nx = -nx; ny = -ny }
		for (let i = 0; i < 40; i++) {
			const t = 0.05 + 0.9 * i / 39
			const px = a[0] + t * (b[0] - a[0]), py = a[1] + t * (b[1] - a[1])
			const at = (s) => u(px - (d + s * h) * nx, py - (d + s * h) * ny)
			flux = Math.max(flux, Math.abs((3 * at(0) - 4 * at(1) + at(2)) / (2 * h)))
		}
	}
	const step = 2 / (GRID - 1)
	const inside = (i, j) => insidePolygon(sides, gridX(i), gridX(j))
	let grad = 0
	for (let i = 1; i < GRID - 1; i++) for (let j = 1; j < GRID - 1; j++) {
		if (!inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1)) continue
		const gx = grid[(i + 1) * GRID + j] - grid[(i - 1) * GRID + j], gy = grid[i * GRID + j + 1] - grid[i * GRID + j - 1]
		grad = Math.max(grad, Math.hypot(gx, gy) / (2 * step))
	}
	return flux / grad
}

test('every shipped mode is a figure: peak 1, zero edge flux', () => {
	for (const sides of [3, 5, 6]) for (const entry of polygonModes(sides).filter((_, i) => i % 31 === 0)) {
		const grid = figureGrid(sides, entry)
		const peak = peakOf(sides, entry, grid)
		assert.ok(peak >= 0.97 && peak <= 1.002, `${sides}-gon mode ${entry.a}/${entry.mix}: peak ${peak}`)
		const flux = edgeFluxRatio(sides, entry, grid)
		assert.ok(flux < 5e-3, `${sides}-gon mode ${entry.a}/${entry.mix} k=${entry.b}: edge flux ${flux}`)
	}
})

test('a derived partner is the cos member turned by one step of the shape', () => {
	// u(Q p) = cos(jδ)·u(p) − sin(jδ)·ũ(p), Q turning θ′ by δ = 2π/N. This pins
	// partnerSign and the sin/cos choice that the GPU bake must repeat.
	for (const sides of [3, 5, 6]) {
		const modes = polygonModes(sides)
		const partner = modes.find((m) => m.mix === 1)
		const cos = { ...partner, mix: 0 }
		const stored = plateModesOf(sides)[partner.a]
		const gain = modeGain(sides, partner)
		assert.ok(gain > 0.5 && gain < 2, `${sides}-gon partner gain ${gain}`)
		const delta = 2 * Math.PI / sides
		for (const [x, y] of [[0.1, 0.2], [-0.3, 0.05], [0.2, -0.4], [0.02, 0.6]]) {
			const r = Math.hypot(x, y), t = thetaPrime(x, y)
			const qx = r * Math.sin(t + delta), qy = r * Math.cos(t + delta)
			const want = Math.cos(stored.j * delta) * evalPolygonMode(sides, cos, x, y) - Math.sin(stored.j * delta) * evalPolygonMode(sides, partner, x, y) / gain
			near(evalPolygonMode(sides, cos, qx, qy), want, 1e-9, `${sides}-gon at (${x}, ${y})`)
		}
		assert.equal(evalPolygonMode(sides, cos, 0.99, 0.99), 0, 'outside the plate is 0')
	}
})

// The stored modes, decoded straight from the shipped data.
const plateModesOf = (sides) => decodePlate(PLATE_DATA[sides]).modes

test('the coefficient texture holds each stored mode’s orders and coefficients', () => {
	for (const sides of [3, 5, 6]) {
		const stored = plateModesOf(sides)
		const { width, height, data } = plateCoeffTexture(sides)
		assert.equal(height, stored.length)
		assert.equal(width, Math.max(...stored.map((m) => m.orders.length)))
		assert.ok(width <= 128)
		for (const row of [0, Math.floor(height / 2), height - 1]) {
			const m = stored[row]
			for (let i = 0; i < width; i++) {
				const o = (row * width + i) * 2
				assert.equal(data[o], i < m.orders.length ? m.orders[i] : 0)
				assert.equal(data[o + 1], i < m.orders.length ? m.coeffs[i] : 0)
			}
		}
	}
})

test('the corner texture holds each stored mode’s corner terms; the triangle has none', () => {
	assert.ok(plateStoredModes(3).every((m) => m.cornerM.length === 0))
	for (const sides of [5, 6]) {
		const stored = plateModesOf(sides)
		const { width, height, data } = plateCornerTexture(sides)
		assert.equal(height, stored.length)
		assert.equal(width, Math.max(...stored.map((m) => m.cornerM.length)))
		assert.ok(stored.some((m) => m.cornerM.length > 0))
		for (let row = 0; row < height; row++) {
			const m = stored[row]
			for (let t = 0; t < width; t++) {
				const o = (row * width + t) * 4
				assert.deepEqual(Array.from(data.subarray(o, o + 4)), t < m.cornerM.length ? [m.cornerM[t], m.cornerKind[t], m.cornerCoeffs[t], 0] : [0, 0, 0, 0])
			}
			assert.ok(m.cornerM.every((i) => i < cornerOrders(sides).length))
		}
	}
})

test('the GPU’s interpolated corner table stays within 1e-4 of the exact J_μ', () => {
	// evalPolygonMode evaluates J_μ exactly; the bake reads cornerBesselTable
	// with linear interpolation. Compare the two on every 31st mode's figure.
	for (const sides of [5, 6]) {
		const table = cornerBesselTable(sides)
		assert.equal(table.xMax, CORNER_X_MAX)
		assert.ok(plateModesOf(sides).every((m) => 2 * m.k <= CORNER_X_MAX), 'every k·r′ inside the table')
		let worst = 0
		for (const entry of polygonModes(sides).filter((_, i) => i % 31 === 0)) {
			const mode = plateModesOf(sides)[entry.a]
			for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
				const x = -1 + 2 * (i + 0.5) / 40, y = -1 + 2 * (j + 0.5) / 40
				if (!insidePolygon(sides, x, y)) continue
				const d = evalStoredMode(sides, mode, entry.mix, x, y, table) - evalStoredMode(sides, mode, entry.mix, x, y)
				worst = Math.max(worst, Math.abs(d))
			}
		}
		assert.ok(worst < 1e-4, `${sides}-gon: ${worst}`)
	}
})

test('shipped data fits the budget', () => {
	const gz = gzipSync(readFileSync(new URL('../src/engine-js/plate-data.js', import.meta.url))).length
	assert.ok(gz <= 150_000, `plate-data.js is ${gz} bytes gzipped`)
})

test('decoding and listing all three shapes is quick', async () => {
	const t0 = performance.now()
	const fresh = await import(`../src/engine-js/plate-modes.js?fresh=${Date.now()}`)
	for (const sides of [3, 5, 6]) fresh.polygonModes(sides)
	const ms = performance.now() - t0
	assert.ok(ms < 50, `${ms.toFixed(1)} ms`)
})

test('a tone above the last mode rings nothing', () => {
	const modes = polygonModes(6)
	const fundamental = 40
	const ranges = modeBinRanges(modes, fundamental, 44100, 1024)
	const f = fundamental * modes.at(-1).ratio * 1.2
	const bin = Math.round(f / (44100 / 2048))
	for (let i = 0; i < modes.length; i++) assert.ok(!(ranges[i * 2] <= bin && bin <= ranges[i * 2 + 1]), `mode ${i} hears ${f} Hz`)
})

test('the hexagon lists the eigenvalue k = 4π/3 (the equilateral-cell mode)', () => {
	const ks = plateStoredModes(6).map((m) => m.k)
	assert.ok(ks.some((k) => Math.abs(k - 4 * Math.PI / 3) < 1e-6), 'no k near 4π/3 = 4.18879')
})

test('shipped eigenvalue counts follow the three-term Neumann Weyl law', () => {
	// N(k) ≈ A k²/4π + L k/4π + C, C = Σ over corners of (π² − θ²)/(24πθ).
	// The count has multiplicity and the constant mode (k = 0, not stored).
	for (const N of [3, 5, 6]) {
		const A = N / 2 * Math.sin(2 * Math.PI / N)
		const L = 2 * N * Math.sin(Math.PI / N)
		const theta = Math.PI * (N - 2) / N
		const C = N * (Math.PI ** 2 - theta ** 2) / (24 * Math.PI * theta)
		const ks = []
		for (const m of plateStoredModes(N)) {
			ks.push(m.k)
			if (m.partner) ks.push(m.k)
		}
		ks.sort((a, b) => a - b)
		const kLast = ks.at(-1)
		for (const frac of [0.2, 0.4, 0.6, 0.8, 0.95]) {
			const k = frac * kLast
			const count = ks.filter((x) => x <= k).length + 1
			const weyl = A * k * k / (4 * Math.PI) + L * k / (4 * Math.PI) + C
			assert.ok(Math.abs(count - weyl) <= 4, `${N}-gon k=${k.toFixed(1)}: count ${count} vs Weyl ${weyl.toFixed(1)}`)
		}
	}
})
