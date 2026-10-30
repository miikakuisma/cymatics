// Neumann eigenmodes of a regular polygon, one symmetry class at a time, by
// Rayleigh–Ritz (Galerkin). Offline only: scripts/plate-modes never ships.
//
// Basis for class (j, parity), N = sides:
// - Disc functions Jₙ(βr)·cos|sin(nθ′) for each order n of the class and each
//   β ≤ basisFactor·kMax with Jₙ′(βR) = 0: the Neumann modes of a disc of
//   radius R (`radius`, default DISC_RADIUS) around the polygon. R = 1 — the
//   circumcircle — would make every function flat across the circle at the
//   vertices, where the circle and polygon touch, and converges only
//   algebraically; R = 1.5 converges to the eigensolver's floor (~1e-9).
// - Corner functions, where N/(N − 2) is not an integer (pentagon, hexagon).
//   Near a vertex an eigenfunction is Σ cₘ·J_νm(k r′)·cos(νm φ′), ν = π/α, α
//   the interior angle, (r′, φ′) polar about the vertex; for νm not an integer
//   that is singular at the vertex and no smooth function approximates it
//   well. So J_μ(β r′)·cos(μ φ′) for those μ and a grid of β, at vertex 0,
//   projected onto the class, join the basis. Without them the edge flux
//   stalls at a few percent. (Plain powers r′^(νm+2p) do the same job in
//   principle, but need coefficients that cancel far from the corner, which
//   the eigensolver's cut on M throws away.)
// The Neumann condition on the edges is natural: nothing imposes it, the
// minimisation does.
//
// K and M are integrated over the fundamental triangle F (origin, vertex 0,
// the midpoint of edge 0) and scaled up to the whole polygon by symmetry:
// - 1-D classes: the integrand is invariant under all 2N symmetries, so ×2N.
// - 2-D classes (partner): it is not, but summed over the group the cos
//   member's products and its partner's average out (Schur orthogonality):
//   ∫_P φᵢφⱼ = N·∫_F (φᵢφⱼ + φ̃ᵢφ̃ⱼ), φ̃ = partnerSign·Jₙ(βr)·sin(nθ′) for a
//   disc function. The same holds for ∇φᵢ·∇φⱼ.

import { besselAllOrders, besselFrac } from '../../src/engine-js/modes.js'
import { CORNER_MAX_ORDER, classOrders, cornerFrame, cornerOrders, fundamentalTriangle, partnerSign, thetaPrime } from '../../src/engine-js/polygons.js'

// Shared with the engine, which evaluates the shipped corner terms with them.
export { besselFrac, cornerOrders, fundamentalTriangle, CORNER_MAX_ORDER }
import { genSymEig } from './linalg.mjs'

export const DISC_RADIUS = 1.5

const jScratch = new Float64Array(512)

// Jₙ′(x) = (Jₙ₋₁ − Jₙ₊₁)/2, and J₀′ = −J₁.
function besselJPrime(n, x) {
	besselAllOrders(x, n + 1, jScratch)
	return n === 0 ? -jScratch[1] : (jScratch[n - 1] - jScratch[n + 1]) / 2
}

/** Positive zeros of Jₙ′ below kMax, ascending, plus 0 first for n = 0 (the constant). */
export function neumannDiscZeros(n, kMax) {
	const zeros = n === 0 ? [0] : []
	// Jₙ′ has no zeros in (0, n], and its zeros are more than 1.8 apart.
	const step = 0.1
	let x = Math.max(n, step)
	let prev = besselJPrime(n, x)
	while (x < kMax) {
		const next = Math.min(x + step, kMax)
		const value = besselJPrime(n, next)
		if (prev * value < 0) {
			let lo = x, hi = next, flo = prev
			for (let i = 0; i < 60 && hi - lo > 1e-15 * hi; i++) {
				const mid = (lo + hi) / 2
				const fm = besselJPrime(n, mid)
				if (flo * fm <= 0) hi = mid
				else { lo = mid; flo = fm }
			}
			const z = (lo + hi) / 2
			if (z < kMax) zeros.push(z)
		}
		x = next
		prev = value
	}
	return zeros
}

// Gauss–Legendre nodes and weights on [0, 1].
const glCache = new Map()
function gaussLegendre(n) {
	if (glCache.has(n)) return glCache.get(n)
	const x = new Float64Array(n), w = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), dp = 0
		for (let it = 0; it < 100; it++) {
			let p0 = 1, p1 = z
			for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * z * p1 - (k - 1) * p0) / k]
			dp = n * (z * p1 - p0) / (z * z - 1)
			const dz = p1 / dp
			z -= dz
			if (Math.abs(dz) < 1e-16) break
		}
		x[i] = (1 - z) / 2
		w[i] = 1 / ((1 - z * z) * dp * dp)
	}
	glCache.set(n, { x, w })
	return { x, w }
}

// Dunavant's degree-8 rule on a triangle, 16 points: barycentric (l1, l2, l3)
// and weights summing to 1 (multiply by the area). Exact through degree 8.
const orbit3 = (a, w) => { const b = (1 - a) / 2; return [[a, b, b, w], [b, a, b, w], [b, b, a, w]] }
const orbit6 = (a, b, w) => {
	const c = 1 - a - b
	return [[a, b, c, w], [a, c, b, w], [b, a, c, w], [b, c, a, w], [c, a, b, w], [c, b, a, w]]
}
const DUNAVANT8 = [
	[1 / 3, 1 / 3, 1 / 3, 0.144315607677787],
	...orbit3(0.081414823414554, 0.095091634267285),
	...orbit3(0.658861384496480, 0.103217370534718),
	...orbit3(0.898905543365938, 0.032458497623198),
	...orbit6(0.008394777409958, 0.263112829634638, 0.027230314174435),
]


const GAUSS_ORDER = 8 // per block and direction in the corner patch
// Inside the patch's first block, layers s ∈ [σ·s₁, s₁] down to the floor, with
// a Gauss rule of LAYER_ORDER in both directions. On a layer, a corner
// function behaves like s^a, a branch point at 0 relative to the layer [σ, 1]:
// Gauss–Legendre converges like ρ^(−2n), ρ = (1 + √σ)/(1 − √σ) ≈ 3.9 here.
const GEOMETRIC_RATIO = 0.35
const LAYER_ORDER = 12
const GEOMETRIC_FLOOR = 1e-8 // what is left below: ∫ s^(1.3)·… ~ 1e-18

/**
 * Quadrature over the fundamental triangle F, weights summing to its area.
 * F is split into m² congruent triangles, DUNAVANT8 on each — except, when
 * `cornerBlock` q > 0, the q² of them that make up the corner triangle at
 * vertex 0, which get a rule graded towards the vertex: a collapsed (Duffy)
 * map from the vertex, Gauss–Legendre blocks of about one sub-triangle across,
 * and geometric layers inside the first, where corner functions are singular.
 * @returns {{ x: Float64Array, y: Float64Array, w: Float64Array }}
 */
export function fundamentalQuadrature(sides, m, cornerBlock = 0) {
	const [A, B, C] = fundamentalTriangle(sides)
	const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / 2
	const at = (i, j) => [A[0] + (i * (B[0] - A[0]) + j * (C[0] - A[0])) / m, A[1] + (i * (B[1] - A[1]) + j * (C[1] - A[1])) / m]
	const xs = [], ys = [], ws = []
	const sub = area / (m * m)
	const put = (P1, P2, P3) => {
		for (const [l1, l2, l3, wt] of DUNAVANT8) {
			xs.push(l1 * P1[0] + l2 * P2[0] + l3 * P3[0])
			ys.push(l1 * P1[1] + l2 * P2[1] + l3 * P3[1])
			ws.push(wt * sub)
		}
	}
	const q = Math.min(cornerBlock, m)
	for (let i = 0; i < m - q; i++) for (let j = 0; i + j < m; j++) {
		put(at(i, j), at(i + 1, j), at(i, j + 1))
		if (i + j < m - 1) put(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1))
	}
	if (q > 0) {
		// x(s, t) = V + s·(P1 − V + t·(P2 − P1)), Jacobian s·2·|T|.
		const V = B, P1 = at(m - q, 0), P2 = at(m - q, q)
		const jac = 2 * area * (q * q) / (m * m)
		const sBreaks = [0]
		for (let s = 1 / q; s > GEOMETRIC_FLOOR; s *= GEOMETRIC_RATIO) sBreaks.push(s)
		sBreaks.sort((a, b) => a - b)
		for (let i = 2; i <= q; i++) sBreaks.push(i / q)
		for (let a = 0; a + 1 < sBreaks.length; a++) {
			const s0 = sBreaks[a], ds = sBreaks[a + 1] - s0
			const layer = s0 < 1 / q
			const g = gaussLegendre(layer ? LAYER_ORDER : GAUSS_ORDER)
			const tBlocks = layer ? 1 : q
			for (let b = 0; b < tBlocks; b++) for (let is = 0; is < g.x.length; is++) for (let it = 0; it < g.x.length; it++) {
				const s = s0 + ds * g.x[is], t = (b + g.x[it]) / tBlocks
				xs.push(V[0] + s * (P1[0] - V[0] + t * (P2[0] - P1[0])))
				ys.push(V[1] + s * (P1[1] - V[1] + t * (P2[1] - P1[1])))
				ws.push(jac * s * ds * g.w[is] * g.w[it] / tBlocks)
			}
		}
	}
	return { x: Float64Array.from(xs), y: Float64Array.from(ys), w: Float64Array.from(ws) }
}

// Subdivisions per side of F for 'auto': enough that doubling them moves the
// first 20 eigenvalues of a class by < 1e-9 relative (measured; see the task
// report). The corner patch, when there is one, is a quarter of F across.
export const QUAD_PER_UNIT_K = 0.4
export const autoSubdivisions = (betaMax) => Math.max(4, Math.ceil(QUAD_PER_UNIT_K * betaMax))
const autoCornerBlock = (m) => Math.min(m, Math.max(4, Math.ceil(m / 4)))

// Corner functions: J_μ(β r′)·cos(μ φ′) for each non-integer μ = νm up to
// CORNER_MAX_ORDER (polygons.js), with β on a grid of spacing π/CORNER_REACH up to β_max.
export const CORNER_REACH = 2

/**
 * The class's basis. Disc functions: one (n, β) each, n ascending, β ascending
 * within n. Corner functions: { mu, beta, kind, … }, kind 'even'/'odd' for a
 * 1-D class, or for a 2-D class 'A' (from the part even under θ′ → −θ′) and
 * 'B' (from the odd part, carried over to the cos member); an order and kind
 * whose projection vanishes for this class is left out.
 */
export function classBasis(sides, cls, betaMax, { radius = DISC_RADIUS, cornerMaxOrder = CORNER_MAX_ORDER, cornerReach = CORNER_REACH } = {}) {
	const orders = [], betas = []
	for (const n of classOrders(sides, cls.j, cls.parity, Math.ceil(betaMax * radius))) {
		for (const b of neumannDiscZeros(n, betaMax * radius)) { orders.push(n); betas.push(b / radius) }
	}
	const kinds = cls.partner ? ['A', 'B'] : [cls.parity === 'cos' ? 'even' : 'odd']
	const step = Math.PI / cornerReach
	// Grouped by Bessel family (μ mod 1) and β, so one recurrence serves a group.
	const corners = []
	const mus = cornerOrders(sides, cornerMaxOrder)
	const ctx = { sides, cls, frame: cornerFrame(sides), orders: new Int32Array(0), betas: new Float64Array(0), cornerMus: mus }
	const live = []
	for (const [m, mu] of mus.entries()) for (const kind of kinds) {
		const idx = Math.floor(mu)
		const probe = { mu, m, base: mu - idx, idx, beta: 1.7, kind, top: idx + 1 }
		ctx.corners = [probe]
		if (!vanishes(ctx)) live.push(probe)
	}
	live.sort((p, q) => p.base - q.base || p.mu - q.mu)
	for (let s = 1; s * step <= betaMax; s++) {
		const group = live.map((c) => ({ ...c, beta: s * step }))
		group.sort((p, q) => p.base - q.base)
		for (const c of group) c.top = Math.max(...group.filter((g) => g.base === c.base).map((g) => g.idx + 1))
		corners.push(...group)
	}
	return { orders: Int32Array.from(orders), betas: Float64Array.from(betas), corners, cornerMus: mus }
}

// Whether a lone corner function projects to zero for the class: sampled at
// points of F well away from vertex 0, against the size of its terms.
function vanishes(ctx) {
	const [A, B, C] = fundamentalTriangle(ctx.sides)
	const val = new Float64Array(1), mag = new Float64Array(1)
	for (const [a, b, c] of [[0.6, 0.2, 0.2], [0.3, 0.3, 0.4], [0.2, 0.5, 0.3], [0.5, 0.1, 0.4]]) {
		const x = a * A[0] + b * B[0] + c * C[0], y = a * A[1] + b * B[1] + c * C[1]
		basisAt(ctx, x, y, false, val, null, null, mag)
		if (Math.abs(val[0]) > 1e-10 * mag[0]) return false
	}
	return true
}

// Values of every basis function at (x, y) into `val` (disc functions first,
// then corner functions); with `dr`/`dt`, also ∂ᵣφ and (1/r)∂θφ. `partner`
// evaluates the 2-D class's sin partners instead. `mag`, if given, receives
// Σ|terms| of each corner function (to tell a cancellation from a value).
function basisAt(ctx, x, y, partner, val, dr, dt, mag) {
	const { sides, cls, orders, betas } = ctx
	const r = Math.hypot(x, y), t = thetaPrime(x, y)
	const useSin = partner || cls.parity === 'sin'
	const nd = orders.length
	for (let i = 0; i < nd; i++) {
		const n = orders[i], beta = betas[i]
		const sign = partner ? partnerSign(sides, cls.j, n) : 1
		const c = Math.cos(n * t), s = Math.sin(n * t)
		const trig = sign * (useSin ? s : c)
		besselAllOrders(beta * r, n + 1, jScratch)
		val[i] = jScratch[n] * trig
		if (dr) {
			// ∂ᵣ: β·Jₙ′(βr); (1/r)∂θ: (n/r)·Jₙ(βr) = β·(Jₙ₋₁ + Jₙ₊₁)/2 at βr, finite at r = 0.
			const Jp = n === 0 ? -jScratch[1] : (jScratch[n - 1] - jScratch[n + 1]) / 2
			const Jn = n === 0 ? 0 : (jScratch[n - 1] + jScratch[n + 1]) / 2
			dr[i] = beta * Jp * trig
			dt[i] = beta * Jn * sign * (useSin ? c : -s)
		}
	}
	if (ctx.corners.length) cornerAt(ctx, x, y, t, partner, val, dr, dt, mag, nd)
}

// Corner functions through the class projection. With E/O the parts of ψ even
// and odd under θ′ → −θ′, δₖ = 2πk/N, cₖ = cos jδₖ, sₖ = sin jδₖ (overall
// scale is immaterial):
//   1-D even: Σ cₖ E(θ + δₖ)          1-D odd: Σ cₖ O(θ + δₖ)
//   2-D A:    Σ cₖ E(θ + δₖ), partner −Σ sₖ E(θ + δₖ)
//   2-D B:    Σ sₖ O(θ + δₖ), partner  Σ cₖ O(θ + δₖ)
// E(θ + δ) at a point is ½[ψ(Qx) + ψ(SQx)], Q the rotation by δ, S: x → −x.
const cornerJ = new Float64Array(64), cornerCos = new Float64Array(16), cornerSin = new Float64Array(16)
let cornerGx = new Float64Array(0), cornerGy = new Float64Array(0)
function cornerAt(ctx, x, y, t, partner, val, dr, dt, mag, offset) {
	const { sides, cls, frame: f, corners, cornerMus } = ctx
	const nc = corners.length
	if (cornerGx.length < nc) { cornerGx = new Float64Array(nc); cornerGy = new Float64Array(nc) }
	val.fill(0, offset, offset + nc)
	if (mag) mag.fill(0, offset, offset + nc)
	if (dr) { cornerGx.fill(0, 0, nc); cornerGy.fill(0, 0, nc) }
	for (let k = 0; k < sides; k++) {
		const d = 2 * Math.PI * k / sides
		const cd = Math.cos(d), sd = Math.sin(d)
		const ck = Math.cos(cls.j * d), sk = Math.sin(cls.j * d)
		const qx = x * cd + y * sd, qy = -x * sd + y * cd
		for (let h = 0; h < 2; h++) {
			const refl = h === 1
			const dx = (refl ? -qx : qx) - f.vx, dy = qy - f.vy
			const u = dx * f.bx + dy * f.by, s = dx * f.wx + dy * f.wy
			const rr = Math.hypot(u, s)
			if (rr === 0) continue
			const phi = Math.atan2(s, u) + f.halfAngle
			const cu = u / rr, su = s / rr
			for (let i = 0; i < cornerMus.length; i++) {
				cornerCos[i] = Math.cos(cornerMus[i] * phi)
				cornerSin[i] = Math.sin(cornerMus[i] * phi)
			}
			let base = -1, beta = -1
			for (let c = 0; c < nc; c++) {
				const fn = corners[c]
				// Weight of ψ(Qx) (h = 0) or ψ(SQx) (h = 1) in the value.
				let w
				if (fn.kind === 'even') w = ck
				else if (fn.kind === 'odd') w = refl ? -ck : ck
				else if (fn.kind === 'A') w = partner ? -sk : ck
				else w = (refl ? -1 : 1) * (partner ? ck : sk)
				if (w === 0) continue
				if (fn.base !== base || fn.beta !== beta) {
					base = fn.base
					beta = fn.beta
					besselFrac(base, beta * rr, fn.top, cornerJ)
				}
				const cosA = cornerCos[fn.m]
				const psi = cornerJ[fn.idx] * cosA
				val[offset + c] += w * psi
				if (mag) mag[offset + c] += Math.abs(w * psi)
				if (dr) {
					// ∇ψ, local frame: radial β·J′_μ·cos, angular −(μ/r′)·J_μ·sin, both via J_{μ±1}.
					const jm = cornerJ[fn.idx - 1], jp = cornerJ[fn.idx + 1]
					const sinA = cornerSin[fn.m]
					const Dr = beta * (jm - jp) / 2 * cosA, Dp = -beta * (jm + jp) / 2 * sinA
					const gu = Dr * cu - Dp * su, gs = Dr * su + Dp * cu
					let hx = gu * f.bx + gs * f.wx
					const hy = gu * f.by + gs * f.wy
					if (refl) hx = -hx
					// Pull back through Q: Qᵀ = [[cos, −sin], [sin, cos]].
					cornerGx[c] += w * (hx * cd - hy * sd)
					cornerGy[c] += w * (hx * sd + hy * cd)
				}
			}
		}
	}
	if (dr) {
		const s0 = Math.sin(t), c0 = Math.cos(t)
		for (let c = 0; c < nc; c++) {
			dr[offset + c] = cornerGx[c] * s0 + cornerGy[c] * c0
			dt[offset + c] = cornerGx[c] * c0 - cornerGy[c] * s0
		}
	}
}

// out[i·n + j] += Σ_p F[i·len + p]·F[j·len + p] for j ≥ i, F holding n rows of length len.
function accumulateGram(out, F, n, len) {
	for (let i = 0; i < n; i++) {
		const oi = i * len
		for (let j = i; j < n; j++) {
			const oj = j * len
			let s0 = 0, s1 = 0, s2 = 0, s3 = 0, p = 0
			for (; p + 3 < len; p += 4) {
				s0 += F[oi + p] * F[oj + p]
				s1 += F[oi + p + 1] * F[oj + p + 1]
				s2 += F[oi + p + 2] * F[oj + p + 2]
				s3 += F[oi + p + 3] * F[oj + p + 3]
			}
			for (; p < len; p++) s0 += F[oi + p] * F[oj + p]
			out[i * n + j] += s0 + s1 + s2 + s3
		}
	}
}

const basisSize = (basis) => basis.orders.length + basis.corners.length
const context = (sides, cls, basis) => ({ sides, cls, frame: cornerFrame(sides), ...basis })

// Basis values and gradients at the quadrature points, a chunk at a time, each
// scaled by √(weight × symmetry factor) so that M = Σ F·Fᵀ. `visit(Fm, Fk, cols)`
// gets n rows of `cols` values and n rows of 2·cols gradient components
// (∂ᵣ, then (1/r)∂θ); for a 2-D class the partner's columns follow the cos
// member's.
const CHUNK = 256
function forEachChunk(ctx, n, quadrature, visit) {
	const { x, y, w } = quadrature
	const parts = ctx.cls.partner ? [false, true] : [false]
	const scale = (ctx.cls.partner ? 1 : 2) * ctx.sides
	const Fm = new Float64Array(n * CHUNK * parts.length)
	const Fk = new Float64Array(n * 2 * CHUNK * parts.length)
	const val = new Float64Array(n), dr = new Float64Array(n), dt = new Float64Array(n)
	for (let start = 0; start < w.length; start += CHUNK) {
		const len = Math.min(CHUNK, w.length - start)
		const cols = len * parts.length
		for (let q = 0; q < len; q++) {
			const p = start + q
			const sw = Math.sqrt(w[p] * scale)
			for (let h = 0; h < parts.length; h++) {
				basisAt(ctx, x[p], y[p], parts[h], val, dr, dt)
				const c = h * len + q
				for (let i = 0; i < n; i++) {
					Fm[i * cols + c] = sw * val[i]
					Fk[i * 2 * cols + c] = sw * dr[i]
					Fk[i * 2 * cols + cols + c] = sw * dt[i]
				}
			}
		}
		visit(Fm, Fk, cols)
	}
}

const symmetrize = (A, n) => {
	for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) A[i * n + j] = A[j * n + i]
}

/** Stiffness K and mass M over the whole polygon, n×n row-major. */
function assemble(sides, cls, basis, quadrature) {
	const ctx = context(sides, cls, basis)
	const n = basisSize(basis)
	const K = new Float64Array(n * n), M = new Float64Array(n * n)
	forEachChunk(ctx, n, quadrature, (Fm, Fk, cols) => {
		accumulateGram(M, Fm, n, cols)
		accumulateGram(K, Fk, n, 2 * cols)
	})
	symmetrize(M, n)
	symmetrize(K, n)
	return { K, M }
}

/**
 * The eigenpairs of one symmetry class with 0 < k ≤ kMax, ascending. Each
 * eigenfunction is normalised to ∫u² = 1 over the whole polygon (for a 2-D
 * class, the cos member; its sin partner has the same norm).
 * Options: `quad` 'auto' or subdivisions per side of F; `radius` the disc the
 * Bessel basis is built on; `cornerMaxOrder`, `cornerReach` the corner functions'
 * highest order and β spacing (π/reach).
 * `evalMany(points)` takes interleaved [x0, y0, x1, y1, …]; it keeps the basis
 * values of the last array it was given (shared by the class's modes), so
 * evaluating every mode at one set of points costs one basis evaluation.
 */
export function solveClass(sides, cls, { kMax, basisFactor = 1.35, quad = 'auto', radius = DISC_RADIUS, cornerMaxOrder = CORNER_MAX_ORDER, cornerReach = CORNER_REACH } = {}) {
	const betaMax = basisFactor * kMax
	const basis = classBasis(sides, cls, betaMax, { radius, cornerMaxOrder, cornerReach })
	const ctx = context(sides, cls, basis)
	const n = basisSize(basis)
	const m = quad === 'auto' ? autoSubdivisions(betaMax) : quad
	const quadrature = fundamentalQuadrature(sides, m, basis.corners.length ? autoCornerBlock(m) : 0)
	const { K, M } = assemble(sides, cls, basis, quadrature)
	const { values, vectors } = genSymEig(K, M, n)
	const kept = values.length

	const val = new Float64Array(n)
	let cachedPoints = null, cachedValues = null
	const basisValues = (points) => {
		if (points !== cachedPoints) {
			const count = points.length / 2
			cachedValues = new Float64Array(count * n)
			for (let p = 0; p < count; p++) basisAt(ctx, points[2 * p], points[2 * p + 1], false, cachedValues.subarray(p * n, (p + 1) * n))
			cachedPoints = points
		}
		return cachedValues
	}

	const modes = []
	for (let col = 0; col < kept; col++) {
		const lambda = values[col]
		if (!(lambda > 1e-8)) continue
		const k = Math.sqrt(lambda)
		if (k > kMax) break
		const a = new Float64Array(n)
		for (let i = 0; i < n; i++) a[i] = vectors[i * kept + col]
		modes.push({
			k,
			eval(x, y) {
				basisAt(ctx, x, y, false, val)
				let u = 0
				for (let i = 0; i < n; i++) u += a[i] * val[i]
				return u
			},
			evalMany(points) {
				const B = basisValues(points)
				const out = new Float64Array(points.length / 2)
				for (let p = 0; p < out.length; p++) {
					let u = 0
					const o = p * n
					for (let i = 0; i < n; i++) u += a[i] * B[o + i]
					out[p] = u
				}
				return out
			},
		})
	}
	return modes
}
