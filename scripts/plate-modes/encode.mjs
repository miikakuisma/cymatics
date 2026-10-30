// Binary format PLT2 for a polygon's modes, decoded by src/engine-js/plate-modes.js
// (whose header documents it). Little-endian:
//   'PLT2', uint8 sides, uint16 count, then per mode
//   uint8 j, uint8 parity (0 cos, 1 sin), uint8 partner (1: derive its sin partner),
//   [float32 partnerGain if partner], float32 k, float32 scale, uint16 terms, int16[terms] q,
//   uint8 cornerTerms, then per corner term uint8 code (m·4 + kind), int16 q.
// Every coefficient is q·scale/32767, one scale per mode. Offline only.

export const MAGIC = 'PLT2'
const Q = 32767

/** 16-bit coefficients against their largest: { scale (float32), q, values: what decodes }. */
export function quantise(coeffs) {
	let max = 0
	for (const c of coeffs) max = Math.max(max, Math.abs(c))
	const scale = Math.fround(max)
	const q = new Int16Array(coeffs.length)
	const values = new Float64Array(coeffs.length)
	for (let i = 0; i < coeffs.length; i++) {
		q[i] = scale > 0 ? Math.round(coeffs[i] / scale * Q) : 0
		values[i] = Math.fround(q[i] * scale / Q)
	}
	return { scale, q, values }
}

/**
 * The series coefficients then the corner coefficients of a mode, quantised
 * together: { scale, disc: values, corner: values, q }.
 */
export function quantiseMode(mode) {
	const nd = mode.coeffs.length
	const cc = mode.corners?.coeffs ?? []
	const all = new Float64Array(nd + cc.length)
	all.set(mode.coeffs)
	all.set(cc, nd)
	const { scale, q, values } = quantise(all)
	return { scale, q, disc: values.subarray(0, nd), corner: values.subarray(nd) }
}

/**
 * modes: [{ j, parity: 'cos' | 'sin', partner: boolean, partnerGain?, k,
 * coeffs, corners?: { ms, kinds, coeffs } }] → bytes.
 */
export function encodePlate(sides, modes) {
	let size = 4 + 1 + 2
	for (const m of modes) size += 3 + (m.partner ? 4 : 0) + 4 + 4 + 2 + 2 * m.coeffs.length + 1 + 3 * (m.corners?.coeffs.length ?? 0)
	const bytes = new Uint8Array(size)
	const view = new DataView(bytes.buffer)
	for (let i = 0; i < 4; i++) bytes[i] = MAGIC.charCodeAt(i)
	let o = 4
	view.setUint8(o, sides); o += 1
	view.setUint16(o, modes.length, true); o += 2
	for (const m of modes) {
		const { scale, q } = quantiseMode(m)
		const nd = m.coeffs.length, nc = m.corners?.coeffs.length ?? 0
		view.setUint8(o, m.j); o += 1
		view.setUint8(o, m.parity === 'sin' ? 1 : 0); o += 1
		view.setUint8(o, m.partner ? 1 : 0); o += 1
		if (m.partner) { view.setFloat32(o, m.partnerGain ?? 1, true); o += 4 }
		view.setFloat32(o, m.k, true); o += 4
		view.setFloat32(o, scale, true); o += 4
		view.setUint16(o, nd, true); o += 2
		for (let i = 0; i < nd; i++) { view.setInt16(o, q[i], true); o += 2 }
		view.setUint8(o, nc); o += 1
		for (let t = 0; t < nc; t++) {
			view.setUint8(o, m.corners.ms[t] * 4 + m.corners.kinds[t]); o += 1
			view.setInt16(o, q[nd + t], true); o += 2
		}
	}
	return bytes
}
