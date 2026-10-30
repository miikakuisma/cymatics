// What a shipped mode looks like on the plate: its peak, and how far its
// normal derivative on the edge is from zero. Offline only; the test suite
// measures the same things its own way.

import { insidePolygon, polygon } from '../../src/engine-js/polygons.js'

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

/**
 * The largest |f| on the plate, and f's value there: a 200×200 grid over
 * [−1, 1]², 100 points along each edge from its first vertex (on it, a hair
 * inside), then a pattern search from the best `starts` — a coarse grid alone
 * misses a sharp peak of a high mode by several percent.
 */
export function peakOf(sides, f, starts = 10) {
	const { vertices } = polygon(sides)
	const cands = []
	for (let i = 0; i < 200; i++) for (let j = 0; j < 200; j++) {
		const x = -1 + 2 * i / 199, y = -1 + 2 * j / 199
		if (insidePolygon(sides, x, y)) cands.push([Math.abs(f(x, y)), x, y])
	}
	for (let e = 0; e < sides; e++) {
		const [a, b] = [vertices[e], vertices[(e + 1) % sides]]
		for (let i = 0; i < 100; i++) {
			const t = i / 100, x = (a[0] + t * (b[0] - a[0])) * (1 - 1e-12), y = (a[1] + t * (b[1] - a[1])) * (1 - 1e-12)
			cands.push([Math.abs(f(x, y)), x, y])
		}
	}
	cands.sort((p, q) => q[0] - p[0])
	let best = [0, 0, 0]
	for (let [v, x, y] of cands.slice(0, starts)) {
		for (let s = 0.005; s > 1e-7; s /= 2) {
			for (let moved = true; moved;) {
				moved = false
				for (const [dx, dy] of STEPS) {
					const nx = x + s * dx, ny = y + s * dy
					if (!insidePolygon(sides, nx, ny)) continue
					const nv = Math.abs(f(nx, ny))
					if (nv > v) { v = nv; x = nx; y = ny; moved = true }
				}
			}
		}
		if (v > best[0]) best = [v, x, y]
	}
	return { peak: best[0], value: f(best[1], best[2]) }
}

/**
 * max |∂f/∂n| along the edges over max |∇f| on the plate. The normal
 * derivative is a second-order one-sided difference from inside (h = 1e-4);
 * `clear` keeps 5% clear of each corner (as the solver's own check does),
 * `full` runs to 0.5% of it. |∇f| is by central differences on a 150×150 grid.
 */
export function edgeFlux(sides, f) {
	const { vertices } = polygon(sides)
	const h = 1e-4, d = 1e-9
	let clear = 0, full = 0
	for (let e = 0; e < sides; e++) {
		const [a, b] = [vertices[e], vertices[(e + 1) % sides]]
		let nx = b[1] - a[1], ny = a[0] - b[0]
		const len = Math.hypot(nx, ny)
		nx /= len; ny /= len
		if (nx * (a[0] + b[0]) + ny * (a[1] + b[1]) < 0) { nx = -nx; ny = -ny }
		const at = (px, py, s) => f(px - (d + s * h) * nx, py - (d + s * h) * ny)
		const flux = (t) => {
			const px = a[0] + t * (b[0] - a[0]), py = a[1] + t * (b[1] - a[1])
			return Math.abs((3 * at(px, py, 0) - 4 * at(px, py, 1) + at(px, py, 2)) / (2 * h))
		}
		for (let i = 0; i < 40; i++) clear = Math.max(clear, flux(0.05 + 0.9 * i / 39))
		for (let i = 0; i < 100; i++) full = Math.max(full, flux(0.005 + 0.99 * i / 99))
	}
	const g = 1e-5
	let grad = 0
	for (let i = 0; i < 150; i++) for (let j = 0; j < 150; j++) {
		const x = -1 + 2 * (i + 0.5) / 150, y = -1 + 2 * (j + 0.5) / 150
		if (!insidePolygon(sides, x + g, y) || !insidePolygon(sides, x - g, y) || !insidePolygon(sides, x, y + g) || !insidePolygon(sides, x, y - g)) continue
		grad = Math.max(grad, Math.hypot(f(x + g, y) - f(x - g, y), f(x, y + g) - f(x, y - g)) / (2 * g))
	}
	return { clear: clear / grad, full: full / grad }
}
