// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The corner terms of a pentagon or hexagon plate mode: the one definition the
// offline fit (scripts/plate-modes/fit.mjs) and the engine (plate-modes.js,
// and through it the GPU bake) share. See plate-modes.js for the formula.
// Kept apart from plate-modes.js so the generator can import it before
// plate-data.js exists.

import { besselFrac } from './modes.js'
import { cornerFrame, cornerOrders, fundamentalTriangle } from './polygons.js'

export const KIND_EVEN = 0
export const KIND_ODD = 1
export const KIND_A = 2
export const KIND_B = 3

export const CORNER_X_MAX = 128
export const CORNER_TABLE_WIDTH = 2048
export const CORNER_ROWS_PER_ORDER = 4
export const CORNER_SAMPLES = CORNER_TABLE_WIDTH * CORNER_ROWS_PER_ORDER

/** The weight of image (k, h) in a corner term of `kind`, for class j. */
export function cornerWeight(sides, j, kind, partner, k, h) {
	const d = 2 * Math.PI * k / sides
	const c = Math.cos(j * d), s = Math.sin(j * d)
	if (kind === KIND_EVEN) return c
	if (kind === KIND_ODD) return h ? -c : c
	if (kind === KIND_A) return partner ? -s : c
	return (h ? -1 : 1) * (partner ? c : s)
}

// Per shape: the frame, the orders and how they share recurrences. μ = base +
// idx with 0 < base < 1; orders whose bases agree share one besselFrac call.
const geometries = {}
function geometry(sides) {
	if (geometries[sides]) return geometries[sides]
	const mus = cornerOrders(sides)
	const families = []
	const family = [], index = []
	for (const mu of mus) {
		const idx = Math.floor(mu), base = mu - idx
		let f = families.findIndex((g) => Math.abs(g.base - base) < 1e-9)
		if (f < 0) { f = families.length; families.push({ base, top: 0 }) }
		families[f].top = Math.max(families[f].top, idx)
		family.push(f)
		index.push(idx)
	}
	const rot = []
	for (let k = 0; k < sides; k++) rot.push([Math.cos(2 * Math.PI * k / sides), Math.sin(2 * Math.PI * k / sides)])
	return (geometries[sides] = { frame: cornerFrame(sides), mus, families, family, index, rot, buf: families.map((g) => new Float64Array(g.top + 1)) })
}

const jmu = new Float64Array(8), cosmu = new Float64Array(8)

// Corner term values (and Σ|terms| into `mag`, if given) at (x, y).
function cornerEval(sides, j, partner, ms, kinds, count, beta, x, y, out, mag, table) {
	const g = geometry(sides), f = g.frame
	out.fill(0, 0, count)
	if (mag) mag.fill(0, 0, count)
	for (let k = 0; k < sides; k++) {
		const [cd, sd] = g.rot[k]
		const qx = x * cd + y * sd, qy = -x * sd + y * cd
		for (let h = 0; h < 2; h++) {
			const dx = (h ? -qx : qx) - f.vx, dy = qy - f.vy
			const u = dx * f.bx + dy * f.by, s = dx * f.wx + dy * f.wy
			const rr = Math.hypot(u, s)
			if (rr === 0) continue // J_μ(0) = 0
			const phi = Math.atan2(s, u) + f.halfAngle
			const z = beta * rr
			if (table) {
				for (let m = 0; m < g.mus.length; m++) jmu[m] = cornerTableLookup(table, m, z)
			} else {
				for (let q = 0; q < g.families.length; q++) besselFrac(g.families[q].base, z, g.families[q].top, g.buf[q])
				for (let m = 0; m < g.mus.length; m++) jmu[m] = g.buf[g.family[m]][g.index[m]]
			}
			for (let m = 0; m < g.mus.length; m++) cosmu[m] = Math.cos(g.mus[m] * phi)
			for (let t = 0; t < count; t++) {
				const w = cornerWeight(sides, j, kinds[t], partner, k, h)
				if (w === 0) continue
				const v = w * jmu[ms[t]] * cosmu[ms[t]]
				out[t] += v
				if (mag) mag[t] += Math.abs(v)
			}
		}
	}
	return out
}

/**
 * Each corner term's value Cₜ at (x, y) into `out`: term t is order ms[t]
 * (an index into cornerOrders(sides)) and kinds[t], of class j at wavenumber
 * beta; `partner` evaluates the derived sin partner's. `table` (from
 * cornerBesselTable) swaps exact J_μ for the GPU's interpolated table.
 */
export function cornerValues(sides, j, partner, ms, kinds, count, beta, x, y, out, table = null) {
	return cornerEval(sides, j, partner, ms, kinds, count, beta, x, y, out, null, table)
}

/**
 * The corner terms a class can carry: { ms, kinds }, every order with the
 * class's kinds (1-D: even for cos, odd for sin; 2-D: A and B), less those
 * whose projection vanishes — tested numerically at points of the fundamental
 * triangle away from vertex 0, as the solver does.
 */
export function classCornerTerms(sides, j, parity, partner) {
	const kinds = partner ? [KIND_A, KIND_B] : [parity === 'cos' ? KIND_EVEN : KIND_ODD]
	const ms = [], ks = []
	const [A, B, C] = fundamentalTriangle(sides)
	const val = new Float64Array(1), mag = new Float64Array(1)
	for (let m = 0; m < cornerOrders(sides).length; m++) for (const kind of kinds) {
		const live = [[0.6, 0.2, 0.2], [0.3, 0.3, 0.4], [0.2, 0.5, 0.3], [0.5, 0.1, 0.4]].some(([a, b, c]) => {
			cornerEval(sides, j, false, [m], [kind], 1, 1.7, a * A[0] + b * B[0] + c * C[0], a * A[1] + b * B[1] + c * C[1], val, mag, null)
			return Math.abs(val[0]) > 1e-10 * mag[0]
		})
		if (live) { ms.push(m); ks.push(kind) }
	}
	return { ms: Int32Array.from(ms), kinds: Int32Array.from(ks) }
}

const cornerTables = {}
/**
 * Raw J_μ for each of the shape's corner orders, sampled at
 * x = s/(CORNER_SAMPLES − 1)·CORNER_X_MAX, laid out as the header describes.
 * { data, width, rows, rowsPerOrder, samples, xMax, orders }; rows = 0 for the
 * triangle.
 */
export function cornerBesselTable(sides) {
	if (cornerTables[sides]) return cornerTables[sides]
	const g = geometry(sides)
	const rows = g.mus.length * CORNER_ROWS_PER_ORDER
	const data = new Float32Array(Math.max(1, rows) * CORNER_TABLE_WIDTH)
	for (let s = 0; s < CORNER_SAMPLES && g.mus.length; s++) {
		const x = s / (CORNER_SAMPLES - 1) * CORNER_X_MAX
		for (let q = 0; q < g.families.length; q++) besselFrac(g.families[q].base, x, g.families[q].top, g.buf[q])
		for (let m = 0; m < g.mus.length; m++) data[m * CORNER_SAMPLES + s] = g.buf[g.family[m]][g.index[m]]
	}
	return (cornerTables[sides] = { data, width: CORNER_TABLE_WIDTH, rows, rowsPerOrder: CORNER_ROWS_PER_ORDER, samples: CORNER_SAMPLES, xMax: CORNER_X_MAX, orders: g.mus })
}

/** J_μ(x) for corner order m from the table, linearly interpolated as the GPU does. */
export function cornerTableLookup(table, m, x) {
	const f = Math.min(Math.max(x / table.xMax, 0), 1) * (table.samples - 1)
	const i = Math.min(Math.floor(f), table.samples - 2)
	const t = f - i
	const o = m * table.samples + i
	return table.data[o] * (1 - t) + table.data[o + 1] * t
}
