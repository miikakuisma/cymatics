// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Polygon plates (field_mode 3–5): their free-edge (Neumann) modes, solved
// offline by scripts/plate-modes (`npm run plate-modes`) and shipped as data in
// plate-data.js. Here: decode it, list the modes like squareModes(), and
// evaluate one in JS — the reference the GPU bake (Task 6) must reproduce.
//
// A stored mode at wavenumber k is
//
//   u(x, y) = Σᵢ cᵢ·Tₙᵢ(k r)·trig(nᵢθ′)·σ(nᵢ)  +  Σₜ dₜ·Cₜ(x, y)
//
// with r = |(x, y)|, θ′ = atan2(x, y) (polygons.js), and:
// - Tₙ = Jₙ / besselRowPeaks()[n]: the normalised Bessel table row n
//   (modes.js besselTable()). nᵢ is the i-th of classOrders(sides, j, parity,
//   BESSEL_ROWS − 1).
// - trig = sin if the mode's parity is sin or the entry is a derived partner
//   (mix 1), else cos; σ(n) = partnerSign(sides, j, n) for mix 1, else 1.
// - Cₜ, the corner terms (pentagon and hexagon only; the triangle has none):
//   the class's projection of ψ_μ(p) = J_μ(k·r′)·cos(μ·φ′), polar about vertex
//   0 in cornerFrame(sides) (polygons.js): r′ = |p − V|, φ′ = atan2(s, u) +
//   halfAngle with u = (p − V)·b̂, s = (p − V)·ŵ. μ = cornerOrders(sides)[m]
//   (pentagon 5/3, 10/3, 20/3; hexagon 3/2, 9/2, 15/2). J_μ is NOT normalised.
//
//     Cₜ(p) = Σ_{k=0}^{N−1} Σ_{h=0,1} w(kindₜ, k, h) · ψ_μ(image(k, h, p))
//
//   image(k, 0, p) = Q_k p = (x cos d + y sin d, −x sin d + y cos d), d = 2πk/N
//   (Q_k turns θ′ by +d), and image(k, 1, p) is Q_k p with its x negated.
//   Every image of a point of the plate is in the plate, so φ′ ∈ [0, α] and
//   the branch cut (along −b̂, outside) is never crossed. With c = cos(j·d),
//   s = sin(j·d), and P = 1 for a derived partner (mix 1) else 0:
//     kind 0 (even):  w = c
//     kind 1 (odd):   w = h ? −c : c
//     kind 2 (A):     w = P ? −s : c
//     kind 3 (B):     w = (h ? −1 : 1)·(P ? c : s)
//   (cornerWeight). These are the solver's own corner functions
//   (scripts/plate-modes/galerkin.mjs) at β = k. They are evaluated in
//   plate-corners.js (cornerValues), which the offline fit imports too, so the
//   shipped terms and the fitted ones are one definition.
//
// Every mode is scaled so its peak |u| over the plate is 1. A derived partner
// has its cos member's L2 norm but not its peak, so mix 1 is further scaled by
// the mode's partnerGain, which brings its peak to 1 as well.
//
// Binary format PLT2, little-endian, base64 in PLATE_DATA[sides]:
//   'PLT2', uint8 sides, uint16 count, then per stored mode:
//   uint8 j, uint8 parity (0 cos, 1 sin), uint8 partner (1: list its derived
//   sin partner too), [float32 partnerGain, only if partner = 1],
//   float32 k, float32 scale, uint16 terms,
//   int16[terms] q, uint8 cornerTerms, then per corner term
//   uint8 code (m·4 + kind), int16 q.
//   cᵢ = qᵢ·scale/32767 and dₜ = qₜ·scale/32767 (one scale per mode).
//
// For the GPU (Task 6):
// - plateCoeffTexture(sides): RG32F, row = stored mode, texel i = (nᵢ, cᵢ),
//   zero past the mode's terms. Sample Tₙ from the existing Bessel table.
// - plateCornerTexture(sides): RGBA32F, row = stored mode, texel t =
//   (m, kind, dₜ, 0), zero past the mode's corner terms (d = 0 adds nothing).
// - modeGain(sides, entry): multiply a baked mix 1 entry by it (1 otherwise).
// - cornerBesselTable(sides): R32F, raw J_μ for each corner order m over
//   x ∈ [0, CORNER_X_MAX] at CORNER_SAMPLES points, sample s of order m at
//   row m·CORNER_ROWS_PER_ORDER + ⌊s / CORNER_TABLE_WIDTH⌋, column s mod
//   CORNER_TABLE_WIDTH; linear interpolation between samples s and s + 1
//   (cornerTableLookup). k·r′ ≤ k·2 ≤ CORNER_X_MAX for every shipped mode.
// - cornerFrame(sides) and cornerOrders(sides) (polygons.js), cornerWeight,
//   KIND_* (plate-corners.js); all re-exported from here.
// evalPolygonMode uses exact J_μ; the table's linear interpolation differs
// from it by < 1e-4 of the peak (pinned in test/plate-modes.test.js).

import { PLATE_DATA } from './plate-data.js'
import { SPLIT, besselAllOrders, besselRowPeaks } from './modes.js'
import { cornerValues } from './plate-corners.js'
import { classOrders, insidePolygon, partnerSign, thetaPrime } from './polygons.js'

export {
	CORNER_ROWS_PER_ORDER, CORNER_SAMPLES, CORNER_TABLE_WIDTH, CORNER_X_MAX, KIND_A, KIND_B, KIND_EVEN, KIND_ODD,
	classCornerTerms, cornerBesselTable, cornerTableLookup, cornerValues, cornerWeight,
} from './plate-corners.js'
export { cornerFrame, cornerOrders } from './polygons.js'

export const FORMAT = 'PLT2'
const MAX_ORDER = 100 // BESSEL_ROWS − 1: the orders a series may use
const Q = 32767

const classOrderCache = new Map()
function ordersOf(sides, j, parity) {
	const key = `${sides}:${j}:${parity}`
	if (!classOrderCache.has(key)) classOrderCache.set(key, classOrders(sides, j, parity, MAX_ORDER))
	return classOrderCache.get(key)
}

function base64Bytes(base64) {
	const s = atob(base64)
	const bytes = new Uint8Array(s.length)
	for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
	return bytes
}

/**
 * PLT2 → { sides, modes: [{ j, parity, partner, partnerGain, k, orders,
 * coeffs, cornerM, cornerKind, cornerCoeffs }] }.
 */
export function decodePlate(base64) {
	const bytes = base64Bytes(base64)
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== FORMAT) throw new Error('plate data: not PLT2')
	let o = 4
	const sides = view.getUint8(o); o += 1
	const count = view.getUint16(o, true); o += 2
	const modes = []
	for (let i = 0; i < count; i++) {
		const j = view.getUint8(o); o += 1
		const parity = view.getUint8(o) ? 'sin' : 'cos'; o += 1
		const partner = view.getUint8(o) === 1; o += 1
		let partnerGain = 1
		if (partner) { partnerGain = view.getFloat32(o, true); o += 4 }
		const k = view.getFloat32(o, true); o += 4
		const scale = view.getFloat32(o, true); o += 4
		const terms = view.getUint16(o, true); o += 2
		const coeffs = new Float32Array(terms)
		for (let t = 0; t < terms; t++) { coeffs[t] = view.getInt16(o, true) * scale / Q; o += 2 }
		const corners = view.getUint8(o); o += 1
		const cornerM = new Int32Array(corners), cornerKind = new Int32Array(corners), cornerCoeffs = new Float32Array(corners)
		for (let t = 0; t < corners; t++) {
			const code = view.getUint8(o); o += 1
			cornerM[t] = code >> 2
			cornerKind[t] = code & 3
			cornerCoeffs[t] = view.getInt16(o, true) * scale / Q; o += 2
		}
		const orders = ordersOf(sides, j, parity).subarray(0, terms)
		modes.push({ j, parity, partner, partnerGain, k, orders, coeffs, cornerM, cornerKind, cornerCoeffs })
	}
	return { sides, modes }
}

const plates = {}
/** The shipped stored modes of a shape, decoded once. */
export function plateStoredModes(sides) {
	if (!plates[sides]) plates[sides] = decodePlate(PLATE_DATA[sides]).modes
	return plates[sides]
}

/**
 * Stored modes → the listing [{ a: storedIndex, b: k, mix, ratio }]: every
 * stored mode, and a mix 1 entry for each derived partner. Sorted by λ = k²,
 * ratio = λ/λ_min; the i-th member of a run of equal λ (relative 1e-9) gets
 * ratio·SPLIT^i, mirror-symmetric (cos, mix 0) members first.
 */
export function listModes(stored) {
	const items = []
	stored.forEach((m, a) => {
		items.push({ a, b: m.k, mix: 0, sym: m.parity === 'cos' ? 0 : 1 })
		if (m.partner) items.push({ a, b: m.k, mix: 1, sym: 1 })
	})
	items.sort((p, q) => p.b - q.b || p.sym - q.sym || p.a - q.a || p.mix - q.mix)
	const lambda0 = items[0].b ** 2
	const out = []
	for (let i = 0; i < items.length;) {
		const l = items[i].b ** 2
		let e = i + 1
		while (e < items.length && items[e].b ** 2 - l <= 1e-9 * l) e++
		const run = items.slice(i, e).sort((p, q) => p.sym - q.sym || p.a - q.a || p.mix - q.mix)
		run.forEach((it, n) => out.push({ a: it.a, b: it.b, mix: it.mix, ratio: (l / lambda0) * SPLIT ** n }))
		i = e
	}
	return out.sort((p, q) => p.ratio - q.ratio)
}

const listings = {}
/** A shape's modes as [{ a, b, mix, ratio }], like squareModes(); memoised. */
export function polygonModes(sides) {
	if (!listings[sides]) listings[sides] = listModes(plateStoredModes(sides))
	return listings[sides]
}

const jScratch = new Float64Array(MAX_ORDER + 2)
const cornerScratch = new Float64Array(16)

/**
 * A stored mode's series at (x, y), defined across the whole disc (no outline
 * test); mix 1 is its derived sin partner. `table` as in cornerValues.
 */
export function evalStoredMode(sides, mode, mix, x, y, table = null) {
	const peaks = besselRowPeaks()
	const r = Math.hypot(x, y), t = thetaPrime(x, y)
	const { orders, coeffs } = mode
	const sinMode = mode.parity === 'sin' || mix === 1
	let u = 0
	if (orders.length) {
		besselAllOrders(mode.k * r, orders[orders.length - 1], jScratch)
		for (let i = 0; i < orders.length; i++) {
			const n = orders[i]
			const trig = sinMode ? Math.sin(n * t) : Math.cos(n * t)
			u += coeffs[i] * (jScratch[n] / peaks[n]) * trig * (mix === 1 ? partnerSign(sides, mode.j, n) : 1)
		}
	}
	const nc = mode.cornerM.length
	if (nc) {
		cornerValues(sides, mode.j, mix === 1, mode.cornerM, mode.cornerKind, nc, mode.k, x, y, cornerScratch, table)
		for (let i = 0; i < nc; i++) u += mode.cornerCoeffs[i] * cornerScratch[i]
	}
	return mix === 1 ? u * mode.partnerGain : u
}

/** The factor a listed entry's figure is scaled by after its series: partnerGain for mix 1. */
export function modeGain(sides, entry) {
	return entry.mix === 1 ? plateStoredModes(sides)[entry.a].partnerGain : 1
}

/** A listed mode's value at (x, y): 0 outside the plate. The GPU's reference. */
export function evalPolygonMode(sides, entry, x, y) {
	if (!insidePolygon(sides, x, y)) return 0
	return evalStoredMode(sides, plateStoredModes(sides)[entry.a], entry.mix, x, y)
}

const coeffTextures = {}
/** RG32F: row = stored mode, texel i = (nᵢ, cᵢ), zero past its terms. */
export function plateCoeffTexture(sides) {
	if (coeffTextures[sides]) return coeffTextures[sides]
	const modes = plateStoredModes(sides)
	const width = Math.max(1, ...modes.map((m) => m.orders.length))
	const height = modes.length
	const data = new Float32Array(width * height * 2)
	modes.forEach((m, row) => {
		for (let i = 0; i < m.orders.length; i++) {
			data[(row * width + i) * 2] = m.orders[i]
			data[(row * width + i) * 2 + 1] = m.coeffs[i]
		}
	})
	return (coeffTextures[sides] = { width, height, data })
}

const cornerTextures = {}
/** RGBA32F: row = stored mode, texel t = (m, kind, dₜ, 0), zero past its corner terms. */
export function plateCornerTexture(sides) {
	if (cornerTextures[sides]) return cornerTextures[sides]
	const modes = plateStoredModes(sides)
	const width = Math.max(1, ...modes.map((m) => m.cornerM.length))
	const height = modes.length
	const data = new Float32Array(width * height * 4)
	modes.forEach((m, row) => {
		for (let t = 0; t < m.cornerM.length; t++) {
			const o = (row * width + t) * 4
			data[o] = m.cornerM[t]
			data[o + 1] = m.cornerKind[t]
			data[o + 2] = m.cornerCoeffs[t]
		}
	})
	return (cornerTextures[sides] = { width, height, data })
}
