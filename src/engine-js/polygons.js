// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Regular polygon plates (triangle, pentagon, hexagon, and any N >= 3): the
// geometry, and the symmetry classes the offline solver splits them into.
//
// Shapes have circumradius 1. Angles are θ′ = atan2(x, y): from +y towards +x,
// so every shape is mirror-symmetric about x = 0. Triangle and pentagon point
// up (a vertex at θ′ = 0); the hexagon sits flat on top (vertices at ±30°).
// The shader repeats `insidePolygon` exactly.
//
// Classes. With a mirror at θ′ = 0, the group is dihedral D_N and a function
// Σ (aₙ cos nθ′ + bₙ sin nθ′) Jₙ(kr) splits by n mod N:
// - j = 0: n a multiple of N. cos and sin are separate 1-D classes.
// - 0 < j < N/2: n ≡ ±j. A 2-D class; the cos member is solved and the sin
//   member derived with `partnerSign`.
// - j = N/2 (even N): n an odd multiple of N/2. cos and sin separate again.

export const thetaPrime = (x, y) => Math.atan2(x, y)

export function polygon(sides) {
	const offset = sides === 6 ? Math.PI / 6 : 0
	const vertices = []
	for (let i = 0; i < sides; i++) {
		const t = offset + 2 * Math.PI * i / sides
		vertices.push([Math.sin(t), Math.cos(t)])
	}
	return { sides, offset, apothem: Math.cos(Math.PI / sides), vertices }
}

// Reduce θ′ − offset − π/N into [−π/N, π/N), then test against the apothem.
export function insidePolygon(sides, x, y) {
	const { offset, apothem } = polygon(sides)
	const w = 2 * Math.PI / sides
	let phi = thetaPrime(x, y) - offset - Math.PI / sides
	phi -= w * Math.floor((phi + Math.PI / sides) / w)
	return Math.hypot(x, y) * Math.cos(phi) <= apothem + 1e-12
}

export function symmetryClasses(sides) {
	const classes = [{ j: 0, parity: 'cos', partner: false }, { j: 0, parity: 'sin', partner: false }]
	for (let j = 1; 2 * j < sides; j++) classes.push({ j, parity: 'cos', partner: true })
	if (sides % 2 === 0) {
		classes.push({ j: sides / 2, parity: 'cos', partner: false }, { j: sides / 2, parity: 'sin', partner: false })
	}
	return classes
}

// Ascending n <= nMax with n ≡ ±j (mod N). n = 0 has no sin, so only j = 0 cos keeps it.
export function classOrders(sides, j, parity, nMax) {
	const out = []
	for (let n = parity === 'cos' && j === 0 ? 0 : 1; n <= nMax; n++) {
		const r = n % sides
		if (r === j || r === (sides - j) % sides) out.push(n)
	}
	return Int32Array.from(out)
}

// +1 if n ≡ j (mod N), else −1.
export const partnerSign = (sides, j, n) => (n % sides === j ? 1 : -1)
