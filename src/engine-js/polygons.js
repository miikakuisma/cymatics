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
	// polygon()'s offset and apothem, without building its vertex list on every call.
	const offset = sides === 6 ? Math.PI / 6 : 0, apothem = Math.cos(Math.PI / sides)
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

/** The fundamental triangle: origin, vertex 0, and the midpoint of edge 0. */
export function fundamentalTriangle(sides) {
	const { vertices } = polygon(sides)
	const [b, c] = [vertices[0], vertices[1]]
	return [[0, 0], b, [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]]
}

// Corners. Near a vertex of interior angle α = π(N − 2)/N an eigenfunction is
// Σ cₘ·J_νm(k r′)·cos(νm φ′), ν = π/α = N/(N − 2), (r′, φ′) polar about the
// vertex. Where νm is not an integer that is singular at the vertex, and a
// series about the centre converges only slowly there: the pentagon (ν = 5/3)
// and hexagon (ν = 3/2) need those terms explicitly; the triangle (ν = 3) and
// square (ν = 2) have none.
export const CORNER_MAX_ORDER = 8

/** The non-integer corner orders μ = νm ≤ maxOrder, ν = N/(N − 2). */
export function cornerOrders(sides, maxOrder = CORNER_MAX_ORDER) {
	const nu = sides / (sides - 2)
	const out = []
	for (let m = 1; nu * m <= maxOrder + 1e-9; m++) {
		const mu = nu * m
		if (Math.abs(mu - Math.round(mu)) > 1e-9) out.push(mu)
	}
	return out
}

// Vertex 0's local frame: b̂ the inward bisector, ŵ across it towards the last
// vertex; φ′ runs from 0 on edge 0 to α on edge N − 1, and the branch cut lies
// outside the polygon, along −b̂.
export function cornerFrame(sides) {
	const { vertices } = polygon(sides)
	const V = vertices[0], last = vertices[sides - 1]
	const bx = -V[0], by = -V[1]
	let wx = -by, wy = bx
	if ((last[0] - V[0]) * wx + (last[1] - V[1]) * wy < 0) { wx = -wx; wy = -wy }
	return { vx: V[0], vy: V[1], bx, by, wx, wy, halfAngle: Math.PI * (sides - 2) / sides / 2 }
}
